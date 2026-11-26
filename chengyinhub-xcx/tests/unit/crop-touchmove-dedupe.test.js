'use strict';
// L10-046:裁剪拖动的位移和缩放留在实例上。
// 视图只在位置或缩放真有变化时写入,大约每秒最多十次;顶到边界后不再写;松手落到最终位置。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const FILE = path.resolve(__dirname, '../../pages/crop/index.js');

function loadCrop(clock) {
  let def;
  const timers = [];
  let seq = 1;
  vm.runInNewContext(fs.readFileSync(FILE, 'utf8'), {
    Page: (v) => { def = v; },
    getApp: () => ({ globalData: {} }),
    wx: { getStorageSync: () => '', getWindowInfo: () => ({ windowWidth: 375, windowHeight: 667 }) },
    require: createRequire(FILE),
    console,
    Date: { now: () => clock.now },
    setTimeout(fn, ms) {
      const id = seq++;
      timers.push({ id, fn, at: clock.now + Number(ms), cleared: false });
      return id;
    },
    clearTimeout(id) {
      const timer = timers.find((item) => item.id === id);
      if (timer) timer.cleared = true;
    },
  }, { filename: FILE });
  const page = Object.assign({}, def, {
    data: Object.assign(JSON.parse(JSON.stringify(def.data)), {
      ready: true, frameW: 200, frameH: 200, tx: 0, ty: 0, scale: 1,
    }),
    setData(v) { Object.assign(this.data, v); },
  });
  page.natural = { w: 1000, h: 1000 };
  function fireDue() {
    let progressed = true;
    while (progressed) {
      progressed = false;
      timers.filter((timer) => !timer.cleared && timer.at <= clock.now).forEach((timer) => {
        timer.cleared = true;
        timer.fn();
        progressed = true;
      });
    }
  }
  return {
    page,
    timers,
    fireDue,
    advance(ms) { clock.now += ms; fireDue(); },
  };
}

test('clamped pan does not re-send identical transforms', () => {
  const { page } = loadCrop({ now: 1000 });
  page.data.frameW = 300;
  page.data.frameH = 300;
  page.natural = { w: 600, h: 600 };
  let writes = 0;
  page.setData = (v) => { writes += 1; Object.assign(page.data, v); };
  const touch = (x, y) => ({ touches: [{ clientX: x, clientY: y }] });
  page.onTouchStart(touch(0, 0));
  page.onTouchMove(touch(5000, 5000));
  const first = writes;
  page.onTouchMove(touch(6000, 6000));
  page.onTouchMove(touch(7000, 7000));
  assert.equal(writes, first, '边界上继续拖不再 setData');
});

test('拖动把位移留在实例上，视图大约每秒最多写十次，松手落到最终位置', () => {
  const clock = { now: 1000 };
  const { page, advance } = loadCrop(clock);
  page.data.scale = 2;
  const writes = [];
  page.setData = (v) => {
    writes.push({ tx: v.tx, ty: v.ty, scale: v.scale, at: clock.now });
    Object.assign(page.data, v);
  };
  const touch = (x, y) => ({ touches: [{ clientX: x, clientY: y }] });
  page.onTouchStart(touch(0, 0));
  const moves = 20;
  for (let i = 1; i <= moves; i += 1) {
    advance(16);
    page.onTouchMove(touch(i * 4, 0));
  }
  assert.equal(page.gesture.mode, 'pan');
  assert.equal(page.pose.tx, 80);
  assert.equal(page.pose.ty, 0);
  assert.equal(page.pose.scale, 2);
  assert.ok(writes.length < moves, '不能每个 touchmove 都 setData');
  assert.ok(writes.length <= 5, '大约 320ms 内最多约每秒十次');
  assert.ok(writes.length >= 2, '拖动过程中位置变了仍要写视图');
  writes.forEach((write, index) => {
    if (index === 0) return;
    assert.ok(write.at - writes[index - 1].at >= 100, '两次视图写入至少间隔约 100ms');
  });
  const painted = page.data.tx;
  assert.ok(painted < page.pose.tx, '节流窗口里的最后一帧先留在实例上');
  page.onTouchEnd({ touches: [] });
  assert.equal(page.gesture, null);
  assert.equal(page.data.tx, 80);
  assert.equal(page.data.ty, 0);
  assert.equal(page.data.scale, 2);
});

