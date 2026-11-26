'use strict';

// screen 主路径失败必须显式全黑并可重试，不能回到会浮出腾讯文字的 map 内雾。
// 旧 overlay/poly helper 仍须 fail-closed 为有雾，不能静默清空。

const assert = require('assert');
const test = require('node:test');

let pageConfig;
global.getApp = () => ({
  globalData: { user_id: 9, features: {} },
  isDevEnv: () => false,
  sendRequest() {},
});
global.wx = {
  getStorageSync: () => '',
  setStorageSync() {},
  getWindowInfo: () => ({ statusBarHeight: 20 }),
  getSystemInfoSync: () => ({ statusBarHeight: 20 }),
  createSelectorQuery: () => ({
    select: () => ({ fields: () => ({ exec: (cb) => cb([{ node: null }]) }) }),
  }),
};
global.Page = (config) => { pageConfig = config; };

function loadRoamPage() {
  delete require.cache[require.resolve('../../pages/roam/index.js')];
  require('../../pages/roam/index.js');
  const page = Object.assign({}, pageConfig, {
    data: JSON.parse(JSON.stringify(pageConfig.data)),
  });
  page.setData = (patch, cb) => { Object.assign(page.data, patch); if (cb) cb(); };
  page._c = { lat: 31.23, lng: 121.47 };
  page._reveals = [];
  page._historyReveals = [];
  return page;
}

function makeFogContext() {
  const calls = { arcs: [], fills: 0, gradients: 0 };
  const context = {
    createRadialGradient() {
      calls.gradients++;
      return { addColorStop() {} };
    },
    beginPath() {},
    arc(x, y, radius) { calls.arcs.push({ x, y, radius }); },
    fill() { calls.fills++; },
  };
  return { calls, context };
}

function radialContourError(fog, radiusM) {
  const { CELL, HALF, N, st } = fog;
  const lo = Math.max(0, Math.floor((HALF - radiusM - CELL * 2) / CELL));
  const hi = Math.min(N - 2, Math.ceil((HALF + radiusM + CELL * 2) / CELL));
  let maxErrorM = 0;
  let edgeCount = 0;
  for (let j = lo; j <= hi; j++) {
    for (let i = lo; i <= hi; i++) {
      const k = j * N + i;
      const clear = st[k] === 0;
      if (clear !== (st[k + 1] === 0)) {
        const x = (i + 1) * CELL - HALF;
        [j * CELL - HALF, (j + 1) * CELL - HALF].forEach((y) => {
          maxErrorM = Math.max(maxErrorM, Math.abs(Math.hypot(x, y) - radiusM));
        });
        edgeCount++;
      }
      if (clear !== (st[k + N] === 0)) {
        const y = (j + 1) * CELL - HALF;
        [i * CELL - HALF, (i + 1) * CELL - HALF].forEach((x) => {
          maxErrorM = Math.max(maxErrorM, Math.abs(Math.hypot(x, y) - radiusM));
        });
        edgeCount++;
      }
    }
  }
  assert.ok(edgeCount > 0, '必须找到已探索区与雾区的边界');
  return maxErrorM;
}

function offsetPoint(center, eastM, northM) {
  return {
    lat: center.lat + northM / 111320,
    lng: center.lng + eastM / (111320 * Math.cos(center.lat * Math.PI / 180)),
  };
}

test('screen canvas 不可用时显式阻断并可重试，不在背后白画 poly', async () => {
  const page = loadRoamPage();
  const ready = await page._setupFog();
  assert.strictEqual(ready, false);
  assert.strictEqual(page._fogMode, 'blocked');
  assert.strictEqual(page.data.fogScreenGuard, true, 'screen 不可用时必须以全黑层遮住原生文字');
  assert.strictEqual(page.data.fogScreenError, undefined, '读取失败留白，fail-closed guard仍保留');
});

test('页面销毁后在途 getRegion 回调不能继续绘制或 setData', () => {
  const page = loadRoamPage();
  let regionSuccess;
  let draws = 0;
  page._fogLifecycleGen = 7;
  page._fogMode = 'screen';
  page._fogScreenG = {};
  page._fogScreenSize = { width: 400, height: 800 };
  page._mapCtx = { getRegion({ success }) { regionSuccess = success; } };
  page._drawScreenFog = () => { draws++; };

  page._renderScreenFog();
  assert.strictEqual(typeof regionSuccess, 'function', '应先留下一个真实在途地图回调');
  page._disposeFogRenderer();
  regionSuccess({
    southwest: { latitude: 31.22, longitude: 121.46 },
    northeast: { latitude: 31.24, longitude: 121.48 },
  });

  assert.strictEqual(draws, 0, '旧页面世代的 region 回调必须失效');
});

test('canvas setup 在页面销毁后到货也不能复活旧 renderer', async () => {
  const page = loadRoamPage();
  let selectorResult;
  const originalQuery = wx.createSelectorQuery;
  wx.createSelectorQuery = () => ({
    select: () => ({ fields: () => ({ exec(cb) { selectorResult = cb; } }) }),
  });
  try {
    page._fogLifecycleGen = 11;
    const setup = page._setupFog(11);
    page._disposeFogRenderer();
    selectorResult([{ node: { getContext: () => ({ scale() {} }) }, width: 400, height: 800 }]);
    assert.strictEqual(await setup, false, '销毁必须结清旧 setup Promise');
    assert.strictEqual(page._fogMode, null, '迟到 canvas 不能复活 screen 模式');
    assert.strictEqual(page._fogScreenG, null, '迟到 canvas 不能重新挂回绘图上下文');
  } finally {
    wx.createSelectorQuery = originalQuery;
  }
});

