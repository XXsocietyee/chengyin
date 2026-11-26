'use strict'

// 审计 P0-3:自由探索开放位置的招商入口 —— 招商码 / 分享卡 → 位置页 → 商家入驻 → 回到位置。
// 纯函数与页面方法都真跑(页面经 node:vm 载入,请求与跳转由夹具记录),源码正则只留给 WXML 接线。
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const ROOT = path.resolve(__dirname, '../..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const door = require('../../utils/game-door-entry.js')

// ---------- 夹具 ----------

function makeEnv(opts) {
  const o = opts || {}
  const calls = { requests: [], nav: [], storage: Object.assign({}, o.storage), removed: [] }
  const app = {
    globalData: { statusBarHeight: 20, navBarHeight: 44, user_id: o.userId === undefined ? 9 : o.userId, authorization: 'token-a' },
    getUserID() { return this.globalData.user_id },
    sendRequest(req) { calls.requests.push(req) },
    getRequestErrorMessage(res, fallback) { return (res && res.msg) || fallback },
    tips() {},
  }
  const nav = (kind) => (arg) => { calls.nav.push([kind, arg.url]); if (arg.complete) arg.complete() }
  const wx = {
    navigateTo: nav('navigateTo'), redirectTo: nav('redirectTo'), reLaunch: nav('reLaunch'), switchTab: nav('switchTab'),
    navigateBack() { calls.nav.push(['navigateBack']) },
    getStorageSync(key) { if (o.storageThrows) throw new Error('storage'); return calls.storage[key] },
    setStorageSync(key, value) { if (o.storageThrows) throw new Error('storage'); calls.storage[key] = value },
    removeStorageSync(key) { calls.removed.push(key); delete calls.storage[key] },
    getWindowInfo: () => ({ windowWidth: 375, windowHeight: 667, statusBarHeight: 20 }),
    getSystemInfoSync: () => ({ windowWidth: 375, windowHeight: 667, statusBarHeight: 20 }),
    getMenuButtonBoundingClientRect: () => ({ top: 24, bottom: 56, left: 280, right: 367, width: 87, height: 32 }),
    pageScrollTo() {},
  }
  return { calls, app, wx }
}

// 页面文件在 vm 里跑;它 require 的模块用真实现(相对页面文件解析)。
function loadPage(rel, env, overrides) {
  const file = path.join(ROOT, rel)
  let config = null
  global.getApp = () => env.app
  global.wx = env.wx
  const sandbox = {
    getApp: () => env.app,
    wx: env.wx,
    Page: (c) => { config = c },
    getCurrentPages: () => [],
    console, setTimeout, clearTimeout,
    require: (request) => {
      if (overrides && overrides[request]) return overrides[request]
      return require(path.resolve(path.dirname(file), request))
    },
  }
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file })
  assert.ok(config, rel + ' 必须注册 Page')
  const page = Object.create(config)
  page.data = JSON.parse(JSON.stringify(config.data))
  page.setData = function (patch, cb) {
    Object.keys(patch).forEach((key) => {
      const parts = key.split('.')
      let target = this.data
      while (parts.length > 1) { const k = parts.shift(); target = target[k] || (target[k] = {}) }
      target[parts[0]] = patch[key]
    })
    if (cb) cb.call(this)
  }
  return page
}

// vm 里造出来的对象原型不同源,比较前先过一遍 JSON
const plainOf = (value) => JSON.parse(JSON.stringify(value))
const lastRequest = (env, url) => env.calls.requests.filter((r) => r.url === url).pop()

// ---------- 1. scene 与落点(纯函数) ----------

