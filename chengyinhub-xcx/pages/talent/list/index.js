const toast = require('../../../utils/toast.js'); const pageMotion = require('../../../utils/page-motion.js');
const { readPageStyle } = require('../../../utils/font-scale.js');
const app = getApp();
const roleGuard = require('../../../utils/roleGuard.js');
const merchantTheme = require('../../../utils/merchant-theme.js');
const policy = require('../../../utils/identity/identity-policy.js');
const { isRecord, isRecordList } = require('../../../utils/response-shape.js');
const discoverFeed = require('../../../utils/discover-feed.js');
const discoverNav = require('../../../utils/discover-nav.js');
const { storeCard } = require('../../../utils/discover-store-card.js');
const community = require('../../../utils/community-post-api.js').createClient(app, wx);
const FEED_PAGE_SIZE = 20;
const clubPostRepost = require('../../../utils/club-post-repost.js');
const postFeedActions = require('../../../utils/post-feed-actions.js');


// 主理人 L1-L5 等级对外文案(俱乐部继承展示;level=0 不显示)
const LEVEL_LABELS = ['', 'L1 新手', 'L2 稳定', 'L3 成熟', 'L4 城市运营者', 'L5 区域策划方'];
function levelTextOf(lv) { return (lv && LEVEL_LABELS[lv]) ? LEVEL_LABELS[lv] : (lv ? ('Lv.' + lv) : ''); }
function isOkRes(res) { return !!(res && (res.code == 200 || res.code == '200')); }
function requestError(res, fallback) {
  return app.getRequestErrorMessage ? app.getRequestErrorMessage(res, fallback) : fallback;
}
function normalizeClub(c) {
  if (!c) return c;
  if (c.id == null && c.clubId != null) c.id = c.clubId;
  c.levelText = levelTextOf(c.level);
  c.logoUrl = c.logo ? app.getImgUrl(c.logo) : '/images/d_logo.png';
  // 封面字段表里一直有,重设计卡片开始消费;空走组件的纯色底占位
  c.coverUrl = c.cover ? app.getImgUrl(c.cover) : '';
  return c;
}
Page({
  data: {
    viewerId: '', // 帖文卡:自己的帖子不出「+」关注
    // 顶栏几何
    statusBarHeight: app.globalData.statusBarHeight,
    navBarHeight: app.globalData.navBarHeight,
    headerH: 0,
    isSticky: false,
    // 俱乐部(R2 真实数据)
    myClubs: [],        // 我创建的俱乐部(多俱乐部)
    nearbyClubs: [],    // 城市俱乐部(展示用)
    clubsLoaded: false,
    clubsError: false,
    clubsLoginRequired: false,
    clubsPermissionDenied: false,
    clubsLoginPending: false,
    clubsState: 'idle', // idle | loading | refreshing | ready | empty | error | stale-error
    clubsErrorText: '',
    storeCard: null,
    isMerchantViewer: false,   // 商户视角:团体页只显示同城(附近)俱乐部,玩家不受影响
    merchantCity: '',
    merchantCityState: 'idle', // idle | loading | ready | error
    merchantCityError: '',
    merchantCityErrorKind: 'data',
    joinedClubs: [],       // 我加入的俱乐部(/api/club/home)

    // 2026-08-05:一级 tab「帖文 / 俱乐部」。2026-10-29 业主:页名改「发现」,帖文看全站。
    topTabs: [{ key: 'feed', label: '帖文' }, { key: 'club', label: '俱乐部' }],
    activeTopTab: 'club',
    feed: [],
    feedState: 'idle',      // idle | loading | refreshing | ready | empty | error | stale-error
    feedError: '',
    feedLoginRequired: false, // Round5 #2:俱乐部帖文流要登录;游客给与俱乐部列表同款登录入口,不报「加载失败」
  },

  onTopTabChange(e) {
    const key = e.detail.key;
    if (!key || key === this.data.activeTopTab) return;
    pageMotion.enter(this, key === 'feed' ? 'pmFeed' : 'pmClubs'); this.setData({ activeTopTab: key }); // 2026-10-23:切标签卡片依次浮上来
    if (key === 'feed' && this.data.feedState === 'idle') this.loadFeed();
  },

  /**
   * 发现页全站帖文流(2026-10-29 业主拍板):俱乐部帖文 + 社区帖文按发布时间合成一条,
   * 可见性 / 审核 / 拉黑 / 删除由两边后端各自判定;合并与翻页见 utils/discover-feed.js。
   */
  loadFeed() {
    if (this._feedLoading) return;
    const that = this;
    const hasSnapshot = ['ready', 'empty', 'stale-error'].indexOf(this.data.feedState) >= 0;
    const ctx = { requestId: (this._feedRequestId || 0) + 1, hasSnapshot: hasSnapshot, loadMore: false };
    this._feedRequestId = ctx.requestId;
    this._feedCtx = ctx;
    this._feedLoading = true;
    this.setData({
      feedState: hasSnapshot ? 'refreshing' : 'loading',
      feedError: '', feedLoginRequired: false,
    });
    const gate = typeof app.canUseCommunity === 'function' && !app.canUseCommunity(false)
      && typeof app.loadFeatureFlags === 'function' ? app.loadFeatureFlags() : Promise.resolve();
    Promise.resolve(gate).then(function () {
      if (!that._feedCurrent(ctx)) return null;
      that._feedMerger = discoverFeed.createFeedMerger(that._feedSources(ctx.requestId));
      return that._feedMerger.take(FEED_PAGE_SIZE);
    }).then(function (page) {
      if (!page || !that._feedCurrent(ctx)) return;
      ctx.done = true;
      that._feedLoading = false; pageMotion.enter(that, 'pmFeed', { once: true }); // 只首屏入场一次:下拉刷新不再藏起重播;切帖文/俱乐部标签(77 行)照旧浮上来
      that._feedHasMore = page.hasMore;
      that.setData({
        feed: page.rows,
        feedState: page.rows.length ? 'ready' : 'empty',
        feedError: '',
      });
    }, function (res) { that._onFeedFail(ctx, res); });
  },

  // r2-store 通票入口卡:玩家视角、已登录、服务端有在售通票才出;读失败就不出,不占位。每次进页只读一次。
  loadStoreCard() {
    if (this.data.isMerchantViewer) { if (this.data.storeCard) this.setData({ storeCard: null }); return; }
    if (this._storeCardRead) return;
    this._storeCardRead = true;
    const that = this;
    app.sendRequest({ url: '/api/marketing/product/list', method: 'GET', data: { limit: 50 }, hideLoading: true, autoErrorToast: false,
      success: function (res) { if (!that._unloaded) that.setData({ storeCard: res && String(res.code) === '200' ? storeCard(res.data) : null }); },
    });
  },

  goStore() {
    wx.navigateTo({ url: '/subpackageMember/market/passes/index' });
  },

  loadMoreFeed() {
    if (this._feedLoading || !this._feedMerger || !this._feedHasMore) return;
    const that = this;
    const ctx = { requestId: this._feedRequestId, hasSnapshot: true, loadMore: true };
    this._feedCtx = ctx;
    this._feedLoading = true;
    this._feedMerger.take(FEED_PAGE_SIZE).then(function (page) {
      if (!that._feedCurrent(ctx)) return;
      ctx.done = true;
      that._feedLoading = false;
      that._feedHasMore = page.hasMore;
      // 每页 20 条,整表 concat 的序列化量可控;路径追加的动态键要进 UI 门禁登记,这里不用。
      if (page.rows.length) that.setData({ feed: that.data.feed.concat(page.rows) });
    }, function (res) { that._onFeedFail(ctx, res); });
  },

  _feedCurrent(ctx) {
    return !this._unloaded && !ctx.done && ctx.requestId === this._feedRequestId;
  },

  // 两路请求的 fail 与归并的 reject 都汇到这里,同一轮只落一次。首屏/刷新失败进错误态(load-failure 留白);
  // 翻页失败按全站口径不出错误文案,没取到的那一路保留游标,下次触底重试。
  _onFeedFail(ctx, res) {
    if (!ctx || !this._feedCurrent(ctx)) return;
    ctx.done = true;
    this._feedLoading = false;
    if (ctx.loadMore) return;
    this.setData({
      feedState: ctx.hasSnapshot ? 'stale-error' : 'error',
      feedLoginRequired: !!(res && res.loginRequired),
      feedError: res && res.loginRequired ? '' : requestError(res, '动态加载失败，请重试'),
    });
  },

  retryFeed() {
    if (!this.data.feedLoginRequired) return this.loadFeed();
    const login = typeof app.firstLogin === 'function' ? app.firstLogin() : null;
    return Promise.resolve(login).then(() => {
      if (!this._unloaded && app.getUserID()) this.loadFeed();
    }, () => {});
  },

  _feedSources(requestId) {
    const that = this;
    const communityOn = typeof app.canUseCommunity === 'function' && app.canUseCommunity(false);
    // PG-001:后端 scope=all 已对游客开放公开俱乐部的公开帖;只有真 401(HTTP 或业务码)才兜底:
    // 有社区帖就只显示社区帖,两路都没有才落「登录后查看帖文」。其他失败照常进错误态。
    const guestClubFail = function (res, beforeId, resolve, reject, status) {
      if (app.getUserID() > 0) return false;
      const authFail = status == 401 || (res && res.code == 401);
      if (!authFail) return false;
      if (communityOn) resolve({ rows: [], hasMore: false, cursor: beforeId });
      else reject({ loginRequired: true });
      return true;
    };
    const sources = [{ fetch: function (beforeId) {
      return new Promise(function (resolve, reject) {
        const data = { scope: 'all', limit: FEED_PAGE_SIZE };
        if (beforeId) data.beforeId = beforeId;
        app.sendRequest({
          hideLoading: true, silentError: true,
          url: '/api/club/post/feed', method: 'POST',
          data: JSON.stringify(data),
          header: { 'Content-Type': 'application/json' },
          success(res) {
            if (!isOkRes(res) || !isRecord(res.data) || !isRecordList(res.data.rows)
                || typeof res.data.hasMore !== 'boolean') {
              if (guestClubFail(res, beforeId, resolve, reject)) return;
              return reject(res);
            }
            const rows = res.data.rows.map(discoverFeed.normalizeClubPost);
            resolve({ rows: rows, hasMore: res.data.hasMore, cursor: rows.length ? rows[rows.length - 1].id : beforeId });
          },
          fail(res, status) {
            if (guestClubFail(res, beforeId, resolve, reject, status)) return;
            if (requestId === that._feedRequestId) that._onFeedFail(that._feedCtx, res); reject(res);
          },
        });
      });
    } }];
    if (typeof app.canUseCommunity === 'function' && app.canUseCommunity(false)) {
      sources.push({ fetch: function (pageNum) {
        const page = pageNum || 1;
        return new Promise(function (resolve, reject) {
          community.request({
            hideLoading: true, silentError: true,
            url: '/api/creativesquare/list', method: 'POST',
            auth: app.getUserID() > 0,
            data: { is_my: 0, user_id: 0, pageNum: page, pageSize: FEED_PAGE_SIZE },
            success(res) {
              if (!res || res.code != 200 || !isRecord(res.data) || !isRecordList(res.data.rows)) return reject(res);
              resolve({ rows: res.data.rows.map(discoverFeed.normalizeCommunityPost), hasMore: res.data.hasMore === true, cursor: page + 1 });
            },
            fail(res) { if (requestId === that._feedRequestId) that._onFeedFail(that._feedCtx, res); reject(res); },
          });
        });
      } });
    }
    return sources;
  },

  onReachBottom() {
    if (this.data.activeTopTab === 'feed') this.loadMoreFeed();
  },

  onPostTap(e) {
    const post = this.data.feed[e.detail && e.detail.index];
    if (post && post.source === 'community') {
      if (post.id) wx.navigateTo({ url: '/pages/square/detail/index?id=' + post.id });
      return;
    }
    const clubId = e.detail && e.detail.clubId;
    const postId = e.detail && e.detail.postId;
    if (clubId && postId) wx.navigateTo({ url: '/pages/club/detail/index?id=' + clubId + '&postId=' + postId });
  },

  // 引用卡上的两个动作:看主题 / 现在去玩。拿不到被引主题就退回帖子本身,不做死区。
  onPostReference(e) {
    const post = this.data.feed[e.detail && e.detail.index];
    if (!post || !post.sportTopicId) return this.onPostTap(e);
    wx.navigateTo({ url: '/pages/topic/index/index?id=' + post.sportTopicId });
  },

  onPostReferencePlay(e) {
    const post = this.data.feed[e.detail && e.detail.index];
    if (!post || !post.sportTopicId) return this.onPostTap(e);
    wx.navigateTo({ url: '/pages/play/index?topicId=' + post.sportTopicId });
  },

  // dw29 L8 转发/撤销:乐观切换,失败回滚并原样显示后端提示
  onRepostPost(e) {
    if (app.ensureLoginFor && !app.ensureLoginFor('like', () => this.onRepostPost(e), { owner: this, target: () => [e.detail && e.detail.postId] })) return;
    const postId = e.detail && e.detail.postId;
    if (postId == null) return;
    clubPostRepost.toggleRepost({ page: this, listKey: 'feed', postId: postId, app: app, toast: toast });
  },

  // 帖文第三轮:点赞(心形弹 + 数字滚,先改卡面、失败回滚)与头像「+」关注,三处帖文流共用 utils/post-feed-actions
  onLikePost(e) {
    if (app.ensureLoginFor && !app.ensureLoginFor('like', () => this.onLikePost(e), { owner: this, target: () => [e.detail && e.detail.postId] })) return;
    postFeedActions.toggleLike({ page: this, listKey: 'feed', index: e.detail && e.detail.index, app: app, toast: toast, apply: (next) => this.setData({ feed: next }) });
  },

  onFollowPost(e) {
    if (app.ensureLoginFor && !app.ensureLoginFor('like', () => this.onFollowPost(e), { owner: this, target: () => [e.detail && e.detail.memberId] })) return;
    postFeedActions.follow({ page: this, listKey: 'feed', index: e.detail && e.detail.index, app: app, toast: toast, apply: (next) => this.setData({ feed: next }) });
  },

  onPostUser(e) {
    const memberId = e.detail && e.detail.memberId;
    if (memberId) wx.navigateTo({ url: '/pages/userinfo/userinfo?userId=' + memberId });
  },

  onPostClub(e) {
    const clubId = e.detail && e.detail.clubId;
    if (clubId) wx.navigateTo({ url: '/pages/club/detail/index?id=' + clubId });
  },

  onLoad(options) {
    this._unloaded = false;
    this._skipInitialShow = true;
    this.initNav();
    this.detectMerchant();
    this.loadClubHome();
    // 帖文通用分享卡落在 ?tab=feed(pages/square/utils/square-share.js)
    if (options && options.tab === 'feed') { this.setData({ activeTopTab: 'feed' }); this.loadFeed(); }
  },

  // 商户视角:团体页只显示同城(附近)俱乐部 — 取商户所在城市用于过滤(玩家 isMerchantViewer=false,不受影响)
  detectMerchant() {
    var isMerchant = policy.isMerchantView({
      role: app.getUserRole(),
      userType: app.getUserType(),
      debugView: wx.getStorageSync('debug_user_view'),
    });
    if (!isMerchant) {
      this._merchantInfoRequestId = (this._merchantInfoRequestId || 0) + 1;
      this._merchantInfoLoading = false;
      var all = this._nearbyAll || this.data.nearbyClubs || [];
      this.setData({
        isMerchantViewer: false,
        merchantCity: '',
        merchantCityState: 'idle',
        merchantCityError: '',
        merchantCityErrorKind: 'data',
        nearbyClubs: all,
      });
      return isMerchant;
    }
    this.setData({ isMerchantViewer: true });
    if (this._merchantInfoLoading) return isMerchant;
    var that = this;
    var requestId = (this._merchantInfoRequestId || 0) + 1;
    this._merchantInfoRequestId = requestId;
    this._merchantInfoLoading = true;
    this.setData({ merchantCityState: 'loading', merchantCityError: '' });
    function isCurrent() {
      return !that._unloaded && requestId === that._merchantInfoRequestId && that.data.isMerchantViewer;
    }
    function fail(res, kind) {
      if (!isCurrent()) return;
      that._merchantInfoLoading = false;
      var full = that._nearbyAll || that.data.nearbyClubs || [];
      that.setData({
        merchantCity: '',
        merchantCityState: 'error',
        merchantCityError: requestError(res, kind === 'network' ? '网络异常，同城范围暂未确认' : '店铺城市暂未取回'),
        merchantCityErrorKind: kind || 'data',
        nearbyClubs: full,
      });
    }
    app.sendRequest({
      url: '/api/merchant/info', method: 'POST', hideLoading: true, silentError: true,
      success: function (res) {
        if (!isCurrent()) return;
        if (!isOkRes(res) || !isRecord(res.data)) return fail(res, 'data');
        var d = res.data;
        var city = typeof d.city === 'string' && d.city.trim()
          ? d.city.trim()
          : (typeof d.address === 'string' ? d.address.trim() : '');
        if (!city) return fail(res, 'data');
        that._merchantInfoLoading = false;
        that.setData({ merchantCity: city, merchantCityState: 'ready', merchantCityError: '', merchantCityErrorKind: 'data' });
        that.applyNearbyFilter();
      },
      fail: function (res) { fail(res, 'network'); }
    });
    return isMerchant;
  },

  // 同城过滤:仅商户生效;城市未知则不过滤(避免误清空)。数据无经纬度,"附近"口径 = 同城。
  applyNearbyFilter() {
    if (!this.data.isMerchantViewer) return;
    var full = this._nearbyAll || this.data.nearbyClubs || [];
    var city = String(this.data.merchantCity || '').trim();
    if (!city) { this.setData({ nearbyClubs: full }); return; }
    var filtered = full.filter(function (c) {
      var loc = String(c.city || c.address || '');
      return loc && (loc.indexOf(city) >= 0 || (c.city && city.indexOf(c.city) >= 0));
    });
    this.setData({ nearbyClubs: filtered });
  },

  // 一级 tab 页原本一个都不能下拉刷新:feed 陈旧后用户唯一的手段是退出重进。
  onPullDownRefresh() {
    this.loadClubHome();
    this.loadImUnread();
    if (this.data.activeTopTab === 'feed') this.loadFeed();
  },

  onShow() {

    this.setData({ fontScaleStyle: readPageStyle(), viewerId: String(app.getUserID() || '') });
    const isMerchantViewer = policy.isMerchantView({
      role: app.getUserRole(),
      userType: app.getUserType(),
      debugView: wx.getStorageSync('debug_user_view'),
    });
    if (isMerchantViewer !== this.data.isMerchantViewer) this.detectMerchant();
    if (isMerchantViewer) merchantTheme.merchantPageShow();
    else merchantTheme.merchantPageRestore();
    if (discoverNav.consumeDiscoverFeed(app)) {
      if (this.data.activeTopTab !== 'feed') { pageMotion.enter(this, 'pmFeed'); this.setData({ activeTopTab: 'feed' }); }
      if (!this._feedLoading) this.loadFeed();
    }
    else if (this.data.feedLoginRequired && app.getUserID() && this.data.activeTopTab === 'feed' && !this._feedLoading) this.loadFeed();
    if (this._skipInitialShow) this._skipInitialShow = false;
    else this.loadClubHome();
    this.loadImUnread();
    this.loadStoreCard();
  },

  onHide() { this._loginContinuationEpoch = (this._loginContinuationEpoch || 0) + 1; merchantTheme.merchantPageRestore(); },
  onUnload() { this._loginContinuationEpoch = (this._loginContinuationEpoch || 0) + 1;
    merchantTheme.merchantPageRestore();
    this._unloaded = true;
    this._feedRequestId = (this._feedRequestId || 0) + 1;
    this._clubHomeRequestId = (this._clubHomeRequestId || 0) + 1;
    this._merchantInfoRequestId = (this._merchantInfoRequestId || 0) + 1;
    this._feedLoading = false;
    this._clubHomeLoading = false;
    this._merchantInfoLoading = false;
  },

  // 俱乐部首页聚合(/api/club/home):我的 / 加入 / 附近 / 主理人态
  loadClubHome() {
    const owner = typeof app.getUserID === 'function' ? String(app.getUserID() || '') : '';
    if (owner !== this._clubHomeOwner) {
      this._clubHomeRequestId = (this._clubHomeRequestId || 0) + 1;
      this._clubHomeLoading = false;
      this._clubHomeOwner = owner;
      this._nearbyAll = [];
      this.setData({ myClubs: [], joinedClubs: [], nearbyClubs: [], clubsLoaded: false, clubsState: 'idle' });
    }
    if (!owner) { this.loadGuestClubs(); return; }
    if (this._clubHomeLoading) return;
    var that = this;
    var hasSnapshot = ['ready', 'empty', 'stale-error'].indexOf(this.data.clubsState) >= 0
      || (this.data.clubsLoaded && !this.data.clubsError);
    var requestId = (this._clubHomeRequestId || 0) + 1;
    this._clubHomeRequestId = requestId;
    this._clubHomeLoading = true;
    this.setData({
      clubsState: hasSnapshot ? 'refreshing' : 'loading',
      clubsLoginRequired: false, clubsPermissionDenied: false,
      clubsError: false,
      clubsErrorText: '',
    });
    function isCurrent() { return !that._unloaded && requestId === that._clubHomeRequestId && owner === String(app.getUserID() || ''); }
    function fail(res, kind, statusCode) {
      if (!isCurrent()) return;
      that._clubHomeLoading = false;
      const code = Number(statusCode || res && (res.code || res.statusCode));
      const loginRequired = code === 401;
      const denied = code === 403;
      if (loginRequired || denied) {
        that._nearbyAll = [];
        that.setData({ myClubs: [], joinedClubs: [], nearbyClubs: [],
          clubsLoginRequired: loginRequired, clubsPermissionDenied: denied, clubsLoaded: false,
          clubsError: true, clubsState: 'error', clubsErrorText: loginRequired ? '登录后可查看我的俱乐部' : requestError(res, '当前身份不能查看俱乐部') });
        return;
      }
      that.setData({
        clubsLoaded: hasSnapshot,
        clubsError: true,
        clubsState: hasSnapshot ? 'stale-error' : 'error',
        clubsErrorText: requestError(res, '俱乐部列表加载失败，请重试'),
      });
    }
    app.sendRequest({
      // 下拉刷新的收圈绑在真实完成上;非下拉场景下 stopPullDownRefresh 是 no-op
      complete() { wx.stopPullDownRefresh(); },
      hideLoading: true, silentError: true,
      url: '/api/club/home',
      method: 'POST',
      data: {},
      success: function (res) {
        if (!isCurrent()) return;
        if (!isOkRes(res) || !isRecord(res.data) || !isRecordList(res.data.owned)
            || !isRecordList(res.data.joined) || !isRecordList(res.data.nearby)
            || !isRecord(res.data.leaderStatus)) return fail(res, 'data');
        var d = res.data;
        var owned = d.owned.map(normalizeClub);
        owned.forEach(function (c) { c.isOwner = true; });
        var joined = d.joined.map(normalizeClub);
        // joined 列表天然已加入;后端行未必带 isJoined,卡片按钮三态靠它判「进入」
        joined.forEach(function (c) { c.isJoined = true; });
        var nearby = d.nearby.map(normalizeClub);
        that._clubHomeLoading = false;
        that._nearbyAll = nearby; pageMotion.enter(that, 'pmClubs', { once: true }); // C-01:切回 tab 的后台刷新不再把已在屏上的卡片藏起来重播
        that.setData({
          myClubs: owned,
          joinedClubs: joined,
          nearbyClubs: nearby,
          clubsLoaded: true,
          clubsError: false,
          clubsState: owned.length || joined.length || nearby.length ? 'ready' : 'empty',
          clubsErrorText: ''
        });
        that.applyNearbyFilter();
      },
      successStatusAbnormal: function (res, statusCode) { fail(res, 'http', statusCode); },
      fail: function (res, statusCode) { fail(res, 'network', statusCode); }
    });
  },

  // 2026-10-24 owner 拍板「游客可浏览」:游客读公开俱乐部目录(/api/club/list,匿名可读、只出公开可见团),
  // 2026-11-14：目录失败正常重试；「加入」仍走写前登录弹窗。
  loadGuestClubs() {
    const that = this;
    const requestId = (this._clubHomeRequestId || 0) + 1;
    this._clubHomeRequestId = requestId;
    const isCurrent = () => !that._unloaded && requestId === that._clubHomeRequestId && !String(app.getUserID() || '');
    const loginEntry = () => {
      if (!isCurrent()) return;
      that.setData({ clubsLoginRequired: false, clubsPermissionDenied: false, clubsError: true,
        clubsState: 'error', clubsErrorText: '俱乐部加载失败，请重试' });
    };
    app.sendRequest({
      complete() { wx.stopPullDownRefresh(); },
      hideLoading: true,
      url: '/api/club/list', method: 'POST', data: JSON.stringify({}), header: { 'Content-Type': 'application/json' },
      success: function (res) {
        if (!isCurrent()) return;
        if (!isOkRes(res) || !isRecordList(res.data)) return loginEntry();
        const nearby = res.data.map(normalizeClub);
        that._nearbyAll = nearby;
        that.setData({ myClubs: [], joinedClubs: [], nearbyClubs: nearby,
          clubsLoaded: true, clubsError: false, clubsLoginRequired: false, clubsPermissionDenied: false,
          clubsState: nearby.length ? 'ready' : 'empty', clubsErrorText: '' });
      },
      successStatusAbnormal: loginEntry,
      fail: loginEntry,
    });
  },

  retryClubs() {
    if (this.data.clubsLoginRequired) this.onLoginClubs();
    else this.loadClubHome();
  },

  onLoginClubs() {
    if (this.data.clubsLoginPending) return;
    const epoch = (this._clubsLoginEpoch || 0) + 1;
    this._clubsLoginEpoch = epoch;
    this.setData({ clubsLoginPending: true });
    const login = app.getUserID() && typeof app.reLogin === 'function' ? app.reLogin()
      : typeof app.firstLogin === 'function' ? app.firstLogin() : null;
    Promise.resolve(login).then(result => {
      if (this._unloaded || epoch !== this._clubsLoginEpoch) return;
      this.setData({ clubsLoginPending: false });
      if (app.getUserID() && !(result && result.ok === false)) this.loadClubHome();
      else this.setData({ clubsErrorText: '登录没有成功，请检查网络后重试' });
    }).catch(() => {
      if (!this._unloaded && epoch === this._clubsLoginEpoch) this.setData({ clubsLoginPending: false, clubsErrorText: '登录没有成功，请检查网络后重试' });
    });
  },

  // 站内消息未读红点
  loadImUnread() {
    if (typeof app.getUserID !== 'function' || !app.getUserID()) return;
    var that = this;
    app.sendRequest({
      url: '/api/im/unread-total', method: 'POST', hideLoading: true,
      success: function (res) { if (res && res.code == 200) that.setData({ imUnread: res.data || 0 }); },
      fail: function () {},
    });
  },

  // 顶栏 + tab 栏几何。2026-10-27 P-13:消息铃铛挪到左上角,不再需要避让右侧胶囊的 rightGap。
  initNav() {
    var headerH = this.data.statusBarHeight + this.data.navBarHeight;
    this.setData({ headerH: headerH });
  },

  onPageScroll(e) {
    var s = e.scrollTop > 4;
    if (s !== this.data.isSticky) this.setData({ isSticky: s });
  },

  // 商户查看俱乐部对其发起的合作邀约(接受/拒绝)→ 合作中心。
  // 2026-08-08:原先跳 coop/list,但商家的接受/拒绝已全部收敛到 merchant/coop-center,
  // coop/list 只剩发起方视角 —— 商家再跳过去会看到一个自己无法处理的列表。

  // 顶栏交互
  onMsgTap() { wx.navigateTo({ url: '/subpackageB/pages/im/list/index' }); },

  // 进俱乐部公开主页(详情页)
  goClubDetail(e) {
    var id = e.currentTarget.dataset.clubId || e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: '/pages/club/detail/index?id=' + id });
  },

  // 创建俱乐部:已是主理人→表单B 直接建团;否则→表单A 先成为主理人(后端要求先有档案)
  onClubApply() {
    var isLeader = roleGuard.isClubLeader();
    var url = isLeader ? '/pages/club/create/index' : '/pages/club/apply/index';
    wx.navigateTo({ url: url });
  },
  onShareAppMessage(res) {
    const dataset = res.target && res.target.dataset;
    if (res.from === 'button' && dataset && dataset.postId && dataset.clubId) {
      return {
        title: '城瘾俱乐部帖文',
        path: '/pages/club/detail/index?id=' + dataset.clubId + '&postId=' + dataset.postId
      };
    }
    if (res.from === 'button' && dataset && dataset.id) {
      return {
        title: dataset.name || '城市路线',
        path: '/pages/topic/index/index?id=' + dataset.id
      };
    }
    return {};
  }
});
