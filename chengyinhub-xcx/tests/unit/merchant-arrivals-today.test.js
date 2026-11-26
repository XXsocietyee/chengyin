// P1-8 商家今天的核销(只读):并在核销记录页顶的「今天」区,不是独立页。
// 视图模型(按主题、再按场次分组)+ 接线合同 + 两路读取互不拖累。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const { todayView } = require('../../pages/merchant/verify-records/view-model.js');

const row = (patch) => Object.assign({ redemptionId: '1', registrationId: '9', topicId: '3', topicName: '梧桐里·武康路探店日',
  activityId: '71', activityName: '周六场', chapterId: '5', chapterName: '第四站·一页手写的回信', redeemedAt: '2026-11-22 13:24:10' }, patch);

test('按主题分组、主题内按场次分组,合计与分组计数来自同一批行,顺序跟随服务端倒序', () => {
  const view = todayView({ date: '2026-11-22', redeemedCount: 4, redeemed: [
    row(), row({ redemptionId: '2', activityId: '72', activityName: '周日场', redeemedAt: '2026-11-22 12:00:00' }),
    row({ redemptionId: '3', topicId: '4', topicName: '老城漫游', activityId: null, activityName: null, chapterName: '' }),
    row({ redemptionId: '4', redeemedAt: '2026-11-22 09:05:00' }),
  ] });
  assert.equal(view.total, 4);
  assert.deepEqual(view.topics.map((t) => [t.key, t.title, t.count]), [['3', '梧桐里·武康路探店日', 3], ['4', '老城漫游', 1]]);
  assert.deepEqual(view.topics[0].sessions.map((s) => [s.key, s.title, s.count]), [['3:71', '周六场', 2], ['3:72', '周日场', 1]]);
  assert.deepEqual(view.topics[0].sessions[0].items, [
    { id: '1', nameText: '第四站·一页手写的回信', timeText: '13:24' },
    { id: '4', nameText: '第四站·一页手写的回信', timeText: '09:05' },
  ]);
  const legacy = view.topics[1].sessions[0];
  assert.equal(legacy.title, '', '没有场次的票不造一个场次名');
  assert.equal(legacy.items[0].nameText, '本店站点');
  assert.ok(!('_bySession' in view.topics[0]), '分组索引不上屏');
});

test('空列表是合法的空态;畸形载荷判失败;无 id 的行不计数', () => {
  assert.deepEqual(todayView({ redeemed: [] }), { total: 0, topics: [] });
  for (const bad of [null, [], {}, { redeemed: null }, { redeemed: 'x' }]) assert.equal(todayView(bad), null);
  const view = todayView({ redeemed: [row({ redemptionId: null }), null, row({ redemptionId: 7, redeemedAt: null, topicName: '' })] });
  assert.equal(view.total, 1);
  assert.equal(view.topics[0].title, '自由探索');
  assert.equal(view.topics[0].sessions[0].items[0].timeText, '');
});

test('没有独立页:app.json 不注册、目录不存在、工作台没有第二个入口', () => {
  const app = fs.readFileSync(path.join(root, 'app.json'), 'utf8');
  assert.doesNotMatch(app, /arrivals-today/);
  assert.equal(fs.existsSync(path.join(root, 'pages/merchant/arrivals-today')), false);
  for (const file of ['pages/merchant/index/index.js', 'pages/merchant/index/index.wxml']) {
    assert.doesNotMatch(fs.readFileSync(path.join(root, file), 'utf8'), /arrivals-today|arrivalsToday|今日到店/, file);
  }
});

