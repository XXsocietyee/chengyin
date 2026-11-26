const { test } = require('node:test')
const assert = require('node:assert/strict')

// L05-072:同一地点卡开着时,页面每个定位点重发的 place 不能重播弹出、清评分或重拉详情。
function mount() {
  let def
  const requests = []
  const prev = { Component: global.Component, getApp: global.getApp }
  global.Component = c => { def = c }
  global.getApp = () => ({ sendRequest: o => { requests.push(o); o.success({ code: 200, data: { averageRating: 4.5, ratingCount: 3 } }) } })
  const file = require.resolve('../../subpackageRoam/components/roam-place-card/index.js')
  delete require.cache[file]
  require(file)
  Object.assign(global, prev)
  const writes = []
  const inst = Object.assign({}, def.methods, {
    data: Object.assign({}, def.data, { reducedMotion: true }),
    setData(patch) { writes.push(patch); Object.assign(this.data, patch) },
  })
  return { inst, requests, writes }
}

test('同一地点只请求一次评分,距离变化不重播弹出', () => {
  const { inst, requests, writes } = mount()
  inst._onPlace({ id: 1, name: '咖啡店', shareKind: 'poi', shareId: 'p1', distText: '120m' })
  assert.equal(requests.length, 1)
  assert.equal(inst.data.rating, '4.5')
  const before = writes.length
  inst._onPlace({ id: 1, name: '咖啡店', shareKind: 'poi', shareId: 'p1', distText: '110m' })
  assert.equal(requests.length, 1, '同一地点不再请求详情')
  assert.equal(writes.length, before, '不重置 shown / rating')
})

test('换了地点照常重开;关闭后再开同一地点用缓存不再请求', () => {
  const { inst, requests } = mount()
  inst._onPlace({ id: 2, name: 'A', shareKind: 'poi', shareId: 'pa' })
  inst._onPlace({ id: 3, name: 'B', shareKind: 'poi', shareId: 'pb' })
  assert.equal(requests.length, 2)
  inst._onPlace(null)
  assert.equal(inst.data.show, false)
  inst._onPlace({ id: 2, name: 'A', shareKind: 'poi', shareId: 'pa' })
  assert.equal(inst.data.show, true)
  assert.equal(inst.data.rating, '4.5')
})
