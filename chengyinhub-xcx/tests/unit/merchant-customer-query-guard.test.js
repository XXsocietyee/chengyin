'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
let pageConfig
let requests

global.getApp = () => ({
  globalData: { statusBarHeight: 44, navBarHeight: 44 },
  getUserID: () => 'merchant-a',
  getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
  sendRequest: (request) => { requests.push(request) },
})

global.wx = {
  getSystemInfoSync: () => ({ statusBarHeight: 44 }),
  navigateTo() {},
  makePhoneCall() {},
  setNavigationBarColor() {},
  setBackgroundColor() {},
}

global.Page = (config) => { pageConfig = config }

function loadPage() {
  pageConfig = null
  requests = []
  const absolute = path.join(ROOT, 'pages/merchant/customer/index.js')
  delete require.cache[require.resolve(absolute)]
  require(absolute)
  const page = Object.assign({}, pageConfig)
  page.data = JSON.parse(JSON.stringify(pageConfig.data))
  // 真机 setData 支持 a[0] 路径追加(批4 分页改造依赖),naive Object.assign 会把下标键写成字面属性
  page.setData = function (patch, callback) {
    for (const [key, value] of Object.entries(patch)) {
      const segs = []
      for (const m of key.matchAll(/([^.[\]]+)|\[(\d+)\]/g)) segs.push(m[2] !== undefined ? Number(m[2]) : m[1])
      let target = this.data
      for (let i = 0; i < segs.length - 1; i++) {
        const seg = segs[i]
        if (target[seg] == null) target[seg] = typeof segs[i + 1] === 'number' ? [] : {}
        target = target[seg]
      }
      target[segs[segs.length - 1]] = value
    }
    if (callback) callback()
  }
  return page
}

function customerRow(id, name, overrides) {
  return Object.assign({
    memberId: id,
    name,
    avatar: '',
    phone: null,
    contactHint: '需要客户敏感信息权限',
    arrivedCount: 1,
    pendingCount: 0,
    refundedCount: 0,
    paidAmount: null,
    lastTime: '2026-08-20T10:00:00.000+08:00',
    lastAction: '最近已到店',
    tier: 'new',
    sourceType: 'TOPIC',
  }, overrides || {})
}

function customerResponse(id, name) {
  return {
    code: 200,
    data: {
      rows: [customerRow(id, name)],
      total: 40,
      segmentCounts: { all: 40, pending: 0, repeat: 0, dormant: 0, abnormal: 0 },
    },
  }
}

test('已渲染 A 后输入 B 的 debounce 窗口内，loadMore 不得把 B 分页追加到 A', () => {
  const page = loadPage()
  page.data.keyword = 'A'
  page.load()
  requests[0].success(customerResponse(101, 'A 客户'))
  requests[0].complete()
  assert.deepEqual(page.data.rows.map((row) => row.memberId), [101])

  const originalSetTimeout = global.setTimeout
  const originalClearTimeout = global.clearTimeout
  let deferredSearch
  global.setTimeout = (callback) => {
    deferredSearch = callback
    return 1
  }
  global.clearTimeout = () => {}

  try {
    page.onKeywordInput({ detail: { value: 'B' } })
    assert.equal(typeof deferredSearch, 'function', 'B 查询应仍在 debounce 等待期')

    page.loadMore()
    const leakedRequest = requests[1]
    if (leakedRequest) {
      leakedRequest.success(customerResponse(221, 'B 客户'))
      leakedRequest.complete()
    }

    assert.deepEqual(page.data.rows.map((row) => row.memberId), [101],
      'B 的分页响应不得混入仍显示 A 的客户列表')
    assert.equal(requests.length, 1, '查询键切到 B 后不得继续发出 A 列表的分页请求')
  } finally {
    global.setTimeout = originalSetTimeout
    global.clearTimeout = originalClearTimeout
  }
})

test('keyword 与 segment 均未变化时仍可加载下一页', () => {
  const page = loadPage()
  page.data.keyword = 'A'
  page.load()
  requests[0].success(customerResponse(101, 'A 客户'))
  requests[0].complete()

  page.loadMore()
  assert.equal(requests.length, 2)
  assert.deepEqual(JSON.parse(requests[1].data), {
    pageNum: 2,
    pageSize: 20,
    keyword: 'A',
    segment: 'all',
    tagId: null,
    sourceType: null,
    sourceStart: null,
    sourceEnd: null,
  })

  requests[1].success(customerResponse(121, 'A 客户 21'))
  requests[1].complete()
  assert.deepEqual(page.data.rows.map((row) => row.memberId), [101, 121])
})

