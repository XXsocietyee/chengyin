const { test } = require('node:test')
const assert = require('node:assert/strict')

// L05-015/033/034/086:漫游 HUD 的常驻 setData 与长按手势。
function load() {
  let def
  const prev = { Page: global.Page, getApp: global.getApp, getCurrentPages: global.getCurrentPages, wx: global.wx }
  global.Page = c => { def = c }
  global.getApp = () => ({ globalData: { features: {} }, getUserID: () => '1', sendRequest() {} })
  global.getCurrentPages = () => []
  global.wx = { getStorageSync: () => undefined }
  delete require.cache[require.resolve('../../pages/roam/index.js')]
  require('../../pages/roam/index.js')
  Object.assign(global, prev)
  const page = Object.assign({}, def, { data: JSON.parse(JSON.stringify(def.data)) })
  page.writes = []
  page.setData = function (patch, cb) { this.writes.push(patch); Object.assign(this.data, patch); if (cb) cb() }
  return page
}

test('时钟每秒不再写 playHud', () => {
  const page = load()
  page._stats = { time: '' }
  page._sessionClock = { elapsedSeconds: () => 65, isPaused: () => false }
  page._rollStat = () => {}
  page._syncPlayHud()
  assert.equal(page._stats.time.length > 0, true)
  assert.equal(page.writes.some(w => 'playHud' in w), false)
  assert.equal('playHud' in page.data, false)
})

test('顶部条:没绑定活动不建;内容不变不重发', () => {
  const page = load()
  page._stats = { explorePct: 3 }
  page._syncPlayHeader()
  assert.equal(page.writes.length, 0)
  page.data.boundEvent = { id: 1, title: '活动', err: '' }
  page._syncPlayHeader(); page._syncPlayHeader()
  assert.equal(page.writes.length, 1)
  page._stats.explorePct = 4
  page._syncPlayHeader()
  assert.equal(page.writes.length, 2)
})

test('半途松开长按:取消结束,补的那记 tap 不切暂停', () => {
  const page = load()
  page.data.visit = { checkinOk: false }
  page.data.paused = false
  page._endHoldTimer = setInterval(() => {}, 1000)
  page.data.endHoldPct = 40
  page.onCenterHoldEnd()
  assert.equal(page.data.endHoldPct, 0)
  page._sessionClock = { pause() { throw new Error('不应暂停') }, resume() {} }
  page.togglePause()
  assert.equal(page.data.paused, false)
  // 下一次真正的点按照常生效
  page._sessionClock = { pause() {}, resume() {} }
  page._flushTrackLine = () => {}; page._fitRouteOverview = () => {}; page._syncPlayHud = () => {}
  page.togglePause()
  assert.equal(page.data.paused, true)
})

test('同一位置连续定位:地标卡内容不变就不再 setData (L05-036)', () => {
  const page = load()
  page._pois = [{ id: 'a', state: 'fog', cat: 'spot', lat: 31.2, lng: 121.4, name: '老洋房' }]
  page._player = { lat: 31.2002, lng: 121.4 }
  page.data.visit = { active: false }
  page.data.discoverReward = { show: false }
  page.data.nearbyPois = []
  page.data.nearbyBanner = { show: false }
  page.data.paceCard = { show: false }
  page._checkNear(page._player)
  const n = page.writes.length
  assert.ok(n >= 1)
  page._checkNear(page._player)
  page._checkNear(page._player)
  assert.equal(page.writes.length, n)
})

