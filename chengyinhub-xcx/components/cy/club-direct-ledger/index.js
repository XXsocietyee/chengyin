const app = getApp();
const { ledgerView } = require('./view-model.js');

Component({
  properties: {
    kind: { type: String, value: 'merchant' },
    clubId: { type: Number, value: 0 },
    topicId: { type: Number, value: 0 },
  },
  data: { state: 'loading', ledger: null },
  observers: { 'kind, clubId, topicId'() { if (this._attached) this.load(); } },
  lifetimes: {
    attached() { this._attached = true; this.load(); },
    detached() { this._attached = false; this._epoch = (this._epoch || 0) + 1; },
  },
  // L10-147:同 funds-stages —— 只有真的离开过页面或换了账号才重读;首次 show 不再紧跟 attached 再拉一次。
  pageLifetimes: {
    show() {
      const refresh = this._hidden || this._loadMember !== String(app.getUserID());
      this._hidden = false;
      if (this._attached && refresh) this.load();
    },
    hide() { this._hidden = true; },
  },
  methods: {
    load() {
      const epoch = this._epoch = (this._epoch || 0) + 1;
      const memberId = String(app.getUserID());
      this._loadMember = memberId;
      const scope = { kind: this.properties.kind, clubId: this.properties.clubId, topicId: this.properties.topicId };
      this.setData({ state: 'loading', ledger: null });
      if (!['merchant', 'club'].includes(scope.kind) || !Number(memberId)
          || (scope.kind === 'club' && !(scope.clubId > 0))) {
        this.setData({ state: 'error' }); return;
      }
      const current = () => this._attached && epoch === this._epoch && memberId === String(app.getUserID());
      const showLoadError = () => { if (current()) this.setData({ state: 'error', ledger: null }); };
      app.sendRequest({
        hideLoading: true, silentError: true,
        url: scope.kind === 'club' ? '/api/club-direct-merchant/club' : '/api/club-direct-merchant/merchant', method: 'GET',
        data: Object.assign({}, scope.topicId ? { topicId: scope.topicId } : {},
          scope.kind === 'club' ? { clubId: scope.clubId } : {}),
        success: (res) => {
          if (!current()) return;
          const ledger = ledgerView(res, scope);
          this.setData({ state: ledger ? 'ready' : 'error', ledger });
        },
        fail: () => showLoadError(), successStatusAbnormal: showLoadError,
      });
    },
  },
});
