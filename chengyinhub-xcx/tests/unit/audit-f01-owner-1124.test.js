'use strict'
// AUDIT-1122 F01 业主决定(2026-11-24,全部按默认选项)。
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ROOT = path.resolve(__dirname, '../..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
const memoryStorage = require('../helpers/memory-storage')
const PAGE = path.resolve(__dirname, '../../pages/play/index.js')

function load(user) {
  const storage = memoryStorage()
  const app = { DEV_TOKEN: 'dev-token', _loginEpoch: 0, uid: user, getUserID() { return this.uid }, getAuthorization: () => 'tok', sendRequest() {} }
  let definition
  global.getApp = () => app; global.getCurrentPages = () => []
  global.Page = (value) => { definition = value }
  global.wx = { getStorageSync: storage.getStorageSync, setStorageSync: storage.setStorageSync, removeStorageSync: storage.removeStorageSync,
    getStorageInfoSync: storage.getStorageInfoSync, nextTick(fn) { if (fn) fn() }, showToast() {}, showModal() {}, reLaunch(o) { app.relaunched = o.url } }
  delete require.cache[PAGE]; require(PAGE)
  return { definition, app, keys: () => global.wx.getStorageInfoSync().keys }
}
function realPage(definition, data, names) {
  const page = { data: Object.assign({}, definition.data, data), setData(patch, cb) {
    for (const [k, v] of Object.entries(patch)) {
      const parts = k.replace(/\[(\d+)\]/g, '.$1').split('.'); let o = this.data
      while (parts.length > 1) { const p = parts.shift(); o[p] = Array.isArray(o[p]) ? o[p].slice() : Object.assign({}, o[p]); o = o[p] }
      o[parts[0]] = v
    }
    if (cb) cb()
  } }
  for (const [name, value] of Object.entries(definition)) if (typeof value === 'function') page[name] = names.includes(name) ? value : () => {}
  return page
}
const ACCOUNT = ['_boundPlayOwner', '_playMember', '_capturePlayLoginContext', '_isPlayAccountCurrent', '_runSessionScope']
const PLAY_WXSS = read('pages/play/index.wxss')
const ruleOf = (css, sel) => {
  const i = css.indexOf(sel + ' {') >= 0 ? css.indexOf(sel + ' {') : css.indexOf(sel + '{')
  assert.ok(i >= 0, sel + ' 规则存在')
  return css.slice(i, css.indexOf('}', i))
}

test('L01-045 默认 A:整页缩小只动 transform,圆角直接到位', () => {
  const play = ruleOf(PLAY_WXSS, '.play')
  assert.match(play, /transition:transform 360ms cubic-bezier\(0\.32, 0\.72, 0, 1\);/)
  assert.doesNotMatch(play, /border-radius \d+ms/)
  assert.match(ruleOf(PLAY_WXSS, '.play--scaled'), /transform:scale\(0\.94\); border-radius:var\(--cy-radius-lg\);/)
})

test('L01-148 默认 A:纸本无配色时转场色与页面深色一致,不闪浅牛皮纸', () => {
  const lines = PLAY_WXSS.split('\n')
  const bare = lines.find((l) => /^\.look--paper \{ --look-bg:/.test(l))
  const pal = lines.find((l) => /^\.look--paper\.look-palette--default\{/.test(l))
  const val = (l, k) => (l.match(new RegExp('--look-' + k + ':\\s*(#[0-9A-F]{6})', 'i')) || [])[1]
  for (const k of ['bg', 'a', 'b']) assert.equal(val(bare, k), val(pal, k), '--look-' + k)
  assert.equal(val(bare, 'bg'), '#1D1B18')
  // 与玩家页纸本默认底色同值(look-tokens 的 --lk-bg)
  assert.match(read('pages/play/look-tokens.wxss'), /\.look--paper\.look-palette--default, \.look--paper \.atmosphere--default \{ --lk-bg:#1D1B18;/)
  // 浅纸配色(黄 / 白)仍是浅色转场,未受影响
  assert.match(PLAY_WXSS, /\.look--paper\.look-palette--yellow\{ --look-bg:#E6DCC4;/)
})

test('L01-072 默认 A:账号不是进页时那个就不读写本局记录(明确判断),卸载后同账号仍可落盘', () => {
  const storyResume = require('../../pages/play/utils/story-resume.js')
  const h = load('7')
  const page = realPage(h.definition, { topicId: 31 }, ACCOUNT)
  page._routeState = { sessionId: '9' }
  page._boundPlayOwner()
  assert.equal(page._runSessionScope().memberId, '7')
  storyResume.patch(page._runSessionScope(), { intro: true })
  assert.equal(storyResume.read(page._runSessionScope()).intro, true, '同账号读写正常')
  page._playDisposed = true
  assert.equal(page._runSessionScope().memberId, '7', '卸载标记不影响同账号落盘')
  page._playDisposed = false
  h.app.uid = '8'   // 换号
  const before = h.keys().length
  assert.equal(page._runSessionScope().memberId, '', '换号后作用域没有账号')
  assert.deepEqual(storyResume.read(page._runSessionScope()), {}, '换号后读不到上一个账号的记录')
  storyResume.patch(page._runSessionScope(), { intro: true })
  assert.equal(h.keys().length, before, '换号后不写')
  h.app.uid = '7'; h.app._loginEpoch = 1   // 同号但登出再登录(代次前进)
  assert.equal(page._runSessionScope().memberId, '')
})

const LOGIN = ['_boundPlayOwner', '_playMember', '_capturePlayLoginContext', '_isPlayAccountCurrent', '_adoptFirstLogin', 'onShow', 'reloadPlay']
function guestPage(h) {
  const page = realPage(h.definition, { topicId: 31, loading: false }, LOGIN)
  page._playOwner = h.app.getUserID() || ''
  page._playLoginContext = page._capturePlayLoginContext()
  page._playDisposed = false
  page.loads = []
  page.loadData = function (first) { if (this._isPlayAccountCurrent()) this.loads.push(first) }
  return page
}

test('L01-014 访客在本页登录后不必等 onShow,_playOwner 接上新用户并重读', () => {
  const h = load('')
  const page = realPage(h.definition, { topicId: 31, loading: false }, LOGIN.concat(['_reloadAfterGuestLogin']))
  page._playOwner = ''
  page._playLoginContext = page._capturePlayLoginContext()
  page._playDisposed = false
  page._themeHidden = false
  page.loads = []
  page.loadData = function (first) { if (this._isPlayAccountCurrent()) this.loads.push(first) }
  h.app.uid = '7'
  assert.equal(page._isPlayAccountCurrent(), true)
  assert.equal(page._playOwner, '7')
  assert.notEqual(page._playOwner, '')
  assert.deepEqual(page.loads, [true])
})

test('L01-014 默认 A:访客在本页第一次登录后,回到页面直接整页重读,不被送回首页', () => {
  const h = load('')
  const page = guestPage(h)
  assert.equal(page._isPlayAccountCurrent(), true, '访客可浏览')
  h.app.uid = '7'   // 在本页登录(访客没有会话可清,登录代次不动)
  page.onShow()
  assert.equal(h.app.relaunched, undefined, '不回首页')
  assert.equal(page._playOwner, '7')
  assert.deepEqual(page.loads, [true], '整页重读一次')
  assert.equal(page._isPlayAccountCurrent(), true, '之后的回包不再被当成换号丢弃')
})

test('L01-014 默认 A:错误态「重新登录」后的重读同样认作首次绑定', () => {
  const h = load('')
  const page = guestPage(h)
  h.app.uid = '7'
  page.reloadPlay()
  assert.deepEqual(page.loads, [true])
  assert.equal(page.data.loading, true)
})

test('L01-014 默认 A:真正换账号照旧回首页(已登录换号 / 访客登录后又登出换号)', () => {
  const h = load('7')
  const page = guestPage(h)
  h.app.uid = '8'
  page.onShow()
  assert.equal(h.app.relaunched, '/pages/index/index')
  assert.deepEqual(page.loads, [])

  const g = load('')
  const guest = guestPage(g)
  g.app.uid = '9'; g.app._loginEpoch = 1   // 中间发生过一次会话清除
  guest.onShow()
  assert.equal(g.app.relaunched, '/pages/index/index')
  assert.equal(guest._playOwner, '')
})

test('L01-039 默认 A:同队路线分享开关一律默认关闭,玩家打开后才按分享上报', async () => {
  const h = load('7')
  const page = realPage(h.definition, { gpsOk: true }, ['_teamConsentGate', 'onTeamConsentSwitch', 'onTeamConsentStart', 'closeTeamConsent'])
  assert.equal(h.definition.data.teamConsent.share, false, '初始数据就是关')
  const sent = []
  const trail = { state: () => ({ available: true, decided: false, share: true }), consent(v) { sent.push(v); return Promise.resolve({ ok: true, share: v }) }, start() { sent.push('start') }, pause() { sent.push('pause') } }
  page._ensureTeamTrail = () => trail; page._teamTrail = trail
  assert.equal(page._teamConsentGate(null), true)
  assert.deepEqual(page.data.teamConsent, { show: true, share: false }, '服务端默认 share:true 也显示为关')
  page.onTeamConsentStart()   // 直接点「开始」= 不分享
  await new Promise((r) => setImmediate(r))
  assert.deepEqual(sent.slice(0, 2), [false, 'pause'])

  page._teamConsentAsked = false; sent.length = 0
  page._teamConsentGate(null)
  page.onTeamConsentSwitch()   // 玩家自己打开
  assert.equal(page.data.teamConsent.share, true)
  page.onTeamConsentStart()
  await new Promise((r) => setImmediate(r))
  assert.deepEqual(sent, [true, 'start'])
})

test('L01-032 默认 A:按顺序闯关时手记里「此刻」之后的锁行(含紧邻的下一站)一律遮住,不露剧情文字', () => {
  const h = load('9')
  const names = Object.keys(h.definition).filter((k) => typeof h.definition[k] === 'function')
  const page = realPage(h.definition, { mode: 1 }, names)
  page.data.nodes = [
    { nodeId: 1, num: 1, sortId: 1, name: '一站', description: '一站正文', done: true, doneAt: 1 },
    { nodeId: 2, num: 2, sortId: 2, name: '二站', description: '二站正文:此刻', done: false },
    { nodeId: 3, num: 3, sortId: 3, name: '三站', description: '三站剧情:下一站的秘密', done: false },
    { nodeId: 4, num: 4, sortId: 4, name: '四站', description: '四站剧情', done: false },
  ]
  page._routeState = { routeMode: 'LINEAR' }
  page._historyNodeById = () => null
  page.buildJournal()
  const cards = page.data.journalCards
  const byId = (id) => cards.find((c) => c.nodeId === id)
  assert.equal(byId(2).kvK, '此刻')
  for (const id of [3, 4]) {
    const c = byId(id)
    assert.equal(c.locked, true)
    assert.equal(c.kvK, '前路未知')
    assert.doesNotMatch(c.kvS + c.paras.join(''), /剧情|秘密/, id + ' 不露剧情')
    assert.match(c.kvS, /^░/)
  }
})

test('L01-116 默认 A:通关勋章页用时与结束页同一写法,超过一小时显示「1 小时 5 分」', () => {
  const h = load('9')
  const page = realPage(h.definition, { allDone: true, mode: 1, topicName: '外滩回执', total: 3, doneCount: 3, finishMedalList: [], finishStamps: [] }, ['_openMedalScreen'])
  page._reviewDistanceKm = () => ''; page._reviewOrderedNodes = () => []
  const { formatRunElapsed } = require('../../utils/play-ui-contract.js')
  for (const sec of [3900, 125]) {
    page._runElapsedSeconds = () => sec
    page._openMedalScreen()
    const t = page.data.medalScreen.stats.find((s) => s.k === '用时')
    assert.equal(t.v, formatRunElapsed(sec))
  }
  page._runElapsedSeconds = () => 3900; page._openMedalScreen()
  assert.equal(page.data.medalScreen.stats.find((s) => s.k === '用时').v, '1 小时 5 分')
})

function liteOn(levelInfo) {
  const saved = global.wx
  global.wx = { getDeviceInfo: () => levelInfo }
  try { return require('../../pages/play/utils/play-look.js').readLiteDevice() } finally { global.wx = saved }
}

test('L01-008 / L01-146 默认 A:低端手机(benchmarkLevel 1–19)根节点挂 play--lite,其他手机不挂', () => {
  assert.equal(liteOn({ benchmarkLevel: 12 }), true)
  assert.equal(liteOn({ benchmarkLevel: 35 }), false)
  assert.equal(liteOn({ benchmarkLevel: -1 }), false, 'iOS / DevTools 取不到等级 = 观感不变')
  assert.equal(liteOn({}), false)
  assert.equal((() => { const s = global.wx; global.wx = { getDeviceInfo() { throw new Error('x') } }; try { return require('../../pages/play/utils/play-look.js').readLiteDevice() } finally { global.wx = s } })(), false, '取不到就按非低端')
  assert.match(read('pages/play/index.wxml').split('\n')[0], /\{\{liteDevice \? 'play--lite' : ''\}\}/)
})

test('L01-008 默认 A:低端手机去掉显形模糊,只留淡入与位移;雾散不动画字距;其他手机规则不变', () => {
  const css = PLAY_WXSS
  assert.match(css, /\.play--lite \.st-line, \.play--lite \.st-line\.is-in, \.play--lite \.tfx__c\{ filter:none; \}/)
  assert.match(css, /\.play--lite \.chfull__para\.tfx--fog, \.play--lite \.chfull__para\.tfx--fog\.is-in\{ filter:none; letter-spacing:normal; \}/)
  // 位移与淡入仍在(未被 lite 规则覆盖)
  assert.match(css.slice(css.indexOf('\n.st-line{')), /^\n\.st-line\{[^}]*opacity:0; transform:translateY\(1\.95em\) scale\(\.78\); filter:blur\(22rpx\);/, '高端机原样')
  // lite 规则写在被覆盖规则之后(同权重后者胜)
  assert.ok(css.indexOf('.play--lite .st-line') > css.indexOf('.tfx--wind .tfx__c'))
  assert.ok(css.indexOf('.play--lite .chfull__para.tfx--fog') > css.indexOf('.chfull__para.tfx--fog.is-in'))
})

test('L01-146 默认 A:卡片漂浮播三次停在静止位;低端手机外圈地环静止', () => {
  const css = PLAY_WXSS
  assert.match(css, /\.fx-card3d__float\.is-settled\{ animation:fxCardFloat 5\.6s ease-in-out 3 forwards; \}/)
  assert.match(css, /@keyframes fxCardFloat\{ 0%,100%\{ transform:translateY\(0\) rotateX\(2deg\); \}/, '首末帧相同,停住不跳')
  assert.match(css, /\.play--lite \.fx-npc__ring--o\{ animation:none; \}/)
  assert.ok(css.indexOf('.play--lite .fx-npc__ring--o') > css.indexOf('animation:npcRingSpin 14s linear infinite'))
})

test('L01-043 默认 A:故事流滚动区不再挂 mask-image;上方固定一条按氛围配色的底色遮罩,高度同裁切线', () => {
  const wxml = read('pages/play/index.wxml')
  const scroll = ruleOf(PLAY_WXSS, '.chfull__scroll')
  assert.doesNotMatch(scroll, /mask-image/)
  const cap = ruleOf(PLAY_WXSS, '.chfull__cap')
  assert.match(cap, /position:absolute; left:0; right:0; top:0; height:var\(--chfull-fade-end\);/)
  assert.match(cap, /pointer-events:none/, '不挡点击 / 滚动')
  assert.match(PLAY_WXSS, /\.chfull\[class\*="atmosphere--"\] \.chfull__cap\{ background:var\(--atmo-bg\); \}/)
  // 遮罩在滚动区之后(叠在正文上)、仍在同一舞台里,裁切线变量挂在舞台上,锚点与遮罩共用
  const stage = wxml.slice(wxml.indexOf('<view class="chfull__stage"'), wxml.indexOf('<canvas type="2d" id="stFront"'))
  assert.match(stage, /^<view class="chfull__stage" style="--chfull-fade-end:max\(340rpx, calc\(\{\{chrome\.contentTop\}\}px/)
  assert.ok(stage.indexOf('class="chfull__cap"') > stage.lastIndexOf('</scroll-view>'))
})

test('L01-044 默认 A:卡包底图与站点大图底改取最小一档缩略图放大、轻度模糊', () => {
  const wxml = read('pages/play/index.wxml')
  assert.match(wxml, /<image class="fx-bg__im" src="\{\{img\.fit\(topicCover \|\| chapter\.cover, imgCtx, 48, true\)\}\}" data-raw="\{\{topicCover \|\| chapter\.cover\}\}" binderror="onImgRenditionError"/)
  assert.match(wxml, /<image class="fx-hero__bgim" wx:if="\{\{hero\.node\.photo\}\}" src="\{\{img\.fit\(hero\.node\.photo, imgCtx, 48, true\)\}\}" data-raw="\{\{hero\.node\.photo\}\}" binderror="onImgRenditionError"/)
  assert.match(ruleOf(PLAY_WXSS, '.fx-bg__im'), /filter:blur\(8rpx\)/)
  assert.match(ruleOf(PLAY_WXSS, '.fx-hero__bgim'), /filter:blur\(8rpx\)/)
  assert.doesNotMatch(PLAY_WXSS, /blur\(60rpx\)/)
  // 槽宽 48 在 1–3 倍屏都落到出图最小档 160px(同一套 WXS 真跑)
  const src = read('utils/wxs/img.wxs')
  const mod = { exports: {} }
  const getRegExp = (p, f) => new RegExp(p, f)
  new Function('module', 'getRegExp', src)(mod, getRegExp)
  const raw = 'https://chengyin-oss.oss-cn-shanghai.aliyuncs.com/upload/' + 'a'.repeat(32) + '.jpg?Expires=1&OSSAccessKeyId=k&Signature=s'
  for (const dpr of [1, 2, 3]) assert.match(mod.exports.fit(raw, { base: 'https://x', dpr }, 48, true), /\/api\/common\/img\/160\/webp\/upload\//)
})

test('L01-037 默认 A:逐字特效只给每章前几段或较短的段,其余长段改整段浮现', () => {
  load('7')   // 装好 wx / getApp 桩
  const playLook = require('../../pages/play/utils/play-look.js')
  const host = Object.assign({ data: { chapter: { id: 5 }, isPreview: true }, _look: { style: 'PAPER', textFx: 'ink' } }, playLook.methods())
  const long = '长'.repeat(playLook.CHAR_FX_MAX_LEN + 1), short = '短句。'
  const fx = (text, i) => host._textFx({ kind: 'text', text }, i)
  const out = [fx(long, 0), fx(long, 1), fx(long, 2), fx(long, 3), fx(short, 4), fx(long, 5)]
  // 前 CHAR_FX_HEAD 段照旧逐字
  for (let i = 0; i < playLook.CHAR_FX_HEAD; i++) { assert.equal(out[i].fx, 'ink'); assert.equal(out[i].chars.length, long.length) }
  // 之后的长段:整段浮现,不再拆字
  assert.equal(out[3].fx, 'rise'); assert.equal(out[3].chars, undefined)
  assert.equal(out[5].fx, 'rise'); assert.equal(out[5].chars, undefined)
  // 之后的短段:仍逐字
  assert.equal(out[4].fx, 'ink'); assert.ok(out[4].chars.length > 0)
  // 每章从头再数
  assert.equal(fx(long, 0).chars.length, long.length)
})

test('L01-037 默认 A:闪烁只更新被挑中的那一段(路径写),不再写全局 oddFlick', () => {
  const h = load('7')
  assert.equal('oddFlick' in h.definition.data, false)
  assert.match(read('pages/play/index.wxml'), /\{\{item\.flick \? 'is-flick' : ''\}\}/)
  const page = realPage(h.definition, { chapterFull: true }, ['_clearFlick'])
  const writes = []
  const base = page.setData.bind(page)
  page.setData = (patch, cb) => { writes.push(Object.keys(patch)); base(patch, cb) }
  page.data.chapterParas = [{ i: 0, odd: 0, in: true }, { i: 1, odd: 2, in: true }, { i: 2, odd: 1, in: false }]
  // 真跑 _startStoryDust 里的定时器回调:截获 setInterval 的回调后手动触发一次
  let tickFn = null, offFn = null
  const realSI = global.setInterval, realST = global.setTimeout
  global.setInterval = (fn) => { tickFn = fn; return 1 }
  global.setTimeout = (fn) => { offFn = fn; return 2 }
  try {
    const run = h.definition._startStoryDust
    page._stopStoryDust = () => {}; page._storyStatusBar = () => {}
    page.selectComponent = () => null
    try { run.call(page) } catch (e) { /* 星点画布在桩环境里拿不到,定时器已挂上 */ }
    assert.ok(tickFn, '闪烁定时器已挂')
    const realRandom = Math.random; Math.random = () => 0
    try { tickFn() } finally { Math.random = realRandom }
    assert.deepEqual(writes.at(-1), ['chapterParas[1].flick'], '只写被挑中那一段')
    assert.equal(page.data.chapterParas[1].flick, true)
    offFn()
    assert.deepEqual(writes.at(-1), ['chapterParas[1].flick'])
    assert.equal(page.data.chapterParas[1].flick, false)
    // 闪的途中前面一段被移走、正在闪的那段下标前移:收尾仍要把它落回不闪
    const realRandom2 = Math.random; Math.random = () => 0
    try { tickFn() } finally { Math.random = realRandom2 }
    assert.equal(page.data.chapterParas[1].flick, true)
    page.data.chapterParas = page.data.chapterParas.slice(1).map((p, i) => Object.assign({}, p, { i }))
    offFn()
    assert.deepEqual(writes.at(-1), ['chapterParas[0].flick'])
    assert.equal(page.data.chapterParas.some((p) => p.flick), false)
  } finally { global.setInterval = realSI; global.setTimeout = realST }
})
