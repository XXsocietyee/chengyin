'use strict';
// AUDIT-1122 lane F08:pages/club/detail 行为测试(挂真页面代码,桩掉 app/wx)。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const REL = 'pages/club/detail/index.js';

function loadClubDetail() {
  const requests = [];
  const requiredIds = [];
  const timers = { live: new Set(), next: 1, fns: new Map() };
  const app = {
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    sendRequest(o) { requests.push(o); },
    tips() {}, getUserID: () => 1001, getUserRole: () => 'club', getUserType: () => 'club',
    getAvatar: () => '', getNickname: () => '测试', getAuthorization: () => 'Bearer t',
    getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
  };
  const wx = {
    showToast() {}, navigateTo() {}, navigateBack() {}, redirectTo() {}, switchTab() {},
    stopPullDownRefresh() {}, getStorageSync: () => '', setStorageSync() {}, removeStorageSync() {},
    previewImage() {}, scanCode() {}, setNavigationBarColor() {}, getSystemInfoSync: () => ({}), createSelectorQuery: () => ({ in() { return this; }, select() { return this; }, boundingClientRect() { return this; }, exec() {} }),
  };
  global.wx = wx;
  global.getApp = () => app;
  const file = path.resolve(ROOT, REL);
  const stubs = {
    '../../../utils/scene-registry.js': { getScene: () => ({}) },
    '../utils/mockData.js': { DEMO_NEARBY_CLUB_ID: -1 },
    '../utils/aiPlanToDraft.js': { aiPlanToDraft: () => ({}) },
    '../../../utils/group-code-session.js': { buildGroupCodeIssuePayload: (id) => (id ? { activityId: id } : null), listGroupCodeActivities: () => [] },
  };
  let definition;
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    getApp: () => app, Page(p) { definition = p; }, Component(p) { definition = p; },
    getCurrentPages: () => [{}, {}],
    setTimeout(fn) { if (fn) fn(); return 0; }, clearTimeout() {},
    setInterval(fn) { const id = timers.next++; timers.live.add(id); timers.fns.set(id, fn); return id; },
    clearInterval(id) { timers.live.delete(id); },
    console, Set, Map, Date, JSON, Math, Object, String, Number, Array, Promise, RegExp, Error, encodeURIComponent, decodeURIComponent,
    require(id) { requiredIds.push(id); return stubs[id] || require(path.resolve(path.dirname(file), id)); },
    wx,
  }, { filename: REL });
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch, cb) {
      for (const [k, v] of Object.entries(patch)) {
        if (/[.[]/.test(k)) {
          const parts = k.replace(/\[(\d+)\]/g, '.$1').split('.');
          let o = this.data;
          for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
          o[parts[parts.length - 1]] = v;
        } else this.data[k] = v;
      }
      if (cb) cb.call(this);
    },
  });
  return { page, requests, timers, requiredIds };
}

test('L08-003 关闭团码弹层后迟到的签发回包不起倒计时、不再签发', () => {
  const { page, requests, timers } = loadClubDetail();
  page._groupCodeActivityId = 30; page.setData({ groupCodeVisible: true });
  page.issueGroupCode();
  const issue = requests.filter((r) => r.url === '/api/verify/groupcode/issue');
  assert.equal(issue.length, 1);
  page.onCloseGroupCode();
  issue[0].success({ code: 200, data: { code: 'C1', qrcodeUrl: 'https://oss.test/q.png', ttlMs: 300000 } });
  assert.equal(timers.live.size, 0, '弹层已关:不许留计时器');
  assert.notEqual(page.data.groupCodeState, 'ready');
});

