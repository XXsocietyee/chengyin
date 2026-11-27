// AUDIT-1122 F01:pages/play/index 行为测试(不读源码文本,只跑真实 Page 定义上的方法)。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const memoryStorage = require('../helpers/memory-storage');
const PAGE = path.resolve(__dirname, '../../pages/play/index.js');
const tick = () => new Promise(resolve => setImmediate(resolve));

function load(extraWx = {}, respond) {
  const requests = [];
  const storage = memoryStorage();
  const app = {
    DEV_TOKEN: 'dev-token', getUserID: () => 7, getAuthorization: () => 'tok',
    sendRequest(options) { requests.push(options); if (respond) Promise.resolve().then(() => options.success(respond(options))); },
  };
  let definition;
  global.getApp = () => app; global.getCurrentPages = () => [];
  global.Page = value => { definition = value; };
  global.wx = Object.assign({
    getStorageSync: storage.getStorageSync, setStorageSync: storage.setStorageSync,
    removeStorageSync: storage.removeStorageSync, getStorageInfoSync: storage.getStorageInfoSync,
    nextTick(fn) { if (fn) fn(); }, showToast() {}, showModal() {},
  }, extraWx);
  delete require.cache[PAGE]; require(PAGE);
  return { definition, requests, app, keys: () => global.wx.getStorageInfoSync().keys };
}

function realPage(definition, data, names) {
  const page = { data: Object.assign({}, definition.data, data), setData(patch) { Object.assign(this.data, patch); } };
  for (const [name, value] of Object.entries(definition)) if (typeof value === 'function') page[name] = names.includes(name) ? value : () => {};
  return page;
}

const ROUTE = ['_boundPlayOwner', '_playMember', '_capturePlayLoginContext', '_isPlayAccountCurrent', '_sessionParams', '_sessionKey',
  '_ensureRouteActionStore', '_routeWritePayload', '_basicIntentHome', '_resolveRouteAction', '_readBasicRouteIntent'];

test('L01-001 局号从空变成 N 后回读原意图:不在新作用域新建意图,回读用原 routeActionId', async () => {
  const h = load();
  const page = realPage(h.definition, { topicId: 31 }, ROUTE);
  page._routeState = { sessionId: '', version: 1 };
  page._boundPlayOwner();
  const first = page._routeWritePayload('answer', 5, { answer: 'orig' });
  first._markIntentUnknown();
  const keysBefore = h.keys().filter(k => k.startsWith('cy_play_intents_v1:')).sort();
  page._routeState = { sessionId: '7', version: 2 };
  page._readBasicRouteIntent('answer', 5);
  const keysAfter = h.keys().filter(k => k.startsWith('cy_play_intents_v1:')).sort();
  assert.deepEqual(keysAfter, keysBefore, '回读不能在新作用域落盘新意图');
  const read = h.requests.at(-1);
  assert.equal(read.url, '/api/play/action-receipt');
  assert.equal(read.data.routeActionId, first.routeActionId);
  // 下一次真实写仍带上玩家这次的答案,不会被回读造出的空壳顶掉
  const next = page._routeWritePayload('answer', 5, { answer: 'x' });
  assert.equal(next.answer, 'x');
});

test('L01-001 本页没有待确认意图时回读如实返回未确认,不发请求也不新建', async () => {
  const h = load();
  const page = realPage(h.definition, { topicId: 31 }, ROUTE);
  page._routeState = { sessionId: '7', version: 2 };
  page._boundPlayOwner();
  const result = await page._readBasicRouteIntent('checkin', 9);
  assert.equal(result.intentTerminal, false);
  assert.equal(result.notFound, true);
  assert.equal(h.requests.length, 0);
  assert.equal(h.keys().filter(k => k.startsWith('cy_play_intents_v1:')).length, 0);
});

test('L01-001 结清走原意图所在的存储', () => {
  const h = load();
  const page = realPage(h.definition, { topicId: 31 }, ROUTE);
  page._routeState = { sessionId: '', version: 1 };
  page._boundPlayOwner();
  const first = page._routeWritePayload('arrive', 3, {});
  page._routeState = { sessionId: '8', version: 2 };
  const home = page._basicIntentHome('arrive', 3);
  assert.ok(home);
  page._resolveRouteAction('arrive', 3);
  assert.equal(page._basicIntentHome('arrive', 3), null);
  // 原存储里已结清:同作用域再取是新身份
  const again = home.payload('arrive', 3, page._routeState, { topicId: 31, nodeId: 3 });
  assert.notEqual(again.routeActionId, first.routeActionId);
});

function lifecycle(definition, stack) {
  const names = ['onShow', 'onHide', '_suspendForeground'];
  const page = realPage(definition, { topicId: 31, loading: false }, names);
  let loads = 0, pending = 0;
  page.loadData = () => { loads++; };
  page._consumePendingStart = () => { pending++; };
  page._playOwner = undefined;
  global.getCurrentPages = () => (stack === 'left' ? [page, {}] : [page]);
  return { page, get loads() { return loads; }, get pending() { return pending; } };
}

test('L01-002 扫码/拍照这类短暂切后台回来不整页重读', () => {
  const h = load();
  const l = lifecycle(h.definition, 'same');
  l.page.onHide(); l.page.onShow();
  assert.equal(l.loads, 0); assert.equal(l.pending, 1);
});

