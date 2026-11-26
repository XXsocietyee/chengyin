'use strict';
// 业主决策 2026-11-24(F06 默认项)—— 主题详情 / 商家主题页。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { flattenComponentToPage } = require('../helpers/component-as-page.js');

const ROOT = path.resolve(__dirname, '../..');
const TOPIC_JS = path.join(ROOT, 'pages/topic/index/index.js');

function makeSetData(holder) {
  return function setData(patch, cb) {
    Object.keys(patch || {}).forEach((key) => {
      if (key.indexOf('.') === -1) { holder[key] = patch[key]; return; }
      const parts = key.split('.');
      let cursor = holder;
      for (let i = 0; i < parts.length - 1; i += 1) {
        if (!cursor[parts[i]] || typeof cursor[parts[i]] !== 'object') cursor[parts[i]] = {};
        cursor = cursor[parts[i]];
      }
      cursor[parts[parts.length - 1]] = patch[key];
    });
    if (cb) cb();
  };
}

function installGlobals() {
  const sandbox = { requests: [], toasts: [], navigations: [] };
  global.getApp = () => ({
    globalData: {},
    getUserType: () => 1,
    tips: m => sandbox.toasts.push(m),
    sendRequest: options => { sandbox.requests.push(options); },
    getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
  });
  global.Page = config => { sandbox.pageConfig = config; };
  global.Component = config => { sandbox.pageConfig = flattenComponentToPage(config); };
  global.getCurrentPages = () => [{}];
  global.wx = {
    showToast: o => sandbox.toasts.push(o && o.title),
    showLoading() {}, hideLoading() {},
    navigateTo: o => sandbox.navigations.push(o && o.url),
    redirectTo: o => sandbox.navigations.push(o && o.url),
    getStorageSync: () => '', setStorageSync() {},
    getSystemInfoSync: () => ({}), getWindowInfo: () => ({}),
  };
  return sandbox;
}

function mountPage(modulePath, sandbox) {
  delete require.cache[modulePath];
  require(modulePath);
  const vm = Object.assign({}, sandbox.pageConfig, sandbox.pageConfig.methods || {});
  vm.data = JSON.parse(JSON.stringify(sandbox.pageConfig.data || {}));
  vm.setData = makeSetData(vm.data);
  return vm;
}

const OFFER_ROW = { merchantRowId: 77, merchantOwnerMemberId: 900, merchantName: '旧城咖啡', inAppOptedIn: false, couponOptedIn: false };

test('L06-079:买完后结果面板沿用揭晓时已取到的营销邀请,不再重复请求;勾选文字与保存合同不变', () => {
  const sandbox = installGlobals();
  const vm = mountPage(TOPIC_JS, sandbox);
  vm.data.info = { id: 500, memberId: 900, name: '旧城', contentPublisherType: 'MERCHANT' };
  vm._showPassReveal(500, 11, null);
  const gets = () => sandbox.requests.filter(r => r.url === '/api/merchant/crm/marketing-consents' && r.method === 'GET');
  assert.equal(gets().length, 1, '揭晓时取一次');
  gets()[0].success({ code: 200, data: [OFFER_ROW] });

  vm.onRevealPlay();
  assert.equal(gets().length, 1, '结果面板不再重复取邀请');
  assert.equal(vm.data.resultSheet.show, true);
  assert.equal(vm.data.resultSheet.consentName, '旧城咖啡');
  assert.equal(vm.data.resultSheet.consentChecked, false, '默认不勾');
  assert.equal(vm.data.resultSheet.consentState, 'idle');

  vm.onResultConsentChange({ detail: { checked: true } });
  const posts = sandbox.requests.filter(r => r.url === '/api/merchant/crm/marketing-consents' && r.method === 'POST');
  assert.equal(posts.length, 1);
  const body = JSON.parse(posts[0].data);
  assert.equal(body.merchantRowId, 77);
  assert.equal(body.optedIn, true);
});

