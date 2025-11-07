// ==UserScript==
// @name         ChatGPT 自动填充 hello
// @namespace    https://tampermonkey.local
// @version      0.1
// @description  在 chatgpt.com 打开页面时自动在输入框输入 "hello"
// @match        https://chatgpt.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function() {
  'use strict';

  // 只针对实际可编辑的 ProseMirror 输入框：
  // <div contenteditable="true" class="ProseMirror" id="prompt-textarea" ...>
  const pmSelector = 'div#prompt-textarea.ProseMirror[contenteditable="true"]';
  let userInteracted = false;
  const stopAt = Date.now() + 30000; // 最长干预 30 秒
  let intervalId = null;

  function getPMDiv() {
    return document.querySelector(pmSelector);
  }

  function ensureHello() {
    if (userInteracted || Date.now() > stopAt) return;
    const pmDiv = getPMDiv();
    if (!pmDiv) return;
    const text = (pmDiv.textContent || '').trim();
    // 用户已输入其他内容则停止
    if (text.length > 0 && text !== 'Before answering, work through this step-by-step: 1. UNDERSTAND: What is the core question being asked? 2. ANALYZE: What are the key factors/components involved? 3. REASON: What logical connections can I make? 4. SYNTHESIZE: How do these elements combine? 5. CONCLUDE: What is the most accurate/helpful response? Now answer: ') {
      userInteracted = true;
      return;
    }
    // 空或占位内容时写入 hello
    if (text.length === 0 || pmDiv.querySelector('p.placeholder')) {
      try { pmDiv.focus(); } catch(_) {}
      pmDiv.innerHTML = '<p>Before answering, work through this step-by-step: 1. UNDERSTAND: What is the core question being asked? 2. ANALYZE: What are the key factors/components involved? 3. REASON: What logical connections can I make? 4. SYNTHESIZE: How do these elements combine? 5. CONCLUDE: What is the most accurate/helpful response? Now answer: </p>';
      // 光标置于末尾
      try {
        const range = document.createRange();
        range.selectNodeContents(pmDiv);
        range.collapse(false);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      } catch(_) {}
      pmDiv.dispatchEvent(new Event('input', { bubbles: true }));
      pmDiv.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  ensureHello();

  const observer = new MutationObserver(() => ensureHello());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  intervalId = setInterval(ensureHello, 500);
  setTimeout(() => {
    observer.disconnect();
    clearInterval(intervalId);
  }, 30000);
})();
