// AUDIT-1122 F06 L06-046:恢复投递一次一个请求,被拒/失败如实提示后回读统计
const test = require('node:test')
const assert = require('node:assert/strict')

test('L06-046 recoverBroadcast: busy guard, failure message, stats readback', () => {
  let config
  const requests = []
  const toasts = []
  global.getApp = () => ({
    getUserID: () => '7', getAuthorization: () => 't7', globalData: {},
    sendRequest: o => requests.push(o),
    tips: m => toasts.push(m),
    getRequestErrorMessage: (res, fb) => (res && res.msg) || fb,
  })
  global.Page = v => { config = v }
  global.wx = {
    getStorageSync: () => '', setStorageSync() {}, removeStorageSync() {},
    showModal: o => o.success && o.success({ confirm: true }),
    showToast: o => toasts.push(o.title), hideToast() {},
  }
  const file = require.resolve('../../pages/activity/official-mine/index.js')
  delete require.cache[file]
  require(file)
  const page = Object.assign({}, config, { data: { broadcasts: [{ id: 5, _canRecover: true }] } })
  page.setData = function (p) { Object.assign(this.data, p) }
  let stats = 0
  page.openBroadcastStats = () => { stats += 1 }
  const ev = { currentTarget: { dataset: { index: 0 } } }
  page.recoverBroadcast(ev)
  page.recoverBroadcast(ev)
  const posts = requests.filter(r => /\/recover$/.test(r.url))
  assert.equal(posts.length, 1, '在途时第二次确认不得再发')
  posts[0].successStatusAbnormal({ code: 409, msg: '历史待核，不会重发' })
  assert.equal(stats, 1)
  assert.ok(toasts.some(t => String(t).includes('历史待核')), '被拒原因要说出来')
  page.recoverBroadcast(ev)
  assert.equal(requests.filter(r => /\/recover$/.test(r.url)).length, 2, '结束后可再次恢复')
})
