'use strict';
// FIXA item 3(2026-11-25):漫游地图上没起名的队伍不再显示「玩家队伍」,沿用组队页口径「X的队伍」/「队伍」。
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../../utils/roam-entry-map.js');

test('team marker callout, activity card team row and team card never say 玩家队伍', () => {
  const view = M.build([], [{ teamId: 4, title: '', latitude: 31.23, longitude: 121.47 }, { teamId: 5, leaderName: '阿木', latitude: 31.2, longitude: 121.4 }], { activities: true, teams: true, posts: true }, (u) => u, []);
  const callouts = view.markers.filter((m) => (M.parseMarker(m.id) || {}).kind === 'team').map((m) => m.callout.content.split('\n')[0]);
  assert.deepEqual(callouts.sort(), ['阿木的队伍', '队伍'].sort());
  assert.equal(M.teamView({ teamId: 1 }).title, '队伍');
  assert.equal(M.teamView({ teamId: 1, leaderName: '阿木' }).title, '阿木的队伍');
  assert.equal(M.teamView({ teamId: 1, title: '周六小队' }).title, '周六小队');
  const card = M.activityView({ id: 9, kind: 'activity', endDate: '2999-01-01 00:00:00' }, [{ teamId: 2, activityId: 9, joinedCount: 1, maxMembers: 4 }, { teamId: 3, activityId: 9, leaderName: '阿木' }], (u) => u);
  assert.deepEqual(card.teams.map((t) => t.title), ['队伍', '阿木的队伍']);
  const src = require('node:fs').readFileSync(require.resolve('../../utils/roam-entry-map.js'), 'utf8').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(src, /'玩家队伍'/);
});
