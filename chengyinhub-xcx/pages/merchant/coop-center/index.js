const moneyFormat = require('../../../utils/money-format.js')
const app = getApp();
const toast = require('../../../utils/toast.js');
const merchantTheme = require('../../../utils/merchant-theme.js');
const { readReducedMotion } = require('../../../utils/motion-preference.js');
const { normalizeRecruiting } = require('../utils/merchant-aggregate.js');
const officialChannel = require('../../../utils/merchant-official-channel.js');
const { toTimestamp } = require('../../../utils/datetime.js');
const { monthDay } = require('../utils/month-day.js');
const { hasValue, visibleRecruitItems } = require('../utils/recruit-routes.js');

// 稿 234:276 合作中心:tab = 官方活动 / 广场,右上角铃铛进协作邀请(收到的 / 我发出的)。
// 2026-09-15 用户裁决「全站只有收到的/我发出的两个入口」:原「邀约我的」tab 删除,
//   商家收到的协作邀约、俱乐部带队申请、官方邀约都在 pages/coop/list「收到的」处理;
//   原卡上「申请承接」挪到「看详情」(pages/topic/merchantinfo 有同一套章节申请 + chapter-node-form)。

const PRODUCT_TYPE_TEXT = { 1: '城市定向', 2: '自由探索' };
// 章节档位 CmsTopicChapter.termsMode;economics 口径见 MerchantAggregateReadServiceImpl.recruitTermsEconomics
const TERMS_MODE_TEXT = { PERK: '权益核销', REVSHARE: '分润计酬', TRAFFIC: '引流合作 · 无结算' };


// 余席:remainingMerchantCount null = 不招商或不限名额(TopicMerchantCapacity 注释:调用方不得渲染成已满)→ 不写。
// 阈值:0 = 已满、1 = 最后一席(琥珀)、≥2 绿。1 是唯一「再有一家申请就关门」的值,与稿例 3→绿 / 1→琥珀一致。
function seatOf(remaining) {
  if (remaining == null || remaining === '' || !Number.isFinite(Number(remaining))) return { seatText: '', seatTone: '' };
  const n = Number(remaining);
  if (n <= 0) return { seatText: '已满', seatTone: 'tight' };
  return { seatText: '余 ' + n + ' 席', seatTone: n === 1 ? 'tight' : 'ok' };
}

function termsLine(item) {
  const modes = Array.isArray(item.termsModes) ? item.termsModes.filter((m) => TERMS_MODE_TEXT[m]) : [];
  if (modes.length !== 1) return modes.map((m) => TERMS_MODE_TEXT[m].split(' ·')[0]).join(' / ');
  const mode = modes[0];
  if (mode === 'PERK' && item.perkMinValue != null) return TERMS_MODE_TEXT.PERK + ' · 权益不低于 ¥' + (moneyFormat.decimalText(item.perkMinValue) || item.perkMinValue);
  if (mode === 'REVSHARE' && item.maxPerHeadFee != null) return TERMS_MODE_TEXT.REVSHARE + ' · 人头费上限 ¥' + (moneyFormat.decimalText(item.maxPerHeadFee) || item.maxPerHeadFee) + '/人次';
  return TERMS_MODE_TEXT[mode];
}

function routeCards(items) {
  const now = Date.now();
  // M-23:过滤口径与营销页「N 个开放商机」同源(recruit-routes.visibleRecruitItems)
  return visibleRecruitItems(items, now).map((item) => {
    const deadline = toTimestamp(item.recruitDeadline || item.merchantSignUpEndDate);
    const start = monthDay(item.startDate);
    const end = monthDay(item.endDate);
    return Object.assign({
      id: item.id,
      key: 'route-' + item.id,
      title: item.name,
      cover: item.imgUrl || '',
      modeText: PRODUCT_TYPE_TEXT[item.productType] || '',
      dateText: start && end && start !== end ? start + ' – ' + end : start,
      // 卡片底行的短统计(图上空间有限):城市放进档期行,这里只留站数 / 截止日
      cityText: item.cityKeyword || '',
      stationText: item.locationCount ? item.locationCount + ' 站' : '',
      deadlineShort: deadline && deadline > now ? '截止 ' + monthDay(deadline) : '',
      termsText: termsLine(item),
      // P0-4:自由探索按位置招商，卡面写出还空着的位置名
      slotText: Array.isArray(item.slotNames) ? item.slotNames.filter(hasValue).join(' · ') : '',
    }, seatOf(item.remainingMerchantCount));
  });
}

