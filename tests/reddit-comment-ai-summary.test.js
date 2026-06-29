const fs = require('fs')
const vm = require('vm')
const assert = require('assert')

const scriptPath = '/Users/lazy/i/tampermonkey-scripts/reddit/comment-ai-summary.user.js'
const scriptSource = fs.readFileSync(scriptPath, 'utf8')

// 轻量元素 mock：支持 className、getAttribute、querySelector(All)、parentElement 链
function el(opts = {}) {
  const node = {
    tagName: (opts.tagName || 'div').toUpperCase(),
    textContent: opts.textContent ?? '',
    className: opts.className ?? '',
    _attrs: opts.attrs || {},
    _qs: opts.qs || {},
    _qsa: opts.qsa || {},
    parentElement: opts.parentElement ?? null,
    children: [],
    getAttribute(name) { return this._attrs[name] ?? null },
    setAttribute(name, value) { this._attrs[name] = value },
    querySelector(selector) { return this._qs[selector] ?? null },
    querySelectorAll(selector) { return this._qsa[selector] ?? [] },
    appendChild(child) { this.children.push(child); child.parentElement = this; return child },
    addEventListener() {},
  }
  return node
}

// 构造一条 reddit 评论 mock，可指定 parent 用于深度计算
function commentThing(opts) {
  const thing = el({
    tagName: 'div',
    className: ' thing id-t1_x noncollapsed comment ',
    attrs: opts.author !== undefined ? { 'data-author': opts.author } : {},
    parentElement: opts.parent || null,
  })
  // data-author 为 null 时模拟无作者属性
  if (opts.author === null) { thing._attrs = {} }

  const usertextBody = el({ tagName: 'div', className: 'usertext-body may-blank-within md-container ' })
  const md = el({ tagName: 'div', className: 'md', textContent: opts.text ?? '' })
  usertextBody._qs['div.md'] = md
  usertextBody._qs['div.usertext-body div.md'] = md
  thing._qs['div.usertext-body div.md'] = md

  // a.author fallback
  if (opts.author && opts.author !== '[匿名]') {
    const authorLink = el({ tagName: 'a', className: 'author', textContent: opts.author })
    thing._qs['a.author'] = authorLink
  }

  return thing
}

// 在 sandbox 里跑脚本，返回注入的 __rdAiSummary 与 GM 调用记录
function runScript(documentEnv, gmEnv = {}) {
  const gmValues = {}
  const menuCommands = []
  const gmCalls = []

  const noopNode = { appendChild() {} }
  const documentDefaults = {
    head: noopNode,
    body: noopNode,
    title: 'Reddit Page',
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => el({ tagName: 'div' }),
  }
  const document = { ...documentDefaults, ...documentEnv }

  const context = {
    console,
    document,
    GM_getValue: (k, d) => (k in gmValues ? gmValues[k] : d),
    GM_setValue: (k, v) => { gmValues[k] = v },
    GM_registerMenuCommand: (label, fn) => { menuCommands.push({ label, fn }) },
    GM_xmlhttpRequest: (opts) => { gmCalls.push(opts) },
    ...gmEnv,
  }
  context.globalThis = context

  vm.runInNewContext(scriptSource, context)
  return { api: context.__rdAiSummary, menuCommands, gmCalls, gmValues, context }
}

async function test(name, fn) {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    console.error(`FAIL ${name}`)
    console.error(error.stack)
    process.exitCode = 1
  }
}

// ---- 纯函数测试 ----

test('hasClass 处理多空格 class 列表', () => {
  const { api } = runScript({})
  assert.ok(api.hasClass(el({ className: ' thing id-t1_x comment ' }), 'thing'))
  assert.ok(api.hasClass(el({ className: ' thing id-t1_x comment ' }), 'comment'))
  assert.ok(!api.hasClass(el({ className: ' thing id-t1_x comment ' }), 'link'))
})

test('countDepth 沿 parentElement 链数 .child 祖先', () => {
  const { api } = runScript({})
  const child1 = el({ className: 'child' })
  const child2 = el({ className: 'child' })
  const target = el({ className: 'thing comment' })
  // target -> child2 -> child1 -> null
  target.parentElement = child2
  child2.parentElement = child1
  assert.equal(api.countDepth(target), 2)
  assert.equal(api.countDepth(el({})), 0)
})