test('客户名单缺失 total 时不得把满页误判成没有更多', () => {
  const page = loadPage()
  page.load()
  requests[0].success({
    code: 200,
    data: {
      rows: Array.from({ length: 20 }, (_, index) => customerRow(index + 1, `客户${index + 1}`)),
      segmentCounts: { all: 20 },
    },
  })
  requests[0].complete()

  assert.deepEqual(page.data.rows, [])
  assert.match(page.data.error, /加载失败/)
  assert.equal(page.data.hasMore, true)
})

// L07-006(2026-11-22 业主确认):坏行只跳过这一行,不再整页报错;空姓名/空动作/新来源枚举是合法行
test('客户名单畸形行被跳过，其余行照常显示；空姓名与新来源枚举不算坏行', () => {
  const malformedRows = [
    customerRow(7, '缺主键', { memberId: null }),
    customerRow(8, '布尔主键', { memberId: true }),
    customerRow(9, '未知层级', { tier: 'vip' }),
    customerRow(10, '负数计数', { pendingCount: -1 }),
  ]

  for (const malformed of malformedRows) {
    const page = loadPage()
    page.load()
    requests[0].success({
      code: 200,
      data: {
        rows: [customerRow(12, '合法行'), malformed],
        total: 2,
        segmentCounts: { all: 2, pending: 0, repeat: 0, dormant: 0, abnormal: 0 },
      },
    })
    requests[0].complete()

    assert.deepEqual(page.data.rows.map((row) => row.memberId), [12], JSON.stringify(malformed))
    assert.ok(!page.data.error, JSON.stringify(malformed))
    assert.equal(page._skippedRows, 1)
  }

  const page = loadPage()
  page.load()
  requests[0].success({
    code: 200,
    data: {
      rows: [customerRow(13, '', { lastAction: '' }), customerRow(14, '新来源', { sourceType: 'FOREIGN' })],
      total: 2,
      segmentCounts: { all: 2, pending: 0, repeat: 0, dormant: 0, abnormal: 0 },
    },
  })
  requests[0].complete()
  assert.deepEqual(page.data.rows.map((row) => row.memberId), [13, 14])
  assert.equal(page.data.rows[0].displayName, '未留姓名')
})

test('客户页卸载会取消待执行的关键词防抖，不在离页后发新请求', () => {
  const page = loadPage()
  const originalSetTimeout = global.setTimeout
  const originalClearTimeout = global.clearTimeout
  const cleared = []
  let deferred
  global.setTimeout = (callback) => { deferred = callback; return 17 }
  global.clearTimeout = (timer) => { cleared.push(timer) }

  try {
    page.onKeywordInput({ detail: { value: '离页搜索' } })
    page.onUnload()
    assert.deepEqual(cleared, [17])
    deferred()
    assert.equal(requests.length, 0)
  } finally {
    global.setTimeout = originalSetTimeout
    global.clearTimeout = originalClearTimeout
  }
})

test('客户 access/me 业务失败或非法角色即使夹带权限数据也必须关闭', () => {
  for (const data of [
    {
      active: true,
      merchant: { id: 7, name: '残留门店' },
      roleCode: 'MERCHANT_OWNER',
      permissions: ['merchant:crm:read', 'merchant:crm:segment'],
    },
    {
      active: true,
      merchant: { id: 7, name: '非法角色门店' },
      roleCode: 'UNKNOWN_ROLE',
      permissions: ['merchant:crm:read', 'merchant:crm:segment'],
    },
  ]) {
    const page = loadPage()
    page.onLoad()
    requests[0].success({ code: data.roleCode === 'UNKNOWN_ROLE' ? 200 : 500, data })
    assert.equal(page.data.noPermission, false, '非法回包只能表示读取失败，不是假权限事实')
    assert.equal(page.data.error, '经营身份加载失败，请重试')
    assert.equal(page.data.canSegment, false)
    assert.equal(requests.length, 1, '非法身份不得继续请求客户数据')
  }
})

/**
 * CU-M-146:castCount 是底栏「当前筛选 · N 人」和「定向广播」按钮的唯一依据,
 * 但它只在成功回包里写。换分段/换筛选后不跟着名单一起清,就会在新一轮请求
 * 还没回来的窗口里继续报上一分段的人数(走查读到的「全部 1 人」配「回头客 0 人」)。
 */
