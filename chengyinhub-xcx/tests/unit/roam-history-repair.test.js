'use strict'

// R9-42/43/44 漫游历史 存读数值契约 / 轨迹抽稀 / 历史分享足迹卡
//
// 三条都是「读方或入口没接上真实数据」,不是定位或服务端问题:
//   R9-42 落盘 distance 是 toFixed 字符串,组件只读 number → 里程显示「—」
//   R9-43 _saveSession 用 i % 3 固定抽样 → 丢终点与转折,回放不保真
//   R9-44 历史详情的 share 事件被 onSceneSessionShare 丢掉,只 showShareMenu

const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')

const { readNonNegative } = require('../../utils/roam-history-metrics.js')
const { simplifyTrack } = require('../../utils/roam-track-simplify.js')

function loadComponent(relativePath) {
  const absolutePath = path.join(ROOT, relativePath)
  const previousComponent = global.Component
  const previousBehavior = global.Behavior
  let definition
  global.Component = (config) => { definition = config }
  global.Behavior = (config) => config
  try {
    delete require.cache[require.resolve(absolutePath)]
    require(absolutePath)
  } finally {
    global.Component = previousComponent
    global.Behavior = previousBehavior
  }
  return definition
}

// ───────────────────────── R9-42:距离数值契约 ─────────────────────────

test('R9-42 距离读法:数字、数字字符串都认;0 与未知分开', () => {
  assert.equal(readNonNegative(0), 0)
  assert.equal(readNonNegative('0'), 0)
  assert.equal(readNonNegative('0.0'), 0)
  assert.equal(readNonNegative('0.2'), 0.2)
  assert.equal(readNonNegative(12.5), 12.5)
  assert.equal(readNonNegative(' 3.10 '), 3.1)
  assert.equal(readNonNegative(null), null)
  assert.equal(readNonNegative(undefined), null)
  assert.equal(readNonNegative(''), null)
  assert.equal(readNonNegative('   '), null)
  assert.equal(readNonNegative('bad'), null)
  assert.equal(readNonNegative(-1), null)
  assert.equal(readNonNegative('-2'), null)
  assert.equal(readNonNegative(NaN), null)
  assert.equal(readNonNegative(Infinity), null)
  // 只认老记录会写的十进制写法,Number() 的宽容(十六进制/科学计数)不算「可靠数值字符串」
  assert.equal(readNonNegative('0x10'), null)
  assert.equal(readNonNegative('1e3'), null)
  assert.equal(readNonNegative('.5'), null)
})

test('R9-42 历史列表:老记录的字符串里程不再显示为缺失,0 显示 0', () => {
  const definition = loadComponent('subpackageRoam/components/cy/scene-roam-history/index.js')
  const context = {
    _timestamp: definition.methods._timestamp,
    _formatDuration: definition.methods._formatDuration,
  }
  const rows = definition.methods._sorted.call({
    ...context,
    _sessions: [
      { ts: 1717243200000, finishedAt: Date.now(), zone: '徐汇', distance: '0.2', shops: 2 },
      { ts: 1717243200001, zone: '徐汇', distance: 0, shops: 0 },
      { ts: 1717243200002, zone: '徐汇', distance: 'bad', shops: 1 },
    ],
  }, 'new')
  const byTs = (ts) => rows.find((row) => row.ts === ts)
  assert.equal(byTs(1717243200000).distanceValue, 0.2)
  assert.equal(byTs(1717243200000).distanceText, '0.2')
  assert.equal(byTs(1717243200001).distanceValue, 0)
  assert.equal(byTs(1717243200001).distanceText, '0.0')
  assert.equal(byTs(1717243200002).distanceValue, null)
  // UI-04(2026-09-18):数字统计没取到显示 0,不再显示横杠
  assert.equal(byTs(1717243200002).distanceText, '0')
})