test('招商码 scene rc.<主题id>.<章节id> 只认两段正整数,给出招商位置页路径', () => {
  const slotPage = '/pages/topic/merchantinfo/merchantinfo?id=12&chapterId=345'
  assert.equal(door.rcPath('rc.12.345'), slotPage)
  assert.equal(door.rcPath(encodeURIComponent(' rc.12.345 ')), slotPage)
  for (const bad of [null, undefined, '', 'rc.12', 'rc.12.', 'rc..3', 'rc.12.3.4', 'rc.a.3', 'tp.12', 'rc.0.3', 'rc.3.0', 'rc.1234567890123456789.3', 'xrc.1.2', 'rc.1.2&x=1']) {
    assert.equal(door.rcPath(bad), null, String(bad))
  }
  // 不抢其它前缀,其它前缀也不认它
  assert.equal(door.parseTopicScene('rc.12.345'), null)
  assert.equal(door.parseShopScene('rc.12.345'), null)
  assert.equal(door.parseTeamScene('rc.12.345'), null)
})

test('共用的 scene 取值不改旧前缀的口径:空 / 已解码 / 带空白 / 编码', () => {
  assert.equal(door.parseTopicScene(encodeURIComponent(' tp.12 ')), '12')
  assert.equal(door.parseActivityScene(' ac.7 '), '7')
  assert.equal(door.parseShopScene('sh.9'), '9')
  assert.equal(door.parseDoorScene(' ' + 'AB'.repeat(16) + ' '), 'ab'.repeat(16))
  for (const empty of [null, undefined, '']) {
    assert.equal(door.parseTopicScene(empty), null)
    assert.equal(door.parseDoorScene(empty), null)
  }
  assert.equal(door.parseTopicScene('%E0%A4%A'), null, '解码失败按原样判,不抛')
})

test('captureDoorScene 只在扫码 / 长按识别 / 相册进入时留下招商码', () => {
  assert.equal(door.captureDoorScene({ scene: 1047, query: { scene: 'rc.12.345' } }, null), 'rc.12.345')
  assert.equal(door.captureDoorScene({ scene: 1048, query: { scene: 'rc.12.345' } }, 'old'), 'rc.12.345')
  assert.equal(door.captureDoorScene({ scene: 1001, query: { scene: 'rc.12.345' } }, null), null)
  assert.equal(door.captureDoorScene({ scene: 1047, query: { scene: 'rc.12' } }, 'old'), 'old')
  assert.equal(door.captureDoorScene({ scene: 1047, query: { scene: 'tp.12' } }, null), 'tp.12', '旧前缀不受影响')
})

// ---------- 2. 首页把招商码送到位置页 ----------

function consumeDoorScene(options, pending) {
  const src = read('pages/index/index.js')
  const start = src.indexOf('  consumeDoorScene(options) {')
  const end = src.indexOf('const code = parseDoorScene(options && options.scene)', start)
  assert.ok(start > 0 && end > start, '首页 consumeDoorScene 的前缀分流段必须还在')
  const nav = []
  const app = { pendingDoorScene: pending }
  const wx = { redirectTo(arg) { nav.push(['redirectTo', arg.url, typeof arg.fail]) }, reLaunch(arg) { nav.push(['reLaunch', arg.url]) } }
  const fn = new Function('app', 'wx', 'door',
    'const { parseTopicScene, parseActivityScene, parseShopScene, parseTeamScene, rcPath } = door;'
    + 'return ({' + src.slice(start, end) + ' return "fallthrough"; } }).consumeDoorScene')(app, wx, door)
  return { result: fn.call({}, options), nav, app }
}

test('首页:rc 码(query 或冷启动留下的 pending)redirectTo 位置页并清掉 pending', () => {
  const direct = consumeDoorScene({ scene: 'rc.12.345' }, null)
  assert.equal(direct.result, true)
  assert.deepEqual(direct.nav, [['redirectTo', '/pages/topic/merchantinfo/merchantinfo?id=12&chapterId=345', 'function']])

  const pending = consumeDoorScene({}, 'rc.7.8')
  assert.equal(pending.result, true)
  assert.equal(pending.app.pendingDoorScene, null)
  assert.equal(pending.nav[0][1], '/pages/topic/merchantinfo/merchantinfo?id=7&chapterId=8')

  // 主题 id 为 0 的码没有落点:不跳转,交回后面的门码逻辑
  const zero = consumeDoorScene({ scene: 'rc.0.8' }, null)
  assert.equal(zero.result, 'fallthrough')
  assert.deepEqual(zero.nav, [])
  // 旧前缀照旧
  assert.equal(consumeDoorScene({ scene: 'tp.12' }, null).nav[0][1], '/pages/topic/index/index?id=12')
  assert.equal(consumeDoorScene({ scene: 'sh.201' }, null).nav[0][1], '/pages/userinfo/userinfo?userId=201&tab=about')
})