test('换分段后到本次请求回来之前，底栏不得沿用上一分段的人数', () => {
  const page = loadPage()
  page.load()
  requests[0].success(customerResponse(101, '甲'))
  assert.equal(page.data.castCount, 40)

  page.data.segment = 'repeat'
  page.load()
  assert.equal(page.data.castCount, 0, '这一版还没回，人数该空着，不是上一分段的 40')

  // 失败同样不许留旧数：_clearScopedData 与名单一起清
  requests[1].success({ code: 500, msg: 'boom' })
  assert.equal(page.data.castCount, 0)
})

/**
 * CU-M-102：页头「N 位 · 本月新增 M」改成全量口径后，空态判据得跟着换 ——
 * 标签/来源筛空名单时，segmentCounts 依然有 12 位，沿用旧兜底就会把
 * 「筛没了」报成「名单这次没取回来」，把人支去下拉刷新。
 */
test('标签筛空名单时说「这个筛选条件下没有客户」，不说名单没取回来', () => {
  const page = loadPage()
  page.data.tagId = 7
  page.load()
  requests[0].success({
    code: 200,
    data: {
      rows: [], total: 0,
      segmentCounts: { all: 12, pending: 0, repeat: 0, noted: 0, monthlyNew: 3 },
    },
  })
  assert.equal(page.data.emptyTitle, '这个筛选条件下没有客户')
  assert.equal(page._emptyAction, 'clear-advanced')
  // 页头读的是全量:筛空了它也不跟着变 0
  assert.equal(page.data.customerSummaryText, '12 位 · 本月新增 3')

  // 负控的一半:清除这条筛选后回到全量空态的老判据,不能把「真没客户」也说成筛没了
  page.onEmptyAction()
  assert.equal(page.data.tagId, '', '清除筛选要把标签清掉')
  requests[1].success({
    code: 200,
    data: { rows: [], total: 0, segmentCounts: { all: 0, pending: 0, repeat: 0, noted: 0, monthlyNew: 0 } },
  })
  assert.equal(page.data.emptyTitle, '还没有客户')
  assert.equal(page._emptyAction, 'go-coop')
})


test('经营身份异常不能显示岗位权限拒绝，也不读CRM名单', () => {
  for (const response of [{code:500,msg:'暂不可用'}, {code:200,data:null}, {code:200,data:{active:true}}, {code:200,data:[]}]) {
    const page=loadPage();page.loadAccess();requests[0].success(response);
    assert.equal(page.data.noPermission,false);assert.equal(page.data.loading,false);
    assert.equal(page.data.error,'经营身份加载失败，请重试');assert.equal(requests.length,1);
  }
});
test('经营身份真实active=false才显示岗位权限拒绝，网络失败保持读失败', () => {
  const denied=loadPage();denied.loadAccess();requests[0].success({code:200,data:{active:false,applicationState:'NONE'}});
  assert.equal(denied.data.noPermission,true);assert.equal(denied.data.error,'');assert.equal(requests.length,1);
  const failed=loadPage();failed.loadAccess();requests[0].fail({errMsg:'offline'});
  assert.equal(failed.data.noPermission,false);assert.equal(failed.data.error,'经营身份加载失败，请重试');assert.equal(requests.length,1);
});

// L07-005:详情页往返仍重验身份,但 60s 内未写过时不重读名单(保留已翻页与滚动)
test('返回名单页只重验身份，不重读名单；详情写过后才重读', () => {
  const access = { code: 200, data: { active: true, merchant: { id: 7, name: '店' }, roleCode: 'MERCHANT_OWNER', permissions: ['merchant:crm:read'] } }
  const page = loadPage()
  page.onLoad()
  page.onShow()
  requests[0].success(access)
  const list = () => requests.filter((r) => /crm\/customers/.test(r.url) && !/detail/.test(r.url)).length
  const me = () => requests.filter((r) => r.url === '/api/merchant/access/me').length
  const listBefore = list()
  assert.ok(listBefore >= 1)
  page.onHide(); page.onShow()
  assert.equal(me(), 2, '返回必须重验身份')
  requests.filter((r) => r.url === '/api/merchant/access/me')[1].success(access)
  assert.equal(list(), listBefore, '未写过不重读名单')
  page._dirty = true
  page.onHide(); page.onShow()
  requests.filter((r) => r.url === '/api/merchant/access/me')[2].success(access)
  assert.equal(list(), listBefore + 1, '详情写过后重读名单')
})