test('已经顶到边界后继续拖，过了节流时间也不再 setData', () => {
  const clock = { now: 2000 };
  const { page, advance } = loadCrop(clock);
  page.data.scale = 2;
  let writes = 0;
  page.setData = (v) => { writes += 1; Object.assign(page.data, v); };
  const touch = (x, y) => ({ touches: [{ clientX: x, clientY: y }] });
  page.onTouchStart(touch(0, 0));
  page.onTouchMove(touch(1000, 0));
  assert.equal(page.pose.tx, 100);
  const first = writes;
  assert.equal(first, 1);
  advance(500);
  page.onTouchMove(touch(2000, 0));
  advance(500);
  page.onTouchMove(touch(3000, 0));
  advance(500);
  assert.equal(writes, first, '边界上继续拖不再 setData');
  page.onTouchEnd({ touches: [] });
  assert.equal(page.data.tx, 100);
  assert.equal(writes, first, '松手时位置没变不再写一次');
});

test('松手时把还没写进视图的最后一帧落到 data', () => {
  const { page } = loadCrop({ now: 5000 });
  page.data.scale = 2;
  const touch = (x, y) => ({ touches: [{ clientX: x, clientY: y }] });
  page.onTouchStart(touch(0, 0));
  page.onTouchMove(touch(10, 0));
  page.onTouchMove(touch(40, 6));
  assert.equal(page.data.tx, 10);
  assert.equal(page.pose.tx, 40);
  assert.equal(page.pose.ty, 6);
  page.onTouchEnd({ touches: [] });
  assert.equal(page.data.tx, 40);
  assert.equal(page.data.ty, 6);
  assert.equal(page.data.scale, 2);
});

test('双指缩放同样留在实例上，松手落到最终缩放', () => {
  const clock = { now: 8000 };
  const { page, advance } = loadCrop(clock);
  const writes = [];
  page.setData = (v) => { writes.push(v.scale); Object.assign(page.data, v); };
  const pinch = (span) => ({ touches: [{ clientX: 0, clientY: 0 }, { clientX: span, clientY: 0 }] });
  page.onTouchStart(pinch(100));
  for (let i = 1; i <= 8; i += 1) {
    advance(1);
    page.onTouchMove(pinch(100 + i * 20));
  }
  assert.equal(writes.length, 1);
  assert.equal(page.data.scale, 1.2);
  assert.equal(page.pose.scale, 2.6);
  page.onTouchEnd({ touches: [] });
  assert.equal(page.data.scale, 2.6);
  assert.equal(page.data.tx, 0);
  assert.equal(page.data.ty, 0);
});

test('缩放已经顶到上限后继续张指不再 setData', () => {
  const clock = { now: 9000 };
  const { page, advance } = loadCrop(clock);
  let writes = 0;
  page.setData = (v) => { writes += 1; Object.assign(page.data, v); };
  const pinch = (span) => ({ touches: [{ clientX: 0, clientY: 0 }, { clientX: span, clientY: 0 }] });
  page.onTouchStart(pinch(100));
  page.onTouchMove(pinch(800));
  assert.equal(page.pose.scale, 4);
  const first = writes;
  advance(500);
  page.onTouchMove(pinch(1200));
  advance(500);
  page.onTouchMove(pinch(1600));
  assert.equal(writes, first);
  page.onTouchEnd({ touches: [] });
  assert.equal(page.data.scale, 4);
  assert.equal(writes, first);
});

test('离开页面后未到期的拖动回写不再 setData', () => {
  const clock = { now: 10000 };
  const { page, timers, advance } = loadCrop(clock);
  page.data.scale = 2;
  let writes = 0;
  page.setData = (v) => { writes += 1; Object.assign(page.data, v); };
  const touch = (x, y) => ({ touches: [{ clientX: x, clientY: y }] });
  page.onTouchStart(touch(0, 0));
  page.onTouchMove(touch(10, 0));
  page.onTouchMove(touch(30, 0));
  const pending = timers.find((timer) => !timer.cleared);
  assert.ok(pending, '节流窗口里应挂着一次回写');
  const before = writes;
  page.onUnload();
  assert.equal(pending.cleared, true);
  page.setData = () => { writes += 1; };
  pending.fn();
  advance(500);
  assert.equal(writes, before);
});
