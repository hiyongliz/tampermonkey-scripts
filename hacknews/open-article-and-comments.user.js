// ==UserScript==
// @name         Hacker News 文章与评论双开
// @namespace    https://tampermonkey.local
// @version      1.0
// @description  在 Hacker News 列表页点击文章标题时阻止当前页跳转，并在新标签页打开文章和评论
// @match        https://news.ycombinator.com/*
// @grant        GM_openInTab
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    function isPlainLeftClick(event) {
        return event.button === 0
            && !event.defaultPrevented
            && !event.metaKey
            && !event.ctrlKey
            && !event.shiftKey
            && !event.altKey;
    }

    function getStoryLink(target) {
        if (!(target instanceof Element)) {
            return null;
        }

        const link = target.closest('a');
        if (!(link instanceof HTMLAnchorElement)) {
            return null;
        }

        const titleLine = link.closest('span.titleline');
        if (!(titleLine instanceof HTMLSpanElement)) {
            return null;
        }

        const storyRow = titleLine.closest('tr.athing');
        if (!(storyRow instanceof HTMLTableRowElement)) {
            return null;
        }

        return link;
    }

    function getCommentsLink(storyLink) {
        const storyRow = storyLink.closest('tr.athing');
        if (!(storyRow instanceof HTMLTableRowElement)) {
            return null;
        }

        const subtextRow = storyRow.nextElementSibling;
        if (!(subtextRow instanceof HTMLTableRowElement)) {
            return null;
        }

        const subtext = subtextRow.querySelector('td.subtext');
        if (!(subtext instanceof HTMLTableCellElement)) {
            return null;
        }

        const links = subtext.querySelectorAll('a');
        for (const link of links) {
            if (!(link instanceof HTMLAnchorElement)) {
                continue;
            }

            const text = link.textContent ? link.textContent.trim().toLowerCase() : '';
            if (text.includes('comment') || text === 'discuss') {
                return link;
            }
        }

        return null;
    }

    function openInNewTab(url) {
        return GM_openInTab(url, { active: false, insert: true })
    }

    function handleClick(event) {
        if (!isPlainLeftClick(event)) {
            return;
        }

        if (!(event.target instanceof Element)) {
            return;
        }

        const storyLink = getStoryLink(event.target);
        if (!storyLink) {
            return;
        }

        const commentsLink = getCommentsLink(storyLink);

        event.preventDefault();
        openInNewTab(storyLink.href);

        if (commentsLink && commentsLink.href !== storyLink.href) {
            openInNewTab(commentsLink.href);
        }
    }

    document.addEventListener('click', handleClick, true);
})();
