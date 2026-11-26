// L07-058:合作列表 → 邀约详情 → 返回。只读看了一眼就回来:沿用快照,不再整页 6~7 个请求重拉;
// 详情里写过(已读回执 / 处理 / 申报 / 评价)或往深处跳过、换了号、列表自己的动作在隐藏时收尾 ⇒ 回来照常重读。
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const app = { globalData: {} }
const dirty = { markCoopListDirty() { app.globalData.coopListDirty = true }, takeCoopListDirty() { app.globalData.coopListDirty = false } }

function onShowWith(page) {
  const src = fs.readFileSync(path.resolve(__dirname, '../../pages/coop/list/index.js'), 'utf8')
  const body = /\n  onShow\(\) \{([\s\S]*?)\n  \},/.exec(src)[1]
  return new Function('merchantTheme', 'app', 'identityKey', 'return function () {' + body + '\n}')(
    { merchantPageShow() {} }, app, () => page._identity).call(page)
}

function page() {
  let loads = 0
  return {
    _identity: 'm:1', _listLoadedScope: 'm:1', _hidden: true,
    load() { loads += 1 }, _initWorkflow() {}, get loads() { return loads },
  }
}

test('只读看详情回来不重拉;详情写过或深跳后回来重拉', () => {
  const p = page()
  dirty.takeCoopListDirty()
  p._detailReturn = 'm:1'
  onShowWith(p)
  assert.equal(p.loads, 0, '没写没跳:沿用快照')

  p._detailReturn = 'm:1'
  dirty.markCoopListDirty()
  onShowWith(p)
  assert.equal(p.loads, 1, '详情写过:重读')

  p._detailReturn = 'm:1'
  p._identity = 'm:2'
  onShowWith(p)
  assert.equal(p.loads, 2, '换号:重读')

  onShowWith(p)
  assert.equal(p.loads, 3, '不是从详情回来:照旧重读')
})

test('详情页在写之前 / 深跳时标脏', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../../pages/coop/invite-detail/index.js'), 'utf8')
  assert.match(src, /onHide\(\) \{\n    this\._hidden = true;\n    markCoopListDirty\(\);/)
  assert.match(src, /const markCoopListDirty = \(\) => \{ app\.globalData\.coopListDirty = true; \};/)
  for (const url of ['/api/coop/invite/read', '/api/coop/perks/attach', '/api/coop/review/save']) {
    const at = src.indexOf(url)
    assert.ok(src.lastIndexOf('markCoopListDirty();', at) > src.lastIndexOf('app.sendRequest({', at) - 40, url)
  }
  const handle = src.indexOf("url: '/api/coop/handle'")
  assert.ok(src.indexOf('markCoopListDirty();', handle) > handle, 'handle 回包里标脏')
})

// 处理请求(接受 / 拒绝 / 撤回 / 取消合作)一发出就标脏:回包前就点返回,列表也必须重读,
// 不能沿用还挂着「接受 / 取消」按钮的旧快照
test('处理请求还没回包就返回列表:列表照常重读', () => {
  const vm = require('node:vm')
  const file = path.resolve(__dirname, '../../pages/coop/invite-detail/index.js')
  const row = { id: 7, inviteId: '7', status: 1, inviteType: 1, topicId: 8, topicName: '主题', shareMode: 0,
    depositOwed: false, fromId: 21, toId: 31, toType: 'merchant', termsFrozen: false, partner: { name: '合作方' } }
  const requests = []
  app.getUserID = () => 1
  app.sendRequest = (o) => {
    requests.push(o)
    if (o.url === '/api/coop/list' && o.success) o.success({ code: 200, data: { received: [row], sent: [row], slots: {} } })
  }
  let def
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    Page: (p) => { def = p }, getApp: () => app, console, setTimeout() {}, clearTimeout() {},
    wx: { stopPullDownRefresh() {}, navigateBack() {}, redirectTo() {}, setClipboardData() {} },
    require(id) {
      if (id.includes('/toast')) return Object.assign(() => {}, { success() {} })
      if (id.includes('/modal')) return { show: (o) => o.success({ confirm: true, content: '测试理由' }) }
      return require(path.resolve(path.dirname(file), id))
    },
  })
  const detail = Object.assign({}, def, { data: JSON.parse(JSON.stringify(def.data)), setData(p) { Object.assign(this.data, p) } })
  detail.onLoad({ inviteId: '7', box: 'sent' })
  dirty.takeCoopListDirty()
  detail.cancelAccepted()
  assert.ok(requests.some((r) => r.url === '/api/coop/handle'), '取消请求已发出,回包未到')
  const p = page()
  p._detailReturn = 'm:1'
  onShowWith(p)
  assert.equal(p.loads, 1, '写请求在途就返回:列表必须重读')
})
