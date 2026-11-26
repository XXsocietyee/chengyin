'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

test('L02-056: a one-chapter finale does not label face A as chapter 2', () => {
  global.wx = global.wx || { getStorageSync() {}, setStorageSync() {} };
  const data = require('../../pages/play/utils/chapter-flip-data.js');
  const out = data.buildFinale({ cards: [{ id: 1, title: '只有一章', cover: 'c.jpg' }], nodes: [] });
  const [a, b] = out.faces;
  assert.equal(a.label, b.label);
  assert.equal(a.cover, b.cover);
  assert.notEqual(a.style, b.style);
});

test('L02-061: a throw while handling the coop reply releases the button', async () => {
  const coop = require('../../pages/play/utils/coop-help.js');
  const realBody = coop.helpBody; const realOutcome = coop.outcome;
  coop.helpBody = () => ({ ok: 1 });
  coop.outcome = () => { throw new Error('boom'); };
  try {
    const { methods } = require('../../pages/play/utils/coop-help-methods.js');
    const vm = Object.assign({ data: { themeBag: {}, coopHelp: { questKey: 'q', busyLevel: null, rows: [] } } }, methods(() => Promise.resolve({ code: 200 })));
    vm.setData = (p) => Object.entries(p).forEach(([k, v]) => { const [a, b] = k.split('.'); if (b) vm.data[a][b] = v; else vm.data[a] = v; });
    vm._coopSeq = 1;
    const res = await vm._coopSend('USE', 2, 'r1');
    assert.equal(res, false);
    assert.equal(vm.data.coopHelp.busyLevel, null);
    assert.match(vm.data.coopHelp.error, /未确认/);
  } finally { coop.helpBody = realBody; coop.outcome = realOutcome; }
});

test('L02-078: tapping a hint row that already shows its content sends nothing', () => {
  global.getApp = () => ({ getUserID: () => 'u' });
  global.wx = { getStorageSync() {}, setStorageSync() {}, showToast() {} };
  const panel = require('../../pages/play/utils/play-help-panel.js');
  let sends = 0;
  const vm = Object.assign({ data: { helpPanel: { busy: false, rows: [{ level: 1, state: 'review', content: '看左边' }] } } }, panel.methods(() => { sends += 1; return Promise.resolve({}); }));
  vm.setData = (p) => Object.assign(vm.data, p);
  vm.tapHelpRow({ currentTarget: { dataset: { level: 1 } } });
  assert.equal(sends, 0);
});

test('L02-079: a run with no pending commands leaves no empty intents key; unreadable storage does not throw', () => {
  const { createRouteActionStore } = require('../../pages/play/utils/play-route-state.js');
  const store = {}; let removed = 0;
  const storage = { getStorageSync: (k) => store[k], setStorageSync: (k, v) => { store[k] = v; }, removeStorageSync: (k) => { removed += 1; delete store[k]; } };
  const s = createRouteActionStore(() => 'id1', { storage, scope: { s: 1 } });
  s.context('complete', 7, { version: 1, sessionId: 's' });
  assert.equal(Object.keys(store).length, 1);
  s.resolve('complete', 7);
  assert.equal(Object.keys(store).length, 0);
  assert.ok(removed >= 1);
  const bad = { getStorageSync() { throw new Error('io'); }, setStorageSync() {}, removeStorageSync() {} };
  assert.doesNotThrow(() => createRouteActionStore(() => 'x', { storage: bad, scope: { s: 2 } }));
});

test('L02-079: opening the hint panel prunes this player\'s pending ids from other runs', () => {
  const store = { 'play-help-pending:v1': { 'u|old|n1|use|1': 'r1', 'u|run9|n1|use|1': 'r2', 'v|old|n1|use|1': 'r3' } };
  global.wx = { getStorageSync: (k) => store[k], setStorageSync: (k, v) => { store[k] = v; }, showToast() {} };
  const panel = require('../../pages/play/utils/play-help-panel.js');
  const vm = Object.assign({ data: { helpPanel: {} } }, panel.methods(() => Promise.resolve({})));
  vm._helpPrune({ owner: 'u', runId: 'run9' });
  assert.deepEqual(Object.keys(store['play-help-pending:v1']).sort(), ['u|run9|n1|use|1', 'v|old|n1|use|1']);
});