test('L01-002 离开过本页、隐藏超过一分钟、加载被打断、或有待开玩法时整页重读', () => {
  const h = load();
  let l = lifecycle(h.definition, 'left');
  l.page.onHide(); global.getCurrentPages = () => [l.page]; l.page.onShow();
  assert.equal(l.loads, 1);

  l = lifecycle(h.definition, 'same');
  l.page.onHide(); l.page._playReloadOnShow.at -= 61000; l.page.onShow();
  assert.equal(l.loads, 1);

  l = lifecycle(h.definition, 'same');
  l.page._playLoadStarted = 4; l.page._playLoadSettled = 3;
  l.page.onHide(); l.page.onShow();
  assert.equal(l.loads, 1);

  l = lifecycle(h.definition, 'same');
  l.page.onHide(); l.page._pendingStartNode = { nodeId: 1 }; l.page.onShow();
  assert.equal(l.loads, 1);

  l = lifecycle(h.definition, 'same');
  l.page.data.loading = true;
  l.page.onHide(); l.page.onShow();
  assert.equal(l.loads, 1);
});

test('L01-002 没切过后台时首屏仍按原规则:加载中不重读,已加载才重读', () => {
  const h = load();
  let l = lifecycle(h.definition, 'same');
  l.page.data.loading = true; l.page.onShow();
  assert.equal(l.loads, 0);
  l = lifecycle(h.definition, 'same');
  l.page.onShow();
  assert.equal(l.loads, 1);
});

test('L01-003 轮询来的空认领步数同步两分钟内只 wx.login 一次;提交前同步不受限', async () => {
  let logins = 0;
  const h = load({
    getSetting: o => o.success({ authSetting: { 'scope.werun': true } }),
    login: o => { logins++; o.success({ code: 'c' + logins }); },
    getWeRunData: o => o.success({ encryptedData: 'e', iv: 'i' }),
  }, () => ({ code: 500 }));
  const page = realPage(h.definition, { topicId: 31 }, ['_syncThoughts', '_weRunCipher', '_boundPlayOwner', '_playMember',
    '_capturePlayLoginContext', '_isPlayAccountCurrent', '_sessionParams', '_sessionKey']);
  page._routeState = { sessionId: '7' };
  page._boundPlayOwner();
  await page._syncThoughts([]);
  await page._syncThoughts([]);
  await page._syncThoughts([]);
  assert.equal(logins, 1);
  await page._syncThoughts([], () => true);
  assert.equal(logins, 2);
  page._stepSyncAt -= 121000;
  await page._syncThoughts([]);
  assert.equal(logins, 3);
});

test('L01-003 伏笔没变时步数回包不重排整章', async () => {
  let reply = { sessionId: '7', thoughts: [{ key: 'a' }] };
  const h = load({
    getSetting: o => o.success({ authSetting: { 'scope.werun': true } }),
    login: o => o.success({ code: 'c' }),
    getWeRunData: o => o.success({ encryptedData: 'e', iv: 'i' }),
  }, () => ({ code: 200, data: reply }));
  const page = realPage(h.definition, { topicId: 31, chapterFull: true, chapStory: { show: false } }, ['_syncThoughts', '_weRunCipher',
    '_boundPlayOwner', '_playMember', '_capturePlayLoginContext', '_isPlayAccountCurrent', '_sessionParams', '_sessionKey']);
  page._routeState = { sessionId: '7', thoughts: [{ key: 'a' }] };
  page._boundPlayOwner();
  let reopened = 0;
  page.openChapterFull = () => { reopened++; };
  page._applyRouteState = (state, cb) => { page._routeState = Object.assign({}, page._routeState, state); cb(true); };
  await page._syncThoughts(['a']);
  assert.equal(reopened, 0);
  reply = { sessionId: '7', thoughts: [{ key: 'a' }, { key: 'b' }] };
  await page._syncThoughts(['b']);
  assert.equal(reopened, 1);
});

test('L01-009 回前台五分钟内不重复拉功能开关,拉取中不先把社区入口关掉', async () => {
  const h = load();
  let loads = 0, resolveFlags;
  h.app.globalData = { features: { communityPostRead: true, communityPostWrite: true } };
  h.app._communityFeatureOwner = '7';
  h.app._communityFeatureAuthorization = 'tok';
  h.app.loadFeatureFlags = () => {
    loads++;
    h.app.globalData.features = { communityPostRead: false, communityPostWrite: false };
    h.app._communityFeatureOwner = null;
    h.app._communityFeatureAuthorization = null;
    return new Promise(r => { resolveFlags = r; });
  };
  let can = true;
  h.app.canUseCommunity = () => can;
  const page = realPage(h.definition, { communityPostWrite: true }, ['_syncCommunityEntry']);
  page._syncCommunityEntry();
  assert.equal(loads, 1);
  assert.equal(page.data.communityPostWrite, true, '回包前不改入口');
  assert.equal(h.app.globalData.features.communityPostWrite, true, '回包前不把全站开关清掉');
  assert.equal(h.app._communityFeatureOwner, '7');
  resolveFlags({}); await tick();
  assert.equal(page.data.communityPostWrite, true);
  can = false;
  page._syncCommunityEntry();
  assert.equal(loads, 1, '五分钟内只读缓存');
  assert.equal(page.data.communityPostWrite, false);
  page._communityFlagsAt -= 5 * 60000 + 1;
  page._syncCommunityEntry();
  assert.equal(loads, 2);
  assert.equal(h.app.globalData.features.communityPostWrite, true, '再次拉取仍先放回旧开关');
});

