'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

function mountPoi(sendRequest) {
  let definition;
  global.getApp = () => ({ sendRequest });
  global.getCurrentPages = () => [];
  global.wx = { getStorageSync() {}, setStorageSync() {}, showToast() {}, nextTick: fn => fn(),
    getLocation: o => o.success({ latitude: 31.2, longitude: 121.4 }) };
  global.Page = value => { definition = value; };
  const file = require.resolve('../../pages/play/poi-challenge/index.js');
  delete require.cache[file];
  require(file);
  const vm = Object.assign({}, definition, { data: JSON.parse(JSON.stringify(definition.data)) });
  vm.setData = (patch) => Object.assign(vm.data, patch);
  vm._poiId = 7;
  vm.data.node = { lat: 31.2, lng: 121.4, radiusM: 80, validationMethod: 3 };
  vm.data.step = 'quiz';
  return vm;
}

for (const [label, reply] of [
  ['network fail', (r) => r.fail({})],
  ['200 without a receipt', (r) => r.success({ code: 200, data: {} })],
  ['unknown rejection text', (r) => r.success({ code: 500, msg: '服务繁忙' })],
  ['abnormal status', (r) => r.successStatusAbnormal({ code: 500, msg: '' })],
]) {
  test(`L02-002: ${label} re-opens the quiz instead of freezing it`, () => {
    let calls = 0;
    const page = mountPoi((r) => { calls += 1; reply(r); });
    page.selectComponent = () => ({ settle() { throw new Error('unknown outcome must not settle a verdict'); } });
    page.onPick({ detail: { optionId: 'A', index: 0 } });
    assert.equal(page.data.qaFailureSeq, 1);
    assert.equal(page._submitting, false);
    page.onPick({ detail: { optionId: 'A', index: 0 } });
    assert.equal(calls, 2, 'a second submit is allowed');
    assert.equal(page.data.qaFailureSeq, 2);
  });
}

test('L02-002: photo-only auto submit with an unconfirmed result shows the retry error, not an endless skeleton', () => {
  const page = mountPoi((r) => r.fail({}));
  page.data.step = 'loading';
  page._submit('', (ok, msg) => { if (!ok) page.setData({ step: 'error', errorText: msg }); });
  assert.equal(page.data.step, 'error');
});

test('L02-002: a real rejection still settles a wrong answer', () => {
  const page = mountPoi((r) => r.success({ code: 500, msg: '答案不正确' }));
  let verdict;
  page.selectComponent = () => ({ settle: (...a) => { verdict = a; } });
  page.onPick({ detail: { optionId: 'B', index: 1 } });
  assert.equal(verdict[0], false);
  assert.equal(page.data.qaFailureSeq, 0);
});