test('「今天」区接在核销记录页顶:同一次判权后读 desk/arrivals/today,排在分段与记录列表之前;颜色只走 token', () => {
  const js = fs.readFileSync(path.join(root, 'pages/merchant/verify-records/index.js'), 'utf8');
  assert.match(js, /url: '\/api\/merchant\/desk\/arrivals\/today',\s*method: 'POST'/);
  assert.match(js, /this\.loadList\(\);\s*this\.loadToday\(\);/);
  assert.match(js, /loadToday\(keep\) \{\s*if \(!this\._merchantAccess \|\| !this\._merchantAccess\.canReadVerifyRecords\) return;/);
  assert.equal((js.match(/sendRequest\(/g) || []).length, 4, '判权 + 记录首读 + 记录续读 + 今天,没有任何写');
  const wxml = fs.readFileSync(path.join(root, 'pages/merchant/verify-records/index.wxml'), 'utf8');
  const today = wxml.indexOf('class="vrl-today"');
  assert.ok(today > 0 && today < wxml.indexOf('class="vrl-tabbar"') && today < wxml.indexOf('wx:for="{{groups}}"'));
  assert.match(wxml, /<text class="vrl-group-label">今天<\/text>\s*<text class="vrl-group-total" wx:if="\{\{todayState === 'ready'\}\}">\{\{todayTotal \|\| 0\}\} 单<\/text>/);
  assert.match(wxml, /<cy-error wx:if="\{\{todayState === 'error'\}\}"[^>]*retry="重新加载" bind:retry="retryToday" \/>/);
  assert.match(wxml, /wx:for="\{\{todayTopics\}\}" wx:for-item="topic"[\s\S]*?wx:for="\{\{topic\.sessions\}\}" wx:for-item="session"[\s\S]*?wx:for="\{\{session\.items\}\}"/);
  const wxss = fs.readFileSync(path.join(root, 'pages/merchant/verify-records/index.wxss'), 'utf8');
  assert.doesNotMatch(wxss.replace(/\/\*[\s\S]*?\*\//g, ''), /#[0-9a-fA-F]{3,8}\b|rgba?\(/, '颜色只走设计 token');
});

function loadPage() {
  const requests = [];
  let def;
  const prev = { getApp: global.getApp, Page: global.Page, wx: global.wx, getCurrentPages: global.getCurrentPages };
  global.getApp = () => ({ globalData: {}, sendRequest: (o) => requests.push(o), getRequestErrorMessage: (r, f) => f });
  global.Page = (d) => { def = d; };
  global.getCurrentPages = () => [{}];
  global.wx = { stopPullDownRefresh() {}, showToast() {}, getWindowInfo: () => ({ statusBarHeight: 20 }),
    setNavigationBarColor() {}, setBackgroundColor() {}, setBackgroundTextStyle() {} };
  const file = path.join(root, 'pages/merchant/verify-records/index.js');
  delete require.cache[require.resolve(file)];
  require(file);
  const p = Object.assign({}, def, { data: JSON.parse(JSON.stringify(def.data)) });
  p.setData = (patch) => { Object.assign(p.data, patch); };
  const take = (url) => { const i = requests.findIndex((r) => r.url === url); assert.ok(i >= 0, url); return requests.splice(i, 1)[0]; };
  return { p, requests, take, restore: () => Object.assign(global, prev) };
}

const ACCESS = '/api/merchant/access/me', LIST = '/api/merchant/finance/redemptions', TODAY = '/api/merchant/desk/arrivals/today';
const grant = (h, permissions) => h.take(ACCESS).success({ code: 200, data: { active: true, merchant: { id: 1, name: '店' }, roleCode: 'MERCHANT_OWNER', permissions } });
const records = { code: 200, data: { total: 1, rows: [{ recordId: '1', fulfillmentState: 'ACTIVE', occurredAt: '2026-11-22 10:00:00' }] } };

test('今天读取失败只落本区错误态,记录列表照常;重新加载只重读今天', () => {
  const h = loadPage();
  try {
    h.p.onLoad();
    assert.equal(h.p.data.todayState, '', '判权前不读今天');
    grant(h, ['merchant:verify:record:read']);
    assert.equal(h.p.data.todayState, 'loading');
    h.take(TODAY).fail();
    h.take(LIST).success(records);
    assert.equal(h.p.data.todayState, 'error');
    assert.equal(h.p.data.pageState, 'ready');
    assert.equal(h.p.data.groups.length, 1);
    h.p.retryToday();
    assert.deepEqual(h.requests.map((r) => r.url), [TODAY]);
    h.take(TODAY).success({ code: 200, data: { redeemed: [row()] } });
    assert.equal(h.p.data.todayState, 'ready');
    assert.equal(h.p.data.todayTotal, 1);
    assert.equal(h.p.data.todayTopics[0].title, '梧桐里·武康路探店日');
    assert.equal(h.p.data.pageState, 'ready');
  } finally { h.restore(); }
});

test('记录列表读取失败不拖累今天;业务失败与畸形载荷都判今天失败;下拉原地重读且过期回包丢弃', () => {
  const h = loadPage();
  try {
    h.p.onLoad();
    grant(h, ['merchant:verify:record:read']);
    h.take(LIST).fail();
    h.take(TODAY).success({ code: 200, data: { redeemed: [row(), row({ redemptionId: '2' })] } });
    assert.equal(h.p.data.pageState, 'list-error', '判权已过的列表失败留在页内,不走整页自动返回');
    assert.equal(h.p.data.todayState, 'ready');
    assert.equal(h.p.data.todayTotal, 2);

    h.p.retry();
    h.take(LIST).success(records);
    assert.equal(h.p.data.pageState, 'ready');
    h.p.onPullDownRefresh();
    assert.equal(h.p.data.todayState, 'ready', '下拉不把今天切回加载态');
    const stale = h.take(TODAY);
    h.p.retryToday();
    h.take(TODAY).success({ code: 500, msg: 'x' });
    assert.equal(h.p.data.todayState, 'error');
    stale.success({ code: 200, data: { redeemed: [] } });
    assert.equal(h.p.data.todayState, 'error', '过期回包不覆盖');
    h.p.retryToday();
    h.take(TODAY).success({ code: 200, data: [] });
    assert.equal(h.p.data.todayState, 'error');
  } finally { h.restore(); }
});

test('没有 canReadVerifyRecords 不读今天', () => {
  const h = loadPage();
  try {
    h.p.onLoad();
    grant(h, []);
    assert.equal(h.p.data.pageState, 'no-permission');
    assert.equal(h.p.data.todayState, '');
    h.p.loadToday();
    assert.deepEqual(h.requests, []);
  } finally { h.restore(); }
});
