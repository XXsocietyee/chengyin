'use strict';
// L09-083 / L09-091:订单详情与参与详情的日期在 ISO「T」串下不再出 NaN,且按中国时区显示。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

function methodsOf(rel) {
  const file = path.resolve(__dirname, '../..', rel);
  let def;
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { Component: (d) => { def = d; }, Page: (d) => { def = d; }, getApp: () => ({ globalData: {}, getUserID: () => 7 }),
    wx: {}, require: createRequire(file), setTimeout, clearTimeout, console }, { filename: file });
  return def.methods;
}

test('order detail formatDateTime handles ISO T strings and date-only values', () => {
  const m = methodsOf('subpackageMember/components/cy/scene-member-order-detail/index.js');
  assert.deepEqual(JSON.parse(JSON.stringify(m.formatDateTime('2026-11-22T10:05:00'))), { date: '2026.11.22', time: '10:05' });
  assert.deepEqual(JSON.parse(JSON.stringify(m.formatDateTime('2026-11-22 23:30:00'))), { date: '2026.11.22', time: '23:30' });
  assert.deepEqual(JSON.parse(JSON.stringify(m.formatDateTime('2026-11-22'))), { date: '2026.11.22', time: '' });
  assert.deepEqual(JSON.parse(JSON.stringify(m.formatDateTime('garbage'))), { date: '', time: '' });
});

test('participation formatDateRange uses China dates and never prints NaN', () => {
  const m = methodsOf('subpackageMember/components/scene-member-participation-detail/index.js');
  assert.equal(m.formatDateRange('2026-11-01T00:00:00', '2026-11-30 23:59:59'), '2026.11.01 - 2026.11.30');
  assert.equal(m.formatDateRange('bad', '2026-11-30'), '');
});
