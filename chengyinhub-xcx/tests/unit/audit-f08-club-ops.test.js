'use strict'
// AUDIT-1122 lane F08:俱乐部运营子页(checkin-detail / governance / payout-receiver / roles / group-code …)行为测试
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const ROOT = path.join(__dirname, '../..')

function mount(rel, opts) {
  const requests = []
  const toasts = []
  const navs = []
  let definition
  const storage = {}
  const app = Object.assign({ globalData: { user_id: 7, role: 'club', user_type: 1, statusBarHeight: 20, navBarHeight: 44 },
    getUserID: () => 7, sendRequest(o) { requests.push(o) } }, (opts && opts.app) || {})
  const wx = Object.assign({
    navigateBack() { navs.push('back') }, navigateTo(o) { navs.push(o.url) }, switchTab() {}, redirectTo() {}, stopPullDownRefresh() {},
    showToast(o) { toasts.push(o && o.title) }, getStorageSync: (k) => storage[k] || '', setStorageSync: (k, v) => { storage[k] = v },
    removeStorageSync: (k) => { delete storage[k] }, login(o) { o.success && o.success({ code: 'c' }) }, showModal() {},
    getSystemInfoSync: () => ({}), getWindowInfo: () => ({}),
  }, (opts && opts.wx) || {})
  global.wx = wx
  global.getApp = () => app
  const timers = []
  const sandbox = {
    getApp: () => app, Page(config) { definition = config }, Component(config) { definition = config },
    getCurrentPages: () => [{}, {}],
    require(request) {
      if (/utils\/toast\.js$/.test(request)) { const t = (m) => toasts.push(m); t.success = t; t.error = t; return t }
      return require(path.resolve(ROOT, path.dirname(rel), request))
    },
    wx, console, Date, JSON, Math, Promise,
    setTimeout(fn, ms) { timers.push({ fn, ms, kind: 'timeout' }); return timers.length },
    clearTimeout(id) { if (timers[id - 1]) timers[id - 1].cleared = true },
    setInterval(fn, ms) { timers.push({ fn, ms, kind: 'interval' }); return timers.length },
    clearInterval(id) { if (timers[id - 1]) timers[id - 1].cleared = true },
    decodeURIComponent, encodeURIComponent,
  }
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), sandbox, { filename: rel })
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data || {})),
    setData(patch, cb) { Object.assign(this.data, patch); if (cb) cb.call(this) },
  })
  return { page, requests, toasts, navs, timers }
}
const byUrl = (requests, url) => requests.filter((r) => r.url === url)

test('L08-064 核销详情:退款前的旧读迟到也不覆盖退款后的新读', () => {
  const { page, requests } = mount('pages/club/checkin-detail/index.js')
  page.onLoad({ clubId: '1', registrationId: '9' })
  page.load(true)
  const [older, newer] = byUrl(requests, '/api/club/crm/checkin/detail')
  newer.success({ code: 200, data: { registrationId: 9, statusCode: 'REFUNDED', canRefund: false } })
  older.success({ code: 200, data: { registrationId: 9, statusCode: 'PAID', canRefund: true } })
  assert.equal(page.data.detail.statusCode, 'REFUNDED')
})


test('L08-065 举报网络失败后重试复用同一 requestId;明确答复后下一次是新 id', () => {
  const { page, requests } = mount('pages/club/governance/index.js')
  page.setData({ clubId: 5, reportTargetId: 31, reportTargetType: 'TOPIC' })
  page.submitCase('report', '现场收费不透明')
  byUrl(requests, '/api/club/governance/cases/report')[0].fail()
  page.submitCase('report', '现场收费不透明')
  const [a, b] = byUrl(requests, '/api/club/governance/cases/report').map((r) => JSON.parse(r.data).requestId)
  assert.equal(a, b, '结果未知的重试必须同一个 requestId')
  byUrl(requests, '/api/club/governance/cases/report')[1].success({ code: 200 })
  page.submitCase('report', '现场收费不透明')
  const c = JSON.parse(byUrl(requests, '/api/club/governance/cases/report')[2].data).requestId
  assert.notEqual(c, b)
  page.submitCase('report', '另一件事')
  const d = JSON.parse(byUrl(requests, '/api/club/governance/cases/report')[3].data).requestId
  assert.notEqual(d, c, '内容变了是新请求')
})

test('B7 转让成功后 1.5s 内离开本页:回调不再 navigateBack', () => {
  const { page, requests, navs, timers } = mount('pages/club/governance/index.js')
  page.setData({ clubId: 5 })
  page.submitOwnerTransfer(9, '交接', '小王')
  const req = byUrl(requests, '/api/club/governance/owner/transfer')[0]
  req.success({ code: 200 })
  page.onUnload()
  timers.filter((t) => t.kind === 'timeout' && !t.cleared).forEach((t) => t.fn())
  assert.deepEqual(navs, [])
})

