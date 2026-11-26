// L10-001:附近点先落在地图上,许可清单回来后再补照片。不改清单缓存 TTL。
const test = require('node:test')
const assert = require('node:assert/strict')
const media = require('../../utils/roam-place-media.js')

function mount(app) {
  let definition
  global.getApp = () => app
  global.getCurrentPages = () => []
  global.wx = { getStorageSync() {}, setStorageSync() {}, showToast() {}, showModal() {}, nextTick: (fn) => fn(),
    getWindowInfo: () => ({ windowWidth: 390, windowHeight: 844 }), getSystemInfoSync: () => ({}) }
  global.Page = (value) => { definition = value }
  global.Component = (value) => { definition = value }
  global.Behavior = (value) => value
  const resolved = require.resolve('../../pages/roam/index.js')
  delete require.cache[resolved]
  require('../../pages/roam/index.js')
  const vm = Object.assign({}, definition, { data: JSON.parse(JSON.stringify(definition.data || {})) })
  vm.setData = (patch, done) => {
    Object.entries(patch).forEach(([key, value]) => {
      const parts = key.split('.')
      let target = vm.data
      parts.slice(0, -1).forEach((part) => { target = target[part] || (target[part] = {}) })
      target[parts.at(-1)] = value
    })
    if (done) done()
  }
  return vm
}

const tick = () => new Promise((resolve) => setImmediate(resolve))

test('点位在许可清单返回前就画上,照片等清单确认后再补', async () => {
  media.resetPlaceMediaCache()
  const held = []
  const app = {
    globalData: {},
    getUserID: () => '11',
    sendRequest(options) {
      if (String(options.url).indexOf('/api/roam/pois') === 0) {
        options.success({ code: 200, data: [{ id: 41, name: '甲馆', lat: 31.23, lng: 121.47, type: 1,
          coverImg: 'poi/a.jpg', tags: '["roam:seed:v1:test"]' }] })
        return
      }
      held.push(options)
    },
  }
  const page = mount(app)
  page._staticIconsReady = true
  page._player = { lat: 31.23, lng: 121.47 }
  page._pois = []
  page.syncs = 0
  page._syncGoal = () => {}
  page._seenSweepHistory = () => {}
  page._syncSparkCircles = () => {}
  page._syncMarkers = () => { page.syncs += 1 }
  page._fetchRoamPois({ lat: 31.23, lng: 121.47 })
  await tick()
  const first = page._pois.find((poi) => poi._roamId === 41)
  assert.ok(first, '清单返回前点位就要在地图数据里')
  assert.equal(first.photo, '')
  assert.equal(first.name, '甲馆')
  await tick()
  assert.equal(page.syncs, 1)
  assert.equal(held.length, 1)
  held[0].success({ code: 200, data: { poiId: 41, coverKey: 'poi/a.jpg', credit: '作者 · CC BY 4.0', images: [] } })
  await tick()
  await tick()
  const filled = page._pois.find((poi) => poi._roamId === 41)
  assert.match(String(filled.photo), /poi\/a\.jpg/)
  assert.equal(page.syncs, 2)
})
