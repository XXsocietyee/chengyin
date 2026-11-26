'use strict'
// 2026-10-29 走查 V-20:订单详情 —— 头图恢复成主题/场次自己的图、去掉「查看票夹」、
// 页面能滑到底(page 档宿主不再 catchtouchmove)、间距放开、票价显示真实单价(免费 ¥0)。
const { beforeEach, test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { flattenComponentToPage } = require('../helpers/component-as-page.js')

const ROOT = path.resolve(__dirname, '../..')
const DIR = 'subpackageMember/components/cy/scene-member-order-detail/'
const JS = path.join(ROOT, DIR + 'index.js')
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8')

let sandbox
beforeEach(() => {
  sandbox = { requests: [] }
  global.getApp = () => ({
    globalData: {}, tips() {}, sendRequest: o => sandbox.requests.push(o),
    getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
    getImgUrl: src => !src ? '' : (src[0] === '/' ? src : (/^https?:/.test(src) ? src.replace(/^http:/, 'https:') : 'https://www.chengyinhub.com/prod-api/profile/' + src)),
  })
  global.Component = config => { sandbox.config = flattenComponentToPage(config) }
  global.wx = { showToast() {}, hideLoading() {}, showLoading() {}, navigateTo() {}, navigateBack() {} }
})
function load(row) {
  delete require.cache[require.resolve(JS)]
  require(JS)
  const vm = Object.assign({}, sandbox.config, { setData(patch, cb) { Object.assign(this.data, patch); if (cb) cb() } })
  vm.data = Object.assign({}, sandbox.config.data)
  sandbox.requests = []; vm.data.orderId = String(row.id); vm.onLoad()
  sandbox.requests.find(r => r.url === '/api/registration/info').success({ code: 200, data: row })
  return vm
}

test('V-20 头图用主题自己的封面，经 getImgUrl 补全，逗号分隔的 imgArr 取首图', () => {
  let vm = load({ id: 1, ownerType: 1, registrationStatus: 2, paymentStatus: 2, cmsTopic: { name: '南京路', imgArr: 'upload/a.jpg,upload/b.jpg' } })
  assert.equal(vm.data.heroImage, 'https://www.chengyinhub.com/prod-api/profile/upload/a.jpg')
  vm = load({ id: 2, ownerType: 1, registrationStatus: 2, paymentStatus: 2, cmsTopic: { name: '南京路', imgUrl: 'http://chengyin-oss.oss-cn-shanghai.aliyuncs.com/c.jpg' } })
  assert.equal(vm.data.heroImage, 'https://chengyin-oss.oss-cn-shanghai.aliyuncs.com/c.jpg')
  vm = load({ id: 3, ownerType: 2, registrationStatus: 2, paymentStatus: 2, cmsActivity: { name: '夜行', imgUrl: 'upload/x.png' } })
  assert.equal(vm.data.heroImage, 'https://www.chengyinhub.com/prod-api/profile/upload/x.png')
  vm = load({ id: 4, ownerType: 1, registrationStatus: 2, paymentStatus: 2, cmsTopic: { name: '无图' } })
  assert.equal(vm.data.heroImage, '/subpackageMember/images/icon_ticket_empty.svg')
})

test('V-20 票价显示真实单价，免费单没有快照时是 ¥0 而不是「—」', () => {
  let vm = load({ id: 5, ownerType: 1, registrationStatus: 2, paymentStatus: 2, totalAmount: 0, payableAmount: 0, cmsTopic: { name: 'free' } })
  assert.equal(vm.data.info.isFreeOrder, true)
  assert.equal(vm.data.ticketPriceShown, 0)
  vm = load({ id: 6, ownerType: 1, registrationStatus: 2, paymentStatus: 2, ticketPrice: 39.9, payableAmount: 39.9, wechatPaymentAmount: 39.9, cmsTopic: { name: 'paid' } })
  assert.equal(vm.data.ticketPriceShown, 39.9)
  assert.equal(vm.data.ticketPriceIsTotal, false)
  const wxml = read(DIR + 'index.wxml')
  assert.match(wxml, /<text class="orow-k">票价<\/text>\s*<text class="orow-v">\{\{money\.amount2?\(ticketPriceShown\)\}\}\{\{ticketPriceIsTotal \? '' : ' × ' \+ orderQty\}\}<\/text>/)
})

// L09-084
// 业主默认 A:没有单价时只写下单原总价(100 元 3 张写 ¥100,不写 ¥33.33 × 3)
test('L09-084 没有单价快照时票价行只写原总价,不拼「单价 × 数量」', () => {
  const vm = load({ id: 7, ownerType: 1, registrationStatus: 2, paymentStatus: 2, orderNum: 3, originalAmount: 100, payableAmount: 100, wechatPaymentAmount: 100, cmsTopic: { name: 'pass' } })
  assert.equal(vm.data.ticketPriceShown, 100)
  assert.equal(vm.data.ticketPriceIsTotal, true)
  const shown = '¥' + vm.data.ticketPriceShown + (vm.data.ticketPriceIsTotal ? '' : ' × ' + vm.data.orderQty)
  assert.equal(shown, '¥100')
})

// V3-03(2026-11-09 业主):「订单这里不需要有开始游戏按钮 开始游戏只从票夹那进去」⇒
// 进行中订单底部不再出「开始游戏」(j2 F-06 那颗收回),入口只在票夹。
test('V-20 订单详情不再有「查看票夹」按钮，进行中订单底部也不出「开始游戏」', () => {
  const wxml = read(DIR + 'index.wxml').replace(/<!--[\s\S]*?-->/g, '')
  assert.doesNotMatch(wxml, /查看票夹/)
  assert.doesNotMatch(wxml, /bindtap="goSignInfo"/)
  assert.match(wxml, /class="bp-cta-bar" wx:if="\{\{primaryCta === 'pay'\}\}"/)
  const vm = load({ id: 7, ownerType: 1, ownerId: 70, registrationStatus: 2, paymentStatus: 2, verificationStatus: 0, cmsTopic: { id: 70, name: 't' } })
  assert.equal(vm.data.info.orderStateKey, 'in_progress')
  assert.equal(vm.data.primaryCta, '')
  assert.doesNotMatch(wxml, /开始游戏/)
})

test('V-20 page 档订单详情的宿主不吃 touchmove，正文能滑到底', () => {
  const order = read('subpackageMember/order/order.wxml').replace(/<!--[\s\S]*?-->/g, '')
  const host = order.match(/<view class="order-scene-host" wx:if="\{\{sceneCurrent && sceneCurrent\.id === 'member-order-detail'\}\}"[^>]*>/)
  assert.ok(host); assert.doesNotMatch(host[0], /catchtouchmove/)
  assert.match(read('utils/scene-registry.js'), /'member-order-detail': \{[^}]*variant: 'page'/)
})

test('V-20 R2 时间线和退款与客服卡不再是更浅的色块：同 .ocard 的底色与圆角，时间线有自己的段标题', () => {
  const wxss = read(DIR + 'index.wxss')
  const wxml = read(DIR + 'index.wxml')
  assert.match(wxml, /<view class="sec-title">订单进度<\/view>\s*<view class="order-timeline"/)
  assert.match(wxss, /\.body \{[^}]*--cy-scene-card-bg: var\(--cy-color-bg-surface\);[^}]*--cy-scene-card-radius: var\(--cy-radius-xl\);/)
  assert.match(wxss, /\.order-timeline \{[^}]*border-radius: var\(--cy-scene-card-radius, var\(--cy-radius-lg\)\); background: var\(--cy-scene-card-bg,/)
})

// L09-085
// 业主默认 A:微信实付 / 积分只在「支付明细」出现一次,「支付信息」不再重复
test('L09-085 微信实付与积分只在支付明细里出现,支付信息卡不重复', () => {
  const wxml = read(DIR + 'index.wxml')
  const detailFrom = wxml.indexOf("{{info.isFreeOrder ? '费用明细' : '支付明细'}}")
  const infoFrom = wxml.indexOf("{{info.isFreeOrder ? '报名信息' : '支付信息'}}")
  assert.ok(detailFrom > 0 && infoFrom > detailFrom)
  const detail = wxml.slice(detailFrom, infoFrom)
  const info = wxml.slice(infoFrom, wxml.indexOf('</block>', infoFrom))
  assert.match(detail, /wx:if="\{\{showWechatPay\}\}"/)
  assert.match(detail, /wx:if="\{\{showPointPay\}\}"/)
  assert.doesNotMatch(info, /showWechatPay|showPointPay|wechatPaymentAmount|pointPaymentAmount/)
  assert.match(info, /支付时间|paymentTimeText/)
  assert.match(info, /transactionId/)
})