test('L06-079:揭晓时没有邀请就不弹结果面板,也不补取', () => {
  const sandbox = installGlobals();
  const vm = mountPage(TOPIC_JS, sandbox);
  vm.data.info = { id: 500, memberId: 900, name: '旧城', contentPublisherType: 'PLATFORM' };
  vm._showPassReveal(500, 11, null);
  vm.onRevealWallet();
  assert.equal(sandbox.requests.filter(r => r.url === '/api/merchant/crm/marketing-consents').length, 0);
  assert.notEqual(vm.data.resultSheet && vm.data.resultSheet.show, true);
});

test('L06-029:自由探索数据条的「有效期」与购买弹窗「还剩 N 天」是同一个数(北京时间日历天)', (t) => {
  const facts = require('../../pages/topic/utils/topic-detail-facts.js');
  const motion = require('../../pages/topic/utils/topic-motion.js');
  // 北京时间 11-24 22:00,主题 12-02 当天结束:按毫秒向上取整是 9 天,按日历天是 8 天
  const now = Date.parse('2026-11-24T22:00:00+08:00');
  t.mock.method(Date, 'now', () => now);
  const info = { productType: 2, endDate: '2026-12-02 23:59:59' };
  const cell = facts.buildTopicStatBar(info).find((c) => c.key === 'valid');
  const sheet = motion.passWindow({ topicEnd: info.endDate });
  assert.equal(sheet.daysText, '8');
  assert.equal(cell.value, sheet.daysText);
  assert.match(sheet.line, /还剩 8 天/);
  // 没有结束日:两处都是 90 天
  const open = facts.buildTopicStatBar({ productType: 2 }).find((c) => c.key === 'valid');
  assert.equal(open.value, motion.passWindow({}).daysText);
  // 已结束:有效期格整格不出(0 天不写)
  assert.equal(facts.buildTopicStatBar({ productType: 2, endDate: '2026-11-01 23:59:59' }).some((c) => c.key === 'valid'), false);
});

test('L06-099:承接方式旁的问号图标保留,无效点击与从未出现过的「路线模式介绍」弹层删除', () => {
  const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
  const wxml = read('pages/topic/merchantinfo/merchantinfo.wxml');
  const row = wxml.match(/<view class="dt">承接方式<\/view>\s*<view class="dt david_wh"[^>]*>/);
  assert.ok(row, '问号图标还在原位');
  assert.match(wxml, /src="\/pages\/topic\/images\/d_weihao\.png"/);
  assert.doesNotMatch(row[0], /bindtap|hover-class/, '图标不再装作可点');
  assert.doesNotMatch(wxml, /路线模式介绍|davidShow|davidbmtk/);
  const sandbox = installGlobals();
  const vm = mountPage(path.join(ROOT, 'pages/topic/merchantinfo/merchantinfo.js'), sandbox);
  assert.equal(typeof vm.davidClick, 'undefined');
  assert.equal(Object.hasOwn(vm.data, 'davidShow'), false);
  assert.doesNotMatch(read('pages/topic/merchantinfo/merchantinfo.wxss'), /davidbmtk|pop-topic2/);
  for (const f of ['d_bmtk1', 'd_bmtk2', 'd_bmtk3', 'd_bmtk5']) assert.equal(fs.existsSync(path.join(ROOT, 'pages/topic/images', f + '.png')), false);
});

test('L06-109:主题页四个抽屉组件不再各写一份按压样式,按下沿用全局 .cy-pressed 的轻微缩小', () => {
  const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
  const global = read('style/components.wxss');
  assert.match(global, /\.cy-pressed\s*\{[^}]*transform: scale\(\.97\)/, '现在看到的缩小效果来自全局按压类');
  for (const c of ['project-host', 'project-join', 'project-drawer', 'project-layer']) {
    const js = read('pages/topic/components/' + c + '/index.js');
    assert.match(js, /addGlobalClass: true/, c + ' 吃得到全局类');
    const css = read('pages/topic/components/' + c + '/index.wxss');
    assert.doesNotMatch(css, /(^|\})\s*\.cy-pressed\s*\{/m, c + ' 不再本地重复定义 .cy-pressed');
  }
});