test('R9-42 本次漫游详情:字符串里程显示为真实值,未知按 UI-04 显示 0', () => {
  const definition = loadComponent('subpackageRoam/components/cy/scene-roam-session/index.js')
  const context = { _formatDuration: definition.methods._formatDuration }
  const stringDistance = definition.methods._normalize.call(context, {
    ts: 1717243200000, distance: '0.2', shops: 1, explorePct: 20, durSec: 60, pois: [],
  })
  assert.equal(stringDistance.distance, 0.2)
  assert.equal(stringDistance.distanceText, '0.2')

  const zero = definition.methods._normalize.call(context, {
    ts: 1717243200000, distance: 0, shops: 0, explorePct: 0, durSec: 0, pois: [],
  })
  assert.equal(zero.distanceText, '0.0')

  const unknown = definition.methods._normalize.call(context, {
    ts: 1717243200000, distance: 'bad', shops: 1, explorePct: 20, durSec: 60, pois: [],
  })
  assert.equal(unknown.distance, null)
  assert.equal(unknown.distanceText, '0')
})

// ───────────────────────── R9-43:轨迹抽稀 ─────────────────────────

// 一个 L 形受控路线:先向北,再在 p1 转东直走。p1 是唯一的真转折。
// 旧码 i % 3 === 0 只留 p0/p3 —— 终点 p4 与转折 p1 一起丢,回放变成一条斜直线。
const CONTROLLED_TRACK = [
  { lat: 38.8840, lng: -76.9990 },        // p0 起点
  { lat: 38.8850, lng: -76.9990 },        // p1 转折(向北)
  { lat: 38.8850, lng: -76.9980 },        // p2 向东
  { lat: 38.8850, lng: -76.9970 },        // p3 向东
  { lat: 38.8850, lng: -76.9960 },        // p4 终点
]

test('R9-43 抽稀保留首尾;转折不被当成共线噪声丢掉', () => {
  const simplified = simplifyTrack(CONTROLLED_TRACK)
  assert.deepEqual(simplified[0], CONTROLLED_TRACK[0], '起点必须保留')
  assert.deepEqual(simplified[simplified.length - 1], CONTROLLED_TRACK[4], '终点必须保留')
  assert.ok(simplified.some((point) => point.lat === CONTROLLED_TRACK[1].lat && point.lng === CONTROLLED_TRACK[1].lng), '转折点必须保留')
  assert.ok(simplified.length < CONTROLLED_TRACK.length, '近似共线的点应被抽掉')
})

test('R9-43 短轨迹原样保留,不因抽稀丢终点;空/坏点不生成假轨迹', () => {
  const two = [CONTROLLED_TRACK[0], CONTROLLED_TRACK[4]]
  assert.deepEqual(simplifyTrack(two), two)
  assert.deepEqual(simplifyTrack([CONTROLLED_TRACK[0]]), [CONTROLLED_TRACK[0]])
  assert.deepEqual(simplifyTrack([]), [])
  assert.deepEqual(simplifyTrack(null), [])
  assert.deepEqual(simplifyTrack([{ lat: 'x', lng: 1 }, null]), [])
})

test('R9-43 长轨迹超上限时仍保留首尾', () => {
  const long = Array.from({ length: 1000 }, (_, index) => ({
    lat: 31.2 + index * 0.00005,
    lng: 121.4 + (index % 2 === 0 ? 0.0003 : -0.0003),
  }))
  const simplified = simplifyTrack(long, { maxPoints: 50 })
  assert.ok(simplified.length <= 50)
  assert.deepEqual(simplified[0], long[0])
  assert.deepEqual(simplified[simplified.length - 1], long[long.length - 1])
})

