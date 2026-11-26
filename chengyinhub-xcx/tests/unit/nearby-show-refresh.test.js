'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

// L05-115 / L05-116 / L05-121 / L05-124:附近页回前台与拖图的读取次数。
function mount() {
  const file = path.resolve(__dirname, '../../subpackageRoam/nearby/index.js');
  let def;
  const app = { globalData: { authorization: 'a' }, getUserID: () => 7, sendRequest() {} };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { getApp: () => app, Page: d => { def = d; }, require: createRequire(file), wx: {}, setTimeout, clearTimeout });
  const page = Object.assign({}, def, { data: JSON.parse(JSON.stringify(def.data)), setData(d) { Object.assign(this.data, d); } });
  const calls = { refresh: 0, my: 0 };
  page.refresh = () => { calls.refresh += 1; };
  page.loadMyTeams = () => { calls.my += 1; page._myReadOwner = page._myIdentity(); };
  page.reloadTeamCommands = () => {};
  page._syncMapKindPref = () => {};
  return { page, calls };
}

test('首个 onShow 不重读;看大图回来不重读;离开去别页回来重读', () => {
  const { page, calls } = mount();
  page._myReadOwner = page._myIdentity();
  page.data.listLoaded = true; page._myLoaded = true;
  page.onShow();
  assert.deepEqual(calls, { refresh: 0, my: 0 }, '紧跟 onLoad 的首个 onShow 不重复读');
  page.onHide(); page.onShow();
  assert.deepEqual(calls, { refresh: 0, my: 0 }, '系统界面(看大图/导航)回来不重读');
  page._refreshOnShow = true;
  page.onHide(); page.onShow();
  assert.deepEqual(calls, { refresh: 1, my: 1 }, '从别页回来重读');
  page._hiddenAt = Date.now() - 61000; page._hidden = true;
  page.onShow();
  assert.deepEqual(calls, { refresh: 2, my: 2 }, '隐藏超过 60 s 重读');
});

test('拖图:挪动不到查询半径 1/4 且没缩放不重拉;隐藏时清掉防抖', () => {
  const { page } = mount();
  page._lodCenter = { lat: 31.2, lng: 121.4 }; page._lodRadius = 1000; page._scale = 15;
  page.onRegionChange({ detail: { phase: 'end', causedBy: 'drag', scale: 15, centerLocation: { latitude: 31.2005, longitude: 121.4 } } });
  assert.equal(page._regionTimer, undefined);
  page.onRegionChange({ detail: { phase: 'end', causedBy: 'scale', scale: 16, centerLocation: { latitude: 31.2005, longitude: 121.4 } } });
  assert.ok(page._regionTimer);
  assert.equal(page._scale, 16, '记下新缩放');
  page.onHide();
  assert.equal(page._regionTimer, null);
});

// L05-134 / L05-135:我的队伍回前台只在必要时重读;连点进队伍页只推一层。
function mountMyTeams() {
  const file = path.resolve(__dirname, '../../subpackageRoam/my-teams/index.js');
  let def;
  const navs = [];
  const app = { globalData: { authorization: 'a' }, getUserID: () => 7, sendRequest() {}, ensureLoginFor: () => true };
  const wx = { navigateTo: o => navs.push(o), getStorageSync: () => '' };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { getApp: () => app, Page: d => { def = d; }, require: createRequire(file), wx, setTimeout, clearTimeout });
  const page = Object.assign({}, def, { data: JSON.parse(JSON.stringify(def.data)), setData(d) { Object.assign(this.data, d); } });
  let reloads = 0;
  page.reload = () => { reloads += 1; };
  page.reloadTeamCommands = () => {};
  return { page, navs, reloads: () => reloads };
}

test('我的队伍:首次读一次,系统界面回来不重读,去过队伍页回来重读', () => {
  const { page, reloads } = mountMyTeams();
  page.onShow();
  assert.equal(reloads(), 1);
  page.onHide(); page.onShow();
  assert.equal(reloads(), 1);
  page._go('/pages/team/detail/index?teamId=1');
  page.onHide(); page.onShow();
  assert.equal(reloads(), 2);
});

test('我的队伍:连点只推一层', () => {
  const { page, navs } = mountMyTeams();
  page._go('/a'); page._go('/a');
  assert.equal(navs.length, 1);
  navs[0].complete();
  page._go('/a');
  assert.equal(navs.length, 2);
});

