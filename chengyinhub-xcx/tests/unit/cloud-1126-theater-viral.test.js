'use strict';
// §3.2 (items 1 & 2): 主剧场户外强光可读性 / mode=1 步行陪伴 / 3:4 电影票根三版式海报与病毒传播闭环单测。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function mockCanvas2d() {
  const calls = [];
  const g = new Proxy({}, {
    get(_target, prop) {
      if (prop === 'measureText') return (t) => ({ width: String(t || '').length * 24 });
      if (prop === 'createLinearGradient') return () => ({ addColorStop() {} });
      if (typeof prop === 'string') return (...args) => calls.push([prop, args]);
      return undefined;
    },
    set() { return true; },
  });
  return { g, calls };
}

function loadPlayPage(extraWx) {
  let pageConfig;
  const store = {};
  const toasts = [];
  const navBarCalls = [];
  const clipCalls = [];
  const openLocCalls = [];
  global.getApp = () => ({
    globalData: { user_id: 42, features: {} },
    isDevEnv: () => false,
    getUserID: () => 42,
    getAuthorization: () => 'tok',
    getImgUrl: (u) => (u && u.startsWith('http') ? u : 'https://cdn.example/' + u),
    sendRequest() {},
  });
  global.getCurrentPages = () => [];
  global.wx = Object.assign({
    getStorageSync: (k) => store[k] || '',
    setStorageSync: (k, v) => { store[k] = v; },
    removeStorageSync: (k) => { delete store[k]; },
    getWindowInfo: () => ({ statusBarHeight: 20 }),
    getSystemInfoSync: () => ({ statusBarHeight: 20 }),
    setNavigationBarColor: (o) => navBarCalls.push(o),
    setClipboardData: (o) => { clipCalls.push(o.data); if (o.success) o.success(); },
    openLocation: (o) => openLocCalls.push(o),
    showToast: (o) => toasts.push(o && o.title),
    nextTick: (fn) => { if (fn) fn(); },
  }, extraWx || {});
  global.Page = (cfg) => { pageConfig = cfg; };
  const file = path.join(ROOT, 'pages/play/index.js');
  delete require.cache[file];
  require(file);
  const page = Object.assign({}, pageConfig, {
    data: JSON.parse(JSON.stringify(pageConfig.data)),
    _toasts: toasts,
    _navBarCalls: navBarCalls,
    _clipCalls: clipCalls,
    _openLocCalls: openLocCalls,
    _store: store,
    diegetic(msg) { toasts.push(msg); },
    setData(patch, cb) {
      Object.keys(patch).forEach((k) => {
        const parts = k.split('.');
        let cur = this.data;
        for (let i = 0; i < parts.length - 1; i++) {
          if (cur[parts[i]] == null || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
          cur = cur[parts[i]];
        }
        cur[parts[parts.length - 1]] = patch[k];
      });
      if (typeof cb === 'function') cb();
    },
  });
  return page;
}

/* ==================== §3.2 (1a) 说话人 24rpx + 角色色圆点 + 0.82 透明度 + 语音胶囊 ==================== */
test('1a: cast-play.wxss 说话人 24rpx/0.82 带角色色圆点,语音触发按钮为胶囊样式且不增 @keyframes', () => {
  const css = read('pages/play/cast-play.wxss');
  assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ''), /@keyframes/);
  assert.match(css, /\.chfull__who\{[^}]*font-size:24rpx;[^}]*opacity:\.82;/);
  assert.match(css, /\.chfull__who::before\{[^}]*border-radius:50%;[^}]*var\(--who-dot/);
  assert.match(css, /\.chfull__vrow\{[^}]*display:inline-flex;[^}]*border-radius:var\(--cy-radius-pill\);/);

  const cast = require('../../pages/play/utils/cast-play.js');
  const cfg = cast.normalizeCast({
    enabled: true,
    cast: [{ id: 'c1', name: '林雾', color: '#3D8BFD', voice: { mode: 'preset', preset: 'warm_female' } }],
  });
  const line = cast.lineItem({ key: 'k1', speaker: 'c1', content: '风停了。' }, cfg, null);
  assert.equal(line.who, '林雾');
  assert.equal(line.whoColor, '#3D8BFD');
  assert.match(read('pages/play/index.wxml'), /class="chfull__who" style="\{\{item\.whoColor \? '--who-dot:' \+ item\.whoColor : ''\}\}"/);
});