test('横滑商家卡:没有真照片就空着,不拿占位图冒充店面 (L05-022)', () => {
  const page = load()
  page.closeScene = () => {}
  page._fetchShopVisitors = () => {}
  page._pois = [
    { id: 1, regId: 11, cat: 'merchant', name: '没图的店', lat: 31.2, lng: 121.4, imgUrl: '/images/index-figma/nearby-card.jpg' },
    { id: 2, regId: 12, cat: 'merchant', name: '有图的店', lat: 31.2, lng: 121.4, imgUrl: 'https://x/a.jpg' },
  ]
  page._player = { lat: 31.2, lng: 121.4 }
  const prevWx = global.wx
  global.wx = { vibrateShort() {} }
  try { page.openShopStrip() } catch (e) { /* 后续 UI 收尾与本断言无关 */ } finally { global.wx = prevWx }
  const rows = (page.writes.find(w => w.shopStrip) || {}).shopStrip
  const items = rows && (rows.items || rows.rows || rows)
  assert.ok(Array.isArray(items), JSON.stringify(Object.keys(page.writes.find(w => w.shopStrip) || {})))
  assert.equal(items.find(r => r.name === '没图的店').img, '')
  assert.equal(items.find(r => r.name === '有图的店').img, 'https://x/a.jpg')
})

test('节点等级样式:坏值落回合法档位,不让 marker 同步抛错 (L05-060)', () => {
  const { getNodeLevelStyle, buildNodeLevelMarkerStyle } = require('../../pages/roam/node-level-style.js')
  for (const v of ['x', 2.5, null, undefined, 9, -1]) assert.ok(getNodeLevelStyle(v).level >= 1)
  assert.equal(getNodeLevelStyle(2.5).level, 3)
  assert.doesNotThrow(() => buildNodeLevelMarkerStyle('x'))
})

test('视野半径越大缩放越远 (L05-030)', () => {
  const page = load()
  assert.ok(page._scaleForHalfViewM(10000) < page._scaleForHalfViewM(8000))
})

// L05-056(业主默认项 A):打卡奖励只显示服务器给的数;没有就只说「已打卡」
test('打卡奖励提示用服务器值,没有服务器值只说已打卡', () => {
  for (const [poi, want] of [[{ id: 1, name: '书店', serverXp: 15, points: 15 }, '+15 探索值'], [{ id: 2, name: '奶茶', points: 30, cat: 'merchant' }, '已打卡']]) {
    const page = load()
    const toasts = []
    const prev = { wx: global.wx, getCurrentPages: global.getCurrentPages }
    global.wx = { showToast: (o) => toasts.push(o.title), getStorageSync: () => undefined }
    global.getCurrentPages = () => []
    try {
      page._pois = [Object.assign({ state: 'fog', first: false }, poi)]
      page._stats = {}; page._foundRoamPois = {}; page._sessionPhotos = []
      page._syncGoal = page._syncMarkers = page._syncSparkCircles = page._syncStats = () => {}
      page._shopBadgeThreshold = () => 3
      page.data.visit = { active: true, poi, photos: [] }
      page._finishVisit()
      assert.ok(toasts.includes(want), JSON.stringify(toasts))
    } finally { Object.assign(global, prev) }
  }
})

