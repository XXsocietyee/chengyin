'use strict'
// L10-001: 地点层先用还没有媒体清单的行画点,清单回来再补封面。序列过期或页面已卸载不再 setData。
const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const placeMap = require('../../utils/roam-place-map.js')
const media = require('../../utils/roam-place-media.js')

const flush = async () => { for (let i = 0; i < 8; i++) await new Promise((resolve) => setImmediate(resolve)) }
const seedRow = (id, cover) => ({
  id, type: 1, name: '甲馆', lat: 31.2, lng: 121.4, coverImg: cover, tags: '["roam:seed:v1:test"]',
})
const licensed = (id, cover) => ({ poiId: id, coverKey: cover, credit: '作者 · CC BY 4.0', images: [] })
const unlicensed = (id, cover) => ({ poiId: id, coverKey: cover, credit: '仅测试参考，公开再发布许可未确认', images: [] })

function mount() {
  let definition
  const requests = []
  const app = {
    globalData: {}, getUserID: () => '11', getImgUrl: (key) => 'img:' + key,
    sendRequest: (request) => { requests.push(request) },
  }
  global.getApp = () => app
  global.getCurrentPages = () => []
  global.wx = {
    getStorageSync() {}, setStorageSync() {}, showToast() {}, showModal() {}, hideLoading() {}, showLoading() {},
    nextTick: (fn) => fn(), getWindowInfo: () => ({ windowWidth: 390, windowHeight: 844 }), getSystemInfoSync: () => ({}),
  }
  global.Page = (value) => { definition = value }
  const resolved = require.resolve('../../pages/roam/index.js')
  delete require.cache[resolved]
  require('../../pages/roam/index.js')
  const page = Object.assign({}, definition, { data: JSON.parse(JSON.stringify(definition.data || {})) })
  const writes = []
  page.setData = (patch, done) => {
    writes.push(patch)
    Object.entries(patch).forEach(([key, value]) => {
      const parts = key.split('.'); let target = page.data
      parts.slice(0, -1).forEach((part) => { target = target[part] || (target[part] = {}) })
      target[parts.at(-1)] = value
    })
    if (done) done()
  }
  page._writes = writes
  page._requests = requests
  page._player = { lat: 31.2, lng: 121.4 }
  page._pois = []
  page._syncGoal = () => {}
  page._seenSweepHistory = () => {}
  page._genIcons = () => Promise.resolve()
  page._syncSparkCircles = () => {}
  page._loadEntryFallback = () => {}
  const syncs = []
  page._syncMarkers = () => { syncs.push(page._pois.map((poi) => poi.photo)) }
  page._markerSyncs = syncs
  return page
}

function manifestOf(page) {
  return page._requests.find((request) => String(request.url).indexOf('gallery.json') >= 0)
}

beforeEach(() => media.resetPlaceMediaCache())

test('主地图先画点再补封面,没许可的封面不出现', async () => {
  const page = mount()
  const row = seedRow(41, 'poi/a.jpg')
  const before = structuredClone(row)
  const pending = page._fetchRoamPois({ lat: 31.2, lng: 121.4 })
  await flush()
  page._requests.find((request) => request.url === '/api/roam/pois').success({ code: 200, data: [row] })
  await flush()
  assert.equal(page._pois.length, 1)
  assert.equal(page._pois[0].photo, '')
  assert.deepEqual(page._markerSyncs[0], [''])
  const manifest = manifestOf(page)
  assert.equal(typeof manifest.success, 'function')
  manifest.success({ code: 200, data: unlicensed(41, 'poi/a.jpg') })
  await pending
  await flush()
  assert.equal(page._pois[0].photo, '')
  assert.deepEqual(row, before, '原回包不能被改掉')
})

test('许可清单回来后才把封面补上', async () => {
  const page = mount()
  const pending = page._fetchRoamPois({ lat: 31.2, lng: 121.4 })
  await flush()
  page._requests.find((request) => request.url === '/api/roam/pois').success({ code: 200, data: [seedRow(41, 'poi/a.jpg')] })
  await flush()
  assert.equal(page._pois[0].photo, '')
  manifestOf(page).success({ code: 200, data: licensed(41, 'poi/a.jpg') })
  await pending
  await flush()
  assert.equal(page._pois[0].photo, 'img:poi/a.jpg')
  assert.deepEqual(page._markerSyncs.at(-1), ['img:poi/a.jpg'])
})