/* ==================== §3.2 (1b) 户外浅底高对比一键切换 ==================== */
test('1b: 户外浅底高对比切 look-palette--white、去扫描线/模糊、切浅底状态栏并持久化', () => {
  const playLook = require('../../pages/play/utils/play-look.js');
  assert.equal(playLook.outdoorLookClass('look--cyber look-palette--red story-font--hei', true), 'look--cyber story-font--hei look-palette--white');
  assert.equal(playLook.outdoorLookClass('look--stardust story-font--hand', true), 'look--stardust story-font--hand look-palette--white');
  assert.equal(playLook.outdoorLookClass('look--cyber look-palette--red', false), 'look--cyber look-palette--red');

  const page = loadPlayPage();
  page._look = { style: 'CYBER', params: { neon: 'YELLOW_CYAN', current: 'MID', glitch: 'TRANSITION' }, transition: 'AUTO', storyFont: 'HAND', palette: 'RED' };
  page.data.outdoorMode = false;
  page.toggleOutdoorMode();
  assert.equal(page.data.outdoorMode, true);
  assert.match(page.data.lookClass, /\blook-palette--white\b/);
  assert.doesNotMatch(page.data.lookClass, /\blook-palette--red\b/);
  assert.equal(page._store[playLook.OUTDOOR_STORAGE_KEY], '1');
  assert.equal(page._navBarCalls.at(-1).frontColor, '#000000');

  page.toggleOutdoorMode();
  assert.equal(page.data.outdoorMode, false);
  assert.match(page.data.lookClass, /\blook-palette--red\b/);
  assert.equal(page._store[playLook.OUTDOOR_STORAGE_KEY], '0');

  const wxml = read('pages/play/index.wxml');
  const wxss = read('pages/play/index.wxss');
  assert.match(wxml, /bindtap="toggleOutdoorMode"[\s\S]*户外浅底高对比/);
  assert.match(wxml.split('\n')[0], /\{\{outdoorMode \? 'play--outdoor' : ''\}\}/);
  assert.match(wxss, /\.play\.play--outdoor \.look-tex\{ display:none; background:none; \}/);
  assert.match(wxss, /\.play\.play--outdoor \.st-line[^}]*filter:none;/);
  assert.match(wxss, /\.play\.play--outdoor \.lk-pop[^}]*backdrop-filter:none;/);
});

/* ==================== §3.2 (1c) 章末轻点呼吸提示 ==================== */
test('1c: 章末渲染轻点屏幕呼吸提示,复用既有 fade 关键帧不新增 @keyframes', () => {
  const wxml = read('pages/play/index.wxml');
  const wxss = read('pages/play/index.wxss');
  assert.match(wxml, /<view class="chfull__tapcue" wx:if="\{\{storyEnd\.ready\(chapterParas\)\}\}" aria-hidden="true">轻点屏幕 · 前往下一站<\/view>/);
  assert.match(wxss, /\.chfull__tapcue\{[^}]*animation:fade 2\.4s ease-in-out infinite alternate;/);
  assert.match(wxss, /\.play--reduced-motion \.chfull__tapcue[^}]*animation:none;/);
});

