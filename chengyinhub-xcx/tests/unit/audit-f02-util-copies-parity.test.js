'use strict';
// L02-027: pages/play/utils 与 pages/playkit/utils 下四个同名工具是两个分包各带一份的副本。
// 这里按**行为**钉住两份一致:同一组输入,两份给出同样的输出 —— 改了一份忘了另一份就红。
const { test } = require('node:test');
const assert = require('node:assert/strict');

const NAMES = ['keep-numerals', 'playkit-questo', 'playkit-steps', 'sensor-contract'];
const SAMPLES = [
  undefined, null, '', '  三 杯 拿铁  ', '第 12 站 · 300 米', 'ABC-123', 0, 7, -3, 2.5, true, [], ['甲', '乙'],
  { title: '找猫', options: [{ id: 'a', label: 'A. 橘猫' }, { id: 'b', label: '狸花' }], answer: '橘猫', mode: 'HANGMAN' },
  { attempt: 2, attempts: 3, maxAttempts: 5, xp: 30, badge: 'b1', kind: 'photo', threshold: 1.5, steps: '领 · 闭眼 · 答' },
  { blocks: [{ type: 'text', text: '一段' }], suspects: [{ id: 's1', name: '甲' }], outcome: 'WIN' },
];

function run(fn, args) {
  try { return { ok: JSON.stringify(fn(...args)) }; } catch (e) { return { err: e && e.message }; }
}

for (const name of NAMES) {
  test(`L02-027: ${name} behaves the same in pages/play and pages/playkit`, () => {
    const a = require(`../../pages/play/utils/${name}.js`);
    const b = require(`../../pages/playkit/utils/${name}.js`);
    assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort(), 'same exports');
    for (const key of Object.keys(a)) {
      if (typeof a[key] !== 'function') { assert.deepEqual(a[key], b[key], key); continue; }
      for (const x of SAMPLES) {
        for (const args of [[x], [x, x], [x, SAMPLES[13]], [SAMPLES[14], x]]) {
          assert.deepEqual(run(a[key], args), run(b[key], args), `${name}.${key}(${JSON.stringify(args)})`);
        }
      }
    }
  });
}