// ---------- 3. 位置页(merchantinfo) ----------

const MI = 'pages/topic/merchantinfo/merchantinfo.js'

function browsePage(options, envOpts) {
  const env = makeEnv(envOpts)
  const page = loadPage(MI, env)
  page.onLoad(options)
  return { env, page }
}

test('位置页 onLoad:id + chapterId 进浏览视图并记下位置;垃圾 chapterId 当没带', () => {
  const { page } = browsePage({ id: '12', chapterId: '345' })
  assert.equal(page.data.fromMerchantJoin, true)
  assert.equal(page.data.topicId, 12)
  assert.equal(page.data.slotChapterId, 345)
  for (const bad of [undefined, '', '0', '-1', 'abc', '3x', '1.5']) {
    assert.equal(browsePage({ id: '12', chapterId: bad }).page.data.slotChapterId, 0, String(bad))
  }
})

test('位置页:带着位置时把 chapterId 传给可承接章节接口,没带就不传', () => {
  const withSlot = browsePage({ id: '12', chapterId: '345' })
  withSlot.page.loadMerchantRecruitmentChapters()
  const req = lastRequest(withSlot.env, '/api/topic/merchant-recruitment-chapters')
  assert.deepEqual(plainOf(req.data), { id: 12, scope: '', chapterId: 345 })

  const plain = browsePage({ id: '12' })
  plain.page.loadMerchantRecruitmentChapters()
  assert.deepEqual(plainOf(lastRequest(plain.env, '/api/topic/merchant-recruitment-chapters').data), { id: 12, scope: '' })
})

test('位置页:needMerchantJoin ⇒ merchant-join 态与三种入驻状态的按钮名,不落错误态', () => {
  const cases = [['NONE', '商家入驻'], ['PENDING', '入驻审核中'], ['REJECTED', '重新申请入驻'], [undefined, '商家入驻'], ['WHATEVER', '商家入驻']]
  for (const [state, label] of cases) {
    const { env, page } = browsePage({ id: '12', chapterId: '345' })
    page.loadMerchantRecruitmentChapters()
    lastRequest(env, '/api/topic/merchant-recruitment-chapters').success({
      code: 200, data: [], needMerchantJoin: true, merchantJoinState: state, topicName: '夜游', slotName: '咖啡站',
    })
    assert.equal(page.data.chapterRecruitmentState, 'merchant-join', String(state))
    // AUDIT-1122 L06-089:未渲染的 chapterRecruitmentLoading 已删
    assert.equal(page.data.chapterRecruitmentError, '')
    assert.equal(page.data.merchantJoin.label, label)
    assert.equal(page.data.merchantJoin.slotName, '咖啡站')
    assert.deepEqual(plainOf(page.data.allChaptersList), [])
  }
  // 位置已不在招募(后端不给 slotName):入口还在,只是不点名位置
  const { env, page } = browsePage({ id: '12', chapterId: '345' })
  page.loadMerchantRecruitmentChapters()
  lastRequest(env, '/api/topic/merchant-recruitment-chapters').success({ code: 200, data: [], needMerchantJoin: true, merchantJoinState: 'NONE' })
  assert.equal(page.data.merchantJoin.slotName, '')
})

// 非商家打开浏览视图时,商家私有旁读(/api/registration/merchant/select 等)回 403。
// 它们不能抢在可承接章节接口裁决之前把整页判成「当前身份不能查看」。
const FE_TOPIC = { id: 12, name: '夜游老城', productType: 2, memberId: 77 }
const JOIN = { code: 200, data: [], needMerchantJoin: true, merchantJoinState: 'NONE', slotName: '咖啡站' }

