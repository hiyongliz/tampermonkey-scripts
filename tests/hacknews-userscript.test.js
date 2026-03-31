const fs = require('fs')
const vm = require('vm')
const assert = require('assert')

const scriptSource = fs.readFileSync('/Users/lazy/i/tampermonkey-scripts/hacknews/open-article-and-comments.user.js', 'utf8')

function makeElement(tagName, options = {}) {
  const element = {
    tagName: tagName.toUpperCase(),
    textContent: options.textContent ?? '',
    href: options.href,
    parentElement: null,
    children: [],
    nextElementSibling: null,
    _closestMap: new Map(),
    _querySelectorMap: new Map(),
    _querySelectorAllMap: new Map(),
    closest(selector) {
      return this._closestMap.get(selector) ?? null
    },
    querySelector(selector) {
      return this._querySelectorMap.get(selector) ?? null
    },
    querySelectorAll(selector) {
      return this._querySelectorAllMap.get(selector) ?? []
    },
  }

  Object.defineProperty(element, Symbol.toStringTag, {
    value: options.symbolName ?? `HTML${tagName[0].toUpperCase()}${tagName.slice(1).toLowerCase()}Element`,
  })

  return element
}

function link(href, textContent) {
  return makeElement('a', { href, textContent, symbolName: 'HTMLAnchorElement' })
}

function span() {
  return makeElement('span', { symbolName: 'HTMLSpanElement' })
}

function row() {
  return makeElement('tr', { symbolName: 'HTMLTableRowElement' })
}

function cell() {
  return makeElement('td', { symbolName: 'HTMLTableCellElement' })
}

function runUserscript({ storyHref, commentsHref, commentsText }) {
  const openCalls = []
  let clickHandler = null
  const gmCalls = []

  const titleLine = span()
  const storyRow = row()
  const subtextRow = row()
  const subtext = cell()
  const storyLink = link(storyHref, 'story')
  const commentsLink = link(commentsHref, commentsText)

  storyLink._closestMap.set('a', storyLink)
  storyLink._closestMap.set('span.titleline', titleLine)
  storyLink._closestMap.set('tr.athing', storyRow)
  titleLine._closestMap.set('tr.athing', storyRow)

  subtext._querySelectorAllMap.set('a', [commentsLink])
  subtextRow._querySelectorMap.set('td.subtext', subtext)
  storyRow.nextElementSibling = subtextRow

  const context = {
    window: {
      open(url, target, features) {
        openCalls.push({ url, target, features })
        return { url }
      },
    },
    document: {
      addEventListener(type, handler) {
        if (type === 'click') {
          clickHandler = handler
        }
      },
    },
    console,
    GM_openInTab(url, options) {
      gmCalls.push({ url, options })
      return { url, options }
    },
    Element: function Element() {},
    HTMLAnchorElement: function HTMLAnchorElement() {},
    HTMLSpanElement: function HTMLSpanElement() {},
    HTMLTableRowElement: function HTMLTableRowElement() {},
    HTMLTableCellElement: function HTMLTableCellElement() {},
  }

  Object.setPrototypeOf(storyLink, context.HTMLAnchorElement.prototype)
  Object.setPrototypeOf(commentsLink, context.HTMLAnchorElement.prototype)
  Object.setPrototypeOf(titleLine, context.HTMLSpanElement.prototype)
  Object.setPrototypeOf(storyRow, context.HTMLTableRowElement.prototype)
  Object.setPrototypeOf(subtextRow, context.HTMLTableRowElement.prototype)
  Object.setPrototypeOf(subtext, context.HTMLTableCellElement.prototype)

  Object.setPrototypeOf(context.HTMLAnchorElement.prototype, context.Element.prototype)
  Object.setPrototypeOf(context.HTMLSpanElement.prototype, context.Element.prototype)
  Object.setPrototypeOf(context.HTMLTableRowElement.prototype, context.Element.prototype)
  Object.setPrototypeOf(context.HTMLTableCellElement.prototype, context.Element.prototype)

  vm.runInNewContext(scriptSource, context)

  assert.ok(clickHandler, 'userscript should register click handler')

  const event = {
    button: 0,
    defaultPrevented: false,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    target: storyLink,
    preventDefaultCalled: false,
    preventDefault() {
      this.defaultPrevented = true
      this.preventDefaultCalled = true
    },
  }

  clickHandler(event)

  return { openCalls, gmCalls, event }
}

function test(name, fn) {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    console.error(`FAIL ${name}`)
    console.error(error.stack)
    process.exitCode = 1
  }
}

test('opens both story and numeric comments links', () => {
  const result = runUserscript({
    storyHref: 'https://example.com/story',
    commentsHref: 'https://news.ycombinator.com/item?id=1',
    commentsText: '104 comments',
  })

  assert.equal(result.gmCalls.length, 2)
  assert.deepEqual(result.gmCalls.map((call) => call.url), [
    'https://example.com/story',
    'https://news.ycombinator.com/item?id=1',
  ])
  assert.equal(result.openCalls.length, 0)
})

test('opens discuss links as comments page', () => {
  const result = runUserscript({
    storyHref: 'https://example.com/ask-hn',
    commentsHref: 'https://news.ycombinator.com/item?id=2',
    commentsText: 'discuss',
  })

  assert.equal(result.gmCalls.length, 2)
  assert.deepEqual(result.gmCalls.map((call) => call.url), [
    'https://example.com/ask-hn',
    'https://news.ycombinator.com/item?id=2',
  ])
  assert.equal(result.openCalls.length, 0)
})

test('uses GM_openInTab for both tabs', () => {
  const result = runUserscript({
    storyHref: 'https://example.com/story',
    commentsHref: 'https://news.ycombinator.com/item?id=3',
    commentsText: '12 comments',
  })

  assert.equal(result.gmCalls.length, 2)
  assert.deepEqual(result.gmCalls.map((call) => call.url), [
    'https://example.com/story',
    'https://news.ycombinator.com/item?id=3',
  ])
  assert.equal(result.openCalls.length, 0)
})