test('L08-003 两次并发签发只留一个计时器,旧回包作废', () => {
  const { page, requests, timers } = loadClubDetail();
  page._groupCodeActivityId = 30; page.setData({ groupCodeVisible: true });
  page.issueGroupCode();
  page.issueGroupCode();
  const issue = requests.filter((r) => r.url === '/api/verify/groupcode/issue');
  assert.equal(issue.length, 2);
  issue[1].success({ code: 200, data: { code: 'C2', qrcodeUrl: 'https://oss.test/2.png', ttlMs: 300000 } });
  issue[0].success({ code: 200, data: { code: 'C1', qrcodeUrl: 'https://oss.test/1.png', ttlMs: 300000 } });
  assert.equal(timers.live.size, 1, '至多一个倒计时');
  assert.equal(page.data.groupCodeCode, 'C2', '旧回包不覆盖新码');
  page.onCloseGroupCode();
  assert.equal(timers.live.size, 0);
});

function accessOk(clubId, permissions) {
  return { code: 200, data: { active: true, club: { id: clubId }, permissions, roleCodes: ['CLUB_EVENT_LEAD'], eventAccesses: [] } };
}

test('L08-001 委派角色在 管理 tab 上重载同一俱乐部:不被踢回概览,权限不先收回', () => {
  const { page, requests } = loadClubDetail();
  page.setData({ clubId: 7, club: { id: 7, isJoined: true, viewerCanGovern: false }, activeTab: 'manage', tabInitialized: true });
  page.loadClubAccess();
  requests.pop().success(accessOk(7, ['club:event:operate']));
  assert.equal(page.data.canUseManageTab, true);
  assert.equal(page.data.activeTab, 'manage');
  // 子页面返回 → 再拉一次 access:在途期间快照保留
  page.loadClubAccess();
  assert.equal(page.data.activeTab, 'manage', '在途时不许踢回概览');
  assert.equal(page.data.canOperateEvents, true, '在途时按钮不闪掉');
  requests.pop().success(accessOk(7, ['club:event:operate']));
  assert.equal(page.data.activeTab, 'manage');
});

test('L08-001 重载回包失败照旧收回权限;换账号先收回', () => {
  const { page, requests } = loadClubDetail();
  page.setData({ clubId: 7, club: { id: 7, isJoined: true, viewerCanGovern: false }, activeTab: 'manage', tabInitialized: true });
  page.loadClubAccess();
  requests.pop().success(accessOk(7, ['club:event:operate']));
  page.loadClubAccess();
  requests.pop().success({ code: 200, data: { active: false } });
  assert.equal(page.data.canOperateEvents, false);
  assert.equal(page.data.canUseManageTab, false);
  assert.equal(page.data.activeTab, 'overview');
});

test('L08-002 看大图回来不整页重拉;没标脏不重拉;标脏才重拉', () => {
  const { page } = loadClubDetail();
  let loads = 0;
  page.loadAll = () => { loads += 1; };
  page._hasShown = true;
  page.setData({ clubId: 7, club: { id: 7, isJoined: true, viewerCanGovern: true }, canUseManageTab: true });
  page.onPreviewImage({ detail: { picList: ['https://a/1.png'], picIndex: 0 }, currentTarget: { dataset: {} } });
  page.onHide(); page.onShow();
  assert.equal(loads, 0, '系统浮层返回不重拉');
  page.onHide(); page.onShow();
  assert.equal(loads, 0, '没标脏不重拉');
  page._clubDetailDirty = true;
  page.onHide(); page.onShow();
  assert.equal(loads, 1, '标脏后重拉');
  page.onPreviewImage({ detail: { picList: [], picIndex: 0 }, currentTarget: { dataset: {} } });
  page.onHide(); page.onShow();
  assert.equal(loads, 1, '没打开浮层也不把没标脏的返回当成要重拉');
});

