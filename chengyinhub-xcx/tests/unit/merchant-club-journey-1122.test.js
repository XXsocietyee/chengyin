'use strict';
/**
 * JOURNEY-MERCHANT-CLUB-1122:按新商家 / 新主理人的路径走一遍后修掉的断点。
 * 每条用例对应 PR 正文表格里的一行;负控写在断言信息里(改回旧写法这条必须红)。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const noop = () => {};

/** 通用页面沙箱:真实 require 本仓模块,wx/app 由用例注入;setData 记录每次补丁。 */
function loadPage(rel, opts = {}) {
  const file = path.join(ROOT, rel);
  const calls = { requests: [], nav: [], toasts: [], patches: [] };
  const app = Object.assign({
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    getUserID: () => '7',
    getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
    sendRequest: (o) => { calls.requests.push(o); return { abort: noop }; },
  }, opts.app || {});
  const wx = new Proxy(Object.assign({
    reLaunch: (o) => calls.nav.push(['reLaunch', o.url]),
    navigateTo: (o) => { calls.nav.push(['navigateTo', o.url]); if (o && o.complete) o.complete(); },
    redirectTo: (o) => calls.nav.push(['redirectTo', o.url]),
    navigateBack: () => calls.nav.push(['navigateBack']),
    getSystemInfoSync: () => ({ statusBarHeight: 20 }),
    getStorageSync: () => '', setStorageSync: noop, removeStorageSync: noop,
    stopPullDownRefresh: noop, showToast: noop, hideToast: noop,
  }, opts.wx || {}), { get: (t, k) => (k in t ? t[k] : noop) });
  const prevApp = global.getApp, prevWx = global.wx, prevPages = global.getCurrentPages;
  global.getApp = () => app; global.wx = wx;
  global.getCurrentPages = opts.getCurrentPages || (() => [{ route: rel }]);
  let definition = null;
  try {
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
      Page: (v) => { definition = v; }, Component: (v) => { definition = v; },
      getApp: () => app, getCurrentPages: global.getCurrentPages, wx, console,
      setTimeout: noop, clearTimeout: noop, module: { exports: {} }, exports: {},
      require(id) {
        if (opts.stub) { const s = opts.stub(id); if (s) return s; }
        if (/\/toast(\.js)?$/.test(id)) {
          const t = (m) => calls.toasts.push(m); t.success = t; return t;
        }
        return require(path.resolve(path.dirname(file), id));
      },
    });
  } finally {
    global.getApp = prevApp; global.wx = prevWx; global.getCurrentPages = prevPages;
  }
  const methods = Object.assign({}, definition, definition.methods || {});
  const page = Object.assign(methods, {
    data: JSON.parse(JSON.stringify(definition.data || {})),
    setData(patch, cb) {
      calls.patches.push(patch);
      Object.keys(patch).forEach((k) => { this.data[k] = patch[k]; });
      if (typeof cb === 'function') cb();
    },
    selectComponent: () => null,
    triggerEvent: noop,
  });
  return { page, calls, app, wx };
}

const ok = (data) => ({ code: 200, data });

// ---------- (1) 入驻 → 审核 → 通过 → 经营台 ----------

test('J1-1 入驻申请已生效:状态页主按钮是「进入经营台」,点了直接进经营台', () => {
  const policy = require('../../utils/merchant-identity-policy.js');
  assert.equal(policy.decorateApplication({ id: 1, status: 1, accountStatus: 1 }).canEnterWorkbench, true);
  assert.equal(policy.decorateApplication({ id: 1, status: 0, accountStatus: 0 }).canEnterWorkbench, false, '审核中不能给进经营台');
  assert.equal(policy.decorateApplication({ id: 1, status: 1, accountStatus: 2 }).canEnterWorkbench, false, '停用不能给进经营台');
  const wxml = read('pages/merchant/apply/index.wxml');
  assert.match(wxml, /apply\.canEnterWorkbench \? '进入经营台' : '返回'/, '负控:按钮回到只有「返回」即红');
  const js = read('pages/merchant/apply/index.js');
  assert.match(js, /canEnterWorkbench\) \{ wx\.reLaunch\(\{ url: '\/pages\/merchant\/index\/index' \}\)/);
});

