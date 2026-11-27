const toast = require('../../../utils/toast.js');
const app = getApp();
const merchantTheme = require('../../../utils/merchant-theme.js');
const { inactiveAccess, normalizeMerchantAccess } = require('../../../utils/merchant-access-policy.js');
const {
  filterAftercareItems,
  groupAftercareItems,
  shapeAftercareListPage,
} = require('./detail/view-model.js');

const TABS = [
  { key: 'PENDING', label: '待回应' },
  { key: 'PROCESSING', label: '处理中' },
  { key: 'COMPLETED', label: '已完成' },
];

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    tabs: TABS,
    bucket: 'PENDING',
    pageState: 'loading',
    listShell: false,
    errorMessage: '',
    // L07-052:已加载的原始行只在实例上(this._items),页面拿分组后的行和一个条数
    itemCount: 0,
    groups: [],
    keyword: '',
    pageNum: 1,
    pageSize: 20,
    hasMore: false,
    loadingMore: false,
  },

  onLoad() {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    this._merchantAccess = inactiveAccess();
    this.setData({
      statusBarHeight: info.statusBarHeight || 20,
      navBarHeight: (app.globalData && app.globalData.navBarHeight) || 44,
    });
    this.loadAccess();
  },

  onShow() {
    merchantTheme.merchantPageShow();
    if (this._refreshAfterDetail) {
      this._refreshAfterDetail = false;
      this.loadList(true, true); // L07-050:静默刷新,不打回骨架;已翻到的后面页一并重读,不收成第一页
    }
  },
  onHide() { merchantTheme.merchantPageRestore(); },
  onUnload() { merchantTheme.merchantPageRestore(); },

  // 原地无权限态的唯一动作:非成员申请入驻,在营成员返回
  onDenyCta() { require('../../../utils/merchant-no-permission.js').followDenyCta(this, this.data.accessMember === true, '/pages/merchant/index/index'); },
  onNavBack() {
    if (getCurrentPages().length > 1) wx.navigateBack();
    else wx.reLaunch({ url: '/pages/merchant/index/index' });
  },

  loadAccess() {
    this.setData({ pageState: 'loading', errorMessage: '' });
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/merchant/access/me',
      method: 'POST',
      success: (res) => {
        if (!successObject(res)) {
          this.setData({ pageState: 'error', errorMessage: errorText(res, '经营身份加载失败') });
          return;
        }
        const access = normalizeMerchantAccess(res.data);
        this._merchantAccess = access;
        if (!access.active || !access.canReadAftercare) {
          this._items = [];
          this.setData({ pageState: 'no-permission', accessMember: access.active === true, itemCount: 0, groups: [], hasMore: false });
          return;
        }
        this.loadList(true);
      },
      fail: () => this.setData({ pageState: 'error', errorMessage: '网络异常，请重试' }),
    });
  },

  switchBucket(event) {
    const bucket = event && event.detail && event.detail.key;
    if (!TABS.some(item => item.key === bucket) || bucket === this.data.bucket) return;
    this._items = [];
    this.setData({ bucket, itemCount: 0, groups: [], pageNum: 1, hasMore: false, loadingMore: false });
    this.loadList(true);
  },

  retry() {
    if (this._merchantAccess && this._merchantAccess.canReadAftercare) this.loadList(true);
    else this.loadAccess();
  },

  loadMore() {
    if (!this.data.hasMore || this.data.loadingMore || this._refreshingPages) return;
    this.loadList(false);
  },

  loadList(reset, silent) {
    if (!this._merchantAccess || !this._merchantAccess.canReadAftercare) return;
    const bucket = this.data.bucket;
    const loadedThrough = Math.max(1, Number(this.data.pageNum) || 1);
    const pageNum = reset ? 1 : loadedThrough + 1;
    // L07-049:只认最后一次列表请求(快速切分段或切分段时还在翻页)
    const seq = this._listSeq = (this._listSeq || 0) + 1;
    const keepRows = reset && silent && this.data.pageState === 'ready';
    // 静默重读要把已经翻到的页都再取一遍;中途失败留着屏上的行,不能先换成第一页
    this._refreshingPages = keepRows && loadedThrough > 1;
    if (reset && !keepRows) this.setData({ pageState: 'loading', errorMessage: '', loadingMore: false, listShell: true }); // 2026-11-02 X-5:进入列表后分段常驻
    else if (!reset) this.setData({ loadingMore: true });
    const readPage = (currentPage, accumulated, lastPage) => {
      app.sendRequest({
        hideLoading: true,
        silentError: true,
        url: `/api/merchant/aftercare/list?bucket=${bucket}&pageNum=${currentPage}&pageSize=${this.data.pageSize}`,
        method: 'POST',
        success: (res) => {
          if (seq !== this._listSeq) return;
          if (!successObject(res)) {
            this.handleListFailure(reset, errorText(res, '售后列表加载失败'), keepRows);
            return;
          }
          const shaped = shapeAftercareListPage(res.data, bucket);
          if (!shaped || shaped.pageNum !== currentPage) {
            this.handleListFailure(reset, '售后列表加载失败，请重试', keepRows);
            return;
          }
          const items = reset && currentPage === 1 ? shaped.items : accumulated.concat(shaped.items);
          if (keepRows && shaped.hasMore && currentPage < lastPage) {
            readPage(currentPage + 1, items, lastPage);
            return;
          }
          this._refreshingPages = false;
          this._items = items;
          this.setData({
            itemCount: items.length,
            groups: groupAftercareItems(filterAftercareItems(items, this.data.keyword), new Date()),
            pageNum: shaped.pageNum,
            hasMore: shaped.hasMore,
            pageState: items.length ? 'ready' : 'empty',
            errorMessage: '',
            loadingMore: false,
          });
        },
        fail: () => { if (seq === this._listSeq) this.handleListFailure(reset, '网络异常，请重试', keepRows); },
      });
    };
    readPage(pageNum, reset ? [] : (this._items || []), keepRows ? loadedThrough : pageNum);
  },

  onSearchInput(event) {
    const keyword = String((event && event.detail && event.detail.value) || '');
    this.setData({
      keyword,
      groups: groupAftercareItems(filterAftercareItems(this._items || [], keyword), new Date()),
    });
  },

  clearSearch() {
    this.onSearchInput({ detail: { value: '' } });
  },

  handleListFailure(reset, message, keepRows) {
    this._refreshingPages = false;
    if (keepRows) {
      this.setData({ loadingMore: false });
      toast(message);
      return;
    }
    if (reset) this.setData({ pageState: 'error', errorMessage: message, loadingMore: false });
    else {
      this.setData({ loadingMore: false });
      toast(message);
    }
  },

  openDetail(event) {
    const dataset = event.currentTarget.dataset || {};
    if (dataset.recordtype === 'MANUAL_CASE') {
      const manualCaseId = positiveId(dataset.manualcaseid);
      if (manualCaseId == null || dataset.refundid) return;
      wx.navigateTo({ url: `/pages/merchant/aftercare/detail/index?recordType=MANUAL_CASE&manualCaseId=${manualCaseId}` });
      return;
    }
    if (dataset.recordtype && dataset.recordtype !== 'REFUND') return;
    const refundId = positiveId(dataset.refundid);
    if (refundId == null) return;
    wx.navigateTo({ url: `/pages/merchant/aftercare/detail/index?refundId=${refundId}` });
  },
});

function positiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function successObject(res) {
  return !!(res && (res.code === 200 || res.code === '200')
    && res.data && typeof res.data === 'object' && !Array.isArray(res.data));
}

function errorText(res, fallback) {
  return (app.getRequestErrorMessage && app.getRequestErrorMessage(res, fallback)) || fallback;
}