test('L01-013 路线状态回包被判为旧投影拒收时,解锁并还原同步前的站点', async () => {
  const h = load({}, () => ({ code: 200, data: { sessionId: '5', version: 4, routeMode: 'BRANCH_GRAPH' } }));
  const page = realPage(h.definition, { topicId: 31 }, ['refreshRouteState', '_failClosedRouteState', '_applyRouteState',
    '_acceptRouteStateProjection', '_routeStateVersionKnown', '_boundPlayOwner', '_playMember', '_capturePlayLoginContext',
    '_isPlayAccountCurrent', '_sessionParams', '_sessionKey']);
  page._boundPlayOwner();
  page._routeState = { sessionId: '5', version: 5, routeMode: 'BRANCH_GRAPH' };
  const nodes = [{ nodeId: 1, done: false, playable: true, locked: false }];
  page.data.nodes = nodes; page.data.nextNode = nodes[0];
  const ok = await page.refreshRouteState();
  assert.equal(ok, false);
  assert.equal(page.data.routeRefreshing, false);
  assert.equal(page.data.nodes, nodes);
  assert.equal(page.data.nextNode, nodes[0]);
});

test('L01-023 到达写在途时不开相机;扫码回来账号已换就不提交', () => {
  let scans = 0, scanOpts = null;
  const h = load({ scanCode: o => { scans++; scanOpts = o; } });
  const page = realPage(h.definition, { topicId: 31 }, ['onScanArrive', 'scanArrive', '_boundPlayOwner', '_playMember',
    '_capturePlayLoginContext', '_isPlayAccountCurrent', '_sessionParams', '_sessionKey']);
  page._boundPlayOwner();
  page._arriveTarget = () => ({ nodeId: 3 });
  let checkins = 0; page.checkin = () => { checkins++; };
  page._arrivalWriteInFlight = true;
  page.onScanArrive();
  assert.equal(scans, 0);
  page._arrivalWriteInFlight = false;
  page.onScanArrive();
  assert.equal(scans, 1);
  page._playDisposed = true;
  scanOpts.success({ result: 'code' });
  assert.equal(checkins, 0);
  page._playDisposed = false;
  scanOpts.success({ result: 'code' });
  assert.equal(checkins, 1);
});

test('L01-034 故事流被整屏层盖住时判定为遮挡,浮尘循环据此跳过绘制', () => {
  const h = load();
  const page = realPage(h.definition, { chapterFull: true, chapStory: { show: false } }, ['_chfullCovered']);
  assert.equal(page._chfullCovered(), false);
  page.data.screen = 'gamePlay'; assert.equal(page._chfullCovered(), true);
  page.data.screen = ''; page.data.album = { show: true }; assert.equal(page._chfullCovered(), true);
  page.data.album = { show: false }; page.data.playKit = { show: true, pop: true }; assert.equal(page._chfullCovered(), false);
  page.data.playKit = { show: true, pop: false }; assert.equal(page._chfullCovered(), true);
  page.data.chapStory = { show: true }; assert.equal(page._chfullCovered(), false);
});

test('L01-019 本站任务打字只写这一节点的凭证字段,不整表替换 gameModule.nodes', () => {
  const h = load();
  const nodes = [
    { nodeId: 30, marker: 'OTHER', playerTask: { inputType: 'TEXT', prompt: '别的站' }, taskEvidence: { text: '留下' } },
    { nodeId: 31, marker: 'TARGET', clue: '线索原文', playerTask: { taskCode: 'WORD', inputType: 'TEXT', prompt: '看铭牌' }, taskEvidence: { text: '' } },
  ];
  const page = realPage(h.definition, { gameModule: { nodes } }, ['onPlayerTaskTextInput']);
  const patches = [];
  page.setData = (patch) => { patches.push(patch); };
  const event = (value, node = 31) => ({ currentTarget: { dataset: { node } }, detail: { value } });

  page.onPlayerTaskTextInput(event('  现场口令  '));
  page.onPlayerTaskTextInput(event('ab'));
  assert.equal(patches.length, 2);
  for (const patch of patches) {
    assert.deepEqual(Object.keys(patch), ['gameModule.nodes[1].taskEvidence']);
    const blob = JSON.stringify(patch);
    assert.equal(blob.includes('OTHER'), false);
    assert.equal(blob.includes('TARGET'), false);
    assert.equal(blob.includes('线索原文'), false);
    assert.equal(blob.includes('看铭牌'), false);
    assert.equal(blob.includes('留下'), false);
    assert.equal('gameModule.nodes' in patch, false);
  }
  const filled = patches[0]['gameModule.nodes[1].taskEvidence'];
  assert.equal(filled.type, 'TEXT');
  assert.equal(filled.ready, true);
  assert.equal(filled.text, '  现场口令  ');
  assert.deepEqual(filled.evidenceUrls, ['text:' + encodeURIComponent('现场口令')]);
  assert.equal(filled.statusText, '文字凭证已填写');
  assert.equal(page.data.gameModule.nodes, nodes);

  patches.length = 0;
  page.onPlayerTaskTextInput(event('   '));
  const blank = patches[0]['gameModule.nodes[1].taskEvidence'];
  assert.equal(blank.ready, false);
  assert.equal(blank.text, '   ');
  assert.deepEqual(blank.evidenceUrls, []);
  assert.equal(blank.statusText, '');

  patches.length = 0;
  page.onPlayerTaskTextInput(event('x'.repeat(301)));
  assert.equal(patches[0]['gameModule.nodes[1].taskEvidence'].text.length, 300);

  patches.length = 0;
  page.onPlayerTaskTextInput(event('第一站', 30));
  assert.deepEqual(Object.keys(patches[0]), ['gameModule.nodes[0].taskEvidence']);

  patches.length = 0;
  nodes[0].playerTask = { inputType: 'SCAN' };
  page.onPlayerTaskTextInput(event('扫码站', 30));
  page.onPlayerTaskTextInput(event('没有这站', 99));
  page.onPlayerTaskTextInput({ currentTarget: { dataset: {} }, detail: {} });
  assert.equal(patches.length, 0);
});

