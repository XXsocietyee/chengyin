// §17.2 礼品领取。同一次领取复用 requestId:网络未知时再点即原样重发,服务端返回原授权。
const app = getApp()
const { isBizOk } = require('../../../utils/response-shape.js')
const mv = require('../../utils/market-view.js')
const { enter, beats } = require('../../../utils/page-motion.js')
const { safeDecode } = require('../../../utils/safe-decode.js')
const analytics = require('../../../utils/analytics.js')

// 领取码缺失或无法识别 = 链接本身坏了,与其它缺参页同一个缺参态
const MISSING_LINK_CODES = { TOKEN_REQUIRED: true, GIFT_TOKEN_INVALID: true }
// 平台兑换码(mode=code,入口在通行证页一行):六类结果 —— 无效 / 过期 / 你已兑换(可去玩) / 他人已兑换 / 不属于此账号 / 暂不可用
const CODE_REASON = {
  CODE_REQUIRED: '兑换码无效',
  INVALID_CODE: '兑换码无效',
  CODE_EXPIRED: '兑换码已过期',
  ALREADY_REDEEMED_BY_OTHER: '兑换码已被他人使用',
  SUBJECT_MISMATCH: '该兑换码不属于当前账号'
}
const CODE_UNAVAILABLE = '兑换码暂不可用'

