'use strict';
// 2026-11-22 业主拍板默认值(来自 #901 走查)C / D / E:
//  C 选玩法 / 我的模板:审核中的模板列出来标「审核中」,通过前不能选用,点了说明原因
//  D 「从广场下架」先确认(别人在用这个模板);下架后仍是同一个按钮一点上架回来
//  E 孤儿页 subpackageMember/mytemplate 删除:app.json、源码跳转、登记册里都不再引用
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { marketView } = require('../../subpackageA/utils/template-market.js');

const ROOT = path.resolve(__dirname, '../..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

/* ---------- C:节点选玩法(fabu) ---------- */

function loadFabu() {
  const sent = [];
  const toasts = [];
  global.wx = {
    getStorageSync: () => undefined, setStorageSync() {}, removeStorageSync() {},
    showToast(o) { toasts.push(o && o.title); }, showLoading() {}, hideLoading() {},
    getSystemInfoSync() { return {}; }, getWindowInfo() { return {}; }, showModal() {},
  };
  global.getCurrentPages = () => [];
  global.getApp = () => ({ globalData: {}, getUserID: () => 7, getRequestErrorMessage: (r, d) => d, sendRequest: o => sent.push(o) });
  let page; global.Page = (value) => { page = value; };
  delete require.cache[require.resolve('../../pages/publish/fabu/index')];
  require('../../pages/publish/fabu/index');
  page.data = Object.assign({}, page.data, { operationScope: '', searchKeyword: '', selectedTempId: null, selectedTempSource: '', selectedTempInfo: null });
  page.setData = (patch, cb) => { Object.assign(page.data, patch); if (cb) cb(); };
  page._refreshSupportMatrix = () => {};
  page._templateSupportReason = () => '';
  return { page, sent, toasts };
}

const ROWS = [
  { id: 11, title: '已通过', draftStatus: 1, status: 1 },
  { id: 12, title: '审核中的', draftStatus: 1, status: 0 },
  { id: 13, title: '被驳回', draftStatus: 1, status: 2 },
  { id: 14, title: '草稿', draftStatus: 0, status: 0 },
];

test('C 选玩法「我的模板」:审核中的照列并标记,驳回和草稿仍不列', () => {
  const { page, sent } = loadFabu();
  page.getTempList();
  assert.equal(sent[0].url, '/api/template/my-list');
  sent[0].success({ code: '200', data: { rows: ROWS } });
  assert.deepEqual(page.data.tempList.map(t => [t.id, t._reviewing]), [[11, false], [12, true]]);
  assert.equal(page.data.tempListState, 'ready');
});

test('C 点审核中的模板:不选中,提示要等审核通过;已通过的照常选中', () => {
  const { page, sent, toasts } = loadFabu();
  page.getTempList();
  sent[0].success({ code: '200', data: { rows: ROWS } });
  const [ok, reviewing] = page.data.tempList;
  page.selectTemp({ currentTarget: { dataset: { item: reviewing, source: 'mine' } } });
  assert.equal(page.data.selectedTempId, null);
  assert.equal(toasts.at(-1), '审核通过后才能选用');
  page.selectTemp({ currentTarget: { dataset: { item: ok, source: 'mine' } } });
  assert.equal(page.data.selectedTempId, 11);
});

test('C 选玩法行:审核中写「审核中」,读屏同样说明', () => {
  const wxml = read('pages/publish/fabu/index.wxml');
  assert.match(wxml, /<text class="pk-row__mode">\{\{item\._reviewing \? '审核中' : '我的'\}\}<\/text>/);
  assert.match(wxml, /aria-label="\{\{item\._reviewing \? item\.title \+ '，审核中' : '选用' \+ item\.title\}\}" aria-disabled="\{\{item\._reviewing\}\}"/);
});

test('C 活动表单的模板选择同一口径:审核中照列、标记、点了说明', () => {
  const js = read('pages/publish/activity/index.js');
  assert.match(js, /Number\(item\.draftStatus\) === 1 && Number\(item\.status\) === 0\s*\? Object\.assign\(\{\}, item, \{ _reviewing: true \}\)/);
  assert.match(js, /selectTemp: function \(e\) \{\s*const item = e\.currentTarget\.dataset\.item;\s*if \(item && item\._reviewing\) \{ cyToast\('审核通过后才能选用'\); return; \}/);
  const wxml = read('pages/publish/activity/index.wxml');
  assert.match(wxml, /<text wx:if="\{\{item\._reviewing\}\}" class="temp-reviewing">审核中<\/text>/);
});

test('C 我的项目 · 模板 tab 本来就列出审核中并写「审核中」', () => {
  const view = marketView({ draftStatus: 1, status: 0, checkStatus: 0 });
  assert.equal(view._statusShort, '审核中');
  assert.equal(view._canSubmitMarket, false, '审核中不能提交广场');
});

/* ---------- D:从广场下架先确认 ---------- */

function loadMyproject() {
  const sent = [];
  const toasts = [];
  const modals = [];
  global.getCurrentPages = undefined;
  global.getApp = () => ({
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    sendRequest: (p) => sent.push(p), getUserID: () => 1, getToken: () => 'current-session',
  });
  global.wx = {
    getStorageSync: () => undefined, setStorageSync() {},
    showToast: (o) => toasts.push(o && o.title), showLoading() {}, hideLoading() {},
    showModal: (o) => modals.push(o),
    navigateTo() {}, redirectTo() {}, getSystemInfoSync: () => ({ windowWidth: 375 }),
    nextTick: (f) => f(), setNavigationBarColor() {}, setNavigationBarTitle() {},
  };
  let config; global.Page = (cfg) => { config = cfg; };
  const PAGE = '../../subpackageA/pages/myproject/index.js';
  delete require.cache[require.resolve(PAGE)];
  require(PAGE);
  const page = Object.assign({}, config);
  page.data = JSON.parse(JSON.stringify(config.data));
  page.data.tplList = [{ id: 21, title: '夜行模板' }];
  page.setData = function (patch) { Object.assign(page.data, patch); };
  page.loadProjects = () => {};
  page.loadTemplates = () => {};
  return { page, sent, toasts, modals };
}

const tapToggle = (target) => ({ currentTarget: { dataset: { id: 21, target } } });

test('D「从广场下架」先弹确认,写明别人不能再选用;取消不发请求', () => {
  const { page, sent, modals } = loadMyproject();
  page.tplToggle(tapToggle(3));
  assert.equal(sent.length, 0, '确认前不发请求');
  assert.equal(modals.length, 1);
  assert.equal(modals[0].title, '从广场下架');
  assert.match(modals[0].content, /其他人不能再从广场选用「夜行模板」/);
  assert.equal(modals[0].confirmText, '下架');
  modals[0].success({ confirm: false, cancel: true });
  assert.equal(sent.length, 0);
});

test('D 确认后才下架,成功后仍提示可一键上架回来', () => {
  const { page, sent, toasts, modals } = loadMyproject();
  page.tplToggle(tapToggle(3));
  modals[0].success({ confirm: true });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, '/api/template/updateLibraryStatus');
  assert.equal(sent[0].data.status, 3);
  assert.equal(sent[0].data.template_id, 21);
  sent[0].success({ code: '200' });
  assert.equal(toasts.at(-1), '已从广场下架，可随时重新上架');
  // 下架后同一个按钮写「上架广场」,一点就回来(不确认)
  const delisted = marketView({ draftStatus: 1, status: 1, checkStatus: 1, marketTemplateId: 5, marketStatus: 3 });
  assert.equal(delisted._canToggleMarket, true);
  assert.equal(delisted._marketActionText, '上架广场');
  assert.equal(delisted._marketStatusTarget, 1);
  page.tplToggle(tapToggle(1));
  assert.equal(modals.length, 1, '上架不弹确认');
  assert.equal(sent.at(-1).data.status, 1);
});

test('D 撤回广场审核照旧一点就做;删除面板里选「改为下架」不再叠一层确认', () => {
  const { page, sent, modals } = loadMyproject();
  page.tplToggle(tapToggle(2));
  assert.equal(modals.length, 0);
  assert.equal(sent.at(-1).data.status, 2);
  sent.at(-1).success({ code: '200' }); // 同一张卡在途时不重复发,先让上一条落定
  page.onDeleteTemplateAlt({ detail: { params: { id: 21 } } });
  assert.equal(modals.length, 0);
  assert.equal(sent.at(-1).data.status, 3);
});

/* ---------- E:孤儿页删除 ---------- */

test('E subpackageMember/mytemplate 已删除:文件、app.json、源码跳转都不再有', () => {
  assert.equal(fs.existsSync(path.join(ROOT, 'subpackageMember/mytemplate')), false);
  const app = JSON.parse(read('app.json'));
  const pages = (app.subPackages || app.subpackages || []).flatMap(p => p.pages.map(x => p.root + '/' + x)).concat(app.pages);
  assert.ok(!pages.some(p => /mytemplate\/mytemplate/.test(p)));
  const walk = (dir, out = []) => {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const rel = path.join(dir, e.name);
      if (e.isDirectory()) walk(rel, out);
      else if (/\.(js|wxml|json)$/.test(e.name)) out.push(rel);
    }
    return out;
  };
  const sources = ['pages', 'components', 'utils', 'behaviors', 'custom-tab-bar']
    .concat(fs.readdirSync(ROOT).filter(d => d.startsWith('subpackage')))
    .filter(d => fs.existsSync(path.join(ROOT, d)))
    .flatMap(d => walk(d)).concat(['app.js']);
  const hits = sources.filter(f => /subpackageMember\/mytemplate/.test(read(f)));
  assert.deepEqual(hits, []);
});

