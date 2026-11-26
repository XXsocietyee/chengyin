const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const UPDATE_PATH = require.resolve('../../utils/app-update.js');
const MANAGER_PATH = UPDATE_PATH; // L10-111:update-manager 并入 app-update

// 每个用例拿一份干净的模块状态(更新提示与失效页兜底都是「每次启动一次」)。
function fresh() {
  delete require.cache[UPDATE_PATH];
  return require(MANAGER_PATH);
}

function harness(overrides) {
  let ready, failed, applies = 0, managers = 0;
  const dialogs = [], toasts = [], launches = [], canIUseCalls = [];
  const manager = { onUpdateReady(fn) { ready = fn; }, onUpdateFailed(fn) { failed = fn; }, applyUpdate() { applies++; } };
  const wx = Object.assign({
    canIUse: api => { canIUseCalls.push(api); return true; },
    getUpdateManager: () => { managers++; return manager; },
    showModal: opts => dialogs.push(opts),
    showToast: opts => toasts.push(opts),
    reLaunch: opts => launches.push(opts),
  }, overrides);
  return { wx, dialogs, toasts, launches, canIUseCalls, ready: () => ready(), failed: () => failed(), applies: () => applies, managers: () => managers };
}

test('update ready shows the restart modal and confirm applies the update', () => {
  const m = fresh();
  const h = harness(), app = {};
  assert.equal(m.installUpdateManager(app, h.wx), true);
  assert.deepEqual(h.canIUseCalls, ['getUpdateManager']);
  assert.equal(app.promptUpdateIfAvailable, m.promptUpdateIfAvailable);
  h.ready();
  assert.equal(h.dialogs.length, 1);
  assert.equal(h.dialogs[0].title, '新版本已就绪');
  h.dialogs[0].success({ confirm: true });
  assert.equal(h.applies(), 1);
});

test('download failure stays non-blocking: no modal and no restart', () => {
  const m = fresh();
  const h = harness();
  m.installUpdateManager({}, h.wx);
  h.failed();
  assert.equal(h.dialogs.length, 0);
  assert.equal(h.applies(), 0);
  assert.equal(m.promptUpdateIfAvailable(), false);
});

test('restart prompt shows at most once per launch, including helper re-prompts and double install', () => {
  const m = fresh();
  const { installAppUpdate } = require(UPDATE_PATH);
  const h = harness();
  installAppUpdate(h.wx); // app.js onLaunch 里既有的安装
  m.installUpdateManager({}, h.wx); // C00 接线后的第二次安装
  assert.equal(m.promptUpdateIfAvailable(), false, 'nothing downloaded yet');
  h.ready(); h.ready();
  h.dialogs[0].success({ confirm: false, cancel: true });
  assert.equal(m.promptUpdateIfAvailable(), false);
  assert.equal(h.dialogs.length, 1);
  assert.equal(h.applies(), 0);
});

test('helper shows the prompt when the ready-time modal could not be shown', () => {
  const m = fresh();
  let broken = true;
  const h = harness();
  const showModal = h.wx.showModal;
  h.wx.showModal = opts => { if (broken) throw Error('UI busy'); showModal(opts); };
  m.installUpdateManager({}, h.wx);
  h.ready();
  assert.equal(h.dialogs.length, 0);
  broken = false;
  assert.equal(m.promptUpdateIfAvailable(), true);
  assert.equal(m.promptUpdateIfAvailable(), false);
  assert.equal(h.dialogs.length, 1);
});

test('canIUse false leaves startup untouched: no manager, no prompt', () => {
  const m = fresh();
  const h = harness({ canIUse: () => false });
  assert.equal(m.installUpdateManager({}, h.wx), false);
  assert.equal(h.managers(), 0);
  assert.equal(m.promptUpdateIfAvailable(), false);
  assert.equal(h.dialogs.length, 0);
});

test('handlePageNotFound reLaunches every dead link to home and only stops on a loop (L10-114)', () => {
  const appJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../app.json'), 'utf8'));
  let m = fresh();
  const h = harness();
  assert.equal(m.HOME_PAGE, appJson.pages[0]);
  assert.equal(m.HOME_PAGE, appJson.tabBar.list[0].pagePath);
  assert.equal(m.handlePageNotFound({ path: 'pages/removed/old', query: {}, isEntryPage: true }, h.wx), true);
  assert.deepEqual(h.launches, [{ url: '/' + appJson.pages[0] }]);
  assert.equal(m.handlePageNotFound({ path: 'pages/removed/other' }, h.wx), true, 'a second dead link in the same launch still recovers');
  assert.equal(h.launches.length, 2);

  m = fresh();
  assert.equal(m.handlePageNotFound({ path: '/' + appJson.pages[0] }, h.wx), false, 'home missing → no self-redirect');
  assert.equal(m.handlePageNotFound(undefined, h.wx), false, 'unknown path is treated as home → no loop');
  assert.equal(h.launches.length, 2);
  assert.equal(fresh().handlePageNotFound({ path: 'pages/x' }, {}), false, 'no reLaunch API → no throw');
});

test('app.js installs the shared update manager and recovers missing pages through the tested helper', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../app.js'), 'utf8');
  assert.match(source, /require\(['"]\.\/utils\/app-update\.js['"]\)/);
  assert.match(source, /installUpdateManager\(this,\s*wx\)/);
  assert.match(source, /onPageNotFound\s*\([^)]*\)\s*\{\s*handlePageNotFound\(res,\s*wx\)/);
});