test('R9-43 落盘轨迹保留终点,且里程按统一数值合同存', () => {
  const page = loadRoamPage()
  page._track = CONTROLLED_TRACK.map((point) => ({ ...point }))
  page._pois = []
  page._reveals = []
  page._sessionPhotos = []
  page._roamSid = 0
  page._clientSessionKey = ''
  page._recoveryArchiveTs = 0
  const fin = {
    zone: '这片街区', date: '9月13日', dateLine: '今天 · 上午 10:00',
    shops: 0, distance: '0.2', explorePct: 0, time: '00:01', photos: [],
  }

  assert.equal(page._saveSession(fin), true)
  const stored = storage['roam_memory_v1:9:sessions'][0]

  assert.equal(stored.distance, 0.2, 'distance 落盘为 number,不是展示字符串')
  assert.equal(typeof stored.distance, 'number')
  assert.deepEqual(stored.track[0], CONTROLLED_TRACK[0])
  assert.deepEqual(stored.track[stored.track.length - 1], CONTROLLED_TRACK[4], '终点不能被 i % 3 丢掉')
  assert.ok(stored.track.some((point) => point.lat === 38.8850 && point.lng === -76.9990), '转折点必须在落盘轨迹里')
})

test('R9-43 回放与落盘同源:组件从落盘轨迹构出的段数覆盖到终点', () => {
  const { buildRouteGeometry } = require('../../subpackageRoam/components/cy/scene-roam-session/route-replay.js')
  const page = loadRoamPage()
  page._track = CONTROLLED_TRACK.map((point) => ({ ...point }))
  page._pois = []
  page._reveals = []
  page._sessionPhotos = []
  page._roamSid = 0
  page._clientSessionKey = ''
  page._recoveryArchiveTs = 0
  page._saveSession({ zone: '这片街区', shops: 0, distance: '0.2', explorePct: 0, time: '00:01', photos: [] })

  const stored = storage['roam_memory_v1:9:sessions'][0]
  const geometry = buildRouteGeometry({ track: stored.track, pois: [] })
  assert.ok(geometry.segs.length >= 2, '落盘轨迹必须够画出到终点的路线')
})

// ───────────────────────── R9-44:历史分享足迹卡 ─────────────────────────

// ───────────────────────── 页面测试脚手架 ─────────────────────────

let pageConfig
let storage

test('存档重试替换原记录，不释放仍被第50条存档引用的照片', () => {
  const page = loadRoamPage()
  const released = []
  global.wx.removeSavedFile = ({ filePath }) => released.push(filePath)
  storage['roam_memory_v1:9:sessions'] = Array.from({ length: 50 }, (_, i) => ({
    ts: 1000 + i, photos: [{ path: 'wxfile://archive/' + i, persisted: true }],
  }))
  page._recoveryArchiveTs = 1000
  page._pois = []; page._reveals = []; page._track = []
  const fin = { distance: 1, photos: storage['roam_memory_v1:9:sessions'][0].photos }
  try {
    assert.equal(page._saveSession(fin), true)
    assert.equal(page._saveSession(fin), true)
    assert.equal(storage['roam_memory_v1:9:sessions'].length, 50)
    assert.equal(storage['roam_memory_v1:9:sessions'][49].photos[0].path, 'wxfile://archive/49')
    assert.deepEqual(released, [])
  } finally { delete global.wx.removeSavedFile }
})

test('新增存档仅在保存成功后释放淘汰照片，其他存档的共同引用保留', () => {
  const page = loadRoamPage()
  const released = []
  global.wx.removeSavedFile = ({ filePath }) => released.push(filePath)
  storage['roam_memory_v1:9:sessions'] = Array.from({ length: 50 }, (_, i) => ({
    ts: 1000 + i, photos: [{ path: 'wxfile://archive/' + i, persisted: true }],
  }))
  storage['roam_memory_v1:9:sessions'][49].photos.push({ path: 'wxfile://archive/0', persisted: true })
  page._recoveryArchiveTs = 2000
  page._pois = []; page._reveals = []; page._track = []
  const setStorage = global.wx.setStorageSync
  try {
    global.wx.setStorageSync = () => { throw new Error('storage unavailable') }
    assert.equal(page._saveSession({ distance: 1, photos: [] }), false)
    assert.deepEqual(released, [])
    global.wx.setStorageSync = setStorage
    assert.equal(page._saveSession({ distance: 1, photos: [] }), true)
    assert.deepEqual(released, ['wxfile://archive/49'])
  } finally { global.wx.setStorageSync = setStorage; delete global.wx.removeSavedFile }
})

