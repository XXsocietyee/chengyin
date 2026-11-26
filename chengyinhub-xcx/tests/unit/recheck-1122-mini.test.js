'use strict'
// RECHECK-1122:VERIFY-D/E 复核遗留小程序条目的回归合同(每条一个断言组)。
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..', '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')

test('PG-003 play 页 topicName 走 safeDecode,坏 % 不抛', () => {
  const js = read('pages/play/index.js')
  assert.match(js, /require\('\.\.\/\.\.\/utils\/safe-decode\.js'\)/)
  assert.match(js, /this\._entryTopicName = options\.topicName \? safeDecode\(options\.topicName\)/)
  assert.doesNotMatch(js, /decodeURIComponent\(options\.topicName\)/)
  const { safeDecode } = require('../../utils/safe-decode.js')
  assert.equal(safeDecode('100%'), '100%')
})

test('PG-008 只选日期/价格也进结果页;全空仍提示', () => {
  const js = read('pages/search2/index.js')
  const nav = js.slice(js.indexOf('  navigateToSearchList() {'), js.indexOf("wx.navigateTo({ url: '/pages/search2/result/index?'"))
  assert.match(nav, /!keyword && !filterConditions\.categoryId && !dateOrPrice/)
  assert.match(nav, /num\(filterConditions\.minPrice\) > 0/)
  assert.match(nav, /num\(filterConditions\.maxPrice\) < 1000/)
})

test('PG-046 俱乐部详情 .feed-divider 走边框 token', () => {
  const css = read('pages/club/detail/index.wxss')
  assert.match(css, /\.feed-divider \{[^}]*background: var\(--cy-color-border-subtle\)/)
})

test('PG-051 帖文详情不再残留 .step 死样式与注释块', () => {
  assert.doesNotMatch(read('pages/square/detail/index.wxss'), /\.detail \.step/)
  assert.doesNotMatch(read('pages/square/detail/index.wxml'), /<!-- <view class="step">/)
})

test('PG-054 俱乐部管理页根容器底部留安全区', () => {
  const pages = {
    'pages/club/enroll/index.wxss': /\.page \{[^}]*padding-bottom: calc\(var\(--cy-space-5\) \+ var\(--cy-safe-bottom\)\)/,
    'pages/club/join-requests/index.wxss': /\.page \{[^}]*padding-bottom: calc\(var\(--cy-space-5\) \+ var\(--cy-safe-bottom\)\)/,
    'pages/club/event-ops/index.wxss': /\.page \{[^}]*padding-bottom: calc\(var\(--cy-space-8\) \+ var\(--cy-safe-bottom\)\)/,
    'pages/club/settlement/index.wxss': /\.page \{[^}]*padding-bottom: calc\(var\(--cy-space-8\) \+ var\(--cy-safe-bottom\)\)/,
    'pages/club/payout-receiver/index.wxss': /\.pr-shell \{[^}]*calc\(var\(--cy-space-8\) \+ var\(--cy-safe-bottom\)\)/,
    'pages/club/customer-detail/index.wxss': /\.page \{[^}]*calc\(var\(--cy-space-5\) \+ var\(--cy-safe-bottom\)\)/,
    'pages/club/group-code/index.wxss': /\.session-picker \{[^}]*padding-bottom: calc\(var\(--cy-space-6\) \+ var\(--cy-safe-bottom\)\)/,
  }
  for (const [file, re] of Object.entries(pages)) assert.match(read(file), re, file)
})

// 业主 2026-11-24 决定删掉从未上线的路线模式介绍弹层,认证卡那组 .cense .davidbmtk 样式随之删除
test('PG-058 merchantinfo 认证卡样式随模式介绍弹层一起删除,不留硬编码色', () => {
  const css = read('pages/topic/merchantinfo/merchantinfo.wxss')
  assert.doesNotMatch(css, /\.cense \.davidbmtk|\.davidbmtk/)
})

