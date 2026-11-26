'use strict';
// L09-160:periodEnd 解析不出不抛错;队内名次行 key 稳定(不用随机数)。
const test = require('node:test');
const assert = require('node:assert/strict');
const v = require('../../subpackageJourney/utils/journey-view.js');

test('rankView tolerates an unparseable periodEnd', () => {
  const out = v.rankView({ period: 'week', periodStart: '2026-11-16 00:00:00', periodEnd: 'garbage', entries: [] });
  assert.equal(out.window, '');
});
test('teamRankView keys are stable across renders', () => {
  const data = { members: [{ ranked: true, rank: 1 }, { ranked: false }] };
  const a = v.teamRankView(data), b = v.teamRankView(data);
  assert.deepEqual(a.entries.map((e) => e.key), b.entries.map((e) => e.key));
  assert.equal(new Set(a.entries.map((e) => e.key)).size, 2);
});