test('extractPost 提取标题与 self post 正文', () => {
  const { api } = runScript({})
  const titleLink = el({ tagName: 'a', className: 'title may-blank', textContent: 'My Post Title' })
  const bodyMd = el({ tagName: 'div', className: 'md', textContent: 'This is the post body' })
  const usertextBody = el({ tagName: 'div', className: 'usertext-body' })
  usertextBody._qs['div.md'] = bodyMd

  const linkThing = el({ tagName: 'div', className: ' thing id-t3_x odd link ' })
  linkThing._qs['a.title'] = titleLink
  linkThing._qs['div.usertext-body div.md'] = bodyMd

  const root = el({ qsa: { 'div.thing': [linkThing] } })
  const post = api.extractPost(root)
  assert.equal(post.title, 'My Post Title')
  assert.equal(post.body, 'This is the post body')
})

test('extractPost 链接帖无正文时 body 为空', () => {
  const { api } = runScript({})
  const titleLink = el({ tagName: 'a', className: 'title', textContent: 'Link Post' })
  const linkThing = el({ tagName: 'div', className: ' thing id-t3_x link ' })
  linkThing._qs['a.title'] = titleLink
  linkThing._qs['div.usertext-body div.md'] = null

  const root = el({ qsa: { 'div.thing': [linkThing] } })
  const post = api.extractPost(root)
  assert.equal(post.title, 'Link Post')
  assert.equal(post.body, '')
})

test('extractComments 提取作者、深度、正文，跳过空文本', () => {
  const { api } = runScript({})

  // 构造嵌套结构：root > c1(depth0) > .child > c2(depth1)
  const childContainer = el({ className: 'child' })
  const c1 = commentThing({ author: 'alice', text: 'top level' })
  const c2 = commentThing({ author: 'bob', text: 'reply' })
  const c3 = commentThing({ author: null, text: '   ' }) // 空文本应跳过
  const c4 = commentThing({ author: null, text: 'no author attr' }) // 无作者属性也无 a.author

  // c2 嵌在 childContainer 下
  c2.parentElement = childContainer
  childContainer.parentElement = c1

  const root = el({ qsa: { 'div.thing.comment': [c1, c2, c3, c4] } })
  const comments = api.extractComments(root)
  assert.equal(comments.length, 3)
  assert.deepEqual(
    comments.map((c) => ({ user: c.user, depth: c.depth, text: c.text })),
    [
      { user: 'alice', depth: 0, text: 'top level' },
      { user: 'bob', depth: 1, text: 'reply' },
      { user: '[匿名]', depth: 0, text: 'no author attr' },
    ],
  )
})

test('buildInputText 含帖子正文与评论，单条超长截断', () => {
  const { api } = runScript({})
  const long = 'b'.repeat(1000)
  const post = { title: 'T', body: 'post body here' }
  const comments = [
    { user: 'u1', depth: 0, text: long },
    { user: 'u2', depth: 1, text: 'short reply' },
  ]
  const text = api.buildInputText(post, comments)
  assert.ok(text.includes('[帖子正文] post body here'))
  assert.ok(text.includes('b'.repeat(600) + '…'))
  assert.ok(!text.includes('b'.repeat(601)))
  assert.ok(text.includes('[u2] (depth=1) short reply'))
})

test('buildInputText 无帖子正文时只含评论', () => {
  const { api } = runScript({})
  const text = api.buildInputText({ title: 'T', body: '' }, [
    { user: 'u1', depth: 0, text: 'hi' },
  ])
  assert.ok(!text.includes('[帖子正文]'))
  assert.ok(text.includes('[u1] (depth=0) hi'))
})

test('buildMessages 包含标题、内容与中文要点要求', () => {
  const { api } = runScript({})
  const messages = api.buildMessages('Reddit Title', '[帖子正文] body\n[u1] (depth=0) nice')
  assert.equal(messages.length, 2)
  assert.equal(messages[0].role, 'system')
  assert.equal(messages[1].role, 'user')
  assert.ok(messages[0].content.includes('3-6'))
  assert.ok(messages[0].content.includes('Reddit'))
  assert.ok(messages[1].content.includes('Reddit Title'))
  assert.ok(messages[1].content.includes('[u1] (depth=0) nice'))
})

test('parseCompletion 解析正常响应', () => {
  const { api } = runScript({})
  const resp = JSON.stringify({ choices: [{ message: { content: '  summary  ' } }] })
  assert.equal(api.parseCompletion(resp), 'summary')
})

test('parseCompletion 缺少 content 时抛错', () => {
  const { api } = runScript({})
  assert.throws(() => api.parseCompletion(JSON.stringify({ choices: [{}] })), /message\.content/)
})

