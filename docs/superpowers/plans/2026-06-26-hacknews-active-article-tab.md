# Hacker News Active Article Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Hacker News 标题点击后文章页前台打开、评论页后台打开。

**Architecture:** 保留现有 Tampermonkey 点击监听和 DOM 查找结构，只调整 `GM_openInTab` 的 `active` 参数。测试继续使用 Node `vm` 执行 userscript 并检查 `GM_openInTab` 调用。

**Tech Stack:** JavaScript userscript, Node.js `assert`, Node.js `vm`。

---

### Task 1: 锁定标签激活行为

**Files:**
- Modify: `tests/hacknews-userscript.test.js`
- Modify: `hacknews/open-article-and-comments.user.js`

- [ ] **Step 1: 写失败测试**

在 `tests/hacknews-userscript.test.js` 中断言第一次 `GM_openInTab` 调用为 `{ active: true, insert: true }`，第二次为 `{ active: false, insert: true }`。

- [ ] **Step 2: 运行测试确认失败**

Run: `node tests/hacknews-userscript.test.js`
Expected: FAIL，因为当前文章标签仍以 `active: false` 打开。

- [ ] **Step 3: 写最小实现**

修改 `hacknews/open-article-and-comments.user.js`，让文章链接调用 `openInNewTab(storyLink.href, true)`，评论链接调用 `openInNewTab(commentsLink.href, false)`。

- [ ] **Step 4: 运行测试确认通过**

Run: `node tests/hacknews-userscript.test.js`
Expected: PASS，所有测试通过。

### Task 2: 项目规则文件

**Files:**
- Create: `AGENTS.md`

- [ ] **Step 1: 写入用户提供的项目协作规则**

创建 `AGENTS.md`，记录用户提供的 12 条规则。
