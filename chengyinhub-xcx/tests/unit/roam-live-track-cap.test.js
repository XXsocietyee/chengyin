'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { DEFAULT_MAX_POINTS, simplifyTrack, limitTrack } = require('../../utils/roam-track-simplify.js')
const { clipTrackForSharing, readSharePrivacy } = require('../../utils/roam-route-privacy.js')
const { m2lat } = require('../../utils/roam-geo.js')

function zigzag(n) {
  const points = []
  for (let i = 0; i < n; i++) points.push({ lat: 31.2 + i * 0.0005, lng: 121.4 + (i % 2) * 0.001 })
  return points
}

function load() {
  let definition
  global.getApp = () => ({ getUserID: () => '7', globalData: {}, getImgUrl: value => value })
  global.wx = { getStorageSync() {}, setStorageSync() {}, nextTick: fn => fn(), getWindowInfo: () => ({}) }
  global.Page = global.Component = value => { definition = value }
  global.Behavior = value => value
  global.getCurrentPages = () => []
  const absolute = path.resolve(__dirname, '../../pages/roam/index.js')
  delete require.cache[require.resolve(absolute)]
  require(absolute)
  return {
    ...definition,
    data: structuredClone(definition.data),
    setData(patch, done) {
      Object.entries(patch || {}).forEach(([key, value]) => {
        const parts = key.split('.')
        let target = this.data
        parts.slice(0, -1).forEach(part => {
          if (!target[part] || typeof target[part] !== 'object') target[part] = {}
          target = target[part]
        })
        target[parts.at(-1)] = value
      })
      if (done) done()
    },
  }
}

function walking(view) {
  view._realOn = true
  view.data.screen = 'map'
  view.data.paused = false
  view._reveals = []
  view._dist = 0
  view._applyMovePatch = () => {}
  view._addReveal = () => {}
  view._syncIdle = () => {}
}

function step(view, point, now) {
  const originalNow = Date.now
  Date.now = () => now
  try { view._realTick({ latitude: point.lat, longitude: point.lng, accuracy: 10 }) }
  finally { Date.now = originalNow }
}

test('L05-068: 未到预算时原样追加,不换轨迹数组', () => {
  const view = load()
  walking(view)
  view._track = [{ lat: 31.2, lng: 121.4 }]
  const same = view._track
  view._realAnchor = { lat: 31.2, lng: 121.4, ts: 1000 }
  step(view, { lat: 31.2002, lng: 121.4 }, 2000)
  assert.equal(view._track, same)
  assert.equal(view._track.length, 2)
  assert.deepEqual(view._track.at(-1), { lat: 31.2002, lng: 121.4 })
})

test('L05-068: 走路超过预算后活轨迹封顶,最新点留下,地图线与分享仍用抽稀轨迹', () => {
  const view = load()
  walking(view)
  const seed = zigzag(DEFAULT_MAX_POINTS)
  view._track = seed.map(point => ({ ...point }))
  view._realAnchor = { ...seed.at(-1), ts: 1000 }
  const newest = { lat: 31.2 + DEFAULT_MAX_POINTS * 0.0005, lng: 121.4 + (DEFAULT_MAX_POINTS % 2) * 0.001 }
  step(view, newest, 2000)
  assert.equal(view._track.length, DEFAULT_MAX_POINTS)
  assert.deepEqual(view._track[0], seed[0])
  assert.deepEqual(view._track.at(-1), newest)
  assert.deepEqual(view._track, limitTrack(view._track))

  let now = 2000
  for (let i = 1; i <= 40; i += 1) {
    now += 1000
    const point = { lat: newest.lat + m2lat(20) * i, lng: newest.lng }
    step(view, point, now)
    assert.ok(view._track.length <= DEFAULT_MAX_POINTS)
    assert.deepEqual(view._track[0], seed[0])
    assert.deepEqual(view._track.at(-1), point)
  }

  const line = view._myRouteLine().lines(view._track)
  const drawn = line[0].points
  assert.equal(drawn.at(-1).latitude, view._track.at(-1).lat)
  assert.equal(drawn.at(-1).longitude, view._track.at(-1).lng)

  view._pois = []
  view._c = view._track[0]
  const privacy = readSharePrivacy(global.wx)
  const drop = Math.floor(view._track.length * privacy.clipPercent / 100)
  const clipped = clipTrackForSharing(view._track, privacy)
  const shared = simplifyTrack(clipped)
  assert.equal(privacy.clipEnabled, true)
  assert.ok(drop >= 1)
  assert.deepEqual(clipped[0], view._track[drop])
  assert.deepEqual(clipped.at(-1), view._track.at(-1 - drop))
  assert.deepEqual(shared[0], clipped[0])
  assert.deepEqual(shared.at(-1), clipped.at(-1))
  assert.notDeepEqual(shared.at(-1), view._track.at(-1))
  const arch = view._calcArch()
  const sharedDrawn = arch.archGeo.polyline[0].points.map(point => ({ lat: point.latitude, lng: point.longitude }))
  assert.deepEqual(sharedDrawn, shared)
})
