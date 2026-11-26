'use strict'
// 2026-11-24 复核 #947(L10-181 / L10-141):开关与地图的内部副本在挂上时按调用方首值对齐,不只靠 observer。
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

function load(rel, props) {
  let def
  global.Component = (d) => { def = d }
  global.wx = { createMapContext: () => ({}), getSystemInfoSync: () => ({}), getWindowInfo: () => ({}) }
  global.getApp = () => ({ globalData: {} })
  const abs = path.resolve(__dirname, '../..', rel)
  delete require.cache[require.resolve(abs)]
  require(abs)
  const data = JSON.parse(JSON.stringify(def.data))
  for (const [k, v] of Object.entries(def.properties)) data[k] = v && typeof v === 'object' && 'value' in v ? v.value : undefined
  Object.assign(data, props)
  const inst = Object.assign({}, def.methods, { data, setData(p) { Object.assign(this.data, p) }, _genIcons: () => Promise.resolve(), _rebuild() {} })
  def.lifetimes.attached.call(inst)
  return inst
}

test('开关:调用方首值为开时,挂上后内部副本也是开(不依赖初始化期 observer)', () => {
  assert.equal(load('components/cy/switch/index.js', { checked: true }).data._checked, true)
  assert.equal(load('components/cy/switch/index.js', { checked: false }).data._checked, false)
})

test('地图:非上海城市首屏按调用方 center / scale,不停在默认上海 16 级', () => {
  const m = load('components/cy/free-map/index.js', { center: { lat: 39.9, lng: 116.4 }, scale: 13, scene: 'explore' })
  assert.deepEqual(m.data._center, { lat: 39.9, lng: 116.4 })
  assert.equal(m.data._scale, 13)
})