test('当前 screen image 解码失败时保持全黑，不回退到会浮字的 map polygon', () => {
  const page = loadRoamPage();
  page._fogLifecycleGen = 3;
  page._fogScreenVersion = 8;
  page._fogMode = 'screen';
  page.data.fogScreenLayers = [{ generation: 3, version: 8, src: '/tmp/fog-8.png', loaded: false }];
  page.data.fogScreenGuard = false;

  page.onFogScreenError({
    currentTarget: { dataset: { generation: 3, version: 8 } },
    detail: { errMsg: 'decode failed' },
  });

  assert.strictEqual(page._fogMode, 'screen', 'image 失败不能退回 map 内 poly');
  assert.strictEqual(page.data.fogScreenGuard, true, 'image 失败必须立刻全黑 fail-closed');
  assert.strictEqual(page.data.fogScreenError, undefined, '图层读取失败不显示错误提示');
});

test('全黑等待或失败态直接拦住原生 POI，不允许盲点到店', () => {
  const page = loadRoamPage();
  const originalGetApp = global.getApp;
  let requests = 0;
  global.getApp = () => ({ globalData: { user_id: 9, features: {} }, sendRequest() { requests++; } });
  page.data.fogScreenGuard = true;
  page._fogMode = 'poly';
  try {
    page.onPoiTap({ detail: { name: '黑雾下的店', latitude: 31.23, longitude: 121.47 } });
    assert.strictEqual(requests, 0, '全黑 guard 下的原生 POI 事件必须在请求前终止');
  } finally {
    global.getApp = originalGetApp;
  }
});

// 2026-10-29 V-07 业主:拖动地图「一闪一闪、时不时黑一下」。手势期间不再拉全屏黑层,
// 旧帧留在屏上;只作废在途的旧视口 region 请求,松手立刻重画,新帧 load 后替换。
test('地图手势拖动不拉全黑层，只作废在途重绘，松手立即重画', () => {
  const page = loadRoamPage();
  page._fogLifecycleGen = 4;
  page._fogMode = 'screen';
  page._fogScreenVersion = 12;
  page._fogScreenRegionSeq = 3;
  page.data.fogScreenGuard = false;
  page.data.fogScreenLayers = [{ generation: 4, version: 12, src: '/tmp/fog-12.png', loaded: true }];
  const delays = [];
  page._scheduleScreenFogRender = (delay) => { delays.push(delay); };

  page.onRegionChange({ detail: { phase: 'begin', causedBy: 'drag' } });
  assert.strictEqual(page.data.fogScreenGuard, false, '拖拽开始不能盖全黑层');
  assert.strictEqual(page._fogScreenRegionSeq, 4, '拖拽开始必须作废在途的旧视口 region');
  assert.strictEqual(page.data.fogScreenLayers.length, 1, '旧帧必须继续留在屏上');

  page.onRegionChange({ detail: { phase: 'end', causedBy: 'drag', scale: 17 } });
  assert.deepStrictEqual(delays, [0], '拖拽结束必须立即安排当前视野的新遮罩');
  assert.strictEqual(page.data.fogScreenGuard, false, '新 image load 前也不黑屏，旧帧顶着');
});

test('首张当前世代 image load 前不启动计时或持续定位', () => {
  const page = loadRoamPage();
  page._fogLifecycleGen = 6;
  page._fogMode = 'screen';
  page._fogScreenG = {};
  page._fogStartPending = { p: page._c, startTracking: true, generation: 6,
    locationRevision: require('../../utils/location/bg-tracker.js').revision('roam') };
  page._addReveal = () => {};
  let clocks = 0;
  let locations = 0;
  page._startClock = () => { clocks++; };
  page._startReal = () => { locations++; };

  page._activateRoamAfterFog(page._c, true, 6);
  assert.strictEqual(clocks, 0, 'canvas context 就绪后不能提前计时');
  assert.strictEqual(locations, 0, 'canvas context 就绪后不能提前持续定位');

  page.data.fogScreenReady = true;
  page._completeRoamAfterFogLoad(6);
  assert.strictEqual(clocks, 1, '首张 image load 后应启动一次计时');
  assert.strictEqual(locations, 1, '首张 image load 后应启动一次持续定位');
  page._completeRoamAfterFogLoad(6);
  assert.strictEqual(clocks, 1, '重复 load 不得重复启动计时');
  assert.strictEqual(locations, 1, '重复 load 不得重复启动持续定位');
});

test('缺用途授权世代的旧fog pending不能开启持续定位', () => {
  const page = loadRoamPage();
  page._fogLifecycleGen = 6;
  page._fogMode = 'screen';
  page._fogStartPending = { p: page._c, startTracking: true, generation: 6 };
  page._startClock = () => {};
  let locations = 0;
  page._startReal = () => { locations++; };
  page.data.fogScreenReady = true;
  page._completeRoamAfterFogLoad(6);
  assert.strictEqual(locations, 0, '未知授权的旧pending只读地图，不能补授定位许可');
});

