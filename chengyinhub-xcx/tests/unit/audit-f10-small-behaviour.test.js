'use strict';
// AUDIT-1122 F10 小项行为测试:L10-053 当前 tab 不重进;L10-200 坏编码深链不抛错。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

global.Behavior = global.Behavior || ((b) => b);
function load(rel, globals) {
  let def;
  const file = path.resolve(__dirname, '../..', rel);
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), Object.assign({ Page: (v) => { def = v; }, Component: (v) => { def = v; },
    getApp: () => ({ globalData: {}, getUserID: () => '7' }), require: createRequire(file), console, setTimeout, clearTimeout,
    getCurrentPages: () => [], Behavior: (b) => b }, globals), { filename: file });
  return def;
}

test('L10-053:点已选中的 tab 不 reLaunch/switchTab', () => {
  const calls = [];
  const wx = { reLaunch: (o) => calls.push(['reLaunch', o.url]), switchTab: (o) => calls.push(['switchTab', o.url]), getStorageSync: () => '' };
  const def = load('components/tabBar/index.js', { wx });
  const comp = Object.assign({}, def.methods, { data: { mode: 'merchant', active: 1, list: [{ pagePath: '/a' }, { pagePath: '/b' }] } });
  comp.onChange({ currentTarget: { dataset: { index: 1 } } });
  assert.deepEqual(calls, []);
  comp.onChange({ currentTarget: { dataset: { index: 0 } } });
  assert.deepEqual(calls, [['reLaunch', '/a']]);
});

test('L10-200:topicName 编码坏掉时 onLoad 不抛错', () => {
  const def = load('pages/userinfo/userinfo.js', { wx: { getStorageSync: () => '' } });
  const page = Object.assign({}, def, { data: JSON.parse(JSON.stringify(def.data)), setData(v) { Object.assign(this.data, v); } });
  assert.doesNotThrow(() => page.onLoad({ userId: '9', topicName: '%E4%B8' }));
  assert.equal(page.data.topicName, '%E4%B8');
});

test('L10-151:取消/选中后挂起的防抖搜索被清掉', () => {
  const cleared = [];
  const def = load('components/cy/map-address-search/index.js', { wx: { getStorageSync: () => '' }, clearTimeout: (id) => cleared.push(id) });
  const comp = Object.assign({}, def.methods, { data: { results: [] }, setData(v) { Object.assign(this.data, v); }, triggerEvent() {} });
  comp._searchTimer = 11; comp.onCancel();
  comp._searchTimer = 12; comp._pick({ name: 'x' });
  assert.deepEqual(cleared, [11, 12]);
  assert.equal(comp._searchTimer, null);
});

test('L10-152:cy-empty / cy-error 卸载后打上 _detached,延迟入场动画不再作用于它', () => {
  for (const rel of ['components/cy/empty/index.js', 'components/cy/error/index.js']) {
    const def = load(rel, { wx: { getStorageSync: () => '' } });
    const ctx = {};
    def.lifetimes.detached.call(ctx);
    assert.equal(ctx._detached, true, rel);
  }
});

test('L10-162:头像图片加载失败回退到首字;没有名字回退默认头像', () => {
  const def = load('components/cy/avatar/index.js', { wx: { getStorageSync: () => '' } });
  const make = (name) => Object.assign({}, def.methods, { data: { _mode: 'image', name }, setData(v) { Object.assign(this.data, v); } });
  const a = make('小林'); a.onImgError(); assert.equal(a.data._mode, 'initial');
  const b = make(''); b.onImgError(); assert.equal(b.data._mode, 'placeholder');
});

test('L10-181:调用方拒绝切换(再设同一个 checked)时原生开关回位', () => {
  const def = load('components/cy/switch/index.js', { wx: { getStorageSync: () => '' } });
  const sw = Object.assign({}, def.methods, { data: { checked: false, _checked: false }, setData(v) { Object.assign(this.data, v); }, triggerEvent() {} });
  sw.onChange({ detail: { value: true } });
  assert.equal(sw.data._checked, true);
  def.observers.checked.call(sw, false);
  assert.equal(sw.data._checked, false, '保存失败,页面把 checked 设回 false,开关要回到关');
});

