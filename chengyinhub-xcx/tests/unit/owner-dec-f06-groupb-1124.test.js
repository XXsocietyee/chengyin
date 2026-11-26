'use strict';
// 业主决策 2026-11-24 F06 B 组默认项:L06-050 / L06-110 / L06-158 / L06-162
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '../..');

// ---------------- L06-050 玩法货架翻页遇并发编辑 ----------------
const SHELF = path.join(ROOT, 'pages/templatedetail/shelf/index.js');
const GAME_URL = '/api/template/list';
const game = (id, title) => ({ id, title: title || '今晚的暗号', packType: 0 });
function mountShelf() {
  let definition;
  const requests = [];
  global.getApp = () => ({ globalData: { statusBarHeight: 20, navBarHeight: 44 },
    getUserID: () => '9004', ensureLoginFor: () => true,
    getRequestErrorMessage: (res, fallback) => res && res.msg || fallback,
    sendRequest: options => { requests.push(options); } });
  global.wx = { getStorageSync: () => '', getWindowInfo: () => ({ windowWidth: 375 }), navigateTo() {}, showToast() {} };
  global.Component = value => { definition = value; };
  delete require.cache[SHELF]; require(SHELF);
  const vm = Object.assign({}, definition.methods);
  vm.data = JSON.parse(JSON.stringify(definition.data));
  for (const [key, prop] of Object.entries(definition.properties)) vm.data[key] = prop.value;
  vm.setData = patch => Object.assign(vm.data, patch);
  vm.triggerEvent = () => {};
  definition.lifetimes.attached.call(vm);
  return { vm, games: () => requests.filter(r => r.url === GAME_URL) };
}

test('L06-050 翻页时后台新增模板导致跨页重复:按 id 去重后上架，不整页报错', () => {
  const { vm, games } = mountShelf();
  const page1 = Array.from({ length: 50 }, (_, i) => game(1000 + i, '填充' + i));
  games()[0].success({ code: 200, data: { rows: page1, total: 52 } });
  // 第 2 页因新插入一条而把第 1 页末尾那条挤过来
  games()[1].success({ code: 200, data: { rows: [game(1049, '填充49'), game(21), game(22, '闭眼味觉师')], total: 53 } });
  assert.equal(vm.data.gameLoaded, true);
  assert.equal(vm.data.gameError, '');
  assert.ok(vm._games.some(g => g.id === 21));
});

test('L06-050 无效条目(空、非法 id、页内重复)被跳过，其余照常上架', () => {
  const { vm, games } = mountShelf();
  games()[0].success({ code: 200, data: { rows: [null, { id: 'abc', title: '坏的' }, { id: -3 }, game(21), game(21)], total: 5 } });
  assert.equal(vm.data.gameLoaded, true);
  assert.equal(vm.data.gameError, '');
  assert.deepEqual(vm._games.map(g => g.id), [21]);
});

test('L06-050 第 1 页失败仍报错', () => {
  const { vm, games } = mountShelf();
  games()[0].success({ code: 500, msg: '服务忙' });
  assert.equal(vm.data.gameLoaded, false);
  assert.equal(vm.data.gameError, '服务忙');
});

test('L06-050 后续页失败只跳过该页', () => {
  const { vm, games } = mountShelf();
  const page1 = Array.from({ length: 49 }, (_, i) => game(1000 + i, '填充' + i)).concat(game(21));
  games()[0].success({ code: 200, data: { rows: page1, total: 120 } });
  games()[1].fail({ msg: '断网' });
  games()[2].success({ code: 200, data: { rows: [game(22, '闭眼味觉师')], total: 120 } });
  assert.equal(vm.data.gameLoaded, true);
  assert.equal(vm.data.gameError, '');
  assert.ok(vm._games.some(g => g.id === 21));
});

test('L06-050 一条有效条目都没有时报错', () => {
  const { vm, games } = mountShelf();
  games()[0].success({ code: 200, data: { rows: [null, { id: 0 }], total: 2 } });
  assert.equal(vm.data.gameLoaded, false);
  assert.ok(vm.data.gameError);
});

// ---------------- L06-110 玩法模板举报(未接入口)删除 ----------------
test('2026-11-26 举报工具同时覆盖主题、评价和玩法模板', () => {
  const file = path.join(ROOT, 'pages/topic/utils/content-report.js');
  delete require.cache[file];
  const mod = require(file);
  assert.deepEqual(Object.keys(mod).sort(), ['reportComment', 'reportTemplate', 'reportTopic']);
  const src = fs.readFileSync(file, 'utf8');
  assert.match(src, /\/api\/topic\/report/);
  assert.match(src, /\/api\/comment\/report/);
  assert.match(src, /\/api\/template\/personal-report/);
  assert.match(src, /\/api\/template\/report/);
});

