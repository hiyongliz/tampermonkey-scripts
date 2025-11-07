// ==UserScript==
// @name         Linuxdo 403错误对话框自动关闭
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  自动关闭Linuxdo首页的403错误对话框
// @author       YourName
// @match        https://linuxdo.com/*
// @match        https://*.linuxdo.com/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    // 检查是否存在403错误对话框
    function checkAndCloseDialog() {
        // 查找对话框容器
        const dialogContainer = document.querySelector('#dialog-holder[aria-labelledby="dialog-title"]');
        
        if (dialogContainer) {
            // 检查是否包含403错误文本
            const dialogText = dialogContainer.textContent || dialogContainer.innerText;
            if (dialogText.includes('403 error')) {
                console.log('发现403错误对话框，正在关闭...');
                
                // 查找确定按钮并点击
                const confirmButton = dialogContainer.querySelector('.btn-primary');
                if (confirmButton) {
                    confirmButton.click();
                    console.log('已点击确定按钮');
                    return true;
                }
            }
        }
        return false;
    }

    // 页面加载完成后检查
    function init() {
        // 立即检查一次
        if (checkAndCloseDialog()) {
            return;
        }

        // 如果立即检查没找到，等待DOM变化
        const observer = new MutationObserver((mutations) => {
            for (let mutation of mutations) {
                if (mutation.type === 'childList') {
                    if (checkAndCloseDialog()) {
                        observer.disconnect();
                        return;
                    }
                }
            }
        });

        // 观察整个文档的子节点变化
        observer.observe(document.body || document.documentElement, {
            childList: true,
            subtree: true
        });

        // 5秒后停止观察，避免无限观察
        setTimeout(() => {
            observer.disconnect();
        }, 5000);
    }

    // 等待页面加载完成
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
