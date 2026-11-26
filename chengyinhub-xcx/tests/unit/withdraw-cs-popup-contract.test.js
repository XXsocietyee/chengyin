'use strict'

// 2026-09-15 收款模型定稿 §3:平台不打款。个人余额「提现」只说明去小程序客服会话确认金额。
// 本契约钉住三件事:
//   ① 4 个提现入口(原 6 个,PG-034/PG-042 下线两页)点击后都打开同一个客服弹窗,且不发 /api/withdrawal/create;
//   ② 弹窗正文是客服会话说明,只有「知道了」,不写剪贴板;
//   ③ 客服微信号不出现在客户端。
// 负控:把任一入口改回旧逻辑(不弹客服、回到提现请求/跳转)必须判红。

const assert = require('node:assert/strict')
const fs = require('node:fs')
const { createRequire } = require('node:module')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const ROOT = path.resolve(__dirname, '../..')
const WITHDRAW_CS_PATH = 'utils/withdraw-cs.js'
const { flattenComponentToPage } = require('../helpers/component-as-page')

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

/** 从方法定义处(带缩进锚,避开 this.foo() 这类调用)做花括号配对,取出单个方法的正文。 */
function methodBody(source, signature) {
  const start = source.search(signature)
  assert.ok(start >= 0, `找不到方法定义: ${signature}`)
  const open = source.indexOf('{', start)
  let depth = 0
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    else if (source[i] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, i + 1)
    }
  }
  throw new Error(`花括号不配对: ${signature}`)
}

// —— 弹窗真源沙箱:modal / toast 换成记录桩,只测它自己发了什么 ——
function loadWithdrawCs(source = read(WITHDRAW_CS_PATH)) {
  const file = path.join(ROOT, WITHDRAW_CS_PATH)
  const calls = { modals: [], clipboard: [], toasts: [] }
  const sandbox = {
    module: { exports: {} },
    console,
    require(request) {
      if (request === './modal.js') return { show(options) { calls.modals.push(options) } }
      if (request === './toast.js') {
        const toast = (title) => { calls.toasts.push(title) }
        toast.success = (title) => { calls.toasts.push(title) }
        return toast
      }
      return createRequire(file)(request)
    },
    wx: {
      setClipboardData(options) {
        calls.clipboard.push(options && options.data)
      },
    },
  }
  vm.runInNewContext(source, sandbox, { filename: file })
  return { api: sandbox.module.exports, calls }
}