test('J1-2 认领通过:认领面板给「进入经营台」,不再只有「知道了」', () => {
  const { page, calls } = loadPage('pages/merchant/components/merchant-claim-sheet/index.js');
  page.enterWorkbench();
  assert.deepEqual(calls.nav, [['reLaunch', '/pages/merchant/index/index']]);
  assert.match(read('pages/merchant/components/merchant-claim-sheet/index.wxml'),
    /wx:elif="\{\{view\.state === 'approved'\}\}" bindtap="enterWorkbench">进入经营台/);
  const claim = require('../../pages/merchant/utils/merchant-claim.js');
  const view = claim.describe([{ status: 'APPROVED', merchantId: 3, id: 1 }]);
  assert.doesNotMatch(view.desc, /重新进入商家中心/);
});

test('J1-3 认领搜索失败显示后端原话,不说成「未找到门店」', () => {
  const { page, calls } = loadPage('pages/merchant/components/merchant-claim-sheet/index.js');
  page.data.keyword = '城瘾咖啡';
  page.search();
  calls.requests[0].success({ code: 500, msg: '门店搜索服务繁忙' });
  assert.equal(page.data.searchError, '门店搜索服务繁忙');
  assert.equal(page.data.searched, false, '负控:失败仍置 searched=true 会露出「未找到门店」');
  page.search();
  calls.requests[1].fail({ errMsg: 'request:fail' });
  assert.ok(page.data.searchError);
  page.search();
  calls.requests[2].success(ok({ rows: [] }));
  assert.equal(page.data.searchError, '');
  assert.equal(page.data.searched, true, '真的没搜到才显示「未找到门店」');
});

// L07-044:选图要经过系统相册与裁剪页两次返回,两次都不能整页复检;选点仍是一次返回
test('J1-4 入驻表单从系统选图(相册+裁剪)/选点回来不整页复检', () => {
  let picked = null;
  const env = loadPage('pages/merchant/apply/index.js', {
    app: { chooseImage: (cb) => { picked = cb; } },
    stub(id) {
      if (id.includes('/merchant-theme')) return { merchantPageShow: noop, merchantPageRestore: noop };
      return null;
    },
  });
  const { page } = env;
  let boots = 0;
  page.startBootstrap = () => { boots += 1; };
  page.validate = noop;
  page._activeIdentityKey = '7'; // 与 app.getUserID() 同一账号
  page._hasShown = true;
  page.uploadLicense();
  page.onShow(); page.onShow();
  assert.equal(boots, 0, '相册与裁剪页两次返回都不复检');
  picked(['https://x/a.png']);
  assert.equal(page.data.businessLicense, 'https://x/a.png');
  page.onShow();
  assert.equal(boots, 1, '选图流程结束后,正常返回仍复检');
});

test('J1-5 入驻页主理人俱乐部无名时不露「俱乐部 #id」', () => {
  const policy = require('../../utils/merchant-identity-policy.js');
  const [club] = policy.normalizeOwnedClubs([{ id: 88, name: '', status: 1 }]);
  assert.equal(club.name, '未命名俱乐部');
});

// ---------- (2) 品牌中心 ----------

function loadDecor(view) {
  const env = loadPage('pages/merchant/decor/index.js', {
    stub(id) {
      if (id.includes('/merchant-theme')) return { merchantPageShow: noop, merchantPageRestore: noop };
      if (id.includes('/nav-safe-area')) return { resolveMenuChrome: () => ({}) };
      return null;
    },
  });
  env.page.data.view = view || 'home';
  return env;
}

test('J2-1 品牌中心身份读取失败:可重试的错误态 + 后端原话,不是「当前身份不能装修店铺」', () => {
  const { page, calls } = loadDecor('basic');
  let accessSeen = null;
  page.loadAccess((access) => { accessSeen = access; });
  calls.requests[0].success({ code: 500, msg: '服务维护中' });
  assert.equal(page.data.loadState, 'error', '负控:旧代码会落到 permission 态');
  assert.equal(page.data.loadErrSub, '服务维护中');
  assert.equal(accessSeen, null, '失败时不能按「无权限」继续往下走');
  page.retryLoad();
  assert.equal(calls.requests[1].url, '/api/merchant/access/me', '重试先重读身份');
  calls.requests[1].success(ok({ active: true, roleCode: 'MERCHANT_OWNER', merchant: { id: 3, name: '老街咖啡' }, permissions: ['merchant:profile:write'] }));
  assert.ok(accessSeen, '身份读回来后照常继续');
});