test('L01-020 同一主题新的一局不接上一局的轨迹;超过 24 小时的本机轨迹丢弃', () => {
  const h = load();
  const page = realPage(h.definition, { topicId: 31 }, ['_playTrail', '_sessionKey', '_sessionParams']);
  page._routeState = { sessionId: '7' };
  const first = page._playTrail();
  first.note({ latitude: 31.2, longitude: 121.4 }); first.note({ latitude: 31.21, longitude: 121.41 }); first.persist();
  assert.equal(first.points().length, 2);
  page._routeState = { sessionId: '8' };
  assert.equal(page._playTrail().points().length, 0);
  // 回到 7 那一局但副本已过期
  const saved = global.wx.getStorageInfoSync().keys.find(k => k.startsWith('cy_play_trail'));
  const record = global.wx.getStorageSync(saved);
  if (record && record.key) { record.key = 't:31#7'; record.startedAt = Date.now() - 25 * 3600 * 1000; record.points = [{ lat: 1, lng: 1 }]; global.wx.setStorageSync(saved, record); }
  page._routeState = { sessionId: '7' };
  assert.equal(page._playTrail().points().length, 0);
});

test('L01-028 收起结算还原故事地图的回看叠加,下一次结算重新取底', () => {
  const h = load();
  const page = realPage(h.definition, {}, ['_hideFinish']);
  page._finishViewContext = () => ({});
  page._reviewBase = [{ points: [1] }];
  page.data.fmPolyline = [{ points: [1] }, { points: [2], review: true }];
  page.data.fmNodes = [{ nodeId: 1, reviewLabel: '徽章' }, { nodeId: 2, reviewLabel: '' }];
  page._hideFinish();
  assert.deepEqual(page.data.fmPolyline, [{ points: [1] }]);
  assert.equal(page.data.fmNodes[0].reviewLabel, '');
  assert.equal(page._reviewBase, null);
});

test('L01-117 结算页与行程报告用同一份本局参数,报告多带报名号', () => {
  const urls = [];
  const h = load({ navigateTo: o => urls.push(o.url) });
  const page = realPage(h.definition, { topicId: 31, regId: 9, topicName: '夜游', allDone: true }, ['_runQuery', 'openSettlement', 'openRunReport']);
  page._routeState = { sessionId: '77' };
  page.openSettlement(); page.openRunReport();
  assert.deepEqual(urls, ['/subpackageJourney/pages/settle/index?topicId=31&runId=77&topicName=%E5%A4%9C%E6%B8%B8',
    '/subpackageJourney/pages/report/index?topicId=31&runId=77&registrationId=9&topicName=%E5%A4%9C%E6%B8%B8']);
});

test('L01-115 回看总距离走 utils/geo.js 的 haversine', () => {
  const h = load();
  const page = realPage(h.definition, {}, ['_reviewDistanceKm']);
  assert.equal(page._reviewDistanceKm([{ lat: 31.2, lng: 121.4 }]), '');
  assert.equal(page._reviewDistanceKm([{ lat: 31.2, lng: 121.4 }, { lat: 31.21, lng: 121.4 }]), '1.1');
});

test('L01-096 带队「出发」在途时连点只发一次 POST,回包后可再点', async () => {
  const h = load();
  const page = realPage(h.definition, { activityId: 5 }, ['leadStart', '_boundPlayOwner', '_playMember', '_capturePlayLoginContext', '_isPlayAccountCurrent']);
  page._boundPlayOwner();
  page._leadOperationContext = () => ({ activityId: 5 });
  page._isLeadOperationContextCurrent = () => true;
  page.diegetic = () => {}; page.loadTeamProgress = () => {};
  page.leadStart(); page.leadStart();
  assert.equal(h.requests.filter(r => r.url === '/api/club/lead/start').length, 1);
  h.requests[0].success({ code: 200 }); await tick();
  page.leadStart();
  assert.equal(h.requests.filter(r => r.url === '/api/club/lead/start').length, 2);
});