test('L10-177:搜索框自己记住输入值,调用方不回写也能出清除键', () => {
  const def = load('components/cy/search/index.js', { wx: { getStorageSync: () => '' } });
  const s = Object.assign({}, def.methods, { data: { value: '' }, setData(v) { Object.assign(this.data, v); }, triggerEvent() {} });
  s.onInput({ detail: { value: '咖啡' } });
  assert.equal(s.data.value, '咖啡');
});

test('L10-174:发布菜单按点的卡片模式直达编辑页,不经 data 中转', () => {
  const def = load('components/cy/publish-sheet/index.js', { wx: { getStorageSync: () => '' } });
  const methods = def.methods || def;
  const urls = [];
  const sheet = Object.assign({}, methods, { data: { pub: { permission: {}, quota: {} }, scope: '' }, setData(v) { Object.assign(this.data, v); },
    _closeAndGo(url) { urls.push(url); }, _scopeSuffix() { return ''; } });
  sheet.chooseTopicMode({ currentTarget: { dataset: { mode: '2' } } });
  sheet.chooseTopicMode({ currentTarget: { dataset: { mode: '1' } } });
  assert.deepEqual(urls, ['/pages/publish/fabu/index?mode=2', '/pages/publish/fabu/index?mode=1']);
  assert.equal(sheet.data.selectedMode, undefined);
});

test('L10-054:tabBar 同一套 tab 不重发 list;挂载时 observer 跑过就不再重复一轮', () => {
  const def = load('components/tabBar/index.js', { wx: { getStorageSync: () => '' },
    getCurrentPages: () => [{ route: 'pages/index/index' }] });
  function mount(mode) {
    const sets = [];
    const comp = Object.assign({}, def.methods, { data: JSON.parse(JSON.stringify(def.data)),
      setData(v) { sets.push(Object.keys(v)); Object.assign(this.data, v); } });
    comp.data.mode = mode || 'consumer';
    def.lifetimes.created.call(comp);
    if (mode) def.observers.mode.call(comp);
    def.lifetimes.attached.call(comp);
    return { comp, sets };
  }
  const consumer = mount();
  assert.deepEqual(consumer.sets, [], '默认 consumer:list 初值已对,首页 active=0 也已对 ⇒ 零 setData');
  const merchant = mount('merchant');
  assert.deepEqual(merchant.sets.filter((k) => k.includes('list')).length, 1, 'merchant 只发一次 list');
  merchant.sets.length = 0;
  def.observers.mode.call(merchant.comp);
  assert.equal(merchant.sets.filter((k) => k.includes('list')).length, 0, '同为 merchant 再触发 observer 不重发 list');
  merchant.comp.data.mode = 'consumer';
  def.observers.mode.call(merchant.comp);
  assert.equal(merchant.comp.data.list[0].pagePath, '/pages/index/index', 'merchant → consumer 换回 C 端五 tab');
});

test('L10-099:map-snapshot 等待中宿主关掉 ⇒ 立即收手,不空转到超时', async () => {
  const mapSnap = require('../../utils/map-snapshot.js');
  let alive = true; let checks = 0;
  const ctx = { takeSnapshot() { throw new Error('must not snapshot'); } };
  const p = mapSnap.takeMapSnapshot(ctx, () => { checks += 1; return false; }, 4000, () => alive);
  await new Promise((r) => setTimeout(r, 100));
  alive = false;
  const t0 = Date.now();
  await assert.rejects(p, (e) => e.mapSnapshot === true && /cancelled/.test(e.message));
  assert.ok(Date.now() - t0 < 200, '关掉后一步之内结束');
  assert.ok(checks <= 3);
});

test('L10-109:附近的局 今天/明天/倒计时 按中国日历,设备时区在洛杉矶也一样', () => {
  const { execFileSync } = require('node:child_process');
  const code = "const m=require('./utils/roam-hangout-marker.js');const now=Date.parse('2026-11-23T22:30:00+08:00');" +
    "process.stdout.write(JSON.stringify([m.whenParts('2026-11-23 23:00',now).label,m.whenParts('2026-11-24 09:00',now).label," +
    "m.whenParts('2026-11-26 09:00',now).label,m.countdownBadge('2026-11-24 00:30',now)]))";
  const run = (tz) => JSON.parse(execFileSync(process.execPath, ['-e', code], { cwd: path.resolve(__dirname, '../..'), env: Object.assign({}, process.env, { TZ: tz }) }).toString());
  const sh = run('Asia/Shanghai');
  assert.deepEqual(sh, ['今晚', '明天', '周四', '02:00']);
  assert.deepEqual(run('America/Los_Angeles'), sh);
});