test('不用清单的封面随点一起出现', async () => {
  const page = mount()
  const pending = page._fetchRoamPois({ lat: 31.2, lng: 121.4 })
  await flush()
  page._requests.find((request) => request.url === '/api/roam/pois').success({
    code: 200, data: [{ id: 42, type: 1, name: '乙馆', lat: 31.2, lng: 121.41, coverImg: 'poi/b.jpg', tags: '["roam:park"]' }],
  })
  await pending
  await flush()
  assert.equal(manifestOf(page), undefined)
  assert.equal(page._pois[0].photo, 'img:poi/b.jpg')
  assert.deepEqual(page._markerSyncs[0], ['img:poi/b.jpg'])
})

test('旧的清单回包在序列已变或页面卸载后不再 setData', async () => {
  const page = mount()
  const first = page._fetchRoamPois({ lat: 31.2, lng: 121.4 })
  await flush()
  page._requests.find((request) => request.url === '/api/roam/pois').success({ code: 200, data: [seedRow(41, 'poi/a.jpg')] })
  await flush()
  const manifest = manifestOf(page)
  const written = page._writes.length
  page._fetchRoamPois({ lat: 31.21, lng: 121.41 })
  manifest.success({ code: 200, data: licensed(41, 'poi/a.jpg') })
  await first
  await flush()
  assert.equal(page._writes.length, written)
  assert.equal(page._pois[0].photo, '')

  const again = mount()
  const pending = again._fetchRoamPois({ lat: 31.2, lng: 121.4 })
  await flush()
  again._requests.find((request) => request.url === '/api/roam/pois').success({ code: 200, data: [seedRow(43, 'poi/c.jpg')] })
  await flush()
  const late = manifestOf(again)
  const marks = again._writes.length
  again._unloaded = true
  late.success({ code: 200, data: licensed(43, 'poi/c.jpg') })
  await pending
  await flush()
  assert.equal(again._writes.length, marks)
  assert.equal(again._pois[0].photo, '')
})

function respondEntry(page, row) {
  const take = (url) => page._requests.find((request) => request.url === url && !request._done)
  take('/api/roam/entry/nearby').success({ code: 200, data: { items: [] } })
  take('/api/team/nearby').success({ code: 200, data: [] })
  take('/api/roam/pois').success({ code: 200, data: [row] })
  page._requests.forEach((request) => { request._done = true })
}

test('入口地图先画地点,清单回来再补封面;过期回包不写', async () => {
  const page = mount()
  page.data.entryLocated = true
  page._loadEntryMap({ lat: 31.2, lng: 121.4 })
  await flush()
  const row = seedRow(41, 'poi/a.jpg')
  respondEntry(page, row)
  await flush()
  assert.equal(placeMap.coverKey(page._entryPlaces[0]), '')
  assert.ok(page.data.entryMarkers.length > 0)
  assert.equal(page.data.entryStrip.some((card) => card.cover), false)
  const manifest = manifestOf(page)
  const written = page._writes.length
  page._unloaded = true
  manifest.success({ code: 200, data: licensed(41, 'poi/a.jpg') })
  await flush()
  assert.equal(page._writes.length, written)
  assert.equal(placeMap.coverKey(page._entryPlaces[0]), '')

  const live = mount()
  live.data.entryLocated = true
  live._loadEntryMap({ lat: 31.2, lng: 121.4 })
  await flush()
  respondEntry(live, seedRow(44, 'poi/d.jpg'))
  await flush()
  assert.equal(placeMap.coverKey(live._entryPlaces[0]), '')
  manifestOf(live).success({ code: 200, data: licensed(44, 'poi/d.jpg') })
  await flush()
  assert.equal(placeMap.coverKey(live._entryPlaces[0]), 'poi/d.jpg')
  assert.equal(live.data.entryStrip.find((card) => card.kind === 'place').cover, 'img:poi/d.jpg')

  const stale = mount()
  stale.data.entryLocated = true
  stale._loadEntryMap({ lat: 31.2, lng: 121.4 })
  await flush()
  respondEntry(stale, seedRow(45, 'poi/e.jpg'))
  await flush()
  const oldManifest = manifestOf(stale)
  stale._loadEntryMap({ lat: 31.2, lng: 121.4 })
  const marks = stale._writes.length
  oldManifest.success({ code: 200, data: licensed(45, 'poi/e.jpg') })
  await flush()
  assert.equal(stale._writes.length, marks)
  assert.equal(placeMap.coverKey(stale._entryPlaces[0]), '')
})
