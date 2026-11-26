const { initialData, methods } = require('../../deregister-flow.js');

Component({
  properties: {
    theme: { type: String, value: 'player' },
  },
  data: initialData(),
  lifetimes: {
    attached() { this._detached = false; this._hidden = false; this.loadStatus(); },
    detached() { this._detached = true; this.dispose(); },
  },
  pageLifetimes: {
    // L10-042:切到短信 App 只是隐藏。在途验证码继续发送,已填验证码和确认留下。卸载走 detached。
    hide() { this._hidden = true; this.dispose({ keepSms: true }); },
    // 短信 App、选图等短暂离开再回来:不整页重载、不清已填验证码。仍安静回读;阻断结果照常展示。
    show() {
      const wasHidden = this._hidden;
      this._hidden = false;
      if (wasHidden && !this._detached) {
        this.setData({ submitting: false, canceling: false });
        this.loadStatus({ quiet: true });
      }
    },
  },
  // 显式列出事件入口，让 WXML 死链门禁能从组件本体核对；业务实现仍只在 shared flow 一处。
  methods: {
    _readCurrent(token, memberId, res, code) { return methods._readCurrent.call(this, token, memberId, res, code); },
    _readAuthOutcome(res, code) { return methods._readAuthOutcome.call(this, res, code); },
    loginToRead() { return methods.loginToRead.call(this); },
    _statusFailure(message) { return methods._statusFailure.call(this, message); },
    loadStatus(options) { return methods.loadStatus.call(this, options); },
    loadPrecheck(token, options) { return methods.loadPrecheck.call(this, token, options); },
    goCancellationNotice() { return methods.goCancellationNotice.call(this); },
    closeNoticeSheet() { return methods.closeNoticeSheet.call(this); },
    inputCode(event) { return methods.inputCode.call(this, event); },
    toggleConfirmed(event) { return methods.toggleConfirmed.call(this, event); },
    refreshApplyState() { return methods.refreshApplyState.call(this); },
    sendSms() { return methods.sendSms.call(this); },
    apply() { return methods.apply.call(this); },
    cancel() { return methods.cancel.call(this); },
    recheck() { return methods.recheck.call(this); },
    _reconcileApply() { return methods._reconcileApply.call(this); },
    dispose(options) { return methods.dispose.call(this, options); },
  },
});
