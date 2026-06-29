const fs = require('fs')
const vm = require('vm')
const assert = require('assert')

const scriptPath = '/Users/lazy/i/tampermonkey-scripts/hacknews/comment-ai-summary.user.js'
const scriptSource = fs.readFileSync(scriptPath, 'utf8')

// 轻量元素 mock：仅支持纯函数测试需要的子集
function el(opts = {}) {
  const node = {
    tagName: (opts.tagName || 'div').toUpperCase(),
    textContent: opts.textContent ?? '',
    className: opts.className ?? '',
    _attrs: opts.attrs || {},
    _qs: opts.qs || {},          // selector -> element
    _qsa: opts.qsa || {},        // selector -> element[]
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

// 构造一条 HN 评论行 mock
function commentRow(user, text, indent) {
  const row = el({ tagName: 'tr', attrs: indent !== undefined ? {} : {} })
  row._qs['.hnuser'] = user ? el({ tagName: 'a', textContent: user }) : null
  row._qs['.commtext'] = text !== null ? el({ tagName: 'div', textContent: text }) : null
  row._qs['td.ind'] = indent !== undefined ? el({ tagName: 'td', attrs: { indent: String(indent) } }) : null
  return row
}

// 在 sandbox 里跑脚本，返回注入的 __hnAiSummary 与 GM 调用记录
function runScript(documentEnv, gmEnv = {}) {
  const gmValues = {}
  const menuCommands = []
  const gmCalls = []

  // 提供脚本初始化所需的最小 document 能力，避免纯函数测试也需完整 mock
  const noopNode = { appendChild() {} }
  const documentDefaults = {
    head: noopNode,
    body: noopNode,
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
  return { api: context.__hnAiSummary, menuCommands, gmCalls, gmValues, context }
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

test('extractComments 提取作者、层级、正文，跳过空文本', () => {
  const root = el({
    qsa: {
      'tr.athing.comtr': [
        commentRow('alice', 'great point', 0),
        commentRow('bob', '   ', 1),          // 空文本应跳过
        commentRow(null, 'deleted content', 2), // 无作者
        commentRow('carol', 'nested reply', 3),
      ],
    },
  })
  const { api } = runScript({ querySelector: () => null, querySelectorAll: () => [] })

  const comments = api.extractComments(root)
  assert.equal(comments.length, 3)
  assert.deepEqual(
    comments.map((c) => ({ user: c.user, depth: c.depth, text: c.text })),
    [
      { user: 'alice', depth: 0, text: 'great point' },
      { user: '[匿名]', depth: 2, text: 'deleted content' },
      { user: 'carol', depth: 3, text: 'nested reply' },
    ],
  )
})

test('buildInputText 单条超长截断并按总量截断', () => {
  const { api } = runScript({ querySelector: () => null, querySelectorAll: () => [] })
  const long = 'a'.repeat(1000)
  const comments = [
    { user: 'u1', depth: 0, text: long },
    { user: 'u2', depth: 1, text: 'short' },
  ]
  const text = api.buildInputText(comments)
  // 单条截断到 600 + '…'
  assert.ok(text.includes('a'.repeat(600) + '…'))
  assert.ok(!text.includes('a'.repeat(601)))
})

test('buildMessages 包含标题、评论文本与中文要点要求', () => {
  const { api } = runScript({ querySelector: () => null, querySelectorAll: () => [] })
  const messages = api.buildMessages('Hello World', '[alice] (depth=0) nice')
  assert.equal(messages.length, 2)
  assert.equal(messages[0].role, 'system')
  assert.equal(messages[1].role, 'user')
  assert.ok(messages[0].content.includes('3-6'))
  assert.ok(messages[1].content.includes('Hello World'))
  assert.ok(messages[1].content.includes('[alice] (depth=0) nice'))
})

test('parseCompletion 解析正常响应', () => {
  const { api } = runScript({ querySelector: () => null, querySelectorAll: () => [] })
  const resp = JSON.stringify({
    choices: [{ message: { content: '  summary here  ' } }],
  })
  assert.equal(api.parseCompletion(resp), 'summary here')
})

test('parseCompletion 缺少 content 时抛错', () => {
  const { api } = runScript({ querySelector: () => null, querySelectorAll: () => [] })
  assert.throws(() => api.parseCompletion(JSON.stringify({ choices: [{}] })), /message\.content/)
})

test('setConfig / getConfig 持久化往返', () => {
  const { api } = runScript({ querySelector: () => null, querySelectorAll: () => [] })
  api.setConfig({ baseURL: 'https://x/v1', apiKey: 'k', model: 'm' })
  assert.deepEqual(api.getConfig(), { baseURL: 'https://x/v1', apiKey: 'k', model: 'm' })
})

// ---- 端到端：注入面板并点击按钮 ----

// 构造可触发事件的真实元素 mock（支持 addEventListener 回放）
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

test('注入面板并点击按钮触发 GM_xmlhttpRequest，请求体含评论与标题', () => {
  const titleLink = liveEl({ tagName: 'a', textContent: 'My Story' })
  const fatItemQs = { 'table.fatitem span.titleline > a': titleLink }
  const commentTree = liveEl({ tagName: 'table' })
  commentTree.parentNode = { insertBefore() {} }

  const createdEls = []
  const documentEnv = {
    head: { appendChild() {} },
    body: { appendChild() {} },
    querySelector(selector) {
      if (selector === 'table.comment-tree') return commentTree
      if (selector === 'table.fatitem span.titleline > a') return titleLink
      if (selector === '.hn-ai-summary__modal') return null
      return null
    },
    querySelectorAll(selector) {
      if (selector === 'tr.athing.comtr') {
        return [commentRow('alice', 'first post', 0), commentRow('bob', 'second', 1)]
      }
      return []
    },
    createElement: (tag) => {
      const node = liveEl({ tagName: tag })
      createdEls.push(node)
      return node
    },
  }

  // 预填 apiKey，避免走配置面板分支
  const gmEnv = {
    GM_getValue: (k, d) => (k === 'apiKey' ? 'secret-key' : d),
    GM_setValue() {},
    GM_registerMenuCommand() {},
  }
  const { gmCalls } = runScript(documentEnv, gmEnv)

  // 找到注入面板里的按钮（createdEls 里 type=button 且文本为"AI 总结评论"）
  const btn = createdEls.find((n) => n.tagName === 'BUTTON' && n.textContent === 'AI 总结评论')
  assert.ok(btn, '应注入总结按钮')
  btn.dispatchEvent('click', {})

  assert.equal(gmCalls.length, 1)
  const call = gmCalls[0]
  assert.equal(call.method, 'POST')
  assert.ok(call.url.endsWith('/chat/completions'))
  assert.equal(call.headers.Authorization, 'Bearer secret-key')
  const body = JSON.parse(call.data)
  assert.equal(body.stream, false)
  assert.equal(body.messages.length, 2)
  assert.ok(body.messages[1].content.includes('My Story'))
  assert.ok(body.messages[1].content.includes('[alice] (depth=0) first post'))
  assert.ok(body.messages[1].content.includes('[bob] (depth=1) second'))
})

test('apiKey 为空时点击按钮显示错误提示', () => {
  const commentTree = liveEl({ tagName: 'table' })
  commentTree.parentNode = { insertBefore() {} }

  const createdEls = []
  const documentEnv = {
    head: { appendChild() {} },
    body: { appendChild() {} },
    querySelector(selector) {
      if (selector === 'table.comment-tree') return commentTree
      if (selector === '.hn-ai-summary__modal') return null
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

  const btn = createdEls.find((n) => n.tagName === 'BUTTON' && n.textContent === 'AI 总结评论')
  btn.dispatchEvent('click', {})
  assert.equal(gmCalls.length, 0, '无 apiKey 时不应发起请求')
})

// ---- markdown 渲染 ----

function setupPanelEnv({ apiKey, markedMock } = {}) {
  const commentTree = liveEl({ tagName: 'table' })
  commentTree.parentNode = { insertBefore() {} }
  const createdEls = []
  const documentEnv = {
    head: { appendChild() {} },
    body: { appendChild() {} },
    querySelector(selector) {
      if (selector === 'table.comment-tree') return commentTree
      if (selector === '.hn-ai-summary__modal') return null
      return null
    },
    querySelectorAll(selector) {
      if (selector === 'tr.athing.comtr') return [commentRow('alice', 'first', 0)]
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
  const btn = createdEls.find((n) => n.tagName === 'BUTTON' && n.textContent === 'AI 总结评论')
  const result = createdEls.find((n) => n.className && n.className.includes('hn-ai-summary__result'))
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
  await Promise.resolve() // 等待 Promise .then 微任务
  assert.ok(result.innerHTML.includes('RENDERED:**bold**'), '应渲染 markdown')
  assert.equal(result.className.includes('hn-ai-summary__result--error'), false)
  assert.equal(result.className.includes('hn-ai-summary__result--loading'), false)
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
  // 点击后立即检查 loading（Promise 未 resolve 前）
  btn.dispatchEvent('click', {})
  assert.ok(result.textContent.includes('总结中'))
  assert.equal(parseCalled, false, 'loading 不应调用 marked')
})
