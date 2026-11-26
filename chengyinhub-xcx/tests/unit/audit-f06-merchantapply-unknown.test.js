// AUDIT-1122 F06 L06-033:新建申请遇到 5xx/超时视为结果未知,不让用户再建一份
const test = require('node:test')
const assert = require('node:assert/strict')

test('L06-033 新建申请 HTTP 504 → 结果未确认;再次提交不再发 create', () => {
  let def
  const requests = []
  global.getApp = () => ({ globalData: {}, getUserID: () => 7, sendRequest: o => { requests.push(o); return {} } })
  global.Page = v => { def = v }
  global.wx = { getStorageSync: () => '', setStorageSync() {}, showLoading() {}, hideLoading() {}, showToast() {}, getWindowInfo: () => ({}) }
  const file = require.resolve('../../pages/topic/merchantapply/index.js')
  delete require.cache[file]
  require(file)
  const page = Object.assign({}, def, { data: JSON.parse(JSON.stringify(def.data)) })
  page.setData = function (p) { Object.entries(p).forEach(([k, v]) => { this.data[k] = v }) }
  page.validateForm = () => true
  Object.assign(page.data, { loadState: 'ready', registrationId: '', startDate: '2099-01-01', endDate: '2099-01-02' })
  page.onSubmit()
  const create = requests.find(r => r.url === '/api/registration/merchant/create')
  create.successStatusAbnormal({}, 504)
  assert.match(page.data.submitError, /未确认/)
  assert.equal(page.data.submitting, false)
  page.onSubmit()
  assert.equal(requests.filter(r => r.url === '/api/registration/merchant/create').length, 1)
})

test('L06-125 场地照片含空项时按界面下标删除正确的那张', () => {
  let def
  global.getApp = () => ({ globalData: {}, getUserID: () => 7, sendRequest() { return {} } })
  global.Page = v => { def = v }
  const file = require.resolve('../../pages/topic/merchantapply/index.js')
  delete require.cache[file]
  require(file)
  const page = Object.assign({}, def, { data: { picUrl: 'a,,b,c' } })
  page.setData = function (p, cb) { Object.assign(this.data, p); if (cb) cb() }
  page._refreshDirty = () => {}
  page.removePic({ currentTarget: { dataset: { imgindex: 2 } } }) // 界面上的第 2 格是 b
  assert.equal(page.data.picUrl, 'a,c')
})
