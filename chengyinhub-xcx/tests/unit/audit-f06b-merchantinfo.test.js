// AUDIT-1122 F06 pass 2 (merchantinfo). Harness copied from audit-f06-merchantinfo. First pass: merchantinfo 报名状态错误可见 (L06-016)、写回包不受读代次影响 (L06-017)、忙碌闸总会放 (L06-018)、取消后返回定时器卸载即清 (L06-020)
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const ROOT = path.resolve(__dirname, '../..')
const PAGE = 'pages/topic/merchantinfo/merchantinfo'

function loadPage(opts = {}) {
  const requests = []
  const tips = []
  const timers = []
  let backs = 0
  let config = null
  const app = {
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    sendRequest: (options) => requests.push(options),
    getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
    tips: (msg) => tips.push(msg),
    getUserID: () => opts.member || '',
  }
  const modalStub = { show: (opts) => opts.success({ confirm: true }) }
  const toastStub = Object.assign(() => {}, { success() {}, fail() {} })
  const wx = {
    getStorageSync: () => '', setStorageSync() {}, removeStorageSync() {},
    showToast() {}, showLoading() {}, hideLoading() {}, showModal() {},
    navigateBack() { backs += 1 }, navigateTo() {}, redirectTo() {}, reLaunch() {}, switchTab() {}, pageScrollTo() {},
    getSystemInfoSync: () => ({ windowWidth: 375, statusBarHeight: 20 }),
    getWindowInfo: () => ({ windowWidth: 375, statusBarHeight: 20 }),
  }
  const dir = path.resolve(ROOT, PAGE.split('/').slice(0, -1).join('/'))
  const context = {
    console,
    getApp: () => app,
    getCurrentPages: () => [{}, {}], // AUDIT-1122 L06-020:返回走 goBack,栈里有上一页才 navigateBack
    Page: (value) => { config = value },
    setTimeout: (fn) => { timers.push(fn); return timers.length },
    clearTimeout: (id) => { if (id) timers[id - 1] = () => {} },
    require: (id) => {
      const full = id.startsWith('.') ? path.resolve(dir, id) : id
      if (full.endsWith(path.join('utils', 'modal.js'))) return modalStub
      if (full.endsWith(path.join('utils', 'toast.js'))) return toastStub
      if (full.endsWith(path.join('utils', 'merchant-theme.js'))) return { merchantPageShow() {}, merchantPageRestore() {} }
      return require(full)
    },
    module: { exports: {} },
    exports: {},
    wx,
  }
  vm.runInContext(fs.readFileSync(path.join(ROOT, PAGE + '.js'), 'utf8'), vm.createContext(context), { filename: path.join(ROOT, PAGE + '.js') })
  const page = Object.assign({}, config, { data: Object.assign(JSON.parse(JSON.stringify(config.data)), { regId: 9 }) })
  page.setData = (patch) => Object.assign(page.data, patch)
  return { page, requests, tips, timers, backs: () => backs }
}



test('L06-090 浏览页场次时间为 ISO 时整页照常加载(不再解析不展示的场次时间)', () => {
  const t = loadPage()
  t.page.data.topicId = 5
  t.page._projectMemberId = undefined
  t.page._guestBrowse = true // 游客浏览:读闸放行 loadBrowseData
  t.page.loadBrowseData()
  const req = t.requests.find(r => /\/api\/topic\/info-to-(user|merchant)$/.test(r.url))
  assert.ok(req, '应发出主题详情请求')
  assert.doesNotThrow(() => req.success({ code: '200', data: { name: '夜游', omsTicketList: [{ startTime: '2026-12-01T10:00:00+08:00' }], chaptersList: [] } }))
  assert.equal(t.page.data.info && t.page.data.info.omsTicketList && t.page.data.info.omsTicketList[0].monthDayTime, undefined)
})

test('L06-089 场次只派生第几站与人数成团两项', () => {
  const t = loadPage()
  const runs = t.page.buildRuns([{ nodeOrder: 1, nodeTotal: 3, paidCount: 4, teamStatus: 0, clubName: 'x', startTime: '2026-12-01 10:00:00' }])
  assert.deepEqual(Object.keys(runs[0]).sort(), ['metaText', 'stepText'])
  assert.equal(runs[0].metaText, '4 人 · 募集中')
})

test('L06-092 自由探索主题不查报名状态;城市定向在主题回来后查一次', () => {
  for (const [productType, expected] of [[2, 0], [1, 1]]) {
    const t = loadPage({ member: '7' })
    t.page.data.fromMerchantJoin = true
    t.page.data.topicId = 5
    t.page.refreshMyChapterApplications = () => {}
    t.page.loadMerchantRecruitmentChapters = () => {}
    t.page.loadMyChapterNodes = () => {}
    t.page.loadMyChapterApplications = () => {}
    t.page.loadBrowseData()
    const info = t.requests.find(r => /info-to-(user|merchant)$/.test(r.url))
    assert.ok(info)
    info.success({ code: '200', data: { name: '夜游', productType, chaptersList: [] } })
    assert.equal(t.requests.filter(r => r.url === '/api/registration/merchant/select').length, expected)
  }
})