// L05-011(业主默认项 A):打开漫游页不记 roam_start,只有真正开一局新漫游时记一次
test('roam_start 只在真正开始新漫游时记', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../../pages/roam/index.js'), 'utf8')
  const onLoad = src.slice(src.indexOf('  onLoad(q) {'), src.indexOf('  onUnload() {'))
  assert.doesNotMatch(onLoad, /roam_start/)
  const open = src.slice(src.indexOf('  _openRoamMap(startCenter, startTracking) {'), src.indexOf('  _openRoamMap(startCenter, startTracking) {') + 600)
  assert.match(open, /if \(startTracking && !this\._roamStartedAt && !this\.data\.unfinishedRoam\) \{\n\s*this\._roamStartedAt = Date\.now\(\);\n\s*analytics\.track\('roam_start'/)
})

// L05-047(业主默认项 A):功能开关最多每 5 分钟或换账号重取一次;切回漫游页不再改 share.*
test('功能开关重取节流:5 分钟内同账号不重取,换账号或过期才重取,且不写分享数据', () => {
  const page = load()
  let loads = 0, uid = '1'
  const prev = global.getApp
  global.getApp = () => ({ getUserID: () => uid, loadFeatureFlags: () => { loads++; return Promise.resolve() }, canUseCommunity: () => true })
  try {
    page._syncCommunityEntry(); page._syncCommunityEntry()
    assert.equal(loads, 1)
    uid = '2'; page._syncCommunityEntry()
    assert.equal(loads, 2, '换账号立刻重取')
    page._flagsAt -= 5 * 60 * 1000 + 1; page._syncCommunityEntry()
    assert.equal(loads, 3, '过 5 分钟重取')
    assert.equal(page.writes.some(w => Object.keys(w).some(k => k.startsWith('share'))), false)
  } finally { global.getApp = prev }
})

// L05-040(业主默认项 B):迷雾遮罩初始化放弃(blocked)时不加按钮,自动再初始化一次;同一轮不无限重试
test('迷雾初始化放弃后自动再试一次,只试一次', () => {
  const page = load()
  const timers = []
  const prev = { wx: global.wx, setTimeout: global.setTimeout }
  global.wx = { createSelectorQuery: () => ({ select: () => ({ fields: () => ({ exec: (cb) => cb([null]) }) }) }) }
  global.setTimeout = (fn) => { timers.push(fn); return timers.length }
  try {
    let retries = 0
    page.retryScreenFog = () => { retries++ }
    page._fogLifecycleGen = 1; page._fogScreenSetupResolve = () => {}
    page._trySetupScreenFog(3, 1)
    assert.equal(page._fogMode, 'blocked')
    assert.equal(timers.length, 1, '排了一次自动重试')
    timers.shift()()
    assert.equal(retries, 1)
    page._fogScreenSetupResolve = () => {}
    page._trySetupScreenFog(3, 1)
    assert.equal(timers.length, 0, '同一轮只自动重试一次')
  } finally { Object.assign(global, prev) }
})

// L05-037(业主默认项 A):关掉的地点卡在离开约 100 米前不再自动弹;玩家自己点开的卡不被自动弹出顶掉
test('关掉的卡离开 100 米前不再自动弹,自动弹出不顶掉玩家点开的卡', () => {
  const page = load()
  const pt = (dLat) => ({ lat: 31.2 + dLat, lng: 121.4 })
  const landmark = { id: 9, name: '老洋房', cat: 'landmark', state: 'fog', lat: 31.2, lng: 121.4 }
  page._pois = [landmark]
  page.data.visit = { active: false }; page.data.discoverReward = { show: false }
  page.data.nearbyPois = []; page.data.nearbyBanner = { show: false }
  page._syncGoal = () => {}
  page._player = pt(0)
  page._checkNear(pt(0))
  assert.equal(page.data.paceCard.show, true, '走近自动弹')
  page.closePaceCard()
  page._player = pt(0.0003); page._checkNear(pt(0.0003))   // 约 33 米
  assert.equal(page.data.paceCard.show, false, '关掉后附近不再自动弹')
  page._player = pt(0.0012); page._checkNear(pt(0.0012))   // 约 133 米:离开关卡处 100 米以上
  page._player = pt(0); page._checkNear(pt(0))
  assert.equal(page.data.paceCard.show, true, '走远再回来又会弹')
  // 玩家点开另一张卡(商家横滑),自动弹出不顶掉它
  page.setData({ paceCard: { show: false, title: '', body: '', demo: false } })
  page._userCard = true; page.setData({ nearbyBanner: { show: true }, nearbyPois: [{ id: 1, groupKey: 'k' }] })
  page._checkNear(pt(0))
  assert.equal(page.data.nearbyBanner.show, true)
  assert.equal(page.data.paceCard.show, false)
})

// L05-023:三个 key 同时在滚也只用一个计时器,每帧一次 setData
test('数字滚动共用一个计时器,每帧一次 setData,滚完自停', () => {
  const page = load()
  const timers = []
  const prev = { setInterval: global.setInterval, clearInterval: global.clearInterval, now: Date.now }
  global.setInterval = (fn) => { timers.push(fn); return timers.length }
  global.clearInterval = (id) => { timers[id - 1] = null }
  let now = 1000; Date.now = () => now
  try {
    page.data.statsShown = { distance: 0, shops: 0, explorePct: 0, time: '' }
    page._rollStat('distance', 2.4); page._rollStat('shops', 3); page._rollStat('explorePct', 12)
    assert.equal(timers.length, 1)
    now += 80; timers[0]()
    assert.equal(page.writes.length, 1)
    assert.deepEqual(Object.keys(page.writes[0]), ['statsShown'])
    now += 2000; timers[0]()
    assert.equal(page.writes.length, 2)
    assert.deepEqual([page.data.statsShown.distance, page.data.statsShown.shops, page.data.statsShown.explorePct].map(String), ['2.4', '3', '12'])
    assert.equal(timers[0], null, '全部滚完计时器清掉')
  } finally { Object.assign(global, { setInterval: prev.setInterval, clearInterval: prev.clearInterval }); Date.now = prev.now }
})

// L05-024:缩放动画取整后同一级不再重发;最后一步只发一次
test('缩放动画只在取整后的级别变化时 setData,收尾只发一次', () => {
  const page = load()
  let tick
  const prev = { setInterval: global.setInterval, clearInterval: global.clearInterval }
  global.setInterval = (fn) => { tick = fn; return 1 }
  global.clearInterval = () => {}
  try {
    page.data.reducedMotion = false; page._fogMode = 'none'
    page._animateZoom(14, 17, 480, { lat: 31.2, lng: 121.4 })
    for (let i = 0; i < 12; i++) tick()
    const scales = page.writes.filter(w => 'mapScale' in w).map(w => w.mapScale)
    assert.deepEqual(scales, [...new Set(scales)].sort((a, b) => a - b), '每级只发一次')
    assert.equal(scales.at(-1), 17)
    assert.ok(scales.length <= 4, '12 步里最多 4 次 setData,实际 ' + scales.length)
    assert.equal(page._zoomLock, false)
  } finally { Object.assign(global, prev) }
})

// L05-007:三个画图器共用 #iconcv,串行排队;静态图标只画一次,不再清掉门店形象 / 玩家头像 / 同城玩家图标
test('图标画图器串行排队;静态图标只画一次且不清掉已有图标', async () => {
  const page = load()
  const order = []
  let release
  page._paintStaticIcons = function () { order.push('static:start'); return new Promise((r) => { release = () => { this._icons.player = 'default'; this._staticIconsReady = true; order.push('static:end'); r(true) } }) }
  page._paintRunnerIcons = async function () { order.push('runner'); this._icons['runner-1'] = 'r1'; return true }
  page._icons = { 'npc-a': 'kept' }
  const a = page._genIcons(); const b = page._genRunnerIcons()
  await Promise.resolve(); await Promise.resolve()
  assert.deepEqual(order, ['static:start'], '第二个画图器排在后面,不与第一个抢画布')
  release(); await a; await b
  assert.deepEqual(order, ['static:start', 'static:end', 'runner'])
  assert.equal(page._icons['npc-a'], 'kept')
  assert.equal(await page._genIcons(), false, '静态图标已画好:再拉 POI 不重画')
})

// L05-009:走路时每新到一格不再整份落盘;首格立刻建钥匙落盘,之后最多每 10 秒一次,整份保存会取消排队
test('恢复记录:首格立刻落盘,之后合并成每 10 秒一次;整份保存取消排队', () => {
  const page = load()
  const timers = []
  const prev = { setTimeout: global.setTimeout, clearTimeout: global.clearTimeout }
  global.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length }
  global.clearTimeout = (id) => { if (timers[id - 1]) timers[id - 1].fn = null }
  try {
    let ensured = 0, saved = 0
    page._ensureRoamRecovery = () => { ensured++; page._clientSessionKey = 'k'; return Promise.resolve(true) }
    const realSave = page._saveRoamRecovery
    page._saveRoamRecovery = function () { saved++; return realSave.call(Object.assign(this, { _roamRecoveryAbandoned: true })) }
    page._queueRecoverySave()
    assert.equal(ensured, 1)
    for (let i = 0; i < 20; i++) page._queueRecoverySave()
    assert.equal(saved, 0); assert.equal(timers.length, 1); assert.equal(timers[0].ms, 10000)
    timers[0].fn(); assert.equal(saved, 1)
    page._queueRecoverySave(); assert.equal(timers.length, 2)
    page._saveRoamRecovery(); assert.equal(timers[1].fn, null, '整份保存取消排队的这次')
  } finally { Object.assign(global, prev) }
})

