# Hacker News 文章前台打开设计

目标：优化 `hacknews/open-article-and-comments.user.js` 的点击行为，让文章页前台打开，评论页后台打开。

范围：只处理当前脚本已经拦截的 Hacker News 标题普通左键点击，不扩展页面识别、配置项或其它交互。

设计：保留现有点击监听、标题链接识别和评论链接查找流程。拦截点击后，调用 `GM_openInTab` 打开文章链接时传入 `{ active: true, insert: true }`；打开评论链接时传入 `{ active: false, insert: true }`。找不到评论链接时只打开文章。修饰键点击、非左键点击和非标题点击继续按浏览器默认行为处理。

验证：更新现有 Node `vm` 测试，断言文章标签参数为 `active: true`，评论标签参数为 `active: false`。