test('L02-062: opening the orient sheet sends one path setData, not the whole object twice', () => {
  global.getApp = () => ({ getUserID: () => '9', getAuthorization: () => 'a' });
  global.wx = { getStorageSync: () => undefined, setStorageSync() {}, removeStorageSync() {}, showModal() {} };
  const lifecycle = require('../../pages/play/utils/orient-lifecycle.js');
  const page = Object.assign({ data: Object.assign(JSON.parse(JSON.stringify(lifecycle.data)), { topicId: '17', activityId: 0, mode: 1 }) },
    lifecycle.methods(() => new Promise(() => {})));
  const patches = [];
  page.setData = (p) => patches.push(p);
  page.openOrientLifecycle();
  assert.equal(patches.length, 1);
  assert.ok(Object.keys(patches[0]).every((k) => k.startsWith('orientLifecycle.')));
  assert.equal(patches[0]['orientLifecycle.open'], true);
});

test('L02-065: an unchanged free-explore snapshot is not rewritten on every reload', () => {
  let writes = 0; const store = {};
  global.wx = { getStorageSync: (k) => store[k], setStorageSync: (k, v) => { writes += 1; store[k] = v; } };
  const cache = require('../../pages/play/utils/fe-story-cache.js');
  const scope = { memberId: 7, topicId: 3, routeSessionId: 'r1' };
  const d = { mode: 2, topicId: 3, nodes: [{ nodeId: 1, name: 'A' }], storyUnlocked: 1, storyTotal: 2 };
  assert.equal(cache.save(scope, d), true);
  assert.equal(cache.save(scope, JSON.parse(JSON.stringify(d))), true);
  assert.equal(writes, 1);
  d.storyUnlocked = 2;
  cache.save(scope, d);
  assert.equal(writes, 2);
});

test('L02-106: reading-position saves are throttled, the latest position is never lost, old runs are pruned', () => {
  const store = { 'cy_story_resume:BASE:rold': { runId: 'old' } }; let writes = 0;
  const realSet = global.setTimeout; const timers = [];
  global.setTimeout = (fn) => { timers.push(fn); return timers.length; };
  global.wx = { getStorageSync: (k) => store[k], setStorageSync: (k, v) => { writes += 1; store[k] = v; }, removeStorageSync: (k) => { delete store[k]; },
    getStorageInfoSync: () => ({ keys: Object.keys(store) }) };
  const path = require.resolve('../../pages/play/utils/story-resume.js');
  const runSession = require('../../pages/play/utils/play-run-session.js');
  const real = runSession.pausedRunStorageKey;
  runSession.pausedRunStorageKey = () => 'BASE';
  delete require.cache[path];
  try {
    const resume = require(path);
    const scope = { routeSessionId: 'r9' };
    resume.patch(scope, { pos: { i: 1 } });
    resume.patch(scope, { pos: { i: 2 } });
    resume.patch(scope, { pos: { i: 3 } });
    assert.equal(writes, 1);
    assert.deepEqual(resume.read(scope).pos, { i: 3 }, 'read sees the pending position');
    timers.forEach((fn) => fn());
    assert.equal(writes, 2);
    assert.deepEqual(store['cy_story_resume:BASE:rr9'].pos, { i: 3 });
    assert.equal(store['cy_story_resume:BASE:rold'], undefined, 'previous run pruned');
  } finally { global.setTimeout = realSet; runSession.pausedRunStorageKey = real; delete require.cache[path]; }
});

test('L02-069: the contact row and the character overlay reuse what was already read', async () => {
  const hud = require('../../pages/play/utils/play-hud-overlays.js');
  let calls = 0;
  const vm = Object.assign({ data: { topicId: 5, activityId: 0, topicName: '雾', hudChar: { state: 'ok' }, sessionToolsOpen: false, charOv: { show: false } },
    _routeState: { currentNodeId: 2 }, _isPlayAccountCurrent: () => true }, hud.methods(() => { calls += 1; return Promise.resolve({ code: 200, data: null }); }));
  vm.setData = (p) => Object.assign(vm.data, p);
  await vm.loadPlayContact();
  await vm.loadPlayContact();
  assert.equal(calls, 1);
  vm._hudCard = { attributes: [{ stateKey: 'str', label: '力', value: 3, max: 5, displayType: 'BAR' }] };
  vm.openCharOverlay();
  assert.equal(calls, 1, 'no GET for a card already on the status bar');
  assert.equal(vm.data.charOv.state, 'ok');
});