test('L06-025:我的节点 / 章节抽屉 / 客户名单抽屉加载失败时显示原有的失败标题和重试,不再一片空白', () => {
  const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
  const join = read('pages/topic/components/project-join/index.wxml');
  const host = read('pages/topic/components/project-host/index.wxml');
  const tag = (src, title) => {
    const m = src.match(new RegExp('<cy-(?:inline-)?error[^>]*title="' + title + '"[^>]*/>'));
    assert.ok(m, title);
    return m[0];
  };
  const nodes = tag(join, '我的节点加载失败');
  const chapter = tag(join, '本章内容加载失败');
  const players = tag(host, '客户名单加载失败');
  for (const t of [nodes, chapter, players]) assert.doesNotMatch(t, /load-failure/, '不再走「加载失败留白」');
  assert.match(nodes, /retry="重试"[^>]*data-act="retryMyChapterNodes"[^>]*bind:retry="emit"/);
  assert.match(chapter, /retry="重试"[^>]*bind:retry="emitOpenChapter"/);
  assert.match(players, /action="重新加载"[^>]*data-act="retryPlayerSheet"[^>]*bind:action="emit"/);
  // 组件本身:不带 loadFailure 时画标题与重试
  const errWxml = read('components/cy/error/index.wxml');
  assert.match(errWxml, /wx:if="\{\{loadFailure\}\}"[\s\S]*<view class="cy-error-title">\{\{title\}\}<\/view>[\s\S]*wx:if="\{\{retry\}\}"/);
  // 页面派发白名单里三个重试都在
  const page = read('pages/topic/merchantinfo/merchantinfo.js');
  for (const act of ['retryMyChapterNodes', 'retryPlayerSheet', 'openChapterSheet']) assert.match(page, new RegExp('\\b' + act + ': 1'));
});

test('L06-120:没有坐标时的路线草图只画一次底纹,不再逐帧重画;页面不再传用不到的点', () => {
  const file = path.join(ROOT, 'pages/topic/components/cy/route-sketch/index.js');
  let cfg;
  global.Component = (c) => { cfg = c; };
  delete require.cache[file];
  require(file);
  const ops = [];
  let raf = 0;
  const ctx = new Proxy({}, {
    get: (t, k) => (k in t ? t[k] : (...a) => ops.push(k)),
    set: (t, k) => { t[k] = undefined; delete t[k]; return true; },
  });
  const node = { getContext: () => ctx, requestAnimationFrame: (f) => { raf += 1; if (raf < 100) f(); } };
  global.wx = { createSelectorQuery() {} };
  const vm = Object.assign({ data: { points: [], tone: 'city', reducedMotion: false } }, cfg.methods);
  vm.createSelectorQuery = () => ({ select: () => ({ fields: () => ({ exec: (cb) => cb([{ node, width: 300, height: 180 }]) }) }) });
  cfg.lifetimes.ready.call(vm);
  assert.equal(raf, 0, '不再申请动画帧');
  assert.equal(ops.filter((o) => o === 'fillRect').length, 1, '底色只铺一次');
  assert.equal(ops.filter((o) => o === 'stroke').length, 9, '九条示意街道各画一次');
  assert.equal(ops.includes('arc') || ops.includes('fillText') || ops.includes('ellipse'), false, '没有路线点 / 编号 / 范围圈');
  const wxml = fs.readFileSync(path.join(ROOT, 'pages/topic/index/index.wxml'), 'utf8');
  assert.match(wxml, /<cy-route-sketch wx:if="\{\{!routeReal && !sketchPoints\.length\}\}" bind:open="onRouteReal" \/>/);
});