/* ==================== §3.2 (1d) mode=1 解锁步行陪伴距离条与 50%/90% NPC 气泡 ==================== */
test('1d: mode=1 城市定向解锁 startNav 距离条与 50%/90% companionLine NPC 气泡', () => {
  const page = loadPlayPage();
  const node = { nodeId: 101, name: '外白渡桥', lat: 31.244, lng: 121.491, done: false };
  page.data.mode = 1;
  page.data.nodes = [node];
  page.data.sheet = { show: true, node };
  page._loc = { latitude: 31.234, longitude: 121.491 }; // 约 1111m
  page.rebuild = () => {};
  const companionCalls = [];
  page._fetchCompanionLine = () => companionCalls.push('companion');

  page.onSheetGoTap();
  assert.equal(page.data.nav.active, true);
  assert.equal(page.data.nav.targetNodeId, 101);
  assert.ok(page.data.nav.totalM > 900);

  // 走过 55% → 触发一次 50% companionLine
  page._updateNav({ latitude: 31.2395, longitude: 121.491 });
  assert.equal(page.data.nav.hit50, true);
  assert.equal(page.data.nav.hit90, false);
  assert.equal(companionCalls.length, 1);

  // 走过 92% → 触发一次 90% companionLine
  page._updateNav({ latitude: 31.2433, longitude: 121.491 });
  assert.equal(page.data.nav.hit90, true);
  assert.equal(companionCalls.length, 2);

  // 导航条在故事流(chapterFull)可见且层级高于 .chfull(106)
  const wxml = read('pages/play/index.wxml');
  const wxss = read('pages/play/index.wxss');
  assert.ok(wxml.indexOf('<view class="navtop"') < wxml.indexOf('!chapterFull}}">'), 'navtop 在 !chapterFull 之外,mode=1 故事流也能看见');
  assert.match(wxss, /\.navtop\{ position:fixed;[^}]*z-index:107;/);
  assert.match(wxss, /\.navbubble\{ position:fixed;[^}]*z-index:107;/);
});

/* ==================== §3.2 (1e) 户外 GPS 精度提示阈值放宽至 120m ==================== */
test('1e: play-accuracy.js 提示阈值放宽到 120m,自动到达仍严守 80m 围栏', () => {
  const A = require('../../pages/play/utils/play-accuracy.js');
  assert.equal(A.HINT_ACCURACY_M, 120);
  assert.equal(A.MAX_ACCURACY_M, 80);
  assert.equal(A.isLowAccuracy(85), false);
  assert.equal(A.isLowAccuracy(120), false);
  assert.equal(A.isLowAccuracy(120.1), true);
  assert.equal(A.canAutoArrive(80), true);
  assert.equal(A.canAutoArrive(80.1), false);
});

/* ==================== §3.2 (1f) theme-backpack.wxss 继承 --lk-* token 与两列档案卡 ==================== */
test('1f: theme-backpack.wxss 继承 --lk-* 变量并渲染两列档案卡', () => {
  const css = read('pages/play/theme-backpack.wxss');
  assert.match(css, /\.play\[class\*="look--"\] \.tb-player-sheet, \.play\[class\*="look--"\] \.tbp\{[^}]*--cy-comp-sheet-player-bg:var\(--lk-bg\);[^}]*--cy-comp-sheet-player-text:var\(--lk-ink\);/);
  assert.match(css, /\.tb-items\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\);/);
  assert.match(css, /\.tb-item\{[^}]*border-radius:var\(--lk-r,[^}]*background:var\(--lk-card,/);
  assert.match(css, /\.tb-item__qty\{[^}]*color:var\(--lk-a,/);
});

/* ==================== §3.2 (2a) closeFinale -> _openMedalScreen 短路修复 ==================== */
test('2a: mode=1 玩家关闭通关过场(closeFinale)后正确弹出 medal-screen', () => {
  const page = loadPlayPage();
  let medalOpened = 0;
  page.data.allDone = true;
  page.data.mode = 1;
  page.data.isPreview = false;
  page.data.isMock = false;
  page.data.finale = { show: true };
  page._openMedalScreen = () => { medalOpened += 1; };

  page.closeFinale();
  assert.equal(page.data.finale.show, false);
  assert.equal(medalOpened, 1);

  // mode=2 或 preview 不重复打开
  page.data.mode = 2;
  page.closeFinale();
  assert.equal(medalOpened, 1);
});

