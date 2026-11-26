'use strict'

// 2026-09-15 收款模型定稿 §3:平台不打款,三处资金写入口(独立提现页 / 账户收益 sheet /
// scene-route 的 member-withdraw 场景表单)不再建提现单,一律弹平台客服微信线下处理。
// 原「三入口校验一致性 / requestId / 单独同意建单」那一族契约随写入口一起退役 —— 它们守的
// 行为已不存在,留着只会让「三个入口还在建单」这个假事实常驻。本文件只保留两件仍成立的事:
//   ① 俱乐部分润站内入口 → 我的资产宿主的场景栈导航(与提现表单无关);
//   ② 提现能力门禁(withdrawable)仍由各入口统一读取;
//   ③ 后端打款接口不在这次改动里新增或删除。
// L09-124 / L10-016:提现表单与银行卡预检都没有生产 require,两份工具连同单测删除,提现统一走客服。
// 新弹窗契约(6 入口打开客服弹窗/复制/常量单一来源)见 withdraw-cs-popup-contract.test.js。

const assert = require('node:assert/strict')
const fs = require('node:fs')
const { createRequire } = require('node:module')
const path = require('node:path')
const test = require('node:test')
const vm = require('../helpers/ui-sandbox-vm.js')

const ROOT = path.resolve(__dirname, '../..')

const PAGES = {
  merchantInfo: 'pages/topic/merchantinfo/merchantinfo.js',
  earnings: 'subpackageA/pages/assetcenter/earnings/index.js',
  sceneRoute: 'subpackageMember/components/cy/scene-route-content/index.js',
}

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8')
}

function loadPage(relativePath, source = read(relativePath)) {
  const absolutePath = path.join(ROOT, relativePath)
  const navigations = []
  let pageConfig = null
  const app = {
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    getPageSize: () => 20,
    getUserID: () => 1,
    getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
    sendRequest() {},
    tips() {},
  }
  vm.runInNewContext(source, {
    console,
    getApp: () => app,
    Page(config) { pageConfig = config },
    require: createRequire(absolutePath),
    setTimeout() {},
    clearTimeout() {},
    wx: {
      getStorageSync() { return null },
      setStorageSync() {},
      navigateTo(options) { navigations.push(['navigateTo', options]) },
      reLaunch(options) { navigations.push(['reLaunch', options]) },
      navigateBack() {},
      setNavigationBarColor() {},
      setBackgroundColor() {},
    },
  }, { filename: absolutePath })

  assert.ok(pageConfig, `${relativePath} 必须注册 Page`)
  return { page: Object.assign({}, pageConfig, { data: JSON.parse(JSON.stringify(pageConfig.data)) }), navigations }
}

// 走查 v2 R09(业主 2026-10-30):主题工作台的「结算」就地弹分润明细(不离开主题);
// 弹窗里的「全部收益」进浅色账户收益宿主。
test('工作台分润明细就地弹出，全部收益进商家浅色账户收益', () => {
  const merchant = loadPage(PAGES.merchantInfo)
  merchant.page.data.topicId = 42
  merchant.page.setData = function (patch) { Object.assign(this.data, patch) }
  merchant.page.goFinance()
  assert.equal(merchant.navigations.length, 0, '结算不再跳走')
  assert.equal(merchant.page.data.profitSheet.show, true)

  merchant.page.goAllEarnings()
  assert.equal(merchant.navigations.length, 1)
  assert.equal(merchant.navigations[0][0], 'navigateTo')
  assert.equal(merchant.navigations[0][1].url, '/subpackageA/pages/assetcenter/earnings/index?theme=merchant')
  assert.doesNotMatch(read(PAGES.merchantInfo), /navigateTo\(\{ url: '\/pages\/coop\/finance\/index/)
})

// 2026-09-15 退役:三处原写入口里,两份仍有显式能力门禁,scene-route 场景表单不按能力展示
// (它在表单渲染上就带 form:true 契约,不再重复角色判断),所以只钉这三份现码的读法一致。
function assertWithdrawalCapabilityGuards(sources = {}) {
  // L09-130
  // 业主默认 A:能力闸只在拥有客服弹窗的宿主里判(收益页 + 深链宿主),收益组件不再预检
  const component = sources.component || read('subpackageA/components/scene-asset-earnings/index.js')
  const earnings = sources.earnings || read(PAGES.earnings)
  const deepLink = sources.deepLink || read('subpackageMember/components/cy/scene-deep-link/index.js')
  for (const [name, source] of Object.entries({ earnings, deepLink })) {
    assert.match(source, /roleGuard\.can\(['"]withdrawable['"]\)/, `${name} 必须读取 withdrawable 能力`)
    assert.doesNotMatch(source, /roleGuard\.role\(\) === ['"]player['"]/, `${name} 不得再按玩家角色硬拦提现`)
  }
  assert.doesNotMatch(component, /roleGuard/, '收益组件不再重复预检提现能力')
}

test('提现能力门禁仍统一读取 withdrawable,不再按玩家角色硬拦', () => {
  assertWithdrawalCapabilityGuards()
})

test('负控:任一宿主退回 player 角色判断时能力门禁必须判红', () => {
  for (const key of ['earnings', 'deepLink']) {
    const file = key === 'earnings' ? PAGES.earnings : 'subpackageMember/components/cy/scene-deep-link/index.js'
    const broken = read(file).replace("roleGuard.can('withdrawable')", "roleGuard.role() !== 'player'")
    assert.throws(() => assertWithdrawalCapabilityGuards({ [key]: broken }), assert.AssertionError)
  }
})

function productionJs() {
  const out = []
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      if (name === 'node_modules' || name === 'tests') continue
      const abs = path.join(dir, name)
      const stat = fs.statSync(abs)
      if (stat.isDirectory()) walk(abs)
      else if (name.endsWith('.js')) out.push(abs)
    }
  }
  walk(ROOT)
  return out
}

test('L10-016:无生产引用的提现表单与预检已删,不新增打款接口', () => {
  assert.equal(fs.existsSync(path.join(ROOT, 'utils/withdraw-form.js')), false)
  assert.equal(fs.existsSync(path.join(ROOT, 'subpackageA/utils/withdrawal-preflight.js')), false)
  assert.equal(fs.existsSync(path.join(ROOT, 'utils/withdrawal-preflight.js')), false)
  const requireHit = /require\([^)]*(withdraw-form|withdrawal-preflight)/
  const hits = productionJs().filter((file) => requireHit.test(fs.readFileSync(file, 'utf8')))
  assert.deepEqual(hits, [])
})

test('退役:三个原写入口的处理器里不得再出现建单/预检调用', () => {
  const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  const sliceBetween = (source, from, to) => {
    const start = source.indexOf(from)
    const end = source.indexOf(to, start + from.length)
    assert.ok(start >= 0 && end > start, `切片失败: ${from} → ${to}`)
    return stripComments(source.slice(start, end))
  }
  // PG-042:独立提现页 subpackageMember/tixian 已下线
  assert.equal(fs.existsSync(path.join(ROOT, 'subpackageMember/tixian')), false)

  // PG-033:账户收益页的 txSheet 表单与提交死代码已整块删除
  const earnings = stripComments(read(PAGES.earnings))
  assert.doesNotMatch(earnings, /withdrawal\/create|submitBankWithdrawal|txSheet|onTxAmountInput/)

  const sceneRoute = sliceBetween(read(PAGES.sceneRoute), 'submitForm()', 'function payloadForScene')
  assert.doesNotMatch(sceneRoute, /withdrawal\/create|submitBankWithdrawal/)
})
