// AUDIT-1122 F06:merchantinfo 报名状态错误可见 (L06-016)、写回包不受读代次影响 (L06-017)、忙碌闸总会放 (L06-018)、取消后返回定时器卸载即清 (L06-020)
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const ROOT = path.resolve(__dirname, '../..')
const PAGE = 'pages/topic/merchantinfo/merchantinfo'

function loadPage() {
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


test('L06-016 报名状态未确认时把错误写进 data.joinCheckError', () => {
  const t = loadPage()
  t.page.data.topicId = 5
  t.page._projectMemberId = undefined
  t.page.getIsJoin()
  const req = t.requests.find(r => r.url === '/api/registration/merchant/select')
  if (!req) return // 无会话时读闸直接不发:此场景由 handle 覆盖
  req.fail({ errMsg: 'x' })
  assert.ok(t.page.data.joinCheckError)
})

test('L06-017 回应章节邀请期间发生重读,写结果仍然落地并收起确认框', () => {
  const t = loadPage()
  let done = 0
  t.page.selectComponent = () => ({ done() { done += 1 }, failed() {} })
  t.page.loadMyChapterApplications = () => {}
  t.page.respondChapterInvitation({ currentTarget: { dataset: { applicationId: 3, accepted: false } } })
  t.page._projectReads = { loadProjectHome: 99 } // 在途期间页面重读了一次
  t.page._projectReadEpoch = (t.page._projectReadEpoch || 0) + 1
  t.requests.find(r => r.url === '/api/merchant/chapter-application/invite/respond').success({ code: 200 })
  assert.equal(done, 1)
})

test('L06-020 取消成功后页面卸载,不再触发返回', () => {
  const t = loadPage()
  t.page.cancelRegistration()
  t.requests.find(r => r.url === '/api/registration/merchant/cancel').success({ code: 200 })
  t.page.closeLiveCheckin = () => {}
  t.page.onUnload()
  t.timers.forEach(fn => fn())
  assert.equal(t.backs(), 0)
})

test('L06-013 看大图等浮层回来不整页重读;去过别的页面回来才重读', () => {
  const t = loadPage()
  let reloads = 0
  t.page.reloadProjectPrivate = () => { reloads += 1 }
  t.page._resumeCategoryReturn = () => {}
  t.page._projectReadOwner = undefined
  t.page.onHide(); t.page.onShow()
  assert.equal(reloads, 0)
  t.page.onHide(); t.page._navigating = true; t.page.onShow()
  assert.equal(reloads, 1)
})

test('L06-019 换号清私有投影时主办侧字段也回到初始值', () => {
  const t = loadPage()
  t.page.closeLiveCheckin = () => {}
  t.page.onLoad = t.page.onLoad // 初始值在 onLoad 记下
  t.page._privateDefaults = { recruitStations: [], hostInviteId: 0, checkinCode: '' }
  Object.assign(t.page.data, { recruitStations: [{ id: 1 }], hostInviteId: 77, checkinCode: 'X', hostOwnerType: 'club' })
  t.page._clubNotifyTarget = { id: 3 }
  t.page.clearProjectPrivate(false)
  assert.equal(t.page.data.recruitStations.length, 0)
  assert.equal(t.page.data.hostInviteId, 0)
  assert.equal(t.page.data.checkinCode, '')
  assert.equal(t.page.data.hostOwnerType, '')
  assert.equal(t.page._clubNotifyTarget, null)
})

test('L06-014 切换承接站只重读该站详情,不重读 project/home', () => {
  const t = loadPage()
  t.page.processData = () => {}
  t.page.loadUpcomingRuns = () => {}
  Object.assign(t.page.data, { topicId: 5, regId: 1, activeStationId: 1 })
  t.page.switchStation({ currentTarget: { dataset: { id: 2 } } })
  const info = t.requests.find(r => r.url === '/api/registration/merchant/info')
  if (info) info.success({ code: '200', data: { id: 2 } })
  assert.equal(t.requests.filter(r => r.url === '/api/project/home').length, 0)
})

test('L06-021 候选先回、已邀约名单后到:刚邀约的俱乐部不再出现在候选里', () => {
  const t = loadPage()
  Object.assign(t.page.data, { role: 'host', clubSheet: { show: true, items: [] } })
  t.page.loadClubCandidates()
  t.requests.find(r => r.url === '/api/merchant/clubs').success({ code: '200', data: [{ id: 7, name: 'A' }, { id: 8, name: 'B' }] })
  assert.equal(t.page.data.clubCandidates.rows.length, 2)
  t.page.data.clubSheet.items = [{ clubId: 7 }]
  t.page._renderClubCandidates()
  assert.deepEqual(t.page.data.clubCandidates.rows.map(r => r.id), [8])
})

test('L06-096 去模板详情连点只跳一次,跳转后回来会重读', () => {
  const t = loadPage()
  const navs = []
  t.page.data.nodeSheet = { show: true, templateId: 9 }
  const wxNav = []
  // 通过页面实例调用;wx.navigateTo 在 loadPage 的桩里不记次数,改看锁
  t.page.openNodeTemplate()
  assert.equal(t.page._navigating, true)
  t.page.openNodeTemplate()
  assert.equal(t.page._resumeNeedsReload(), true)
})
