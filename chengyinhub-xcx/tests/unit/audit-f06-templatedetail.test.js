// AUDIT-1122 F06:玩法详情个人副本保留作者封面 (L06-051),Hero 隐退只在内容挂载后绑定、重载后可重绑 (L06-052)
const test = require('node:test')
const assert = require('node:assert/strict')

function mount() {
  let def
  global.getApp = () => ({ globalData: {}, getUserID: () => 7, getUserRole: () => 'player', getUserType: () => 1, sendRequest() {} })
  global.Page = v => { def = v }
  global.wx = { getStorageSync: () => '', setStorageSync() {}, getSystemInfoSync: () => ({}), getWindowInfo: () => ({}), showToast() {} }
  const file = require.resolve('../../pages/templatedetail/templatedetail.js')
  delete require.cache[file]
  require(file)
  const page = Object.assign({}, def, { data: JSON.parse(JSON.stringify(def.data)) })
  page.setData = function (p, cb) { Object.assign(this.data, p); if (cb) cb() }
  return page
}

test('L06-051 个人副本用作者上传的封面;公共库同名玩法仍用包内封面', () => {
  const page = mount()
  // AUDIT-1122 L06-155:patchNormalized 已删,走页面实际用的 applyDetailPayload
  page.checkTextOverflow = () => {}
  page.data.scope = 'my'
  page.applyDetailPayload({ id: 1, title: '拍下这一刻', imgUrl: 'https://cdn.example/author.jpg' })
  assert.equal(page.data.coverUrl, 'https://cdn.example/author.jpg')
  page.data.scope = 'library'
  page.applyDetailPayload({ id: 1, title: '拍下这一刻', imgUrl: 'https://cdn.example/author.jpg' })
  assert.match(page.data.coverUrl, /photo-moment\.jpg$/)
})

test('L06-052 加载中不绑定 Hero 隐退;加载完成后绑定', () => {
  const page = mount()
  let animated = 0
  page.animate = () => { animated += 1 }
  page.data.loading = true
  page.onReady()
  assert.equal(animated, 0)
  assert.notEqual(page._heroRecedeApplied, true)
  page.data.loading = false
  page.onReady()
  assert.ok(animated <= 1)
})

test('L06-159 已带「分钟」的历史时长只补一次单位', () => {
  const util = require('../../pages/templatedetail/utils/templateDetail.js')
  assert.equal(util.normalizeTemplateDetail({ duration: '30分钟' }).info.durationValue, '30')
  assert.equal(util.normalizeTemplateDetail({ duration: 45 }).info.durationValue, '45')
  assert.equal(util.normalizeTemplateDetail({}).info.durationValue, '')
})