test('L08-004 评论与置顶成功只改这条帖,不重拉帖子列表', () => {
  const { page, requests } = loadClubDetail();
  page.setData({
    clubId: 7, canModerateContent: true, openCommentPost: 11, commentText: '到了',
    posts: [
      { id: 11, feedKey: '11', type: 2, isPinned: 0, commentCount: 2, version: 1, content: '公告' },
      { id: 12, feedKey: '12', type: 0, commentCount: 0, content: '别的' },
      { id: 11, feedKey: 'r5', isRepostItem: true, commentCount: 2, content: '转发' },
    ],
  });
  page.onCommentSubmit();
  const create = requests.find((r) => r.url === '/api/club/post/comment/create');
  requests.length = 0;
  create.success({ code: '200' });
  assert.equal(requests.filter((r) => r.url === '/api/club/post/list').length, 0, '发评论不整页重拉');
  assert.deepEqual(page.data.posts.map((p) => p.commentCount), [3, 0, 3]);
  page._doDeleteComment(4, 11);
  const del = requests.find((r) => r.url === '/api/club/post/comment/delete');
  requests.length = 0;
  del.success({ code: '200' });
  assert.equal(requests.filter((r) => r.url === '/api/club/post/list').length, 0, '删评论不整页重拉');
  assert.deepEqual(page.data.posts.map((p) => p.commentCount), [2, 0, 2]);
  page.onTogglePin({ currentTarget: { dataset: { id: 11 } } });
  const pin = requests.find((r) => r.url === '/api/club/post/pin');
  requests.length = 0;
  pin.success({ code: '200', data: { isPinned: 1, version: 4 } });
  assert.equal(requests.filter((r) => r.url === '/api/club/post/list').length, 0, '置顶不整页重拉');
  assert.equal(page.data.posts[0].isPinned, true);
  assert.equal(page.data.posts[0].noticeBadge, '公告 · 置顶');
  assert.equal(page.data.posts[0].version, 4);
  assert.equal(page.data.posts[2].isPinned, undefined, '转发条目不跟着置顶');
});

test('L08-004 点赞成功只改这条帖(含转发条目),不重拉帖子列表', () => {
  const { page, requests } = loadClubDetail();
  page.setData({ clubId: 7, posts: [
    { id: 11, feedKey: '11', isLiked: false, likeCount: 2 },
    { id: 12, feedKey: '12', isLiked: false, likeCount: 0 },
    { id: 11, feedKey: 'r5', isRepostItem: true, isLiked: false, likeCount: 2 },
  ] });
  page.onLikePost({ detail: { postId: 11 }, currentTarget: { dataset: {} } });
  const like = requests.filter((r) => r.url === '/api/club/post/like');
  assert.equal(like.length, 1);
  assert.equal(JSON.parse(like[0].data).liked, true);
  requests.length = 0;
  like[0].success({ code: '200', data: { liked: true } });
  assert.equal(requests.filter((r) => r.url === '/api/club/post/list').length, 0, '不整页重拉');
  assert.deepEqual(page.data.posts.map((p) => [p.isLiked, p.likeCount]), [[true, 3], [false, 0], [true, 3]]);
});

test('L08-006 只有日期的 endDate:最后一天仍算未结束', () => {
  const { page, requests } = loadClubDetail();
  page.setData({ clubId: 7 });
  const realNow = Date.now;
  try {
    Date.now = () => Date.parse('2026-11-23T08:00:00Z');   // 上海 16:00
    page.loadTopics();
    requests.find((r) => r.url === '/api/club/topics').success({ code: 200, data: [
      { id: 1, name: '今天最后一天', startDate: '2026-11-01', endDate: '2026-11-23' },
      { id: 2, name: '昨天结束', startDate: '2026-11-01', endDate: '2026-11-22' },
    ] });
    const byId = Object.fromEntries(page._topics.map((t) => [t.id, t.ended]));
    assert.equal(byId[1], false);
    assert.equal(byId[2], true);
  } finally { Date.now = realNow; }
});

test('L08-005 快速切排序:旧排序迟到回包不覆盖新榜单', () => {
  const { page, requests } = loadClubDetail();
  page.setData({ clubId: 7 });
  page._leaderboardSort = 'composite'; page.loadLeaderboard();
  page._leaderboardSort = 'mileage'; page.loadLeaderboard();
  const [a, b] = requests.filter((r) => r.url === '/api/club/leaderboard');
  b.success({ code: '200', data: [{ memberId: 2, nickname: 'B' }] });
  a.success({ code: '200', data: [{ memberId: 1, nickname: 'A' }] });
  assert.equal(page._leaderboardSortBy, 'mileage');
  assert.deepEqual(page._leaderboardRows.map((r) => r.memberId), [2]);
});

