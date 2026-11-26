'use strict'

// 业主 2026-11-22 定稿(分支 fix/owner-decisions-1122):
//   1) 金额一位小数 —— 见 money-format-r3.test.js / blank-value-display-contract.test.js。
//   2) 复核 PG-086:「玩家不需要看到编号」—— 不往玩家屏新增核验/提交编号;商家「输入核验编号」手工流程保持原样。
//   3) 2026-11-26 业主推翻「主题详情不加举报」:详情正文在 canReportTopic 时出「举报」。
//      头图、玩法详情、俱乐部主题活动卡仍然不露入口;处理器与后端接口保留。
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '../..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const stripComments = (wxml) => wxml.replace(/<!--[\s\S]*?-->/g, '')

test('2026-11-26:主题详情正文在 canReportTopic 时出「举报」,头图不放入口', () => {
  const wxml = stripComments(read('pages/topic/index/index.wxml'))
  assert.match(wxml, /<text wx:if="\{\{canReportTopic\}\}" class="ugc-report" bindtap="reportTopic"[^>]*>举报<\/text>/)
  assert.doesNotMatch(wxml, /举报这个主题|topic-report-entry/)
  assert.ok(wxml.indexOf('class="ugc-report"') > wxml.indexOf('class="topic-beta"'))
  const hero = wxml.slice(wxml.indexOf('<view class="cont topic-hero-meta">'), wxml.indexOf('<view class="topic-beta"'))
  assert.doesNotMatch(hero, /reportTopic|ugc-report/)
  const js = read('pages/topic/index/index.js')
  assert.match(js, /reportTopic\(\) \{/)
  assert.match(js, /if \(!this\.data\.canReportTopic\) return/)
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
