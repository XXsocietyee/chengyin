const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')

const PAGE = '../../pages/index/index.js'
let pageConfig
let sent
let userId
let reloginCalls
let roleUpdates
let isDev
let redirects

global.getApp = () => ({
  isDevEnv: () => isDev,
  getUserID: () => userId,
  getUserType: () => 0,
  getUserRole: () => 'user',
  getImgUrl: (value) => value,
  sendRequest: (request) => { sent.push(request) },
  reLogin: () => { reloginCalls += 1 },
  setUserRole: (role) => { roleUpdates.push(role) },
  setUserType() {},
  setOpenID() {},
  tips() {},
  // 首页 onShow 会挂在"登录已落地"信号上复判身份(见 index-identity-recheck-after-login)。
  // 本文件的 storage 桩恒返回空 ⇒ 复判判定为玩家、当场返回,不影响下面这些用例。
  waitForAppReady: () => Promise.resolve(),
})

global.wx = {
  getStorageSync: () => '',
  setStorageSync() {},
  removeStorageSync() {},
  showToast() {},
  showLoading() {},
  hideLoading() {},
  hideTabBar() {},
  setNavigationBarColor() {},
  navigateTo() {},
  redirectTo(options) { redirects.push(options.url) },
  switchTab() {},
  getWindowInfo: () => ({ statusBarHeight: 20, screenHeight: 812, windowHeight: 812, windowWidth: 375 }),
  getSystemInfoSync: () => ({ statusBarHeight: 20, screenHeight: 812, windowHeight: 812, windowWidth: 375 }),
  getMenuButtonBoundingClientRect: () => ({ top: 24, height: 32, right: 360, left: 280 }),
}

global.Page = (config) => { pageConfig = config }

beforeEach(() => {
  sent = []
  userId = 'member-1'
  reloginCalls = 0
  roleUpdates = []
  redirects = []
  isDev = false
  pageConfig = null
  delete require.cache[require.resolve(PAGE)]
  require(PAGE)
})

function makePage() {
  const page = Object.assign({}, pageConfig, { data: JSON.parse(JSON.stringify(pageConfig.data)) })
  page.setData = (patch, callback) => {
    Object.keys(patch).forEach((key) => { page.data[key] = patch[key] })
    if (callback) callback()
  }
  global.getCurrentPages = () => [page]
  return page
}

test('旧账号的用户资料响应不能覆盖新账号', () => {
  const page = makePage()
  page.getUserData()
  assert.equal(sent.length, 1)

  userId = 'member-2'
  sent[0].success({ code: '200', data: { nickname: '旧账号', phone: '13800000000' } })

  assert.notEqual(page.data.userInfo.nickname, '旧账号')
})

test('当前账号的用户资料响应可以正常写入', () => {
  const page = makePage()
  page.getUserData()

  sent[0].success({ code: '200', data: { nickname: '当前账号', phone: '13800000000' } })

  assert.equal(page.data.userInfo.nickname, '当前账号')
})

test('未绑定手机号的账号回到首页不会被主动弹窗索取手机号(F-L5C-04)', () => {
  const page = makePage()
  for (let i = 0; i < 3; i += 1) {
    sent = []
    page.getUserData()
    sent[0].success({ code: '200', data: { nickname: '无手机号', phone: '' } })
    assert.equal(page.data.userInfo.nickname, '无手机号')
    assert.equal(page.data.showPhoneModal, undefined)
  }
})

test('当前账号的角色响应可以更新身份快照', () => {
  const page = makePage()
  page.fetchCityEvent = () => {}

  page.getUserData() // L10-019:角色兜底合进 getUserData(onShow 100ms 后经它发出),不再单独发一次
  const request = sent.find(request => request.url === '/api/user/info')
  assert.ok(request)
  request.success({ code: '200', data: { role: 'user', userType: 0 } })

  assert.deepEqual(roleUpdates, [{ role: 'user', userType: 0 }])
})

test('旧账号的角色响应不能更新新账号身份快照', () => {
  const page = makePage()
  page.fetchCityEvent = () => {}

  page.getUserData() // L10-019:角色兜底合进 getUserData(onShow 100ms 后经它发出),不再单独发一次
  const request = sent.find(request => request.url === '/api/user/info')
  assert.ok(request)
  userId = 'member-2'
  request.success({ code: '200', data: { role: 'merchant', userType: 2 } })

  assert.deepEqual(roleUpdates, [])
})

