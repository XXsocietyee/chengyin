// Lane DEC-F03(2026-11-24):业主对 F03 主题编辑页「需业主决定」各项选了默认 A,这里钉住落地行为。
//   L03-006 没填的票价保持为空(城市定向拦「请填写票价」,自由探索 = 开售前定价;只有真填的 0 才是 0)
//   L03-050 / L04-023 票价与活动发布同一套检查(数字、最多两位小数、上限 99999.99、栏内报错)
//   L03-044 招募两个金额都限两位小数、大于 0、提交前保持原样
//   L03-060 所有票种按同一份字段清单上送;L03-193 合法票价 / 自玩价统一成两位小数字符串
// 走真实发布路径:打开票种编辑器 → 不填票价 → 打开发布检查点 → 发布,断言请求体与报错。
const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')

const FABU = '../../pages/publish/fabu/index.js'

let sent
let storage
let toasts
let pageConfig

global.getApp = () => ({
  globalData: { statusBarHeight: 20, navBarHeight: 44 },
  sendRequest: (options) => { sent.push(options) },
  tips: () => {},
  getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
  chooseImage: () => {},
  getUserID: () => 42,
  getNickname: () => '登录作者',
  getAvatar: () => '',
  getUserInfo: () => null,
  getToken: () => '',
  getAuthorization: () => 'token',
})
global.wx = {
  getStorageSync: (key) => storage[key],
  setStorageSync: (key, value) => { storage[key] = value },
  removeStorageSync: (key) => { delete storage[key] },
  getSystemInfoSync: () => ({ windowWidth: 375 }),
  showToast: (options) => { toasts.push(options && options.title) },
  showLoading: () => {},
  hideLoading: () => {},
  showModal: (options) => { if (options.success) options.success({ confirm: true }) },
  navigateTo: () => {},
  redirectTo: () => {},
  createMapContext: () => ({ getCenterLocation: () => {} }),
  pageScrollTo: () => {},
  nextTick: (fn) => fn(),
}
global.Page = (config) => { pageConfig = config }

beforeEach(() => {
  sent = []
  storage = {}
  toasts = []
  pageConfig = null
})

function makePage(productType) {
  delete require.cache[require.resolve(FABU)]
  require(FABU)
  const page = Object.assign({}, pageConfig)
  page.data = JSON.parse(JSON.stringify(pageConfig.data))
  page.data.draftUuid = 'dec-f03-draft'
  page.data.draftMemberId = 42
  page.setData = function (patch, callback) {
    Object.keys(patch).forEach((key) => {
      const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.')
      let cursor = page.data
      for (let i = 0; i < parts.length - 1; i += 1) {
        if (cursor[parts[i]] == null) cursor[parts[i]] = {}
        cursor = cursor[parts[i]]
      }
      cursor[parts[parts.length - 1]] = patch[key]
    })
    if (callback) callback()
  }
  page.onLoad({})
  page.data.formData.productType = productType
  page.data.formData.tickets = []
  sent = []
  return page
}

const input = (page, field, value) => page.onEditTicketChange({ currentTarget: { dataset: { field } }, detail: { value } })

// 作者在票种编辑器里填好除票价以外的一切(票价一个字都不碰)
function fillTicketExceptPrice(page) {
  page.setData({
    'editingTicket.name': '标准票',
    'editingTicket.meetingPoint': '人民广场',
    'editingTicket.startTime': '2026-12-01 09:00',
    'editingTicket.endTime': '2026-12-01 18:00',
  })
  page.refreshTicketSaveState()
}

const topicRequests = () => sent.filter((r) => /^\/api\/topic\/(v2\/)?create$/.test(r.url))
const ticketBlocking = (page) => page.buildPublishCheck().blocking.filter((b) => /^ticketPrice\d+$/.test(b.field))

test('L03-006 城市定向:打开编辑器不填票价 → 保存被拦、栏内报「请填写票价」;发布检查点拦下,不发请求', () => {
  const page = makePage(1)
  page.openTicketEditor({ currentTarget: { dataset: { index: -1 } } })
  assert.equal(page.data.editingTicket.price, '', '新票价是空,不再预填 0')
  fillTicketExceptPrice(page)
  assert.equal(page.data.canSaveTicket, false)
  page.onSaveTicketDisabledTap()
  assert.equal(page.data.ticketPriceError, '请填写票价')
  assert.equal(toasts.at(-1), '请填写票价')
  page.saveTicket()
  assert.equal(page.data.formData.tickets.length, 0, '空价票没有被当成 0 元存进列表')

  // 服务端读回的票价为 null(或旧草稿里留空)的城市定向票:检查点 → 定位 → 编辑器票价仍为空
  page.setData({ showTicketEditor: false, 'formData.tickets': [{ name: '标准票', price: null, totalStock: 100, mode: 1,
    meetingPoint: '人民广场', startTime: '2026-12-01 09:00', endTime: '2026-12-01 18:00' }] })
  const blocking = ticketBlocking(page)
  assert.deepEqual(blocking.map((b) => b.label), ['请填写票价'])
  page.focusValidationError({ [blocking[0].field]: blocking[0].label })
  assert.equal(page.data.showTicketEditor, true)
  assert.equal(page.data.editingTicket.price, '', '从检查点打开也不把 null 变 0')
  assert.equal(page.data.ticketPriceError, '请填写票价', '错误报在票价栏内')
  assert.equal(page.data.canSaveTicket, false)

  page._showPublishCheck([], '')
  page.confirmPublishCheck()
  assert.equal(topicRequests().length, 0, '有票价缺项时发布不发出任何主题请求')
})