test('J2-2 品牌中心只有合作权限的岗位:资料类入口不出、点了先说明', () => {
  const wxml = read('pages/merchant/decor/index.wxml');
  assert.match(wxml, /wx:if="\{\{merchantAccess\.canWriteProfile\}\}" arrow-icon="chevron-right" title="AI 店铺角色"/);
  assert.match(wxml, /disabled="\{\{saving \|\| refreshing \|\| !merchantAccess\.canWriteProfile\}\}"/);
  assert.match(wxml, /<view class="dc-card" wx:if="\{\{merchantAccess\.canWriteProfile\}\}">\s*<cy-cell[^>]*title="门店信息"/);
  const { page, calls } = loadDecor('home');
  page.data.merchantAccess = { canWriteProfile: false };
  page.openImage('logo');
  page.openDerivatives();
  assert.deepEqual(calls.toasts, ['你的岗位不能修改店铺资料', '你的岗位不能修改店铺资料']);
});

test('J2-3 AI 店铺角色:hasProfile 走 setData,审核签和「已设置」才会上屏', () => {
  const js = read('pages/merchant/decor/ai-npc/index.js');
  assert.doesNotMatch(js, /Object\.assign\(this\.data, \{[^}]*hasProfile/, '负控:hasProfile 只写 this.data 视图收不到');
  assert.match(js, /this\.setData\(\{hasProfile: !!avatar,/);
  assert.match(js, /this\.setData\(\{hasProfile: true, saving: false,/);
});

test('J2-4 AI 店铺角色:保存失败不空白、不露英文', () => {
  const js = read('pages/merchant/decor/ai-npc/index.js');
  assert.doesNotMatch(js, /canvas not found|image load fail/);
  assert.doesNotMatch(js, /fail: reject,/);
  assert.equal((js.match(/saveError: staffErrorText\(e, '保存没有完成，请重试'\)/g) || []).length, 2);
});

test('J2-5 选点失败:取消静默,拒权给去设置,其余如实说明', () => {
  const shown = [];
  const settings = [];
  const prevWx = global.wx;
  global.wx = { openSetting: () => settings.push(1) };
  const modalPath = require.resolve('../../utils/modal.js');
  const real = require(modalPath);
  const origShow = real.show;
  real.show = (o) => { shown.push(o); if (o.success) o.success({ confirm: true }); };
  try {
    const { handleLocationPickFailure } = require('../../pages/merchant/utils/location-pick-failure.js');
    assert.equal(handleLocationPickFailure({ errMsg: 'chooseLocation:fail cancel' }), false);
    assert.equal(handleLocationPickFailure({ errMsg: 'chooseLocation:fail auth deny' }), true);
    assert.equal(shown[0].confirmText, '去设置');
    assert.equal(settings.length, 1);
    handleLocationPickFailure({ errMsg: 'chooseLocation:fail system error' });
    assert.equal(shown[1].showCancel, false);
  } finally { real.show = origShow; global.wx = prevWx; }
  assert.match(read('pages/merchant/decor/index.js'), /fail\(err\) \{ handleLocationPickFailure\(err\); \}/);
  // L07-092:失败回调先释放在途锁,再走同一个失败分流
  assert.match(read('pages/merchant/decor/ai-npc/index.js'), /fail: \(err\) => \{ release\(\); handleLocationPickFailure\(err\); \}/);
});

test('J2-6 常备权益:确定被拒写「没有保存」,网络未知才写「待确认」;承接设置提示与字段同名', () => {
  assert.match(read('pages/merchant/decor/perks/index.wxml'),
    /title="\{\{saveReadbackPending \|\| saveErrorKind === 'network' \? '常备权益保存状态待确认' : '常备权益没有保存'\}\}"/);
  assert.match(read('pages/merchant/decor/coop-setting/index.js'), /toast\('接待人数要填数字'\)/);
});

// ---------- (3) 节点 / 合作 ----------

function loadCitynode() {
  return loadPage('pages/merchant/citynode/index.js', {
    stub(id) {
      if (id.includes('/merchant-theme')) return { merchantPageShow: noop, merchantPageRestore: noop };
      return null;
    },
  });
}

test('J3-1 核销员能进城市节点页扫节点码,不被拦成「不能管理节点」', () => {
  const { page, calls } = loadCitynode();
  page.loadAccess();
  calls.requests[0].success(ok({ active: true, roleCode: 'MERCHANT_CHECKIN', merchant: { id: 3, name: '老街咖啡' }, permissions: ['merchant:verify'] }));
  assert.equal(page.data.accessState, 'ready', '负控:旧闸门只认 canManageProjects');
  assert.equal(page.data.loading, false, '不读节点列表,也不能卡骨架');
  assert.equal(calls.requests.length, 1, '核销员不打 city-node/list');
  const wxml = read('pages/merchant/citynode/index.wxml');
  assert.match(wxml, /<block wx:elif="\{\{accessState === 'ready' && merchantAccess\.canManageProjects && !loading && !loadErr\}\}">/);
});

test('J3-2 节点列表:已通过的申请不和在架节点重复列;加载失败带后端原话', () => {
  const { page, calls } = loadCitynode();
  page.data.merchantAccess = { canManageProjects: true };
  page.loadMine();
  calls.requests[0].success(ok({
    used: 1, max: 3,
    nodes: [{ poiId: 5, name: '老街咖啡' }],
    applications: [{ id: 5, name: '老街咖啡', auditStatus: 1 }, { id: 6, name: '河边书店', auditStatus: 0 }],
  }));
  assert.deepEqual(page.data.applications.map((a) => a.id), [6]);
  page.loadMine();
  calls.requests[1].success({ code: 500, msg: '节点服务繁忙' });
  assert.equal(page.data.loadErrText, '节点服务繁忙');
  assert.match(read('pages/merchant/citynode/index.wxml'), /sub="\{\{accessState === 'error' \? accessErrorText : loadErrText\}\}"/);
});

test('J3-3 店长从合作列表「再邀别人」带上店铺身份', () => {
  const { page, calls } = loadPage('pages/coop/list/index.js');
  page._operationScope = 'MERCHANT';
  page._navigateTo = (url) => calls.nav.push(url);
  page.goInviteOthers({ currentTarget: { dataset: { topicid: 12 } } });
  assert.deepEqual(calls.nav, ['/pages/coop/nearby/index?topicId=12&scope=MERCHANT']);
});

test('J3-4 合作中心按推荐定位:用 scroll-view 的 scroll-into-view', () => {
  const { page } = loadPage('pages/merchant/coop-center/index.js', {
    stub: (id) => (id.includes('/merchant-theme') ? { merchantPageShow: noop, merchantPageRestore: noop } : null),
  });
  page._focusTopicId = '9';
  page.data.routes = [{ id: 8 }, { id: 9 }];
  page._locateFocusTopic();
  assert.equal(page.data.focusAnchor, 'cc-route-9');
  assert.match(read('pages/merchant/coop-center/index.wxml'), /scroll-into-view="\{\{focusAnchor\}\}"/);
});

test('J3-5 游戏站点备用方案按站名显示,不露方案编码', () => {
  const wxml = read('pages/merchant/game-node/index.wxml');
  assert.doesNotMatch(wxml, /station\.fallbackPlanCode \|\|/);
  assert.match(wxml, /<text>备用方案<\/text><text>\{\{fallbackPlanText\}\}<\/text>/);
  const js = read('pages/merchant/game-node/index.js');
  const fn = js.slice(js.indexOf('function fallbackPlanText'), js.indexOf('\n}\n', js.indexOf('function fallbackPlanText')) + 2);
  const fallbackPlanText = vm.runInNewContext('(' + fn.replace('function fallbackPlanText', 'function') + ')');
  assert.equal(fallbackPlanText({ fallbackPlanCode: '' }, []), '未设置');
  assert.equal(fallbackPlanText({ fallbackPlanCode: 'RAIN_PLAN', fallbackPlanVersion: 2 },
    [{ planCode: 'RAIN_PLAN', planVersion: 2, nodeName: '室内书店站' }]), '室内书店站');
  assert.equal(fallbackPlanText({ fallbackPlanCode: 'RAIN_PLAN', fallbackPlanVersion: 2 }, []), '已设置');
});

// ---------- (5) 核销台账 / 评价 / 团队 ----------

test('J5-1 核销与退款、结算整页失败带后端原话', () => {
  const wxml = read('pages/merchant/ledger/index.wxml');
  assert.equal((wxml.match(/sub="\{\{errorText \|\| '请稍后重试'\}\}"/g) || []).length, 3, '负控:写死「请稍后重试」即红');
  const js = read('pages/merchant/ledger/index.js');
  assert.match(js, /if \(!isFinancePagePayload\(res\)\) \{ this\.setData\(\{ loading: false, error: true, errorText: loadErrorText\(res\) \}\)/);
});

test('J5-2 核销记录:列表在 scroll-view 里,触底续读接在 scroll-view 上;有下一页时不说「到底了」', () => {
  const wxml = read('pages/merchant/verify-records/index.wxml');
  assert.match(wxml, /bindscrolltolower="onReachBottom"/);
  assert.match(wxml, /\{\{hasMore \? '正在加载更多…' : '已经到底了'\}\}/);
  assert.match(read('pages/merchant/verify-records/index.js'), /hasMore: !!this\._morePage,/);
});

test('J5-3 运营岗点「我的内容」有回应,不再是点了没反应的按钮', () => {
  const { page, calls } = loadPage('pages/merchant/marketing/index.js', {
    stub: (id) => (id.includes('/merchant-theme') ? { merchantPageShow: noop, merchantPageRestore: noop } : null),
  });
  page.data.merchantAccess = { canManageProjects: false };
  page.goMyContent({ currentTarget: { dataset: { key: 'topic', count: 2 } } });
  assert.deepEqual(calls.toasts, ['你的岗位不能管理内容'], '负控:旧代码静默 return');
  assert.deepEqual(calls.nav, []);
});

test('J5-4 团队邀请失效后落地页给「返回」,确认弹窗不会一直转圈', () => {
  const wxml = read('pages/merchant/team/index.wxml');
  assert.match(wxml, /wx:if="\{\{hasIncomingInvite\}\}" variant="primary" loading="\{\{accepting\}\}" bind:tap="acceptIncomingInvite">接受邀请/);
  assert.match(wxml, /wx:else variant="secondary" bind:tap="leaveInviteLanding">返回/);
  const js = read('pages/merchant/team/index.js');
  assert.match(js, /this\.reportDanger\(false, '经营身份无效，请刷新后重试'\);/);
});

test('J5-5 评价与邀请恢复卡不用「原请求」这类内部词', () => {
  for (const file of ['pages/merchant/reviews/index.wxml', 'pages/coop/invite/index.wxml']) {
    assert.doesNotMatch(read(file), /原请求|原邀请请求|原回复请求/, file);
  }
  assert.doesNotMatch(read('pages/coop/invite/index.js'), /本机原请求|原请求号/);
});

// ---------- (6) 俱乐部 ----------

test('J6-1 成员治理入口只给主理人/联合主理人(后端只认这两种)', () => {
  const wxml = read('pages/club/detail/index.wxml');
  assert.match(wxml, /class="member-governance-btn" wx:if="\{\{club\.isOwner \|\| canGovernMembers\}\}"/);
  assert.match(wxml, /class="cset-row" wx:if="\{\{club\.isOwner \|\| canGovernMembers\}\}" catchtap="goClubGovernance"/);
  const { page, calls } = loadPage('pages/club/governance/index.js');
  page.data.clubId = '9';
  page._loadCycle = 1;
  page.loadManagementData = () => calls.nav.push('loaded');
  page.loadAccess && page.loadAccess();
  const req = calls.requests.find((r) => /access/.test(r.url));
  assert.ok(req, '治理页先读俱乐部身份');
  req.success(ok({ active: true, club: { id: 9 }, permissions: ['club:member:manage'], roleCodes: ['CLUB_LEGACY_ADMIN'] }));
  assert.equal(page.data.state, 'no-permission', '负控:旧管理员进来只会撞 403');
  assert.ok(!calls.nav.includes('loaded'));
});

test('J6-2 建系列断网重试沿用同一个 requestId,改了表单才换号', () => {
  const js = read('pages/club/event-ops/index.js');
  assert.match(js, /if \(!this\._seriesCreateIntent \|\| this\._seriesCreateIntent\.signature !== signature\)/);
  assert.match(js, /payload\.requestId = this\._seriesCreateIntent\.requestId/);
  assert.doesNotMatch(js, /payload\.requestId = requestId\('series'\)/, '负控:每次点都换新号即红');
});

test('J6-3 创建俱乐部后「进入俱乐部管理」直接落在管理页', () => {
  const js = read('pages/club/create/index.js');
  assert.match(js, /'\/pages\/club\/detail\/index\?id=' \+ this\.data\.createdClubId \+ '&tab=manage'/);
  assert.match(js, /'\/pages\/club\/detail\/index\?owner=1&tab=manage'/);
});

test('J6-4 个人收款:缺俱乐部给「返回」,没有俱乐部给「创建俱乐部」', () => {
  const wxml = read('pages/club/payout-receiver/index.wxml');
  assert.match(wxml, /state === 'missing'[^>]*cta="返回" bind:cta="goBack"/);
  assert.match(wxml, /title="还没有自己的俱乐部" cta="创建俱乐部" bind:cta="goCreateClub"/);
  assert.match(read('pages/club/payout-receiver/index.js'), /this\.setData\(\{ state: 'missing', errorText: '' \}\)/);
});

// L07-018:权益/升级只在 coop 视图读取;L07-019:刷新中拨开关会被拨回
test('L07-018 非 coop 视图不读权益与升级;coop 视图照常读', () => {
  const access = { active: true, canWriteProfile: true, canManageCoop: true }
  const home = loadDecor('home')
  home.page._afterAccess(access)
  const urls = home.calls.requests.map((r) => r.url)
  assert.ok(!urls.some((u) => /perk-template\/list|capabilities|subscription/.test(u)), urls.join(','))
  const coop = loadDecor('coop')
  coop.page._afterAccess(access)
  assert.ok(coop.calls.requests.some((r) => /perk-template\/list/.test(r.url)))
})

test('L07-019 刷新中拨营业开关不生效并拨回原值', () => {
  const { page, calls } = loadDecor('home')
  page.data.m = { businessStatus: 1 }
  page.data.refreshing = true
  page.toggleBusiness({ detail: { value: false } })
  assert.equal(page.data.m.businessStatus, 1)
  assert.equal(calls.requests.length, 0)
})

// L07-045:换号后上一账号填的实名、证件号、同意勾选、行业、营业时间草稿都清空
test('L07-045 入驻表单换号整表还原', () => {
  const { page } = loadPage('pages/merchant/apply/index.js', {
    stub(id) { if (id.includes('/merchant-theme')) return { merchantPageShow: noop, merchantPageRestore: noop }; return null; },
  });
  page._formDefaults = { hoursDraft: JSON.parse(JSON.stringify(page.data.hoursDraft)) };
  page._activeIdentityKey = '6';
  page._identityStatusRequested = true;
  Object.assign(page.data, { realName: '张三', idCard: '110101199001011234', identityConsented: true, identityRegistered: true,
    industryIds: [3], industryNames: '餐饮', fieldErrors: { name: '必填' } });
  page.data.hoursDraft.start = '06:00';
  page._bootstrapChecking = false;
  const prevGetApp = global.getApp;
  global.getApp = () => ({ getUserID: () => '7', globalData: {}, sendRequest: noop, getRequestErrorMessage: (r, f) => f });
  try { page.startBootstrap(); } finally { global.getApp = prevGetApp; }
  assert.equal(page.data.realName, '');
  assert.equal(page.data.idCard, '');
  assert.equal(page.data.identityConsented, false);
  assert.equal(page.data.identityRegistered, false);
  assert.equal(page.data.industryIds.length, 0);
  assert.equal(Object.keys(page.data.fieldErrors).length, 0);
  assert.equal(page.data.hoursDraft.start, '10:00');
  assert.equal(page._identityStatusRequested, false);
});
