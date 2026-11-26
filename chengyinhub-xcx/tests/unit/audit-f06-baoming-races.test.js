// AUDIT-1122 F06:报名结算页的亲子票拦截顺序、报价/候补回包竞态、付款期间 onShow 重拉、候补时间时区。
process.env.TZ = 'UTC'
const { beforeEach, test } = require('node:test')
const assert = require('node:assert/strict')

const PAGE_PATH = '../../pages/activity/baoming/baoming.js'

let config
let requests
let tips
let loadingShown

beforeEach(() => {
  config = null
  requests = []
  tips = []
  loadingShown = 0
  global.getApp = () => ({
    globalData: { user_id: 9, features: {} },
    getUserID: () => 9,
    isDevEnv: () => false,
    tips: message => tips.push(message),
    goBack() {},
    sendRequest(options) { requests.push(options) },
    recordConsent: () => Promise.resolve(),
  })
  global.Page = value => { config = value }
  global.wx = {
    getStorageSync: () => '',
    setStorageSync() {},
    removeStorageSync() {},
    getWindowInfo: () => ({ statusBarHeight: 20 }),
    getSystemInfoSync: () => ({ statusBarHeight: 20 }),
    showToast(o) { tips.push(o && o.title) },
    showModal() {},
    showLoading() { loadingShown += 1 },
    hideLoading() {},
    requestSubscribeMessage() {},
  }
})

function setByPath(target, dataPath, value) {
  const parts = dataPath.split('.')
  let cursor = target
  parts.slice(0, -1).forEach((part) => {
    if (!cursor[part] || typeof cursor[part] !== 'object') cursor[part] = {}
    cursor = cursor[part]
  })
  cursor[parts[parts.length - 1]] = value
}

function loadPage() {
  delete require.cache[require.resolve(PAGE_PATH)]
  require(PAGE_PATH)
  const page = Object.assign({}, config)
  page.data = JSON.parse(JSON.stringify(config.data))
  page.setData = function (patch, callback) {
    Object.entries(patch).forEach(([dataPath, value]) => setByPath(this.data, dataPath, value))
    if (callback) callback()
  }
  page.refreshPaymentState = () => {}
  page.checkPaymentReadiness = () => {}
  page.scheduleWaitlistOfferExpiry = () => {}
  Object.assign(page.data, {
    pageState: 'ready',
    activityId: 12,
    activityInfo: { id: 12 },
    selectedTicket: { id: 34, price: 88 },
    selectedAddress: { id: 7, fullName: '林一', mobilePhone: '13800138000' },
    userInfo: { realName: '林一', phone: '13800138000', email: '', point: 0 },
    hostShareChecked: true,
    hostShareConsentReady: true,
    totalAmount: 88,
    paymentReady: true,
    canPay: true,
  })
  page._quoteSign = 'quote-signed'
  page._signupSubscriptionRequested = false
  return page
}

const byUrl = url => requests.filter(r => r.url === url)

test('L06-002 亲子票没选年龄:在订阅/存证/isPaying/loading 之前拦下,页面不被锁住', () => {
  const page = loadPage()
  page._hostShareConsentReady = false
  page.data.selectedTicket = { id: 34, price: 88, childCount: 1, childAgeMin: 3, childAgeMax: 12 }
  page.data.childAge = null
  page.handlePayment()
  assert.equal(page.data.isPaying, false, 'isPaying 不得被置上')
  assert.equal(loadingShown, 0, '不得弹出全屏 loading')
  assert.equal(page._signupSubscriptionRequested, false, '订阅授权不得先于拦截发出')
  assert.ok(tips.includes('请选择儿童年龄'))
})

test('L06-036 报价:旧回包不覆盖最后一次报价的金额与签名', () => {
  const page = loadPage()
  page._applyQuoteFacts = function (data) { this._quoteSign = data.quoteSign }
  page.refreshQuote()
  page.refreshQuote()
  const [first, second] = byUrl('/api/registration/quote')
  second.success({ code: 200, data: { payAmount: 50, quoteSign: 'sign-B' } })
  first.success({ code: 200, data: { payAmount: 88, quoteSign: 'sign-A' } })
  assert.equal(page.data.totalAmount, 50)
  assert.equal(page._quoteSign, 'sign-B')
})