test('L03-006 自由探索:不填票价走开售前定价 → 发布请求体里票价为 null(不是 0)', () => {
  const page = makePage(2)
  page.openTicketEditor({ currentTarget: { dataset: { index: -1 } } })
  assert.equal(page.data.editingTicket.price, '')
  page.setData({ 'editingTicket.name': '探索票', 'editingTicket.startTime': '2026-12-01', 'editingTicket.endTime': '2026-12-31' })
  page.refreshTicketSaveState()
  assert.equal(page.data.canSaveTicket, true)
  page.saveTicket()
  assert.equal(page.data.formData.tickets[0].price, '')
  assert.deepEqual(ticketBlocking(page), [], '检查点不把开售前定价当缺项')

  page._doSubmit()
  const request = topicRequests()[0]
  assert.ok(request, '发布发出了主题请求')
  const ticket = JSON.parse(request.data).tickets[0]
  assert.equal(ticket.price, null)

  // 编辑回来的自由探索票(服务端 price=null)从检查点重开、原样保存,仍是开售前定价
  const reopened = makePage(2)
  reopened.data.formData.tickets = [{ id: 9, name: '探索票', price: null, totalStock: 50, mode: 2,
    startTime: '2026-12-01', endTime: '2026-12-31' }]
  reopened.focusValidationError({ ticketName0: '请填写票单名称' })
  assert.equal(reopened.data.editingTicket.price, '')
  reopened.saveTicket()
  assert.equal(reopened.data.formData.tickets[0].price, '', 'null 不会变成免费 0')
})

test('L03-006 选模式时生成的兜底票不预置 0 元:城市定向要作者填价,自由探索为开售前定价', () => {
  const page = makePage(1)
  for (const mode of [1, 2]) {
    const ticket = page.createDefaultTicket(mode)
    assert.equal(ticket.price, '', 'mode ' + mode)
    page.setData({ 'formData.productType': mode, 'formData.tickets': [Object.assign(ticket, mode === 1
      ? { meetingPoint: '广场', startTime: '2026-12-01 09:00', endTime: '2026-12-01 18:00' } : {})] })
    assert.deepEqual(ticketBlocking(page).map((b) => b.label), mode === 1 ? ['请填写票价'] : [])
  }
})

test('L03-006 只输入「.」不会存成 0;真填的 0 才是 0,上送 "0.00"', () => {
  const page = makePage(1)
  page.openTicketEditor({ currentTarget: { dataset: { index: -1 } } })
  fillTicketExceptPrice(page)
  input(page, 'price', '.')
  assert.equal(page.data.canSaveTicket, false)
  page.onSaveTicketDisabledTap()
  assert.equal(page.data.ticketPriceError, '票价须为数字，最多两位小数')
  page.saveTicket()
  assert.equal(page.data.formData.tickets.length, 0)

  input(page, 'price', '0')
  assert.equal(page.data.ticketPriceError, '', '改价即清掉栏内报错')
  assert.equal(page.data.canSaveTicket, true)
  page.saveTicket()
  assert.equal(page.data.formData.tickets[0].price, 0)
  page._doSubmit()
  assert.equal(JSON.parse(topicRequests()[0].data).tickets[0].price, '0.00')
})

test('L03-050 票价输入最多两位小数、多余小数点并掉;超上限栏内报错;检查点拦「.」「12.345」「100000」', () => {
  const page = makePage(1)
  page.openTicketEditor({ currentTarget: { dataset: { index: -1 } } })
  fillTicketExceptPrice(page)
  input(page, 'price', '12.345')
  assert.equal(page.data.editingTicket.price, '12.34', '与活动发布同一个输入规整')
  input(page, 'price', '1.2.3')
  assert.equal(page.data.editingTicket.price, '1.23')
  input(page, 'price', '100000')
  assert.equal(page.data.canSaveTicket, false)
  page.onSaveTicketDisabledTap()
  assert.equal(page.data.ticketPriceError, '票价不能超过 99999.99')
  input(page, 'price', '99999.99')
  assert.equal(page.data.canSaveTicket, true)

  const base = { name: '票', totalStock: 1, mode: 1, meetingPoint: '广场', startTime: '2026-12-01 09:00', endTime: '2026-12-01 18:00' }
  for (const [price, label] of [['.', '票价须为数字，最多两位小数'], ['12.345', '票价须为数字，最多两位小数'],
    ['100000', '票价不能超过 99999.99'], [-1, '价格不能为负数']]) {
    page.setData({ showTicketEditor: false, 'formData.tickets': [Object.assign({}, base, { price })] })
    assert.deepEqual(ticketBlocking(page).map((b) => b.label), [label], String(price))
  }
  page.setData({ 'formData.tickets': [Object.assign({}, base, { price: '12.30' })] })
  assert.deepEqual(ticketBlocking(page), [])
})

