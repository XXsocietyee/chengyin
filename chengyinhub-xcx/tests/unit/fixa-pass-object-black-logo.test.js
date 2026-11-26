'use strict';
// FIXA item 4(2026-11-25 业主规则「logo 处处是黑色」):通行证物件上的城瘾标志不再被 sepia / 灰度滤镜染成金棕或灰。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '../..');
const css = fs.readFileSync(path.join(ROOT, 'subpackageMember/components/cy/pass-object/index.wxss'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const wxml = fs.readFileSync(path.join(ROOT, 'subpackageMember/components/cy/pass-object/index.wxml'), 'utf8');

test('pass object logo is the black mark at full strength in every state', () => {
  assert.match(wxml, /class="po__mark" src="\/images\/cy_logo_mark\.png"/);
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => /\.po__mark\b/.test(m[1]));
  assert.ok(rules.length >= 1);
  for (const [, sel, body] of rules) {
    assert.doesNotMatch(body, /sepia|grayscale|saturate|brightness|invert|hue-rotate/, sel.trim());
    const op = body.match(/opacity:\s*([\d.]+)/);
    if (op) assert.equal(Number(op[1]), 1, sel.trim() + ' opacity');
  }
});
