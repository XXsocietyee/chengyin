const modal = require('../../utils/modal.js');
const toast = require('../../utils/toast.js');
function openAddress() { return require('../../utils/open-address.js') }
const app = getApp();
const { resolveMenuChrome } = require('../../utils/nav-safe-area.js');
const { mapFontSize } = require('../../utils/font-scale.js');
const discoverSearch = require('../../utils/discover-search.js');
const { openScene } = require('../../utils/scene-entry.js');
const { buildNodeLevelMarkerStyle } = require('../roam/node-level-style.js');
const { isRecordList } = require('../../utils/response-shape.js');
const { appendByIndex } = require('../../utils/list-append.js');
const { playerMapStyle, lightMapStyle } = require('../../utils/map-style.js');
const { isMerchantView } = require('../../utils/roleGuard.js');
const DATE_YEARS = Array.from({ length: 81 }, (_, index) => 1970 + index);
const DATE_MONTHS = Array.from({ length: 12 }, (_, index) => index + 1);

function dateDays(year, month) {
  return Array.from({ length: new Date(year, month, 0).getDate() }, (_, index) => index + 1);
}

function isDateValue(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || '');
}

function pickerState(value) {
  const now = new Date();
  const source = isDateValue(value) ? value.split('-').map(Number) : [now.getFullYear(), now.getMonth() + 1, now.getDate()];
  const year = Math.min(2050, Math.max(1970, source[0]));
  const month = Math.min(12, Math.max(1, source[1]));
  const days = dateDays(year, month);
  const day = Math.min(days.length, Math.max(1, source[2]));
  return { days, value: [year - 1970, month - 1, day - 1] };
}

function formatPickerDate(yearIndex, monthIndex, dayIndex) {
  const year = DATE_YEARS[yearIndex];
  const month = DATE_MONTHS[monthIndex];
  const day = dayIndex + 1;
  return year + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
}

function formatUpdatedAt(date) {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return hours + ':' + minutes;
}

const REGION_DEBOUNCE_MS = 400;
function regionMovedEnough(prev, next) {
  if (!prev || !next) return true;
  const latSpan = Math.abs(Number(prev.latitudeDelta)) || 0;
  const lngSpan = Math.abs(Number(prev.longitudeDelta)) || 0;
  if (!(latSpan > 0) || !(lngSpan > 0)) return true;
  if (Math.abs(Number(next.latitudeDelta) - latSpan) > latSpan * 0.1) return true;
  return Math.abs(Number(next.latitude) - Number(prev.latitude)) > latSpan / 4
    || Math.abs(Number(next.longitude) - Number(prev.longitude)) > lngSpan / 4;
}

function sliderStyles(minPercent, maxPercent) {
  return { sliderRangeStyle: `left: ${minPercent}%; right: ${100 - maxPercent}%;`, minHandleStyle: `left: ${minPercent}%;`, maxHandleStyle: `left: ${maxPercent}%;` };
}

// 地图标签样式(活动与商家同一套);原生 <map> callout 只收字面色值,不吃 CSS var
function callout(content, display) {
  return { content, color: '#333', fontSize: mapFontSize(12), borderRadius: 4, bgColor: '#fff', padding: 8, display }; /* ds-ok: 原生层字面色值 */
}