test('换号时立即清空已显示的旧账号资料，后续请求失败也不恢复', () => {
  const page = makePage()
  page._privateDataMemberId = 'member-1'
  page._privateDataEpoch = 1
  page.data.userInfo = { avatar: 'old.png', nickname: '旧账号', point: '88' }
  userId = 'member-2'

  page.getUserData()

  assert.deepEqual(page.data.userInfo, { avatar: '', nickname: '', point: '0' })
  assert.equal(page.data.showPhoneModal, undefined)
  sent[0].fail({ errMsg: 'request:fail timeout' })
  assert.deepEqual(page.data.userInfo, { avatar: '', nickname: '', point: '0' })
})

test('开始重新登录后，同账号的旧响应也不能回写', () => {
  const page = makePage()
  page.getUserData()
  page.firstLogin()
  assert.equal(reloginCalls, 1)

  sent[0].success({ code: '200', data: { nickname: '旧会话', phone: '13800000000' } })

  assert.notEqual(page.data.userInfo.nickname, '旧会话')
})

test('首页卸载后私人资料的迟到响应不能继续写页', () => {
  const page = makePage()
  page.getUserData()
  const profileRequest = sent[0]

  page.onUnload()
  profileRequest.success({ code: '200', data: { nickname: '卸载后资料', phone: '13800000000' } })

  assert.notEqual(page.data.userInfo.nickname, '卸载后资料')
})

// 2026-10-27 真机走查 P-08:owner 要求玩家首页删掉「继续探索 / 继续游戏」卡，
// 首页不再请求 /api/registration/my-joined 与 /api/play/run-session/list,也不再持有 continueExplore。
test('P-08:首页不再加载继续旅程卡', () => {
  const page = makePage()
  assert.equal(page.loadContinueExplore, undefined)
  assert.equal(page.goContinueExplore, undefined)
  assert.equal('continueExplore' in page.data, false)
})

test('首页再次显示时刷新当前账号资料(继续旅程卡已随 P-08 删除)', async () => {
  const page = makePage()
  const calls = []
  page.data.isAppReady = true
  page.fetchCityEvent = () => {}
  page.getUserData = () => calls.push('profile')

  page.onShow()
  await new Promise(resolve => setTimeout(resolve, 120))

  assert.deepEqual(calls, ['profile'])
})

test('开发环境首页也不注入示例用户或假公开列表', () => {
  const page = makePage()
  isDev = true
  userId = ''

  assert.deepEqual(page.data.userInfo, { avatar: '', nickname: '', point: '0' })
  assert.equal(page.data.nearbyActivityList.length, 0, '真实列表为空不能伪造公开内容')
})

test('游客态不重试私人资料请求，也不显示登录过期错误', () => {
  const page = makePage()
  userId = ''
  let scheduled = 0
  const originalSetTimeout = global.setTimeout
  global.setTimeout = () => { scheduled += 1 }
  try {
    page.getUserData()
  } finally {
    global.setTimeout = originalSetTimeout
  }

  assert.equal(scheduled, 0)
  assert.equal(sent.length, 0)
})

test('推荐卡报名数读 signupCount，不读对不上后端的 enrollCount', () => {
  const page = makePage()
  page.data.recommendedTopicList = [{
    id: 9,
    name: '外滩夜行',
    signupCount: 28,
    enrollCount: undefined,
    joinCount: undefined,
    signUpCount: undefined,
  }]
  page._buildRecoHero()
  assert.match(page.data.recoCards[0].metaLine, /28 人已报名/)
})

// 需求变更(F-L5C-04 / F-W1-14):首页不再主动弹窗索取手机号,原"稍后 24 小时再弹"的口径作废。
test('首页真实资料回读不按稍后期限再弹，任何账号、任何次数都不弹', () => {
 const store = {}; wx.getStorageSync = key => store[key]; wx.setStorageSync = (key,value) => {store[key]=value};
 userId='7'; const page=makePage(); page.getUserData();sent[0].success({code:200,data:{phone:''}});
 assert.equal(page.data.showPhoneModal,undefined);
 store['phone-reminder:snooze:7']=0;
 page.getUserData();sent[1].success({code:200,data:{phone:''}});assert.equal(page.data.showPhoneModal,undefined);
 userId='8';page.getUserData();sent[2].success({code:200,data:{phone:''}});assert.equal(page.data.showPhoneModal,undefined);
 wx.getStorageSync=()=>'';wx.setStorageSync=()=>{};
});

const checkinAccess = {
  active: true,
  merchant: { id: 8003, name: '本店' },
  roleCode: 'MERCHANT_CHECKIN',
  permissions: ['merchant:basic:read', 'merchant:verify', 'merchant:verify:record:read'],
}