test('L06-093 刷新承接申请只过一次桥,状态签与快捷入口一起写', () => {
  const t = loadPage({ member: '7' })
  let calls = 0
  const orig = t.page.setData
  t.page.setData = (p) => { calls += 1; return orig(p) }
  t.page.chapterTermsMode = () => 'PERK'
  t.page.buildQuickActions = () => ['qa']
  Object.assign(t.page.data, { chapterProject: true, info: { lifecycle: 1 },
    myChapterApplications: [{ id: 1, status: 1, offerActive: 1, offerState: 'ACTIVE', chapterId: 2 }] })
  t.page.refreshMyChapterApplications()
  assert.equal(calls, 1)
  assert.equal(t.page.data.stateText, '承接中')
  assert.equal(t.page.data.quickActions[0], 'qa')
})

test('L06-095 分润方名字本页只读一次;选人时读过的群发预览打开群发直接用', () => {
  const t = loadPage({ member: '7' })
  t.page.data.profitSheet = { show: true, row: { split: { tiers: [{ key: 'a', toType: 'club', toId: 3 }] } } }
  t.page._fillTierNames([{ key: 'a', toType: 'club', toId: 3 }])
  t.requests.find(r => r.url === '/api/club/detail').success({ code: '200', data: { name: '夜跑社' } })
  t.page._fillTierNames([{ key: 'a', toType: 'club', toId: 3 }])
  assert.equal(t.requests.filter(r => r.url === '/api/club/detail').length, 1)
  assert.equal(t.page.data.profitSheet.row.split.tiers[0].name, '夜跑社')

  t.page.data.topicId = 9
  t.page.data.playerPick = { can: true, selecting: false, ids: {}, off: {}, count: 0 }
  t.page.setPlayerPick = (p) => { t.page.data.playerPick = p }
  t.page.togglePlayerPick()
  t.requests.find(r => r.url === '/api/merchant/crm/broadcast/preview').success({ code: '200', data: { topicId: 9, recipients: [{ memberId: 1, reach: 'OK' }] } })
  t.page.data.playerPick = Object.assign({}, t.page.data.playerPick, { ids: { 1: true } })
  t.page.setBroadcast = (p) => { t.page.data.broadcastSheet = Object.assign({}, t.page.data.broadcastSheet, p) }
  t.page.openBroadcast()
  assert.equal(t.requests.filter(r => r.url === '/api/merchant/crm/broadcast/preview').length, 1)
})

// 请求层的自动错误提示规则取自 app.js 原函数(运行它,不比对源码文本)
const appSource = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8')
const policyStart = appSource.indexOf('shouldAutoToastRequestError: function')
const policyEnd = appSource.indexOf('\n  },', policyStart)
const autoToast = new Function('return ({' + appSource.slice(policyStart, policyEnd + 4) + '});')().shouldAutoToastRequestError

function toastsAfter500(t, req) {
  const before = t.tips.length
  const auto = autoToast(req, { code: 500, msg: '服务忙' }) ? 1 : 0
  req.success({ code: 500, msg: '服务忙' })
  return auto + (t.tips.length - before)
}

test('L06-100 写操作失败只弹一条提示;重新确认/暂停供给连点只发一次', () => {
  const t = loadPage({ member: '7' })
  const tap = { currentTarget: { dataset: { offerId: 3 } } }
  t.page.reconfirmCircleSupply(tap)
  t.page.reconfirmCircleSupply(tap)
  const reconfirm = t.requests.filter(r => /reconfirm-current$/.test(r.url))
  assert.equal(reconfirm.length, 1, '连点只发一次')
  assert.equal(toastsAfter500(t, reconfirm[0]), 1)
  reconfirm[0].complete()
  t.page.pauseCircleSupply(tap)
  t.page.pauseCircleSupply(tap)
  const pause = t.requests.filter(r => /circle-supply\/pause$/.test(r.url))
  assert.equal(pause.length, 1, '连点只发一次')
  assert.equal(toastsAfter500(t, pause[0]), 1)
  pause[0].complete()
  t.page.reconfirmCircleSupply(tap)
  assert.equal(t.requests.filter(r => /reconfirm-current$/.test(r.url)).length, 2, '上一次结束后可再点')
  // 断网时仍有一条提示(关掉自动提示后由页面自己说)
  const before = t.tips.length
  t.requests[t.requests.length - 1].fail()
  assert.equal(t.tips.length - before, 1)

  t.page.data.topicId = 5
  t.page.reviewCircleSupplies()
  const review = t.requests.find(r => /instance\/review$/.test(r.url))
  assert.equal(toastsAfter500(t, review), 1)
  t.page.writeChapterOfferSale('/api/coop/offer/x', {}, '没改成功')
  assert.equal(toastsAfter500(t, t.requests[t.requests.length - 1]), 1)
})

