'use strict';
// L10-009:Cast 配置缓存按账号隔离。
const test = require('node:test');
const assert = require('node:assert/strict');
let user = '7';
global.getApp = () => ({ getUserID: () => user });
const cast = require('../../utils/cast-config.js');

test('another account never reads the previous account cached cast', () => {
  const raw = { enabled: true, cast: [{ id: 'a', name: '甲', clues: [{ text: '已解锁线索' }], lockedCount: 0 }] };
  user = '7';
  assert.ok(cast.remember(42, raw));
  assert.equal(cast.cached(42).cfg.cast[0].clues[0].text, '已解锁线索');
  user = '8';
  assert.equal(cast.cached(42), null);
  user = '7';
  assert.ok(cast.cached(42));
});
