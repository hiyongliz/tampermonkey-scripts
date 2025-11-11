// ==UserScript==
// @name         隐藏即刻web版打开按钮、品牌div、特定style的a标签和wrap div
// @namespace    http://tampermonkey.net/
// @version      1.4
// @description  隐藏即刻网页版中的"在web版打开"按钮、品牌div、特定style的a标签和wrap div
// @author       YourName
// @match        https://*.okjike.com/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

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
                element.remove(); // 完全移除元素
            }
        });

        // 2. 隐藏class中包含"wrap"的div标签
        const wrapDivs = document.querySelectorAll('div[class*="jsx-994028474 wrap"]');
        wrapDivs.forEach(element => {
            element.style.display = 'none';
            element.remove(); // 完全移除元素
        });
    }

    // 页面加载完成后执行
    function init() {
        hideTargetElements();

        // 使用MutationObserver监控DOM变化，隐藏动态添加的元素
        const observer = new MutationObserver(function(mutations) {
            mutations.forEach(function(mutation) {
                if (mutation.type === 'childList') {
                    // 检查是否有新的节点被添加
                    mutation.addedNodes.forEach(function(node) {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            // 检查新添加的节点是否包含目标文本或类
                            let shouldCheckNode = false;
                            if (node.textContent) {
                                if (node.textContent.includes('在web版打开') ||
                                    node.textContent.includes('即刻App') ||
                                    node.textContent.includes('年轻人的同好社区') ||
                                    node.textContent.includes('下载')) {
                                    shouldCheckNode = true;
                                }
                            }

                            // 检查新添加的节点是否具有目标style属性
                            if (node.tagName === 'A' && node.getAttribute('style')) {
                                const styleAttr = node.getAttribute('style');
                                if (styleAttr &&
                                    styleAttr.includes('opacity:1') &&
                                    styleAttr.includes('pointer-events:auto')) {
                                    shouldCheckNode = true;
                                }
                            }

                            // 检查新添加的节点是否是包含wrap的div
                            if (node.tagName === 'DIV' && node.className &&
                                node.className.includes && node.className.includes('wrap')) {
                                shouldCheckNode = true;
                            }

                            if (shouldCheckNode) {
                                hideTargetElements(); // 重新检查所有元素
                            }

                            // 检查新添加的节点是否包含目标元素作为子元素
                            const childElements = node.querySelectorAll && node.querySelectorAll('*');
                            if (childElements) {
                                Array.from(childElements).forEach(child => {
                                    if (child.textContent && (
                                        child.textContent.includes('在web版打开') ||
                                        child.textContent.includes('即刻App') ||
                                        child.textContent.includes('年轻人的同好社区') ||
                                        child.textContent.includes('下载')
                                    )) {
                                        hideTargetElements(); // 重新检查所有元素
                                    }

                                    // 检查子元素是否具有目标style属性
                                    if (child.tagName === 'A' && child.getAttribute('style')) {
                                        const styleAttr = child.getAttribute('style');
                                        if (styleAttr &&
                                            styleAttr.includes('opacity:1') &&
                                            styleAttr.includes('pointer-events:auto')) {
                                            hideTargetElements(); // 重新检查所有元素
                                        }
                                    }

                                    // 检查子元素是否是包含wrap的div
                                    if (child.tagName === 'DIV' && child.className &&
                                        child.className.includes && child.className.includes('wrap')) {
                                        hideTargetElements(); // 重新检查所有元素
                                    }
                                });
                            }
                        }
                    });
                }
            });
        });

        // 开始监控DOM变化
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    // 等待页面加载完成
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