test('L01-149 入场码在途时连点只发一次出码,回包后可再开', async () => {
  const h = load();
  h.app.getSession = () => ({ getRevision: () => 1 });
  const page = realPage(h.definition, { regId: 9, ticket: { show: true } }, ['ensureTicket', '_boundPlayOwner', '_playMember', '_capturePlayLoginContext', '_isPlayAccountCurrent']);
  page._boundPlayOwner();
  page.ensureTicket(); page.ensureTicket();
  const issued = () => h.requests.filter(r => r.url === '/api/verify/dyncode/issue');
  assert.equal(issued().length, 1);
  issued()[0].success({ code: 200, data: { code: 'ABC', qrcodeUrl: 'u', expiresAt: 1 } });
  await tick();
  page.ensureTicket();
  assert.equal(issued().length, 2);
});

test('L01-150 分身开场离开后不再 setData、不再重开呼吸;前台仍会开', () => {
  const h = load();
  const page = realPage(h.definition, { hero: { node: { nodeId: 1, npcName: '阿宁', name: '店' } }, nodes: [] }, ['openShopNpc']);
  const set = page.setData;
  const patches = [];
  page.setData = function (patch, done) { patches.push(patch); set.call(this, patch); if (done) done(); };
  const saved = global.setTimeout;
  let openTimer;
  global.setTimeout = (fn) => { openTimer = fn; return 1; };
  try { page.openShopNpc(); } finally { global.setTimeout = saved; }
  let starts = 0;
  page._startNpcFigure = () => { starts++; };
  patches.length = 0;
  page._playDisposed = true;
  openTimer();
  assert.equal(starts, 0);
  assert.deepEqual(patches, []);
  page._playDisposed = false;
  page._themeHidden = true;
  openTimer();
  assert.equal(starts, 0);
  assert.deepEqual(patches, [{ 'shopNpc.open': true }]);
  page._themeHidden = false;
  openTimer();
  assert.equal(starts, 1);
});

test('L01-150 画布查询回来时已离开就不开呼吸,前台仍跑循环', () => {
  let exec;
  const chain = { in() { return chain; }, select() { return chain; }, fields() { return chain; }, exec(fn) { exec = fn; } };
  const rafs = [];
  const ctx = new Proxy({}, { get: () => () => {}, set: () => true });
  const node = { getContext: () => ctx, requestAnimationFrame(fn) { rafs.push(fn); return rafs.length; }, width: 0, height: 0 };
  const h = load({ createSelectorQuery: () => chain, getWindowInfo: () => ({ pixelRatio: 2 }) });
  const page = realPage(h.definition, { shopNpc: { show: true }, reducedMotion: false }, ['_startNpcFigure']);
  page._themeHidden = true;
  page._startNpcFigure();
  exec([{ node, width: 40, height: 80 }]);
  assert.equal(rafs.length, 0);
  page._themeHidden = false;
  page._playDisposed = true;
  page._startNpcFigure();
  exec([{ node, width: 40, height: 80 }]);
  assert.equal(rafs.length, 0);
  page._playDisposed = false;
  page._startNpcFigure();
  exec([{ node, width: 40, height: 80 }]);
  assert.equal(rafs.length, 1);
});

test('L01-097 章节结束在途时连点不重复发,失败后可重试', async () => {
  const h = load();
  const page = realPage(h.definition, { chapter: { id: 1 }, nodes: [], nextNode: null }, ['continueChapterStory', '_boundPlayOwner', '_playMember',
    '_capturePlayLoginContext', '_isPlayAccountCurrent', '_sessionParams', '_sessionKey']);
  page._boundPlayOwner();
  page._routeState = { sessionId: '7', opening: { complete: true } };
  let ends = 0, resolveEnd;
  page._endThemeChapter = () => { ends++; return new Promise(r => { resolveEnd = r; }); };
  page.continueChapterStory(); page.continueChapterStory();
  assert.equal(ends, 1);
  resolveEnd(false); await tick();
  page.continueChapterStory();
  assert.equal(ends, 2);
});

test('L01-078/087 分身拖动不 setData;降低动态没有循环时就地重画', () => {
  const h = load();
  const page = realPage(h.definition, { shopNpc: { show: true } }, ['onNpcTouchStart', 'onNpcTouchMove', 'onNpcTouchEnd']);
  let sets = 0; const set = page.setData; page.setData = function (p) { sets++; return set.call(this, p); };
  const draws = []; page._drawNpcFig = (ry, bob) => draws.push([ry, bob]); page._rafNpcFig = 0;
  page.onNpcTouchStart({ touches: [{ pageX: 100 }] });
  page.onNpcTouchMove({ touches: [{ pageX: 140 }] });
  page.onNpcTouchMove({ touches: [{ pageX: 400 }] });
  assert.equal(sets, 0);
  assert.deepEqual(draws, [[14, 0], [38, 0]]);
  page._rafNpcFig = 5; page.onNpcTouchStart({ touches: [{ pageX: 0 }] }); page.onNpcTouchMove({ touches: [{ pageX: -100 }] });
  assert.equal(draws.length, 2, '有呼吸循环时由循环读 _npcRy');
  assert.equal(page._npcRy, 3);
});

test('L01-081 发不出去时收回「正在输入」', () => {
  const h = load();
  const page = realPage(h.definition, { shopNpc: { show: true, input: '你好', msgs: [], thinking: false } }, ['sendShopNpc', '_askShopNpc', '_releaseNpcThinking']);
  page._shopNpcRequestContext = () => null;
  let stopped = 0; page._stopThinkBeat = () => { stopped++; };
  page.sendShopNpc();
  assert.equal(page.data.shopNpc.thinking, false);
  assert.equal(stopped, 1);
  assert.equal(h.requests.length, 0);
});

