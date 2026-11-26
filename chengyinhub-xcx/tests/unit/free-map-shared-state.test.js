'use strict';
// L10-139 / 140 / 141:free-map 图标进程内共用;explore 场景不重算无用 markers;缩放/回中只写内部状态。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const file = path.resolve(__dirname, '../../components/cy/free-map/index.js');
let saves = 0;
const ctx2d = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
const wx = {
  canvasToTempFilePath: (o) => { saves += 1; o.success({ tempFilePath: 'tmp://' + saves }); },
  createMapContext: () => ({}), getStorageSync: () => '', nextTick: (f) => f(),
};
let def;
vm.runInNewContext(fs.readFileSync(file, 'utf8'), { Component: (d) => { def = d; }, Behavior: (b) => b, getApp: () => ({ globalData: {} }),
  wx, console, setTimeout, clearTimeout, Promise, require: createRequire(file) }, { filename: file });

function instance(props) {
  const data = Object.assign({}, JSON.parse(JSON.stringify(def.data)));
  for (const [k, v] of Object.entries(def.properties)) data[k] = v && typeof v === 'object' && 'value' in v ? JSON.parse(JSON.stringify(v.value)) : v;
  Object.assign(data, props);
  const writes = [];
  const c = Object.assign({}, def.methods, { data, setData(p) { writes.push(p); Object.assign(this.data, p); },
    createSelectorQuery: () => ({ select: () => ({ fields: () => ({ exec: (cb) => cb([{ node: { getContext: () => ctx2d } }]) }) }) }),
    triggerEvent() {} });
  return { c, writes };
}

test('第二个地图实例复用已生成的基础图标,不再重画重存', async () => {
  const a = instance({}); await a.c._genIcons();
  const first = saves;
  assert.ok(first >= 8);
  const b = instance({}); await b.c._genIcons();
  assert.equal(saves, first);
  assert.deepEqual(b.c._icons, a.c._icons);
});

test('explore 场景 _rebuild 不再算 markers/circles', () => {
  const { c, writes } = instance({ scene: 'explore' });
  c._icons = {};
  c._rebuild();
  assert.equal(writes.filter((w) => 'markers' in w).length, 0);
});

test('放大/缩小、回中只写内部 _scale/_center;调用方再设属性会同步回来', () => {
  const { c } = instance({ player: { lat: 30, lng: 120 } });
  c.zoomIn();
  assert.equal(c.data._scale, 17); assert.equal(c.data.scale, 16);
  c.recenter();
  assert.deepEqual(JSON.parse(JSON.stringify(c.data._center)), { lat: 30, lng: 120 });
  def.observers.center.call(c, { lat: 1, lng: 2 });
  def.observers.scale.call(c, 14);
  assert.deepEqual(JSON.parse(JSON.stringify(c.data._center)), { lat: 1, lng: 2 }); assert.equal(c.data._scale, 14);
});