/* ==================== §3.2 (2b) 3:4 1080x1440 电影票根 / 城市轨迹 / 结案档案三版式 ==================== */
test('2b: route-card.js 3:4 1080x1440 支持电影票根/城市轨迹/结案档案三版式完整绘制', () => {
  const rc = require('../../pages/play/utils/route-card.js');
  assert.equal(rc.W, 1080);
  assert.equal(rc.H, 1440);
  assert.equal(rc.W * 4, rc.H * 3, '严格 3:4 比例');
  assert.deepEqual(rc.LAYOUTS.map((l) => l.key), ['ticket', 'track', 'dossier']);
  assert.deepEqual(rc.LAYOUTS.map((l) => l.label), ['电影票根', '城市轨迹', '结案档案']);

  const track = Array.from({ length: 20 }, (_, i) => ({ lat: 31.22 + i * 0.0005, lng: 121.47 + Math.sin(i / 3) * 0.0004 }));
  const model = rc.cardModel({
    layout: 'ticket',
    track,
    name: '雾港来信',
    time: '1 小时 12 分',
    doneCount: 6,
    city: '上海市',
    date: '2026.11.26',
    ending: { title: '守灯人的回信', summary: '你在海雾散尽前送出了最后一封信。' },
    medal: { name: '雾港守灯人', sub: '主题通关' },
    quote: '灯塔灭了，路还在脚下。',
    quoteAuthor: '林雾',
    duoStamp: { label: '双人同行', sub: '2 人成行' },
    photos: ['p1.jpg', 'p2.jpg', 'p3.jpg', 'p4.jpg'],
    branchPath: [
      { step: '01', nodeName: '老邮局', choice: '保留火漆信封' },
      { step: '02', nodeName: '渡口码头', choice: '替林雾隐瞒船票' },
    ],
  });
  assert.equal(model.photos.length, 3, '旅途照片最多取 3 张');
  assert.equal(model.branchPath.length, 2);
  assert.equal(model.duoStamp.label, '双人同行');

  // 版式 1: 电影票根(含路线小轨 + 1-3 照片 + 勋章 + 结局 + 角色语录 + 双人章 + 二维码)
  const c1 = mockCanvas2d();
  rc.drawCard(c1.g, model, 1, { qr: 1 }, { map: 1 }, { layout: 'ticket', photos: [{ p: 1 }, { p: 2 }] });
  const texts1 = c1.calls.filter(([k]) => k === 'fillText').map(([, a]) => a[0]).join('\n');
  assert.match(texts1, /CITY MOVIE TICKET/);
  assert.match(texts1, /雾港来信/);
  assert.match(texts1, /守灯人的回信/);
  assert.match(texts1, /雾港守灯人/);
  assert.match(texts1, /林雾/);
  assert.match(texts1, /双人同行/);
  const drawImgs1 = c1.calls.filter(([k]) => k === 'drawImage');
  assert.ok(drawImgs1.length >= 4, '底图 + 2张旅途照片 + 二维码');

  // 版式 2: 城市轨迹
  const c2 = mockCanvas2d();
  rc.drawCard(c2.g, model, 1, { qr: 1 }, { map: 1 }, { layout: 'track' });
  const texts2 = c2.calls.filter(([k]) => k === 'fillText').map(([, a]) => a[0]).join('\n');
  assert.match(texts2, /CITY TRACK/);
  assert.match(texts2, /公里/);

  // 版式 3: 结案档案(含 branchPath)
  const c3 = mockCanvas2d();
  rc.drawCard(c3.g, model, 1, { qr: 1 }, { map: 1 }, { layout: 'dossier' });
  const texts3 = c3.calls.filter(([k]) => k === 'fillText').map(([, a]) => a[0]).join('\n');
  assert.match(texts3, /结案档案/);
  assert.match(texts3, /保留火漆信封/);
  assert.match(texts3, /替林雾隐瞒船票/);
});

