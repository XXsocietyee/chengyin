'use strict';
// L10-046:裁剪拖动在渲染层跟手。touchmove 只 setStyle,不 setData tx/ty/scale。
// 手指都离开才把最终位置交回逻辑层。已经顶到边界、画面不再动时不再写。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const { baseScaleOf, clampTransform } = require('../../pages/crop/utils/crop-geometry');

const DIR = path.resolve(__dirname, '../../pages/crop');
const FILE = path.join(DIR, 'index.js');
const WXS = path.join(DIR, 'crop-gesture.wxs');

function loadWxs() {
  const mod = { exports: {} };
  new Function('module', fs.readFileSync(WXS, 'utf8'))(mod);
  return mod.exports;
}

function owner() {
  const state = {};
  const styles = [];
  const calls = [];
  return {
    styles,
    calls,
    getState: () => state,
    selectComponent: (sel) => (sel === '.crop__img' ? { setStyle: (s) => styles.push(Object.assign({}, s)) } : null),
    callMethod: (name, arg) => calls.push([name, arg]),
  };
}

function touch(points, ds) {
  const list = !points || points.length === 0 ? [] : (Array.isArray(points[0]) ? points : [points]);
  return {
    touches: list.map((p) => ({ clientX: p[0], clientY: p[1] })),
    currentTarget: { dataset: ds },
  };
}

function arm(cg, o, stamp, ds) {
  cg.syncPose(stamp, '', o);
  o.styles.length = 0;
  o.calls.length = 0;
  return ds;
}

function loadCrop() {
  let def;
  vm.runInNewContext(fs.readFileSync(FILE, 'utf8'), {
    Page: (v) => { def = v; },
    getApp: () => ({ globalData: {} }),
    wx: { getStorageSync: () => '', getWindowInfo: () => ({ windowWidth: 375, windowHeight: 667 }) },
    require: createRequire(FILE),
    console,
    setTimeout() { return 0; },
    clearTimeout() {},
  }, { filename: FILE });
  const page = Object.assign({}, def, {
    data: Object.assign(JSON.parse(JSON.stringify(def.data)), {
      ready: true, frameW: 200, frameH: 200, imgW: 200, imgH: 200, tx: 0, ty: 0, scale: 1,
    }),
    setData(v) { Object.assign(this.data, v); },
  });
  page.natural = { w: 1000, h: 1000 };
  return page;
}

test('夹边界与逻辑层 clampTransform 逐值一致', () => {
  const cg = loadWxs();
  const cases = [
    [1000, 1000, 300, 300, 0.5, 0, 0],
    [1000, 1000, 300, 300, 99, 0, 0],
    [1000, 1000, 300, 300, 1, 50, -80],
    [1000, 2000, 300, 300, 1, 40, 400],
    [1000, 2000, 300, 300, 2, 999, -999],
    [600, 600, 300, 300, 1, 5000, 5000],
    [1000, 1000, 200, 200, 2, 80, 6],
    [1000, 1000, 200, 200, 2.6, 0, 0],
    [1000, 1000, 200, 200, 8, 30, -30],
  ];
  for (const [natW, natH, fw, fh, scale, x, y] of cases) {
    const base = baseScaleOf(natW, natH, fw, fh);
    const js = clampTransform({ imgW: natW, imgH: natH, frameW: fw, frameH: fh, scale, x, y });
    const w = cg.clampPose(scale, x, y, fw, fh, natW * base, natH * base);
    assert.equal(w.scale, js.scale, `scale ${scale}`);
    assert.equal(w.tx, js.x, `tx ${x}`);
    assert.equal(w.ty, js.y, `ty ${y}`);
  }
});

test('拖动只改渲染层样式，不 setData；松手才提交最终位置', () => {
  const cg = loadWxs();
  const o = owner();
  const page = loadCrop();
  page.data.scale = 2;
  const writes = [];
  page.setData = (v) => { writes.push(v); Object.assign(page.data, v); };
  o.callMethod = (name, arg) => {
    o.calls.push([name, arg]);
    if (name === 'onCropPoseCommit') page.onCropPoseCommit(arg);
  };
  const ds = arm(cg, o, '0,0,2,200,200,200,200', { ready: true });
  cg.start(touch([0, 0], ds), o);
  for (let i = 1; i <= 20; i += 1) cg.move(touch([i * 4, 0], ds), o);
  assert.equal(o.calls.length, 0, 'touchmove 不能 callMethod');
  assert.equal(writes.length, 0, 'touchmove 不能 setData');
  assert.equal(o.styles.length, 20);
  assert.equal(o.styles.at(-1).transform, 'translate3d(calc(-50% + 80px), calc(-50% + 0px), 0) scale(2)');
  assert.equal(o.styles.at(-1).transition, 'none');
  assert.equal(page.data.tx, 0, '松手前 data 还是手势开始时的位置');
  cg.end(touch([], ds), o);
  assert.equal(o.calls.length, 1);
  assert.deepEqual(o.calls[0], ['onCropPoseCommit', { tx: 80, ty: 0, scale: 2 }]);
  assert.equal(writes.length, 1);
  assert.equal(page.data.tx, 80);
  assert.equal(page.data.ty, 0);
  assert.equal(page.data.scale, 2);
  assert.equal(page.data.poseStamp, '80,0,2,200,200,200,200');
});