test('setConfig / getConfig 持久化往返', () => {
  const { api } = runScript({})
  api.setConfig({ baseURL: 'https://r/v1', apiKey: 'k', model: 'm' })
  assert.deepEqual(api.getConfig(), { baseURL: 'https://r/v1', apiKey: 'k', model: 'm' })
})

// ---- 端到端：注入面板并点击按钮 ----

function liveEl(opts = {}) {
  const node = el(opts)
  node.style = {}
  node.type = opts.type || ''
  node.value = opts.value ?? ''
  node.innerHTML = opts.innerHTML ?? ''
  node._listeners = {}
  node.addEventListener = (type, handler) => {
    node._listeners[type] = node._listeners[type] || []
    node._listeners[type].push(handler)
  }
  node.dispatchEvent = (type, event) => {
    for (const h of (node._listeners[type] || [])) h(event)
  }
  return node
}

test('注入面板并点击按钮触发 GM_xmlhttpRequest，请求体含标题正文与评论', () => {
  // 帖子区
  const titleLink = liveEl({ tagName: 'a', className: 'title', textContent: 'Reddit Story' })
  const bodyMd = liveEl({ tagName: 'div', className: 'md', textContent: 'Post body content' })
  const linkThing = liveEl({ tagName: 'div', className: ' thing id-t3_x link ' })
  linkThing._qs['a.title'] = titleLink
  linkThing._qs['div.usertext-body div.md'] = bodyMd

  // 评论
  const c1 = commentThing({ author: 'alice', text: 'great post' })
  const c2 = commentThing({ author: 'bob', text: 'I disagree' })

  const commentArea = liveEl({ tagName: 'div', className: 'commentarea' })
  commentArea.parentNode = { insertBefore() {} }

  const createdEls = []
  const documentEnv = {
    head: { appendChild() {} },
    body: { appendChild() {} },
    title: 'Reddit Page',
    querySelector(selector) {
      if (selector === 'div.commentarea') return commentArea
      if (selector === '.rd-ai-summary__modal') return null
      return null
    },
    querySelectorAll(selector) {
      if (selector === 'div.thing') return [linkThing]
      if (selector === 'div.thing.comment') return [c1, c2]
      return []
    },
    createElement: (tag) => {
      const node = liveEl({ tagName: tag })
      createdEls.push(node)
      return node
    },
  }

  const gmEnv = {
    GM_getValue: (k, d) => (k === 'apiKey' ? 'rd-key' : d),
    GM_setValue() {},
    GM_registerMenuCommand() {},
  }
  const { gmCalls } = runScript(documentEnv, gmEnv)

  const btn = createdEls.find((n) => n.tagName === 'BUTTON' && n.textContent === 'AI 总结帖子与评论')
  assert.ok(btn, '应注入总结按钮')
  btn.dispatchEvent('click', {})

  assert.equal(gmCalls.length, 1)
  const call = gmCalls[0]
  assert.equal(call.method, 'POST')
  assert.ok(call.url.endsWith('/chat/completions'))
  assert.equal(call.headers.Authorization, 'Bearer rd-key')
  const body = JSON.parse(call.data)
  assert.equal(body.stream, false)
  assert.equal(body.messages.length, 2)
  assert.ok(body.messages[1].content.includes('Reddit Story'))
  assert.ok(body.messages[1].content.includes('[帖子正文] Post body content'))
  assert.ok(body.messages[1].content.includes('[alice] (depth=0) great post'))
  assert.ok(body.messages[1].content.includes('[bob] (depth=0) I disagree'))
})

test('apiKey 为空时点击按钮显示错误提示且不发起请求', () => {
  const commentArea = liveEl({ tagName: 'div', className: 'commentarea' })
  commentArea.parentNode = { insertBefore() {} }

  const createdEls = []
  const documentEnv = {
    head: { appendChild() {} },
    body: { appendChild() {} },
    title: 'Reddit Page',
    querySelector(selector) {
      if (selector === 'div.commentarea') return commentArea
      if (selector === '.rd-ai-summary__modal') return null
      return null
    },
    querySelectorAll() { return [] },
    createElement: (tag) => {
      const node = liveEl({ tagName: tag })
      createdEls.push(node)
      return node
    },
  }

  const { gmCalls } = runScript(documentEnv, {
    GM_getValue: (k, d) => d,
    GM_setValue() {},
    GM_registerMenuCommand() {},
  })

  const btn = createdEls.find((n) => n.tagName === 'BUTTON' && n.textContent.includes('AI 总结'))
  btn.dispatchEvent('click', {})
  assert.equal(gmCalls.length, 0, '无 apiKey 时不应发起请求')
})

