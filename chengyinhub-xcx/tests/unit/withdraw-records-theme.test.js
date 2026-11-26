'use strict';
// L09-037:提现记录深链壳只有 theme=merchant 才切浅色原生导航;玩家侧保持深色。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const FILE = path.resolve(__dirname, '../../subpackageMember/tixianjilu/tixianjilu.js');

function mount(options) {
  let def; const themes = [];
  const localRequire = createRequire(FILE);
  vm.runInNewContext(fs.readFileSync(FILE, 'utf8'), { Page: (d) => { def = d; }, getApp: () => ({}), getCurrentPages: () => [{}], wx: {},
    require: (id) => id.includes('merchant-theme') ? { merchantPageShow: () => themes.push('light'), merchantPageRestore: () => themes.push('dark') } : localRequire(id) });
  const page = Object.assign({}, def, { data: JSON.parse(JSON.stringify(def.data)), setData(p) { Object.assign(this.data, p); }, selectComponent() { return null; } });
  page.onLoad(options); page.onShow(); page.onHide();
  return themes;
}

test('player withdraw records never switch to the light merchant nav', () => {
  assert.deepEqual(mount({}), []);
});
test('merchant deep link still switches to light and restores on hide', () => {
  assert.deepEqual(mount({ theme: 'merchant' }), ['light', 'dark']);
});
