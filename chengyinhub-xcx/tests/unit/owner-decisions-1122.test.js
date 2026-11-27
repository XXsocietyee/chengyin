'use strict'

// 业主 2026-11-22 定稿(分支 fix/owner-decisions-1122):
//   1) 金额一位小数 —— 见 money-format-r3.test.js / blank-value-display-contract.test.js。
//   2) 复核 PG-086:「玩家不需要看到编号」—— 不往玩家屏新增核验/提交编号;商家「输入核验编号」手工流程保持原样。
//   3) 2026-11-26 拍板覆盖 V-23:用户发布的主题、评价、玩法模板和俱乐部主题活动要有举报入口。
//      入口不放在头图上。不能举报自己的主题;俱乐部活动仍不能举报自己的那一条。
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '../..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const stripComments = (wxml) => wxml.replace(/<!--[\s\S]*?-->/g, '')

test('2026-11-26:主题详情在评价下方提供举报,头图上没有', () => {
  const wxml = stripComments(read('pages/topic/index/index.wxml'))
  assert.match(wxml, /wx:if="\{\{canReport\}\}" class="ugc-report ugc-report--block" bindtap="reportTopic"/)
  assert.match(wxml, /catchtap="reportComment"/)
  const hero = wxml.slice(0, wxml.indexOf('class="det6"'))
  assert.doesNotMatch(hero, /bindtap="reportTopic"|catchtap="reportComment"/)
  const js = read('pages/topic/index/index.js')
  assert.match(js, /reportTopic\(\) \{/)
  assert.match(js, /reportComment\(e\) \{/)
})

test('2026-11-26:玩法详情提供举报', () => {
  const wxml = stripComments(read('pages/templatedetail/templatedetail.wxml'))
  assert.match(wxml, /bindtap="reportTemplate"/)
  assert.match(read('pages/templatedetail/templatedetail.js'), /reportTemplate\(\) \{/)
})

test('2026-11-26 业主:俱乐部主题活动可举报,本人活动仍不可报', () => {
  const js = read('pages/club/detail/index.js')
  assert.match(js, /\n    topicReportExposed: true,\n/)
  const wxml = read('pages/club/detail/index.wxml')
  assert.match(wxml, /canReport: topicReportExposed && canSeeMembers && item\.memberId != myMemberId/)
  assert.match(wxml, /wx:if="\{\{canReport\}\}" class="ev-more ugc-report" catchtap="onEventMore"/)
  const cardCover = wxml.match(/<view class="ev-coverslot">[\s\S]*?<\/view>\s*<view class="ev-body">/)
  assert.ok(cardCover, '活动封面槽仍在')
  assert.doesNotMatch(cardCover[0], /ugc-report|onEventMore|举报/)
  const heroStart = wxml.indexOf('<view class="cover-wrap">')
  const heroEnd = wxml.indexOf('<view class="profile', heroStart)
  assert.ok(heroStart >= 0 && heroEnd > heroStart, '俱乐部封面 hero 仍在')
  assert.doesNotMatch(wxml.slice(heroStart, heroEnd), /ugc-report|onEventMore|举报/)
  assert.match(js, /reportTopicActivity\(e\) \{/, '处理器保留,不删')
  assert.ok(fs.existsSync(path.join(ROOT, 'pages/topic/utils/content-report.js')), '主题举报写链保留')
})

test('PG-086 复核:商家「输入核验编号」手工流程保持原样', () => {
  const wxml = read('pages/merchant/game-node/index.wxml')
  assert.match(wxml, /bindtap="openManualVerification">输入核验编号</)
})