test('L01-079 切后台停掉分身逐帧循环,回前台对话还开着就续上', () => {
  const h = load();
  const page = realPage(h.definition, { topicId: 31, loading: false, shopNpc: { show: true, open: true } }, ['onHide', 'onShow', '_suspendForeground']);
  let stops = 0, starts = 0;
  page._stopNpcFigure = () => { stops++; }; page._startNpcFigure = () => { starts++; };
  global.getCurrentPages = () => [page];
  page.onHide(); page.onShow();
  assert.equal(stops, 1); assert.equal(starts, 1);
});

test('L01-077 重启故事流粒子不翻状态栏;关故事流才复位', () => {
  const h = load();
  const page = realPage(h.definition, { reducedMotion: true, chapStory: { show: false }, chapterFull: true }, ['_startStoryDust', '_stopStoryDust']);
  const bars = []; page._storyStatusBar = on => bars.push(on);
  page._startStoryDust(); page._startStoryDust();
  assert.deepEqual(bars, [true, true]);
  page._stopStoryDust();
  assert.deepEqual(bars, [true, true, false]);
});

test('L01-076 旧版本地键同一页只清一次,不随轮询反复读写存储', () => {
  const h = load();
  let reads = 0, removes = 0;
  const get = global.wx.getStorageSync, rm = global.wx.removeStorageSync;
  global.wx.getStorageSync = k => { reads++; return get(k); };
  global.wx.removeStorageSync = k => { removes++; return rm(k); };
  global.wx.setStorageSync('game_player_pending_701', { x: 1 });
  const page = realPage(h.definition, {}, ['_dropLegacyKey']);
  page._dropLegacyKey('game_player_pending_701'); page._dropLegacyKey('game_player_pending_701');
  assert.equal(reads, 1); assert.equal(removes, 1);
  assert.equal(global.wx.getStorageSync('game_player_pending_701'), '');
});

test('L01-011 相机/扫码等短系统界面触发的 onHide 不 POST 暂停快照;真正离开仍写', async () => {
  const h = load();
  const page = realPage(h.definition, { topicId: 31 }, ['onHide', '_suspendForeground', '_persistRunSession', '_runSessionScope', '_queueRunSync',
    '_boundPlayOwner', '_playMember', '_capturePlayLoginContext', '_isPlayAccountCurrent', '_adoptFirstLogin', '_sessionParams', '_sessionKey', '_armSystemUiCover']);
  page._boundPlayOwner();
  page._runStarted = true;
  page._routeState = { sessionId: '7' };
  page._sessionClock = { isPaused: () => false, pause() {}, elapsedSeconds: () => 12 };
  global.getCurrentPages = () => [page];
  global.wx.scanCode = (opts) => { page.onHide(); if (opts && opts.complete) opts.complete(); };
  page._armSystemUiCover();
  const saves = () => h.requests.filter(r => r.url === '/api/play/run-session/save').length;
  const flush = async () => { for (let i = 0; i < 4; i++) await tick(); };
  global.wx.scanCode({ onlyFromCamera: true });
  await flush();
  assert.equal(saves(), 0, '扫码盖住本页时不写服务端');
  global.getCurrentPages = () => [page, { route: 'pages/other/index' }];
  page._systemUiCover = 0;
  page.onHide();
  await flush();
  assert.equal(saves(), 1, '真正离开仍写服务端');
});

test('L01-011 切后台 30 秒内同一暂停态只写一次服务端快照;暂停态变了、离页、结束后照写', async () => {
  const h = load();
  const page = realPage(h.definition, { topicId: 31 }, ['_persistRunSession', '_runSessionScope', '_queueRunSync', '_clearRunSessionEverywhere',
    '_boundPlayOwner', '_playMember', '_capturePlayLoginContext', '_isPlayAccountCurrent', '_sessionParams', '_sessionKey']);
  page._boundPlayOwner(); page._runStarted = true; page._routeState = { sessionId: '7' };
  let paused = false;
  page._sessionClock = { isPaused: () => paused, pause() { paused = true; }, elapsedSeconds: () => 60 };
  const saves = () => h.requests.filter(r => /run-session\/save/.test(r.url)).length;
  const flush = async () => { for (let i = 0; i < 6; i++) { h.requests.filter(r => !r._done).forEach(r => { r._done = true; r.success && r.success({ code: 200 }); }); await tick(); } };
  page._persistRunSession(true); await flush();
  page._persistRunSession(true); await flush();
  page._persistRunSession(true); await flush();
  assert.equal(saves(), 1);
  page._persistRunSession(false); await flush();
  assert.equal(saves(), 2, '暂停了要写');
  page._persistRunSession(false, true); await flush();
  assert.equal(saves(), 3, '离页强制写');
});

