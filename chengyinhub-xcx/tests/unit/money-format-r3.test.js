'use strict'

// 打磨第 3 轮 §4-9(2026-11-22 起一位小数):负数金额统一为「−¥15.44」,走 utils/money-format.js 一个入口;结算、批次详情、退款行都经过它。
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { yuan, yuanTrim, fixed2, decimalText, MINUS } = require('../../utils/money-format.js')

const ROOT = path.join(__dirname, '../..')

test('yuan:负数 −¥、一位小数(第二位非零才两位)、signed 才给 +、零不带符号、读不出返回 null', () => {
  assert.equal(MINUS, '−')
  assert.equal(yuan(-15.44), '−¥15.44')
  assert.equal(yuan('-15.4'), '−¥15.4')
  assert.equal(yuan(1000), '¥1000.0')
  assert.equal(yuan(1000, { signed: true }), '+¥1000.0')
  assert.equal(yuan(-2, { signed: true }), '−¥2.0')
  assert.equal(yuan(0, { signed: true }), '¥0.0')
  assert.equal(yuan(-0.001), '¥0.0')
  for (const v of [null, undefined, '', 'abc', NaN]) assert.equal(yuan(v), null)
  assert.equal(fixed2(-15.444), '-15.44')
})

// 2026-11-22 业主定稿:「数字只需要显示到一位小数」;第二位小数非零时显示两位,绝不把金额显示错。
// 取代旧「一律两位小数」与 OR-046「不补零」(复核 OR-021)。
test('2026-11-22 一位小数口径:29.9 / 39 / 1200 / 0.01 / 12.35 / 0 / 负数退款', () => {
  assert.equal(yuan(29.9), '¥29.9')
  assert.equal(yuan(39), '¥39.0')
  assert.equal(yuan('39.00'), '¥39.0')
  assert.equal(yuan(1200), '¥1200.0')
  assert.equal(yuan(0.01), '¥0.01')
  assert.equal(yuan(12.35), '¥12.35')
  assert.equal(yuan(0), '¥0.0')
  assert.equal(yuan('0.00'), '¥0.0')
  assert.equal(yuan(-29.9), '−¥29.9')
  assert.equal(yuan(-39), '−¥39.0')
  assert.equal(yuan(-0.01), '−¥0.01')
  assert.equal(yuan(-12.35), '−¥12.35')
  assert.equal(yuan(0.1 + 0.2), '¥0.3')
  assert.equal(yuanTrim(29.9), '¥29.9')
  assert.equal(yuanTrim(39), '¥39.0')
  assert.equal(decimalText(39), '39.0')
  assert.equal(decimalText(-12.35), '-12.35')
  assert.equal(decimalText('abc'), null)
})

test('money.wxs 与 money-format.js 同口径(WXML 里的 ¥ 都经它)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'utils/wxs/money.wxs'), 'utf8')
  const mod = { exports: {} }
  new Function('module', src)(mod)
  const { amount, amount2 } = mod.exports
  for (const [v, want] of [[29.9, '¥29.9'], [39, '¥39.0'], ['39.00', '¥39.0'], [1200, '¥1200.0'], [0.01, '¥0.01'],
    [12.35, '¥12.35'], [0, '¥0.0'], ['-15.40', '¥-15.4'], [null, '¥0.0'], ['', '¥0.0'], ['39-59', '¥39-59']]) {
    assert.equal(amount(v), want, String(v))
    assert.equal(amount2(v), want, String(v))
  }
})

function loadPage(rel) {
  let cfg = null
  global.getApp = () => ({ globalData: {} })
  global.wx = { getStorageSync: () => '', setStorageSync() {}, getSystemInfoSync: () => ({}), getWindowInfo: () => ({}), getAppBaseInfo: () => ({}) }
  global.Page = (c) => { cfg = c }
  global.Component = (c) => { cfg = c }
  const file = path.join(ROOT, rel)
  delete require.cache[require.resolve(file)]
  require(file)
  return cfg
}

test('结算页:负的收入明细与批次不再渲成 ¥-', () => {
  const page = loadPage('pages/merchant/ledger/index.js')
  const entry = page.entryRow({ signedAmount: -15.44, source: 'MERCHANT_CLAWBACK' })
  assert.equal(entry.amountDisplay, '−¥15.44')
  assert.equal(entry.amountTone, 'neg')
  assert.equal(page.entryRow({ signedAmount: 1000 }).amountDisplay, '+¥1000.0')
  assert.equal(page.batchRow({ amountTotal: -15.44 }).amountDisplay, '−¥15.44')
  assert.equal(page.redemptionRow({ settlementAmount: -3 }, true).amountDisplay, '−¥3.0')
})

test('源码:结算/批次/核销详情/退款/合作分润/客户详情不再自己拼 ¥', () => {
  const files = [
    'pages/merchant/ledger/index.js',
    'pages/merchant/ledger/batch-detail/index.js',
    'pages/merchant/ledger/order-detail/index.js',
    'pages/merchant/aftercare/detail/view-model.js',
    'pages/coop/components/settlement-detail/view-model.js',
    'pages/merchant/customer/detail/view-model.js',
    'subpackageA/components/scene-merchant-profit/index.js',
    'subpackageA/components/scene-merchant-profit/index.wxml',
  ]
  for (const f of files) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '')
    assert.doesNotMatch(src, /`[^`]*¥\$\{|'¥' ?\+|'[+−]¥' ?\+/, f)
  }
})