// L05-147:附近页队长同意/拒绝与卡片主按钮在写请求在途(busy)时不再响应
test('附近页 busy 时 onHandle 与 onCardPrimary 不起第二笔', () => {
  const { page } = mount();
  page.data.busy = true;
  page.data.current = { teamId: 1, card: { primary: { action: 'apply' } } };
  let applied = 0;
  page.apply = () => { applied += 1; };
  page.onCardPrimary();
  page.onHandle({ currentTarget: { dataset: { id: 5, act: 'approve' } } });
  assert.equal(applied, 0);
});

// L05-148:官方路线列表与漫游记录页连点只推一层
for (const rel of ['subpackageRoam/official-routes/index.js', 'subpackageRoam/history/index.js']) {
  test(rel + ' 连点只推一层', () => {
    const file = path.resolve(__dirname, '../../', rel);
    let def;
    const navs = [];
    const app = { globalData: {}, getUserID: () => 7, sendRequest() {} };
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), { getApp: () => app, Page: d => { def = d; }, require: createRequire(file), wx: { navigateTo: o => navs.push(o) }, getCurrentPages: () => [] });
    const page = Object.assign({}, def, { data: JSON.parse(JSON.stringify(def.data || {})), setData(d) { Object.assign(this.data, d); } });
    const tap = () => rel.includes('official') ? page.openRoute({ currentTarget: { dataset: { id: 9 } } }) : page.openSession({ detail: { params: { ts: '1' } } });
    tap(); tap();
    assert.equal(navs.length, 1);
    navs[0].complete();
    tap();
    assert.equal(navs.length, 2);
  });
}

// L05-150:没有旧的恢复实例时重挂不再多写一次空面板
test('队伍命令恢复:隐藏后重挂不重复写空数据', () => {
  const R = require('../../subpackageRoam/utils/roam-team-recovery.js');
  const writes = [];
  const host = { setData(p) { writes.push(p); }, _hidden: false, _unloaded: false };
  const app = { getUserID: () => '', getAuthorization: () => '', globalData: {} };
  R.mount(host, app, { getStorageInfoSync: () => ({ keys: [] }) });
  assert.equal(writes.length, 0);
  R.dispose(host);
  assert.equal(writes.length, 1);
});

// L05-118:队伍一定有 v13 点位图,_genTeamIcons 不再先下载头像、画圆头像,只补远距点兜底
test('队伍图标生成只画远距点,不再为有 teamId 的队伍下载头像', async () => {
  const { page } = mount();
  page._icons = {}; page._far = {}; page._iconFailed = {};
  page._teams = [{ teamId: 7, leaderAvatar: '/a.jpg' }, { teamId: 8, leaderAvatar: '/b.jpg' }];
  let loads = 0, saves = 0;
  page._canvas = async () => ({ getContext: () => ({ beginPath() {}, arc() {}, fill() {}, stroke() {}, clearRect() {}, save() {}, restore() {}, fillRect() {} }) });
  page._loadImage = async () => { loads += 1; return {}; };
  page._save = async () => { saves += 1; return 'tmp://far'; };
  assert.equal(await page._genTeamIcons(), true);
  assert.equal(loads, 0);
  assert.equal(saves, 1);
  assert.equal(Object.keys(page._icons).length, 0);
  assert.equal(await page._genTeamIcons(), false, '远距点已有、队伍都由点位图覆盖:不再开画布');
});

// L05-119:_syncMarkers 一次刷新调 6-8 次;没变的那组不再整包 setData,开合点位卡只发 markers
test('_syncMarkers 只发变化的那组:无变化不写,开合点位卡只写 markers', () => {
  const { page } = mount();
  page._wantPins = () => {};
  page._icons = {}; page._far = {}; page._pins = {}; page._teams = []; page._items = []; page._me = null;
  page._nearbyTeamsLoaded = true; page._nearbyTopicsLoaded = true;
  page._pois = [{ id: 10, type: 1, name: 'Museum', lat: 31.2, lng: 121.4 }];
  page.data.center = { lat: 31.2, lng: 121.4 };
  const writes = [];
  const setData = page.setData; page.setData = function (d) { writes.push(Object.keys(d).sort().join()); setData.call(this, d); };
  page._syncMarkers();
  assert.deepEqual(writes, ['headerText,listLoaded,listRows,markers']);
  page._syncMarkers();
  assert.equal(writes.length, 1, '同样的数据再调一次不过桥');
  const id = page.data.markers[0] && page.data.markers[0].id;
  assert.ok(id != null);
  page._openPin = id; page._syncMarkers();
  assert.equal(writes.at(-1), 'markers');
  assert.equal(page.data.markers.some((m) => m.id === id), false);
  page._openPin = null; page._syncMarkers();
  assert.equal(writes.at(-1), 'markers');
  assert.equal(writes.length, 3);
});