test('位置页:非商家的旁读 403 先到 ⇒ 等裁决;裁决是待入驻就留在入驻入口', () => {
  const { env, page } = browsePage({ id: '12', chapterId: '345' })
  // AUDIT-1122 L06-092:报名状态(select)只对城市定向查,自由探索的旁读 403 来自我的点位/我的申请
  lastRequest(env, '/api/topic/info-to-user').success({ code: 200, data: FE_TOPIC })
  lastRequest(env, '/api/merchant/chapter-node/mine').success({ code: 403 })
  assert.equal(page.data.projectReadAuth, '', '裁决前不判无权')
  lastRequest(env, '/api/topic/merchant-recruitment-chapters').success(JOIN)
  lastRequest(env, '/api/merchant/chapter-application/mine').success({ code: 403 })
  assert.equal(page.data.projectReadAuth, '')
  assert.equal(page.data.chapterRecruitmentState, 'merchant-join')
  assert.equal(page.data.info.name, '夜游老城', '主题正文还在')
})

test('位置页:裁决不是待入驻(商家子账号无权 / 章节读失败)⇒ 记下的 403 照原样判无权', () => {
  for (const verdict of [(req) => req.success({ code: 200, data: [] }), (req) => req.success({ code: 500, msg: 'x' }), (req) => req.fail({})]) {
    const { env, page } = browsePage({ id: '12', chapterId: '345' })
    lastRequest(env, '/api/topic/info-to-user').success({ code: 200, data: FE_TOPIC })
    // 非商家旁读 403 先到
    lastRequest(env, '/api/merchant/chapter-node/mine').success({ code: 403 })
    assert.equal(page.data.projectReadAuth, '')
    verdict(lastRequest(env, '/api/topic/merchant-recruitment-chapters'))
    assert.equal(page.data.projectReadAuth, 'denied')
    assert.notEqual(page.data.chapterRecruitmentState, 'ready')
  }
  // 裁决已是「不是待入驻」之后再来的 403:立刻判无权(原行为)
  const late = browsePage({ id: '12' })
  lastRequest(late.env, '/api/topic/info-to-user').success({ code: 200, data: FE_TOPIC })
  lastRequest(late.env, '/api/topic/merchant-recruitment-chapters').success({ code: 200, data: [] })
  assert.equal(late.page.data.projectReadAuth, '')
  lastRequest(late.env, '/api/merchant/chapter-application/mine').success({ code: 403 })
  assert.equal(late.page.data.projectReadAuth, 'denied')
})

test('位置页:非自由探索主题没有入驻裁决 ⇒ 旁读 403 仍判无权;章节接口自己 403 也仍判无权', () => {
  const city = browsePage({ id: '12' })
  // AUDIT-1122 L06-092:城市定向在主题回来后才查报名状态
  lastRequest(city.env, '/api/topic/info-to-user').success({ code: 200, data: Object.assign({}, FE_TOPIC, { productType: 1 }) })
  lastRequest(city.env, '/api/registration/merchant/select').success({ code: 403 })
  assert.equal(city.page.data.projectReadAuth, 'denied')

  const direct = browsePage({ id: '12', chapterId: '345' })
  lastRequest(direct.env, '/api/topic/info-to-user').success({ code: 200, data: FE_TOPIC })
  lastRequest(direct.env, '/api/topic/merchant-recruitment-chapters').success({ code: 403 })
  assert.equal(direct.page.data.projectReadAuth, 'denied')
})

test('位置页:入驻入口带着主题 / 位置去入驻页,没有位置就只带主题', () => {
  const withSlot = browsePage({ id: '12', chapterId: '345' })
  withSlot.page.goMerchantJoin()
  assert.deepEqual(withSlot.env.calls.nav, [['navigateTo', '/pages/merchant/apply/index?topicId=12&chapterId=345']])
  const plain = browsePage({ id: '12' })
  plain.page.goMerchantJoin()
  assert.deepEqual(plain.env.calls.nav, [['navigateTo', '/pages/merchant/apply/index?topicId=12']])
})

