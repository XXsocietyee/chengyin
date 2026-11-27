'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createRequire } = require('node:module');
const file = path.resolve(__dirname, '../../pages/shezhi/components/privacy-sheet/index.js');
function mount() {
  let definition, owner = '1', token = 'a', resolve, reject, presenceCalls = 0;
  const toasts = [], changes = [], revoked = [], later = [];
  const pending = new Promise((done, fail) => { resolve = done; reject = fail; });
  const app = { getUserID: () => owner, getAuthorization: () => token, recordConsent: () => pending };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { Component: d => { definition = d; }, getApp: () => app,
    wx: {}, require: name => name.endsWith('/toast.js') ? value => toasts.push(value)
      : name.endsWith('/roam-presence-privacy.js') ? { setSharing: () => {
        if (presenceCalls++ === 0) return pending;
        let ok, fail; const promise = new Promise((done, error) => { ok = done; fail = error; });
        later.push({ ok, fail }); return promise;
      } }
      : name.endsWith('/bg-tracker.js') ? { revoke: purpose => { revoked.push(purpose); return Promise.resolve({ ok: true }); } } : createRequire(file)(name) });
  const component = { ...definition.methods, data: { ...definition.data }, setData(patch) { changes.push(patch); Object.assign(this.data, patch); } };
  return { component, definition, toasts, changes, revoked, resolve, reject, later,
    switch(kind) { if (kind === 'owner') owner = '2'; else token = 'b'; } };
}
for (const action of ['withdrawRoamLocationConsent', 'disablePresenceSharing']) {
  for (const outcome of ['resolve', 'reject']) for (const transition of ['owner', 'token', 'hide', 'detach']) test(action + ' ignores late ' + outcome + ' after ' + transition, async () => {
    const h = mount(); h.component[action]();
    await Promise.resolve(); // Let the original request dispatch before changing reader/lifecycle.
    if (transition === 'hide') h.definition.pageLifetimes?.hide.call(h.component);
    else if (transition === 'detach') h.definition.lifetimes?.detached.call(h.component);
    else h.switch(transition);
    const before = h.changes.length;
    h[outcome](new Error('offline')); await new Promise(r => setImmediate(r));
    assert.equal(h.toasts.length, 0); assert.equal(h.changes.length, before);
  });
}
test('presence leave unlocks the spinner and a newer close ignores the stale reply', async () => {
  const h = mount();
  h.component.disablePresenceSharing();
  await Promise.resolve();
  h.definition.pageLifetimes.hide.call(h.component);
  assert.equal(h.component.data.submitting, false);
  h.definition.pageLifetimes.show.call(h.component);
  h.component.disablePresenceSharing();
  await Promise.resolve();
  assert.equal(h.component.data.submitting, true);
  const before = h.changes.length;
  h.resolve(false);
  await new Promise(r => setImmediate(r));
  assert.equal(h.toasts.length, 0);
  assert.equal(h.changes.length, before);
  assert.equal(h.component.data.submitting, true);
  h.later[0].ok(false);
  await new Promise(r => setImmediate(r));
  assert.deepEqual(h.toasts, ['已关闭附近的人位置分享']);
  assert.equal(h.component.data.submitting, false);
});
test('presence failure stays under the action and a late reply does not toast', async () => {
  const h = mount();
  h.component.disablePresenceSharing();
  h.reject(new Error('offline'));
  await new Promise(r => setImmediate(r));
  assert.equal(h.toasts.length, 0);
  assert.match(h.component.data.presenceError, /未能关闭/);
  assert.equal(h.component.data.submitting, false);
});
test('revoke failure stays on the button instead of a toast', async () => {
  const h = mount();
  h.component.withdrawRoamLocationConsent();
  h.reject(new Error('offline'));
  await new Promise(r => setImmediate(r));
  assert.equal(h.toasts.length, 0);
  assert.match(h.component.data.submitError, /待确认/);
  assert.equal(h.component.data.submitting, false);
});
test('same reader receives confirmed revoke and can use the sheet after reentry', async () => {
  const h = mount(); h.component.withdrawRoamLocationConsent();
  assert.deepEqual(h.revoked, ['roam']); h.resolve(); await new Promise(r => setImmediate(r));
  assert.equal(h.toasts[0], '已撤回漫游定位同意'); assert.equal(h.component.data.submitting, false);
  h.definition.pageLifetimes.hide.call(h.component); h.definition.pageLifetimes.show.call(h.component);
  assert.equal(h.component.data.submitting, false);
});
