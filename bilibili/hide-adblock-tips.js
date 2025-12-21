// ==UserScript==
// @name         Bilibili隐藏广告屏蔽提示
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  隐藏bilibili页面中的广告屏蔽提示信息
// @author       YourName
// @match        https://www.bilibili.com/*
// @match        https://space.bilibili.com/*
// @match        https://live.bilibili.com/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    // 隐藏提示div的函数
    function hideAdblockTips() {
        // 通过class选择器找到提示div
        const tipsDiv = document.querySelector('.adblock-tips');
        if (tipsDiv) {
            tipsDiv.style.display = 'none';
            console.log('已隐藏广告屏蔽提示div');
        }
    }

    // 页面加载完成后隐藏
    document.addEventListener('DOMContentLoaded', hideAdblockTips);

    // 监听DOM变化，隐藏动态加载的提示div
    const observer = new MutationObserver(function (mutations) {
        mutations.forEach(function (mutation) {
            if (mutation.type === 'childList') {
                mutation.addedNodes.forEach(function (node) {
                    if (node.nodeType === 1) { // 元素节点
                        // 检查新添加的节点是否是目标div
                        if (node.classList && node.classList.contains('adblock-tips')) {
                            node.style.display = 'none';
                        }
                        // 检查新添加的节点是否包含目标div子元素
                        const tipsInNode = node.querySelector && node.querySelector('.adblock-tips');
                        if (tipsInNode) {
                            tipsInNode.style.display = 'none';
                        }
                    }
                });
            }
        });
    });

    // 开始监听DOM变化
    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

    // 立即执行一次，隐藏可能已经存在的元素
    hideAdblockTips();

    // 定期检查并隐藏（作为备用方案）
    setInterval(hideAdblockTips, 1000);

    console.log('Bilibili广告屏蔽提示隐藏脚本已启动');
})();