test('手指停住或已经顶到边界时不再写样式，松手位置没变也不 setData', () => {
  const cg = loadWxs();
  const o = owner();
  const page = loadCrop();
  page.data.scale = 2;
  let writes = 0;
  page.setData = (v) => { writes += 1; Object.assign(page.data, v); };
  o.callMethod = (name, arg) => {
    o.calls.push([name, arg]);
    if (name === 'onCropPoseCommit') page.onCropPoseCommit(arg);
  };
  const ds = arm(cg, o, '0,0,2,200,200,200,200', { ready: true });
  cg.start(touch([0, 0], ds), o);
  cg.move(touch([40, 0], ds), o);
  const painted = o.styles.length;
  cg.move(touch([40, 0], ds), o);
  cg.move(touch([40, 0], ds), o);
  assert.equal(o.styles.length, painted, '手指不动不再 setStyle');
  cg.move(touch([1000, 0], ds), o);
  assert.equal(o.getState().live.tx, 100);
  const atEdge = o.styles.length;
  cg.move(touch([2000, 0], ds), o);
  cg.move(touch([3000, 0], ds), o);
  assert.equal(o.styles.length, atEdge, '顶住边界后继续拖不再 setStyle');
  assert.equal(writes, 0);
  cg.end(touch([], ds), o);
  assert.equal(writes, 1);
  assert.equal(page.data.tx, 100);
  const committed = writes;
  cg.end(touch([], ds), o);
  cg.start(touch([3000, 0], ds), o);
  cg.move(touch([4000, 0], ds), o);
  cg.move(touch([5000, 0], ds), o);
  cg.end(touch([], ds), o);
  assert.equal(o.styles.length, atEdge, '已经在边界上的新手势不再 setStyle');
  assert.equal(writes, committed, '松手时位置没变不再 setData');
});

test('方图满框时往外拖画面不动，全程不写', () => {
  const cg = loadWxs();
  const o = owner();
  const ds = arm(cg, o, '0,0,1,300,300,300,300', { ready: true });
  cg.start(touch([0, 0], ds), o);
  cg.move(touch([5000, 5000], ds), o);
  cg.move(touch([6000, 6000], ds), o);
  cg.move(touch([7000, 7000], ds), o);
  cg.end(touch([], ds), o);
  assert.deepEqual(o.styles, []);
  assert.deepEqual(o.calls, []);
});

test('双指缩放只在渲染层跟手，松手提交最终缩放；顶到上限后不再写', () => {
  const cg = loadWxs();
  const o = owner();
  const page = loadCrop();
  const writes = [];
  page.setData = (v) => { writes.push(v.scale); Object.assign(page.data, v); };
  o.callMethod = (name, arg) => {
    o.calls.push([name, arg]);
    if (name === 'onCropPoseCommit') page.onCropPoseCommit(arg);
  };
  const ds = arm(cg, o, '0,0,1,200,200,200,200', { ready: true });
  const pinch = (span) => touch([[0, 0], [span, 0]], ds);
  cg.start(pinch(100), o);
  for (let i = 1; i <= 8; i += 1) cg.move(pinch(100 + i * 20), o);
  assert.equal(o.calls.length, 0);
  assert.deepEqual(writes, []);
  assert.equal(o.styles.length, 8);
  assert.equal(o.getState().live.scale, 2.6);
  cg.end({ touches: [], currentTarget: { dataset: ds } }, o);
  assert.deepEqual(writes, [2.6]);
  assert.equal(page.data.scale, 2.6);
  assert.equal(page.data.tx, 0);
  assert.equal(page.data.ty, 0);

  const capped = owner();
  let cappedWrites = 0;
  const cappedPage = loadCrop();
  cappedPage.setData = (v) => { cappedWrites += 1; Object.assign(cappedPage.data, v); };
  capped.callMethod = (name, arg) => {
    capped.calls.push([name, arg]);
    if (name === 'onCropPoseCommit') cappedPage.onCropPoseCommit(arg);
  };
  const ds2 = arm(cg, capped, '0,0,1,200,200,200,200', { ready: true });
  const pinch2 = (span) => touch([[0, 0], [span, 0]], ds2);
  cappedPage.setData = (v) => { cappedWrites += 1; Object.assign(cappedPage.data, v); };
  cg.start(pinch2(100), capped);
  cg.move(pinch2(800), capped);
  assert.equal(capped.getState().live.scale, 4);
  const painted = capped.styles.length;
  cg.move(pinch2(1200), capped);
  cg.move(pinch2(1600), capped);
  assert.equal(capped.styles.length, painted);
  assert.equal(cappedWrites, 0);
  cg.end({ touches: [], currentTarget: { dataset: ds2 } }, capped);
  assert.equal(cappedWrites, 1);
  assert.equal(cappedPage.data.scale, 4);
  cg.end({ touches: [], currentTarget: { dataset: ds2 } }, capped);
  assert.equal(cappedWrites, 1);
});