test('L02-098: repeated R5 views of the same version refresh the bag once', () => {
  const r5 = require('../../pages/play/utils/r5-player-runtime.js');
  let refreshes = 0;
  const vm = Object.assign({ data: {}, refreshThemeBackpack: () => { refreshes += 1; } }, r5.methods());
  vm._r5RefreshBag({ sessionId: 's', version: 3, status: 'RUNNING' });
  vm._r5RefreshBag({ sessionId: 's', version: 3, status: 'RUNNING' });
  assert.equal(refreshes, 1);
  vm._r5RefreshBag({ sessionId: 's', version: 4, status: 'RUNNING' });
  assert.equal(refreshes, 2);
});

test('L02-107: advanced-game reads the leaderboard once per session status, not on every state change', () => {
  let def;
  global.getApp = () => ({ sendRequest() {} });
  global.wx = { createInnerAudioContext: () => ({}), showToast() {} };
  global.Component = (d) => { def = d; };
  const file = require.resolve('../../pages/play/components/advanced-game/index.js');
  delete require.cache[file]; require(file);
  let boards = 0;
  const vm = { data: { state: null }, setData(p, cb) { Object.assign(this.data, p); if (cb) cb(); }, triggerEvent() {} };
  Object.keys(def.methods).forEach((k) => { vm[k] = def.methods[k].bind(vm); });
  vm.loadLeaderboard = () => { boards += 1; };
  vm.syncTimer = () => {}; vm.syncBackgroundMusic = () => {}; vm.emitSession = () => {};
  const base = { sessionId: 's1', status: 'RUNNING', config: { leaderboard: { enabled: true } } };
  vm.hydrate(Object.assign({}, base, { version: 1 }));
  vm.hydrate(Object.assign({}, base, { version: 2 }));
  assert.equal(boards, 1);
  vm.hydrate(Object.assign({}, base, { version: 3, status: 'COMPLETED' }));
  assert.equal(boards, 2);
});

test('L02-087: serverPayload is a whitelist; unknown detail fields never reach the server', () => {
  global.wx = global.wx || { getStorageSync() {}, setStorageSync() {} };
  const v = require('../../pages/play/utils/playkit-view.js');
  assert.deepEqual(v.serverPayload('blindtaste', 'answer', { key: 'b', extra: 1 }), { key: 'b' });
  for (const [t, a] of [['walk', 'sync'], ['walk', 'claim'], ['timewindow', 'subscribe'], ['slowtask', 'slowstart'], ['slowtask', 'slowclaim'], ['predict', 'skip']]) {
    assert.deepEqual(v.serverPayload(t, a, { secret: 'x' }), {}, t + ':' + a);
  }
  assert.deepEqual(v.serverPayload('nosuch', 'thing', { secret: 'x' }), {});
});

test('L02-066: a malformed guard-appeal row without a pending command is cleared instead of blocking appeals forever', () => {
  const { create } = require('../../pages/play/utils/guard-appeal.js');
  const store = {}; const removed = [];
  const storage = { getStorageSync: (k) => store[k], setStorageSync: (k, v) => { store[k] = v; }, removeStorageSync: (k) => { removed.push(k); delete store[k]; } };
  const key = 'play-guard-appeal:7:s1';
  store[key] = 'garbage';
  const flow = create({ storage, owner: 7, session: 's1', send: async () => null, current: () => true, changed() {}, keyFactory: () => 'r' });
  assert.ok(flow);
  assert.deepEqual(removed, [key]);
  store[key] = { owner: 7, session: 's1', command: { requestId: 'r1' } };
  assert.throws(() => create({ storage, owner: 7, session: 's1', send: async () => null, current: () => true, changed() {}, keyFactory: () => 'r' }), /不完整/,
    'a row that may carry an unanswered appeal is kept');
});

test('L02-060: cast picks are stored per owner and run, kept only in memory without a run id, and capped', () => {
  const store = {};
  global.wx = { getStorageSync: (k) => store[k], setStorageSync: (k, v) => { store[k] = v; }, removeStorageSync: (k) => { delete store[k]; },
    getStorageInfoSync: () => ({ keys: Object.keys(store) }) };
  store['cast-run:old-topic'] = { picks: 1 };
  delete require.cache[require.resolve('../../pages/play/utils/cast-play.js')];
  const cast = require('../../pages/play/utils/cast-play.js');
  const m = cast.methods(() => Promise.resolve({}));
  const page = (owner, sid) => Object.assign({ data: { topicId: 't9' }, _routeState: { sessionId: sid }, _boundPlayOwner: () => owner }, m);
  const a = page(7, 's1'); a._castWrite({ pick: 'x' });
  assert.deepEqual(store['cast-run:7:s1'], { pick: 'x' });
  assert.equal(store['cast-run:old-topic'], undefined, 'legacy un-owned rows are cleared');
  const b = page(8, 's1');
  assert.deepEqual(b._castMine(), {}, 'another account does not see the first one’s picks');
  const c = page(7, ''); c._castWrite({ pick: 'y' });
  assert.deepEqual(c._castMine(), { pick: 'y' });
  assert.equal(Object.keys(store).filter((k) => /^cast-run:7:$/.test(k)).length, 0, 'no run id: nothing stored');
  for (let i = 0; i < 25; i++) page(7, 'r' + i)._castWrite({ i });
  assert.ok(Object.keys(store).filter((k) => k.startsWith('cast-run:')).length <= 20);
});

