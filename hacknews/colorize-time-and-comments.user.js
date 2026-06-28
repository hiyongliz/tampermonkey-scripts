// ==UserScript==
// @name         Hacker News 时间与评论数着色
// @namespace    https://tampermonkey.local
// @version      1.0
// @description  按"越新越红、评论越多越红"给 Hacker News 列表页的时间与评论数文字上色
// @match        https://news.ycombinator.com/*
// @icon         https://news.ycombinator.com/y18.svg
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    // 颜色端点：t=0 鲜红，t=1 默认灰
    const RED = [192, 57, 57];
    const GRAY = [130, 130, 130];

    // 阈值：0 小时为全红，48+ 小时为灰；0 评论为灰，300+ 评论为全红
    const HOURS_MAX = 48;
    const COMMENTS_MAX = 300;

    function lerp(a, b, t) {
        return Math.round(a + (b - a) * t);
    }

    function colorAt(t) {
        const c = [
            lerp(RED[0], GRAY[0], t),
            lerp(RED[1], GRAY[1], t),
            lerp(RED[2], GRAY[2], t)
        ];
        return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
    }

    function parseHours(text) {
        if (!text) return null;
        const s = text.trim().toLowerCase();
        let m = s.match(/^(\d+)\s+minute/);
        if (m) return parseInt(m[1], 10) / 60;
        m = s.match(/^(\d+)\s+hour/);
        if (m) return parseInt(m[1], 10);
        m = s.match(/^(\d+)\s+day/);
        if (m) return parseInt(m[1], 10) * 24;
        m = s.match(/^(\d+)\s+week/);
        if (m) return parseInt(m[1], 10) * 24 * 7;
        m = s.match(/^(\d+)\s+month/);
        if (m) return parseInt(m[1], 10) * 24 * 30;
        m = s.match(/^(\d+)\s+year/);
        if (m) return parseInt(m[1], 10) * 24 * 365;
        return null;
    }

    function parseCommentCount(text) {
        if (!text) return null;
        const s = text.replace(/\u00a0/g, ' ').trim().toLowerCase();
        if (s === 'discuss' || s === 'comments') return 0;
        const m = s.match(/^(\d+)\s+comment/);
        return m ? parseInt(m[1], 10) : null;
    }

    function clamp01(x) {
        return Math.max(0, Math.min(1, x));
    }

    function colorize() {
        const subtexts = document.querySelectorAll('td.subtext');
        for (const subtext of subtexts) {
            const ageLink = subtext.querySelector('span.age a');
            if (ageLink) {
                const hours = parseHours(ageLink.textContent);
                if (hours !== null) {
                    ageLink.style.color = colorAt(clamp01(hours / HOURS_MAX));
                }
            }

            const links = subtext.querySelectorAll('a');
            for (const link of links) {
                const count = parseCommentCount(link.textContent);
                if (count !== null) {
                    link.style.color = colorAt(clamp01(1 - count / COMMENTS_MAX));
                    break;
                }
            }
        }
    }

    colorize();
})();
