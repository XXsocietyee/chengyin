const { test, beforeEach, mock } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const COMPONENT = '../../pages/deregister/components/scene-settings-deregister/index.js'
const FLOW = '../../pages/deregister/deregister-flow.js'
let componentConfig
let requests
let consentCalls
let consentResult
let callOrder
let toasts
let modals

global.getApp = () => ({
  recordConsent: (input) => {
    consentCalls.push(input)
    callOrder.push('consent')
    return consentResult()
  },
  sendRequest: (request) => {
    requests.push(request)
    if (request.url === '/api/user/deregister/apply') callOrder.push('apply')
  },
  getUserID: () => 7,
})

global.wx = {
  showToast: (options) => toasts.push(options),
  navigateTo() {},
  showModal: (options) => modals.push(options),
}

global.Component = (config) => { componentConfig = config }

beforeEach(() => {
  requests = []
  consentCalls = []
  consentResult = () => Promise.reject(new Error('同意记录失败'))
  callOrder = []
  toasts = []
  modals = []
  componentConfig = null
  delete require.cache[require.resolve(COMPONENT)]
  delete require.cache[require.resolve(FLOW)]
  require(COMPONENT)
})

function makePage() {
  const page = Object.assign({}, componentConfig.methods, { data: JSON.parse(JSON.stringify(componentConfig.data)) })
  Object.assign(page.data, { status: 'ELIGIBLE', verificationMethod: 'SMS' })
  page.setData = (patch, callback) => { Object.assign(page.data, patch); if (callback) callback() }
  return page
}

test('同意记录失败时不提交注销申请', async () => {
  const page = makePage()
  page.data.confirmed = true
  page.data.smscode = '123456'

  page.apply()
  await new Promise(resolve => setImmediate(resolve))

  assert.equal(requests.filter(request => request.url === '/api/user/deregister/apply').length, 0)
  assert.deepEqual(consentCalls, [{
    docType: 'account_cancellation_notice', scene: 'account_cancel', eventType: 'AGREE',
  }])
  assert.deepEqual(toasts, [])
  assert.equal(page.data.submitting, false)
  assert.match(page.data.applyError, /同意记录失败/)
})

test('同意记录成功后才提交注销申请', async () => {
  consentResult = () => Promise.resolve()
  const page = makePage()
  page.data.confirmed = true
  page.data.smscode = '123456'

  page.apply()
  await new Promise(resolve => setImmediate(resolve))

  assert.deepEqual(callOrder, ['consent', 'apply'])
  assert.equal(requests.filter(request => request.url === '/api/user/deregister/apply').length, 1)
})

test('未知注销状态失败关闭，不得掉进永久加载或伪造可注销态', () => {
  const page = makePage()
  page.loadStatus()
  requests[0].success({ code: 200, data: { status: 'MYSTERY' } })

  assert.equal(page.data.status, 'ERROR')
  assert.match(page.data.statusError, /状态/)
  assert.equal(requests.filter(request => request.url === '/api/user/deregister/precheck').length, 0)

  page.loadPrecheck()
  requests.at(-1).success({ code: 200, data: { status: 'UNKNOWN', blockers: [] } })
  assert.equal(page.data.status, 'ERROR')
})

test('短信发送全链路单飞，失败保留内联错误且不会误报已发送', () => {
  const page = makePage()
  page.sendSms()
  page.sendSms()
  assert.equal(requests.filter(request => request.url === '/api/user/info').length, 1)

  requests[0].success({ code: 200, data: { phone: '13800138000' } })
  const sms = requests.find(request => request.url === '/api/sms/send')
  assert.ok(sms)
  page.sendSms()
  assert.equal(requests.filter(request => request.url === '/api/sms/send').length, 1)
  sms.fail({ errMsg: 'request:fail' })

  assert.equal(page.data.smsSending, false)
  assert.equal(page.data.smsSent, false)
  assert.match(page.data.smsError, /网络|发送/)
  assert.equal(sms.silentError, true)
})