test('L06-036 报价:网络失败给出可见的重试状态', () => {
  const page = loadPage()
  page.refreshQuote()
  byUrl('/api/registration/quote')[0].fail({ errMsg: 'timeout' })
  assert.ok(page.data.submitError)
  assert.equal(page.data.quoteReady, false)
})

test('L06-037 候补状态:换票后旧票回包被丢弃,卸载后不再 setData', () => {
  const page = loadPage()
  page.refreshQuote = () => {}
  page.loadWaitlistStatus()
  const stale = byUrl('/api/club/event-ops/waitlist/status')[0]
  page.data.selectedTicket = { id: 35, price: 66 }
  stale.success({ code: 200, data: { state: 'OFFERED', eligibilityState: 'ELIGIBLE', waitlistJoinAllowed: false,
    id: 1, offerToken: 'tok-A', offerExpiresAt: '2099-01-01 10:00:00' } })
  assert.notEqual(page.data.waitlistOfferToken, 'tok-A')

  page.loadWaitlistStatus()
  const live = byUrl('/api/club/event-ops/waitlist/status')[1]
  page.onUnload()
  page.setData = () => { throw new Error('setData after unload') }
  live.fail()
})

test('L06-038 资料回包不清掉候补凭证的截止时间', () => {
  const page = loadPage()
  page._waitlistOfferExpiresAt = '2099-01-01 10:00:00'
  page.getUserInfo()
  byUrl('/api/user/info')[0].success({ code: '200', data: { phone: '13800138000', name: '林一' } })
  assert.equal(page._waitlistOfferExpiresAt, '2099-01-01 10:00:00')
})

test('L06-040 候补截止时间按中国时区解析与展示(手机在 UTC)', () => {
  const page = loadPage()
  page.refreshQuote = () => {}
  page.clockNow = () => Date.parse('2099-01-01T01:00:00Z') // 中国 09:00
  page.loadWaitlistStatus()
  byUrl('/api/club/event-ops/waitlist/status')[0].success({ code: 200, data: {
    state: 'OFFERED', eligibilityState: 'ELIGIBLE', waitlistJoinAllowed: false,
    id: 1, offerToken: 'tok', offerExpiresAt: '2099-01-01 10:00:00',
  } })
  assert.equal(page.data.waitlistState, 'OFFERED', '中国 10:00 截止、现在中国 09:00:凭证仍有效')
  assert.equal(page.data.waitlistExpiresText, '01-01 10:00')
})

test('L06-041 付款进行中回前台不重拉参与人与候补', () => {
  const page = loadPage()
  page._skipInitialShow = false
  page.data.isPaying = true
  page.onShow()
  assert.equal(requests.length, 0)
  page.data.isPaying = false
  page._workflow = { isBusy: () => true }
  page.onShow()
  assert.equal(requests.length, 0)
})

test('L06-040 中国 10:00 截止的候补凭证在中国 10:30 已过期(手机在 UTC)', () => {
  const page = loadPage()
  page.refreshQuote = () => {}
  page.clockNow = () => Date.parse('2099-01-01T02:30:00Z') // 中国 10:30
  page.loadWaitlistStatus()
  byUrl('/api/club/event-ops/waitlist/status')[0].success({ code: 200, data: {
    state: 'OFFERED', eligibilityState: 'ELIGIBLE', waitlistJoinAllowed: false,
    id: 1, offerToken: 'tok', offerExpiresAt: '2099-01-01 10:00:00',
  } })
  assert.equal(page.data.waitlistState, 'EXPIRED')
  assert.equal(page.data.waitlistOfferToken, '')
})

test('L06-141 换到已过报名截止(endTime)的票种显示 closed,不显示 available', () => {
  const page = loadPage()
  page.recalculateDiscount = () => {}
  page.loadWaitlistStatus = () => {}
  page.clockNow = () => Date.parse('2099-01-02T00:00:00Z')
  page._ticketSheetList = [{ id: 34, price: 88 }, { id: 35, price: 66, endTime: '2099-01-01 10:00:00' }]
  page.onTicketSheetSelect({ detail: { index: 1 } })
  assert.equal(page.data.selectedTicket.id, 35)
  assert.equal(page.data.signupState, 'closed')
})