// L05-057:每个页面实例第一次出雾图前清掉上次闪退留下的 roam_screen_fog_*.png,当前图层在用的不动
test('雾图残留文件:首次出图前扫一次,只删雾图且不删在用的', () => {
  const page = load()
  const removed = []
  const prev = global.wx
  global.wx = { env: { USER_DATA_PATH: 'wxfile://usr' }, getFileSystemManager: () => ({
    readdirSync: () => ['roam_screen_fog_1.png', 'roam_screen_fog_37.png', 'other.png', 'roam_screen_fog_x.png'],
    unlinkSync: (p) => removed.push(p) }) }
  try {
    page.data.fogScreenLayers = [{ src: 'wxfile://usr/roam_screen_fog_1.png' }]
    page._sweepStaleFogFiles()
    assert.deepEqual(removed, ['wxfile://usr/roam_screen_fog_37.png'])
    assert.equal(page._fogFilesSwept, true)
  } finally { global.wx = prev }
})

// L05-061:目标没变不再 setData;marker 照常同步
test('目标层:内容不变不重发 setData,marker 仍同步', () => {
  const page = load()
  let synced = 0
  page._syncMarkers = () => { synced++ }
  page.data.visit = { active: false }; page.data.nearbyPois = []
  page._syncGoal(); page._syncGoal(); page._syncGoal()
  assert.equal(page.writes.filter(w => 'goal' in w).length, 1)
  assert.equal(synced, 3)
  page.data.visit = { active: true, poi: { name: '某店' } }
  page._syncGoal()
  assert.equal(page.writes.filter(w => 'goal' in w).length, 2)
})