/* ==================== §3.2 (2c & 2d) 结算页保存相册 + 朋友圈 + 存图后复制不剧透小红书文案 ==================== */
test('2c & 2d: 游玩页与结算页存图后显示一键复制不剧透小红书文案,结算页恢复保存图片并支持 onShareTimeline', () => {
  const rc = require('../../pages/play/utils/route-card.js');
  const copy = rc.buildXiaohongshuCopy({
    name: '雾港来信', city: '上海市', fallbackKm: 3.4, time: '58 分', doneCount: 5,
    medal: { name: '雾港守灯人' }, duoStamp: { label: '双人同行' },
  });
  assert.match(copy, /雾港来信/);
  assert.match(copy, /不剧透/);
  assert.match(copy, /#城瘾/);
  assert.match(copy, /#上海周末/);

  // 游玩页:保存成功点亮 posterSaved,点击 copyXhsCopy 写入剪贴板
  const savedCallbacks = [];
  const page = loadPlayPage({
    saveImageToPhotosAlbum: (o) => savedCallbacks.push(o),
  });
  page.data.topicName = '雾港来信';
  page.data.doneCount = 5;
  page.data.reviewDistance = '3.4';
  page.data.reviewElapsed = '58 分';
  page._reviewOrderedNodes = () => [];
  page._saveToAlbum('/tmp/poster.jpg', () => true);
  assert.equal(savedCallbacks.length, 1);
  savedCallbacks[0].success();
  assert.equal(page.data.posterSaved, true);
  page.copyXhsCopy();
  assert.equal(page._clipCalls.length, 1);
  assert.match(page._clipCalls[0], /雾港来信/);
  assert.match(page._clipCalls[0], /不剧透/);

  // 结算页:恢复保存图片 + onShareTimeline + 存图后复制小红书文案
  const settleWxml = read('subpackageJourney/pages/settle/index.wxml');
  assert.match(settleWxml, /bindtap="saveShareImage">保存图片<\/cy-btn>/);
  assert.match(settleWxml, /wx:if="\{\{posterSaved\}\}" bindtap="copyXhsCopy"[\s\S]*复制不剧透小红书文案/);

  let settleConfig;
  const settleClip = [];
  const settleSaved = [];
  const shareMenu = [];
  global.Page = (cfg) => { settleConfig = cfg; };
  global.getApp = () => ({ globalData: { statusBarHeight: 20, navBarHeight: 44 }, sendRequest() {} });
  global.wx = {
    getStorageSync: () => '',
    setStorageSync() {},
    showShareMenu: (o) => shareMenu.push(o),
    saveImageToPhotosAlbum: (o) => settleSaved.push(o),
    setClipboardData: (o) => { settleClip.push(o.data); if (o.success) o.success(); },
    showToast() {},
  };
  const settleFile = path.join(ROOT, 'subpackageJourney/pages/settle/index.js');
  delete require.cache[settleFile];
  require(settleFile);
  const sp = Object.assign({}, settleConfig, {
    data: JSON.parse(JSON.stringify(settleConfig.data)),
    setData(p) { Object.assign(this.data, p); },
    reload() {},
  });
  sp.onLoad({ topicId: '88', topicName: encodeURIComponent('雾港来信') });
  assert.ok(shareMenu.some((m) => Array.isArray(m.menus) && m.menus.includes('shareTimeline')));

  sp.data.report = { topicId: '88', result: '已通关', nodesText: '5/5', scored: true, scoreText: '120', shareTitle: '通关战报' };
  sp.data.shareImage = '/tmp/settle-card.png';
  const tl = sp.onShareTimeline();
  assert.equal(tl.title, '雾港来信 · 通关战报');
  assert.equal(tl.query, 'id=88');
  assert.equal(tl.imageUrl, '/tmp/settle-card.png');

  sp._saveShareToAlbum('/tmp/settle-card.png');
  assert.equal(settleSaved.length, 1);
  settleSaved[0].success();
  assert.equal(sp.data.posterSaved, true);
  sp.copyXhsCopy();
  assert.equal(settleClip.length, 1);
  assert.match(settleClip[0], /雾港来信/);
  assert.match(settleClip[0], /不剧透/);
});
