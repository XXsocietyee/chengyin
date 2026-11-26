'use strict'

// 业主 2026-11-22 定稿(分支 fix/owner-decisions-1122):
//   1) 金额一位小数 —— 见 money-format-r3.test.js / blank-value-display-contract.test.js。
//   2) 复核 PG-086:「玩家不需要看到编号」—— 不往玩家屏新增核验/提交编号;商家「输入核验编号」手工流程保持原样。
//   3) 复核 V-23(device-walkthrough-20261029):「这个主题不允许举报,先不加举报按钮」——
//      主题相关的玩家屏不露出任何举报入口;处理器与后端接口保留(不删),只是不暴露。
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '../..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const stripComments = (wxml) => wxml.replace(/<!--[\s\S]*?-->/g, '')

test('V-23 复核:主题详情没有任何可点的举报入口,举报原因半屏只由休眠的 reportTopic 打开', () => {
  const wxml = stripComments(read('pages/topic/index/index.wxml'))
  assert.doesNotMatch(wxml, /(bind|catch)(tap|longpress)="reportTopic"/)
  // 唯一剩下的「举报」字样是原因半屏(show 绑 reportReasonShow),不是入口
  const visible = wxml.split('\n').filter((line) => /举报/.test(line) && !/reportReasonShow|提交举报/.test(line))
  assert.deepEqual(visible, [])
  const js = read('pages/topic/index/index.js')
  assert.match(js, /reportTopic\(\) \{/, '处理器保留(休眠),不删')
  assert.equal((js.match(/reportReasonShow: true/g) || []).length, 0, '页面自身不直接打开举报半屏')
})

test('V-23 复核:玩法(模板)详情不露举报入口', () => {
  const wxml = stripComments(read('pages/templatedetail/templatedetail.wxml'))
  assert.doesNotMatch(wxml, /举报/)
  assert.doesNotMatch(wxml, /(bind|catch)tap="report/)
})

test('V-23 复核:俱乐部页主题活动卡「更多 → 举报活动」不露出,处理器保留', () => {
  const js = read('pages/club/detail/index.js')
  assert.match(js, /\n    topicReportExposed: false,\n/)
  const wxml = read('pages/club/detail/index.wxml')
  assert.match(wxml, /canReport: topicReportExposed && canSeeMembers && item\.memberId != myMemberId/)
  assert.match(wxml, /wx:if="\{\{canReport\}\}" class="ev-more" catchtap="onEventMore"/)
  assert.match(js, /reportTopicActivity\(e\) \{/, '处理器保留(休眠),不删')
  assert.ok(fs.existsSync(path.join(ROOT, 'pages/topic/utils/content-report.js')), '主题举报写链保留')
})

test('PG-086 复核:商家「输入核验编号」手工流程保持原样', () => {
  const wxml = read('pages/merchant/game-node/index.wxml')
  assert.match(wxml, /bindtap="openManualVerification">输入核验编号</)
})
