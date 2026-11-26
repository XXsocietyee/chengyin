// 账户收益 · 本月收入明细 + 我的资产(2026-10-28 G-9,Revolut 版)。
// 与 cy-funds-stages 同一做法:组件自己读、自己校身份,不往收益场景里加请求 ——
// 场景只管余额那一条读(它的请求计数与换号守卫有契约锁着)。
const earningsView = require('../../utils/earnings-view.js');
const { buildFundsStages } = require('../../../components/cy/funds-stages/view-model.js');
const { ledgerView } = require('../../../components/cy/club-direct-ledger/view-model.js');
const app = getApp();

function identityKey() {
  const gd = app.globalData || {};
  const member = typeof app.getUserID === 'function' ? app.getUserID() : gd.user_id;
  const role = typeof app.getUserRole === 'function' ? app.getUserRole() : gd.role;
  const type = typeof app.getUserType === 'function' ? app.getUserType() : gd.user_type;
  return [member == null ? '' : member, role || '', type == null ? '' : type].join('|');
}
const EMPTY_MONTH = { ready: false, total: '0.00', items: [], monthLabel: '' };

Component({
  // M-32:商家视角另读俱乐部计酬,并进本月收入明细(结算明细页不再单列「俱乐部计酬」卡)
  properties: { merchant: { type: Boolean, value: false } },
  data: { month: EMPTY_MONTH, monthError: false, clubError: false, assets: [], assetsError: false },
  lifetimes: {
    attached() { this._detached = false; this._hidden = false; this.load(); },
    detached() { this._detached = true; this._epoch = (this._epoch || 0) + 1; },
  },
  pageLifetimes: {
    show() {
      const hidden = this._hidden;
      this._hidden = false;
      if (!hidden) {
        if (this._identity !== identityKey()) this.load();
        return;
      }
      const kept = this._settled && this._identity === identityKey() && this.data.month && this.data.month.ready
        && !this.data.monthError && !this.data.assetsError && !this.data.clubError;
      if (!kept) this.load();
    },
    hide() { this._hidden = true; this._epoch = (this._epoch || 0) + 1; },
  },
  methods: {
    _current(epoch) {
      return epoch === this._epoch && !this._detached && !this._hidden && this._identity === identityKey();
    },
    _mark(epoch, key, ok) {
      const slot = this._slots;
      if (!this._current(epoch) || !slot || slot.epoch !== epoch) return;
      slot[key] = ok ? 'ok' : 'fail';
      this._settled = slot.month === 'ok' && slot.assets === 'ok' && slot.club === 'ok';
    },
    load() {
      if (this._detached || this._hidden) return;
      const next = identityKey();
      const same = this._identity === next;
      this._identity = next;
      const epoch = this._epoch = (this._epoch || 0) + 1;
      this._settled = false;
      this._slots = { epoch, month: '', assets: '', club: this.properties.merchant ? '' : 'ok' };
      // 换号才清。同一账号没读齐时重读,已经画出的明细和资产先留着。
      if (!same) {
        this._balanceMonth = null;
        this._clubItems = [];
        this.setData({ month: EMPTY_MONTH, monthError: false, clubError: false, assets: [], assetsError: false });
      }
      this.loadMonth(epoch);
      if (this.properties.merchant) this.loadClubPay(epoch);
      this.loadAssets(epoch);
    },
    retryMonth() { this.loadMonth(this._epoch); },
    retryClubPay() { this.loadClubPay(this._epoch); },
    _setMonth() {
      if (!this._balanceMonth) return;
      this.setData({ month: earningsView.withClubPay(this._balanceMonth, this._clubItems) });
    },
    loadClubPay(epoch) {
      // 无财务权限(403)不算加载失败:这份账本本来就不给看,不出重试行
      const forbidden = (res, status) => Number(status || (res && (res.code || res.statusCode))) === 403;
      app.sendRequest({
        url: '/api/club-direct-merchant/merchant', method: 'GET', hideLoading: true, silentError: true,
        success: (res) => {
          if (!this._current(epoch)) return;
          const ledger = ledgerView(res, { kind: 'merchant' });
          if (!ledger) {
            const blocked = forbidden(res);
            if (!blocked) this.setData({ clubError: true });
            this._mark(epoch, 'club', blocked);
            return;
          }
          this._clubItems = earningsView.clubPayMonthItems(ledger.rows, new Date());
          this.setData({ clubError: false });
          this._setMonth();
          this._mark(epoch, 'club', true);
        },
        fail: (res, status) => {
          if (!this._current(epoch)) return;
          const blocked = forbidden(res, status);
          if (!blocked) this.setData({ clubError: true });
          this._mark(epoch, 'club', blocked);
        },
        successStatusAbnormal: (res, status) => {
          if (!this._current(epoch)) return;
          const blocked = forbidden(res, status);
          if (!blocked) this.setData({ clubError: true });
          this._mark(epoch, 'club', blocked);
        },
      });
    },
    retryAssets() { this.loadAssets(this._epoch); },
    // 本月收入:最近 100 条流水里只算本月的收入;完整分页仍在「明细」
    loadMonth(epoch) {
      app.sendRequest({
        url: '/api/user/balance/list', method: 'POST', data: { pageNum: 1, pageSize: 100 }, hideLoading: true, silentError: true,
        success: (res) => {
          if (!this._current(epoch)) return;
          const data = res && res.code == '200' ? res.data : null;
          const rows = data && (data.rows || data.list || data);
          if (!Array.isArray(rows)) { this.setData({ monthError: true }); this._mark(epoch, 'month', false); return; }
          this._balanceMonth = Object.assign({ ready: true }, earningsView.monthIncome(rows, new Date(), 3));
          this.setData({ monthError: false });
          this._setMonth();
          this._mark(epoch, 'month', true);
        },
        fail: () => { if (this._current(epoch)) { this.setData({ monthError: true }); this._mark(epoch, 'month', false); } },
        successStatusAbnormal: () => { if (this._current(epoch)) { this.setData({ monthError: true }); this._mark(epoch, 'month', false); } },
      });
    },
    loadAssets(epoch) {
      app.sendRequest({
        url: '/api/wallet/stages', method: 'POST', data: {}, hideLoading: true, silentError: true,
        header: { 'content-type': 'application/json' },
        success: (res) => {
          if (!this._current(epoch)) return;
          const stages = res && res.code == 200 ? buildFundsStages(res.data) : null;
          this.setData({ assets: earningsView.assetRows(stages), assetsError: !stages });
          this._mark(epoch, 'assets', !!stages);
        },
        fail: () => { if (this._current(epoch)) { this.setData({ assetsError: true }); this._mark(epoch, 'assets', false); } },
      });
    },
    openDetail() { this.triggerEvent('detail'); },
  },
});