test('L02-103: team colours depend on the team key, not on who was seen first; a long backlog is thinned, not truncated', async () => {
  const tt = require('../../pages/play/utils/team-trail.js');
  const row = (key) => ({ key, pts: [[30, 120], [30.001, 120.001]] });
  const a = tt.shapeTeams([row('A'), row('B')], {});
  const b = tt.shapeTeams([row('B'), row('A')], {});
  assert.equal(a.find((t) => t.key === 'A').color, b.find((t) => t.key === 'A').color);
  let sent = null;
  const pts = Array.from({ length: 200 }, (_, i) => ({ lat: 30 + i / 1e4, lng: 120 }));
  const trail = tt.createTeamTrail({ api: { sync: (d) => { sent = d; return Promise.resolve({ code: 200, data: { available: false, share: false } }); }, state: () => Promise.resolve(null), consent: () => Promise.resolve(null) },
    activityId: 1, readPoints: () => pts, done: () => 0, onTeams() {}, onState() {} });
  await trail.tick();
  assert.equal(sent.pts.length, 40);
  assert.deepEqual(sent.pts[0], [30, 120], 'oldest unsent point kept');
  assert.deepEqual(sent.pts[39], [30 + 199 / 1e4, 120], 'newest kept');
  trail.pause();
});

test('L02-130: merchant proof picks the basic-intent path from a kind string; the two sentinel wrappers are gone', async () => {
  const fs = require('fs'); const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '../../pages/play/merchant/index.js'), 'utf8');
  assert.doesNotMatch(src, /function request(Checkin|Arrive)\(/);
  let def; const prevPage = global.Page, prevApp = global.getApp;
  global.Page = (o) => { def = o; }; global.getApp = () => ({ sendRequest() {}, chooseImage() {} });
  delete require.cache[require.resolve('../../pages/play/merchant/index.js')];
  require('../../pages/play/merchant/index.js');
  global.Page = prevPage; global.getApp = prevApp;
  const calls = [];
  const page = Object.assign({}, def, { data: Object.assign({}, def.data, { node: { nodeId: 5 } }), setData(p) { Object.assign(this.data, p); },
    _isIntentOwnerCurrent: () => false,
    _sendBasicIntent: (kind, url) => { calls.push([kind, url]); return Promise.resolve({ code: 200 }); },
  });
  await page._submitProof('checkin', {}, 'ok');
  assert.deepEqual(calls, [], 'basic path checks the intent owner first');
  page._isIntentOwnerCurrent = () => true;
  page._prev = { _resolveRouteAction() {}, _handleRouteConflict() {} };
  await page._submitProof('arrive', {}, 'ok').catch(() => {});
  assert.deepEqual(calls[0], ['arrive', '/api/play/arrive']);
});

test('L02-129: merchant write-back updates only the changed play node by path', () => {
  let def; const prevPage = global.Page, prevApp = global.getApp;
  global.Page = (o) => { def = o; }; global.getApp = () => ({ sendRequest() {}, chooseImage() {} });
  delete require.cache[require.resolve('../../pages/play/merchant/index.js')];
  require('../../pages/play/merchant/index.js');
  global.Page = prevPage; global.getApp = prevApp;
  const patches = [];
  const prev = { data: { nodes: [{ nodeId: 1, a: 1 }, { nodeId: 2, a: 1 }] }, setData(p) { patches.push(p); } };
  const page = Object.assign({}, def, { _prev: prev });
  page._writeBack({ nodeId: 2, a: 2 });
  assert.deepEqual(patches, [{ 'nodes[1]': { nodeId: 2, a: 2 } }]);
  page._writeBack({ nodeId: 9 });
  assert.equal(patches.length, 1, 'unknown node: nothing sent');
});

