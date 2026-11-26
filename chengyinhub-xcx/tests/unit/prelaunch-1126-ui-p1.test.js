'use strict';
// 预发 1126 UI：AI 公示、未知计数、坏百分号。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('N1-04 对话标题下固定公示;店铺轨再标合成语音', () => {
  const wxml = read('subpackageMember/components/cy/npc-chat/index.wxml');
  assert.match(wxml, /内容由 AI 生成，仅供参考/);
  assert.match(wxml, /wx:if="\{\{scope === 'merchant'\}\}"[^>]*>AI 合成语音</);
  assert.equal((wxml.match(/内容由 AI 生成，仅供参考/g) || []).length, 1);
});

test('N1-04 creditText 在 pages/play 之外,aiGenerated 为真时带出 AI 生成', () => {
  const { creditText } = require('../../pages/templatedetail/utils/topic-adoption.js');
  assert.equal(creditText({ aiGenerated: true }), 'AI 生成');
  assert.equal(creditText({ aiGenerated: false, attribution: '署名' }), '署名');
  assert.equal(creditText({ aiGenerated: true, sourcePendingConfirmation: true }), 'AI 生成');
});

test('获赞、粉丝和队伍人数在未知时不显示成 0,真 0 仍保留', () => {
  const profile = read('subpackageMember/components/cy/profile/index.wxml');
  assert.match(profile, /wx:if="\{\{userInfo\.likeNum != null\}\}">\{\{userInfo\.likeNum\}\}/);
  assert.match(profile, /wx:if="\{\{userInfo\.fansNum != null\}\}">\{\{userInfo\.fansNum\}\}/);
  assert.doesNotMatch(profile, /userInfo\.likeNum \|\| 0/);
  assert.doesNotMatch(profile, /userInfo\.fansNum \|\| 0/);
  const detail = read('pages/team/detail/index.wxml');
  assert.match(detail, /wx:if="\{\{team\.joinedCount != null && team\.maxMembers != null\}\}">\{\{team\.joinedCount\}\} \/ \{\{team\.maxMembers\}\}/);
  assert.match(detail, /wx:if="\{\{item\.teamDoneCount != null && item\.totalTasks != null\}\}">\{\{item\.teamDoneCount\}\} \/ \{\{item\.totalTasks\}\}/);
  assert.doesNotMatch(detail, /joinedCount \|\| 0/);
  assert.doesNotMatch(detail, /item\.totalTasks \|\| 0/);
  const join = read('pages/team/join/index.wxml');
  assert.match(join, /wx:if="\{\{team\.joinedCount != null && team\.maxMembers != null\}\}">\{\{team\.joinedCount\}\} \/ \{\{team\.maxMembers\}\}/);
  assert.doesNotMatch(join, /joinedCount \|\| 0/);
});

test('入口 query 里的 % 不会让 decodeURIComponent 抛出', () => {
  const { safeDecode } = require('../../utils/safe-decode.js');
  assert.doesNotThrow(() => safeDecode('%'));
  assert.equal(safeDecode('%'), '%');
  assert.equal(safeDecode('%E5%9F%8E'), '城');
  const invite = read('pages/coop/invite/index.js');
  const routeText = new Function(invite.match(/function routeText\(value\) \{[\s\S]*?\n\}/)[0] + '\nreturn routeText;')();
  assert.doesNotThrow(() => routeText('%'));
  assert.equal(routeText('%'), '%');
  assert.match(invite, /topicName:\s*options\.topicName\s*\?\s*routeText\(options\.topicName\)/);
  assert.match(read('pages/club/enroll/index.js'), /clubName:\s*options\.clubName\s*\?\s*safeDecode\(options\.clubName\)/);
  const search = read('pages/search2/result/index.js');
  assert.match(search, /keyword = options\.keyword \? safeDecode\(options\.keyword\)/);
  assert.match(search, /startDate: options\.startDate \? safeDecode\(options\.startDate\)/);
  assert.match(search, /endDate: options\.endDate \? safeDecode\(options\.endDate\)/);
  assert.match(read('pages/merchant/relation/index.js'), /topicName\) \? safeDecode\(options\.topicName\)/);
});