test('L01-055 onLoad 首帧前 imgCtx / chrome / 入参一次 setData', () => {
  const h = load({ getWindowInfo: () => ({ windowWidth: 375, windowHeight: 812, statusBarHeight: 44, pixelRatio: 3 }),
    getMenuButtonBoundingClientRect: () => ({ top: 48, bottom: 80, left: 281, right: 368, height: 32, width: 87 }) });
  const page = realPage(h.definition, {}, ['onLoad', '_playMember', '_capturePlayLoginContext']);
  const patches = []; const set = page.setData; page.setData = function (p) { patches.push(Object.keys(p)); return set.call(this, p); };
  page.onLoad({ topicId: '31' });
  const first = patches[0] || [];
  for (const k of ['imgCtx', 'chrome', 'topicId', 'reducedMotion']) assert.ok(first.includes(k), k + ' 在第一次 setData 里');
  assert.equal(patches.filter(p => p.includes('imgCtx') || p.includes('chrome')).length, 1);
});

test('L01-060 切后台与卸载走同一份收尾:停定位、停轮询、作废在途加载', () => {
  for (const hook of ['onHide', 'onUnload']) {
    const h = load();
    const page = realPage(h.definition, { topicId: 31 }, [hook, '_suspendForeground']);
    global.getCurrentPages = () => [page];
    const calls = [];
    for (const m of ['_stopTracking', '_stopThemePoll', '_stopLeadPoll', '_stopStoryDust', '_stopNpcFigure', '_clearPackTimers', 'suspendOrientLifecycle'])
      page[m] = () => calls.push(m);
    page._playLoadEpoch = 3;
    page[hook]();
    assert.deepEqual(calls.sort(), ['_clearPackTimers', '_stopLeadPoll', '_stopNpcFigure', '_stopStoryDust', '_stopThemePoll', '_stopTracking', 'suspendOrientLifecycle'], hook);
    assert.equal(page._playLoadEpoch, 4); assert.equal(page._themeHidden, true);
  }
});

test('L01-103 解谜提示:服务端给 0 分上限就显示 0,一次 setData 同时更新题卡与节点', async () => {
  const h = load({}, () => ({ code: 200, data: { hints: ['看门牌'], hintCount: 2, scoreCap: 0, level: 1 } }));
  const page = realPage(h.definition, { topicId: 31, mode: 1, shownHints: [], puzzleScoreCap: 100,
    game: { nodeId: 8, puzzleScoring: true, hintCount: 2 }, nodes: [{ nodeId: 8 }, { nodeId: 9 }] },
    ['useHint', '_boundPlayOwner', '_playMember', '_capturePlayLoginContext', '_isPlayAccountCurrent', '_sessionParams', '_sessionKey']);
  page._boundPlayOwner();
  page._beginLegacyHint = () => ({}); page._isLegacyHintCurrent = () => true; page._finishLegacyHint = () => {};
  let sets = 0; const set = page.setData; page.setData = function (p) { if ('nodes' in p || 'puzzleScoreCap' in p) sets++; return set.call(this, p); };
  page.useHint(); for (let i = 0; i < 4; i++) await tick();
  assert.equal(page.data.puzzleScoreCap, 0);
  assert.equal(page.data.nodes[0].puzzleScoreCap, 0);
  assert.deepEqual(page.data.nodes[0].usedHints, ['看门牌']);
  assert.equal(sets, 1);
});

test('L01-122 通关里程碑:同一账号本页只取一次完成列表,之后复用并算上本局', async () => {
  const h = load();
  const page = realPage(h.definition, { showFinish: true, topicCompleted: true, topicId: 31 }, ['loadMilestone', '_boundPlayOwner', '_playMember',
    '_capturePlayLoginContext', '_isPlayAccountCurrent', '_sessionParams', '_sessionKey']);
  page._boundPlayOwner();
  page.loadMilestone();
  assert.equal(h.requests.length, 1);
  h.requests[0].success({ code: 200, data: [{ topicId: 1 }, { topicId: 2 }, { topicId: 1 }] });
  const first = page.data.milestone;
  page.data.topicId = 32;
  page.loadMilestone();
  assert.equal(h.requests.length, 1, '第二次结算不再请求');
  assert.ok(page.data.milestone);
  assert.notDeepEqual(page.data.milestone, null);
  assert.ok(first);
});

test('L01-135 锁住的手记行即便被直接调用 openStory 也不展开', () => {
  const h = load();
  const page = realPage(h.definition, { journalCards: [{ nodeId: 5, locked: true }, { nodeId: 6, locked: false }] }, ['openStory']);
  let looked = 0; page._nodeById = () => { looked++; return null; }; page._historyNodeById = () => null;
  page.openStory({ currentTarget: { dataset: { id: 5 } } });
  assert.equal(looked, 0);
  page.openStory({ currentTarget: { dataset: { id: 6 } } });
  assert.equal(looked, 1);
});

test('L01-114 回看描线与分享卡同一排序:自由探索按完成先后,城市定向按站序', () => {
  const h = load();
  const nodes = [{ nodeId: 1, sortId: 2, doneAt: 10, done: true, lat: 1, lng: 1 }, { nodeId: 2, sortId: 1, doneAt: 20, done: true, lat: 2, lng: 2 }];
  const page = realPage(h.definition, { mode: 2, nodes }, ['_reviewOrderedNodes']);
  page._routeState = { routeMode: 'LINEAR' };
  assert.deepEqual(page._reviewOrderedNodes().map(n => n.nodeId), [1, 2]);
  page.data.mode = 1;
  assert.deepEqual(page._reviewOrderedNodes().map(n => n.nodeId), [2, 1]);
});