test('注销提交和撤销都保持单飞，失败状态留在当前正文', async () => {
  consentResult = () => Promise.resolve()
  const page = makePage()
  Object.assign(page.data, { confirmed: true, smscode: '123456', canApply: true, status: 'ELIGIBLE' })

  page.apply()
  page.apply()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(consentCalls.length, 1)
  const applyRequest = requests.find(request => request.url === '/api/user/deregister/apply')
  assert.ok(applyRequest)
  applyRequest.success({ code: 500, msg: '验证码输入有误' })
  assert.equal(page.data.submitting, false)
  assert.match(page.data.applyError, /验证码输入有误/)

  page.data.status = 'PENDING'
  page.cancel()
  page.cancel()
  assert.equal(modals.length, 1)
  modals[0].success({ confirm: true })
  const cancelRequest = requests.find(request => request.url === '/api/user/deregister/cancel')
  assert.ok(cancelRequest)
  cancelRequest.fail({ errMsg: 'request:fail' })
  assert.equal(page.data.canceling, false)
  assert.match(page.data.cancelError, /网络|撤销/)
  assert.equal(cancelRequest.silentError, true)
})

test('状态核验失败后重试可恢复，首轮迟到回包不能覆盖新结果', () => {
  const page = makePage()
  page.loadStatus()
  const firstStatus = requests.at(-1)
  firstStatus.fail({ errMsg: 'request:fail timeout' })
  assert.equal(page.data.status, 'ERROR')

  page.loadStatus()
  const retryStatus = requests.at(-1)
  assert.notEqual(retryStatus, firstStatus)
  retryStatus.success({ code: 200, data: { status: 'NORMAL' } })
  const retryPrecheck = requests.at(-1)
  retryPrecheck.success({ code: 200, data: { status: 'ELIGIBLE', blockers: [] } })
  assert.equal(page.data.status, 'ELIGIBLE')

  const recovered = JSON.parse(JSON.stringify(page.data))
  firstStatus.success({ code: 200, data: { status: 'PENDING', executeAfter: '审核后7天' } })
  firstStatus.fail({ errMsg: 'request:fail late' })
  firstStatus.successStatusAbnormal({ code: 503 })
  assert.deepEqual(page.data, recovered)
})

test('短信链路在组件离开后不续发短信，也不接收已发送请求的迟到回包', () => {
  const beforeSms = makePage()
  beforeSms.sendSms()
  const infoRequest = requests.at(-1)
  componentConfig.lifetimes.detached.call(beforeSms)
  const infoDetachedState = JSON.parse(JSON.stringify(beforeSms.data))
  infoRequest.success({ code: 200, data: { phone: '13800138000' } })
  infoRequest.fail({ errMsg: 'request:fail late' })
  infoRequest.successStatusAbnormal({ code: 503 })
  assert.equal(requests.filter(request => request.url === '/api/sms/send').length, 0)
  assert.deepEqual(beforeSms.data, infoDetachedState)

  requests = []
  const afterSms = makePage()
  afterSms.sendSms()
  requests.at(-1).success({ code: 200, data: { phone: '13800138000' } })
  const smsRequest = requests.at(-1)
  assert.equal(smsRequest.url, '/api/sms/send')
  componentConfig.lifetimes.detached.call(afterSms)
  const smsDetachedState = JSON.parse(JSON.stringify(afterSms.data))
  smsRequest.success({ code: 200 })
  smsRequest.fail({ errMsg: 'request:fail late' })
  smsRequest.successStatusAbnormal({ code: 503 })
  assert.deepEqual(afterSms.data, smsDetachedState)
})

test('注销申请响应在组件离开后不再改写正文状态', async () => {
  consentResult = () => Promise.resolve()
  const page = makePage()
  Object.assign(page.data, { confirmed: true, smscode: '123456', canApply: true, status: 'ELIGIBLE' })
  page.apply()
  await new Promise(resolve => setImmediate(resolve))
  const applyRequest = requests.find(request => request.url === '/api/user/deregister/apply')
  assert.ok(applyRequest)

  componentConfig.lifetimes.detached.call(page)
  const detachedState = JSON.parse(JSON.stringify(page.data))
  applyRequest.success({ code: 200, data: { status: 'PENDING', executeAfter: '审核后7天' } })
  applyRequest.fail({ errMsg: 'request:fail late' })
  applyRequest.successStatusAbnormal({ code: 503 })
  assert.deepEqual(page.data, detachedState)
})