test('位置页:商家带着位置进来,这一章可申请就打开选章节层(只一次);不可申请不打开', () => {
  const chapter = (id) => ({ id, name: '第' + id + '章', recruitStatus: { isOpen: true, termsMode: 'PERK', maxMerchant: 2, remainingMerchantCount: 1 } })
  const open = browsePage({ id: '12', chapterId: '345' })
  open.page.setData({ info: { productType: 2, memberId: 77 } })
  open.page.loadMerchantRecruitmentChapters()
  lastRequest(open.env, '/api/topic/merchant-recruitment-chapters').success({ code: 200, data: [chapter(1), chapter(345)] })
  assert.equal(open.page.data.chapterRecruitmentState, 'ready')
  assert.equal(open.page.data.topicShow, true)
  assert.equal(open.page.data.selectedMode, 2)
  open.page.setData({ topicShow: false })
  open.page.loadMerchantRecruitmentChapters()
  lastRequest(open.env, '/api/topic/merchant-recruitment-chapters').success({ code: 200, data: [chapter(1), chapter(345)] })
  assert.equal(open.page.data.topicShow, false, '重读章节不再自己弹出来')

  const closed = browsePage({ id: '12', chapterId: '345' })
  closed.page.setData({ info: { productType: 2, memberId: 77 } })
  closed.page.loadMerchantRecruitmentChapters()
  lastRequest(closed.env, '/api/topic/merchant-recruitment-chapters').success({ code: 200, data: [chapter(1)] })
  assert.notEqual(closed.page.data.topicShow, true)

  const picker = read('pages/topic/components/cy/chapter-target-picker/index.js')
  assert.match(picker, /focusChapterId: \{ type: Number, value: 0 \}/)
  assert.match(picker, /focusRow \? focusRow\.id : this\.data\.pickedChapterId/)
  assert.match(read('pages/topic/merchantinfo/merchantinfo.wxml'), /focus-chapter-id="\{\{slotChapterId\}\}"/)
})

test('位置页 WXML:merchant-join 态出入驻按钮(有位置名才点名),其余仍是申请承接', () => {
  const wxml = read('pages/topic/merchantinfo/merchantinfo.wxml')
  const bar = wxml.slice(wxml.indexOf('<view class="bm-btn btn1">'), wxml.indexOf('bindtap="bmClick2">{{myChapterApplications.length'))
  assert.match(bar, /<block wx:if="\{\{chapterRecruitmentState === 'merchant-join'\}\}">/)
  assert.match(bar, /wx:if="\{\{merchantJoin\.slotName\}\}">招募「\{\{merchantJoin\.slotName\}\}」<\/view>/)
  assert.match(bar, /<cy-btn variant="primary" style="width:100%" bindtap="goMerchantJoin">\{\{merchantJoin\.label\}\}<\/cy-btn>/)
  assert.match(bar, /<cy-btn wx:else variant="primary"/)
  assert.doesNotMatch(read('pages/topic/merchantinfo/merchantinfo.js'), /仅商家可查看章节承接/)
})

// ---------- 4. 主办方:招商码与分享卡 ----------

function hostPage(envOpts) {
  const env = makeEnv(envOpts)
  const page = loadPage(MI, env)
  page.setData({
    topicId: 12, role: 'host', operationScope: 'CLUB',
    hostTopic: { name: '夜游老城', img: 'https://img.example/cover.png' },
    recruitStations: [
      { chapterId: 345, name: '咖啡站', state: 'open' },
      { chapterId: 346, name: '书店站', state: 'taken' },
      { chapterId: 347, name: '酒馆站', state: 'off' },
    ],
  })
  return { env, page }
}
const tapStation = (id) => ({ detail: { act: 'showRecruitSlotQr', dataset: { id } } })

