// ==UserScript==
// @name         Hacker News 评论 AI 总结
// @namespace    https://tampermonkey.local
// @version      1.1
// @description  在 Hacker News 评论页注入"AI 总结"按钮，调用 OpenAI 兼容接口总结评论区讨论，结果以 markdown 渲染
// @match        https://news.ycombinator.com/item?id=*
// @icon         https://news.ycombinator.com/y18.svg
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @connect      *
// @require      https://cdn.jsdelivr.net/npm/marked@16.4.2/lib/marked.umd.js
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    // 默认配置：OpenAI 官方接口与一个常用的小模型，用户可在配置面板覆盖
    const DEFAULTS = {
        baseURL: 'https://api.openai.com/v1',
        apiKey: '',
        model: 'gpt-4o-mini',
    };

    // 单条评论与整体输入的截断阈值，避免 token 爆炸
    const MAX_COMMENT_CHARS = 600;
    const MAX_TOTAL_CHARS = 24000;
    const SUMMARY_TEMPERATURE = 0.3;

    function getConfig() {
        return {
            baseURL: GM_getValue('baseURL', DEFAULTS.baseURL),
            apiKey: GM_getValue('apiKey', DEFAULTS.apiKey),
            model: GM_getValue('model', DEFAULTS.model),
        };
    }

    function setConfig(cfg) {
        GM_setValue('baseURL', cfg.baseURL);
        GM_setValue('apiKey', cfg.apiKey);
        GM_setValue('model', cfg.model);
    }

    // 从当前 DOM 提取评论：作者、缩进层级、正文
    function extractComments(root) {
        const rows = root.querySelectorAll('tr.athing.comtr');
        const comments = [];
        for (const row of rows) {
            const userEl = row.querySelector('.hnuser');
            const textEl = row.querySelector('.commtext');
            const indEl = row.querySelector('td.ind');
            const depth = indEl ? parseInt(indEl.getAttribute('indent') || '0', 10) : 0;
            const user = userEl ? userEl.textContent : '[匿名]';
            const text = (textEl ? textEl.textContent : '').replace(/\s+/g, ' ').trim();
            if (!text) continue; // 跳过 [deleted]/折叠无内容等
            comments.push({ user, depth, text });
        }
        return comments;
    }

    // 把评论列表压成单条文本，超过总量阈值时截断
    function buildInputText(comments) {
        let total = 0;
        const lines = [];
        for (const c of comments) {
            let t = c.text;
            if (t.length > MAX_COMMENT_CHARS) t = t.slice(0, MAX_COMMENT_CHARS) + '…';
            const line = `[${c.user}] (depth=${c.depth}) ${t}`;
            if (total + line.length > MAX_TOTAL_CHARS) {
                lines.push('…（剩余评论已截断）');
                break;
            }
            lines.push(line);
            total += line.length;
        }
        return lines.join('\n');
    }

    function buildMessages(title, inputText) {
        const system = [
            '你是 Hacker News 评论总结助手。',
            '请基于用户提供的评论列表，用中文总结评论区主要讨论内容：',
            '1) 用 3-6 个要点概括核心观点；',
            '2) 标注存在争议或分歧的话题；',
            '3) 提及具有代表性的发言者。',
            '直接输出总结，不要寒暄。',
        ].join('');
        const user = `文章标题：${title}\n\n评论列表：\n${inputText}`;
        return [
            { role: 'system', content: system },
            { role: 'user', content: user },
        ];
    }

    // 解析 OpenAI 兼容 /chat/completions 的非流式响应
    function parseCompletion(responseText) {
        const data = JSON.parse(responseText);
        const choice = data && data.choices && data.choices[0];
        const content = choice && choice.message && choice.message.content;
        if (typeof content !== 'string') {
            throw new Error('AI 响应缺少 choices[0].message.content');
        }
        return content.trim();
    }

    function requestChat(baseURL, apiKey, model, messages) {
        return new Promise((resolve, reject) => {
            const url = baseURL.replace(/\/+$/, '') + '/chat/completions';
            GM_xmlhttpRequest({
                method: 'POST',
                url,
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${apiKey}`,
                },
                data: JSON.stringify({
                    model,
                    messages,
                    temperature: SUMMARY_TEMPERATURE,
                    stream: false,
                }),
                onload(res) {
                    if (res.status < 200 || res.status >= 300) {
                        reject(new Error(`HTTP ${res.status}: ${(res.responseText || '').slice(0, 200)}`));
                        return;
                    }
                    try {
                        resolve(parseCompletion(res.responseText));
                    } catch (e) {
                        reject(e);
                    }
                },
                onerror() {
                    reject(new Error('网络错误（检查 baseURL 或 @connect 权限）'));
                },
                ontimeout() {
                    reject(new Error('请求超时'));
                },
            });
        });
    }

    // ---- UI ----

    function injectStyles() {
        const css = `
.hn-ai-summary {
    background: #f6f6ef;
    border: 1px solid #e6e6df;
    padding: 8px 10px;
    margin: 0 0 12px;
    font-family: Verdana, Geneva, sans-serif;
    font-size: 13px;
    color: #1a1a1a;
}
.hn-ai-summary__header {
    display: flex;
    align-items: center;
    gap: 10px;
}
.hn-ai-summary__title {
    font-weight: bold;
    color: #ff6600;
}
.hn-ai-summary__btn {
    background: #ff6600;
    color: #fff;
    border: none;
    padding: 2px 10px;
    font-size: 13px;
    cursor: pointer;
    border-radius: 3px;
}
.hn-ai-summary__btn:disabled {
    background: #b0b0a8;
    cursor: default;
}
.hn-ai-summary__result {
    margin-top: 8px;
    line-height: 1.6;
}
.hn-ai-summary__result--error {
    color: #a00;
}
.hn-ai-summary__result--loading {
    color: #555;
}
.hn-ai-summary__result h3 {
    margin: 10px 0 4px;
    font-size: 13px;
    color: #ff6600;
}
.hn-ai-summary__result ul,
.hn-ai-summary__result ol {
    margin: 4px 0;
    padding-left: 22px;
}
.hn-ai-summary__result li {
    margin: 2px 0;
}
.hn-ai-summary__result p {
    margin: 6px 0;
}
.hn-ai-summary__result strong {
    color: #1a1a1a;
}
.hn-ai-summary__modal {
    position: fixed;
    top: 80px;
    left: 50%;
    transform: translateX(-50%);
    background: #f6f6ef;
    border: 1px solid #999;
    padding: 16px 20px;
    z-index: 9999;
    font-family: Verdana, Geneva, sans-serif;
    font-size: 13px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.2);
}
.hn-ai-summary__modal label {
    display: block;
    margin-top: 8px;
    color: #333;
}
.hn-ai-summary__modal input {
    width: 360px;
    padding: 3px 6px;
    font-size: 13px;
    box-sizing: border-box;
}
.hn-ai-summary__modal__actions {
    margin-top: 14px;
    text-align: right;
}
.hn-ai-summary__modal__actions button {
    margin-left: 8px;
    padding: 3px 12px;
    cursor: pointer;
}`;
        const style = document.createElement('style');
        style.textContent = css;
        document.head.appendChild(style);
    }

    function getStoryTitle() {
        const link = document.querySelector('table.fatitem span.titleline > a');
        return link ? link.textContent.trim() : document.title;
    }

    function setResultEl(resultEl, text, kind) {
        resultEl.className = 'hn-ai-summary__result' + (kind ? ` hn-ai-summary__result--${kind}` : '');
        // loading/error 用纯文本；成功结果用 marked 渲染 markdown
        if (kind) {
            resultEl.textContent = text;
        } else if (typeof marked !== 'undefined' && marked.parse) {
            resultEl.innerHTML = marked.parse(text);
        } else {
            resultEl.textContent = text;
        }
    }

    function handleSummarize(btn, resultEl) {
        const cfg = getConfig();
        if (!cfg.apiKey) {
            setResultEl(resultEl, '未配置 API Key，请通过菜单"⚙️ 配置 AI 总结"填写。', 'error');
            openConfigPanel();
            return;
        }

        const comments = extractComments(document);
        if (comments.length === 0) {
            setResultEl(resultEl, '当前页面没有可总结的评论。', 'error');
            return;
        }

        const inputText = buildInputText(comments);
        const messages = buildMessages(getStoryTitle(), inputText);

        btn.disabled = true;
        setResultEl(resultEl, '总结中…', 'loading');

        requestChat(cfg.baseURL, cfg.apiKey, cfg.model, messages)
            .then((summary) => setResultEl(resultEl, summary))
            .catch((err) => setResultEl(resultEl, `总结失败：${err.message}`, 'error'))
            .finally(() => { btn.disabled = false; });
    }

    function injectSummaryPanel() {
        const commentTree = document.querySelector('table.comment-tree');
        if (!commentTree) return; // 无评论区不注入

        const panel = document.createElement('div');
        panel.className = 'hn-ai-summary';

        const header = document.createElement('div');
        header.className = 'hn-ai-summary__header';

        const title = document.createElement('span');
        title.className = 'hn-ai-summary__title';
        title.textContent = 'AI 评论总结';

        const btn = document.createElement('button');
        btn.className = 'hn-ai-summary__btn';
        btn.type = 'button';
        btn.textContent = 'AI 总结评论';

        const result = document.createElement('div');
        result.className = 'hn-ai-summary__result';

        btn.addEventListener('click', () => handleSummarize(btn, result));

        header.appendChild(title);
        header.appendChild(btn);
        panel.appendChild(header);
        panel.appendChild(result);

        commentTree.parentNode.insertBefore(panel, commentTree);
    }

    function openConfigPanel() {
        if (document.querySelector('.hn-ai-summary__modal')) return;
        const cfg = getConfig();

        const modal = document.createElement('div');
        modal.className = 'hn-ai-summary__modal';

        const fields = [
            { key: 'baseURL', label: 'Base URL（OpenAI 兼容）', type: 'text' },
            { key: 'apiKey', label: 'API Key', type: 'password' },
            { key: 'model', label: '模型', type: 'text' },
        ];

        const inputs = {};
        for (const f of fields) {
            const label = document.createElement('label');
            label.textContent = f.label;
            const input = document.createElement('input');
            input.type = f.type;
            input.value = cfg[f.key] || '';
            inputs[f.key] = input;
            label.appendChild(input);
            modal.appendChild(label);
        }

        const actions = document.createElement('div');
        actions.className = 'hn-ai-summary__modal__actions';

        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = '取消';
        cancelBtn.addEventListener('click', () => modal.remove());

        const saveBtn = document.createElement('button');
        saveBtn.textContent = '保存';
        saveBtn.addEventListener('click', () => {
            setConfig({
                baseURL: inputs.baseURL.value.trim() || DEFAULTS.baseURL,
                apiKey: inputs.apiKey.value.trim(),
                model: inputs.model.value.trim() || DEFAULTS.model,
            });
            modal.remove();
        });

        actions.appendChild(cancelBtn);
        actions.appendChild(saveBtn);
        modal.appendChild(actions);
        document.body.appendChild(modal);
    }

    injectStyles();
    injectSummaryPanel();
    GM_registerMenuCommand('⚙️ 配置 AI 总结', openConfigPanel);

    // 暴露纯函数便于单元测试（仅测试用途）
    globalThis.__hnAiSummary = {
        extractComments,
        buildInputText,
        buildMessages,
        parseCompletion,
        getConfig,
        setConfig,
    };
})();