test('L03-193 合法票价与自玩价上送两位小数字符串,纯字符串补零不四舍五入', () => {
  const page = makePage(1)
  page.data.formData.selfPlay = true
  page.data.formData.selfPlayPrice = '9.9'
  page.data.formData.tickets = [
    { name: 'A', price: 39.9, totalStock: 10, mode: 1, meetingPoint: '广场', startTime: '2026-12-01 09:00', endTime: '2026-12-01 18:00' },
    { name: 'B', price: '12', totalStock: 10, mode: 1, meetingPoint: '广场', startTime: '2026-12-01 09:00', endTime: '2026-12-01 18:00' },
  ]
  page._doSubmit()
  const body = JSON.parse(topicRequests()[0].data)
  assert.deepEqual(body.tickets.map((t) => t.price), ['39.90', '12.00'])
  assert.equal(body.selfPlayPrice, '9.90')
})

test('L03-060 改过与没改过的票按同一份字段清单上送,不带回填的 totalInventory 等服务端字段', () => {
  const page = makePage(1)
  page.applyEditingTopic({ topic: { id: 501, productType: 1, name: '寒冬' }, chapters: [], editScope: 'FULL',
    tickets: [
      { id: 11, name: '旧票', price: 20, totalInventory: 80, remainingInventory: 70, soldCount: 10, needAudit: 1,
        mode: 1, meetingPoint: '广场', startTime: '2026-12-01 09:00:00', endTime: '2026-12-01 18:00:00' },
      { id: 12, name: '要改的票', price: 30, totalInventory: 50, remainingInventory: 50,
        mode: 1, meetingPoint: '广场', startTime: '2026-12-01 09:00:00', endTime: '2026-12-01 18:00:00' },
    ] })
  page.openTicketEditor({ currentTarget: { dataset: { index: 1 } } })
  input(page, 'totalStock', '60')
  page.saveTicket()
  const tickets = page._buildSubmitPayload().tickets
  assert.deepEqual(Object.keys(tickets[0]).sort(), Object.keys(tickets[1]).sort(), '两张票字段集合一致')
  for (const ticket of tickets) {
    assert.equal(ticket.totalInventory, undefined)
    assert.equal(ticket.remainingInventory, undefined)
    assert.equal(ticket.soldCount, undefined)
  }
  assert.equal(tickets[0].totalStock, 80, '没改过的票按服务端真源字段 totalStock 上送原库存')
  assert.equal(tickets[1].totalStock, 60)
  assert.deepEqual(tickets.map((t) => t.id), [11, 12])
})

test('L03-044 权益门槛与计酬上限:输入限两位小数,必须大于 0,提交前保持原样字符串', () => {
  const page = makePage(2)
  page.onChapterPerkMinValueInput({ detail: { value: '12.345' } })
  assert.equal(page.data.chapterForm.perkMinValue, '12.34')
  page.onChapterMaxPerHeadFeeInput({ detail: { value: '8.999' } })
  assert.equal(page.data.chapterForm.maxPerHeadFee, '8.99')

  page.data.formData.clubId = 7
  const perk = { recruitEnabled: 1, categoryId: 3, termsMode: 'PERK', maxMerchant: 2, perkMinValue: '12.30' }
  assert.equal(page.normalizeChapterMerchantConfig(perk), true)
  assert.equal(perk.perkMinValue, '12.30', '保持原样,不转浮点')
  const fee = { recruitEnabled: 1, categoryId: 3, termsMode: 'REVSHARE', maxMerchant: 2, maxPerHeadFee: '8.50' }
  assert.equal(page.normalizeChapterMerchantConfig(fee), true)
  assert.equal(fee.maxPerHeadFee, '8.50')
  for (const bad of ['12.345', '0', '.']) {
    assert.equal(page.normalizeChapterMerchantConfig({ recruitEnabled: 1, categoryId: 3, termsMode: 'PERK', maxMerchant: 2, perkMinValue: bad }), false, bad)
  }
  assert.match(toasts.at(-1), /最多两位小数/)

  const bag = require('../../pages/publish/utils/publish/publish-validation-bag.js').buildValidationBag({
    formData: { productType: 2, tickets: [], chapters: [{ nodes: [], recruitEnabled: 1, categoryId: 3, termsMode: 'PERK', maxMerchant: 2, perkMinValue: '0.001' }] },
  })
  assert.equal(bag.errors.chapterRecruitPerkMin0, '第1章权益最低价值须为大于0、最多两位小数的金额')
})