test('注册了配置菜单命令', () => {
  const commentArea = liveEl({ tagName: 'div', className: 'commentarea' })
  commentArea.parentNode = { insertBefore() {} }
  const documentEnv = {
    head: { appendChild() {} },
    body: { appendChild() {} },
    querySelector: () => commentArea,
    querySelectorAll: () => [],
    createElement: () => liveEl({ tagName: 'div' }),
  }
  const { menuCommands } = runScript(documentEnv, {
    GM_getValue: () => null,
    GM_setValue() {},
  })
  assert.ok(menuCommands.some((c) => c.label.includes('配置 AI 总结')))
})

// ---- markdown 渲染 ----

function setupPanelEnv({ apiKey, markedMock } = {}) {
  // 帖子区
  const titleLink = liveEl({ tagName: 'a', className: 'title', textContent: 'Reddit Story' })
  const bodyMd = liveEl({ tagName: 'div', className: 'md', textContent: 'Post body' })
  const linkThing = liveEl({ tagName: 'div', className: ' thing id-t3_x link ' })
  linkThing._qs['a.title'] = titleLink
  linkThing._qs['div.usertext-body div.md'] = bodyMd

  const c1 = commentThing({ author: 'alice', text: 'great post' })

  const commentArea = liveEl({ tagName: 'div', className: 'commentarea' })
  commentArea.parentNode = { insertBefore() {} }

  const createdEls = []
  const documentEnv = {
    head: { appendChild() {} },
    body: { appendChild() {} },
    title: 'Reddit Page',
    querySelector(selector) {
      if (selector === 'div.commentarea') return commentArea
      if (selector === '.rd-ai-summary__modal') return null
      return null
    },
    querySelectorAll(selector) {
      if (selector === 'div.thing') return [linkThing]
      if (selector === 'div.thing.comment') return [c1]
      return []
    },
    createElement: (tag) => {
      const node = liveEl({ tagName: tag })
      createdEls.push(node)
      return node
    },
  }
  let onloadRef = null
  const gmEnv = {
    GM_getValue: (k, d) => (k === 'apiKey' ? apiKey : d),
    GM_setValue() {},
    GM_registerMenuCommand() {},
    GM_xmlhttpRequest: (opts) => { onloadRef = opts.onload },
  }
  if (markedMock !== undefined) gmEnv.marked = markedMock
  runScript(documentEnv, gmEnv)
  const btn = createdEls.find((n) => n.tagName === 'BUTTON' && n.textContent.includes('AI 总结'))
  const result = createdEls.find((n) => n.className && n.className.includes('rd-ai-summary__result'))
  return { btn, result, getOnload: () => onloadRef }
}

test('成功响应时用 marked 渲染 markdown 到 innerHTML', async () => {
  const { btn, result, getOnload } = setupPanelEnv({
    apiKey: 'k',
    markedMock: { parse: (s) => `<p>RENDERED:${s}</p>` },
  })
  btn.dispatchEvent('click', {})
  const onload = getOnload()
  assert.ok(onload, '应注册 onload')
  onload({ status: 200, responseText: JSON.stringify({ choices: [{ message: { content: '**bold**' } }] }) })
  await Promise.resolve()
  assert.ok(result.innerHTML.includes('RENDERED:**bold**'), '应渲染 markdown')
  assert.equal(result.className.includes('rd-ai-summary__result--error'), false)
  assert.equal(result.className.includes('rd-ai-summary__result--loading'), false)
})

test('marked 未加载时成功结果回退纯文本', async () => {
  const { btn, result, getOnload } = setupPanelEnv({ apiKey: 'k', markedMock: undefined })
  btn.dispatchEvent('click', {})
  getOnload()({ status: 200, responseText: JSON.stringify({ choices: [{ message: { content: '**bold**' } }] }) })
  await Promise.resolve()
  assert.equal(result.innerHTML, '')
  assert.ok(result.textContent.includes('**bold**'), '应回退原文')
})

test('loading 与 error 状态用 textContent 不调用 marked', () => {
  let parseCalled = false
  const { btn, result } = setupPanelEnv({
    apiKey: 'k',
    markedMock: { parse: () => { parseCalled = true; return '<p>x</p>' } },
  })
  btn.dispatchEvent('click', {})
  assert.ok(result.textContent.includes('总结中'))
  assert.equal(parseCalled, false, 'loading 不应调用 marked')
})
