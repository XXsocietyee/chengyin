'use strict';
// L10-046:裁剪拖动顶到边界后值不变,不再重复 setData。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

test('clamped pan does not re-send identical transforms', () => {
  let def;
  const file = path.resolve(__dirname, '../../pages/crop/index.js');
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { Page: (v) => { def = v; }, getApp: () => ({ globalData: {} }),
    wx: { getStorageSync: () => '', getWindowInfo: () => ({ windowWidth: 375, windowHeight: 667 }) },
    require: createRequire(file), console, setTimeout, clearTimeout }, { filename: file });
  let writes = 0;
  const page = Object.assign({}, def, { data: Object.assign(JSON.parse(JSON.stringify(def.data)), { ready: true, frameW: 300, frameH: 300, tx: 0, ty: 0, scale: 1 }),
    setData(v) { writes += 1; Object.assign(this.data, v); } });
  page.natural = { w: 600, h: 600 };
  const touch = (x, y) => ({ touches: [{ clientX: x, clientY: y }] });
  page.onTouchStart(touch(0, 0));
  page.onTouchMove(touch(5000, 5000));
  const first = writes;
  page.onTouchMove(touch(6000, 6000));
  page.onTouchMove(touch(7000, 7000));
  assert.equal(writes, first, '边界上继续拖不再 setData');
});