test('主办:开放位置的招商码走出码弹窗,向 /api/topic/recruit-slot-qrcode 要码', () => {
  const { env, page } = hostPage()
  page.onJoinAct(tapStation(345))
  assert.equal(page.data.checkinVisible, true)
  assert.deepEqual(plainOf(page.data.checkinSlot), { chapterId: 345, name: '咖啡站' })
  assert.equal(page.data.checkinQrState, 'loading')
  const req = lastRequest(env, '/api/topic/recruit-slot-qrcode')
  assert.equal(req.method, 'POST')
  assert.deepEqual(plainOf(req.data), { id: 12, chapterId: 345, scope: 'CLUB' })
  req.success({ code: 200, data: { qrcodeUrl: 'https://img.example/rc.png', topicId: 12, chapterId: 345 } })
  assert.equal(page.data.checkinQrState, 'ready')
  assert.equal(page.data.checkinQrUrl, 'https://img.example/rc.png')

  // 保存到相册存的是这张招商码,不去重新出主题码
  const saved = []
  page.saveCheckinImage = (url) => saved.push(url)
  page.downloadCheckinQr()
  assert.deepEqual(saved, ['https://img.example/rc.png'])
  assert.equal(env.calls.requests.filter((r) => r.url === '/api/topic/host-qrcode').length, 0)

  page.closeLiveCheckin()
  assert.equal(page.data.checkinVisible, false)
  assert.equal(page.data.checkinSlot, null, '关掉后主题码 / 本站码不再被当成招商码')
})

test('主办:招商码出错显示后端原话,重试还是要这个位置的码;迟到的旧响应不落', () => {
  const { env, page } = hostPage()
  page.onJoinAct(tapStation(345))
  lastRequest(env, '/api/topic/recruit-slot-qrcode').success({ code: 500, msg: '这个位置已经招满' })
  assert.equal(page.data.checkinQrState, 'error')
  assert.equal(page.data.checkinErr, '这个位置已经招满')

  const stale = lastRequest(env, '/api/topic/recruit-slot-qrcode')
  page.retryCheckinQr()
  const retry = lastRequest(env, '/api/topic/recruit-slot-qrcode')
  assert.notEqual(retry, stale)
  assert.equal(retry.data.chapterId, 345)
  stale.success({ code: 200, data: { qrcodeUrl: 'https://img.example/stale.png' } })
  assert.equal(page.data.checkinQrState, 'loading')
  retry.fail()
  assert.equal(page.data.checkinErr, '网络异常，请重试')
})

test('主办:已承接 / 未开放的位置不出招商码', () => {
  for (const id of [346, 347, 999]) {
    const { env, page } = hostPage()
    page.onJoinAct(tapStation(id))
    assert.equal(page.data.checkinVisible, false, String(id))
    assert.equal(env.calls.requests.length, 0)
  }
})

test('分享卡:位置按钮带出「主题 · 招募「位置」」与位置页路径;其它转发落本主题浏览页', () => {
  const { page } = hostPage()
  assert.deepEqual(plainOf(page.onShareAppMessage({ from: 'button', target: { dataset: { recruitSlot: 345 } } })), {
    title: '夜游老城 · 招募「咖啡站」',
    path: '/pages/topic/merchantinfo/merchantinfo?id=12&chapterId=345',
    imageUrl: 'https://img.example/cover.png',
  })
  assert.equal(page.onShareAppMessage({ from: 'button', target: { dataset: { recruitSlot: '345' } } }).path,
    door.rcPath('rc.12.345'), '与招商码同一个落点')
  const plain = { title: '夜游老城', path: '/pages/topic/merchantinfo/merchantinfo?id=12', imageUrl: 'https://img.example/cover.png' }
  assert.deepEqual(plainOf(page.onShareAppMessage({ from: 'menu' })), plain)
  assert.deepEqual(plainOf(page.onShareAppMessage()), plain)
  assert.deepEqual(plainOf(page.onShareAppMessage({ from: 'button', target: { dataset: { recruitSlot: 999 } } })), plain, '不认识的位置不编卡')

  page.setData({ hostTopic: { name: '夜游老城', img: '' } })
  assert.equal('imageUrl' in page.onShareAppMessage({ from: 'menu' }), false, '没有封面就让微信截图')
})