// —— 4 个入口的落点:handler + 驱动方式 ——
const ENTRIES = [
  {
    id: '资产中心→账户收益的「提现」',
    file: 'subpackageA/pages/assetcenter/earnings/index.js',
    signature: /^  openWithdrawSheet\(\)/m,
    drive(page) { page.openScene({ detail: { id: 'member-withdraw' } }) },
    forbidden: [/\/api\/withdrawal\/create/, /submitBankWithdrawal/, /txSheet\.show':\s*true/],
  },
  // PG-034/PG-042:独立提现页 subpackageMember/tixian 与商家提现壳 pages/coop/withdraw 已下线。
  {
    id: '俱乐部结算页「提现到银行卡」',
    file: 'pages/club/settlement/index.js',
    signature: /^  goWithdraw\(\)/m,
    prepare(runtime) {
      runtime.page.onLoad({ clubId: 21 })
      runtime.requests[0].success({ code: 200, data: { settledAmountText: '¥10.00',
        settledAmountStatus: 'verified', unverifiedSettledCount: 0, topics: [], sessions: [], isOwner: true } })
      runtime.page.onStages({ detail: { known: true, positive: true } })
    },
    // CU-C-92:可提现 >0 才放行(余额由 cy-funds-stages 经 bind:stages 回报);零余额不弹见 club-settlement 自己的用例
    drive(page) { page.goWithdraw() },
    forbidden: [/\/api\/withdrawal\/create/, /submitBankWithdrawal/, /pages\/coop\/withdraw/],
  },
  {
    id: '商家分润明细「提现到银行卡」',
    file: 'subpackageA/components/scene-merchant-profit/index.js',
    signature: /^    goWithdraw\(\)/m,
    prepare(runtime) {
      runtime.page.load()
      runtime.requests[0].success({ code: 200, data: { topics: [{ topicId: 7,
        settled: true, myIncome: 10, myIncomeArrived: true, merchantTotal: 0, merchantPaid: 0 }], isOwner: true } })
    },
    drive(page) { page.goWithdraw() },
    forbidden: [/\/api\/withdrawal\/create/, /submitBankWithdrawal/, /subpackageMember\/tixian/],
  },
  // L09-029
  // 业主默认 A:提现场景不再出银行卡表单,进入即弹客服并退回上一层
  {
    id: '场景「提现」进入即弹客服',
    file: 'subpackageMember/components/cy/scene-route-content/index.js',
    signature: /^    loadScene\(\)/m,
    drive(page) {
      page.data.sceneId = 'member-withdraw'
      page.data.params = {}
      page.loadScene()
    },
    forbidden: [/\/api\/withdrawal\/create/, /submitBankWithdrawal/, /\/api\/user\/info/],
  },
  // L09-130
  // 深链宿主拥有弹窗,能力闸在这里判
  {
    id: '深链宿主里收益组件的「提现」',
    file: 'subpackageMember/components/cy/scene-deep-link/index.js',
    signature: /^    openWithdrawCs\(\)/m,
    drive(page) { page.openChildScene({ detail: { id: 'member-withdraw' } }) },
    forbidden: [/\/api\/withdrawal\/create/, /submitBankWithdrawal/, /openScene\(/],
  },
]

function loadEntry(relPath, source = read(relPath), fixture = {}) {
  const absolutePath = path.join(ROOT, relPath)
  const popups = []
  const requests = []
  const navigations = []
  const modals = []
  let definition = null
  const identity = { memberId: 1, role: 'player', type: 1 }
  const guardCallbacks = []
  const app = {
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    getPageSize: () => 20,
    getUserID: () => identity.memberId,
    getUserRole: () => identity.role,
    getUserType: () => identity.type,
    getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
    sendRequest(options) { requests.push(options) },
    tips() {},
    recordConsent() { return Promise.resolve({}) },
  }
  const wx = {
    getStorageSync: () => null,
    setStorageSync() {},
    removeStorageSync() {},
    showLoading() {},
    hideLoading() {},
    showToast() {},
    showModal(options) { modals.push(options) },
    navigateTo(options) { navigations.push(options && options.url) },
    redirectTo(options) { navigations.push(options && options.url) },
    reLaunch(options) { navigations.push(options && options.url) },
    navigateBack() {},
    setNavigationBarColor() {},
    setBackgroundColor() {},
    setClipboardData() {},
  }
  vm.runInNewContext(source, {
    console,
    getApp: () => app,
    getCurrentPages: () => [{ selectComponent: () => null }],
    Page: (config) => { definition = config },
    Component: (config) => { definition = flattenComponentToPage(config) },
    require(request) {
      if (request.endsWith('utils/withdraw-cs.js')) {
        return { showWithdrawCsPopup() { popups.push(true) } }
      }
      if (request.endsWith('utils/analytics.js')) return { track() {} }
      if (request.endsWith('utils/roleGuard.js')) return { can: () => true, isMerchantView: () => false, load(callback) { if (fixture.deferGuard) guardCallbacks.push(callback); else callback() } }
      if (request.endsWith('utils/merchant-theme.js')) return { merchantPageShow() {}, merchantPageRestore() {} }
      return createRequire(absolutePath)(request)
    },
    setTimeout() { return 0 },
    clearTimeout() {},
    wx,
  }, { filename: absolutePath })

  assert.ok(definition, `${relPath} 必须注册 Page/Component`)
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data || {})),
  })
  page.setData = (patch, callback) => {
    Object.entries(patch).forEach(([key, value]) => {
      const parts = key.split('.')
      let cursor = page.data
      parts.slice(0, -1).forEach((part) => {
        if (!cursor[part] || typeof cursor[part] !== 'object') cursor[part] = {}
        cursor = cursor[part]
      })
      cursor[parts[parts.length - 1]] = value
    })
    if (typeof callback === 'function') callback()
  }
  page.triggerEvent = () => {}
  page.selectComponent = () => null
  return { page, popups, requests, navigations, modals, identity, guardCallbacks }
}

function assertEntryOpensPopup(entry, source = read(entry.file)) {
  const body = stripComments(methodBody(source, entry.signature))
  assert.match(body, /withdrawCs\.showWithdrawCsPopup\(\)/, `${entry.id}: 必须点击后打开平台客服弹窗`)
  entry.forbidden.forEach((pattern) => {
    assert.doesNotMatch(body, pattern, `${entry.id}: 退役后不得再回归旧提现链路 ${pattern}`)
  })
}

test('弹窗合同:客服会话说明,只有「知道了」', () => {
  const { api, calls } = loadWithdrawCs()
  api.showWithdrawCsPopup()
  assert.equal(calls.modals.length, 1, '必须弹一次')
  const opts = calls.modals[0]
  assert.equal(opts.title, '联系平台客服提现')
  assert.equal(opts.content, '请在小程序客服会话里确认金额。平台不直接打款。')
  assert.equal(opts.confirmText, '知道了')
  assert.equal(opts.showCancel, false)
  assert.equal(calls.clipboard.length, 0)
  assert.deepEqual(calls.toasts, [])
})

test('确认不写剪贴板', () => {
  const { api, calls } = loadWithdrawCs()
  api.showWithdrawCsPopup()
  const opts = calls.modals[0]
  if (typeof opts.success === 'function') opts.success({ confirm: true })
  assert.deepEqual(calls.clipboard, [])
  assert.deepEqual(calls.toasts, [])
  assert.doesNotMatch(read(WITHDRAW_CS_PATH), /setClipboardData|copyWithdrawCsWechat/)
})

