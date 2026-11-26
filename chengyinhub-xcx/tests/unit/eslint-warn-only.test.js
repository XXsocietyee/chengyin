'use strict';
/* eslint-warn-only —— ESLint 只出警告、不进小程序包(AUDIT-1122 F2,2026-11-22)
 * 单测 job 不装 node_modules,所以这里只加载配置对象本身,不加载 eslint 包。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const graph = require('../../scripts/lib/package-graph.js');
const configs = require('../../eslint.config.js');

const level = (v) => (Array.isArray(v) ? v[0] : v);

test('ESLint 规则全部是 warn,不会让 CI 判红', () => {
  const rules = configs.flatMap((c) => Object.entries(c.rules || {}));
  assert.ok(rules.length >= 8, '规则集不应为空');
  for (const [name, v] of rules) assert.equal(level(v), 'warn', name);
});

test('ESLint 配置被 packOptions.ignore 排除,不随主包上传', () => {
  const g = graph.build();
  assert.equal(g.files.has('eslint.config.js'), false);
  assert.ok(g.files.has('app.js'));
});
