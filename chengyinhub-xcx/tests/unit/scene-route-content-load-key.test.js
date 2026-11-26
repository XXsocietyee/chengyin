'use strict';
// L09-027 / L09-028:scene-route-content 首开只读一次;宿主重投同一 params 不重读、不重置表单;
// dirtychange 只在脏态翻转时发。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const vm = require('../helpers/ui-sandbox-vm.js');

const FILE = path.resolve(__dirname, '../../subpackageMember/components/cy/scene-route-content/index.js');

function mount() {
  let def;
  const requests = [];
  const events = [];
  const app = { globalData: {}, getUserID: () => 7, getAuthorization: () => 't', sendRequest: (r) => { requests.push(r); return { abort() {} }; },
    getRequestErrorMessage: (r, f) => f, getImgUrl: (x) => x, getPageSize: () => 10 };
  vm.runInNewContext(fs.readFileSync(FILE, 'utf8'), { Component: (d) => { def = d; }, getApp: () => app,
    getCurrentPages: () => [{}], wx: { showToast() {}, navigateTo() {} }, require: createRequire(FILE), setTimeout, clearTimeout, console }, { filename: FILE });
  const c = Object.assign({}, def.methods, { data: JSON.parse(JSON.stringify(def.data)),
    setData(p) { Object.assign(this.data, p); }, triggerEvent(name, detail) { events.push({ name, detail }); } });
  const deliver = (sceneId, params) => { Object.assign(c.data, { sceneId, params }); def.observers['sceneId, params'].call(c, sceneId, params); };
  return { def, c, requests, events, deliver };
}

test('L09-027 首开 observer + attached 只读一次,重投同一 params 不重读', () => {
  const h = mount();
  h.deliver('member-withdraw-history', { tab: 1 });
  h.def.lifetimes.attached.call(h.c);
  const first = h.requests.length;
  assert.ok(first >= 1);
  h.deliver('member-withdraw-history', { tab: 1 });
  assert.equal(h.requests.length, first);
  h.deliver('member-withdraw-history', { tab: 2 });
  assert.ok(h.requests.length > first, 'params 真变了仍重读');
});

test('L09-028 连续输入只发一次 dirtychange', () => {
  const h = mount();
  const input = (v) => h.c.onFieldInput({ currentTarget: { dataset: { field: 'name' } }, detail: { value: v } });
  input('a'); input('ab'); input('abc');
  assert.equal(h.events.filter((e) => e.name === 'dirtychange').length, 1);
});
