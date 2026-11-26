'use strict'
// AUDIT-1122 lane F08:IM 会话列表 / 聊天页行为测试
const { test } = require('node:test')
const assert = require('node:assert/strict')

function load(rel, extra) {
  let def
  const writes = []
  const requests = []
  const storage = Object.assign({}, (extra && extra.storage) || {})
  global.getApp = () => ({
    globalData: {}, sendRequest: (o) => requests.push(o), tips() {},
    getUserID: () => 1, getRequestErrorMessage: (r, f) => f,
  })
  global.wx = { getStorageSync: (k) => storage[k] || '', setStorageSync: (k, v) => { storage[k] = v }, removeStorageSync: (k) => { delete storage[k] }, navigateTo() {} }
  global.Page = c => { def = c }
  const mod = require.resolve(rel)
  delete require.cache[mod]
  require(mod)
  const page = Object.assign({}, def)
  page.data = JSON.parse(JSON.stringify(def.data))
  page.setData = function (patch) {
    writes.push(patch)
    for (const [k, v] of Object.entries(patch)) {
      const parts = k.split('.')
      let o = this.data
      for (let i = 0; i < parts.length - 1; i += 1) o = o[parts[i]] = o[parts[i]] || {}
      o[parts[parts.length - 1]] = v
    }
  }
  return { page, writes, requests, storage }
}

const LIST = '../../subpackageB/pages/im/list/index.js'

test('L08-123 静音 / 已读 / 返回刷新重算列表时不再重播入场动画', () => {
  const { page, writes } = load(LIST)
  page.data.list = [{ conversationId: 1, type: 1, unread: 2 }]
  page.refreshView(); page.refreshView(); page.refreshView()
  assert.equal(writes.filter((w) => 'pmList' in w).length, 0)
  assert.equal(page.data.viewList.length, 1)
})

const CHAT = '../../subpackageB/pages/im/chat/index.js'

test('L08-119 服务端确认没有、本页也无失败气泡的发送收据被清掉,不再每次打开都查', () => {
  const { page, requests, storage } = load(CHAT, { storage: { 'im_send_receipts_v1:1:10': [{ id: 'im_a' }] } })
  Object.assign(page.data, { myId: 1, conversationId: 10, msgs: [] })
  page.recoverPending()
  const read = requests.filter((r) => r.url === '/api/im/send-receipt')
  assert.equal(read.length, 1)
  read[0].success({ code: 200, data: { found: false } })
  assert.deepEqual(storage['im_send_receipts_v1:1:10'], [])
})

test('L08-119 本页还有失败气泡时保留收据(重发要用它)', () => {
  const { page, requests, storage } = load(CHAT, { storage: { 'im_send_receipts_v1:1:10': [{ id: 'im_b' }] } })
  Object.assign(page.data, { myId: 1, conversationId: 10, msgs: [{ id: 'tmp_im_b', clientMessageId: 'im_b', sendPayload: {}, failed: true }] })
  page.recoverPending()
  requests.filter((r) => r.url === '/api/im/send-receipt')[0].success({ code: 200, data: { found: false } })
  assert.deepEqual(storage['im_send_receipts_v1:1:10'], [{ id: 'im_b' }])
})

test('L08-139 平台通知点一下展开全文、再点收起;各条互不影响', () => {
  const { page } = load(CHAT)
  const tap = (id) => page.onNoticeToggle({ currentTarget: { dataset: { id } } })
  assert.deepEqual(page.data.openNotices, {})
  tap(41)
  assert.equal(page.data.openNotices[41], true)
  assert.notEqual(page.data.openNotices[42], true)
  tap(41)
  assert.equal(page.data.openNotices[41], false)
})

test('L08-145 收件箱只露单聊/小助手/客服,群聊不露;发件箱没有会话;角标不计静音', () => {
  const { page } = load(LIST)
  page.data.list = [
    { conversationId: 1, type: 1, unread: 2 }, { conversationId: 2, type: 4, unread: 9 },
    { conversationId: 3, type: 2, unread: 1, muted: 1 }, { conversationId: 4, unread: 3 },
  ]
  page.data.invitesIn = [{ status: 0 }, { status: 1 }]
  page.refreshView()
  assert.deepEqual(page.data.viewList.map((c) => c.conversationId), [1, 3, 4])
  assert.equal(page.data.tabs[0].badge, 2 + 3 + 1)
  page.data.activeTab = 'out'
  page.refreshView()
  assert.deepEqual(page.data.viewList, [])
})