function loadedPage(rows) {
  const page = loadPage()
  page.load()
  requests[0].success({ code: 200, data: { rows, total: rows.length, segmentCounts: { all: rows.length, pending: 0, repeat: 0, dormant: 0, abnormal: 0 } } })
  requests[0].complete()
  return page
}

// L07-026:按中国日历日算,昨天深夜不是「今天」
test('昨天 23:59(中国时间)显示「昨天」', () => {
  const DAY = 86400000, CN = 8 * 3600000
  const todayStart = Math.floor((Date.now() + CN) / DAY) * DAY - CN
  const page = loadedPage([customerRow(21, '甲', { lastTime: todayStart - 60000, lastAction: '核销' })])
  assert.equal(page.data.rows[0].actionText, '核销 · 昨天')
})

// L07-114:满 100 位给提示
test('选择模式满 100 位提示', () => {
  const page = loadedPage([customerRow(31, '甲'), customerRow(32, '乙')])
  page.data.selecting = true
  page.openCustomer({ currentTarget: { dataset: { memberid: 32 } } })
  // L07-031:勾选态只在 selectedMap 里,rows 不再被整表克隆
  assert.equal(page.data.selectedMap[32], true)
  assert.equal(!!page.data.selectedMap[31], false)
  const toasts = []
  global.wx.showToast = (o) => toasts.push(o.title)
  page.data.selectedIds = Array.from({ length: 100 }, (_, i) => 1000 + i)
  page.openCustomer({ currentTarget: { dataset: { memberid: 31 } } })
  assert.equal(page.data.selectedIds.length, 100)
  assert.ok(toasts.some((t) => /100/.test(t)))
  delete global.wx.showToast
})

// L07-024:批量加标签超时后重试沿用原 requestId,成功后才换
test('批量加标签重试沿用 requestId', () => {
  const page = loadedPage([customerRow(41, '甲')])
  page._scopeGuard = () => () => true
  page.data.canSegment = true
  page.data.selectedIds = [41]
  page.data.batchTagName = '常客'
  const ids = () => requests.filter((r) => /tags\/batch/.test(r.url)).map((r) => JSON.parse(r.data).requestId)
  page.submitBatchTag()
  requests.filter((r) => /tags\/batch/.test(r.url))[0].fail()
  page.submitBatchTag()
  assert.equal(ids()[0], ids()[1])
  global.wx.showToast = () => {}
  requests.filter((r) => /tags\/batch/.test(r.url))[1].success({ code: 200 })
  delete global.wx.showToast
  page.data.selectedIds = [41]; page.data.batchTagName = '常客'
  page.submitBatchTag()
  assert.notEqual(ids()[2], ids()[0])
})

// L07-025:导出状态查询失败退避,离开页面停表
test('导出状态轮询失败退避并在 onHide 停表', () => {
  const page = loadPage()
  page._scopeGuard = () => () => true
  page.data.exportTask = { id: 5, status: 'RUNNING' }
  page.data.exportState = 'RUNNING'
  const delays = []
  const st = global.setTimeout, ct = global.clearTimeout
  global.setTimeout = (fn, ms) => { delays.push(ms); return delays.length }
  global.clearTimeout = () => {}
  try {
    for (let i = 0; i < 3; i += 1) {
      page._pollExport()
      requests.filter((r) => /exports\/5\/status/.test(r.url)).at(-1).fail()
    }
    assert.deepEqual(delays, [3000, 6000, 12000])
    page.onHide()
    page._scheduleExportPoll(true)
    assert.equal(delays.length, 3, '离开页面不再排下一次')
  } finally { global.setTimeout = st; global.clearTimeout = ct }
})

// L07-112 / L07-113 / L07-115
test('套用分群清掉关键词;起止日期倒了自动对调;导出令牌不进页面数据', () => {
  const page = loadPage()
  page.data.keyword = '张'
  page.data.savedSegments = [{ id: 3, filter: { segment: 'pending' } }]
  page.applySavedSegment({ currentTarget: { dataset: { segmentid: 3 } } })
  assert.equal(page.data.keyword, '')
  assert.equal(page.data.segment, 'pending')

  page.onSourceStartChange({ detail: { value: '2026-11-20' } })
  page.onSourceEndChange({ detail: { value: '2026-11-01' } })
  assert.equal(page.data.sourceStart, '2026-11-01')
  assert.equal(page.data.sourceEnd, '2026-11-20')

  const exporter = loadPage()
  exporter._scopeGuard = () => () => true
  exporter._pollExport = () => {}
  exporter.data.canExport = true
  exporter.createExport()
  const create = requests.find((r) => /crm\/exports$/.test(r.url))
  assert.ok(create, '导出必须发出创建请求')
  create.success({ code: 200, data: { id: 9, status: 'PENDING', downloadToken: 'secret-token' } })
  assert.equal(JSON.stringify(exporter.data.exportTask).includes('secret-token'), false)
  assert.equal(exporter._exportToken, 'secret-token')
})