test('PG-062 未绑定函数已删', () => {
  assert.doesNotMatch(read('pages/shezhi/shezhi.js'), /openRegPicker\(/)
  assert.doesNotMatch(read('pages/privacy/index.js'), /onTocTap\(/)
  assert.doesNotMatch(read('pages/templatedetail/templatedetail.js'), /previewGalleryAll\(/)
  assert.doesNotMatch(read('subpackageMember/orderinfo/orderinfo.js'), /openChildScene|openScene/)
  assert.doesNotMatch(read('subpackageMember/mycanyuinfo/mycanyuinfo.js'), /noop\(/)
  assert.doesNotMatch(read('subpackageMember/mycanyuinfo/mycanyuinfo.wxml'), /"noop"/)
})

test('S3 结局「走过」站名列表不用 *this 作 key', () => {
  assert.match(read('pages/play/index.wxml'), /wx:for="\{\{previewEnding\.archive\.stations\}\}" wx:key="index"/)
})

test('PART2 RISK:IM 静音/拉黑/解除拉黑/通知已读与申请主理人显式标写', () => {
  assert.match(read('subpackageB/pages/im/list/index.js'), /url: '\/api\/im\/mute', method: 'POST', write: true/)
  const chat = read('subpackageB/pages/im/chat/index.js')
  assert.match(chat, /url: '\/api\/im\/block', method: 'POST', write: true/)
  assert.match(chat, /url: '\/api\/im\/unblock', method: 'POST', write: true/)
  // 通知批量标已读是后台调用,不标写(标写会让会话过期时弹登录窗)
  assert.match(chat, /notifications\/' \+ id \+ '\/read',\n\s*method: 'POST',\n/)
  assert.match(read('pages/club/apply/index.js'), /url: '\/api\/club\/become-leader',\n\s*method: 'POST', write: true/)
})

test('OR-013 整单退款:结算视图不拆票、不写「部分已退款」', () => {
  const { settlementView } = require('../../subpackageMember/utils/order-settlement-view.js')
  assert.equal(settlementView({ refundStage: 'NONE', refundedTicketCount: 2, ticketCount: 3 }).show, false)
  const v = settlementView({ refundStage: 'WHATEVER', refundedTicketCount: 1, ticketCount: 3, amountsComplete: true })
  assert.equal(v.stage, '退款状态待确认')
  assert.doesNotMatch(read('subpackageMember/utils/order-settlement-view.js'), /部分已退款|已退 ' \+/)
})

test('OR-021 结算视图金额经 money-format.yuan', () => {
  const { settlementView } = require('../../subpackageMember/utils/order-settlement-view.js')
  const v = settlementView({ refundStage: 'COMPLETED', amountsComplete: true, refundCompletedAmount: 29.9 })
  assert.equal(v.rows.find((r) => r.key === 'completed').value, '¥29.9')
  assert.match(read('subpackageMember/utils/order-settlement-view.js'), /moneyFormat\.yuan\(v\)/)
})

test('OR-024 通行证 terms 为服务端字符串数组时逐条归位显示', () => {
  const pp = require('../../subpackageMember/utils/platform-pass.js')
  const terms = ['有效期内可领取通行证含的主题自玩票', '有效期：月卡30天，自开通起算', '仅本人可用，不含同行人', '不自动续费', '退款为整单退款，领取过主题需人工审核']
  assert.deepEqual(pp.termRows({ terms }), [
    { k: '续费', v: '不自动续费' },
    { k: '退款规则', v: '退款为整单退款，领取过主题需人工审核' },
  ])
  const facts = pp.passView({ enabled: true, plans: [{ planCode: 'MONTH', priceFen: 3900, validDays: 30 }], terms, libraryCount: null }, '', 'ios', true).facts
  const map = Object.fromEntries(facts.map((r) => [r.k, r.v]))
  assert.equal(map['可玩主题'], '有效期内可领取通行证含的主题自玩票')
  assert.equal(map['适用范围'], '仅本人可用，不含同行人')
  assert.equal(map['有效期'], '月卡30天，自开通起算')
  // 旧对象形状仍兼容
  assert.deepEqual(pp.termRows({ terms: { renewal: 'R', refund: 'F' } }), [{ k: '续费', v: 'R' }, { k: '退款规则', v: 'F' }])
})

test('OR-005/OR-022 通行证整单退款兜底文案单源 refund-tiers', () => {
  const tiers = require('../../subpackageMember/utils/refund-tiers.js')
  const pp = require('../../subpackageMember/utils/platform-pass.js')
  assert.deepEqual(pp.termRows(null), [{ k: '续费', v: tiers.PASS_RENEWAL_TEXT }, { k: '退款规则', v: tiers.PASS_REFUND_TEXT }])
  assert.doesNotMatch(read('subpackageMember/utils/platform-pass.js'), /'退款为整单'|'不自动续费'/)
})

test('OR-042 隐私页本人媒体行显示上传日期', () => {
  const js = read('pages/privacy/index.js')
  assert.match(js, /uploadTimeText: uploadTimeText\(row\.createdAt\)/)
  assert.match(read('pages/privacy/index.wxml'), /\{\{item\.typeLabel\}\}<block wx:if="\{\{item\.uploadTimeText\}\}"> · \{\{item\.uploadTimeText\}\}<\/block> · \{\{item\.stateLabel\}\}/)
  const fn = new Function(js.slice(js.indexOf('function uploadTimeText'), js.indexOf('\nPage(')) + '\nreturn uploadTimeText;')()
  assert.equal(fn('2026-11-22 10:11:12'), '2026-11-22')
  assert.equal(fn(null), '')
  assert.equal(fn('not-a-date'), '')
  assert.match(fn(Date.UTC(2026, 10, 22, 4)), /^2026-11-2[12]$/)
})

test('FE-G9 纯权益主题订单详情隐藏探店图鉴/通关奖励', () => {
  const wxml = read('subpackageMember/components/cy/scene-member-order-detail/index.wxml')
  assert.equal((wxml.match(/wx:if="\{\{completion\.show && !completion\.perkOnly\}\}"/g) || []).length, 2)
  const js = read('subpackageMember/components/cy/scene-member-order-detail/index.js')
  assert.match(js, /if \(view\.show\) that\.loadPerkOnly\(info, isCurrent\)/)
  assert.match(js, /if \(d && d\.perkOnly === true\) that\.setData\(\{ 'completion\.perkOnly': true \}\)/)
  assert.match(js, /if \(Number\(value\.ownerType\) !== 1\) return ''/)
})

test('FE-G23 权益卡表单优先显示 perkNoCashReason', () => {
  const js = read('pages/topic/components/cy/chapter-node-form/index.js')
  assert.match(js, /pick\(data\.perkNoCashReason\) \|\| pick\(data\.text\)/)
})
