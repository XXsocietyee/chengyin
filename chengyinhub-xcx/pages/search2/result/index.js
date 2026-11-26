// 搜索结果独立页(2026-07-31):原来搜索输入后结果直接铺在 search2 同页下方,
// 现改成跳转到这里 —— 逻辑从 pages/search2/index.js 的 runSearch/updateVisibleResults 搬来,
// 数据源仍是同一个 utils/discover-search.js。
const toast = require('../../../utils/toast.js');
const { isMerchantView } = require('../../../utils/roleGuard.js');
const merchantTheme = require('../../../utils/merchant-theme.js'); // M-35:商家搜索结果同为浅色
const app = getApp();
const discoverSearch = require('../../../utils/discover-search.js');
const { openScene } = require('../../../utils/scene-entry.js');
const { memberId, failureStatus, recoverReadSession } = require('../../../utils/session/login-reload.js');
const DEFAULT_RESULT_TABS = [{ key: 'all', label: '全部' }];
// 合并搜索默认关闭(回 503),退回列表请求;「没开」记在 app 会话里(L05-159)。
function unifiedAvailable() { return !(app.globalData && app.globalData.searchUnifiedOff); }

Page({
  data: {
    statusBarHeight: (app.globalData || {}).statusBarHeight || 20,
    navBarHeight: (app.globalData || {}).navBarHeight || 44,
    keyword: '',
    categoryId: null,
    searchLoading: false,
    showSearchSkeleton: false,
    searchError: '',
    clubSearchDenied: '',
    contentLoading: false, contentHasMore: false, contentError: '', contentEnabled: false,
    // 出过结果没有。只用来判 auto-back:首屏搜索失败才自动退页,
    // 页内改关键词再搜的失败留在页内,别把用户刚打的词一起退掉(审查C A1)。
    everLoaded: false,
    activeResultType: 'all',
    resultTabs: DEFAULT_RESULT_TABS,
    resultGroups: [],
    visibleResults: []
  },

  onLoad(options) { if (isMerchantView()) this.setData({ merchantView: true });
    const keyword = options.keyword ? decodeURIComponent(options.keyword) : '';
    const categoryId = options.categoryId || null;
    this._filters = {
      cityCode: options.city_code || options.cityCode || '',
      startDate: options.startDate ? decodeURIComponent(options.startDate) : '',
      endDate: options.endDate ? decodeURIComponent(options.endDate) : '',
      minPrice: options.minPrice != null && options.minPrice !== '' ? Number(options.minPrice) : null,
      maxPrice: options.maxPrice != null && options.maxPrice !== '' ? Number(options.maxPrice) : null,
      // CU-M-66:入口页的排序选择必须活到请求里。四类里只有 /api/activity/list 有 sort_type,
      // 其余三类后端没有排序参数(buildRequests 只把它给 activity)。
      sortType: options.sortType ? String(options.sortType) : '',
    };
    this.setData({ keyword, categoryId });
    this.runSearch();
  },

  onKeywordInput(e) {
    this._searchSeq = (this._searchSeq || 0) + 1;
    this._content = null;
    clearTimeout(this._searchSkeletonTimer);
    this.setData({ keyword: (e.detail && e.detail.value) || '', searchLoading: false, showSearchSkeleton: false,
      keywordEditing: !!(this.data.keywordEditing || this.data.searchLoading || this.data.contentLoading), // 改词时保留上次结果,确认后再换;打断在途搜索时不抢先说「没有找到」
      contentLoading: false, contentHasMore: false, contentError: '', contentEnabled: false });
  },

  onSearchConfirm() {
    const keyword = String(this.data.keyword || '').trim();
    this.setData({ keyword: keyword }, () => this.runSearch());
  },

  onUnload() { if (this.data.merchantView) merchantTheme.merchantPageRestore();
    this._unloaded = true;
    this._searchSeq = (this._searchSeq || 0) + 1;
    clearTimeout(this._searchSkeletonTimer);
  },

  onShow() { if (this.data.merchantView) merchantTheme.merchantPageShow();
    this._hidden = false;
    // L05-158:换账号、结果超过 60 秒或没搜完才重搜;否则只重挂卡片
    const back = this._searchWasHidden;
    this._searchWasHidden = false;
    if (this._resultOwner !== undefined && this._resultOwner !== memberId(app) || back && !(Date.now() - this._searchDoneAt < 6e4)) this.runSearch();
    else if (back) {
      if (this._content) this._content.seq = this._searchSeq; // onHide 作废了序号;不重搜时把已搜完的内容分页接回,否则加载更多的回包被丢、一直转圈
      this.setData({ visibleResults: [] }, () => this.updateVisibleResults());
    }
  },
  onHide() { if (this.data.merchantView) merchantTheme.merchantPageRestore();
    this._hidden = true;
    this._searchWasHidden = true;
    if (this.data.searchLoading || this.data.contentLoading) this._searchDoneAt = 0;
    this._searchSeq = (this._searchSeq || 0) + 1;
    clearTimeout(this._searchSkeletonTimer);
  },

  runSearch() {
    if (this._hidden || this._unloaded) return;
    const { keyword, categoryId } = this.data;
    // 1121 N6:playerView 只给 decorateRows 选名字(主题/玩法 vs 主题模板/玩法模板),不进请求
    const filters = Object.assign({}, this._filters, { playerView: !this.data.merchantView });
    const owner = memberId(app);
    const unifiedOpen = unifiedAvailable();
    const useUnified = unifiedOpen && discoverSearch.unifiedCompatible(keyword, categoryId, filters);
    const requests = discoverSearch.buildRequests(keyword, categoryId, filters)
      .filter(request => !useUnified || !['topic', 'activity'].includes(request.type));
    const queryKey = String(keyword || '').trim() + '::' + String(categoryId || '')
      + '::' + String(filters.startDate || '') + '::' + String(filters.endDate || '')
      + '::' + String(filters.minPrice || '') + '::' + String(filters.maxPrice || '')
      + '::' + String(filters.sortType || '') + '::' + String(filters.cityCode || '');
    const preserveExisting = this._resultOwner === owner && this._resultQueryKey === queryKey
      && (this.data.resultGroups || []).some((group) => (group.items || []).length > 0);
    const previousGroups = {};
    // 合并搜索的主题/活动/帖文刷新时整体替换(已删除结果与城市不残留);原接口路径六类都保留上一次成功内容。
    const contentType = (type) => useUnified && ['topic', 'activity', 'post'].includes(type);
    if (preserveExisting) (this.data.resultGroups || []).forEach((group) => { if (!contentType(group.type)) previousGroups[group.type] = group.items || []; });
    const seq = (this._searchSeq || 0) + 1;
    this._searchSeq = seq;
    this._resultOwner = owner;
    this._contentGroups = [];
    this._content = useUnified ? { seq, owner, keyword: String(keyword).trim(), cityCode: filters.cityCode || '',
      types: typeof app.canUseCommunity === 'function' && app.canUseCommunity(false)
        ? ['topic', 'activity', 'post'] : ['topic', 'activity'], page: 0, items: [], loading: false } : null;
    this.setData({  clubSearchDenied: '', contentEnabled: useUnified, keywordEditing: false,
      contentLoading: false, contentHasMore: useUnified, contentError: '' });
    const isCurrent = () => !this._hidden && !this._unloaded && seq === this._searchSeq && owner === memberId(app);
    const groupsByType = {};
    let pending = requests.length;
    let failed = 0;

    clearTimeout(this._searchSkeletonTimer);

    if (preserveExisting) {
      this.setData({ searchLoading: true, showSearchSkeleton: false, searchError: '',
        resultGroups: (this.data.resultGroups || []).filter(group => !contentType(group.type)) });
      this.updateVisibleResults();
    } else {
      this.setData({ searchLoading: true, showSearchSkeleton: false, searchError: '', activeResultType: 'all', resultTabs: DEFAULT_RESULT_TABS, resultGroups: [], visibleResults: [] });
      if (requests.length) {
        this._searchSkeletonTimer = setTimeout(() => {
          if (isCurrent() && this.data.searchLoading && !this.data.visibleResults.length) {
            this.setData({ showSearchSkeleton: true });
          }
        }, 400);
      }
    }

    const finish = () => {
      pending -= 1;
      if (pending > 0 || !isCurrent()) return;
      clearTimeout(this._searchSkeletonTimer);
      const resultGroups = (this._contentGroups || []).concat(requests.map((request) => ({
        type: request.type,
        label: discoverSearch.labelOf(request.type, !this.data.merchantView),
        items: Object.prototype.hasOwnProperty.call(groupsByType, request.type) ? groupsByType[request.type] : (previousGroups[request.type] || [])
      })));
      this._searchDoneAt = Date.now();
      const hasResults = resultGroups.some((group) => group.items.length > 0), allFailed = failed === requests.length; this._resultQueryKey = hasResults || failed === 0 ? queryKey : this._resultQueryKey;
      this.setData({
        searchLoading: false,
        showSearchSkeleton: false,
        everLoaded: this.data.everLoaded || hasResults,
        searchError: failed > 0 && !hasResults
          ? (allFailed ? '搜索服务暂不可用，请重试' : '部分搜索没有完成，请重试后再确认结果')
          : '',
        resultGroups: resultGroups,
        resultTabs: DEFAULT_RESULT_TABS.concat(discoverSearch.resultTabs(resultGroups, !this.data.merchantView))
      });
      this.updateVisibleResults();
      if (failed > 0 && hasResults) toast('部分搜索没有完成，结果可能不全');
    };

    if (!requests.length) {
      this._resultQueryKey = queryKey; this.setData({ searchLoading: false, showSearchSkeleton: false }); return; }

    if (useUnified) this.loadMoreContent();

    // L05-160:主题模板整表与关键词无关,同账号本页只拉一次
    const templates = this._templateCache && this._templateCache.owner === owner ? this._templateCache : null;
    requests.forEach((request) => {
      let settled = false;
      if (request.type === 'topicTemplate' && templates) {
        groupsByType[request.type] = discoverSearch.decorateRows(request.type, templates.rows, { ...filters, keyword });
        settled = true; finish(); return;
      }
      const requestFailed = (res, status) => {
        if (!isCurrent() || settled) return;
        if (recoverReadSession(this, app, res, function (anonymous) {
          this._searchSeq++; this._content = null; this._contentGroups = [];
          this.setData({ resultGroups: [], visibleResults: [], resultTabs: DEFAULT_RESULT_TABS,
            searchLoading: false, showSearchSkeleton: false, searchError: '',
            contentLoading: false, contentHasMore: false, contentError: '', contentEnabled: false });
        }, this.runSearch, status)) return;
        if (!isCurrent()) return;
        const code = failureStatus(res, status);
        if (code === 401 || code === 403) {
          groupsByType[request.type] = [];
          if (request.type === 'club') this.setData({ clubSearchDenied: code === 403 ? '当前身份不能搜索俱乐部' : '' });
        }
        settled = true;
        failed += 1;
        finish();
      };
      app.sendRequest({
        hideLoading: true,
        autoErrorToast: false,   // 多路并发各自 toast 会连弹;全失败由 auto-back 半屏讲,部分失败在 finish 里报一次
        url: request.url,
        method: 'POST',
        auth: request.auth,
        data: request.data,
        header: request.header,
        success: (res) => {
          if (!isCurrent() || settled) return;
          if (res && res.code == 200) {
            if (request.type === 'topicTemplate' && Array.isArray(res.data)) this._templateCache = { owner, rows: res.data };
            groupsByType[request.type] = discoverSearch.decorateRows(request.type, res.data, { ...filters, keyword });
            if (request.type === 'topicTemplate' || request.type === 'gameTemplate') {
              groupsByType[request.type].forEach((item) => { item.cover = app.getImgUrl(item.cover); });
            }
            if (request.type === 'merchant' || request.type === 'club') {
              groupsByType[request.type].forEach((item) => {
                item.cardCover = app.getImgUrl(item.cardCover);
                item.cardLogo = app.getImgUrl(item.cardLogo);
                if (item.clubCard) {
                  item.clubCard.coverUrl = app.getImgUrl(item.clubCard.coverUrl);
                  item.clubCard.logoUrl = app.getImgUrl(item.clubCard.logoUrl);
                }
              });
            }
          } else {
            requestFailed(res); return;
          }
          settled = true;
          finish();
        },
        fail: requestFailed,
        successStatusAbnormal: requestFailed,
      });
    });
  },

  onReachBottom() {
    if (!this.data.contentError) this.loadMoreContent();
  },

  loadMoreContent() {
    const state = this._content;
    if (!state || state.loading || !this.data.contentHasMore || this._hidden || this._unloaded) return;
    if (state.owner !== memberId(app)) { this.runSearch(); return; }
    const page = state.page + 1;
    const live = () => this._content === state && state.seq === this._searchSeq && !this._hidden && !this._unloaded;
    const current = () => live() && state.owner === memberId(app);
    const switched = () => live() && state.owner !== memberId(app);
    let settled = false;
    state.loading = true;
    this.setData({ contentLoading: true, contentError: '' });
    const failed = (res, status) => {
      if (switched()) { this.runSearch(); return; }
      if (!current() || settled) return;
      settled = true; state.loading = false;
      if (recoverReadSession(this, app, res, function (anonymous) {
        this._searchSeq++; this._content = null; this._contentGroups = [];
        this.setData({ resultGroups: [], visibleResults: [], resultTabs: DEFAULT_RESULT_TABS,
          searchLoading: false, showSearchSkeleton: false, contentLoading: false, contentHasMore: false,
          contentError: '', contentEnabled: false });
      }, this.runSearch, status)) return;
      const code = failureStatus(res, status);
      // 合并搜索未开放(503/404):本轮改走主题/活动列表请求重搜,不给已登录用户空结果。
      if (code === 503 || code === 404) {
        if (app.globalData) app.globalData.searchUnifiedOff = true;
        this.setData({ contentLoading: false, contentHasMore: false, contentError: '' });
        this.runSearch();
        return;
      }
      if (code === 401 || code === 403) {
        state.items = []; state.page = 0; this._contentGroups = [];
        this.setData({ resultGroups: this.data.resultGroups.filter(g => !['topic', 'activity', 'post'].includes(g.type)) });
        this.updateVisibleResults();
      }
      this.setData({ resultTabs: DEFAULT_RESULT_TABS.concat(discoverSearch.resultTabs(this.data.resultGroups, !this.data.merchantView)),
        contentLoading: false, contentError: code === 503 ? '内容搜索暂未开放，可稍后重试'
        : code === 403 ? '当前身份不能查看这些内容' : '内容搜索未完成，重试本页' });
    };
    app.sendRequest({
      url: '/api/search/unified', method: 'GET', hideLoading: true, autoErrorToast: false,
      data: { keyword: state.keyword, types: state.types.join(','), city_code: state.cityCode, pageNum: page, pageSize: 12 },
      success: res => {
        if (switched()) { this.runSearch(); return; }
        if (!current() || settled) return;
        if (!res || Number(res.code) !== 200) { failed(res); return; }
        const result = discoverSearch.unifiedPage(res.data, state.types);
        if (!result) { failed({ code: 500 }); return; }
        settled = true; state.loading = false; state.page = page;
        result.items.forEach(item => { item.cover = app.getImgUrl(item.cover); });
        state.items = discoverSearch.mergeResults(state.items, result.items);
        this._contentGroups = state.types.map(type => ({ type, label: discoverSearch.labelOf(type, !this.data.merchantView),
          items: state.items.filter(item => item.type === type) }));
        const groups = this._contentGroups.concat(this.data.resultGroups.filter(g => !['topic', 'activity', 'post'].includes(g.type)));
        this.setData({ resultGroups: groups, contentLoading: false, contentError: '',
          contentHasMore: result.count > 0 && page * 12 < result.total,
          everLoaded: this.data.everLoaded || state.items.length > 0,
          resultTabs: DEFAULT_RESULT_TABS.concat(discoverSearch.resultTabs(groups, !this.data.merchantView)) });
        this.updateVisibleResults();
      }, fail: failed, successStatusAbnormal: failed
    });
  },

  updateVisibleResults() {
    const type = this.data.activeResultType;
    const groups = this.data.resultGroups || [];
    const visibleResults = groups.reduce((all, group) => {
      return type === 'all' || discoverSearch.tabKeyOf(group.type, !this.data.merchantView) === type ? all.concat(group.items) : all;
    }, []);
    this.setData({ visibleResults: visibleResults }); // 卡片入场只走 cy-fly-in(新挂上的卡才飞),不再叠一层整表重播
  },

  onResultTab(e) {
    this.setData({ activeResultType: e.detail.key }, () => this.updateVisibleResults());
  },

  goResult(e) {
    if (this._nav) return; // L05-180:连点只开一页(openScene 自己不防重入)
    this._nav = setTimeout(() => { this._nav = 0; }, 800);
    const sceneId = e.currentTarget.dataset.sceneId;
    const id = e.currentTarget.dataset.id;
    if (sceneId) {
      openScene(sceneId, { id });
      return;
    }
    const path = e.currentTarget.dataset.path;
    // 商家结果没绑会员主体时拼不出主页地址 —— 点了没反应会被当成卡死,给一句话
    if (path) wx.navigateTo({ url: path });
    else toast('这条结果暂不可打开');
  }
});