test('还剩一根手指时不提交，松手才把平移和缩放一起交回', () => {
  const cg = loadWxs();
  const o = owner();
  const ds = arm(cg, o, '0,0,1,200,200,200,200', { ready: true });
  cg.start(touch([[0, 0], [100, 0]], ds), o);
  cg.move(touch([[0, 0], [200, 0]], ds), o);
  cg.end(touch([0, 0], ds), o);
  assert.deepEqual(o.calls, [], '还按着一根手指不能提交');
  cg.move(touch([10, 4], ds), o);
  cg.end(touch([], ds), o);
  assert.deepEqual(o.calls, [['onCropPoseCommit', { tx: 10, ty: 4, scale: 2 }]]);
});

test('图还没准备好时触摸不写；还原动画只在按下时关一次过渡', () => {
  const cg = loadWxs();
  const idle = owner();
  const ds = { ready: false, fw: 200, fh: 200, iw: 200, ih: 200, tx: 0, ty: 0, scale: 1 };
  cg.start(touch([0, 0], ds), idle);
  cg.move(touch([30, 0], ds), idle);
  cg.end(touch([], ds), idle);
  assert.deepEqual(idle.styles, []);
  assert.deepEqual(idle.calls, []);

  const o = owner();
  const settling = arm(cg, o, '0,0,1,200,200,200,200', { ready: true, settling: true });
  cg.start(touch([0, 0], settling), o);
  cg.move(touch([0, 0], settling), o);
  cg.end(touch([], settling), o);
  assert.deepEqual(o.calls.map((call) => call[0]), ['onCropGestureStart']);
  assert.deepEqual(o.styles, []);
});

test('松手回声不抹掉跟手样式；逻辑层换了位置才清掉行内 transform', () => {
  const cg = loadWxs();
  const o = owner();
  const ds = arm(cg, o, '0,0,2,200,200,200,200', { ready: true });
  cg.start(touch([0, 0], ds), o);
  cg.move(touch([40, 6], ds), o);
  cg.end(touch([], ds), o);
  const painted = o.styles.length;
  cg.syncPose('40,6,2,200,200,200,200', '0,0,2,200,200,200,200', o);
  assert.equal(o.styles.length, painted, '提交回声不能把刚跟手的 transform 清掉');
  cg.syncPose('0,0,1,200,200,200,200', '40,6,2,200,200,200,200', o);
  assert.deepEqual(o.styles.at(-1), { transform: '', transition: '' });
  assert.equal(o.getState().live.tx, 0);
  assert.equal(o.getState().g, null);
});

test('逻辑层只在位置真变化时写 data，离开页面后的提交不再 setData', () => {
  const page = loadCrop();
  page.data.scale = 2;
  const writes = [];
  page.setData = (v) => { writes.push(v); Object.assign(page.data, v); };
  page.onCropPoseCommit({ tx: 0, ty: 0, scale: 2 });
  assert.deepEqual(writes, []);
  page.onCropPoseCommit({ tx: 40, ty: 6, scale: 9 });
  assert.equal(writes.length, 1);
  assert.equal(page.data.tx, 40);
  assert.equal(page.data.ty, 6);
  assert.equal(page.data.scale, 4, '超过上限仍按导出同一套约束夹住');
  page.onCropPoseCommit({ tx: 40, ty: 6, scale: 4 });
  assert.equal(writes.length, 1);
  page.data.settling = true;
  page.data.tx = 40;
  page.onCropGestureStart();
  assert.equal(page.data.settling, false);
  assert.equal(page.data.tx, 40);
  assert.equal(writes.length, 2);
  assert.deepEqual(Object.keys(writes[1]), ['settling']);
  assert.equal(writes[1].settling, false);
  page._unloaded = true;
  page.onCropPoseCommit({ tx: 10, ty: 0, scale: 2 });
  page.onCropGestureStart();
  assert.equal(writes.length, 2);
});

test('页面把拖动绑在渲染层，逻辑层没有逐帧 touchmove', () => {
  const js = fs.readFileSync(FILE, 'utf8');
  const wxml = fs.readFileSync(path.join(DIR, 'index.wxml'), 'utf8');
  assert.doesNotMatch(js, /onTouchMove|writePoseView|POSE_VIEW_MS|clearPoseTimer/);
  assert.match(wxml, /<wxs module="cg" src="\.\/crop-gesture\.wxs" \/>/);
  assert.match(wxml, /catchtouchmove="\{\{cg\.move\}\}"/);
  assert.match(wxml, /catchtouchend="\{\{cg\.end\}\}"/);
  assert.match(wxml, /change:pose="\{\{cg\.syncPose\}\}"/);
  assert.doesNotMatch(wxml, /touch(?:start|move|end|cancel)="on/);
  assert.match(fs.readFileSync(WXS, 'utf8'), /callMethod\(\s*'onCropPoseCommit'/);
  assert.match(fs.readFileSync(WXS, 'utf8'), /callMethod\(\s*'onCropGestureStart'/);
});