Page({
  data: {
    // 第九轮 m1:玩家进来是暗色样式,商家视角进来是浅色样式(onLoad 里按身份定)
    mapSubkey: '',
    mapLayerStyle: 1,
    // 自定义导航(ADA:全屏地图只留浮动圆钮)。20 是状态栏兜底高,
    // globalData 取不到时至少不会把返回钮压进状态栏。
    statusBarHeight: 20,
    // UI-14 返修(2026-09-18):顶部整行(返回/搜索/筛选)的胶囊几何。onLoad 用实测值覆盖,
    // 这里的默认值只在拿不到胶囊坐标时兜底(与 resolveMenuChrome 的兜底同口径)。
    navTop: 28,    // 行顶(px):行中心线与胶囊中心线共线
    navRight: 16,  // 行右内边距(px):行右边界让开胶囊左缘一个页面边距

    // 搜索相关
    searchKeyword: '',
    
    // 地图相关数据
    latitude: 31.230416, // 上海坐标
    longitude: 121.473701,
    scale: 14,
    markers: [],
    merchantNodeCount: 0, // L05-153:点位原始数组在实例上,视图只收 markers

    merchantNodesRefreshing: false,
    merchantCategoryLabel: '',
    merchantCategorySheetVisible: false,
    
    // 活动列表
    list: [],
    bmShow: false,
    noCoordCount: 0, // 无坐标场次数(地图落不了点,仅结果列表可见)

    // 结果态(§11:Loading/Empty/Error 必须已设计;胶囊入口据此四态可达)
    listState: 'loading',   // loading | ready | empty | error
    capsuleText: '附近活动',
    errorMsg: '',
    pageError: '',
    pageErrorIsRefresh: false, // A-08:区分「刷新失败(旧结果仍在)」与「翻页失败」,文案不同
    listRefreshing: false,
    locationError: false,
    locationMessage: '',
    locationAction: '',
    // (设备定位与「用户拖过地图」两个事实只参与判定、不驱动渲染,按本仓 U4 口径存实例字段,
    // 不走 data —— 见 this._hasLocation / this._regionUserChosen)
    offline: false,
    offlineMessage: '当前离线，暂无可显示的活动',
    lastListUpdatedText: '',

    // 选中的标记对应对象(模板库 §4.4②:标记选中后底部 Sheet 展示对应对象)
    selShow: false,
    selected: {},

    // 筛选弹窗
    popVisible: false,
    startdate: '开始日期',
    enddate: '结束日期',
    dateSheetVisible: false,
    datePickerField: 'startdate',
    datePickerTitle: '选择开始日期',
    datePickerYears: DATE_YEARS,
    datePickerMonths: DATE_MONTHS,
    datePickerDays: dateDays(new Date().getFullYear(), new Date().getMonth() + 1),
    datePickerValue: [new Date().getFullYear() - 1970, new Date().getMonth(), new Date().getDate() - 1],
    jg1: "¥0",
    jg2: "¥1000",
    activeDate: '0',
    activeSort: '1',
    
    // 价格滑块
    minPrice: 0,
    maxPrice: 1000,
    minPercent: 0,
    maxPercent: 100,
    priceRange: {
      min: 0,
      max: 1000
    },
    sliderRangeStyle: 'left: 0%; right: 0%;',
    minHandleStyle: 'left: 0%;',
    maxHandleStyle: 'left: 100%;',
    
    // 筛选条件
    filterConditions: {
      keyword: '',
      categoryId: null,
      tag: '',
      cityRole: '',
      dateType: '0',
      startDate: '',
      endDate: '',
      minPrice: 0,
      maxPrice: 1000,
      sortType: '1'
    },
    
    // 地图区域信息
    regionInfo: {
      latitude: 31.230416,
      longitude: 121.473701,
      latitudeDelta: 0.1,
      longitudeDelta: 0.1
    },
    
    // 分页
    pageNum: 1,
    pageSize: 10,
    hasMore: true,
    loadingMore: false
  },

  // 关键词输入
  onKeywordInput(e) {
    const keyword = e.detail.value;
    this.setData({
      searchKeyword: keyword,
      'filterConditions.keyword': keyword
    });
  },

  // 输入框确认搜索
  onSearchConfirm() {
    this.runFreshQuery();
  },

  // 查询条件或空间范围变化时，旧点位不再代表当前结果；先原子清场，再拉两层新数据。
  // 网络恢复等同查询刷新走 refreshMapResults，仍保留旧内容并明示 syncing。
  runFreshQuery(extra) {
    // setData 的 callback 要等视图层确认后才执行；必须在清场调用前同步作废旧请求，
    // 否则旧回包能钻进「数据已清空、新请求尚未启动」的窗口，把上一查询重新写回来。
    this._listQueryEpoch = (this._listQueryEpoch || 0) + 1;
    this._merchantQueryEpoch = (this._merchantQueryEpoch || 0) + 1;
    const next = extra || {};
    const filterConditions = Object.prototype.hasOwnProperty.call(next, 'filterConditions')
      ? next.filterConditions
      : Object.assign({}, this.data.filterConditions, Object.prototype.hasOwnProperty.call(next, 'filterConditions.keyword')
        ? { keyword: next['filterConditions.keyword'] }
        : {});
    this._activityMarkers = this._merchantMarkers = this._merchantNodes = []; // 只会整体替换,不原地改
    this.setData({
      pageNum: 1,
      list: [],
      selected: {},
      selShow: false,
      hasMore: true,
      regionInfo: Object.prototype.hasOwnProperty.call(next, 'regionInfo') ? next.regionInfo : this.data.regionInfo,
      popVisible: Object.prototype.hasOwnProperty.call(next, 'popVisible') ? next.popVisible : this.data.popVisible,
      filterConditions,
    }, () => {
      this.rebuildMarkers();
      this.getList();
      this.getMerchantNodes();
    });
  },

  // 获取活动列表
  getList: function () {
    if (!this.data.hasMore && this.data.pageNum > 1) return;

    var that = this;
    const requestPage = this.data.pageNum;
    if (requestPage > 1 && (this._listFirstPageLoading || this._listPageLoading)) return;
    const hasCachedList = requestPage === 1 && (this.data.list || []).length > 0;
    const requestPageSize = this.data.pageSize;
    const requestRegion = Object.assign({}, this.data.regionInfo);
    const requestFilters = Object.assign({}, this.data.filterConditions);
    if (requestPage === 1) {
      this._listFirstPageLoading = true;
      this._listPageLoading = false;
      this.setData({ loadingMore: false });
      this._listQueryEpoch = (this._listQueryEpoch || 0) + 1;
    } else if (!this._listQueryEpoch) {
      this._listQueryEpoch = 1;
    }
    if (requestPage > 1) {
      this._listPageLoading = true;
      this.setData({ loadingMore: true });
    }
    const queryEpoch = this._listQueryEpoch;
    const isCurrentQuery = () => queryEpoch === that._listQueryEpoch;
    const finishPageRequest = () => {
      if (!isCurrentQuery()) return;
      if (requestPage === 1) {
        that._listFirstPageLoading = false;
        that.setData({ listRefreshing: false });
      } else {
        that._listPageLoading = false;
        that.setData({ loadingMore: false });
      }
    };
    const { latitude, longitude } = requestRegion;
    if (requestPage === 1 && hasCachedList) {
      this.setData({
        listState: 'ready',
        capsuleText: '查看全部 ' + this.data.list.length + ' 个结果',
        errorMsg: '',
        pageError: '',
        listRefreshing: true
      });
    } else if (requestPage === 1) {
      this.setData({ listRefreshing: false, pageError: '' });
      this.setListState('loading');
    } else {
      this.setData({ pageError: '' });
    }

    app.sendRequest({
      hideLoading: true,
      url: '/api/activity/list',
      method: "POST",
      auth: false,
      silentError: true, // 失败已落页内错误态/内联重试(A-08),关掉通道自动 toast 防双弹
      data: {
        is_my: 0,
        sort_type: requestFilters.sortType,
        pageNum: requestPage,
        pageSize: requestPageSize,
        longitude: longitude || that.data.longitude,
        latitude: latitude || that.data.latitude,
        keyword: requestFilters.keyword,
        // ⚠️ 别传 null:wx.request 会把 null 序列化成字面量 "null",后端 DiscoveryFilterContract
        // 解析不出正整数 → 400「category_id 必须为正整数」→ 整页「没能加载出来」(2026-09-16 截图冒烟)。
        category_id: requestFilters.categoryId == null ? '' : requestFilters.categoryId
        // A-02:min_price/max_price/date_type/start_date/end_date 后端 activityList 签名里没有,
        // 发过去只会被静默忽略 —— 死参数已删,筛选改在客户端同口径过滤(见 success 回调)。
      },
      success: (res) => {
        if (!isCurrentQuery()) return;
        finishPageRequest();
        if (!res || res.code != "200") {
          // 非 200 原先直接穿透 = 静默失败:页面只剩一张空地图,不说明也不能重试。
          // 仅首页失败才翻错误态 —— 翻页失败不该把已加载的结果整段换掉(与 loading 守卫对称)。
          that.setPageError((res && res.msg) || '服务返回异常', requestPage);
          return;
        }
        if (!res.data || !isRecordList(res.data.rows)) {
          that.setPageError('活动列表加载失败，请重试', requestPage);
          return;
        }
        const rawList = res.data.rows.map((activity) => {
          const pointKind = discoverSearch.mapPointKind(activity);
          return Object.assign({}, activity, {
            mapPointKind: pointKind,
            mapPointLabel: pointKind === 'topic' ? '主题节点' : '活动节点'
          });
        });
        // A-02:日期/价格筛选后端不消费,这里用 search2/result 同一套 matchesFilters 客户端过滤,
        // 口径(起始日期落在区间、价格字段兜底)完全复用,不再各写一套。
        const newList = discoverSearch.filterRows('activity', rawList, requestFilters);
        // 分页卫生(P0-4):翻页只回传新增行、只给新增批次建 marker。分页判据用未过滤的原始行数:整页被筛掉时仍要能继续翻
        const first = requestPage === 1, oldLen = first ? 0 : that.data.list.length;
        that.setData(Object.assign({
          hasMore: rawList.length >= requestPageSize,
          noCoordCount: (first ? 0 : that.data.noCoordCount) + newList.filter(a => !a.latitude || !a.longitude).length,
          pageError: '', pageErrorIsRefresh: false, lastListUpdatedText: formatUpdatedAt(new Date())
        }, first ? { list: newList } : appendByIndex('list', oldLen, newList)));
        if (first) that._autoPages = 0;
        that.setListState(oldLen + newList.length ? 'ready' : 'empty');
        if (first) that.createMarkersFromActivities(newList);
        else that.appendMarkersFromActivities(newList, oldLen);
        // L05-154:日期/价格在本地筛,一整页都被筛掉时还没到底 —— 自动再翻,最多 3 页,别把「这页没有」说成「这一带没有」
        if (!that.data.list.length && that.data.hasMore && (that._autoPages || 0) < 3) {
          that._autoPages = (that._autoPages || 0) + 1;
          that.loadMoreResults();
        }
      },
      fail: (err) => {
        if (!isCurrentQuery()) return;
        finishPageRequest();
        that.setPageError((err && err.errMsg) || '网络异常，请重试', requestPage);
      }
    });
  },

  // 结果态单一出口:胶囊文案随态走,保证地图之外始终有一条可见、可恢复的通路(模板库 §4.4③)
  setListState(state, msg) {
    const text = {
      loading: '附近活动',
      error: '加载失败，点这里重试',
      empty: '这一带还没有活动',
      ready: '查看全部 ' + this.data.list.length + ' 个结果'
    }[state];
    this.setData({ listState: state, capsuleText: text, errorMsg: msg || '' });
  },

  // 失败落点:首页失败 ⇒ 整页错误态;翻页失败 ⇒ 保住已加载结果,只提示一次,不清列表;
  // 首页刷新失败但已有旧列表 ⇒ 保住旧结果 + 页内错误条,可原地重试(A-08:不再无声降级,
  // 否则用户以为屏上就是新区域/新筛选的结果)。
  setPageError(msg, pageNum) {
    const failedPage = pageNum == null ? this.data.pageNum : pageNum;
    if (failedPage === 1 && (this.data.list || []).length) {
      this.setData({
        listState: 'ready',
        pageError: msg || '刷新失败，请重试',
        pageErrorIsRefresh: true,
      });
      return;
    }
    if (failedPage === 1) { this.setData({ pageErrorIsRefresh: false }); this.setListState('error', msg); return; }
    this.setData({
      listState: 'ready',
      pageError: msg || '加载更多失败，请重试',
      pageErrorIsRefresh: false,
    });
  },

  retryListPage() {
    if (!this.data.pageError) return;
    this.setData({ pageError: '' });
    this.getList();
  },

  // 胶囊/错误态重试
  onRetry() {
    this.setData({ pageNum: 1, list: [], hasMore: true });
    this.getList();
  },

  // 地图空白处点击:不再误弹"全部活动"列表(降级,避免误导);仅收起已开弹窗
  onMapTap(e) {
    if (this.data.bmShow) this.setData({ bmShow: false });
    if (this.data.selShow) this.setData({ selShow: false });
  },

  // 标记点点击事件
  onMarkerTap(e) {
    const markerId = e.markerId;
    const marker = this.data.markers.find(m => m.id === markerId);
    
    if (marker) {
      if (marker.kind === 'merchant') {
        // 据点走场景注册表,别再自己拼路由:宿主换了地方时这里必须跟着换。
        openScene('roam-poi-detail', { poiId: marker.poiId });
        return;
      }
      this.showActivityDetail(marker.activityId);
    }
  },

  // L05-152:只认手势结束(程序改视野也派发 end);防抖;小挪不重查。
  onRegionChange(e) {
    if (!e || e.type !== 'end') return;
    const cause = e.causedBy || (e.detail && e.detail.causedBy);
    if (cause !== 'drag' && cause !== 'scale' && cause !== 'gesture') return;
    const spatialEpoch = this._beginSpatialInput();
    if (this._regionTimer) clearTimeout(this._regionTimer);
    this._regionPending = spatialEpoch;
    this._regionTimer = setTimeout(() => this._flushRegionChange(), REGION_DEBOUNCE_MS);
  },

  _flushRegionChange() {
    if (this._regionTimer) { clearTimeout(this._regionTimer); this._regionTimer = null; }
    const spatialEpoch = this._regionPending;
    this._regionPending = 0;
    if (!spatialEpoch || !this._isCurrentSpatialInput(spatialEpoch) || !this.mapContext) return;
    this.mapContext.getRegion({
      success: (res) => {
        if (!this._isCurrentSpatialInput(spatialEpoch)) return;
        const regionInfo = {
          latitude: (res.northLatitude + res.southLatitude) / 2,
          longitude: (res.eastLongitude + res.westLongitude) / 2,
          latitudeDelta: res.northLatitude - res.southLatitude,
          longitudeDelta: res.eastLongitude - res.westLongitude
        };
        const firstChoice = !this._regionUserChosen;
        this._regionUserChosen = true;
        if (!firstChoice && !regionMovedEnough(this.data.regionInfo, regionInfo)) return;
        this.runFreshQuery({ regionInfo });
      }
    });
  },

  requestLocation() {
    // L05-170:本次已定位过就不再弹说明
    if (this._located) { this.moveToLocation(); return; }
    const spatialEpoch = this._beginSpatialInput();
    modal.show({
      title: '定位说明',
      content: '用于将地图移到你附近的活动、主题节点与商家节点，并按距离排列结果，仅在本次操作中读取一次位置。',
      confirmText: '继续定位',
      success: (result) => {
        if (!this._isCurrentSpatialInput(spatialEpoch)) return;
        if (result.confirm) this.moveToLocation();
      }
    });
  },

  _beginSpatialInput() {
    this._spatialInputEpoch = (this._spatialInputEpoch || 0) + 1;
    return this._spatialInputEpoch;
  },

  _isCurrentSpatialInput(spatialEpoch) {
    return !this._unloaded && spatialEpoch === this._spatialInputEpoch;
  },

  // 移动到当前位置
  moveToLocation() {
    const spatialEpoch = this._beginSpatialInput();
    wx.getLocation({
      type: 'gcj02',
      success: (res) => {
        if (!this._isCurrentSpatialInput(spatialEpoch)) return;
        const { latitude, longitude } = res;
        this._hasLocation = this._located = true;
        this.setData({
          latitude,
          longitude,
          scale: 16,
          locationError: false,
          locationMessage: '',
          locationAction: '',
          'regionInfo.latitude': latitude,
          'regionInfo.longitude': longitude
        });
        // L05-169:当前位置只用地图自带的 show-location 蓝点,不再叠一枚自画 marker
        this.runFreshQuery();
      },
      fail: (err) => {
        if (!this._isCurrentSpatialInput(spatialEpoch)) return;
        // L05-170:系统定位关闭、隐私未同意时去设置页没用
        const rawMessage = String((err && err.errMsg) || '');
        const sysOff = /system permission denied|switch ?off/i.test(rawMessage);
        const denied = !sysOff && !/privacy/i.test(rawMessage) && /auth deny|authorize|permission/i.test(rawMessage);
        this._located = false;
        this.setData({
          locationError: true,
          locationAction: denied ? 'open-setting' : 'retry',
          locationMessage: sysOff ? '请在系统设置开启定位' : denied ? '定位权限未开启' : '暂时无法获取当前位置，请重试'
        });
      }
    });
  },

  recoverLocation() {
    if (this.data.locationAction !== 'open-setting') {
      this.moveToLocation();
      return;
    }
    const spatialEpoch = this._beginSpatialInput();
    wx.openSetting({
      success: (result) => {
        if (!this._isCurrentSpatialInput(spatialEpoch)) return;
        if (result.authSetting && result.authSetting['scope.userLocation']) {
          this.setData({ locationError: false, locationMessage: '', locationAction: '' });
          this.moveToLocation();
        } else {
          this.setData({ locationMessage: '仍未获得定位权限，可在系统设置中开启后重试' });
        }
      },
      fail: () => {
        if (!this._isCurrentSpatialInput(spatialEpoch)) return;
        this.setData({ locationMessage: '暂时无法打开设置，请稍后重试' });
      }
    });
  },

  // 根据活动数据创建标记点(无真实坐标的活动不落假点;activityId 保留为原列表下标)
  buildActivityMarker(activity, index) {
    return {
      id: index + 1,
      latitude: activity.latitude,
      longitude: activity.longitude,
      title: activity.name,
      // 主题节点与「主题 / 城市旅团」分类用主题图标,其余用定位针
      iconPath: activity.mapPointKind === 'topic' || ['主题', '城市旅团'].includes(activity.categoryName) ? '/pages/searchmap/images/d_smapicon.png' : '/pages/searchmap/images/d_location2.png',
      width: 30,
      height: 30,
      callout: callout(activity.name + (activity.mapPointKind === 'topic' ? ' · 主题节点' : ''), 'ALWAYS'),
      activityId: index,
      kind: 'activity'
    };
  },
  createMarkersFromActivities(activities) {
    const markers = [];
    activities.forEach((activity, index) => {
      if (!activity.latitude || !activity.longitude) return; // 无坐标不伪造随机点
      markers.push(this.buildActivityMarker(activity, index));
    });
    this._activityMarkers = markers;
    this.rebuildMarkers();
  },
  // P0-4:分页只给新增批次建点;下标用全局 listOffset+i,activityId 要能回查 this.data.list
  appendMarkersFromActivities(newActivities, listOffset) {
    const list = (this._activityMarkers || []).slice();
    newActivities.forEach((activity, i) => {
      if (!activity.latitude || !activity.longitude) return;
      list.push(this.buildActivityMarker(activity, listOffset + i));
    });
    this._activityMarkers = list;
    this.rebuildMarkers();
  },

  // 商家节点图层与活动点分开请求/建 marker。接口按 roam_poi.tags 等条件筛选并按距离排序。
  getMerchantNodes() {
    const that = this;
    // 无定位、也还没拖过地图时不问「附近据点」:后端缺 lat/lng 只会 500,不是网络故障。
    if (!this._hasLocation && !this._regionUserChosen) {
      this.setData({ merchantNodesRefreshing: false });
      return;
    }
    const center = this.data.regionInfo || {};
    const filters = this.data.filterConditions || {};
    const hasCachedNodes = (this._merchantNodes || []).length > 0;
    const queryEpoch = (this._merchantQueryEpoch || 0) + 1;
    this._merchantQueryEpoch = queryEpoch;
    const isCurrentQuery = () => queryEpoch === that._merchantQueryEpoch;
    const markError = () => { if (isCurrentQuery()) that.setData({ merchantNodesRefreshing: false }); };
    this.setData({ merchantNodesRefreshing: hasCachedNodes });
    app.sendRequest({
      hideLoading: true,
      url: '/api/city/nodes',
      method: 'GET',
      // SecurityConfig 未匿名放行 city/nodes，使用 request-client 默认认证。
      data: {
        lat: center.latitude || this.data.latitude,
        lng: center.longitude || this.data.longitude,
        radius: 20000,
        keyword: filters.keyword || '',
        categoryId: filters.categoryId == null ? '' : filters.categoryId,
        tag: filters.tag || '',
        cityRole: filters.cityRole || ''
      },
      success(res) {
        if (!isCurrentQuery()) return;
        if (!res || (res.code != '200' && res.code != 200) || !Array.isArray(res.data)) {
          markError();
          return;
        }
        const nodes = res.data;
        const markers = nodes.filter(n => n.lat && n.lng && n.poiId != null).map((node) => { // L05-173:没有 poiId 的节点不落点(否则 id 是 NaN)
          const nodeStyle = buildNodeLevelMarkerStyle(node.nodeLevel, 'actionable'), name = node.name || node.merchantName || '商家节点';
          return {
            id: 1000000 + Number(node.poiId),
            latitude: Number(node.lat),
            longitude: Number(node.lng),
            title: name,
            iconPath: '/pages/searchmap/images/icon_map6.png',
            width: nodeStyle.size,
            height: nodeStyle.size,
            zIndex: nodeStyle.zIndex,
            kind: 'merchant',
            poiId: node.poiId,
            // L05-173:商家标签点开才显示(几十个常显标签互相压住),样式与活动标签同一套
            callout: callout(nodeStyle.glyph + ' ' + nodeStyle.label + ' · ' + name, 'BYCLICK')
          };
        });
        that._merchantNodes = nodes;
        that._merchantMarkers = markers;
        that.setData({ merchantNodesRefreshing: false }, () => that.rebuildMarkers());
      },
      fail: markError
    });
  },

  rebuildMarkers() {
    this.setData({ markers: [].concat(this._activityMarkers || [], this._merchantMarkers || []), merchantNodeCount: (this._merchantNodes || []).length });
  },

  openMerchantCategorySheet() {
    this.setData({ merchantCategorySheetVisible: true });
  },

  closeMerchantCategorySheet() {
    this.setData({ merchantCategorySheetVisible: false });
  },

  onMerchantCategoryChange(e) {
    const detail = e.detail || {};
    const category = Array.isArray(detail.selectedCategories) ? detail.selectedCategories[0] : null;
    if (!category) {
      this.setData({
        'filterConditions.categoryId': null,
        merchantCategoryLabel: '',
        merchantCategorySheetVisible: false,
      });
      return;
    }
    if (!category || category.id == null) return;
    this.setData({
      'filterConditions.categoryId': Number(category.id),
      merchantCategoryLabel: category.categoryName || '',
      merchantCategorySheetVisible: false,
    });
  },

  onMerchantTagInput(e) {
    this.setData({ 'filterConditions.tag': e.detail.value || '' });
  },

  onMerchantRoleInput(e) {
    this.setData({ 'filterConditions.cityRole': e.detail.value || '' });
  },

  // 点 marker 弹出该场次的 Sheet(模板库 §4.4②)。
  // 前一轮已修掉"点哪个点都弹全部场次"的坏交互,但改成了直接 navigateTo 详情 —— 跳过了 Sheet 这一层,
  // 用户失去"看一眼再决定"的机会;现按 §4.4 补回:Sheet 展示被选对象,详情由 Sheet 内 CTA 进。
  showActivityDetail(activityId) {
    const activity = this.data.list[activityId];
    if (activity && activity.id) {
      this.setData({ selected: activity, selShow: true, bmShow: false });
    }
  },

  // 关闭选中对象 Sheet
  selClose() {
    this.setData({ selShow: false });
  },


  // 显示筛选弹窗
  popShow() {
    this._sliderRect = null;
    this.setData({
      popVisible: true
    });
  },

  // 关闭筛选弹窗
  popClose() {
    this.setData({
      popVisible: false
    });
  },

  // L05-156:筛选控件按条件落位(带进来的日期 / 价格;重置时传 {} 回默认),否则点「搜索」会按控件默认值把带进来的条件丢掉
  _seedFilterSheet(p) {
    const ymd = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
    this.setData({ activeDate: String(p.dateType || '0'), startdate: ymd(p.startDate) ? p.startDate : '开始日期', enddate: ymd(p.endDate) ? p.endDate : '结束日期' });
    const { min, max } = this.data.priceRange, lo = Number(p.minPrice), hi = Number(p.maxPrice);
    if (lo > min && lo < max) this._applyPrice('min', ((lo - min) / (max - min)) * 100, lo); else this._applyPrice('min', 0, min);
    if (hi < max && hi > this.data.minPrice) this._applyPrice('max', ((hi - min) / (max - min)) * 100, hi); else this._applyPrice('max', 100, max);
  },

  // 筛选搜索
  searchFilter() {
    // 更新筛选条件
    const filterConditions = {
      ...this.data.filterConditions,
      dateType: this.data.activeDate,
      sortType: this.data.activeSort,
      minPrice: this.data.minPrice,
      maxPrice: this.data.maxPrice
    };

    // A-02:日期筛选改由客户端消费,必须带真实边界 —— 原实现只给「自定义」写 startDate/endDate,
    // 今天/明天只发 date_type(后端不消费,筛了等于没筛)。口径与 search2/result 的 isYmd 一致。
    const isYmd = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
    filterConditions.startDate = isYmd(this.data.startdate) ? this.data.startdate : '';
    filterConditions.endDate = isYmd(this.data.enddate) ? this.data.enddate : '';

    this.runFreshQuery({
      popVisible: false,
      filterConditions: filterConditions,
    });
  },

  // 选择日期
  selectDate(e) {
    const value = e.currentTarget.dataset.value;
    const now = new Date();
    let startDate = '';
    let endDate = '';

    switch(value) {
      case '1': // 今天
        startDate = this.formatDate(now);
        endDate = startDate;
        break;
      case '2': // 明天
        const tomorrow = new Date(now);
        tomorrow.setDate(now.getDate() + 1);
        startDate = this.formatDate(tomorrow);
        endDate = startDate;
        break;
      case '3': // 选择日期
        startDate = '开始日期';
        endDate = '结束日期';
        break;
      default:
        startDate = '开始日期';
        endDate = '结束日期';
    }

    this.setData({
      activeDate: value,
      startdate: startDate,
      enddate: endDate
    });
  },

  // 格式化日期
  formatDate(date) {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
  },

  // 选择排序
  selectSort(e) {
    const value = e.currentTarget.dataset.value;
    this.setData({
      activeSort: value
    });
  },

  // L05-164:价格夹在区间内;清空正在改的框不报错、不动数据,等输入完整再生效。
  onMinPriceInput(e) { this._priceInput('min', e.detail.value); },
  onMaxPriceInput(e) { this._priceInput('max', e.detail.value); },
  _priceInput(type, raw) {
    const text = String(raw || '').replace(/[^\d]/g, '');
    if (!text) return;
    const { min, max } = this.data.priceRange;
    const value = Math.max(min, Math.min(max, parseInt(text, 10)));
    if (type === 'min' ? value >= this.data.maxPrice : value <= this.data.minPrice) {
      toast(type === 'min' ? '最低价格不能大于等于最高价格' : '最高价格不能小于等于最低价格');
      return;
    }
    this._applyPrice(type, ((value - min) / (max - min)) * 100, value);
  },
  _applyPrice(type, percent, price) {
    const min = type === 'min', minPercent = min ? percent : this.data.minPercent, maxPercent = min ? this.data.maxPercent : percent;
    const { sliderRangeStyle, minHandleStyle, maxHandleStyle } = sliderStyles(minPercent, maxPercent);
    if (min) this.setData({ minPercent, minPrice: price, jg1: '¥' + price, sliderRangeStyle, minHandleStyle, maxHandleStyle });
    else this.setData({ maxPercent, maxPrice: price, jg2: '¥' + price, sliderRangeStyle, minHandleStyle, maxHandleStyle });
  },

  onMinSliderMove(e) { this.handleSliderMove(e, 'min'); },
  onMaxSliderMove(e) { this.handleSliderMove(e, 'max'); },

  // L05-157:轨道位置只量一次(开筛选面板时作废),每次 touchmove 只发一次 setData。
  handleSliderMove(e, type) {
    const touch = e.touches && e.touches[0];
    if (!touch) return;
    if (!this._sliderRect) {
      if (this._sliderMeasuring) return;
      this._sliderMeasuring = true;
      wx.createSelectorQuery().select('.slider-container').boundingClientRect().exec((res) => {
        this._sliderMeasuring = false;
        if (res && res[0] && res[0].width) { this._sliderRect = res[0]; this.handleSliderMove(e, type); }
      });
      return;
    }
    const { left, width } = this._sliderRect;
    const { min, max } = this.data.priceRange;
    const gap = 5;   // 两枚滑块最小间隔 5%
    let percent = Math.max(0, Math.min(100, ((touch.clientX - left) / width) * 100));
    if (type === 'min') percent = Math.min(percent, this.data.maxPercent - gap);
    else percent = Math.max(percent, this.data.minPercent + gap);
    this._applyPrice(type, percent, Math.round((percent / 100) * (max - min) + min));
  },

  openDatePicker(e) {
    const field = e.currentTarget.dataset.field === 'enddate' ? 'enddate' : 'startdate';
    const current = isDateValue(this.data[field])
      ? this.data[field]
      : (field === 'enddate' && isDateValue(this.data.startdate) ? this.data.startdate : '');
    const state = pickerState(current);
    this.setData({
      dateSheetVisible: true,
      datePickerField: field,
      datePickerTitle: field === 'enddate' ? '选择结束日期' : '选择开始日期',
      datePickerDays: state.days,
      datePickerValue: state.value,
    });
  },

  onDatePickerChange(e) {
    const value = e.detail.value || [0, 0, 0];
    const year = DATE_YEARS[value[0]] || 1970;
    const month = DATE_MONTHS[value[1]] || 1;
    const days = dateDays(year, month);
    const next = [value[0], value[1], Math.min(value[2], days.length - 1)];
    this.setData({ datePickerDays: days, datePickerValue: next });
  },

  cancelDatePicker() {
    this.setData({ dateSheetVisible: false });
  },

  confirmDatePicker() {
    const value = this.data.datePickerValue;
    const selected = formatPickerDate(value[0], value[1], value[2]);
    const field = this.data.datePickerField;
    if (field === 'startdate' && isDateValue(this.data.enddate) && selected > this.data.enddate) {
      toast('开始日期不能晚于结束日期');
      return;
    }
    if (field === 'enddate' && isDateValue(this.data.startdate) && selected < this.data.startdate) {
      toast('结束日期不能早于开始日期');
      return;
    }

    this.setData({ [field]: selected, dateSheetVisible: false });
  },

  // 重置筛选条件
  resetFilter() {
    this._seedFilterSheet({});
    this.setData({
      merchantCategoryLabel: '',
      filterConditions: {
        ...this.data.filterConditions,
        dateType: '0',
        sortType: '1',
        minPrice: 0,
        maxPrice: 1000,
        categoryId: null,
        tag: '',
        cityRole: '',
        startDate: '',
        endDate: ''
      }
    });
  },

  // 打开底部结果列表(无坐标场次唯一入口)
  // 结果入口:四态都要能开(原先 list.length>0 才开 ⇒ 空/错时页面只剩一张空地图,
  // 违反模板库 §4.4③"地图不可用时必须能切换列表")。error 态打开 Sheet，
  // 让活动与商家点位两层失败各自拥有明确、互不绑架的恢复动作。
  openList() {
    if (this.data.listState === 'loading') return;
    this.setData({ bmShow: true });
  },

  // 结果卡片点进活动详情
  goActivity(e) {
    const id = e.currentTarget.dataset.id;
    if (id && this._once()) openScene('play-activity-detail', { id });
  },
  // L05-180:结果卡连点只开一页(openScene 与 navigateTo 自己不防重入)
  _once() { return !this._nav && !!(this._nav = setTimeout(() => { this._nav = 0; }, 800)); },

  // 第九轮 m1-9:卡上地址有坐标就开地图,没有坐标照旧进活动
  onAddressTap(e) {
    const a = openAddress();
    if (a.coords(e.currentTarget.dataset)) a.openFromEvent(e);
    else this.goActivity(e);
  },

  // 主题点位仅在活动真实关联 topicId 时提供入口，避免独立活动被误标。
  goTopic(e) {
    const id = e.currentTarget.dataset.id;
    if (id && this._once()) wx.navigateTo({ url: '/pages/topic/index/index?id=' + id });
  },

  // 底部弹窗
  bmClose() {
    this.setData({
      bmShow: false
    });
  },

  // 浮动返回钮:栈里有上一页就退,直达进入(分享/扫码)时回城市广场,不留死路。
  goBack() {
    wx.navigateBack({
      delta: 1,
      fail: function () { wx.switchTab({ url: '/pages/index/index' }); }
    });
  },

  applyNetworkState(isOffline) {
    const hasCachedList = (this.data.list || []).length > 0;
    this.setData({
      offline: Boolean(isOffline),
      offlineMessage: hasCachedList
        ? '当前离线，地图节点与活动列表来自上次加载'
        : '当前离线，暂无可显示的活动'
    });
  },

  setupNetworkState() {
    if (typeof wx.getNetworkType === 'function') {
      wx.getNetworkType({
        success: (result) => this.applyNetworkState(result.networkType === 'none')
      });
    }
    if (typeof wx.onNetworkStatusChange === 'function') {
      this._networkStatusHandler = (result) => {
        const wasOffline = this.data.offline;
        const isOffline = result.isConnected === false || result.networkType === 'none';
        this.applyNetworkState(isOffline);
        // L05-183:被详情页盖住时不在后台重拉,回来再拉
        if (wasOffline && !isOffline) { if (this._hidden) this._refreshOnShow = true; else this.refreshMapResults(); }
      };
      wx.onNetworkStatusChange(this._networkStatusHandler);
    }
  },

  retryNetwork() {
    if (typeof wx.getNetworkType !== 'function') return;
    wx.getNetworkType({
      success: (result) => {
        if (result.networkType === 'none') {
          this.applyNetworkState(true);
          toast('仍未连接网络');
          return;
        }
        this.applyNetworkState(false);
        this.refreshMapResults();
      },
      fail: () => toast('暂时无法检查网络')
    });
  },

  refreshMapResults() {
    this.setData({ pageNum: 1, hasMore: true, pageError: '' });
    this.getList();
    this.getMerchantNodes();
  },
  // 页内隐私弹窗:没有它 app.js 会回退到 navigateTo(/pages/privacy/index),
  // 把本页整个盖住 —— 审计里那批「route 回读为隐私页、节点数 0」就是这么来的。
  showPrivacyGate() {
    this.setData({ privacyGateShow: true });
  },
  onPrivacyGateSettled() {
    this.setData({ privacyGateShow: false });
  },

  /* UI-14 返修(2026-09-18):顶部整行几何按微信胶囊实测值算,不再写死 200rpx。
     ① 行中心线 = 胶囊中心线(返回/搜索/筛选三件共线,不再用 -12rpx 光学补偿互相对表);
     ② 行右边界 = 胶囊左缘 - --cy-page-x,与左缘的 --cy-page-x 对称,整行落进安全区;
     ③ 胶囊几何统一走 utils/nav-safe-area.js 的 resolveMenuChrome(拿不到坐标时用它的兜底),
        只有「行盒中心」这一项 resolver 没有(它只给 44px 目标的顶边),这里按胶囊自身 rect 算。 */
  readNavRow() {
    let win = { windowWidth: 375, statusBarHeight: 20 };
    let menuButton = null;
    let chrome = { actionTop: 28, actionRight: 12 };
    try {
      win = (wx.getWindowInfo && wx.getWindowInfo()) || wx.getSystemInfoSync();
      const getMenu = wx.getMenuButtonBoundingClientRect || wx.getMenuButtonBoundingRect;
      menuButton = getMenu && getMenu.call(wx);
      chrome = resolveMenuChrome(win, menuButton);
    } catch (e) {
      win = { windowWidth: 375, statusBarHeight: 20 };
      menuButton = null;
      chrome = resolveMenuChrome(win, null);
    }
    const width = Number(win.windowWidth) || 375;
    const rpx = width / 750;
    const pageX = 32 * rpx;      // --cy-page-x(32rpx)的 px 当量
    const rowHeight = 88 * rpx;  // .smapso_bar 行高(88rpx)
    const hasCapsule = !!(menuButton
      && Number(menuButton.left) > 0
      && Number(menuButton.height) > 0
      && Number(menuButton.top) >= 0);
    if (!hasCapsule) {
      // 没有胶囊坐标:回到 resolver 的 actionTop,右侧退成普通页面边距(不再瞎让 200rpx)。
      return { navTop: chrome.actionTop, navRight: pageX };
    }
    const capsuleTop = Number(menuButton.top);
    const capsuleHeight = Number(menuButton.height);
    return {
      // 胶囊中心 = 行中心。返回(88rpx 命中盒)、搜索(72rpx)、筛选各自在行内居中即三件共线。
      navTop: capsuleTop + capsuleHeight / 2 - rowHeight / 2,
      // 行右边界 = 胶囊左缘 - 页面边距;filter 的右缘因此与左缘返回圆同一条内容线。
      navRight: width - Number(menuButton.left) + pageX,
    };
  },

  onLoad(options) {
    this._unloaded = false;
    // 初始化地图上下文
    this.mapContext = wx.createMapContext('myMap', this);

    const navRow = this.readNavRow();
    const mapStyle = isMerchantView() ? lightMapStyle() : playerMapStyle();
    this.setData({
      mapSubkey: mapStyle.subkey,
      mapLayerStyle: mapStyle.layerStyle,
      merchantView: isMerchantView(),
      statusBarHeight: app.globalData.statusBarHeight || 20,
      navTop: navRow.navTop,
      navRight: navRow.navRight,
    });
    this.setupNetworkState();


    // 从其他页面传递的参数
    if (options.params) {
      try {
        const params = JSON.parse(decodeURIComponent(options.params));
        this.setData({
          searchKeyword: params.keyword || '',
          filterConditions: Object.assign({}, this.data.filterConditions, {
            keyword: params.keyword || '',
            categoryId: params.categoryId || null,
            tag: params.tag || '',
            cityRole: params.cityRole || '',
            dateType: params.dateType || '0',
            startDate: params.startDate || '',
            endDate: params.endDate || '',
            minPrice: params.minPrice == null ? 0 : params.minPrice,
            maxPrice: params.maxPrice == null ? 1000 : params.maxPrice,
            sortType: '1' // PG-007:只留「最近」排序
          })
        });
        this._seedFilterSheet(params);
      } catch (e) {
        console.error('解析参数失败');
      }
    }
    
    // 获取初始活动列表
    this.getList();
    this.getMerchantNodes();
  },

  onShow() { this._hidden = false; if (this._refreshOnShow) { this._refreshOnShow = false; this.refreshMapResults(); } },
  onHide() { this._hidden = true; },

  onReady() {
    this.mapContext = wx.createMapContext('myMap', this);
  },

  onUnload() {
    this._unloaded = true;
    if (this._regionTimer) { clearTimeout(this._regionTimer); this._regionTimer = null; }
    this._spatialInputEpoch = (this._spatialInputEpoch || 0) + 1;
    this._listQueryEpoch = (this._listQueryEpoch || 0) + 1;
    this._merchantQueryEpoch = (this._merchantQueryEpoch || 0) + 1;
    this._listFirstPageLoading = false;
    this._listPageLoading = false;
    if (this._networkStatusHandler && typeof wx.offNetworkStatusChange === 'function') {
      wx.offNetworkStatusChange(this._networkStatusHandler);
    }
  },

  loadMoreResults() {
    // A-RPT-7:pageErrorIsRefresh 的 pageError 是「刷新失败、旧结果还在」,它不是翻页失败,
    // 不能连翻页一起禁掉;只有翻页自己的错误(pageErrorIsRefresh=false)才拦住再翻。
    if (!this.data.hasMore || (this.data.pageError && !this.data.pageErrorIsRefresh)
        || this._listFirstPageLoading || this._listPageLoading) return;
    this.setData({ pageNum: this.data.pageNum + 1 });
    this.getList();
  },

  onReachBottom() {
    this.loadMoreResults();
  }
});