// ---------------- L06-162 商家视角先查发布权限再出发布钮 ----------------
const TEMPLATE = path.join(ROOT, 'pages/template/index.js');
function mountTemplate(role) {
  let def;
  const requests = [], toasts = [];
  const app = { globalData: { statusBarHeight: 20, navBarHeight: 44, menuButtonInfo: {} },
    getUserRole: () => role, getUserType: () => (role === 'merchant' ? 2 : 1), getUserID: () => 'm7',
    sendRequest: o => requests.push(o) };
  const wx = { hideTabBar() {}, getWindowInfo: () => ({ windowWidth: 375 }), getStorageSync: () => '', showToast() {} };
  const real = require('node:module').createRequire(TEMPLATE);
  require('node:vm').runInNewContext(fs.readFileSync(TEMPLATE, 'utf8'), {
    Page: v => { def = v; }, getApp: () => app, wx, console, setTimeout, clearTimeout,
    require: id => id.includes('merchant-theme') ? { merchantPageShow() {}, merchantPageRestore() {} }
      : id.includes('identity-policy') ? { isMerchantView: v => v.role === 'merchant' }
      : id.includes('motion-preference') ? { readReducedMotion: () => false }
      : id.includes('font-scale') ? { readPageStyle: () => '' }
      : id.includes('utils/toast') ? (text => toasts.push(text))
      : real(id)
  });
  const page = Object.assign({}, def, { data: JSON.parse(JSON.stringify(def.data)) });
  page.setData = function (p) { Object.entries(p).forEach(([k, v]) => { if (!k.includes('.')) this.data[k] = v; }); };
  return { page, requests, toasts, access: () => requests.filter(r => r.url === '/api/merchant/access/me') };
}
const accessOf = (roleCode, permissions) => ({ code: '200', data: { active: true, merchant: { id: 5, name: '店' }, roleCode, permissions } });
// wxml 里发布钮的显示条件，按页面 data 求值
function fabVisible(data) {
  const wxml = fs.readFileSync(path.join(ROOT, 'pages/template/index.wxml'), 'utf8');
  const cond = wxml.match(/<view\b[^>]*id="publish-fab"[^>]*wx:if="\{\{([^}]+)\}\}"/)[1];
  return !!Function(...Object.keys(data), 'return (' + cond + ');')(...Object.values(data));
}

test('L06-162 商家店员不带 ?mode=merchant 进发布页:先查权限，无发布权限不出发布钮，点了也不开弹窗', () => {
  const h = mountTemplate('merchant');
  h.page.onLoad({});
  h.page.onShow();
  assert.equal(h.access().length, 1, '商家视角必须先查岗位权限');
  assert.equal(fabVisible(h.page.data), false, '权限未返回前不出发布钮');
  h.access()[0].success(accessOf('MERCHANT_CHECKIN', ['merchant:verify']));
  assert.equal(h.page.data.canManageMerchantProjects, false);
  assert.equal(fabVisible(h.page.data), false);
  h.page.openPublishSheet();
  assert.equal(h.page.data.publishSheetShow, false);
  assert.deepEqual(h.toasts, ['当前身份不能发布项目']);
});

test('L06-162 有发布权限的商家不带 mode 也照常出发布钮', () => {
  const h = mountTemplate('merchant');
  h.page.onLoad({});
  h.page.onShow();
  h.access()[0].success(accessOf('MERCHANT_OWNER', ['merchant:project:manage']));
  assert.equal(h.page.data.canManageMerchantProjects, true);
  assert.equal(fabVisible(h.page.data), true);
  h.page.openPublishSheet();
  assert.equal(h.page.data.publishSheetShow, true);
});

test('L06-162 权限查询失败:不出发布钮，给重试条', () => {
  const h = mountTemplate('merchant');
  h.page.onLoad({});
  h.page.onShow();
  h.access()[0].fail();
  assert.equal(fabVisible(h.page.data), false);
  assert.match(fs.readFileSync(path.join(ROOT, 'pages/template/index.wxml'), 'utf8'),
    /wx:if="\{\{isMerchant && merchantAccessError\}\}" bindtap="retryMerchantAccess"/);
});

test('L06-162 玩家视角不查商家权限', () => {
  const h = mountTemplate('player');
  h.page.onLoad({});
  h.page.onShow();
  assert.equal(h.access().length, 0);
  assert.equal(fabVisible(h.page.data), false);
});

