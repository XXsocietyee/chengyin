'use strict';
// 业主 2026-11-24 决策单(owner-decisions-1123)F10 各项默认选项的行为测试。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
global.Behavior = global.Behavior || ((b) => b);
function load(rel, globals) {
  let def;
  const file = path.join(ROOT, rel);
  vm.runInNewContext(read(rel), Object.assign({ Page: (v) => { def = v; }, Component: (v) => { def = v; },
    getApp: () => ({ globalData: {} }), require: createRequire(file), console, setTimeout, clearTimeout,
    getCurrentPages: () => [], Behavior: (b) => b }, globals), { filename: file });
  return def;
}
// 极简 WXML 求值:取 class 表达式按 data 计算
function classOf(wxml, marker, data) {
  const m = new RegExp('class="(' + marker + '[^"]*)"').exec(wxml);
  assert.ok(m, marker);
  return m[1].replace(/\{\{(.*?)\}\}/g, (_, expr) => String(Function(...Object.keys(data), 'return (' + expr + ')')(...Object.values(data))));
}

test('L10-161:按钮提交中只显示转圈与「处理中」,原文字隐藏;morph 档不受影响', () => {
  const wxml = read('components/cy/btn/index.wxml');
  const wxss = read('components/cy/btn/index.wxss');
  assert.match(wxml, /<view class="btn__label[^"]*"><slot><\/slot><\/view>/);
  assert.match(wxss, /\.btn__label--busy \{ display: none; \}/);
  assert.match(classOf(wxml, 'btn__label', { loading: true, morph: false }), /btn__label--busy/);
  assert.doesNotMatch(classOf(wxml, 'btn__label', { loading: false, morph: false }), /busy/);
  assert.doesNotMatch(classOf(wxml, 'btn__label', { loading: true, morph: true }), /busy/);
  assert.match(wxml, /\{\{loadingLabel \|\| '处理中'\}\}/);
});

test('L10-188:编辑家人参与人不再被账号绑定手机号覆盖;新增仍用绑定号', () => {
  function run(order, address) {
    const reqs = [];
    const def = load('pages/addressinfo/addressinfo.js', { wx: { getStorageSync: () => '', showToast() {}, navigateBack() {} },
      getApp: () => ({ globalData: {}, getUserID: () => '7', sendRequest: (o) => { reqs.push(o); return { abort() {} }; } }) });
    const page = Object.assign({}, def, { data: JSON.parse(JSON.stringify(def.data)),
      setData(v, cb) { for (const k of Object.keys(v)) { const parts = k.split('.'); let t = this.data; while (parts.length > 1) t = t[parts.shift()]; t[parts[0]] = v[k]; } if (cb) cb(); } });
    page.onLoad(address ? { id: '5' } : {});
    const user = reqs.find((r) => r.url === '/api/user/info');
    const info = reqs.find((r) => r.url === '/api/user/address/info');
    const replyUser = () => user.success({ code: '200', data: { phone: '13900000001' } });
    const replyInfo = () => info.success({ code: '200', data: address });
    if (order === 'userFirst') { replyUser(); if (info) replyInfo(); } else { if (info) replyInfo(); replyUser(); }
    return page.data;
  }
  const fam = { fullName: '妈妈', mobilePhone: '13800000002', province: '', detailAddress: '' };
  for (const order of ['userFirst', 'infoFirst']) {
    const d = run(order, fam);
    assert.equal(d.form.mobilePhone, '13800000002', order);
    assert.equal(d.ownPhone, true);
  }
  const fresh = run('userFirst', null);
  assert.equal(fresh.form.mobilePhone, '13900000001', '新增参与人仍取绑定号');
  const noPhone = run('infoFirst', { fullName: '爸爸', mobilePhone: '', province: '', detailAddress: '' });
  assert.equal(noPhone.form.mobilePhone, '13900000001', '原来没号的参与人用绑定号补上');
});