// L07-005 回归:保留名单的返回不能把「营销活动」入口弄丢
test('返回保留名单时 hasCampaigns 不被清掉', () => {
  const access = { code: 200, data: { active: true, merchant: { id: 7, name: '店' }, roleCode: 'MERCHANT_OWNER', permissions: ['merchant:crm:read', 'merchant:marketing:read'] } }
  const page = loadPage()
  page.onLoad(); page.onShow()
  requests[0].success(access)
  page.data.hasCampaigns = true
  page.onHide(); page.onShow()
  assert.equal(page.data.hasCampaigns, true)
  requests.filter((r) => r.url === '/api/merchant/access/me').at(-1).success(access)
  assert.equal(page.data.hasCampaigns, true)
})

// L07-116:筛选按钮的「筛选 · N」、重置与存为分群可用态都读 JS 算出的 hasFilter/filterCount
test('筛选计数由 JS 统一算：日期起止算一项，清空后回到无筛选', () => {
  const page = loadPage()
  page._fetch = () => {}
  page.setData({ segment: 'repeat', sourceType: '1', sourceStart: '2026-11-01', sourceEnd: '2026-11-20', tagId: 5 })
  page.load()
  assert.equal(page.data.hasFilter, true)
  assert.equal(page.data.filterCount, 4)
  assert.equal(page._hasFilter(), true)
  page.setData({ segment: 'all', sourceType: '', sourceStart: '', sourceEnd: '', tagId: '' })
  page.load()
  assert.equal(page.data.hasFilter, false)
  assert.equal(page.data.filterCount, 0)
  const wxml = require('node:fs').readFileSync(path.join(ROOT, 'pages/merchant/customer/index.wxml'), 'utf8')
  assert.match(wxml, /'筛选 · ' \+ filterCount/)
  assert.doesNotMatch(wxml, /segment !== 'all' \|\| sourceType/, '筛选判断不再在模板里手写')
})

// L07-031:选择模式点一行只下发 selectedIds/selectedMap,不再整表下发 rows
test('选择模式勾选一行不重发整张名单', () => {
  const page = loadedPage(Array.from({ length: 30 }, (_, i) => customerRow(100 + i, '客户' + i)))
  page.data.selecting = true
  const patches = []
  const setData = page.setData
  page.setData = function (patch, cb) { patches.push(Object.keys(patch)); return setData.call(this, patch, cb) }
  page.openCustomer({ currentTarget: { dataset: { memberid: 105 } } })
  page.openCustomer({ currentTarget: { dataset: { memberid: 107 } } })
  page.openCustomer({ currentTarget: { dataset: { memberid: 105 } } })
  assert.deepEqual(patches, [['selectedIds', 'selectedMap'], ['selectedIds', 'selectedMap'], ['selectedIds', 'selectedMap']])
  assert.deepEqual(page.data.selectedIds, [107])
  assert.deepEqual(page.data.selectedMap, { 107: true })
  page.data.canSegment = true
  page.toggleSelectMode()
  assert.deepEqual(page.data.selectedMap, {}, '退出选择清空勾选')
})

// L07-111:触达记录探测同账号 5 分钟内只发一次;换账号或过期再发
test('触达记录探测同账号 5 分钟内复用结果', () => {
  const page = loadPage()
  page.data.canCampaigns = true
  const probes = () => requests.filter((r) => r.url === '/api/merchant/crm/campaigns')
  page.probeCampaigns()
  probes()[0].success({ code: 200, data: [{ id: 1 }] })
  assert.equal(page.data.hasCampaigns, true)
  page.setData({ hasCampaigns: false })
  page.probeCampaigns()
  assert.equal(probes().length, 1, '5 分钟内不重发')
  assert.equal(page.data.hasCampaigns, true, '复用上次结果')
  page._campaignsProbe.at -= 5 * 60 * 1000 + 1
  page.probeCampaigns()
  assert.equal(probes().length, 2, '过期后重发')
})
