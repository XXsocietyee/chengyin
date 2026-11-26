'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const topbar = require('../../pages/play/utils/play-topbar.js');

function page(req) {
  const vm = Object.assign({ data: { topicId: 1, casebook: { show: false }, journeyRewards: { show: false }, nodes: [] } }, topbar.methods(req));
  vm.setData = (p) => Object.entries(p).forEach(([k, v]) => {
    const [a, b] = k.split('.'); if (b) vm.data[a] = Object.assign({}, vm.data[a], { [b]: v }); else vm.data[a] = v; });
  return vm;
}

test('L02-010: closing the casebook before the reply keeps it closed; double tap sends one GET', async () => {
  let resolve; let calls = 0;
  const vm = page(() => { calls += 1; return new Promise((r) => { resolve = r; }); });
  vm.openCasebook();
  vm.openCasebook();
  assert.equal(calls, 1);
  vm.closeCasebook();
  resolve({ code: 200, data: { facts: [] } });
  await new Promise((r) => setImmediate(r));
  assert.equal(vm.data.casebook.show, false);
});

test('L02-010: rewards reply after close is dropped', async () => {
  let resolve;
  const vm = page(() => new Promise((r) => { resolve = r; }));
  vm.openJourneyRewards();
  vm.closeJourneyRewards();
  resolve({ code: 200, data: { items: [] } });
  await new Promise((r) => setImmediate(r));
  assert.equal(vm.data.journeyRewards.show, false);
});

test('L02-010: an open casebook still fills when the reply arrives', async () => {
  const vm = page(() => Promise.resolve({ code: 200, data: { facts: [1], found: 2, total: 3 } }));
  vm.openCasebook();
  await new Promise((r) => setImmediate(r));
  assert.equal(vm.data.casebook.show, true);
  assert.equal(vm.data.casebook.found, 2);
});

test('L02-012: casebook probe is asked once per session, not on every onShow reload', async () => {
  let calls = 0;
  const vm = page(() => { calls += 1; return Promise.resolve({ code: 200, data: { facts: [1] } }); });
  vm._probeCasebook({ sessionId: 's1' });
  await new Promise((r) => setImmediate(r));
  vm._probeCasebook({ sessionId: 's1' });
  assert.equal(calls, 1);
  vm._probeCasebook({ sessionId: 's2' });
  assert.equal(calls, 2);
});

test('L02-012: a ready status-bar character line does not flicker back to loading on refresh', () => {
  const hud = require('../../pages/play/utils/play-hud-overlays.js');
  const states = [];
  const vm = Object.assign({ data: { topicId: 5, hudChar: { state: 'ok', ava: 'A', attrs: [] } },
    _routeState: { attributes: [{ key: 'str' }] }, _isPlayAccountCurrent: () => true }, hud.methods(() => new Promise(() => {})));
  vm.setData = (p) => { if (p.hudChar) states.push(p.hudChar.state); Object.assign(vm.data, p); };
  vm.loadHudCharacter();
  assert.deepEqual(states, []);
});

test('L02-016: identical team sync replies produce one onTeams call', async () => {
  const { createTeamTrail } = require('../../pages/play/utils/team-trail.js');
  let calls = 0;
  const reply = { code: 200, data: { available: true, share: true, teams: [{ key: 'a', name: 'A', pts: [[31, 121], [31.1, 121.1]], done: 1 }] } };
  const trail = createTeamTrail({ api: { sync: () => Promise.resolve(reply) }, readPoints: () => [], onTeams: () => { calls += 1; } });
  await trail.tick();
  await trail.tick();
  assert.equal(calls, 1);
  reply.data.teams[0].pts.push([31.2, 121.2]);
  await trail.tick();
  assert.equal(calls, 2);
});

test('L02-052/L02-074: count-up and pack loops stop once the play page is disposed', () => {
  const roll = require('../../pages/play/utils/count-roll.js');
  const pack = require('../../pages/play/utils/pack-detail.js');
  let sets = 0;
  const page = { _playDisposed: true, data: { reducedMotion: true, mode: 2, seatTiles: [1] }, setData() { sets += 1; }, animate() { sets += 1; } };
  roll.roll(page, 'k', { a: '12' }, {});
  assert.equal(sets, 0);
  page.data.reducedMotion = false;
  pack.ensure(page);
  assert.equal(sets, 0);
  assert.ok(!page._packDetailOn);
});