test('L08-022 带队进度的最近邀请时间跨年也取最新', () => {
  const { page } = loadClubDetail();
  page.setData({ topics: [{ id: 1 }], sentInvites: [
    { status: 0, createTime: '2025-12-28 10:00:00', timeText: '12-28 10:00' },
    { status: 0, createTime: '2026-01-03 09:00:00', timeText: '01-03 09:00' },
  ] });
  const nodes = page.buildLeadTimeline('pending').nodes;
  assert.equal(nodes[1].time, '01-03 09:00');
});

test('L08-023 发评论遇 401 静默重登后,重试带的是新 token(不是钉死的旧 token)', () => {
  const { page, requests } = loadClubDetail();
  let token = 'Bearer old';
  const sent = [];
  const client = require('../../utils/transport/request-client.js').createRequestClient({
    wxRequest: (o) => { sent.push(o); return { abort() {} }; },
    getBaseUrl: () => 'http://127.0.0.1', getUserID: () => 1001, getAuthorization: () => token,
    reLogin: (cb) => { token = 'Bearer new'; cb(true, { isCurrentSession: () => true }); },
  });
  page.setData({ clubId: 7, openCommentPost: 5, commentText: '好玩' });
  page.onCommentSubmit();
  const req = requests.find((r) => r.url === '/api/club/post/comment/create');
  client.send(req);
  assert.equal(sent[0].header.Authorization, 'Bearer old');
  sent[0].success({ statusCode: 401, data: { code: 401 } });
  assert.equal(sent.length, 2, '重登后重试一次');
  assert.equal(sent[1].header.Authorization, 'Bearer new');
});

test('L08-018 成员回包与补齐后的贡献榜一次 setData', () => {
  const { page, requests } = loadClubDetail();
  const writes = [];
  const orig = page.setData;
  page.setData = function (p, cb) { writes.push(Object.keys(p)); return orig.call(this, p, cb); };
  page.setData({ clubId: 7, club: { id: 7, memberCount: 2 }, membersState: 'ready' });
  page._leaderboardRows = [{ memberId: 1, nickname: 'A', score: 3 }];
  writes.length = 0;
  page.loadMembers();
  requests.find((r) => r.url === '/api/club/members').success({ code: '200', data: [{ memberId: 1, nickname: 'A' }, { memberId: 2, nickname: 'B' }] });
  assert.equal(writes.length, 1);
  assert.ok(writes[0].includes('members') && writes[0].includes('leaderboard'));
  assert.deepEqual(page.data.leaderboard.map((r) => r.memberId), [1, 2]);
});

test('L08-020 访客打开俱乐部页时不加载扫码 / AI 方案 / 金额 / 票源模块;用到时才加载', () => {
  const { page, requiredIds } = loadClubDetail();
  const rare = ['../utils/aiPlanToDraft.js', '../../../utils/verification-scan.js', '../../../utils/money-format.js', '../../../utils/ticket-source.js'];
  assert.deepEqual(requiredIds.filter((id) => rare.includes(id)), []);
  page.setData({ club: { id: 7, memberDiscountPrice: 12.5, prioritySignupEnabled: 0 } });
  assert.ok(typeof page.onPrivacyGateSettled === 'function');
});

