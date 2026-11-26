'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const media = require('../../utils/roam-place-media.js')

function mount(app) {
  let definition
  global.getApp = () => app
  global.getCurrentPages = () => []
  global.wx = { getStorageSync() {}, setStorageSync() {}, showToast() {}, showModal() {}, nextTick: fn => fn(),
    getWindowInfo: () => ({ windowWidth: 390, windowHeight: 844 }), getSystemInfoSync: () => ({}) }
  global.Page = value => { definition = value }
  const resolved = require.resolve('../../pages/roam/index.js')
  delete require.cache[resolved]
  require('../../pages/roam/index.js')
  const page = Object.assign({}, definition, { data: JSON.parse(JSON.stringify(definition.data || {})) })
  page.setData = (patch, done) => {
    Object.entries(patch || {}).forEach(([key, value]) => { page.data[key] = value })
    if (done) done()
  }
  return page
}

test('漫游点位先上图,最慢的图集清单回来才补封面', async () => {
  media.resetPlaceMediaCache()
  const requests = []
  const app = { globalData: { features: {} }, getUserID: () => '11', sendRequest: request => { requests.push(request) } }
  const page = mount(app)
  page._player = { lat: 31.2, lng: 121.4 }
  page._roamReadScope = () => () => true
  page._syncGoal = () => {}
  page._syncMarkers = () => {}
  page._syncSparkCircles = () => {}
  page._seenSweepHistory = () => {}
  page._genIcons = () => Promise.resolve()
  page._pois = []
  const cover = 'curated/shanghai/10.jpg'
  const pending = page._fetchRoamPois({ lat: 31.2, lng: 121.4 })
  await new Promise(resolve => setImmediate(resolve))
  requests.find(request => request.url === '/api/roam/pois').success({ code: 200, data: [
    { id: 10, type: 1, name: '外滩', lat: 31.2, lng: 121.4, cover, tags: '["roam:seed:v1:test"]' },
  ] })
  await new Promise(resolve => setImmediate(resolve))
  const gallery = requests.find(request => /gallery\.json$/.test(request.url))
  assert.ok(gallery, '种子封面仍会去读许可清单')
  const pin = page._pois.find(poi => poi._roamId === 10)
  assert.ok(pin, '清单没回来之前点已经在图层上')
  assert.equal(pin.photo, '')
  gallery.success({ code: 200, data: { poiId: 10, coverKey: cover, credit: '作者', images: [{ key: cover, width: 4032, height: 3024 }] } })
  await pending
  assert.equal(page._pois.find(poi => poi._roamId === 10).photo, cover)
})
