'use strict';
// L09-076:同一单刷新时发票行不先收起再出现;换单先收起。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const FILE = path.resolve(__dirname, '../../subpackageMember/components/cy/scene-member-order-detail/index.js');

test('same-order refresh keeps the invoice row until the reply', () => {
  let def; const requests = []; const writes = [];
  const app = { globalData: {}, getUserID: () => 7, sendRequest: (o) => requests.push(o) };
  vm.runInNewContext(fs.readFileSync(FILE, 'utf8'), { Component: (d) => { def = d; }, getApp: () => app, wx: {}, require: createRequire(FILE), setTimeout, clearTimeout, console }, { filename: FILE });
  const c = Object.assign({}, def.methods, { data: JSON.parse(JSON.stringify(def.data)), setData(p) { writes.push(JSON.parse(JSON.stringify(p))); Object.assign(this.data, p); } });
  c._attached = true; c._orderId = '5'; c._orderGeneration = 1;
  const info = { id: 5, paymentStatus: 2, isFreeOrder: false };
  c.loadInvoice(info);
  requests[0].success({ code: 200, data: [{ orderId: 5, issuerId: 3 }] });
  assert.deepEqual(JSON.parse(JSON.stringify(c.data.invoiceRow)), { show: true, state: 'can' });
  writes.length = 0;
  c.loadInvoice(info);
  assert.equal(writes.some((w) => w.invoiceRow && w.invoiceRow.show === false), false, '刷新途中不收起');
  requests[1].success({ code: 200, data: [{ orderId: 5, issuerId: 3 }] });
  assert.deepEqual(JSON.parse(JSON.stringify(c.data.invoiceRow)), { show: true, state: 'can' });
  c._orderId = '6';
  c.loadInvoice({ id: 6, paymentStatus: 2, isFreeOrder: false });
  assert.equal(c.data.invoiceRow.show, false, '换单先收起');
});
