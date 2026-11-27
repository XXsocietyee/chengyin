'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function extractBlock(source, selectorRegex) {
  const match = selectorRegex.exec(source);
  assert.ok(match, `未找到样式块: ${selectorRegex}`);
  const start = match.index + match[0].length;
  const end = source.indexOf('\n}', start);
  assert.ok(end > start, `样式块未正确闭合: ${selectorRegex}`);
  return source.slice(start, end);
}

// =========================================================================
// §4.1 [P1] 浅色/商家域重声明 --cy-comp-card-bg，避免角色与治理页黑底黑字
// =========================================================================
test('§4.1 浅色/商家域与暗色逃生口均重声明 --cy-comp-card-bg: var(--cy-color-bg-elevated)', () => {
  const tokens = read('style/tokens.wxss');
  const merchantLight = read('style/merchant-light.wxss');
  const merchantLightScope = read('style/merchant-light-scope.wxss');

  const lightBlock = extractBlock(tokens, /page\.theme-light,\s*\n\.theme-light,\s*\n\.theme-merchant\s*\{/);
  const darkBlock = extractBlock(tokens, /page\.theme-dark,\s*\n\.theme-dark\s*\{/);
  const mlBlock = extractBlock(merchantLight, /\npage\s*\{/);
  const mlsBlock = extractBlock(merchantLightScope, /\n\.theme-merchant\s*\{/);

  const cardBgRe = /--cy-comp-card-bg:\s*var\(--cy-color-bg-elevated\);/;
  assert.match(lightBlock, cardBgRe, 'tokens.wxss .theme-light/.theme-merchant 缺少 --cy-comp-card-bg 重声明');
  assert.match(lightBlock, /--cy-color-bg-elevated:\s*#FFFFFF;/, '浅色域 --cy-color-bg-elevated 必须为白卡 #FFFFFF');
  assert.match(darkBlock, cardBgRe, 'tokens.wxss .theme-dark 缺少对称 --cy-comp-card-bg 重声明');
  assert.match(mlBlock, cardBgRe, 'merchant-light.wxss 缺少 --cy-comp-card-bg 镜像');
  assert.match(mlsBlock, cardBgRe, 'merchant-light-scope.wxss .theme-merchant 缺少 --cy-comp-card-bg 桥接');

  // 俱乐部角色与治理页在 .theme-merchant 下消费 --cy-comp-card-bg
  for (const page of ['pages/club/roles/index', 'pages/club/governance/index']) {
    assert.match(read(`${page}.wxml`), /class="theme-merchant"/, `${page} 根节点应挂 .theme-merchant`);
    assert.match(read(`${page}.wxss`), /background:\s*var\(--cy-comp-card-bg\)/, `${page} 卡片消费 --cy-comp-card-bg`);
  }
});

test('§4.1 负控: 移除 .theme-light/.theme-merchant 里的 --cy-comp-card-bg 必须判红', () => {
  const tokens = read('style/tokens.wxss');
  const lightBlock = extractBlock(tokens, /page\.theme-light,\s*\n\.theme-light,\s*\n\.theme-merchant\s*\{/);
  const broken = lightBlock.replace(/--cy-comp-card-bg:\s*var\(--cy-color-bg-elevated\);/, '');
  assert.notEqual(broken, lightBlock, '负控锚点失效');
  assert.throws(() => assert.match(broken, /--cy-comp-card-bg:\s*var\(--cy-color-bg-elevated\);/));
});

// =========================================================================
// §4.2 [P1] #965 取消合作弱网立即返回竞态：handle 回包后主动刷新栈顶 coop/list
// =========================================================================
function createCoopHarness() {
  const requests = [];
  let currentUserId = 990047;
  let currentRole = 'merchant';
  let pageStack = [];

  const app = {
    globalData: { statusBarHeight: 44, navBarHeight: 44, coopListDirty: false },
    getUserID: () => currentUserId,
    getUserRole: () => currentRole,
    getUserType: () => 2,
    sendRequest(opts) {
      requests.push(opts);
    },
  };

  function loadPage(relPath, route) {
    const file = path.join(ROOT, relPath);
    let def = null;
    const sandbox = {
      Page(p) { def = p; },
      getApp: () => app,
      getCurrentPages: () => pageStack,
      console,
      setTimeout,
      clearTimeout,
      wx: {
        stopPullDownRefresh() {},
        navigateBack() {},
        navigateTo() {},
        redirectTo() {},
        setClipboardData() {},
        nextTick(fn) { if (typeof fn === 'function') fn(); },
        setNavigationBarColor() {},
        setBackgroundColor() {},
      },
      require(id) {
        if (id.includes('/toast')) return Object.assign(() => {}, { success() {} });
        if (id.includes('/loading')) return { show() {}, hide() {} };
        if (id.includes('/page-motion')) return { enter() {} };
        if (id.includes('/merchant-theme')) return { merchantPageShow() {}, merchantPageRestore() {} };
        if (id.includes('/modal')) {
          return {
            show(o) {
              if (o && typeof o.success === 'function') {
                o.success({ confirm: true, content: '档期冲突取消合作' });
              }
            },
          };
        }
        return require(path.resolve(path.dirname(file), id));
      },
    };
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
    const inst = Object.assign({}, def, {
      route,
      data: JSON.parse(JSON.stringify(def.data)),
      setData(patch, cb) {
        Object.assign(this.data, patch);
        if (typeof cb === 'function') cb();
      },
    });
    return inst;
  }

  const listPage = loadPage('pages/coop/list/index.js', 'pages/coop/list/index');
  const detailPage = loadPage('pages/coop/invite-detail/index.js', 'pages/coop/invite-detail/index');

  const rowWithStatus = (status) => ({
    id: 990032,
    inviteId: '990032',
    status,
    inviteType: 1,
    topicId: 9913001,
    topicName: '城市定向测试路线',
    shareMode: 0,
    depositOwed: false,
    fromId: 990047,
    toId: 990009,
    fromType: 'merchant',
    toType: 'club',
    termsFrozen: false,
    partner: { name: '测试俱乐部' },
  });

  const listRequests = () => requests.filter((r) => r.url === '/api/coop/list');
  const handleRequests = () => requests.filter((r) => r.url === '/api/coop/handle');

  return {
    app,
    listPage,
    detailPage,
    rowWithStatus,
    listRequests,
    handleRequests,
    setStack(stack) { pageStack = stack; },
    setIdentity(id, role) { currentUserId = id; currentRole = role; },
  };
}

test('§4.2 取消合作发出后立即返回，onShow 先读到旧态「已接受」，handle 回包后主动重载为「已取消」', () => {
  const h = createCoopHarness();
  h.setStack([h.listPage]);
  h.listPage.onLoad({});
  h.listPage.onShow();
  // 首次加载列表：990032 为 status=1（已接受）
  h.listRequests().at(-1).success({
    code: 200,
    data: { received: [], sent: [h.rowWithStatus(1)], slots: {} },
  });
  assert.equal(h.listPage.data.sent[0].status, 1);

  // 进入详情页并加载 status=1
  h.listPage.goInviteDetail({ currentTarget: { dataset: { id: '990032', box: 'sent' } } });
  h.listPage.onHide();
  h.setStack([h.listPage, h.detailPage]);
  h.detailPage.onLoad({ inviteId: '990032', box: 'sent' });
  h.listRequests().at(-1).success({
    code: 200,
    data: { received: [], sent: [h.rowWithStatus(1)], slots: {} },
  });

  // 点「取消合作」→ /api/coop/handle 在途
  h.detailPage.cancelAccepted();
  assert.equal(h.handleRequests().length, 1);
  const handleReq = h.handleRequests()[0];

  // 用户 120ms 后立即返回 coop/list，此时 /api/coop/handle 尚未落库
  h.detailPage.onUnload();
  h.setStack([h.listPage]);
  h.listPage.onShow();
  assert.equal(h.app.globalData.coopListDirty, false, 'onShow 已消费 coopListDirty');

  // onShow 触发的 /api/coop/list 先回到旧态 status=1（已接受）
  const staleListReq = h.listRequests().at(-1);
  staleListReq.success({
    code: 200,
    data: { received: [], sent: [h.rowWithStatus(1)], slots: {} },
  });
  assert.equal(h.listPage.data.sent[0].status, 1, '竞态复现：onShow 读到旧态 status=1');

  const countBeforeHandleSettle = h.listRequests().length;
  // /api/coop/handle 晚到成功落库 status=3
  handleReq.success({ code: 200, msg: 'ok' });

  // 栈顶活跃的 coop/list 被主动触发新一轮 /api/coop/list 重载
  assert.equal(h.listRequests().length, countBeforeHandleSettle + 1, 'handle 回包后必须主动重拉 coop/list');
  assert.equal(h.app.globalData.coopListDirty, false, '主动重拉后顺手清脏标');
  h.listRequests().at(-1).success({
    code: 200,
    data: { received: [], sent: [h.rowWithStatus(3)], slots: {} },
  });
  assert.equal(h.listPage.data.sent[0].status, 3, '列表即时更新为 status=3（已取消）');
  assert.equal(h.listPage.data.sent[0].statusText, '已取消');
});

test('§4.2 即使 coop/list 的 onShow 请求仍在途，handle 回包也能强制重拉并作废旧航班', () => {
  const h = createCoopHarness();
  h.setStack([h.listPage]);
  h.listPage.onLoad({});
  h.listPage.onShow();
  h.listRequests().at(-1).success({
    code: 200,
    data: { received: [], sent: [h.rowWithStatus(1)], slots: {} },
  });

  h.listPage.goInviteDetail({ currentTarget: { dataset: { id: '990032', box: 'sent' } } });
  h.listPage.onHide();
  h.setStack([h.listPage, h.detailPage]);
  h.detailPage.onLoad({ inviteId: '990032', box: 'sent' });
  h.listRequests().at(-1).success({
    code: 200,
    data: { received: [], sent: [h.rowWithStatus(1)], slots: {} },
  });

  h.detailPage.cancelAccepted();
  const handleReq = h.handleRequests()[0];

  // 立即返回，onShow 发出 /api/coop/list（此时仍在途，_listLoading === true）
  h.detailPage.onUnload();
  h.setStack([h.listPage]);
  h.listPage.onShow();
  const inFlightStaleListReq = h.listRequests().at(-1);
  assert.equal(h.listPage._listLoading, true);

  // /api/coop/handle 在旧 list 请求还没回来时先落定
  const countBefore = h.listRequests().length;
  handleReq.success({ code: 200, msg: 'ok' });
  assert.equal(h.listRequests().length, countBefore + 1, '不能被 _listLoading 短路，必须强制发起新读');
  const freshListReq = h.listRequests().at(-1);

  // 新航班先回 status=3，随后迟到的旧航班回 status=1 不能把列表覆写回旧态
  freshListReq.success({
    code: 200,
    data: { received: [], sent: [h.rowWithStatus(3)], slots: {} },
  });
  inFlightStaleListReq.success({
    code: 200,
    data: { received: [], sent: [h.rowWithStatus(1)], slots: {} },
  });
  assert.equal(h.listPage.data.sent[0].status, 3, '迟到的旧列表回包不得覆盖新态');
});

test('§4.2 弱网 handle 失败/超时且已返回 coop/list 时也触发核对重拉；已离开列表或已换号时不误刷', () => {
  // 分支 1：handle fail 时栈顶仍是 coop/list → 主动重拉核对服务端真实状态
  const h1 = createCoopHarness();
  h1.setStack([h1.listPage]);
  h1.listPage.onLoad({});
  h1.listPage.onShow();
  h1.listRequests().at(-1).success({ code: 200, data: { received: [], sent: [h1.rowWithStatus(1)], slots: {} } });
  h1.listPage.goInviteDetail({ currentTarget: { dataset: { id: '990032', box: 'sent' } } });
  h1.listPage.onHide();
  h1.setStack([h1.listPage, h1.detailPage]);
  h1.detailPage.onLoad({ inviteId: '990032', box: 'sent' });
  h1.listRequests().at(-1).success({ code: 200, data: { received: [], sent: [h1.rowWithStatus(1)], slots: {} } });
  h1.detailPage.cancelAccepted();
  h1.detailPage.onUnload();
  h1.setStack([h1.listPage]);
  h1.listPage.onShow();
  h1.listRequests().at(-1).success({ code: 200, data: { received: [], sent: [h1.rowWithStatus(1)], slots: {} } });
  const beforeFail = h1.listRequests().length;
  h1.handleRequests()[0].fail({ errMsg: 'request:fail timeout' });
  assert.equal(h1.listRequests().length, beforeFail + 1, 'fail 回包也必须刷新栈顶 coop/list 核对真实态');

  // 分支 2：已跳到别的页面（栈顶不是 coop/list）→ 只保留 coopListDirty=true，不误刷
  const h2 = createCoopHarness();
  h2.setStack([h2.listPage, h2.detailPage]);
  h2.detailPage.onLoad({ inviteId: '990032', box: 'sent' });
  h2.listRequests().at(-1).success({ code: 200, data: { received: [], sent: [h2.rowWithStatus(1)], slots: {} } });
  h2.detailPage.cancelAccepted();
  h2.detailPage.onUnload();
  let otherLoads = 0;
  h2.setStack([{ route: 'pages/merchant/index/index', load() { otherLoads += 1; } }]);
  h2.app.globalData.coopListDirty = false;
  h2.handleRequests()[0].success({ code: 200, msg: 'ok' });
  assert.equal(otherLoads, 0, '栈顶不是 coop/list 不得误调用 load');
  assert.equal(h2.app.globalData.coopListDirty, true, '非栈顶时保留 coopListDirty 供下次 onShow 消费');

  // 分支 3：返回后已切换账号 → 旧账号迟到回包不触发新账号 coop/list 重拉
  const h3 = createCoopHarness();
  h3.setStack([h3.listPage, h3.detailPage]);
  h3.detailPage.onLoad({ inviteId: '990032', box: 'sent' });
  h3.listRequests().at(-1).success({ code: 200, data: { received: [], sent: [h3.rowWithStatus(1)], slots: {} } });
  h3.detailPage.cancelAccepted();
  h3.detailPage.onUnload();
  h3.setIdentity(990099, 'merchant');
  h3.setStack([h3.listPage]);
  h3.listPage._hidden = false;
  const beforeSwitch = h3.listRequests().length;
  h3.handleRequests()[0].success({ code: 200, msg: 'ok' });
  assert.equal(h3.listRequests().length, beforeSwitch, '换号后旧账号迟到回包不触发新账号列表重拉');
});

// =========================================================================
// §4.3 [P2] 商家工作台与营销页底部 tabBar 避让，不与正文/图卡重叠
// =========================================================================
test('§4.3 商家首页滚动区与营销页正文清晰让出底部 tabBar，不破坏底栏渐变与垫高合同', () => {
  const homeWxml = read('pages/merchant/index/index.wxml');
  const homeWxss = read('pages/merchant/index/index.wxss');
  const mktWxss = read('pages/merchant/marketing/index.wxss');

  // 商家首页：scroll-view 不再用 height: 100vh 压到底栏图标下方，而是扣除 tabBar 实高(--cy-tabbar-h + --cy-space-2)
  assert.doesNotMatch(homeWxml, /class="rv-scroll"[^>]*height:\s*100vh/, 'rv-scroll 不得内联 height: 100vh 压进底栏');
  const rvScroll = homeWxss.match(/\.rv-scroll\s*\{([^}]*)\}/);
  assert.ok(rvScroll, '找不到 .rv-scroll 规则');
  assert.match(rvScroll[1], /height:\s*calc\(100vh\s*-\s*var\(--cy-tabbar-h\)\s*-\s*var\(--cy-space-2\)\)/);
  assert.match(rvScroll[1], /box-sizing:\s*border-box/);

  // 商家营销页：.body 底部留白与首页同口径(--cy-tabbar-h + --cy-space-6)，并由 .page::after 在底栏下托底
  const bodyRule = mktWxss.match(/\.body\s*\{([^}]*)\}/);
  assert.ok(bodyRule, '找不到营销页 .body 规则');
  assert.match(bodyRule[1], /calc\(var\(--cy-tabbar-h\)\s*\+\s*var\(--cy-space-6\)\)/);

  const backdropRule = mktWxss.match(/\.page::after\s*\{([^}]*)\}/);
  assert.ok(backdropRule, '找不到营销页 .page::after 底栏托底规则');
  assert.match(backdropRule[1], /position:\s*fixed/);
  assert.match(backdropRule[1], /height:\s*calc\(var\(--cy-tabbar-h\)\s*\+\s*var\(--cy-space-2\)\)/);
  assert.match(backdropRule[1], /background:\s*var\(--cy-color-bg-page\)/);
  assert.match(backdropRule[1], /pointer-events:\s*none/);
  assert.match(backdropRule[1], /z-index:\s*var\(--cy-z-tabbar\)/);
});