test('L10-110:游玩记录结束日按中国日历写 M月D日,跨年带年', () => {
  const { historyRow } = require('../../utils/theme-records.js');
  const thisYear = new Date(Date.now() + 8 * 3600000).getUTCFullYear();
  const ended = Date.parse(thisYear + '-03-01T23:30:00+08:00');
  assert.equal(historyRow({ result: { endedAt: ended } }).endedText, '3月1日');
  assert.equal(historyRow({ result: { endedAt: '2019-12-31 23:59:00' } }).endedText, '2019年12月31日');
  assert.equal(historyRow({ result: {} }).endedText, '');
});

test('L10-165:窗口几何一次启动只同步读一次,改窗口尺寸后作废', () => {
  const nav = require('../../utils/nav-safe-area.js');
  nav.resetWindowCacheForTest();
  let reads = 0; let onResize = null;
  const api = { getWindowInfo: () => { reads += 1; return { windowWidth: 375 + reads } }, onWindowResize: (fn) => { onResize = fn; } };
  assert.equal(nav.cachedWindowInfo(api).windowWidth, 376);
  assert.equal(nav.cachedWindowInfo(api).windowWidth, 376);
  assert.equal(reads, 1);
  onResize();
  assert.equal(nav.cachedWindowInfo(api).windowWidth, 377);
  assert.equal(reads, 2);
  nav.resetWindowCacheForTest();
});

test('L10-198:营销同意页静态打开即加载一次,初始化 observer 再触发也不双发', () => {
  const reqs = [];
  const def = load('pages/shezhi/components/marketing-consent/index.js', { wx: { getStorageSync: () => '' },
    getApp: () => ({ globalData: {}, sendRequest: (o) => reqs.push(o.url) }) });
  const comp = Object.assign({}, def.methods, { data: Object.assign({ show: true }, JSON.parse(JSON.stringify(def.data))),
    setData(v) { Object.assign(this.data, v); } });
  def.lifetimes.attached.call(comp);
  def.observers.show.call(comp, true);
  assert.deepEqual(reqs, ['/api/merchant/crm/marketing-consents']);
  assert.equal(def.properties.layout, undefined, 'sheet 版式开关已删');
});

