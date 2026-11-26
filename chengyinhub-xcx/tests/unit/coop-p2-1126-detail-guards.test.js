const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function inviteResponse(row) {
  return { code: 200, data: { received: [row], sent: [row], slots: {} } };
}

function loadDetail(response, manualList) {
  let definition;
  const requests = [];
  const file = path.join(ROOT, 'pages/coop/invite-detail/index.js');
  const app = {
    globalData: {}, _memberId: 1,
    getUserID() { return this._memberId; },
    getUserRole() { return 'merchant'; },
    getUserType() { return 2; },
    sendRequest(options) {
      requests.push(options);
      if (options.url === '/api/coop/list' && !manualList && options.success) options.success(response);
    },
  };
  vm.runInNewContext(read('pages/coop/invite-detail/index.js'), {
    Page: (page) => { definition = page; },
    getApp: () => app,
    getCurrentPages: () => [],
    wx: { stopPullDownRefresh() {}, navigateTo() {}, navigateBack() {}, redirectTo() {}, setClipboardData() {} },
    setTimeout, clearTimeout, console,
    require(id) {
      if (id.includes('/toast')) return () => {};
      if (id.includes('/modal')) return { show() {} };
      if (id.includes('/merchant-theme')) return { merchantPageShow() {}, merchantPageRestore() {} };
      return require(path.resolve(path.dirname(file), id));
    },
  }, { filename: file });
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) { Object.assign(this.data, patch); },
  });
  return { page, requests };
}

function loadScript(rel, extra) {
  let definition;
  const file = path.join(ROOT, rel);
  const requests = [];
  vm.runInNewContext(read(rel), Object.assign({
    Page: (page) => { definition = page; },
    getApp: () => ({
      globalData: { statusBarHeight: 20, navBarHeight: 44 },
      getUserID: () => 1, getUserRole: () => 'merchant', getUserType: () => 2,
      sendRequest(options) { requests.push(options); },
    }),
    wx: { nextTick(fn) { fn(); }, stopPullDownRefresh() {}, navigateTo() {}, getStorageSync() { return ''; } },
    setTimeout, clearTimeout, console,
    require(id) {
      if (id.includes('merchant-theme')) return { merchantPageShow() {}, merchantPageRestore() {} };
      return require(path.resolve(path.dirname(file), id));
    },
  }, extra || {}), { filename: file });
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) { Object.assign(this.data, patch); },
  });
  return { page, requests };
}

const pending = {
  id: 7, inviteId: '7', status: 0, inviteType: 1, topicId: 8, topicName: '主题', shareMode: 0,
  depositOwed: false, fromId: 21, toId: 31, toType: 'merchant', partner: { name: '合作方' },
};

test('详情刷新飞行中继续输入的理由不会被开请求时的快照盖掉，状态变了才清空', () => {
  const env = loadDetail(inviteResponse(pending), true);
  env.page.onLoad({ inviteId: '7', box: 'received' });
  env.requests[0].success(inviteResponse(pending));
  env.page.onDraftInput({ detail: { value: '尚未' } });
  env.page.load();
  env.page.onDraftInput({ detail: { value: '尚未提交的理由' } });
  env.requests.at(-1).success(inviteResponse(pending));
  assert.equal(env.page.data.draft, '尚未提交的理由');
  assert.equal(env.page.data.inputKind, 'reply');

  env.page.load();
  env.requests.at(-1).success(inviteResponse(Object.assign({}, pending, { status: 1 })));
  assert.equal(env.page.data.draft, '');
  assert.equal(env.page.data.inputKind, '');
});