test('L08-068 分配成功后的角色刷新失败:保留列表并提示,不整页报错;首载失败照旧报错', () => {
  const { page, requests, toasts } = mount('pages/club/roles/index.js')
  page.setData({ clubId: 5, state: 'ready', assignments: [{ id: 1 }] })
  page._loadCycle = 3
  page.loadRoleData(3, { afterAction: true })
  byUrl(requests, '/api/club/roles/list')[0].fail()
  assert.equal(page.data.state, 'ready')
  assert.deepEqual(page.data.assignments, [{ id: 1 }])
  assert.ok(toasts.some((t) => /没刷新成功/.test(String(t))))
  page.setData({ state: 'loading' })
  page.loadRoleData(3)
  byUrl(requests, '/api/club/roles/list')[1].fail()
  assert.equal(page.data.state, 'error')
})

test('L08-067 个人收款「重新加载」回到加载态,不把事件对象当成下拉', () => {
  let stops = 0
  const { page } = mount('pages/club/payout-receiver/index.js', { wx: { stopPullDownRefresh() { stops += 1 } } })
  page._clubId = 5
  page.setData({ state: 'error' })
  page.loadStatus = () => {}
  page.retryLoad({ type: 'retry' })
  assert.equal(page.data.state, 'loading')
  assert.equal(stops, 0)
})

test('L08-093/094 客户详情:刷新不关编辑草稿;保存网络失败后重试复用 requestId', () => {
  const { page, requests } = mount('pages/club/customer-detail/index.js')
  page._clubId = 5; page._memberId = 8
  page.setData({ state: 'ready', detail: { memberId: 8, tags: ['老客'], remark: '', canEdit: true }, editing: true, draftTags: ['老客', '新'], draftRemark: '周末来' })
  page.load()
  const detail = byUrl(requests, '/api/club/crm/customers/detail')[0]
  detail.success({ code: '200', data: { summary: { memberId: 8, arrivedCount: 1, pendingCount: 0, refundedCount: 0, paidAmount: null }, tags: ['老客'], remark: '', canEdit: true, records: [] } })
  assert.equal(page.data.state, 'ready')
  assert.equal(page.data.editing, true, '刷新不关编辑')
  assert.deepEqual(page.data.draftTags, ['老客', '新'])
  page.saveTagRemark()
  const first = byUrl(requests, '/api/club/crm/customers/tag-remark')[0]
  first.fail(); first.complete && first.complete()
  page.saveTagRemark()
  const second = byUrl(requests, '/api/club/crm/customers/tag-remark')[1]
  assert.equal(JSON.parse(second.data).requestId, JSON.parse(first.data).requestId)
})

test('L08-095 客户列表:看完客户直接返回不重拉;详情保存过才重拉', () => {
  let events = null
  const { page, requests } = mount('pages/club/customers/index.js', { wx: { navigateTo(o) { events = o.events } } })
  page.onLoad({ clubId: '5' })
  page.onShow()
  const n = byUrl(requests, '/api/club/crm/customers/list').length
  page.setData({ state: 'ready' })
  page.openCustomer({ currentTarget: { dataset: { memberId: 8 } } })
  page.onShow()
  assert.equal(byUrl(requests, '/api/club/crm/customers/list').length, n, '没改动不重拉')
  page.openCustomer({ currentTarget: { dataset: { memberId: 8 } } })
  events.customerSaved()
  page.onShow()
  assert.equal(byUrl(requests, '/api/club/crm/customers/list').length, n + 1)
})

function customerRows(from, count, remarkAt) {
  return Array.from({ length: count }, (_, i) => {
    const memberId = from + i
    return {
      memberId,
      verifiedCount: 1,
      pendingCount: 0,
      displayName: '客' + memberId,
      remark: remarkAt && remarkAt[memberId] ? remarkAt[memberId] : '',
    }
  })
}