test('L01-132 离屏画布只在绘制队列有活时挂载,画完卸掉', () => {
  const h = load();
  const page = realPage(h.definition, { snapActive: false }, ['_queueFinishCanvas', '_drainFinishCanvas']);
  const mounted = [];
  const set = page.setData; page.setData = function (p, cb) { set.call(this, p); if ('snapActive' in p) mounted.push(p.snapActive); if (cb) cb(); };
  let release;
  page._queueFinishCanvas(() => true, r => { assert.equal(page.data.snapActive, true, '画之前已挂载'); release = r; });
  assert.deepEqual(mounted, [true]);
  page._queueFinishCanvas(() => true, r => r());
  release();
  assert.deepEqual(mounted, [true, false]);
  assert.equal(page.data.snapActive, false);
});

test('L01-066 开发版演示数据单独成模块,只在 ?mock 入口按需取用', () => {
  const { buildMockPlayData } = require('../../pages/play/dev/mock-play-data.js');
  const city = buildMockPlayData('city'), free = buildMockPlayData('free');
  assert.ok(Array.isArray(city.nodes) && city.nodes.length > 0);
  assert.notEqual(JSON.stringify(city), JSON.stringify(free));
  const h = load();
  assert.equal(typeof h.definition.buildMockPlayData, 'undefined');
});

test('L01-123 场景宿主外层门认得宿主里挂的每一个场景,别的 id 不挂外壳', () => {
  const fs = require('node:fs'), vm = require('node:vm');
  const wxml = fs.readFileSync(path.resolve(__dirname, '../../pages/play/index.wxml'), 'utf8');
  const src = wxml.match(/<wxs module="psheetScene">([\s\S]*?)<\/wxs>/)[1];
  const module = { exports: {} }; vm.runInNewContext(src, { module });
  const host = wxml.slice(wxml.indexOf('class="play-scene-host"'), wxml.indexOf('<cy-modal show="{{sceneConfirm.show}}"'));
  const mounted = [...host.matchAll(/wx:(?:if|elif)="\{\{sceneCurrent\.id === '([^']+)'\}\}"/g)].map(m => m[1]);
  assert.equal(mounted.length, 12);
  for (const id of mounted) assert.equal(module.exports.has(id), true, id);
  assert.equal(module.exports.has('play-session-tools'), false);
  assert.equal(module.exports.has(undefined), false);
});

// L01-127:「提示」入口条件收进页内 wxs helpHere.on;真跑模块,看玩家何时看到「提示」
test('L01-127 helpHere.on:只在提示开启、进阶玩法展开、当前玩法未完成且同一站时显示「提示」', () => {
  const fs = require('node:fs');
  const wxml = fs.readFileSync(path.resolve(__dirname, '../../pages/play/index.wxml'), 'utf8');
  const src = wxml.match(/<wxs module="helpHere">([\s\S]*?)<\/wxs>/)[1];
  const mod = { exports: {} };
  new Function('module', src)(mod);
  const on = mod.exports.on;
  const hp = { enabled: true, nodeId: 5 };
  const ap = { show: true, node: { nodeId: 5 } };
  const pk = { kit: { done: false } };
  assert.equal(on(hp, ap, pk), true);
  assert.equal(on({ enabled: false, nodeId: 5 }, ap, pk), false);
  assert.equal(on(hp, { show: false, node: { nodeId: 5 } }, pk), false);
  assert.equal(on(hp, ap, { kit: { done: true } }), false);
  assert.equal(on(hp, ap, { kit: null }), false);
  assert.equal(on(hp, { show: true, node: { nodeId: 6 } }, pk), false);
  assert.equal(on(hp, { show: true }, pk), false, '进阶玩法没有站点时不显示也不报错');
  assert.equal(on(null, null, null), false);
  assert.equal((wxml.match(/wx:if="\{\{helpHere\.on\(helpPanel, advancedPlay, playKit\)\}\}"/g) || []).length, 2);
});

test('L01-029 生活圈层晚于完成页回来盖住路线卡时补画连线缩略图;已有缩略图或路线卡没开时不重画', async () => {
  const h = load({}, () => ({ code: 200, data: { mapAnchors: [{ nodeId: 1, name: 'a', latitude: 31.2, longitude: 121.4 }] } }));
  const page = realPage(h.definition, { mode: 2, topicId: 31, showFinish: true, routeCard: { on: true, ready: false }, finishSnap: '' },
    ['loadNewLifeOS', '_boundPlayOwner', '_playMember', '_capturePlayLoginContext', '_isPlayAccountCurrent', '_sessionParams', '_sessionKey']);
  page._boundPlayOwner();
  let painted = 0; page.paintRouteThumb = () => { painted++; };
  page.loadNewLifeOS(); await tick(); await tick();
  assert.equal(page.data.newLifeOS.show, true);
  assert.equal(painted, 1, '路线卡被生活圈层盖住,地图盒要有连线图');
  page.data.finishSnap = 'wxfile://snap.png';
  page.loadNewLifeOS(); await tick(); await tick();
  assert.equal(painted, 1, '已有缩略图不重画');
  page.data.finishSnap = ''; page.data.routeCard = { on: false };
  page.loadNewLifeOS(); await tick(); await tick();
  assert.equal(painted, 1, '路线卡没开时完成页自己已画过');
});
