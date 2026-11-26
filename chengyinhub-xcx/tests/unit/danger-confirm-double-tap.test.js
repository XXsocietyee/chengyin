'use strict';
// L10-148:busyOn 之前的连点不发第二次 confirm;失败后「先不弄了」的 done 带 failed。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

function mount() {
  let config;
  global.Component = (c) => { config = c; };
  global.Behavior = global.Behavior || ((b) => b);
  global.getApp = () => ({ globalData: {} });
  global.wx = global.wx || { getStorageSync: () => '' };
  const file = path.resolve(__dirname, '../../components/cy/danger-confirm/index.js');
  delete require.cache[file]; require(file);
  const events = [];
  const vm = Object.assign({}, config.methods, { data: JSON.parse(JSON.stringify(config.data)),
    setData(p) { Object.assign(this.data, p); }, triggerEvent(name, detail) { events.push({ name, detail }); } });
  return { vm, events };
}

test('600ms 内重复点确认只发一次 confirm', () => {
  const { vm, events } = mount();
  vm.data.action = { key: 'x' }; vm.data.stage = 'confirm';
  vm.onConfirm(); vm.onConfirm();
  assert.equal(events.filter((e) => e.name === 'confirm').length, 1);
  vm._confirmAt = Date.now() - 1000;
  vm.onConfirm();
  assert.equal(events.filter((e) => e.name === 'confirm').length, 2, '隔一会儿可以再点');
});

test('失败卡上放弃时 done 带 failed:true,成功卡收起时 failed:false', () => {
  const { vm, events } = mount();
  vm.data.action = { key: 'x' };
  vm.data.stage = 'error'; vm.onCloseDone();
  vm.data.stage = 'done'; vm.onCloseDone();
  assert.deepEqual(events.map((e) => e.detail.failed), [true, false]);
});