function setByPath(target, keyPath, value) {
  const parts = keyPath.split('.')
  let cursor = target
  parts.slice(0, -1).forEach((part) => {
    if (!cursor[part] || typeof cursor[part] !== 'object') cursor[part] = {}
    cursor = cursor[part]
  })
  cursor[parts[parts.length - 1]] = value
}

function loadRoamPage() {
  delete require.cache[require.resolve('../../pages/roam/index.js')]
  require('../../pages/roam/index.js')
  const page = Object.assign({}, pageConfig, {
    data: JSON.parse(JSON.stringify(pageConfig.data)),
  })
  page.setData = (patch, callback) => {
    Object.entries(patch).forEach(([key, value]) => setByPath(page.data, key, value))
    if (callback) callback()
  }
  page._sceneInTimer = null
  return page
}

global.getApp = () => ({
  getUserID: () => '9',
  globalData: { user_id: 9, features: {} },
  isDevEnv: () => false,
  sendRequest() {},
})

global.Page = (config) => { pageConfig = config }

global.wx = {
  getStorageSync: (key) => storage[key],
  setStorageSync(key, value) { storage[key] = JSON.parse(JSON.stringify(value)) },
  getWindowInfo: () => ({ statusBarHeight: 20 }),
  getSystemInfoSync: () => ({ statusBarHeight: 20 }),
  showLoading() {},
  hideLoading() {},
  showToast() {},
  showShareMenu() {},
}

test.beforeEach(() => {
  pageConfig = null
  storage = {}
})

test('R9-43 折返和超预算的重要转折保留，坏坐标不变成 0/1', () => {
  const back = [{ lat: 31, lng: 121 }, { lat: 31.001, lng: 121 }, { lat: 31.0001, lng: 121 }]
  assert.deepEqual(simplifyTrack(back), back)
  const route = Array.from({ length: 500 }, (_, i) => ({ lat: 31 + i * 0.0001, lng: 121 + (i === 10 ? 0.1 : i % 2 * 0.0001) }))
  const reduced = simplifyTrack(route)
  assert.ok(reduced.length <= 180)
  assert.ok(reduced.some(p => p.lng === route[10].lng && p.lat === route[10].lat))
  assert.deepEqual(simplifyTrack([{ lat: '', lng: 121 }, { lat: true, lng: 121 }, { lat: 31, lng: [] }, { lat: 91, lng: 121 }]), [])
})

test('历史隐私裁剪与点密度无关，两点直线也裁掉原始首尾', () => {
  const { clipSavedTrackForSharing: clip } = require('../../utils/roam-route-privacy.js')
  const dense = Array.from({ length: 101 }, (_, i) => ({ lat: 31 + i * 0.0001, lng: 121 }))
  const sparse = simplifyTrack(dense)
  assert.equal(sparse.length, 2)
  const a = clip(dense), b = clip(sparse)
  assert.ok(Math.abs(a[0].lat - b[0].lat) < 1e-9)
  assert.ok(Math.abs(a.at(-1).lat - b.at(-1).lat) < 1e-9)
  assert.ok(b[0].lat > sparse[0].lat && b.at(-1).lat < sparse.at(-1).lat)
  assert.deepEqual(clip(sparse, { clipEnabled: false }), sparse)
  assert.deepEqual(clip([sparse[0], sparse[0]]), [])
})

