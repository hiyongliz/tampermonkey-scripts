// ==UserScript==
// @name         Reddit 评论 AI 总结
// @namespace    https://tampermonkey.local
// @version      1.1
// @description  在 old.reddit.com 评论页注入"AI 总结"按钮，调用 OpenAI 兼容接口总结帖子与评论区讨论，结果以 markdown 渲染
// @match        https://old.reddit.com/r/*/comments/*
// @match        https://old.reddit.com/comments/*
// @icon         https://www.redditstatic.com/favicon.ico
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

    // 判断元素 class 列表是否包含指定 class（兼容字符串 className）
    function hasClass(el, cls) {
        return (' ' + (el.className || '') + ' ').indexOf(' ' + cls + ' ') !== -1;
    }

    // reddit 评论通过 div.child 嵌套体现层级，
    // 向上数祖先中 class 含 "child" 的数量即为深度
    function countDepth(el) {
        let depth = 0;
        let node = el.parentElement;
        while (node) {
            if (hasClass(node, 'child')) depth++;
            node = node.parentElement;
        }
        return depth;
    }

    // 提取帖子标题与 self post 正文（链接帖无正文）
    function extractPost(root) {
        const linkThing = Array.prototype.find.call(
            root.querySelectorAll('div.thing'),
            (el) => hasClass(el, 'link'),
        );
        if (!linkThing) return { title: document.title, body: '' };

        const titleEl = linkThing.querySelector('a.title');
        const title = titleEl ? titleEl.textContent.trim() : document.title;

        const bodyMd = linkThing.querySelector('div.usertext-body div.md');
        const body = bodyMd ? bodyMd.textContent.replace(/\s+/g, ' ').trim() : '';
        return { title, body };
    }

    // 从当前 DOM 提取评论：作者、嵌套深度、正文
    function extractComments(root) {
        const things = root.querySelectorAll('div.thing.comment');
        const comments = [];
        for (const thing of things) {
            const author = thing.getAttribute('data-author')
                || (thing.querySelector('a.author') ? thing.querySelector('a.author').textContent : null)
                || '[匿名]';
            const md = thing.querySelector('div.usertext-body div.md');
            const text = (md ? md.textContent : '').replace(/\s+/g, ' ').trim();
            if (!text) continue; // 跳过折叠/[deleted]等无内容评论
            comments.push({ user: author, depth: countDepth(thing), text });
        }
        return comments;
    }

    // 把帖子正文与评论列表压成单条文本，超过总量阈值时截断
    function buildInputText(post, comments) {
        let total = 0;
        const lines = [];

        if (post.body) {
            let body = post.body;
            if (body.length > MAX_COMMENT_CHARS) body = body.slice(0, MAX_COMMENT_CHARS) + '…';
            const line = `[帖子正文] ${body}`;
            lines.push(line);
            total += line.length;
        }

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
            '你是 Reddit 评论总结助手。',
            '请基于用户提供的帖子正文与评论列表，用中文总结讨论内容：',
            '1) 用 3-6 个要点概括核心观点；',
            '2) 标注存在争议或分歧的话题；',
            '3) 提及具有代表性的发言者。',
            '直接输出总结，不要寒暄。',
        ].join('');
        const user = `帖子标题：${title}\n\n内容：\n${inputText}`;
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
.rd-ai-summary {
    background: #f6f7f8;
    border: 1px solid #e8e8e8;
    padding: 8px 10px;
    margin: 0 0 12px;
    font-family: -apple-system, "Segoe UI", Helvetica, Arial, sans-serif;
    font-size: 13px;
    color: #1a1a1b;
}
.rd-ai-summary__header {
    display: flex;
    align-items: center;
    gap: 10px;
}
.rd-ai-summary__title {
    font-weight: bold;
    color: #ff4500;
}
.rd-ai-summary__btn {
    background: #ff4500;
    color: #fff;
    border: none;
    padding: 2px 10px;
    font-size: 13px;
    cursor: pointer;
    border-radius: 3px;
}
.rd-ai-summary__btn:disabled {
    background: #b0b0a8;
    cursor: default;
}
.rd-ai-summary__result {
    margin-top: 8px;
    line-height: 1.6;
}
.rd-ai-summary__result--error {
    color: #a00;
}
.rd-ai-summary__result--loading {
    color: #555;
}
.rd-ai-summary__result h3 {
    margin: 10px 0 4px;
    font-size: 13px;
    color: #ff4500;
}
.rd-ai-summary__result ul,
.rd-ai-summary__result ol {
    margin: 4px 0;
    padding-left: 22px;
}
.rd-ai-summary__result li {
    margin: 2px 0;
}
.rd-ai-summary__result p {
    margin: 6px 0;
}
.rd-ai-summary__result strong {
    color: #1a1a1b;
}
.rd-ai-summary__modal {
    position: fixed;
    top: 80px;
    left: 50%;
    transform: translateX(-50%);
    background: #f6f7f8;
    border: 1px solid #999;
    padding: 16px 20px;
    z-index: 9999;
    font-family: -apple-system, "Segoe UI", Helvetica, Arial, sans-serif;
    font-size: 13px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.2);
}
.rd-ai-summary__modal label {
    display: block;
    margin-top: 8px;
    color: #333;
}
.rd-ai-summary__modal input {
    width: 360px;
    padding: 3px 6px;
    font-size: 13px;
    box-sizing: border-box;
}
.rd-ai-summary__modal__actions {
    margin-top: 14px;
    text-align: right;
}
.rd-ai-summary__modal__actions button {
    margin-left: 8px;
    padding: 3px 12px;
    cursor: pointer;
}`;
        const style = document.createElement('style');
        style.textContent = css;
        document.head.appendChild(style);
    }

    function setResultEl(resultEl, text, kind) {
        resultEl.className = 'rd-ai-summary__result' + (kind ? ` rd-ai-summary__result--${kind}` : '');
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

        const post = extractPost(document);
        const comments = extractComments(document);
        if (comments.length === 0 && !post.body) {
            setResultEl(resultEl, '当前页面没有可总结的内容。', 'error');
            return;
        }

        const inputText = buildInputText(post, comments);
        const messages = buildMessages(post.title, inputText);

        btn.disabled = true;
        setResultEl(resultEl, '总结中…', 'loading');

        requestChat(cfg.baseURL, cfg.apiKey, cfg.model, messages)
            .then((summary) => setResultEl(resultEl, summary))
            .catch((err) => setResultEl(resultEl, `总结失败：${err.message}`, 'error'))
            .finally(() => { btn.disabled = false; });
    }

    function injectSummaryPanel() {
        const commentArea = document.querySelector('div.commentarea');
        if (!commentArea) return; // 无评论区不注入

        const panel = document.createElement('div');
        panel.className = 'rd-ai-summary';

        const header = document.createElement('div');
        header.className = 'rd-ai-summary__header';

        const title = document.createElement('span');
        title.className = 'rd-ai-summary__title';
        title.textContent = 'AI 评论总结';

        const btn = document.createElement('button');
        btn.className = 'rd-ai-summary__btn';
        btn.type = 'button';
        btn.textContent = 'AI 总结帖子与评论';

        const result = document.createElement('div');
        result.className = 'rd-ai-summary__result';

        btn.addEventListener('click', () => handleSummarize(btn, result));

        header.appendChild(title);
        header.appendChild(btn);
        panel.appendChild(header);
        panel.appendChild(result);

        commentArea.parentNode.insertBefore(panel, commentArea);
    }

    function openConfigPanel() {
        if (document.querySelector('.rd-ai-summary__modal')) return;
        const cfg = getConfig();

        const modal = document.createElement('div');
        modal.className = 'rd-ai-summary__modal';

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
        actions.className = 'rd-ai-summary__modal__actions';

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
    globalThis.__rdAiSummary = {
        extractPost,
        extractComments,
        buildInputText,
        buildMessages,
        parseCompletion,
        getConfig,
        setConfig,
        hasClass,
        countDepth,
    };
})();