test('撤销申请响应在组件离开后不改状态，也不触发资格回读', () => {
  const page = makePage()
  page.data.status = 'PENDING'
  page.cancel()
  modals.at(-1).success({ confirm: true })
  const cancelRequest = requests.find(request => request.url === '/api/user/deregister/cancel')
  assert.ok(cancelRequest)

  componentConfig.lifetimes.detached.call(page)
  const detachedState = JSON.parse(JSON.stringify(page.data))
  const requestCount = requests.length
  cancelRequest.success({ code: 200, data: { status: 'CANCELLED' } })
  cancelRequest.fail({ errMsg: 'request:fail late' })
  cancelRequest.successStatusAbnormal({ code: 503 })
  assert.deepEqual(page.data, detachedState)
  assert.equal(requests.length, requestCount)
})

test('L10-043:验证码发送成功后 60 秒内重发不再发请求;返回页面保留尾号和已发送标记', () => {
  const wxml = fs.readFileSync(path.join(__dirname, '../../pages/deregister/components/scene-settings-deregister/index.wxml'), 'utf8')
  assert.match(wxml, /smsSending \|\| smsResendLocked \? 'is-disabled'/)
  assert.match(wxml, /aria-disabled="\{\{smsSending \|\| smsResendLocked\}\}"/)
  assert.match(wxml, /hover-class="\{\{smsSending \|\| smsResendLocked \? 'none' : 'cy-pressed'\}\}"/)
  const page = makePage()
  page.sendSms()
  requests.find(r => r.url === '/api/user/info').success({ code: 200, data: { phone: '13800138000' } })
  requests.find(r => r.url === '/api/sms/send').success({ code: 200 })
  assert.equal(page.data.smsSent, true)
  assert.equal(page.data.smsResendLocked, true, '重新发送在冷却结束前保持禁用')
  const before = requests.length
  const infoCount = requests.filter(r => r.url === '/api/user/info').length
  const smsCount = requests.filter(r => r.url === '/api/sms/send').length
  page.sendSms()
  page.sendSms()
  assert.equal(requests.length, before, '60 秒内不重发')
  assert.equal(requests.filter(r => r.url === '/api/user/info').length, infoCount)
  assert.equal(requests.filter(r => r.url === '/api/sms/send').length, smsCount)
  assert.equal(page.data.smsResendLocked, true)
  page._smsSentAt = Date.now() - 61000
  page.sendSms()
  page.sendSms()
  assert.equal(requests.length, before + 1, '冷却结束点一次只发一次')
  assert.equal(requests.at(-1).url, '/api/user/info')
  requests.at(-1).success({ code: 200, data: { phone: '13800138000' } })
  requests.filter(r => r.url === '/api/sms/send').at(-1).success({ code: 200 })
  assert.equal(page.data.smsResendLocked, true)
  assert.equal(page.data.smsSent, true)
  page.data.smscode = '654321'
  page.data.confirmed = true
  componentConfig.pageLifetimes.hide.call(page)
  componentConfig.pageLifetimes.show.call(page)
  assert.equal(page.data.smsSent, true)
  assert.equal(page.data.smsResendLocked, true, '离开再回来，冷却没结束就仍然不能重发')
  assert.equal(page.data.phoneMasked, '8000')
  assert.equal(page.data.smscode, '654321')
  assert.equal(page.data.confirmed, true)
  assert.equal(page.data.status, 'ELIGIBLE')
  const afterReturn = requests.length
  page.sendSms()
  assert.equal(requests.length, afterReturn, '回来后的冷却点击仍然不发请求')

  mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  try {
    const cooled = makePage()
    const mark = requests.length
    cooled.sendSms()
    requests.at(-1).success({ code: 200, data: { phone: '13800138000' } })
    requests.at(-1).success({ code: 200 })
    assert.equal(cooled.data.smsResendLocked, true)
    mock.timers.tick(59999)
    cooled.sendSms()
    assert.equal(requests.length, mark + 2, '差 1 毫秒仍不读手机号、不发短信')
    assert.equal(cooled.data.smsResendLocked, true)
    mock.timers.tick(1)
    assert.equal(cooled.data.smsResendLocked, false, '冷却结束才放开重新发送')
    assert.equal(cooled.data.smsSent, true)
    cooled.sendSms()
    cooled.sendSms()
    assert.equal(requests.length, mark + 3, '放开后点一次只读一次手机号')
    assert.equal(requests.at(-1).url, '/api/user/info')
  } finally {
    mock.timers.reset()
  }
})

