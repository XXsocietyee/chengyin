const test = require('node:test');
const assert = require('node:assert/strict');

function loadComponent() {
  const componentPath = require.resolve('../../pages/play/components/advanced-game/index.js');
  delete require.cache[componentPath];
  let definition;
  global.getApp = () => ({ sendRequest() {} });
  global.wx = { createInnerAudioContext: () => ({}), showToast() {} };
  global.Component = (value) => { definition = value; };
  require(componentPath);
  return definition;
}

function instanceWith(state) {
  const definition = loadComponent();
  const instance = { data: { state, preview: false, mock: false }, setData(patch, cb) { Object.assign(this.data, patch); if (cb) cb(); } };
  Object.keys(definition.methods).forEach((name) => { instance[name] = definition.methods[name].bind(instance); });
  return instance;
}

test('L02-001: an expired legacy timed session re-reads /state once, not in a loop', async () => {
  const past = Date.now() - 5000;
  const state = { sessionId: 's1', status: 'EXPIRED', deadlineAt: past, config: { timer: { enabled: true } } };
  const instance = instanceWith(state);
  let refreshes = 0;
  // refreshState -> hydrate -> setData callback -> syncTimer: simulate that chain directly.
  instance.refreshState = () => { refreshes += 1; instance.syncTimer(); return Promise.resolve(true); };
  instance.syncTimer();
  assert.equal(refreshes, 1);
  assert.ok(!instance._timer, 'no interval armed for a deadline already past');
  instance.syncTimer();
  assert.equal(refreshes, 1);
});

test('L02-001: a new deadline (retry) gets its own single re-read', () => {
  const instance = instanceWith({ sessionId: 's1', status: 'EXPIRED', deadlineAt: Date.now() - 5000, config: {} });
  let refreshes = 0;
  instance.refreshState = () => { refreshes += 1; return Promise.resolve(true); };
  instance.syncTimer();
  instance.data.state = { sessionId: 's1', status: 'EXPIRED', deadlineAt: Date.now() - 1000, config: {} };
  instance.syncTimer();
  assert.equal(refreshes, 2);
});

test('L02-001: R5 sessions still re-read only while RUNNING', () => {
  const instance = instanceWith({ sessionId: 's2', status: 'FAILED', deadlineAt: Date.now() - 5000, config: { outcomeRulesVersion: 1 } });
  let refreshes = 0;
  instance.refreshState = () => { refreshes += 1; return Promise.resolve(true); };
  instance.syncTimer();
  assert.equal(refreshes, 0);
});