test('L10-138 / L10-180:八个从未接入的组件删除,等级进度条与 scene-topic-customers 按决定保留', () => {
  for (const name of ['node', 'play-pause', 'club-publish-sheet', 'club-topic-groupcode', 'club-topic-merchants', 'club-topic-onboarding', 'club-topic-settings', 'identity-tag']) {
    assert.equal(fs.existsSync(path.join(ROOT, 'components/cy', name)), false, name);
  }
  assert.ok(fs.existsSync(path.join(ROOT, 'components/cy/level-progress/index.js')));
  assert.match(read('components/cy/scene-topic-customers/index.js'), /2026-12-31 前仍无页面挂载即删除/);
  const ignore = JSON.parse(read('project.config.json')).packOptions.ignore.map((e) => e.value).join('\n');
  assert.doesNotMatch(ignore, /components\/cy\/(node|play-pause|identity-tag|club-publish-sheet|club-topic-(groupcode|merchants|onboarding|settings))\//);
});

test('L10-039:俱乐部 tab 打不开的成员管理代码与面板已删,卡片照常进详情', () => {
  const js = read('pages/talent/list/index.js');
  const wxml = read('pages/talent/list/index.wxml');
  for (const name of ['onClubCardAction', 'onClubManage', 'closeClubManage', 'loadClubMembers', 'retryClubMembers', 'removeClubMember', '_doRemoveClubMember', 'onClubJoin']) {
    assert.doesNotMatch(js, new RegExp('\\b' + name + '\\s*[(:]'), name);
  }
  assert.doesNotMatch(wxml, /clubManageShow|bind:action="onClubCardAction"/);
  assert.match(wxml, /<cy-club-card[^>]*bind:tap="goClubDetail"/);
});

test('L10-092:商家 18 项权限只写一次,两处由同一张表生成,结果逐项不变', () => {
  const src = read('utils/merchant-access-policy.js');
  assert.equal((src.match(/hasPermission\(access, PERMISSIONS\./g) || []).length, 0, '不再逐项手写');
  assert.equal((src.match(/^ {2}\['can\w+', PERMISSIONS\.\w+\],$/gm) || []).length, 18);
  const m = require('../../utils/merchant-access-policy.js');
  const all = Object.values(m.PERMISSIONS);
  const off = m.normalizeMerchantAccess({ applicationState: 'NONE' });
  const flags = Object.keys(off).filter((k) => /^can[A-Z]/.test(k));
  assert.equal(flags.length, 18);
  flags.forEach((f) => assert.equal(off[f], false, f));
  for (const perm of all) {
    const one = m.normalizeMerchantAccess({ active: true, merchant: { id: 1 }, roleCode: 'MERCHANT_CHECKIN', permissions: [perm] });
    assert.equal(flags.filter((f) => one[f]).length, 1, perm + ' 只点亮一个开关');
  }
  const full = m.normalizeMerchantAccess({ active: true, merchant: { id: 1 }, roleCode: 'MERCHANT_OWNER', permissions: all });
  flags.forEach((f) => assert.equal(full[f], true, f));
});

test('L10-124:首页商家视图判断走全局 roleGuard,不再自读 storage', () => {
  const src = read('pages/index/index.js');
  assert.match(src, /function isMerchantView\(\) \{\s*return roleGuard\.isMerchantView\(\);\s*\}/);
  assert.doesNotMatch(src, /function viewSnap\(/);
  assert.doesNotMatch(src, /role: wx\.getStorageSync\('role'\)/);
});

test('L10-066:角色只从统一会话读,不绕过会话读 storage;能力快照键名只在 roleGuard', () => {
  const src = read('app.js');
  const start = src.indexOf('  getUserRole: function () {');
  const end = src.indexOf('\n  },', start);
  const wx = { getStorageSync() { throw new Error('不得直接读 storage'); } };
  const make = (role, type) => Object.assign(new Function('wx', 'return ({' + src.slice(start + 2, end + 4) + '});')(wx),
    { getSession: () => ({ getUserRole: () => role, getUserType: () => type }), globalData: {} });
  assert.equal(make('club', 1).getUserRole(), 'club');
  assert.equal(make('', 2).getUserRole(), 'merchant');
  assert.equal(make('', 1).getUserRole(), 'player');
  assert.doesNotMatch(src, /role_permission_cache_v1/);
  assert.match(read('utils/roleGuard.js'), /function storeSnapshot\(snap\)/);
});

test('L10-027:单独同意弹窗打开期间不计时,点「单独同意」后才开始计时', async () => {
  const modalPath = require.resolve('../../utils/modal.js');
  const scPath = require.resolve('../../utils/compliance/separate-consent.js');
  const shown = [];
  const savedModal = require.cache[modalPath];
  require.cache[modalPath] = { id: modalPath, filename: modalPath, loaded: true, exports: { show: (o) => shown.push(o) } };
  delete require.cache[scPath];
  const timers = [];
  const realSet = global.setTimeout;
  global.setTimeout = (fn, ms) => { timers.push(ms); return 1; };
  try {
    const { requestSeparateConsent } = require(scPath);
    let recorded = 0;
    const app = { getUserID: () => '7', globalData: { authorization: 't' }, recordConsent: () => { recorded++; return Promise.resolve(); } };
    const p = requestSeparateConsent(app, {}, 'voice');
    assert.equal(shown.length, 1);
    assert.deepEqual(timers, [], '弹窗打开期间不计时');
    shown[0].success({ confirm: true });
    assert.deepEqual(timers, [30000], '点了单独同意才开始计时');
    await p;
    assert.equal(recorded, 1);
  } finally {
    global.setTimeout = realSet;
    if (savedModal) require.cache[modalPath] = savedModal; else delete require.cache[modalPath];
    delete require.cache[scPath];
  }
});

test('L10-128:写动词优先于读名词;全仓 POST 接口逐条清单检查(带写动词的必须按写,除非在逐条审过的读例外里)', () => {
  const { isWriteRequest, WRITE_TOKENS, READ_EXCEPTIONS } = require('../../utils/transport/request-client.js');
  for (const u of ['/api/activity/update_publish_status', '/api/club/personal-receiver/bind', '/api/club/personal-receiver/unbind',
    '/api/fe/reference-settlement/settle', '/api/topic/update_user_status', '/api/club/update-mine']) {
    assert.equal(isWriteRequest({ url: u }, 'POST'), true, u);
  }
  for (const u of READ_EXCEPTIONS) assert.equal(isWriteRequest({ url: '/api/' + u }, 'POST'), false, u);
  const urls = new Set();
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (['node_modules', 'tests', 'scripts', 'miniprogram_npm'].includes(e.name) || e.name.startsWith('.')) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (p.endsWith('.js')) for (const m of fs.readFileSync(p, 'utf8').matchAll(/['"`](\/api\/[A-Za-z0-9_\-/]+)['"`]/g)) urls.add(m[1]);
    }
  })(ROOT);
  const tokensOf = (u) => u.replace(/\/+$/, '').split('/').pop().replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase().split(/[-_.]+/).filter(Boolean);
  const wrong = [...urls].filter((u) => tokensOf(u).some((t) => WRITE_TOKENS.includes(t)) && READ_EXCEPTIONS.indexOf(u.replace(/^\/api\//, '')) < 0 && !isWriteRequest({ url: u }, 'POST'));
  assert.deepEqual(wrong, []);
  assert.ok(urls.size > 500, '清单检查确实扫到了全仓接口');
});

test('L10-129:页面直接用 require-login 与 app.requireLogin 共用一个登录窗,同一时刻只弹一个', async () => {
  const modPath = require.resolve('../../utils/auth/require-login.js');
  delete require.cache[modPath];
  const mod = require(modPath);
  const shows = [];
  const app = { getUserID: () => '', getAuthorization: () => '', firstLogin: () => Promise.resolve({ ok: false }) };
  const guard = mod.createRequireLogin({ getApp: () => app, getPages: () => null, isSinglePage: () => false, show: (o) => shows.push(o) });
  app.getLoginGuard = () => guard;
  const saved = global.getApp;
  global.getApp = () => app;
  try {
    const a = mod.requireLogin({ reason: 'club' });          // 页面直接 require 的入口
    const b = guard.requireLogin({ reason: 'post' });         // app.requireLogin / 请求层 promptLogin 的入口
    assert.equal(shows.length, 1, '两条入口同一时刻只弹一个登录窗');
    shows[0].success({ confirm: false });
    assert.deepEqual(await Promise.all([a, b]), [false, false]);
  } finally {
    if (saved === undefined) delete global.getApp; else global.getApp = saved;
    delete require.cache[modPath];
  }
});

test('L10-136:退出/换号清位置、城市与推荐标记;推荐两次认领失败作废;发布意图 14 天后清掉', () => {
  const app = read('app.js');
  const onClear = app.slice(app.indexOf('onClear: function (identity) {'), app.indexOf('return this._session;'));
  assert.match(onClear, /\['cy_last_location', 'home_city_last', referral\.STORAGE_KEY\]\.forEach/);
  // 推荐:两次失败后作废
  const store = {};
  global.wx = { getStorageSync: (k) => store[k] || '', setStorageSync: (k, v) => { store[k] = v; }, removeStorageSync: (k) => { delete store[k]; } };
  const refPath = require.resolve('../../utils/commerce/referral.js');
  delete require.cache[refPath];
  const ref = require(refPath);
  assert.equal(ref.capture({ ref: 'tok123' }), true);
  const sent = [];
  ref.claimAfterOrder({ sendRequest: (o) => sent.push(o) }, 9);
  sent[0].fail();
  assert.ok(ref.read(), '第一次失败还留着重试');
  sent[1].success({ code: 500 });
  assert.equal(ref.read(), null, '第二次失败作废');
  // 发布意图 14 天过期
  const intent = require('../../utils/publish/publish-intent.js');
  const old = Date.now() - 15 * 24 * 3600 * 1000;
  store['square_publish_intent_v1:7:post'] = { key: 'sqabcdefghijklmnop', payloadKey: '[]', status: 'unknown', memberId: '7', createdAt: old };
  store['square_publish_intent_v1:7:post:previous'] = { key: 'sqqrstuvwxyzabcdef', payloadKey: '["旧正文"]', status: 'unknown', memberId: '7', createdAt: old, supersededAt: old };
  assert.equal(intent.pending(global.wx, 'post', '7'), null);
  assert.equal(store['square_publish_intent_v1:7:post'], undefined);
  intent.begin(global.wx, { scope: 'post', memberId: '7', payload: ['新正文'] });
  assert.equal(store['square_publish_intent_v1:7:post:previous'], undefined, '超期的旧痕迹(含正文)清掉');
  delete global.wx;
  delete require.cache[refPath];
});

test('L10-017:旧分享隐私设置迁移一次,只保留比默认更严格的选择', () => {
  const p = require('../../utils/roam-route-privacy.js');
  const mk = (v) => { const box = { roam_share_privacy: v }; return { box, api: { getStorageSync: (k) => box[k], setStorageSync: (k, x) => { box[k] = x; } } }; };
  const loose = mk({ clipEnabled: false, clipPercent: 1, visibility: 'public' });
  assert.deepEqual(p.readSharePrivacyResult(loose.api).privacy, { clipEnabled: true, clipPercent: 10, visibility: 'public' });
  assert.equal(loose.box.roam_share_privacy.migrated, 1, '迁移一次并落盘');
  const strict = mk({ clipEnabled: true, clipPercent: 30, visibility: 'private' });
  assert.deepEqual(p.readSharePrivacyResult(strict.api).privacy, { clipEnabled: true, clipPercent: 30, visibility: 'private' });
  const fresh = mk(undefined);
  assert.deepEqual(p.readSharePrivacyResult(fresh.api).privacy, { clipEnabled: true, clipPercent: 10, visibility: 'public' });
  assert.equal(fresh.box.roam_share_privacy, undefined, '新用户不写任何东西');
});

test('L10-035:危险确认的替代方案真的显示,且 9 个带替代方案的动作调用处都接好了处理', () => {
  const wxml = read('components/cy/modal/index.wxml');
  assert.match(wxml, /class="mo__alt-col" wx:if="\{\{altText\}\}"/);
  assert.doesNotMatch(wxml.replace(/<!--[\s\S]*?-->/g, ''), /stacked/);
  const { DANGER_ACTIONS } = require('../../utils/danger-actions.js');
  const withAlt = Object.keys(DANGER_ACTIONS).filter((k) => DANGER_ACTIONS[k].alt);
  assert.deepEqual(withAlt.sort(), ['activity.delete', 'club.dissolve', 'club.quit', 'merchant.aftercare.reject', 'merchant.review.reply.delete',
    'route.delete', 'team.disband', 'template.delete', 'topic.chapter.finish'].sort(), '新增带替代方案的动作必须同时接好调用处');
  const wired = [
    ['subpackageA/pages/myproject/index', 'dcActivity', 'onDeleteItemAlt'],
    ['subpackageA/pages/myproject/index', 'dcRoute', 'onDeleteItemAlt'],
    ['subpackageA/pages/myproject/index', 'dcTpl', 'onDeleteTemplateAlt'],
    ['pages/team/detail/index', 'dcDisband', 'onDisbandAlt'],
    ['pages/club/detail/index', 'dcQuit', 'onQuitAlt'],
    ['pages/club/components/cy/scene-club-edit/index', 'dc', 'onDissolveAlt'],
    ['pages/topic/merchantinfo/merchantinfo', 'dc', 'onDangerAlt'],
    ['pages/merchant/reviews/index', 'dc-reply-delete', 'onDeleteReplyAlt'],
    ['components/cy/modal-host/index', 'dc', 'onDcAlt'],
  ];
  for (const [base, id, handler] of wired) {
    assert.match(read(base + '.wxml'), new RegExp('<cy-danger-confirm id="' + id + '"[^>]*bind:alt="' + handler + '"'), base + ' ' + id);
    assert.match(read(base + '.js'), new RegExp('\\b' + handler + '\\s*\\('), base + ' ' + handler);
  }
});

test('L10-035:评价「删除回复」的替代方案打开同一条回复的编辑;售后「再想想」不提交', () => {
  const def = load('pages/merchant/reviews/index.js', { wx: { getStorageSync: () => '' } });
  const opened = [];
  const page = Object.assign({}, def, { _deleteReplyId: 42, openEditReply: (e) => opened.push(e.currentTarget.dataset.id) });
  page.onDeleteReplyAlt();
  assert.deepEqual(opened, [42]);
  const host = load('components/cy/modal-host/index.js', { wx: { getStorageSync: () => '' } });
  const settled = [];
  const comp = Object.assign({}, host.methods, { _settle: (r) => settled.push(r) });
  comp.onDcAlt();
  assert.equal(settled[0].confirm, false);
  assert.equal(settled[0].alt, true);
});

test('L10-107(第二轮新增,按审慎业主取舍):删掉后端从不发送、无人申请的 refundRejected 模板;roamRecall 与后端 tplRoamRecall 同步保留', () => {
  const { TEMPLATES } = require('../../utils/subscribe.js');
  assert.equal(Object.prototype.hasOwnProperty.call(TEMPLATES, 'refundRejected'), false);
  assert.equal(TEMPLATES.roamRecall, '', '占位保留:未配置时跳过,不进授权弹窗');
  assert.ok(TEMPLATES.refund, '真正会下发的退款到账模板不动');
});

test('L10-112(第二轮新增,审慎业主取舍=保留现方案):核销 UNKNOWN 编号同步生成、先落待办再发请求', () => {
  const src = read('utils/verification-readback.js');
  const at = src.indexOf("attemptId: 'vr_'");
  assert.ok(at > 0);
  assert.match(src.slice(at, at + 200), /Date\.now\(\)\.toString\(36\) \+ '_' \+ verificationSequence\.toString\(36\) \+ '_' \+ Math\.random\(\)/);
  assert.ok(src.indexOf('storage.setStorageSync(meta.key, row)', at) > at, '编号生成后同步落盘,中间没有异步缺口');
});
