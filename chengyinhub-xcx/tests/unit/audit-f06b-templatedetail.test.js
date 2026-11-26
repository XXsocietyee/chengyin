// AUDIT-1122 F06 pass 2 (templatedetail): 卡堆手势一次 setData (L06-164)
const { test } = require('node:test')
const assert = require('node:assert/strict')

test('L06-164 卡堆点卡/滑动只过一次桥,sel/flip 与卡位一起写', () => {
  const prev = { getApp: global.getApp, Page: global.Page, wx: global.wx }
  let def
  global.getApp = () => ({ globalData: { statusBarHeight: 20, navBarHeight: 44 }, sendRequest() {}, getUserID: () => 1 })
  global.wx = new Proxy({}, { get: () => () => ({}) })
  global.Page = (d) => { def = d }
  const file = require.resolve('../../pages/templatedetail/topic-preview/index.js')
  delete require.cache[file]
  try { require(file) } finally { global.getApp = prev.getApp; global.Page = prev.Page }
  const page = Object.assign({}, def)
  page.data = Object.assign(JSON.parse(JSON.stringify(def.data)), { sel: 0, flip: false, reducedMotion: true })
  page.data.cards = [{ id: 1 }, { id: 2 }, { id: 3 }]
  let calls = 0
  page.setData = function (patch) { calls += 1; Object.assign(this.data, patch) }
  page.tapCard({ currentTarget: { dataset: { index: 2 } } })
  assert.equal(calls, 1)
  assert.equal(page.data.sel, 2)
  assert.equal(page.data.cards[2].front, true)
  page.tapCard({ currentTarget: { dataset: { index: 2 } } })
  assert.equal(calls, 2)
  assert.equal(page.data.flip, true)
  assert.equal(page.data.cards[2].flipped, true)
  page.move(1)
  assert.equal(calls, 3)
  assert.equal(page.data.sel, 0)
  assert.equal(page.data.flip, false)
  global.wx = prev.wx
})

test('L06-153 预览页与详情页共用的采用流程:只读提示、已复制回原草稿、按原地点要求采用', () => {
  const prev = { getApp: global.getApp, wx: global.wx }
  const requests = []
  const navs = []
  global.getApp = () => ({ getUserID: () => 5, sendRequest: (o) => requests.push(o) })
  global.wx = { navigateTo: (o) => navs.push(o.url), showToast() {} }
  const file = require.resolve('../../pages/templatedetail/utils/topic-use-flow.js')
  delete require.cache[file]
  try {
    const flow = require(file)
    const page = { _id: 7, _scope: 'MERCHANT', _readonly: true }
    flow.adopt(page)
    assert.equal(requests.length, 0, '只读不发请求')
    page._readonly = false
    page._copiedId = 99
    flow.adopt(page)
    assert.deepEqual(navs, ['/pages/publish/fabu/index?id=99&scope=MERCHANT'])
    page._copiedId = 0
    page._delivery = { locationRequirement: { physicalPlaceRequired: true }, sourceCityCode: '310100' }
    flow.adopt(page)
    assert.equal(requests.length, 1)
    assert.equal(requests[0].url, '/api/template/topic-template/use')
  } finally { global.getApp = prev.getApp; global.wx = prev.wx; delete require.cache[file] }
})
