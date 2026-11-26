'use strict'
// 平台兑换码(owner 2026-11-22 方案 B):不新建页面,码输入在礼品领取页 mode=code;入口是通行证页一行。
// 行为测试:真实加载页面 JS,模拟服务端响应,断言结果文案/状态/请求 —— 不读源码文本。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const ROOT = path.resolve(__dirname, '../..')

function loadPage(rel, opts = {}) {
  let definition
  const calls = { redirects: [], navs: [], requests: [], events: [], logins: [] }
  const wx = new Proxy({
    navigateTo: (o) => calls.navs.push(o), redirectTo: (o) => calls.redirects.push(o),
    navigateBack: () => calls.navs.push({ back: true }), switchTab: (o) => calls.navs.push(o),
    getStorageSync: () => ''
  }, { get(t, k) { return k in t ? t[k] : () => {} } })
  const app = new Proxy(Object.assign({
    globalData: {},
    sendRequest(o) { calls.requests.push(o); return { abort() {} } }
  }, opts.app || {}), { get(t, k) { return k in t ? t[k] : () => '' } })
  const pageDir = path.dirname(path.join(ROOT, rel))
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), {
    getApp: () => app,
    getCurrentPages: () => [{}, {}],
    Page(page) { definition = page },
    require(request) {
      if (/\/analytics\.js$/.test(request)) return { track: (name, payload) => { calls.events.push([name, payload]); return true } }
      if (/\/page-motion\.js$/.test(request)) return { enter() {}, beats() { return () => {} } }
      return require(path.resolve(pageDir, request))
    },
    Set, Map, Date, JSON, Promise, Math, Number, String, Object, Array, RegExp, wx,
    setTimeout: () => 0, clearTimeout() {}, console
  }, { filename: path.join(ROOT, rel) })
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) { Object.assign(this.data, patch) }
  })
  return { page, calls }
}

function openCodeMode(enabled = true) {
  const loaded = loadPage('subpackageMember/market/gift/index.js', { app: { ensureLoginFor: () => true } })
  loaded.page.onLoad({ mode: 'code' })
  const status = loaded.calls.requests.shift()
  assert.equal(status.url, '/api/channel/redeem/status')
  status.success({ code: 200, data: { platformCodeEnabled: enabled } })
  return loaded
}

function submit(loaded, code, response) {
  loaded.page.onCodeInput({ detail: { value: code } })
  loaded.page.claim()
  const req = loaded.calls.requests.pop()
  assert.equal(req.url, '/api/channel/redeem')
  assert.equal(req.method, 'POST')
  const body = JSON.parse(req.data)
  assert.equal(body.code, code)
  req.success(response)
  return body
}

test('开关关闭:不出输入框,只说暂不可用,也不发兑换请求', () => {
  const loaded = openCodeMode(false)
  assert.equal(loaded.page.data.mode, 'code')
  assert.equal(loaded.page.data.codeOn, false)
  assert.equal(loaded.page.data.codeTitle, '兑换码暂不可用')
  loaded.page.onCodeInput({ detail: { value: 'ABC' } })
  loaded.page.claim()
  assert.equal(loaded.calls.requests.length, 0)
  assert.deepEqual(loaded.calls.events.map((e) => e[0]), ['code_redeem_open'])
})

test('六类结果各有独立文案', () => {
  const cases = [
    ['INVALID_CODE', '兑换码无效'],
    ['CODE_EXPIRED', '兑换码已过期'],
    ['ALREADY_REDEEMED_BY_OTHER', '兑换码已被他人使用'],
    ['SUBJECT_MISMATCH', '该兑换码不属于当前账号'],
    ['CODE_UNAVAILABLE', '兑换码暂不可用']
  ]
  const seen = new Set()
  for (const [reasonCode, text] of cases) {
    const loaded = openCodeMode(true)
    submit(loaded, 'X-' + reasonCode, { code: 409, reasonCode })
    assert.equal(loaded.page.data.codeTitle, text)
    assert.equal(loaded.page.data.codeErr, true)
    assert.equal(loaded.page.data.state, 'ready', '失败后可改码重试,不进礼品的失败态')
    seen.add(text)
  }
  const mine = openCodeMode(true)
  submit(mine, 'MINE', { code: 200, data: { replayed: true, topicIds: [5] } })
  assert.equal(mine.page.data.codeTitle, '你已兑换过这个码')
  assert.equal(mine.page.data.state, 'claimed')
  seen.add(mine.page.data.codeTitle)
  assert.equal(seen.size, 6)
  // 已兑换过:同样给「去玩」直达作品
  mine.page.goOrder()
  assert.deepEqual(JSON.parse(JSON.stringify(mine.calls.redirects)), [{ url: '/pages/topic/index/index?id=5' }])
  assert.ok(!mine.calls.events.some((e) => e[0] === 'code_redeem_success'), '重放不重复记成功')
})

test('首次成功:记 code_redeem_success,合集去玩落主题库', () => {
  const loaded = openCodeMode(true)
  submit(loaded, 'GOOD', { code: 200, data: { replayed: false, topicIds: [5, 6] } })
  assert.equal(loaded.page.data.codeTitle, '兑换成功')
  assert.equal(loaded.calls.events.filter((e) => e[0] === 'code_redeem_success').length, 1)
  loaded.page.goOrder()
  assert.deepEqual(JSON.parse(JSON.stringify(loaded.calls.redirects)), [{ url: '/subpackageMember/market/library/index' }])
})

test('网络未知再点:复用同一 requestId;改码换新 requestId', () => {
  const loaded = openCodeMode(true)
  loaded.page.onCodeInput({ detail: { value: 'SAME' } })
  loaded.page.claim()
  const first = loaded.calls.requests.pop()
  first.fail()
  assert.equal(loaded.page.data.state, 'unknown')
  loaded.page.claim()
  const second = loaded.calls.requests.pop()
  assert.equal(JSON.parse(second.data).requestId, JSON.parse(first.data).requestId)
  second.fail()
  loaded.page.onCodeInput({ detail: { value: 'OTHER' } })
  loaded.page.claim()
  const third = loaded.calls.requests.pop()
  assert.notEqual(JSON.parse(third.data).requestId, JSON.parse(first.data).requestId)
})

test('礼品领取原路径不受兑换码模式影响', () => {
  const loaded = loadPage('subpackageMember/market/gift/index.js', { app: { ensureLoginFor: () => true } })
  loaded.page.onLoad({ token: 'tok' })
  assert.equal(loaded.page.data.mode, '')
  loaded.page.claim()
  assert.equal(loaded.calls.requests[0].url, '/api/marketing/product/gifts/claim')
})