test('主办 WXML:附近商家层里有招商码与原生分享按钮,出码弹窗标题点名位置', () => {
  const host = read('pages/topic/components/project-host/index.wxml')
  const layer = host.slice(host.indexOf('title="附近商家"'), host.indexOf('title="邀约承接"'))
  assert.match(layer, /catchtap="emit" data-act="showRecruitSlotQr" data-id="\{\{ layers\.shops\.chapterId \}\}"[^>]*>招商码<\/view>/)
  assert.match(layer, /<button class="[^"]*" open-type="share" data-recruit-slot="\{\{ layers\.shops\.chapterId \}\}"/)
  const wxml = read('pages/topic/merchantinfo/merchantinfo.wxml')
  assert.match(wxml, /title="\{\{checkinSlot \? '招商码 · ' \+ checkinSlot\.name : \(checkinHost \? '本主题二维码' : '本站打卡码'\)\}\}"/)
  assert.match(wxml, /desc="\{\{checkinSlot \? '' : \(/)
})

// ---------- 5. 入驻页带着位置 ----------

const APPLY = 'pages/merchant/apply/index.js'
const KEY = 'cy_recruit_slot_return'

function applyPage(options, envOpts) {
  const env = makeEnv(envOpts)
  const roleGuard = {
    load(cb) { cb({ ownedClubs: [] }) }, hasSnapshot: () => true, clear() {}, isClubLeader: () => false, ownedClubs: () => [],
  }
  const page = loadPage(APPLY, env, { '../../../utils/roleGuard.js': roleGuard })
  page.onLoad(options)
  return { env, page }
}
// /api/merchant/info 的三种结论:没申请过 / 审核中 / 已生效
const settle = (env, data) => lastRequest(env, '/api/merchant/info').success(data === null ? { code: 200, data: null } : { code: 200, data })
const APPROVED = { id: 1, status: 1, accountStatus: 1, name: '店' }
const PENDING = { id: 1, status: 0, accountStatus: 0, name: '店' }

test('入驻页 onLoad:只认正整数的 topicId / chapterId', () => {
  assert.deepEqual(plainOf(applyPage({ topicId: '12', chapterId: '345' }).page._recruitSlot), { topicId: '12', chapterId: '345' })
  assert.deepEqual(plainOf(applyPage({ topicId: '12' }).page._recruitSlot), { topicId: '12', chapterId: '' })
  assert.deepEqual(plainOf(applyPage({ topicId: '12', chapterId: 'x' }).page._recruitSlot), { topicId: '12', chapterId: '' })
  for (const bad of [undefined, {}, { chapterId: '345' }, { topicId: '0', chapterId: '345' }, { topicId: '12x' }, { topicId: '-1' }]) {
    assert.equal(applyPage(bad).page._recruitSlot, null, JSON.stringify(bad))
  }
})

test('入驻页:带着位置提交成功 ⇒ 记下位置,「提交成功」屏回到位置页而不是首页', () => {
  const { env, page } = applyPage({ topicId: '12', chapterId: '345' })
  settle(env, null)
  assert.equal(page.data.slotReturn, true)
  page.sendRegistration(page.identityTicket(), page._submitEpoch = 1)
  lastRequest(env, '/api/merchant/merchant_registration').success({ code: 200 })
  assert.equal(page.data.step, 5)
  assert.deepEqual(plainOf(env.calls.storage[KEY]), { topicId: '12', chapterId: '345', memberId: '9' })
  page.onHome()
  assert.deepEqual(env.calls.nav, [['reLaunch', '/pages/topic/merchantinfo/merchantinfo?id=12&chapterId=345']])
})

test('入驻页:提交被拒不记位置;存储写不进去也不影响提交结果', () => {
  const rejected = applyPage({ topicId: '12', chapterId: '345' })
  settle(rejected.env, null)
  rejected.page.sendRegistration(rejected.page.identityTicket(), rejected.page._submitEpoch = 1)
  lastRequest(rejected.env, '/api/merchant/merchant_registration').success({ code: 500, msg: '资料不完整' })
  assert.equal(KEY in rejected.env.calls.storage, false)
  assert.equal(rejected.page.data.submitError, '资料不完整')

  const broken = applyPage({ topicId: '12', chapterId: '345' }, { storageThrows: true })
  settle(broken.env, null)
  broken.page.sendRegistration(broken.page.identityTicket(), broken.page._submitEpoch = 1)
  lastRequest(broken.env, '/api/merchant/merchant_registration').success({ code: 200 })
  assert.equal(broken.page.data.step, 5)
  assert.equal(broken.page.data.slotReturn, true, '参数带来的位置不靠存储')
})

test('入驻页:没带位置时一切照旧(首页 / 经营台),也不写存储', () => {
  const { env, page } = applyPage({})
  settle(env, null)
  assert.ok(!page.data.slotReturn)
  page.sendRegistration(page.identityTicket(), page._submitEpoch = 1)
  lastRequest(env, '/api/merchant/merchant_registration').success({ code: 200 })
  assert.equal(KEY in env.calls.storage, false)
  page.onHome()
  assert.deepEqual(env.calls.nav, [['switchTab', '/pages/index/index']])

  const approved = applyPage({})
  settle(approved.env, APPROVED)
  approved.page.onStatusAction()
  assert.deepEqual(approved.env.calls.nav, [['reLaunch', '/pages/merchant/index/index']])
})

test('入驻页:通过后另开小程序(不带参数)⇒ 用存下的位置进位置页,用完清掉', () => {
  const { env, page } = applyPage({}, { storage: { [KEY]: { topicId: '12', chapterId: '345', memberId: '9' } } })
  settle(env, APPROVED)
  assert.equal(page.data.mode, 'status')
  assert.equal(page.data.apply.canEnterWorkbench, true)
  assert.equal(page.data.slotReturn, true)
  page.onStatusAction()
  assert.deepEqual(env.calls.nav, [['reLaunch', '/pages/topic/merchantinfo/merchantinfo?id=12&chapterId=345']])
  assert.deepEqual(env.calls.removed, [KEY])
  assert.equal(KEY in env.calls.storage, false)
})

test('入驻页:别的账号存下的位置不认;审核中只是返回,不动存储', () => {
  const other = applyPage({}, { storage: { [KEY]: { topicId: '12', chapterId: '345', memberId: '8' } } })
  settle(other.env, APPROVED)
  assert.ok(!other.page.data.slotReturn)
  other.page.onStatusAction()
  assert.deepEqual(other.env.calls.nav, [['reLaunch', '/pages/merchant/index/index']])
  assert.deepEqual(other.env.calls.removed, [])

  const pending = applyPage({}, { storage: { [KEY]: { topicId: '12', chapterId: '345', memberId: '9' } } })
  settle(pending.env, PENDING)
  pending.page.onStatusAction()
  assert.equal(pending.env.calls.nav.some((n) => /merchantinfo/.test(n[1] || '')), false)
  assert.deepEqual(pending.env.calls.removed, [])
  assert.ok(pending.env.calls.storage[KEY], '还没通过,位置留着')
})

test('入驻页 WXML:带着位置时两颗主按钮说的是去位置,不再写首页 / 经营台', () => {
  const wxml = read('pages/merchant/apply/index.wxml')
  assert.match(wxml, /bindtap="onHome">\{\{slotReturn \? '查看招募位置' : '返回首页'\}\}<\/cy-btn>/)
  assert.match(wxml, /slotReturn && apply\.canEnterWorkbench \? '查看招募位置' : \(apply\.canEnterWorkbench \? '进入经营台' : '返回'\)/)
})