test('L02-108: advanced-game emits config once, drops the write-only field, and checks success one way', () => {
  const fs = require('fs'); const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '../../pages/play/components/advanced-game/index.js'), 'utf8');
  assert.equal((src.match(/^\s+config: state && state\.config,$/gm) || []).length, 1);
  assert.doesNotMatch(src, /_unknownChallengeGame =/);
  assert.doesNotMatch(src.replace(/^const isOk = .*$/m, ''), /res\.code == 200|res\.code == '200'|Number\(res\.code\) [!=]== 200/);
  assert.match(src, /const isOk = \(res\) => !!res && Number\(res\.code\) === 200;/);
});

test('L02-064: dot-qr computes each cell distance once per code size, not every frame', () => {
  let def; global.Component = (d) => { def = d; };
  global.wx = { getStorageSync() {}, setStorageSync() {} };
  delete require.cache[require.resolve('../../pages/play/components/cy/dot-qr/index.js')];
  require('../../pages/play/components/cy/dot-qr/index.js');
  const n = 21; const cells = new Array(n * n).fill(1);
  const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
  const vm = { data: {}, _m: { n, cells, hole: 0 }, _ctx: ctx, _S: 210 };
  const hypot = Math.hypot; let calls = 0; Math.hypot = (...a) => { calls += 1; return hypot(...a); };
  try {
    def.methods._draw.call(vm, 100);
    const first = calls;
    def.methods._draw.call(vm, 132);
    assert.ok(first >= n * n);
    assert.ok(calls - first <= 1, 'second frame reuses the distances');
  } finally { Math.hypot = hypot; }
});

test('L02-090: theme rewards and theme gameplay share one ended() check', () => {
  const g = require('../../pages/play/utils/theme-gameplay.js');
  const r = require('../../pages/play/utils/theme-rewards.js');
  assert.equal(r.ended, g.ended);
  for (const v of [{ claimOnly: true }, { status: 'COMPLETED' }, { result: {} }, { naturallyCompleted: true }]) assert.equal(g.ended(v), true);
  assert.equal(g.ended({ status: 'RUNNING' }), false);
});

test('L02-086: kit labels are keyed by segment name once; lowercase kit types resolve through TYPE_OF', () => {
  global.wx = global.wx || { getStorageSync() {}, setStorageSync() {} };
  const p = require('../../pages/play/utils/play-stage-pops.js');
  for (const k of ['pricepair', 'coinflip', 'diceroll', 'ballshake', 'photocheck', 'quiethold', 'typein', 'musiccorner']) assert.equal(k in p.KIT_LABELS, false, k);
  const label = (type) => p.kitTypeLabel({ previewKit: { type } });
  assert.equal(label('pricepair'), '猜图'); assert.equal(label('quiethold'), '安静挑战'); assert.equal(label('musiccorner'), '音乐角');
  assert.equal(p.kitTypeLabel({ advancedConfig: { musicCorner: { enabled: true } } }), '音乐角', 'segment key works for config too');
  assert.equal(label('nosuch'), '');
});

test('L02-089: one reason-code map in theme-gameplay; theme-plans overrides only its differing wording', () => {
  const g = require('../../pages/play/utils/theme-gameplay.js');
  const p = require('../../pages/play/utils/theme-plans.js');
  assert.equal(p.reasonText('SESSION_ENDED'), g.reasons.SESSION_ENDED, 'shared wording comes from the one map');
  assert.equal(p.reasonText('LIMIT_REACHED'), '该操作已完成', 'plan wording unchanged');
  assert.equal(g.reasonText('LIMIT_REACHED'), '次数已用完');
  assert.equal(p.reasonText(''), '信息尚未更新');
  const fs = require('fs'); const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '../../pages/play/utils/theme-plans.js'), 'utf8');
  assert.doesNotMatch(src, /SESSION_ENDED: '本局已结束'/, 'no second copy of the shared wording');
});

test('L02-091: theme modules share one session-client adapter, built once per methods()', () => {
  const fs = require('fs'); const path = require('path');
  for (const f of ['theme-backpack', 'theme-plans', 'theme-player-ops', 'theme-trade']) {
    const src = fs.readFileSync(path.join(__dirname, '../../pages/play/utils/' + f + '.js'), 'utf8');
    assert.match(src, /const client = themeCommand\.clientFor\(req\);/, f);
    assert.doesNotMatch(src, /createGameSessionClient\(\{ sendRequest/, f);
  }
  const { clientFor } = require('../../pages/play/utils/theme-command.js');
  const client = clientFor(() => Promise.resolve({ code: 200 }));
  assert.equal(client(), client());
});