test('L10-094:表驱动 scene 解析与旧实现逐例等价(期望值取自改造前实现)', () => {
  const g = require('../../utils/game-door-entry.js');
  const CASES = [
  {"c": null, "parseDoorScene": null, "parseTopicScene": null, "parseActivityScene": null, "parseShopScene": null, "parseTeamScene": null, "rcPath": null, "cap1047": "P", "cap1011": "P"},
  {"c": "", "parseDoorScene": null, "parseTopicScene": null, "parseActivityScene": null, "parseShopScene": null, "parseTeamScene": null, "rcPath": null, "cap1047": "P", "cap1011": "P"},
  {"c": "0123456789ABCDEF0123456789abcdef", "parseDoorScene": "0123456789abcdef0123456789abcdef", "parseTopicScene": null, "parseActivityScene": null, "parseShopScene": null, "parseTeamScene": null, "rcPath": null, "cap1047": "0123456789abcdef0123456789abcdef", "cap1011": "P"},
  {"c": "%30123456789ABCDEF0123456789abcde", "parseDoorScene": null, "parseTopicScene": null, "parseActivityScene": null, "parseShopScene": null, "parseTeamScene": null, "rcPath": null, "cap1047": "P", "cap1011": "P"},
  {"c": "tp.12", "parseDoorScene": null, "parseTopicScene": "12", "parseActivityScene": null, "parseShopScene": null, "parseTeamScene": null, "rcPath": null, "cap1047": "tp.12", "cap1011": "P"},
  {"c": "tp.0012", "parseDoorScene": null, "parseTopicScene": "0012", "parseActivityScene": null, "parseShopScene": null, "parseTeamScene": null, "rcPath": null, "cap1047": "tp.0012", "cap1011": "P"},
  {"c": " tp.5 ", "parseDoorScene": null, "parseTopicScene": "5", "parseActivityScene": null, "parseShopScene": null, "parseTeamScene": null, "rcPath": null, "cap1047": "tp.5", "cap1011": "P"},
  {"c": "tp%2E77", "parseDoorScene": null, "parseTopicScene": "77", "parseActivityScene": null, "parseShopScene": null, "parseTeamScene": null, "rcPath": null, "cap1047": "tp.77", "cap1011": "P"},
  {"c": "ac.9", "parseDoorScene": null, "parseTopicScene": null, "parseActivityScene": "9", "parseShopScene": null, "parseTeamScene": null, "rcPath": null, "cap1047": "ac.9", "cap1011": "P"},
  {"c": "sh.3", "parseDoorScene": null, "parseTopicScene": null, "parseActivityScene": null, "parseShopScene": "3", "parseTeamScene": null, "rcPath": null, "cap1047": "sh.3", "cap1011": "P"},
  {"c": "sh.1234567890123456789", "parseDoorScene": null, "parseTopicScene": null, "parseActivityScene": null, "parseShopScene": null, "parseTeamScene": null, "rcPath": null, "cap1047": "P", "cap1011": "P"},
  {"c": "tm.ABCDEF", "parseDoorScene": null, "parseTopicScene": null, "parseActivityScene": null, "parseShopScene": null, "parseTeamScene": "ABCDEF", "rcPath": null, "cap1047": "tm.ABCDEF", "cap1011": "P"},
  {"c": "tm.23456Z", "parseDoorScene": null, "parseTopicScene": null, "parseActivityScene": null, "parseShopScene": null, "parseTeamScene": "23456Z", "rcPath": null, "cap1047": "tm.23456Z", "cap1011": "P"},
  {"c": "tm.AAAAAAAAAAAAAAAAAAAAAA", "parseDoorScene": null, "parseTopicScene": null, "parseActivityScene": null, "parseShopScene": null, "parseTeamScene": "AAAAAAAAAAAAAAAAAAAAAA", "rcPath": null, "cap1047": "tm.AAAAAAAAAAAAAAAAAAAAAA", "cap1011": "P"},
  {"c": "th.AAAAAAAAAAAAAAAAAAAAAA", "parseDoorScene": null, "parseTopicScene": null, "parseActivityScene": null, "parseShopScene": null, "parseTeamScene": "00000000000000000000000000000000", "rcPath": null, "cap1047": "th.AAAAAAAAAAAAAAAAAAAAAA", "cap1011": "P"},
  {"c": "th.____________________AA", "parseDoorScene": null, "parseTopicScene": null, "parseActivityScene": null, "parseShopScene": null, "parseTeamScene": "ffffffffffffffffffffffffffffff00", "rcPath": null, "cap1047": "th.____________________AA", "cap1011": "P"},
  {"c": "rc.1.2", "parseDoorScene": null, "parseTopicScene": null, "parseActivityScene": null, "parseShopScene": null, "parseTeamScene": null, "rcPath": "/pages/topic/merchantinfo/merchantinfo?id=1&chapterId=2", "cap1047": "rc.1.2", "cap1011": "P"},
  {"c": "rc.0.2", "parseDoorScene": null, "parseTopicScene": null, "parseActivityScene": null, "parseShopScene": null, "parseTeamScene": null, "rcPath": null, "cap1047": "P", "cap1011": "P"},
  {"c": "rc.12.34", "parseDoorScene": null, "parseTopicScene": null, "parseActivityScene": null, "parseShopScene": null, "parseTeamScene": null, "rcPath": "/pages/topic/merchantinfo/merchantinfo?id=12&chapterId=34", "cap1047": "rc.12.34", "cap1011": "P"},
  {"c": "%25", "parseDoorScene": null, "parseTopicScene": null, "parseActivityScene": null, "parseShopScene": null, "parseTeamScene": null, "rcPath": null, "cap1047": "P", "cap1011": "P"},
  {"c": "%E4%B8", "parseDoorScene": null, "parseTopicScene": null, "parseActivityScene": null, "parseShopScene": null, "parseTeamScene": null, "rcPath": null, "cap1047": "P", "cap1011": "P"},
  {"c": "xx.1", "parseDoorScene": null, "parseTopicScene": null, "parseActivityScene": null, "parseShopScene": null, "parseTeamScene": null, "rcPath": null, "cap1047": "P", "cap1011": "P"},
  {"c": "tp.", "parseDoorScene": null, "parseTopicScene": null, "parseActivityScene": null, "parseShopScene": null, "parseTeamScene": null, "rcPath": null, "cap1047": "P", "cap1011": "P"},
  {"c": "  ", "parseDoorScene": null, "parseTopicScene": null, "parseActivityScene": null, "parseShopScene": null, "parseTeamScene": null, "rcPath": null, "cap1047": "P", "cap1011": "P"},
  ];
  const fns = ['parseDoorScene', 'parseTopicScene', 'parseActivityScene', 'parseShopScene', 'parseTeamScene', 'rcPath'];
  for (const row of CASES) {
    for (const f of fns) assert.equal(g[f](row.c), row[f], f + ' ' + JSON.stringify(row.c));
    assert.equal(g.captureDoorScene({ scene: 1047, query: { scene: row.c } }, 'P'), row.cap1047, 'capture 1047 ' + JSON.stringify(row.c));
    assert.equal(g.captureDoorScene({ scene: 1011, query: { scene: row.c } }, 'P'), row.cap1011, 'capture 1011 ' + JSON.stringify(row.c));
  }
});