test('分享画图不再按序号二次抽点，100 个折线点保留 99 段', () => {
  const page = loadRoamPage()
  const route = Array.from({ length: 100 }, (_, i) => ({ lat: 31 + i * 0.0001, lng: 121 + i % 2 * 0.001 }))
  assert.equal(page._buildArchFrom(route, [], route[0]).archSegs.length, 99)
})

test('取消生成中的足迹卡不保存相册，正常生成仍可保存', async () => {
  const page = loadRoamPage()
  let release, saves = 0
  page._saveToAlbum = async () => { saves++; return true }
  const pending = page._exportAndSave('生成卡片', () => new Promise(resolve => { release = resolve }), page._shareScope())
  await Promise.resolve()
  page._cancelShareWork()
  release('/tmp/old-card.png')
  assert.equal((await pending).saved, false)
  assert.equal(saves, 0)
  assert.equal((await page._exportAndSave('生成卡片', () => Promise.resolve('/tmp/new-card.png'), page._shareScope())).saved, true)
  assert.equal(saves, 1)
})

test('history recovery read failure exposes retry instead of claiming no active roam', () => {
  const definition = loadComponent('subpackageRoam/components/cy/scene-roam-history/index.js')
  const old = { wx: global.wx, getApp: global.getApp }
  let recoveryReads = 0
  global.getApp = () => ({ getUserID: () => '7' })
  global.wx = { getStorageSync(key) {
    if (key.endsWith(':sessions')) return []
    if (key.endsWith(':recovery') && ++recoveryReads === 2) throw Error('read failed')
    return null
  } }
  const component = { ...definition.methods, data: { ...definition.data }, setData(patch) { Object.assign(this.data, patch) } }
  try {
    component._load()
    assert.equal(component.data.state, 'error')
    assert.deepEqual(component.data.list, [])
    component.retry()
    assert.equal(component.data.state, 'ready')
    assert.equal(component.data.inProgress, false)
  } finally { Object.assign(global, old) }
})

// L05-084:漫游页内的历史分享入口随不可达的 roam-session 宿主删除;正文回放的点数预算仍要守。
test('旧版本千点历史在正文回放读取时受点数预算约束，不改原档', () => {
  const route = Array.from({ length: 1000 }, (_, i) => ({ lat: 31 + i * 0.0001, lng: 121 + i % 2 * 0.001 }))
  const before = JSON.stringify(route)
  const replay = require('../../subpackageRoam/components/cy/scene-roam-session/route-replay.js').buildRouteGeometry({ track: route })
  assert.ok(replay.segs.length > 0 && replay.segs.length <= 179)
  assert.equal(JSON.stringify(route), before)
})

// L05-073:历史列表只把渲染字段过 setData;原始轨迹 / 地点 / 照片留在实例上;有 geo 时不再算示意图
test('L05-073 历史卡视图模型不带原始 track / pois / photos;有坐标时 route 为空', () => {
  const def = loadComponent('subpackageRoam/components/cy/scene-roam-history/index.js')
  const track = Array.from({ length: 40 }, (_, i) => ({ lat: 31.2 + i * 0.0005, lng: 121.4 + i * 0.0005 }))
  const ctx = Object.assign({}, def.methods, { _sessions: [
    { ts: 1700000000000, zone: '外滩', distance: 1.2, shops: 2, durSec: 1800, track, pois: [{ lat: 31.2, lng: 121.4 }], photos: ['a', 'b'] },
    { ts: 1700000100000, zone: '', distance: 0.4, shops: 0, durSec: 600, track: [], pois: [], photos: [] },
  ] })
  const list = ctx._sorted()
  for (const row of list) {
    assert.equal('track' in row, false); assert.equal('pois' in row, false); assert.equal('photos' in row, false)
  }
  const withGeo = list.find((row) => row.geo)
  assert.ok(withGeo); assert.equal(withGeo.route, null); assert.equal(withGeo.stamps, 2)
  assert.ok(list.find((row) => !row.geo).route)
})
