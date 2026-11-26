'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

function mount(file, props, wxStore) {
  let def;
  global.getApp = () => ({ globalData: {} });
  global.wx = Object.assign({
    showToast() {}, vibrateShort() {},
    getSystemInfoSync: () => ({}),
    getWindowInfo: () => ({ windowWidth: 375, windowHeight: 812 }),
  }, wxStore);
  global.Component = (d) => { def = d; };
  global.Behavior = (b) => b;
  const resolved = require.resolve(file);
  delete require.cache[resolved];
  require(file);
  const data = {};
  (def.behaviors || []).forEach((b) => Object.assign(data, JSON.parse(JSON.stringify((b && b.data) || {}))));
  Object.assign(data, JSON.parse(JSON.stringify(def.data || {})));
  Object.entries(def.properties || {}).forEach(([k, v]) => {
    data[k] = JSON.parse(JSON.stringify(v.value === undefined ? null : v.value));
  });
  const vm = {
    data, triggered: [],
    triggerEvent(name, detail) { this.triggered.push([name, detail]); },
    selectComponent: () => null,
  };
  Object.entries(def.methods || {}).forEach(([k, fn]) => { vm[k] = fn.bind(vm); });
  const observers = Object.entries(def.observers || {});
  vm.setData = (patch, cb) => {
    Object.assign(vm.data, patch);
    if (cb) cb();
  };
  vm.setProps = (patch) => {
    Object.assign(vm.data, patch);
    const keys = Object.keys(patch);
    observers.forEach(([spec, fn]) => {
      const fields = spec.split(',').map((s) => s.trim());
      if (fields.some((f) => keys.includes(f))) fn.apply(vm, fields.map((f) => vm.data[f]));
    });
  };
  vm.setProps(props);
  return vm;
}

function storage() {
  const store = {};
  let writes = 0;
  return {
    get writes() { return writes; },
    reset() { writes = 0; },
    wx: {
      setStorageSync: (k, v) => { writes += 1; store[k] = v; },
      getStorageSync: (k) => store[k],
      removeStorageSync: (k) => { delete store[k]; },
    },
  };
}

test('L02-040: closing the note or hiding it saves once, and the same account sees that draft later', () => {
  const realSet = global.setTimeout;
  const realClear = global.clearTimeout;
  global.setTimeout = () => 1;
  global.clearTimeout = () => {};
  const box = storage();
  try {
    const note = mount('../../pages/playkit/components/playkit-note/index.js',
      { show: true, draftKey: 'acct-a:n1', maxLength: 40 }, box.wx);
    box.reset();
    ['a', 'ab', 'abc'].forEach((v) => note.onInput({ detail: { value: v } }));
    assert.equal(box.writes, 0);
    note.onClose();
    assert.equal(box.writes, 1);
    assert.deepEqual(box.wx.getStorageSync('cy_kit_draft:acct-a:n1'), { text: 'abc' });
    assert.deepEqual(note.triggered.map((t) => t[0]), ['close']);

    const again = mount('../../pages/playkit/components/playkit-note/index.js',
      { show: true, draftKey: 'acct-a:n1', maxLength: 40 }, box.wx);
    assert.equal(again.data.text, 'abc');
    const other = mount('../../pages/playkit/components/playkit-note/index.js',
      { show: true, draftKey: 'acct-b:n1', maxLength: 40 }, box.wx);
    assert.equal(other.data.text, '');

    box.reset();
    again.onInput({ detail: { value: 'abcd' } });
    again.setProps({ show: false });
    assert.equal(box.writes, 1);
    again.setProps({ show: true });
    assert.equal(again.data.text, 'abcd');
  } finally {
    global.setTimeout = realSet;
    global.clearTimeout = realClear;
  }
});

test('L02-040: closing the profile sheet saves the in-progress answer for the same account', () => {
  const realSet = global.setTimeout;
  const realClear = global.clearTimeout;
  global.setTimeout = () => 1;
  global.clearTimeout = () => {};
  const box = storage();
  const questions = [{ key: 'name', kind: 'text', label: '姓名', maxLength: 12 }];
  try {
    const prof = mount('../../pages/playkit/components/playkit-profile/index.js',
      { show: true, draftKey: 'acct-a:p1', questions }, box.wx);
    box.reset();
    prof.onInput({ currentTarget: { dataset: { key: 'name' } }, detail: { value: '阿' } });
    prof.onInput({ currentTarget: { dataset: { key: 'name' } }, detail: { value: '阿兰' } });
    assert.equal(box.writes, 0);
    prof.setProps({ show: false });
    assert.equal(box.writes, 1);
    assert.equal(box.wx.getStorageSync('cy_kit_draft:acct-a:p1').form.name, '阿兰');

    const again = mount('../../pages/playkit/components/playkit-profile/index.js',
      { show: true, draftKey: 'acct-a:p1', questions }, box.wx);
    assert.equal(again.data.form.name, '阿兰');
    const other = mount('../../pages/playkit/components/playkit-profile/index.js',
      { show: true, draftKey: 'acct-b:p1', questions }, box.wx);
    assert.equal(other.data.form.name, '');
  } finally {
    global.setTimeout = realSet;
    global.clearTimeout = realClear;
  }
});