test('L08-010 刷新时快照全保留就不重发:看板 / 期次 / 消息 / 管理主题', () => {
  const { page } = loadClubDetail();
  const writes = [];
  const orig = page.setData;
  page.setData = function (p, cb) { writes.push(Object.keys(p)); return orig.call(this, p, cb); };
  page._topics = [{ id: 1, name: 'A' }];
  page.setData({ clubId: 7, club: { id: 7, isOwner: true, viewerCanGovern: true }, manageTopics: [{ id: 1, name: 'A' }],
    isMerchantViewer: true, clubStatsState: 'ready', clubStats: { a: 1 }, shareEditionState: 'ready', messageState: 'ready', inviteFeedbackState: 'ready' });
  writes.length = 0;
  page.refreshManageTopics();
  page.loadClubStats();
  page.loadShareEditions();
  page.loadMessages();
  const flat = writes.flat();
  for (const key of ['manageTopics', 'clubStats', 'shareEditions', 'messages', 'sentInvites']) assert.ok(!flat.includes(key), key + ' 不应被原样重发');
});

test('L08-010 带队阶段没变就不重发;被别处改成 loading 后照样回写', () => {
  const { page } = loadClubDetail();
  const writes = [];
  const orig = page.setData;
  page.setData = function (p, cb) { writes.push(Object.keys(p)); return orig.call(this, p, cb); };
  page._topics = [];
  page.setData({ clubId: 7, club: { id: 7, isOwner: true, viewerCanGovern: true }, topicState: 'ready', ownerProjectState: 'ready', inviteFeedbackState: 'ready', messageState: 'ready', sentInvites: [], messages: [] });
  page._projectRows = [];
  page.updateOwnerStage();
  const stage = page.data.ownerStage;
  writes.length = 0;
  page.updateOwnerStage(); page.updateOwnerStage();
  assert.equal(writes.filter((k) => k.includes('ownerStage')).length, 0);
  page.setData({ ownerStage: 'loading' });
  page.updateOwnerStage();
  assert.equal(page.data.ownerStage, stage);
});

test('L08-011 关注作者 / 点赞回读只按路径改相关帖子行', () => {
  const { page, requests } = loadClubDetail();
  const writes = [];
  const orig = page.setData;
  page.setData = function (p, cb) { writes.push(Object.keys(p)); return orig.call(this, p, cb); };
  page.setData({ clubId: 7, posts: [{ id: 1, memberId: 5, likeCount: 1 }, { id: 2, memberId: 6, likeCount: 0 }, { id: 3, memberId: 5, likeCount: 2 }] });
  writes.length = 0;
  page._applyPostLike('2', true);
  assert.ok(writes.every((k) => !k.includes('posts')));
  assert.deepEqual(page.data.posts.map((p) => [p.id, p.likeCount]), [[1, 1], [2, 1], [3, 2]]);
});

test('L08-013 取场次列表共用一条读取:团码选场与场次工具同口径', () => {
  const { page, requests } = loadClubDetail();
  page.setData({ clubId: 7, club: { id: 7, viewerCanGovern: true }, groupCodeVisible: true });
  page._groupCodeTopicId = 31;
  page.selectGroupCodeActivity();
  const r = requests.filter((x) => x.url === '/api/topic/info-to-user');
  assert.equal(r.length, 1);
  assert.equal(JSON.stringify(r[0].data), JSON.stringify({ id: 31 }));
  r[0].fail();
  assert.equal(page.data.groupCodeState, 'error');
  assert.match(page.data.groupCodeErrMsg, /网络/);
});

test('L08-019 回归:概览下滑收起「加入」后去别的 tab 回到顶部,再切回概览时按钮要在', () => {
  const { page } = loadClubDetail();
  page.setData({ activeTab: 'overview', club: { id: 7, isJoined: false, isOwner: false } });
  page.onPageScroll({ scrollTop: 300 });
  page.onPageScroll({ scrollTop: 600 });
  assert.equal(page.data.joinHidden, true, '概览往下滑收起');
  page.switchTab({ currentTarget: { dataset: { tab: 'posts' } } });
  page.onPageScroll({ scrollTop: 0 });   // 在帖子 tab 回到顶部
  page.switchTab({ currentTarget: { dataset: { tab: 'overview' } } });
  assert.equal(page.data.joinHidden, false, '切回概览停在顶部:没法再往上滑,按钮不能一直收着');
});
