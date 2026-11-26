const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('D-001 客户页退役活动外广播，不能保留可调用发送方法', () => {
  const source = fs.readFileSync(__dirname + '/../../pages/merchant/customer/index.js', 'utf8');
  assert.doesNotMatch(source, /openCast|sendCast|_sendCastConfirmed|\/crm\/broadcast/);
  assert.doesNotMatch(source, /previewCampaign|submitCampaign|toggleCampaignPanel/);
  // 2026-11-22 业主拍板 B:「触达记录」入口要先知道有没有记录,客户页可以读任务列表(GET),
  // 但不能有任何写 /crm/campaigns 的调用(发起触达仍然不在小程序里)。
  const campaignCalls = source.match(/url: '\/api\/merchant\/crm\/campaigns[^']*',\s*method: '[A-Z]+'/g) || [];
  assert.equal((source.match(/\/crm\/campaigns/g) || []).length, campaignCalls.length, '每处 /crm/campaigns 都要是带 method 的读调用');
  campaignCalls.forEach((call) => assert.match(call, /url: '\/api\/merchant\/crm\/campaigns',\s*method: 'GET'/));
  const wxml = fs.readFileSync(__dirname + '/../../pages/merchant/customer/index.wxml', 'utf8');
  assert.doesNotMatch(wxml, /合规触达|campaignOpen|submitCampaign/);
  const director = fs.readFileSync(__dirname + '/../../pages/club/topic-detail/index.wxml', 'utf8');
  assert.match(director, /定向广播/);
});