// ---------------- L06-158 详情页图片 / 场景 / 时长只出一处 ----------------
const vmSandbox = require('../helpers/ui-sandbox-vm.js');
const { loadMediaPreview } = require('../helpers/media-preview-sandbox.js');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
function detailsTab(wxml) {
  const m = wxml.match(/<block wx:if="\{\{ activeTab === 'details' \}\}">([\s\S]*?)<\/block>\s*<block wx:if="\{\{ activeTab === 'capabilities' \}\}">/);
  assert.ok(m, '必须找到详情 tab 分支');
  return m[1];
}
function loadTemplateDetail() {
  let definition = null;
  const previews = [];
  vmSandbox.runInNewContext(fs.readFileSync(path.join(ROOT, 'pages/templatedetail/templatedetail.js'), 'utf8'), {
    console,
    getApp: () => ({ globalData: { statusBarHeight: 20, navBarHeight: 44 }, getUserRole: () => 'player', getUserType: () => '2',
      getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback, sendRequest() {} }),
    Page(value) { definition = value; },
    require(request) {
      if (request === './utils/scroll-motion.js') return { applyHeroRecede: () => false };
      if (request === './utils/templateDetail.js') return require(path.join(ROOT, 'pages/templatedetail/utils/templateDetail.js'));
      if (request === './shelf/art.js') return require(path.join(ROOT, 'pages/templatedetail/shelf/art.js'));
      if (request === './shelf/game-covers.js') return require(path.join(ROOT, 'pages/templatedetail/shelf/game-covers.js'));
      if (request === '../../utils/toast.js') return require(path.join(ROOT, 'utils/toast.js'));
      if (request === '../../utils/mockData.js') return { getTemplateById: () => null };
      if (request === '../../utils/analytics.js') return { track() {} };
      if (request === '../../utils/identity/identity-policy.js') return require(path.join(ROOT, 'utils/identity/identity-policy.js'));
      if (request === '../../utils/merchant-theme.js') return { merchantPageShow() {}, merchantPageRestore() {} };
      if (request === '../../utils/response-shape.js') return require(path.join(ROOT, 'utils/response-shape.js'));
      if (request === '../../utils/media-preview.js') return loadMediaPreview({ previewImage(o) { previews.push(o); } });
      throw new Error(`unexpected require: ${request}`);
    },
    wx: { getStorageSync: () => '', setStorageSync() {}, navigateTo() {}, switchTab() {}, navigateBack() {}, redirectTo() {},
      getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }), createAnimation: () => ({}), nextTick: cb => cb() }
  });
  return { page: definition, previews };
}

test('L06-158 玩法详情:分类与场景只在详情 tab 出一次，能力 tab 不再列「场景」行', () => {
  const { page } = loadTemplateDetail();
  // L06-155(#970)删掉了只有测试在用的 patchNormalized,改走页面真实装配路 applyDetailPayload。
  const target = {};
  page.data = Object.assign({}, page.data, { scope: 'library' });
  page.setData = (patch) => { Object.assign(target, patch); Object.assign(page.data, patch); };
  page.applyDetailPayload.call(page, { id: 9, title: '一桌任务宾果', publisher: '城瘾Hub',
    usageLocation: '餐厅/咖啡馆', sysCategoryList: [{ categoryName: '美食烹饪' }] });
  assert.deepEqual(Array.from(target.sceneChips), ['美食烹饪', '餐厅', '咖啡馆']);
  assert.deepEqual(Array.from(target.capRows, row => row.key), ['from']);
});

test('L06-158 玩法详情详情 tab:多图只渲染一组，点图仍可看大图；时长不再在 chips 里重复', () => {
  const tab = detailsTab(read('pages/templatedetail/templatedetail.wxml'));
  assert.equal((tab.match(/wx:for="\{\{ gallery \}\}"/g) || []).length, 1, '同一组图片只出一次');
  assert.doesNotMatch(tab, /xb-mosaic/);
  assert.match(tab, /class="xb-node-card" wx:for="\{\{ gallery \}\}"[^>]*bindtap="previewGallery"[^>]*data-url="\{\{ item \}\}"/);
  assert.doesNotMatch(tab, /durationValue|分钟<\/text>/, '时长只在数字卡里显示');
  assert.match(read('pages/templatedetail/templatedetail.js'), /label: '预计时长'/);
  assert.equal((tab.match(/sceneChips/g) || []).length >= 1, true);
  assert.doesNotMatch(read('pages/templatedetail/templatedetail.wxss'), /xb-mosaic/);
});

test('L06-158 主题详情详情 tab:节点图只渲染一组，点图仍可看大图', () => {
  const wxml = read('pages/templatedetail/topic-detail/index.wxml');
  const tab = wxml.match(/<block wx:if="\{\{ activeTab === 'details' \}\}">([\s\S]*?)<\/block>/)[1];
  assert.equal((tab.match(/wx:for="\{\{ gallery \}\}"/g) || []).length, 1, '同一组节点图只出一次');
  assert.doesNotMatch(tab, /xb-mosaic/);
  assert.match(tab, /class="xb-node-card" wx:for="\{\{ gallery \}\}"[^>]*bindtap="previewNode"[^>]*data-url="\{\{ item\.img \}\}"/);
});

test('L06-158 玩法详情:节点卡点开大图走全组图片', () => {
  const { page, previews } = loadTemplateDetail();
  page.data = { gallery: ['https://a/1.jpg', 'https://a/2.jpg'] };
  page.previewGallery.call(page, { currentTarget: { dataset: { url: 'https://a/2.jpg' } } });
  assert.equal(previews.length, 1);
  assert.equal(previews[0].current, 'https://a/2.jpg');
  assert.deepEqual(Array.from(previews[0].urls), ['https://a/1.jpg', 'https://a/2.jpg']);
});