test('L10-042:可注销时隐藏页面不取消在途短信，也不清掉验证码和确认', () => {
  const page = makePage()
  page._statusMemberId = '7'
  page.data.smscode = '654321'
  page.data.confirmed = true
  page.sendSms()
  const info = requests.find(request => request.url === '/api/user/info')
  componentConfig.pageLifetimes.hide.call(page)
  assert.equal(page.data.smsSending, true)
  assert.equal(page.data.smscode, '654321')
  assert.equal(page.data.confirmed, true)
  info.success({ code: 200, data: { phone: '13800138000' } })
  const sms = requests.find(request => request.url === '/api/sms/send')
  assert.ok(sms)
  componentConfig.pageLifetimes.show.call(page)
  assert.equal(page.data.smsSending, true)
  assert.equal(page.data.smscode, '654321')
  assert.equal(page.data.confirmed, true)
  sms.success({ code: 200 })
  assert.equal(page.data.smsSent, true)
  assert.equal(page.data.phoneMasked, '8000')
  assert.equal(page.data.smscode, '654321')
  assert.equal(page.data.confirmed, true)
  requests.filter(request => request.url === '/api/user/deregister/status').at(-1).success({ code: 200, data: { status: 'NORMAL' } })
  requests.filter(request => request.url === '/api/user/deregister/precheck').at(-1).success({
    code: 200, data: { status: 'ELIGIBLE', blockers: [], verificationMethod: 'SMS' },
  })
  assert.equal(page.data.status, 'ELIGIBLE')
  assert.equal(page.data.smsSent, true)
  assert.equal(page.data.smscode, '654321')
  assert.equal(page.data.confirmed, true)

  requests = []
  const midSend = makePage()
  midSend._statusMemberId = '7'
  Object.assign(midSend.data, { smscode: '111111', confirmed: true })
  midSend.sendSms()
  requests.find(request => request.url === '/api/user/info').success({ code: 200, data: { phone: '13800138000' } })
  const inflight = requests.find(request => request.url === '/api/sms/send')
  componentConfig.pageLifetimes.hide.call(midSend)
  inflight.success({ code: 200 })
  assert.equal(midSend.data.smsSent, true)
  assert.equal(midSend.data.phoneMasked, '8000')
  assert.equal(midSend.data.smscode, '111111')
  assert.equal(midSend.data.confirmed, true)

  requests = []
  const unloaded = makePage()
  unloaded.sendSms()
  componentConfig.pageLifetimes.hide.call(unloaded)
  componentConfig.lifetimes.detached.call(unloaded)
  requests.at(-1).success({ code: 200, data: { phone: '13800138000' } })
  assert.equal(requests.filter(request => request.url === '/api/sms/send').length, 0)
})

test('L10-201:同一次填写重试复用同一个申请编号,重新加载状态才换新编号', async () => {
  consentResult = () => Promise.resolve()
  const page = makePage()
  page.data.confirmed = true
  page.data.smscode = '123456'
  const applyIds = () => requests.filter(r => r.url === '/api/user/deregister/apply').map(r => (typeof r.data === 'string' ? JSON.parse(r.data) : r.data).requestId)
  page.apply()
  await new Promise(resolve => setImmediate(resolve))
  const first = requests.filter(r => r.url === '/api/user/deregister/apply').at(-1)
  if (first.fail) first.fail({ errMsg: 'request:fail timeout' })
  if (first.complete) first.complete()
  Object.assign(page.data, { status: 'ELIGIBLE', verificationMethod: 'SMS', submitting: false, confirmed: true, smscode: '123456' })
  page.apply()
  await new Promise(resolve => setImmediate(resolve))
  const ids = applyIds()
  assert.equal(ids.length, 2)
  assert.ok(ids[0])
  assert.equal(ids[1], ids[0], '网络失败后的重试必须带同一个申请编号')
  page.loadStatus()
  Object.assign(page.data, { status: 'ELIGIBLE', verificationMethod: 'SMS', submitting: false, confirmed: true, smscode: '123456' })
  page.apply()
  await new Promise(resolve => setImmediate(resolve))
  const after = applyIds()
  assert.notEqual(after[2], ids[0], '重新加载状态后是新的一次填写')
})