test('详情刷新后晚到的履约信用不能盖掉新结果，离开页面也不再写', () => {
  const env = loadDetail(inviteResponse(pending), true);
  env.page.onLoad({ inviteId: '7', box: 'received' });
  env.requests[0].success(inviteResponse(pending));
  const first = env.requests.find((request) => request.url === '/api/coop/credit');
  const older = { code: 200, data: { days: 90, fulfil: 1, violationCount: 0, fulfillmentRate: 100 } };
  const newer = { code: 200, data: { days: 90, fulfil: 8, violationCount: 2, fulfillmentRate: 80 } };
  first.success(older);
  assert.equal(env.page.data.partnerCredit.text, '履约率 100% · 违约 0 次');

  env.page.load();
  env.requests.filter((request) => request.url === '/api/coop/list').at(-1).success(inviteResponse(pending));
  const second = env.requests.filter((request) => request.url === '/api/coop/credit').at(-1);
  assert.notEqual(second, first);
  second.success(newer);
  assert.equal(env.page.data.partnerCredit.text, '履约率 80% · 违约 2 次');
  first.success(older);
  assert.equal(env.page.data.partnerCredit.text, '履约率 80% · 违约 2 次');

  env.page.onUnload();
  second.success({ code: 200, data: { days: 90, fulfil: 1, violationCount: 9, fulfillmentRate: 10 } });
  assert.equal(env.page.data.partnerCredit.text, '履约率 80% · 违约 2 次');
});

test('条款已锁定时不展示申报供给，打开和提交都不发请求', () => {
  const wxml = read('pages/coop/invite-detail/index.wxml');
  const row = wxml.split('\n').find((line) => line.includes('bindtap="openPerkPick"'));
  assert.match(row, /!invite\.termsFrozen/);
  assert.doesNotMatch(read('pages/coop/invite-detail/index.js'), /18018571626|微信号|wechatId/);

  const frozen = Object.assign({}, pending, { status: 1, termsFrozen: true });
  const env = loadDetail(inviteResponse(frozen));
  env.page.onLoad({ inviteId: '7', box: 'received' });
  assert.equal(env.page.data.invite.termsFrozen, true);
  const before = env.requests.length;
  env.page.openPerkPick();
  assert.equal(env.requests.length, before);
  assert.match(env.page.data.actionError, /不能再申报供给/);
  env.page.data.perkState = 'ready';
  env.page.data.perkTemplates = [{ id: 2, checked: true }];
  env.page.data.showPerkPick = true;
  env.page.submitPerks();
  assert.equal(env.requests.some((request) => request.url === '/api/coop/perks/attach'), false);
  assert.equal(env.page.data.showPerkPick, false);
});

test('列表和邀约页的路由文字遇到坏百分号不会抛，合法编码仍能解开', () => {
  const list = loadScript('pages/coop/list/index.js');
  list.page.onLoad({ topicId: '9', topicName: '%E4%B8%AD' });
  assert.equal(list.page._topicFilterName, '中');
  assert.doesNotThrow(() => list.page.onLoad({ topicId: '9', topicName: '%' }));
  assert.equal(list.page._topicFilterName, '%');
  assert.match(list.page.data.topicScopeText, /只看「%」/);

  const invite = loadScript('pages/coop/invite/index.js');
  assert.doesNotThrow(() => invite.page.onLoad({ type: '1', topicId: '9', topicName: '%' }));
  assert.equal(invite.page.data.topicName, '%');
  invite.page.onLoad({ type: '1', topicId: '9', topicName: '%E4%B8%AD%E6%96%87' });
  assert.equal(invite.page.data.topicName, '中文');
});

test('协作列表卸载清掉入场计时器，结算详情卸载停掉金额滚动', async () => {
  const list = loadScript('pages/coop/list/index.js');
  const pageMotion = require(path.join(ROOT, 'utils/page-motion.js'));
  pageMotion.enter(list.page, 'pmList');
  assert.equal(list.page.data.pmList, 1);
  assert.ok(list.page._pmListTimer);
  list.page.onUnload();
  assert.equal(list.page._pmListTimer, null);
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(list.page.data.pmList, 1);

  const settlement = loadScript('pages/coop/settlement-detail/index.js');
  settlement.page.onLoad({ source: 'finance', topicId: '7' });
  settlement.requests[0].success({
    code: 200,
    data: {
      topics: [{
        topicId: 7, topicName: '外滩夜行', settled: false, myIncomeArrived: false, myIncome: null,
        totalSales: 1, verifiedSales: 1, platformAmount: 0, merchantTotal: 0,
      }],
    },
  });
  assert.equal(settlement.page.data.sdK, 0);
  settlement.page.onUnload();
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.equal(settlement.page.data.sdK, 0);
  assert.equal(settlement.page.data.loadState, 'ready');
});
