'use strict';
// 2026-11-22 业主拍板默认值(来自 #899 走查)A / B:
//  A 经营台一个项目都没有时,放一张「完善品牌中心」卡进品牌中心(取代 UI-01 的零项目整块退场)
//  B 小程序里没有发起触达的入口:「触达记录」没有记录时不出,有记录才出
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

/* ---------- A ---------- */

test('A 零项目:项目区不再整块退场,只放一张「完善品牌中心」卡,点开品牌中心', () => {
  const wxml = read('pages/merchant/index/index.wxml');
  const js = read('pages/merchant/index/index.js');
  const section = wxml.match(/<view class="rv-section" wx:if="\{\{merchantAccess\.canManageProjects && \(([^"]*)\)\}\}">/);
  assert.ok(section, '项目区锚点失效');
  assert.match(section[1], /merchantAccess\.canWriteProfile/, '零项目、无加载、无错误时,能写资料的岗位仍保留这一块');
  const card = wxml.match(/wx:if="\{\{!projectCards\.length && !\(joinError \|\| hostError\) && merchantAccess\.canWriteProfile\}\}">[\s\S]*?完善品牌中心/);
  assert.ok(card, '零项目时要有「完善品牌中心」卡');
  assert.match(card[0], /bindtap="goBrandManage"/);
  assert.match(js, /goBrandManage\(\)\s*\{[\s\S]{0,200}'\/pages\/merchant\/decor\/index'/, '卡片打开品牌中心(decor)');
  // 负控:有项目或加载失败时不出这张卡
  assert.doesNotMatch(card[0], /wx:if="\{\{projectCards\.length/);
});

/* ---------- B ---------- */

function loadCustomer() {
  let definition;
  const sent = [];
  const navs = [];
  const base = { navigateTo: (o) => navs.push(o), getStorageSync: () => '' };
  const wx = new Proxy(base, { get(t, k) { return k in t ? t[k] : () => {}; } });
  const app = new Proxy({ globalData: {}, sendRequest(o) { sent.push(o); return { abort() {} }; } }, {
    get(t, k) { return k in t ? t[k] : () => ''; },
  });
  global.getApp = () => app;
  global.wx = wx;
  const pageDir = path.join(ROOT, 'pages/merchant/customer');
  const file = path.join(ROOT, 'pages/merchant/customer/index.js');
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    getApp: () => app,
    Page(page) { definition = page; },
    require(request) { return require(path.resolve(pageDir, request)); },
    Set, Date, JSON, wx, setTimeout, clearTimeout,
  }, { filename: file });
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) { Object.assign(this.data, patch); },
  });
  return { page, sent, navs };
}

test('B 触达记录:有记录才出,空列表 / 业务失败 / 网络失败都不出', () => {
  const cases = [
    [{ code: 200, data: [{ campaignId: 1 }] }, true],
    [{ code: 200, data: [] }, false],
    [{ code: 500, msg: '服务繁忙' }, false],
  ];
  for (const [res, expected] of cases) {
    const { page, sent } = loadCustomer();
    assert.equal(page.data.hasCampaigns, false, '默认不出');
    page.data.canCampaigns = true;
    page.probeCampaigns();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].url, '/api/merchant/crm/campaigns');
    assert.equal(sent[0].method, 'GET');
    sent[0].success(res);
    assert.equal(page.data.hasCampaigns, expected, JSON.stringify(res));
  }
  const { page, sent } = loadCustomer();
  page.data.canCampaigns = true;
  page.probeCampaigns();
  sent[0].fail({});
  assert.equal(page.data.hasCampaigns, false);
});

test('B 回包时已没有 MARKETING_READ 或身份已换,不点亮入口', () => {
  const { page, sent } = loadCustomer();
  page.data.canCampaigns = true;
  page.probeCampaigns();
  page.data.canCampaigns = false;
  sent[0].success({ code: 200, data: [{ campaignId: 1 }] });
  assert.equal(page.data.hasCampaigns, false);

  const stale = loadCustomer();
  stale.page.data.canCampaigns = true;
  stale.page.probeCampaigns();
  stale.page._invalidateScopeRequests();
  stale.sent[0].success({ code: 200, data: [{ campaignId: 1 }] });
  assert.equal(stale.page.data.hasCampaigns, false, '换身份后的迟到回包丢弃');
});

test('B 触达记录这一行按 canCampaigns && hasCampaigns 渲染;「管理」没有任何一行时不出;读权限时才探测', () => {
  const wxml = read('pages/merchant/customer/index.wxml');
  assert.match(wxml, /<view wx:if="\{\{canCampaigns && hasCampaigns\}\}" class="tm-row" bindtap="goCampaigns"/);
  assert.doesNotMatch(wxml, /wx:if="\{\{canCampaigns\}\}" class="tm-row"/, '负控:旧的只看权限写法退场');
  assert.match(wxml, /class="cu-seg" wx:if="\{\{canSegment \|\| canExport \|\| \(canCampaigns && hasCampaigns\)\}\}" bindtap="toggleTools"/);
  const js = read('pages/merchant/customer/index.js');
  assert.match(js, /if \(access\.canReadMarketing\) this\.probeCampaigns\(\);/);
  // 每轮重新确认身份时先收起入口,不沿用上一个身份的结果
  // L07-005:返回保留名单时 hasCampaigns 单独收口(数据不是权限),其余初始/清空处仍成对置 false
  assert.ok((js.match(/canCampaigns: false, hasCampaigns: false/g) || []).length >= 2);
  assert.match(js, /if \(!keepRows\) this\.setData\(\{ hasCampaigns: false \}\)/);
});