// L05-100:没坐标的目录地点不给「导航」按钮(placeView 的 lat 是 NaN 不是 null)
test('入口地点卡:坐标不全时 navigable 为 false', () => {
  const page = load()
  global.wx = Object.assign(global.wx || {}, { nextTick: () => {} })
  page._showEntrySheet('place', null, { name: 'A', lat: NaN, lng: 121 })
  assert.equal(page.data.entryPlace.navigable, false)
  page._showEntrySheet('place', null, { name: 'B', lat: 31.2, lng: 121.4 })
  assert.equal(page.data.entryPlace.navigable, true)
})

// 复核 #945(H05-R2 / B05-R1):后台计时器会被挂起 —— 有排队中的保存时,切后台 / 卸载即落盘,不只看会话时钟;
// 结算回执清掉恢复记录前先撤掉排队的保存,10 秒后不会把已结束的漫游写回「未完成」。
test('恢复记录:暂停中(无会话时钟)切后台,排队中的保存立刻落盘', () => {
  for (const hook of ['onHide', 'onUnload']) {
    const page = load()
    let saved = 0
    page._sessionClock = null
    page._recoverySaveTimer = 7
    page._saveRoamRecovery = () => { saved++; return true }
    try { page[hook]() } catch (e) { /* 其余收尾依赖的桩不在本用例范围 */ }
    assert.equal(saved, 1, hook)
  }
})

test('恢复记录:结算清记录时撤掉排队的保存', () => {
  const src = require('node:fs').readFileSync(require.resolve('../../pages/roam/index.js'), 'utf8')
  const at = src.indexOf("if (!memory.writeRecovery(null)) return this._recoveryFailure('结果已确认")
  assert.ok(at > 0)
  const before = src.slice(at - 260, at)
  assert.match(before, /clearTimeout\(this\._recoverySaveTimer\); this\._recoverySaveTimer = null;/)
})