test('客服微信号已离开客户端', () => {
  const id = '1801857'+'1626'
  const source = read(WITHDRAW_CS_PATH)
  assert.equal(source.includes(id), false)
  assert.doesNotMatch(source, /setClipboardData|copyWithdrawCsWechat|添加客服微信，确认金额后线下处理/)
  const hits = []
  const walk = (dir) => {
    fs.readdirSync(dir, { withFileTypes: true }).forEach((item) => {
      if (item.name === 'node_modules' || item.name === 'miniprogram_npm') return
      const full = path.join(dir, item.name)
      if (item.isDirectory()) { walk(full); return }
      if (!/\.(js|wxml|wxss|json)$/.test(item.name)) return
      const text = fs.readFileSync(full, 'utf8')
      const count = text.split(id).length - 1
      if (count) hits.push([path.relative(ROOT, full), count])
      const rel = path.relative(ROOT, full)
      if (!rel.startsWith('tests' + path.sep) && text.includes('添加客服微信，确认金额后线下处理')) {
        hits.push([rel, 'tip'])
      }
    })
  }
  walk(ROOT)
  assert.deepEqual(hits, [])
})

ENTRIES.forEach((entry) => {
  test(`${entry.id}: 点击只弹客服微信,不发提现请求、不再进银行卡链路`, () => {
    assertEntryOpensPopup(entry)
    const runtime = loadEntry(entry.file)
    if (entry.prepare) entry.prepare(runtime)
    const before = runtime.requests.slice()
    entry.drive(runtime.page)
    assert.equal(runtime.popups.length, 1, '必须打开客服弹窗')
    assert.deepEqual(runtime.requests, before, '联系客服动作不得新增资金或其他请求')
    assert.deepEqual(runtime.navigations, [], '不得再跳银行卡表单/独立提现页')
    // ⚠️ 这里**不能**断言 runtime.modals 为空:loadEntry 把 utils/withdraw-cs.js 整体替成了桩,
    //    唯一可能调 wx.showModal 的 modal.js 回落压根不进沙箱,那样的断言恒真、永远不会红。
    //    「不走原生弹窗旁路」由 modal.show 的唯一出口 + 各宿主页挂 cy-modal-host 保证
    //    (宿主挂载由 sheet/modal 相关既有契约钉住)。
  })
})

// 负控:4 个入口逐个退回旧链路(跳银行卡表单)都必须判红 —— 只钉两个入口时,
// 另外四个的正向断言没有「能变红」的证据,等于没有门禁。
ENTRIES.forEach((entry) => {
  test(`负控:${entry.id} 退回旧提现链路时必须判红`, () => {
    const source = read(entry.file)
    const broken = source.replace(
      /withdrawCs\.showWithdrawCsPopup\(\)/,
      "wx.navigateTo({ url: '/subpackageMember/tixian/tixian' })",
    )
    assert.notEqual(broken, source, `负控锚点失效:${entry.id} 没有走客服弹窗`)
    assert.throws(() => assertEntryOpensPopup(entry, broken), assert.AssertionError)
  })
})

for (const change of ['account', 'role', 'type', 'hide', 'unload']) {
  test(`账户收益宿主页提现权限回调遇到${change}变化不能弹客服`, () => {
    const h = loadEntry('subpackageA/pages/assetcenter/earnings/index.js', undefined, { deferGuard: true })
    h.page.onLoad({})
    h.page.onShow()
    h.page.openWithdrawSheet()
    assert.equal(h.guardCallbacks.length, 1)
    if (change === 'account') h.identity.memberId = 2
    if (change === 'role') h.identity.role = 'merchant'
    if (change === 'type') h.identity.type = 2
    if (change === 'hide') h.page.onHide()
    if (change === 'unload') h.page.onUnload()
    h.guardCallbacks[0]()
    assert.deepEqual(h.popups, [])
    assert.deepEqual(h.requests, [])
  })
}

test('账户收益宿主页仅接纳最近一次提现动作的权限回调', () => {
  const h = loadEntry('subpackageA/pages/assetcenter/earnings/index.js', undefined, { deferGuard: true })
  h.page.onLoad({})
  h.page.openWithdrawSheet()
  h.page.openWithdrawSheet()
  h.guardCallbacks[0]()
  assert.deepEqual(h.popups, [])
  h.guardCallbacks[1]()
  assert.equal(h.popups.length, 1)
  assert.deepEqual(h.requests, [])
})

test('宿主页隐藏再显示后旧权限回调仍失效，当前动作正常弹客服', () => {
  const h = loadEntry('subpackageA/pages/assetcenter/earnings/index.js', undefined, { deferGuard: true })
  h.page.onLoad({})
  h.page.openWithdrawSheet()
  h.page.onHide()
  h.page.onShow()
  h.guardCallbacks[0]()
  assert.deepEqual(h.popups, [])
  h.page.openWithdrawSheet()
  h.guardCallbacks[1]()
  assert.equal(h.popups.length, 1)
})

test('宿主页卸载后直接触发提现不再查询能力或弹客服', () => {
  const h = loadEntry('subpackageA/pages/assetcenter/earnings/index.js')
  h.page.onLoad({})
  h.page.onUnload()
  h.page.openWithdrawSheet()
  assert.deepEqual(h.popups, [])
})