Page({
  data: {
    statusBarHeight: app.globalData.statusBarHeight,
    navBarHeight: app.globalData.navBarHeight,
    state: 'ready', // ready | claimed | failed | unknown | missing
    reason: '',
    claiming: false,
    mode: '', // '' 礼品领取 | 'code' 平台兑换码
    code: '',
    codeOn: false, // 服务端开关 channel.platform-issued.enabled;关闭/读不到不出输入框
    codeTitle: '',
    codeErr: false
  },
  onLoad(options) {
    if (options && options.mode === 'code') {
      this._codeMode = true
      this.setData({ mode: 'code' })
      analytics.track('code_redeem_open', { bizType: 'platform_code' })
      this.loadCodeStatus()
      enter(this, 'gfIn')
      return
    }
    this._token = options && options.token ? safeDecode(options.token) : ''
    if (!this._token) this.setData({ state: 'missing' })
    // 徽章弹入、光圈循环外扩:transition 分段重放,减少动态效果时都不播(光圈停在隐身)
    enter(this, 'gfIn')
    this._syncGlow()
  },
  // L09-106
  // 光圈只在待领取(ready / unknown)且页面可见时转;领到、失败、链接失效或切走就停,不再每 2.4s 空转 setData
  _syncGlow() {
    const on = !this._codeMode && !this._hidden && !this._unloaded && (this.data.state === 'ready' || this.data.state === 'unknown')
    if (on && !this._glow) this._glow = beats(this, 'gfGlow', [[0, 34], [1, 2366]], { rest: 1 })
    else if (!on && this._glow) { this._glow(); this._glow = null }
  },
  onShow() { this._hidden = false; this._syncGlow() },
  onHide() { this._hidden = true; this._syncGlow() },
  onUnload() { this._unloaded = true; this._syncGlow() },
  loadCodeStatus() {
    app.sendRequest({
      url: '/api/channel/redeem/status', method: 'GET', hideLoading: true, autoErrorToast: false,
      success: (res) => {
        if (this._unloaded) return
        const on = !!(isBizOk(res) && res.data && res.data.platformCodeEnabled === true)
        this.setData({ codeOn: on, codeTitle: on ? '' : CODE_UNAVAILABLE, codeErr: !on })
      },
      fail: () => { if (!this._unloaded) this.setData({ codeOn: false, codeTitle: CODE_UNAVAILABLE, codeErr: true }) }
    })
  },
  onCodeInput(e) {
    const code = String((e && e.detail && e.detail.value) || '').trim()
    if (code !== this.data.code) this._reqId = ''
    this.setData({ code, codeTitle: '', codeErr: false, state: 'ready' })
  },
  // 同一码复用 requestId:网络未知再点即原样重发,服务端返回原授权;同人再兑返回「你已兑换过」
  redeemCode() {
    const code = this.data.code
    if (this.data.claiming || !code || !this.data.codeOn) return
    if (app.ensureLoginFor && !app.ensureLoginFor('登录后即可兑换', () => this.redeemCode(), { owner: this, target: () => [code] })) return
    if (!this._reqId) this._reqId = 'code_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10)
    this.setData({ claiming: true })
    app.sendRequest({
      url: '/api/channel/redeem', method: 'POST', header: { 'Content-Type': 'application/json' },
      data: JSON.stringify({ code, requestId: this._reqId }),
      hideLoading: true, autoErrorToast: false,
      success: (res) => {
        if (this._unloaded) return
        if (isBizOk(res) && res.data) {
          const ids = Array.isArray(res.data.topicIds) ? res.data.topicIds : []
          this._topicId = ids.length === 1 ? ids[0] : null
          const replayed = res.data.replayed === true
          if (!replayed) analytics.track('code_redeem_success', { bizType: 'platform_code', topicCount: ids.length, idempotencyKey: 'code_redeem_success_' + this._reqId })
          this.setData({ claiming: false, state: 'claimed', codeTitle: replayed ? '你已兑换过这个码' : '兑换成功', codeErr: false })
          return
        }
        this.setData({ claiming: false, state: 'ready', codeTitle: CODE_REASON[res && res.reasonCode] || CODE_UNAVAILABLE, codeErr: true })
      },
      fail: () => { if (!this._unloaded) this.setData({ claiming: false, state: 'unknown' }) }
    })
  },
  claim() {
    if (this._codeMode) { this.redeemCode(); return }
    if (this.data.claiming || !this._token) return
    // 买家走查 1122:游客先看得到「好友送你一份通行证」,点「领取」才弹登录,登录后原地继续领取
    if (app.ensureLoginFor && !app.ensureLoginFor('登录后即可领取礼品', () => this.claim(), { owner: this, target: () => [this._token] })) return
    if (!this._reqId) this._reqId = 'gift_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10)
    this.setData({ claiming: true })
    app.sendRequest({
      url: '/api/marketing/product/gifts/claim', method: 'POST', header: { 'Content-Type': 'application/json' },
      data: JSON.stringify({ token: this._token, requestId: this._reqId }),
      hideLoading: true, autoErrorToast: false,
      success: (res) => {
        if (isBizOk(res) && res.data) {
          this._registrationId = res.data.registrationId || null
          this.setData({ claiming: false, state: 'claimed' }); this._syncGlow()
          return
        }
        const code = res && res.reasonCode
        if (MISSING_LINK_CODES[code]) { this.setData({ claiming: false, state: 'missing' }); this._syncGlow(); return }
        this.setData({ claiming: false, state: 'failed', reason: mv.claimReasonText(code) }); this._syncGlow()
      },
      fail: () => { this.setData({ claiming: false, state: 'unknown' }); this._syncGlow() }
    })
  },
  goOrder() {
    // 兑换码:单作品直达作品页,合集进游戏主题库
    if (this._codeMode) {
      if (this._topicId) wx.redirectTo({ url: '/pages/topic/index/index?id=' + encodeURIComponent(this._topicId) })
      else wx.redirectTo({ url: '/subpackageMember/market/library/index' })
      return
    }
    if (this._registrationId) {
      wx.redirectTo({ url: '/subpackageMember/orderinfo/orderinfo?id=' + encodeURIComponent(this._registrationId) })
    } else {
      wx.redirectTo({ url: '/subpackageMember/market/passes/index?tab=gifts' })
    }
  },
  goBack() {
    if (getCurrentPages().length > 1) wx.navigateBack()
    else wx.switchTab({ url: '/pages/member/index/index' })
  }
})