test('M-15:player成员的有效核销权限进入现有工作台，不改成员角色', () => {
  const page = makePage()
  page.loadOperatorAccess()
  assert.equal(sent[0].url, '/api/merchant/access/me')
  assert.equal(sent[0].method, 'POST')
  sent[0].success({ code: 200, data: checkinAccess })
  assert.deepEqual(redirects, ['/pages/merchant/index/index'])
  assert.equal(page.data._needsRedirect, true)
  assert.deepEqual(roleUpdates, [])
})

test('M-15:onShow刷新核销权限，失效和请求失败不沿用旧权限', () => {
  const page = makePage()
  page.fetchCityEvent = () => {}
  page.data.isAppReady = true // L10-020:appReady 之前由 waitForAppReady 那一路发
  page.onShow()
  const request = sent.find(request => request.url === '/api/merchant/access/me')
  assert.ok(request)
  request.success({ code: 200, data: { active: false, applicationState: 'NONE' } })
  assert.deepEqual(redirects, [])
  assert.equal(page.data._needsRedirect, false)
  page.onShow()
  assert.deepEqual(redirects, [], '未收到有效权限前不跳工作台')
})

test('M-15:无权限、失效、错误或畸形access不进入工作台', () => {
  for (const response of [
    null,
    undefined,
    { code: 200, data: { active: false, applicationState: 'NONE' } },
    { code: 200, data: { ...checkinAccess, permissions: ['merchant:basic:read'] } },
    { code: 200, data: { ...checkinAccess, merchant: null } },
    { code: 500, data: checkinAccess },
  ]) {
    sent = []
    const page = makePage()
    page.loadOperatorAccess()
    sent[0].success(response)
    assert.deepEqual(redirects, [])
  }
})

test('M-15:换号、隐藏、卸载、离页和上一轮请求的迟到权限不触发跳转', () => {
  for (const change of [
    page => { userId = 'member-2' },
    page => page.onHide(),
    page => page.onUnload(),
    page => { global.getCurrentPages = () => [page, {}] },
    page => page.loadOperatorAccess(),
  ]) {
    sent = []
    userId = 'member-1'
    const page = makePage()
    page.loadOperatorAccess()
    const request = sent[0]
    change(page)
    request.success({ code: 200, data: checkinAccess })
    assert.deepEqual(redirects, [])
  }
})

test('M-15:游客和显式玩家调试视角不请求经营入口', () => {
  const originalRead = wx.getStorageSync
  try {
    for (const id of ['', 'member-1']) {
      sent = []
      userId = id
      wx.getStorageSync = key => key === 'debug_user_view' ? 'user' : ''
      const page = makePage()
      page.loadOperatorAccess()
      assert.equal(sent.length, 0)
      assert.deepEqual(redirects, [])
    }
  } finally { wx.getStorageSync = originalRead }
})

test('L10-019/L10-020:onShow 不再直接发 /api/user/info;appReady 前不发 access/me', () => {
  const page = makePage()
  page.fetchCityEvent = () => {}
  page.onShow()
  assert.equal(sent.filter(r => r.url === '/api/user/info').length, 0)
  assert.equal(sent.filter(r => r.url === '/api/merchant/access/me').length, 0)
  page.onHide()
})

test('L10-023:user/info 连续 401 时页面层最多重登一次', () => {
  const page = makePage()
  let relogins = 0
  page.firstLogin = () => { relogins += 1 }
  for (let i = 0; i < 3; i += 1) {
    sent = []
    page.getUserData()
    sent[0].success({ code: '401' })
  }
  assert.equal(relogins, 1)
  sent = []
  page.getUserData()
  sent[0].success({ code: '200', data: { nickname: 'ok' } })
  sent = []
  page.getUserData()
  sent[0].success({ code: '401' })
  assert.equal(relogins, 2, '成功一次后计数复位')
})

test('L10-021:首页刷新只加载当前分栏的底部列表', () => {
  for (const [tab, topic, activity] of [['0', 1, 0], ['1', 0, 1]]) {
    const page = makePage()
    page.data.activeTab = tab
    let topics = 0, activities = 0
    page.loadBottomTopicList = () => { topics += 1 }
    page.loadBottomActivityList = () => { activities += 1 }
    page.getListData = () => {}
    page.getUserData = () => {}
    page.loadContinueExplore = () => {}
    page.loadPageData()
    assert.deepEqual([topics, activities], [topic, activity])
  }
})