test('L10-097:官方招商截止时间 ISO 带偏移也能解析(iOS 不再露原始串),按中国日历出日', () => {
  const { decorateInvite } = require('../../utils/merchant-official-channel.js');
  assert.equal(decorateInvite({ expireTime: '2026-09-24T23:30:00+08:00' }).deadline, '截止 9月24日');
  assert.equal(decorateInvite({ expireTime: '2026-09-24T16:30:00Z' }).deadline, '截止 9月25日');
  assert.equal(decorateInvite({ expireTime: '2026-09-24 10:00:00' }).deadline, '截止 9月24日');
  assert.equal(decorateInvite({}).deadline, '截止时间待官方确认');
});

test('L10-089:mapFontSize 不传倍率时一轮重建只读一次系统字号', () => {
  let reads = 0;
  const prev = global.wx;
  global.wx = { getAppBaseInfo: () => { reads += 1; return { fontSizeSetting: 20 }; } };
  try {
    delete require.cache[require.resolve('../../utils/font-scale.js')];
    const fs2 = require('../../utils/font-scale.js');
    const sizes = Array.from({ length: 30 }, () => fs2.mapFontSize(11));
    assert.equal(reads, 1);
    assert.ok(sizes.every((v) => v === sizes[0]));
    assert.equal(fs2.mapFontSize(11, 1), 11, '显式倍率不读系统');
    assert.equal(reads, 1);
  } finally { global.wx = prev; }
});

test('L10-024:编辑精选 swiper 拖动帧在同一进度档内不重发样式', () => {
  const def = load('pages/index/index.js', { wx: { getStorageSync: () => '', getWindowInfo: () => ({ windowWidth: 375 }), getSystemInfoSync: () => ({}) } });
  const sets = [];
  const page = Object.assign({}, def, { data: { recoCards: [1, 2, 3], recoCurrent: 0, reducedMotion: false }, _recoSnapPx: 300,
    setData(v) { sets.push(v); Object.assign(this.data, v); } });
  page.onRecoTransition({ detail: { dx: -100 } });
  page.onRecoTransition({ detail: { dx: -101 } });
  page.onRecoTransition({ detail: { dx: -102 } });
  assert.equal(sets.length, 1, '1px 级的帧落在同一档 ⇒ 只发一次');
  page.onRecoTransition({ detail: { dx: -150 } });
  assert.equal(sets.length, 2);
  assert.equal(page.data.recoCardStyles.length, 3);
});

test('L10-172:骨架挂载只发一次 setData,count 已给过 items 不重算', () => {
  const def = load('components/cy/skeleton/index.js', { wx: { getStorageSync: () => '' } });
  const sets = [];
  const comp = { data: Object.assign({ count: 3, delay: 0 }, JSON.parse(JSON.stringify(def.data))), setData(v) { sets.push(Object.keys(v).sort()); Object.assign(this.data, v); } };
  def.observers.count.call(comp, 3);
  sets.length = 0;
  def.lifetimes.attached.call(comp);
  assert.deepEqual(sets, [['light', 'ready']]);
  assert.equal(comp.data.items.length, 3);
});
