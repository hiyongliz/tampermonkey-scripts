// ==UserScript==
// @name         Hacker News 快捷键翻页
// @namespace    https://tampermonkey.local
// @version      1.1
// @description  在 Hacker News 列表页按右方向键或 J 加载下一页，左方向键或 K 返回上一页
// @match        https://news.ycombinator.com/*
// @icon         https://news.ycombinator.com/y18.svg
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    function isEditable(target) {
        if (!(target instanceof Element)) {
            return false;
        }
        const tag = target.tagName;
        return tag === 'INPUT'
            || tag === 'TEXTAREA'
            || tag === 'SELECT'
            || target.isContentEditable;
    }

    function getMoreLink() {
        const link = document.querySelector('a.morelink');
        return link instanceof HTMLAnchorElement ? link : null;
    }

    function goNext() {
        const moreLink = getMoreLink();
        if (!moreLink) {
            return;
        }
        location.assign(moreLink.href);
    }

    function goPrev() {
        if (history.length > 1) {
            history.back();
        }
    }

    document.addEventListener('keydown', function (event) {
        if (event.defaultPrevented) {
            return;
        }
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
            return;
        }
        if (isEditable(event.target)) {
            return;
        }

        const key = event.key;
        if (key === 'ArrowRight' || key === 'j' || key === 'J') {
            event.preventDefault();
            goNext();
        } else if (key === 'ArrowLeft' || key === 'k' || key === 'K') {
            event.preventDefault();
            goPrev();
        }
    });
})();
