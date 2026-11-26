const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

// L05-052 / L05-054:写操作的在途闸与加载层。
function load() {
  let def
  const loading = { depth: 0 }
  const loadingPath = require.resolve(path.join(__dirname, '../../utils/loading.js'))
  const saved = require.cache[loadingPath]
  require.cache[loadingPath] = { id: loadingPath, filename: loadingPath, loaded: true,
    exports: { show() { loading.depth += 1 }, hide() { loading.depth -= 1 } } }
  const prev = { Page: global.Page, getApp: global.getApp, getCurrentPages: global.getCurrentPages, wx: global.wx }
  global.Page = c => { def = c }
  global.getApp = () => ({ globalData: { features: {} }, getUserID: () => '1', sendRequest() {} })
  global.getCurrentPages = () => []
  global.wx = { getStorageSync: () => undefined }
  delete require.cache[require.resolve('../../pages/roam/index.js')]
  require('../../pages/roam/index.js')
  Object.assign(global, prev)
  if (saved) require.cache[loadingPath] = saved; else delete require.cache[loadingPath]
  const page = Object.assign({}, def, { data: JSON.parse(JSON.stringify(def.data)) })
  page.setData = function (patch, cb) { Object.assign(this.data, patch); if (cb) cb() }
  return { page, loading }
}

test('确认地点期间换代:加载层照样撤掉、在途标记照样放掉', async () => {
  const { page, loading } = load()
  let resolve
  page._pois = [{ id: 'p', _roamId: 9, cat: 'spot' }]
  page._roamSid = 5
  page._roamWriteGeneration = 1
  page._requestRoamPoiDiscover = () => new Promise(r => { resolve = r })
  page._discoverRoamPoiById('p')
  assert.equal(loading.depth, 1)
  page._roamWriteGeneration = 2
  resolve({ ok: true })
  await new Promise(r => setImmediate(r))
  assert.equal(loading.depth, 0)
  assert.equal(page._roamPoiDiscovering, false)
})

test('探店打卡连点只发一笔', () => {
  const { page } = load()
  let sent = 0
  page._pois = [{ id: 's1', state: 'seen', cat: 'merchant' }]
  page._checkinGap = () => 0
  page._syncGoal = () => {}
  page._sendCheckin = () => { sent += 1; return Promise.resolve(true) }
  const prevWx = global.wx
  global.wx = {}
  try {
    page.startVisit('s1')
    page.startVisit('s1')
  } finally { global.wx = prevWx }
  assert.equal(sent, 1)
})

test('到达验证:同一任务在途时连点只读一次定位 (L05-029)', () => {
  const { page } = load()
  page.data.eventOverlay = { id: 5, signed: true, paused: false, status: 3, missions: [{ missionCode: 'm1', canVerifyArrival: true }] }
  page._realOn = true; page._roamSid = 9
  page._setEventFeedback = () => {}
  let reads = 0
  const prevWx = global.wx
  global.wx = { getLocation() { reads += 1 } }
  try {
    const ev = { currentTarget: { dataset: { mission: 'm1' } } }
    page.verifyEventArrival(ev); page.verifyEventArrival(ev)
  } finally { global.wx = prevWx }
  assert.equal(reads, 1)
})

test('没有当前位置时不拼 "undefined" 坐标发请求 (L05-053)', async () => {
  const { page } = load()
  page._player = null; page._roamSid = 3
  const r = await page._requestRoamPoiDiscover({ _roamId: 1 })
  assert.equal(r.ok, false)
})

test('开启定位:缓存写不进也照用这次定位;拒权时先弹窗,不在异步回调里直接 openSetting (L05-051)', () => {
  const { page } = load()
  const prevWx = global.wx
  const calls = { openSetting: 0 }
  let loaded = null
  page._loadEntryMap = (c) => { loaded = c }
  global.wx = {
    getLocation(o) { o.success({ latitude: 31.3, longitude: 121.5 }); o.complete() },
    setStorageSync() { throw new Error('full') }, getStorageSync() {},
    openSetting() { calls.openSetting += 1 },
    showModal() { calls.modal = (calls.modal || 0) + 1 },
  }
  try {
    page.enableEntryLocation()
    assert.deepEqual(loaded, { lat: 31.3, lng: 121.5 })
    global.wx.getLocation = (o) => { o.fail({}); o.complete() }
    page.enableEntryLocation()
    assert.equal(calls.openSetting, 0, '不在异步回调里直接打开设置')
  } finally { global.wx = prevWx }
})