test('E 原来跳去旧页的三处改去「我的项目 · 模板」,商家态带 scope', () => {
  const temp = read('pages/publish/temp/index.js');
  const target = "wx.reLaunch({ url: '/subpackageA/pages/myproject/index?type=template' + (this.data.operationScope === 'MERCHANT' ? '&scope=MERCHANT' : '') });";
  assert.equal(temp.split(target).length - 1, 3, '保存结果面板、成功页「去模板」、采用回执「查看我的模板」');
  const detail = read('pages/templatedetail/templatedetail.js');
  assert.match(detail, /if \(isMyScope\) wx\.redirectTo\(\{ url: '\/subpackageA\/pages\/myproject\/index\?type=template' \+ \(operationScope === 'MERCHANT' \? '&scope=MERCHANT' : ''\) \}\);/);
  // 落点页认 type=template / scope=MERCHANT
  const myproject = read('subpackageA/pages/myproject/index.js');
  assert.match(myproject, /options\.type === 'template' \? 'template'/);
  assert.match(myproject, /options\.scope === 'MERCHANT'/);
});

test('E 登记册不再指向旧页', () => {
  for (const f of ['scripts/danger-action-registry.json', 'scripts/uiaudit/build-action-ledger.js', 'scripts/shot-matrix.js',
    'scripts/baselines/u3-orphan-handler.json', 'scripts/baselines/u4-dead-setdata-field.json', '../ci/silent-error-allowlist.txt']) {
    assert.doesNotMatch(read(f), /subpackageMember\/mytemplate/, f);
  }
});