/**
 * CU-M-133:广场一次只排 10 张,过去不交代剩余 —— 商家以为屏幕上这些就是全部商机,
 * 而真正还没截止的那几条可能被挤出整张列表。有剩余就在列表尾写明「共 N · 当前列出 M」。
 */
function routeScopeText(recruiting) {
  if (!recruiting || recruiting.hasMoreOpen !== true) return '';
  const shown = recruiting.shownCount >= 0 ? recruiting.shownCount : (recruiting.items || []).length;
  return '共 ' + recruiting.openCount + ' 个开放商机 · 当前列出前 ' + shown + ' 个';
}

Page({
  data: {
    focusAnchor: '',
    flyClass: '',   // owner 10-22:每次打开页面广场卡飞入(onShow 飞入、onHide 先藏好等下次重播)
    statusBarHeight: app.globalData.statusBarHeight || 20,
    navBarHeight: app.globalData.navBarHeight || 44,
    tabs: [
      { key: 'official', label: '官方活动' },
      { key: 'plaza', label: '广场' },
    ],
    activeTab: 'plaza',
    routes: [],
    routeScopeText: '',
    events: [],
    routesLoading: true,
    eventsLoading: true,
    routesError: '',
    eventsError: '',
  },

  onLoad(options) {
    if (options && options.tab === 'official') this.setData({ activeTab: 'official' });
    // CU-M-85:参谋页推荐卡带 ?topicId= 进来 —— 同名主题(两期「探店日一期」)在广场里是
    // 两条不同日期的招商,进来后必须直接定位到对应那条,不能让用户再认一遍。
    this._focusTopicId = options && options.topicId ? String(options.topicId).trim() : '';
    this.loadAvailable();
  },

  onShow() {
    merchantTheme.merchantPageShow();
    this.setData({ flyClass: readReducedMotion() ? '' : 'cy-fly-in' });
    if (this._hasShown) this.loadAvailable();
    this._hasShown = true;
  },
  onPullDownRefresh() {
    this.loadAvailable();
    setTimeout(() => wx.stopPullDownRefresh(), 400);
  },
  onHide() {
    merchantTheme.merchantPageRestore();
    this.setData({ flyClass: readReducedMotion() ? '' : 'cy-fly-wait' });
  },
  onUnload() { merchantTheme.merchantPageRestore(); },

  onNavBack() {
    if (getCurrentPages().length > 1) wx.navigateBack();
    else wx.reLaunch({ url: '/pages/merchant/marketing/index' });
  },

  onTabChange(e) {
    this.setData({ activeTab: e.detail.key });
    if (e.detail.key === 'official' && !this._eventsRequested) this.loadEvents();
  },

  // 右上角铃铛:2026-10-22 owner 裁决 —— 邀请就是收件箱 / 发件箱,进消息页(收件箱=会话+收到的邀请,发件箱=发出的邀请)
  goInbox() { wx.navigateTo({ url: '/subpackageB/pages/im/list/index' }); },

  // L07-055:官方活动 tab 首次切过去才读(默认停在广场)
  loadAvailable() {
    this.loadRoutes();
    if (this.data.activeTab === 'official') this.loadEvents();
  },

  loadRoutes() {
    if (this._routesLoading) return;
    this._routesLoading = true;
    this.setData({ routesLoading: true, routesError: '' });
    app.sendRequest({
      url: '/api/merchant/marketing-home', method: 'POST', hideLoading: true, silentError: true,
      success: (res) => {
        const recruiting = res && (res.code == 200 || res.code == '200') ? normalizeRecruiting(res.data) : null;
        const home = recruiting ? { recruiting } : null;
        if (!home) {
          this._routesLoading = false;
          this.setData({ routeScopeText: '', routesError: app.getRequestErrorMessage(res, '路线加载失败'), routesLoading: false });
          this._toastRefreshFailed('routes');
          return;
        }
        this._routesLoading = false;
        this._routesPage = 1;
        this._routesEpoch = (this._routesEpoch || 0) + 1;
        this._routesMoreLoading = false;
        this._routesMore = home.recruiting.hasMoreOpen === true;
        this.setData({
          routes: routeCards(home.recruiting.items),
          routeScopeText: routeScopeText(home.recruiting),
          routesLoading: false,
        }, () => this._locateFocusTopic());
      },
      fail: (res) => {
        this._routesLoading = false;
        this.setData({ routesError: app.getRequestErrorMessage(res, '路线加载失败'), routesLoading: false });
        this._toastRefreshFailed('routes');
      },
    });
  },

  // P0-4:首屏 10 条来自 marketing-home，滚到底按页续取(同一份行合同)，按 id 去重后接在后面。
  loadMoreRoutes() {
    if (this.data.activeTab !== 'plaza' || !this._routesMore || this._routesMoreLoading || this._routesLoading) return;
    const epoch = this._routesEpoch || 0;
    const pageNum = (this._routesPage || 1) + 1;
    this._routesMoreLoading = true;
    const done = () => { if (epoch === (this._routesEpoch || 0)) this._routesMoreLoading = false; };
    app.sendRequest({
      url: '/api/merchant/recruit-routes', method: 'POST', hideLoading: true,
      data: { pageNum, pageSize: 10 },
      success: (res) => {
        if (epoch !== (this._routesEpoch || 0)) return;
        done();
        const data = res && (res.code == 200 || res.code == '200') ? res.data : null;
        // 失败由请求封装照常提示；这里只保留已有列表，下次滚到底可重取同一页
        if (!data || !Array.isArray(data.items)) return;
        const seen = {};
        this.data.routes.forEach((item) => { seen[String(item.id)] = true; });
        const routes = this.data.routes.concat(routeCards(data.items).filter((item) => !seen[String(item.id)]));
        const more = data.hasMore === true;
        this._routesPage = pageNum;
        this._routesMore = more;
        this.setData({
          routes,
          routeScopeText: more ? routeScopeText({ hasMoreOpen: true, openCount: data.total, shownCount: routes.length }) : '',
        });
      },
      fail: () => { if (epoch === (this._routesEpoch || 0)) done(); },
    });
  },

  // MC-021:列表已有内容时刷新失败,保留旧列表并轻提示一次(空列表走原 cy-error 留白)。
  _toastRefreshFailed(kind) {
    const list = kind === 'routes' ? this.data.routes : this.data.events;
    if (list && list.length) toast('刷新失败，请稍后重试');
  },

  loadEvents() {
    this._eventsRequested = true;
    if (this._eventsLoading) return;
    this._eventsLoading = true;
    this.setData({ eventsLoading: true, eventsError: '' });
    app.sendRequest({
      url: '/api/official/events', method: 'GET', hideLoading: true, silentError: true,
      success: (res) => {
        if (!res || (res.code != 200 && res.code != '200') || !Array.isArray(res.data)) {
          this._eventsLoading = false;
          this.setData({ eventsError: app.getRequestErrorMessage(res, '官方活动加载失败'), eventsLoading: false });
          this._toastRefreshFailed('events');
          return;
        }
        // F21:关键承接方缺失(recruitmentBlocked)必须在卡面标出来,由商家决定补位;标缺口不撤下
        const events = res.data.filter((item) => item && hasValue(item.id) && hasValue(item.title))
          .filter(officialChannel.isMerchantRecruitableEvent)
          .map(officialChannel.decorateRecruitableEvent);
        this._eventsLoading = false;
        this.setData({ events, eventsLoading: false });
      },
      fail: (res) => {
        this._eventsLoading = false;
        this.setData({ eventsError: app.getRequestErrorMessage(res, '官方活动加载失败'), eventsLoading: false });
        this._toastRefreshFailed('events');
      },
    });
  },

  // 定位带过来的主题:命中才标记并滚过去;不在本页(已下架/名额已满未进池)就安静停在列表 ——
  // 广场本来就该是完整的一屏,不为一条找不到的推荐把整页判失败。
  _locateFocusTopic() {
    const id = this._focusTopicId;
    if (!id) return;
    const index = (this.data.routes || []).findIndex((item) => String(item.id) === id);
    if (index < 0) return;
    // 列表在 scroll-view 里滚,页面本身不滚:pageScrollTo 够不着,用 scroll-into-view 定位。
    this.setData({ ['routes[' + index + '].focus']: true, focusAnchor: 'cc-route-' + id });
  },

  openTopic(e) {
    const id = e.currentTarget.dataset.id;
    if (id) wx.navigateTo({ url: '/pages/topic/merchantinfo/merchantinfo?id=' + id + '&scope=MERCHANT' });
  },

  openEvent(e) {
    const id = e.currentTarget.dataset.id;
    if (id) wx.navigateTo({ url: '/pages/activity/official-detail/index?id=' + id });
  },

  onRouteCoverError(e) {
    const dataset = (e && e.currentTarget && e.currentTarget.dataset) || {};
    const index = Number(dataset.index);
    const item = Number.isInteger(index) ? this.data.routes[index] : null;
    if (!item || !hasValue(item.id) || String(item.id) !== String(dataset.id) || item._coverFailed) return;
    this.setData({ ['routes[' + index + ']._coverFailed']: true });
  },
});