test('L06-015 名单原始回包不进页面数据,切筛选仍按原名单重算', () => {
  const t = loadPage()
  t.page.setData = (patch) => Object.keys(patch).forEach((key) => {
    const parts = key.split('.'); let o = t.page.data
    parts.slice(0, -1).forEach((k) => { o = o[k] = o[k] || {} })
    o[parts[parts.length - 1]] = patch[key]
  })
  const data = { rows: [{ registrationId: 1, name: '甲', state: 'redeemed', arrived: true }, { registrationId: 2, name: '乙', state: 'pending' }], summary: { paidCount: 2 } }
  t.page.setData(t.page.buildPlayerSheet(data, 'all'))
  assert.equal(t.page.data.playerSheet.raw, undefined)
  assert.equal(t.page.data.playerSheet.rows, undefined)
  assert.equal(t.page.data.playerSheet.visibleCount, 2)
  t.page.onPlayerFilter({ currentTarget: { dataset: { key: 'arrived' } } })
  assert.equal(t.page.data.playerSheet.filter, 'arrived')
  assert.equal(t.page.data.playerSheet.groups.flatMap((g) => g.rows).map((r) => r.name).join(','), '甲')
  t.page.showPlayerSheetError('没读到')
  t.page.onPlayerFilter({ currentTarget: { dataset: { key: 'all' } } })
  assert.equal(t.page.data.playerSheet.groups.length, 0)
})

test('L06-091 商家页与主题页的内容清单、时长文案同一口径', () => {
  const t = loadPage()
  const facts = require('../../pages/topic/utils/topic-detail-facts.js')
  assert.equal(t.page.formatTimeToChinese(9000), '2小时30分钟')
  assert.equal(t.page.formatTimeToChinese(9000), facts.durationText(9000))
  const d = { totalChapterCount: 3, locationCount: 7, audioUrl: 'a.mp3', audioDuration: 600 }
  assert.equal(t.page.buildContentIncludes(d).join('|'), facts.buildContentIncludes(d).join('|'))
  assert.equal(facts.buildContentIncludes(d).join('|'), '3 个章节|7 个节点|语音导览 10 分钟')
})

test('L06-024 群发正文逐字只写正文与可发送/按钮文案,不整份回写收件人名单', () => {
  const t = loadPage()
  const patches = []
  t.page.setData = (p) => { patches.push(p); Object.keys(p).forEach((k) => { const parts = k.split('.'); let o = t.page.data; parts.slice(0, -1).forEach((x) => { o = o[x] }); o[parts[parts.length - 1]] = p[k] }) }
  t.page.data.broadcastSheet = { state: 'ready', sending: false, remaining: 3, content: '', rows: [{ id: '1', picked: true, avatar: 'a.png' }], sendText: '发送给 1 人', canSend: false }
  t.page.onBroadcastInput({ detail: { value: '周六改室内' }, currentTarget: { dataset: {} } })
  assert.deepEqual(Object.keys(patches[0]).sort(), ['broadcastSheet.canSend', 'broadcastSheet.content', 'broadcastSheet.sendText'])
  assert.equal(t.page.data.broadcastSheet.canSend, true)
  t.page.onBroadcastInput({ detail: { value: '  ' }, currentTarget: { dataset: {} } })
  assert.equal(t.page.data.broadcastSheet.canSend, false)
})

test('L06-095 发出群发后再开群发重读预览(每人每天 1 条、商家每天 3 条,旧预览不再可信)', () => {
  const t = loadPage({ member: '7' })
  t.page.setData = (p) => { Object.keys(p).forEach((k) => { const parts = k.split('.'); let o = t.page.data; parts.slice(0, -1).forEach((x) => { o = o[x] }); o[parts[parts.length - 1]] = p[k] }) }
  t.page.data.topicId = 9
  t.page.data.playerPick = { can: true, selecting: false, ids: {}, off: {}, count: 0 }
  t.page.setPlayerPick = (p) => { t.page.data.playerPick = p }
  const previews = () => t.requests.filter(r => r.url === '/api/merchant/crm/broadcast/preview')
  t.page.openBroadcast()
  previews()[0].success({ code: '200', data: { topicId: 9, merchantDailyRemaining: 3, recipients: [{ memberId: 1, reach: 'OK' }] } })
  assert.equal(t.page.data.broadcastSheet.state, 'ready')
  t.page.onBroadcastInput({ detail: { value: '周六改室内' }, currentTarget: { dataset: {} } })
  t.page.sendBroadcast()
  t.requests.find(r => r.url === '/api/merchant/crm/broadcast').success({ code: '200' })
  t.page.closeBroadcast()
  t.page.openBroadcast()
  assert.equal(previews().length, 2, '发过之后重开群发要重读预览')
  previews()[1].success({ code: '200', data: { topicId: 9, merchantDailyRemaining: 2, recipients: [{ memberId: 1, reach: 'TODAY_SENT' }] } })
  assert.equal(t.page.data.broadcastSheet.remaining, 2)
  assert.equal(t.page.data.broadcastSheet.rows[0].statusText, '今天已收到')
})
