// ==UserScript==
// @name         隐藏即刻web版打开按钮、品牌div、特定style的a标签和wrap div
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  隐藏即刻网页版中的"在web版打开"按钮等元素，检测到"在web版打开"字样时自动刷新页面
// @author       YourName
// @match        https://*.okjike.com/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    const MAX_RETRIES = 5;
    const STORAGE_KEY = 'ojike_reload_count';

    function getReloadCount() {
        return parseInt(sessionStorage.getItem(STORAGE_KEY) || '0', 10);
    }

    function reloadPage() {
        const count = getReloadCount();
        if (count >= MAX_RETRIES) return false;
        sessionStorage.setItem(STORAGE_KEY, String(count + 1));
        location.reload();
        return true;
    }

    function resetReloadCount() {
        sessionStorage.removeItem(STORAGE_KEY);
    }

    function hasTargetText() {
        return document.body && document.body.textContent.includes('在web版打开');
    }

    // 隐藏指定元素的函数
    function hideTargetElements() {
        // 1. 隐藏具有 style="opacity:1;pointer-events:auto" 的a标签
        const styleTags = document.querySelectorAll('a[style]');
        styleTags.forEach(element => {
            const styleAttr = element.getAttribute('style');
            if (styleAttr &&
                styleAttr.includes('opacity:1') &&
                styleAttr.includes('pointer-events:auto')) {
                element.style.display = 'none';
                element.remove();
            }
        });

        // 2. 隐藏class中包含"wrap"的div标签
        const wrapDivs = document.querySelectorAll('div[class*="jsx-994028474 wrap"]');
        wrapDivs.forEach(element => {
            element.style.display = 'none';
            element.remove();
        });
    }

    function init() {
        // 检测到"在web版打开"则刷新页面
        if (hasTargetText()) {
            if (reloadPage()) return;
        }

        // 页面正常加载，重置计数
        resetReloadCount();

        // 隐藏目标元素
        hideTargetElements();

        // 使用MutationObserver监控DOM变化
        const observer = new MutationObserver(function(mutations) {
            // 检测到"在web版打开"则刷新
            if (hasTargetText()) {
                observer.disconnect();
                if (reloadPage()) return;
            }

            mutations.forEach(function(mutation) {
                if (mutation.type === 'childList') {
                    mutation.addedNodes.forEach(function(node) {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            let shouldCheckNode = false;
                            if (node.textContent) {
                                if (node.textContent.includes('在web版打开') ||
                                    node.textContent.includes('即刻App') ||
                                    node.textContent.includes('年轻人的同好社区') ||
                                    node.textContent.includes('下载')) {
                                    shouldCheckNode = true;
                                }
                            }

                            if (node.tagName === 'A' && node.getAttribute('style')) {
                                const styleAttr = node.getAttribute('style');
                                if (styleAttr &&
                                    styleAttr.includes('opacity:1') &&
                                    styleAttr.includes('pointer-events:auto')) {
                                    shouldCheckNode = true;
                                }
                            }

                            if (node.tagName === 'DIV' && node.className &&
                                node.className.includes && node.className.includes('wrap')) {
                                shouldCheckNode = true;
                            }

                            if (shouldCheckNode) {
                                hideTargetElements();
                            }

                            const childElements = node.querySelectorAll && node.querySelectorAll('*');
                            if (childElements) {
                                Array.from(childElements).forEach(child => {
                                    if (child.textContent && (
                                        child.textContent.includes('在web版打开') ||
                                        child.textContent.includes('即刻App') ||
                                        child.textContent.includes('年轻人的同好社区') ||
                                        child.textContent.includes('下载')
                                    )) {
                                        hideTargetElements();
                                    }

                                    if (child.tagName === 'A' && child.getAttribute('style')) {
                                        const styleAttr = child.getAttribute('style');
                                        if (styleAttr &&
                                            styleAttr.includes('opacity:1') &&
                                            styleAttr.includes('pointer-events:auto')) {
                                            hideTargetElements();
                                        }
                                    }

                                    if (child.tagName === 'DIV' && child.className &&
                                        child.className.includes && child.className.includes('wrap')) {
                                        hideTargetElements();
                                    }
                                });
                            }
                        }
                    });
                }
            });
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