test('L08-129 客户列表:保存后回来按已翻到的深度重拉,后面的页还在', () => {
  let events = null
  const { page, requests } = mount('pages/club/customers/index.js', { wx: { navigateTo(o) { events = o.events } } })
  page.onLoad({ clubId: '5' })
  page.onShow()
  const list = () => byUrl(requests, '/api/club/crm/customers/list')
  list()[0].success({ code: '200', data: { total: 120, monthNew: 1, items: customerRows(1, 50) } })
  page.onReachBottom()
  list()[1].success({ code: '200', data: { total: 120, monthNew: 1, items: customerRows(51, 50) } })
  list()[1].complete()
  assert.equal(page.data.items.length, 100)
  page.openCustomer({ currentTarget: { dataset: { memberId: 80 } } })
  events.customerSaved()
  page.onShow()
  const body = JSON.parse(list()[2].data)
  assert.equal(body.pageNum, 1)
  assert.equal(body.pageSize, 100, '重拉要盖住已经翻过的两页')
  list()[2].success({ code: '200', data: { total: 120, monthNew: 1, items: customerRows(1, 100, { 80: '周末常来' }) } })
  assert.equal(page.data.items.length, 100, '回来后第 2 页还在')
  assert.equal(page.data.items[79].subText, '周末常来')
  assert.equal(page._pageNum, 2)
  page.onReachBottom()
  const next = JSON.parse(list()[3].data)
  assert.equal(next.pageNum, 3)
  assert.equal(next.pageSize, 50, '再往下仍按原来的页大小')
})

test('L08-129 已加载超过单页上限:先收回 200 行,再把后面的页续上', () => {
  let events = null
  const { page, requests } = mount('pages/club/customers/index.js', { wx: { navigateTo(o) { events = o.events } } })
  page.onLoad({ clubId: '5' })
  page.onShow()
  page._pageNum = 5
  page._hasMore = true
  page.setData({ state: 'ready', items: customerRows(1, 250) })
  page.openCustomer({ currentTarget: { dataset: { memberId: 230 } } })
  events.customerSaved()
  page.onShow()
  const list = () => byUrl(requests, '/api/club/crm/customers/list')
  const refresh = JSON.parse(list()[1].data)
  assert.equal(refresh.pageNum, 1)
  assert.equal(refresh.pageSize, 200)
  list()[1].success({ code: '200', data: { total: 300, monthNew: 0, items: customerRows(1, 200) } })
  assert.equal(page.data.items.length, 200)
  const tail = list()[2]
  assert.equal(JSON.parse(tail.data).pageNum, 5)
  assert.equal(JSON.parse(tail.data).pageSize, 50)
  tail.success({ code: '200', data: { total: 300, monthNew: 0, items: customerRows(201, 50) } })
  tail.complete()
  assert.equal(page.data.items.length, 250, '第 5 页续回来了')
  assert.equal(list().length, 3, '续到原来的深度就停')
})

test('L08-096 客户名单单行坏数据只跳过该行', () => {
  const vmod = require('../../pages/club/customers/view-model.js')
  const list = vmod.shapeCustomerList({ total: 3, monthNew: 0, items: [
    { memberId: 1, verifiedCount: 1, pendingCount: 0, displayName: 'A' },
    { memberId: 'x', verifiedCount: 1, pendingCount: 0 },
    { memberId: 3, verifiedCount: -1, pendingCount: 0 },
  ] })
  assert.ok(list)
  assert.deepEqual(list.items.map((i) => i.memberId), [1])
  assert.equal(list.skipped, 2)
  assert.equal(vmod.shapeCustomerList({ total: 'x', monthNew: 0, items: [] }), null, 'total 仍严格')
})

test('L08-087 团码深链名字里有孤立 % 不崩,原样显示', () => {
  const { page } = mount('pages/club/group-code/index.js')
  page.onLoad({ topicId: '1', topicName: '%E4%25' })
  assert.equal(page.data.title, '%E4%25')
})

test('L08-116 解散后 500ms 内已离开编辑页:不再 navigateBack', () => {
  const { page, navs, timers } = mount('pages/club/edit/index.js')
  page.onDissolved()
  page.onUnload()
  timers.filter((t) => t.kind === 'timeout').forEach((t) => t.fn())
  assert.deepEqual(navs, [])
})

test('L08-070 团码到期只挂一个单次定时器,到点重出码;没有每秒唤醒', () => {
  const { page, requests, timers } = mount('pages/club/group-code/index.js')
  page.onLoad({ activityId: '30' })
  byUrl(requests, '/api/verify/groupcode/issue')[0].success({ code: 200, data: { code: 'C1', qrcodeUrl: 'https://oss.test/1.png', ttlMs: 300000 } })
  assert.equal(timers.filter((t) => t.kind === 'interval').length, 0)
  const live = timers.filter((t) => t.kind === 'timeout' && !t.cleared)
  assert.equal(live.length, 1)
  assert.equal(live[0].ms, 300000)
  live[0].fn()
  assert.equal(byUrl(requests, '/api/verify/groupcode/issue').length, 2, '到期重出一次码')
})

test('L08-085 默认昵称申请人:通过确认框正文以「申请于 …」开头,不是 false', () => {
  const modals = []
  const { page } = mount('pages/club/join-requests/index.js', { wx: { showModal(o) { modals.push(o) } } })
  Object.assign(page.data, { clubId: 9, state: 'ready', requests: [{ id: 1, memberId: 7, nickname: '', requestTimeText: '11-22 10:05' }] })
  page.confirmReview(7, true)
  assert.equal(modals.length, 1)
  assert.match(modals[0].title, /^通过「城瘾玩家」的入会申请/)
  assert.match(modals[0].content, /^申请于 11-22 10:05。通过后/)
  const named = mount('pages/club/join-requests/index.js', { wx: { showModal(o) { modals.push(o) } } })
  Object.assign(named.page.data, { clubId: 9, state: 'ready', requests: [{ id: 1, memberId: 8, nickname: '小城', requestTimeText: '11-22 10:05' }] })
  named.page.confirmReview(8, true)
  assert.match(modals[1].content, /^通过后/)
})

test('L08-066 封禁只发所选天数:手机时钟拨错一年,请求体也不变', () => {
  const realNow = Date.now
  const bodies = []
  try {
    for (const skew of [0, 365 * 86400000]) {
      Date.now = () => realNow() + skew
      const { page, requests } = mount('pages/club/governance/index.js')
      page.setData({ clubId: 5, selectedDurationDays: 30 })
      page.submitBan(902, '线下骚扰')
      const body = JSON.parse(byUrl(requests, '/api/club/governance/ban')[0].data)
      bodies.push({ durationDays: body.durationDays, epoch: body.expiresAtEpochMs, expiresAt: body.expiresAt })
    }
  } finally { Date.now = realNow }
  assert.deepEqual(bodies, [{ durationDays: 30, epoch: undefined, expiresAt: undefined }, { durationDays: 30, epoch: undefined, expiresAt: undefined }])
})

test('L08-071 切回团码页:码还剩足够时间就续上定时,不重出;快到期才重出', () => {
  const realNow = Date.now
  let now = 1_800_000_000_000
  Date.now = () => now
  try {
    const { page, requests, timers } = mount('pages/club/group-code/index.js')
    page.onLoad({ activityId: '30' })
    byUrl(requests, '/api/verify/groupcode/issue')[0].success({ code: 200, data: { code: 'C1', qrcodeUrl: 'https://oss.test/1.png', ttlMs: 300000 } })
    page.onHide()
    now += 60000
    page.onShow()
    assert.equal(byUrl(requests, '/api/verify/groupcode/issue').length, 1, '还剩 4 分钟:不重出')
    assert.equal(page.data.qrcodeUrl, 'https://oss.test/1.png', '屏上仍是原码')
    const live = timers.filter((t) => t.kind === 'timeout' && !t.cleared)
    assert.equal(live.length, 1)
    assert.equal(live[0].ms, 210000, '到期前 30s 补码')
    page.onHide()
    now += 220000
    page.onShow()
    assert.equal(byUrl(requests, '/api/verify/groupcode/issue').length, 2, '只剩 20s:重出')
  } finally { Date.now = realNow }
})

test('L08-101 建俱乐部第 3 步:Logo 让位只剩一条样式规则,间距与原来逐像素相同', () => {
  const fs = require('node:fs')
  const wxml = fs.readFileSync(path.resolve(__dirname, '../../pages/club/create/index.wxml'), 'utf8')
  const wxss = fs.readFileSync(path.resolve(__dirname, '../../pages/club/create/index.wxss'), 'utf8')
  assert.doesNotMatch(wxml, /style="height:100rpx"/)
  // 原:96rpx 外边距 + 100rpx 占位块 + .cc-field margin-top(占位块有高度,不折叠)
  // 现:外边距与 .cc-field margin-top 折叠取大 ⇒ 196rpx + --cy-space-5,与原和相等
  assert.match(wxss, /\.cc-imgs \{ position: relative; margin-bottom: calc\(196rpx \+ var\(--cy-space-5\)\); \}/)
  assert.match(wxss, /\.cc-field \{ margin-top: var\(--cy-space-5\); \}/)
  assert.match(wxml, /<view class="cc-imgs">[\s\S]*?<\/view>\s*<\/view>\s*<\/view>\s*<view class="cc-field">/, '紧邻的下一个兄弟就是 .cc-field')
})

test('L08-092 编辑页:组件连报 dirty:true 只有第一次刷新宿主', () => {
  const { page } = mount('pages/club/edit/index.js')
  let n = 0
  const real = page.setData
  page.setData = function (patch, cb) { if ('dirty' in patch) n++; return real.call(this, patch, cb) }
  page.onDirtyChange({ detail: { dirty: true } })
  page.onDirtyChange({ detail: { dirty: true } })
  page.onDirtyChange({ detail: { dirty: true } })
  assert.equal(page.data.dirty, true)
  assert.equal(n, 1)
  page.onDirtyChange({ detail: { dirty: false } })
  assert.equal(page.data.dirty, false)
})
