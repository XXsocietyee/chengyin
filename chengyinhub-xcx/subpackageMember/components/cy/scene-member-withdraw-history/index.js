'use strict'

// H04 / D22 提现记录。列表与取数逻辑的唯一实现；
// subpackageMember/tixianjilu 是 full sheet 深链壳，earnings 场景栈也挂载本组件。
// 页面级的 merchantTheme 换肤留在壳里 —— 弹窗主题由 scene-sheet 的 theme 作用域给。
const app = getApp()
const moneyFormat = require('../../../../utils/money-format.js')
const { memberId, failureStatus, retryLogin, recoverReadSession } = require('../../../../utils/session/login-reload.js')

// L09-023:只认有限非负 JSON number(后端 BigDecimal 按数字下发);显示走全站金额口径(一位小数、「−¥」),
// 不再一列里混「-12.00」和兜底的「¥0.0」两种格式。
function moneyText(value) {
  if (!(typeof value === 'number' && Number.isFinite(value) && value >= 0)) return null
  return value === 0 ? moneyFormat.yuan(0) : moneyFormat.yuan(-value)
}

function statusView(status) {
  if (status === 0) return { statusText: '提现中', statusVariant: 'warn' }
  if (status === 1) return { statusText: '提现成功', statusVariant: 'success' }
  if (status === 2) return { statusText: '提现失败，提现金额已全部退回', statusVariant: 'danger' }
  return { statusText: '状态待确认', statusVariant: 'neutral' }
}

Component({
  properties: {
    theme: { type: String, value: 'player' },
  },
  data: {
    list: [],
    page_no: 1,
    hasMore: false,
    nodata: false,
    authRequired: false,
    accessDenied: false,
    loadErr: false,
    loading: true,
  },
  lifetimes: {
    attached() { this.getList() },
    detached() { this._detached = true; this._loadToken = (this._loadToken || 0) + 1 },
  },
  pageLifetimes: {
    show() { this._hidden = false; if (this._readSessionChanged || this._readOwner !== undefined && this._readOwner !== memberId(app)) { this._readSessionChanged = false; this.getList() } },
    hide() { this._hidden = true },
  },
  methods: {
    // 壳的 onReachBottom / 弹窗正文滚到底都转发到这里
    loadMore() {
      if (this.data.loading || !this.data.hasMore) return
      this.setData({ page_no: this.data.page_no + 1 })
      this.getList()
    },

    getList() {
      if (this._detached) return
      const owner = memberId(app)
      if (owner !== this._readOwner) { this._readOwner = owner; this.setData({ list: [], page_no: 1, hasMore: false }) }
      if (!owner) {
        // L09-079:冷启动会话还没恢复时先留骨架,等就绪后重进本函数;就绪后仍无会话才显示登录态
        if (app.isAppReady === false && typeof app.waitForAppReady === 'function') {
          if (!this._coldWait) {
            this._coldWait = true
            const settle = () => { this._coldWait = false; if (!this._detached) this.getList() }
            let pending
            try { pending = app.waitForAppReady() } catch (error) { pending = null }
            Promise.resolve(pending).then(settle, settle)
          }
          this.setData({ loading: true, authRequired: false, accessDenied: false, loadErr: false })
          return
        }
        this.setData({ authRequired: true, accessDenied: false, loadErr: true, loading: false }); return
      }
      const that = this
      const token = this._loadToken = (this._loadToken || 0) + 1
      that.setData({ loading: true, authRequired: false, accessDenied: false })
      const current = () => !that._detached && token === that._loadToken && owner === memberId(app)
      const recover = (res, statusCode) => !that._detached && token === that._loadToken && recoverReadSession(that, app, res,
        function (anonymous) { this._loadToken++; this._readOwner = undefined; this.setData({ list: [], page_no: 1, hasMore: false, loading: false, loadErr: true, authRequired: anonymous, accessDenied: false }); },
        that.getList, statusCode)
      const denied = (res, statusCode) => {
        const code = failureStatus(res, statusCode)
        if (!current() || (code !== 401 && code !== 403)) return false
        that.setData({ list: [], page_no: 1, hasMore: false, loading: false, loadErr: true, authRequired: code === 401, accessDenied: code === 403 })
        return true
      }
      app.sendRequest({
        hideLoading: true,
        url: '/api/withdrawal/list',
        method: 'POST',
        data: { pageNum: that.data.page_no, pageSize: app.getPageSize() },
        success(res) {
          if (!current() || denied(res)) return
          if (res.code == '200') {
            const payload = res.data
            const rows = Array.isArray(payload) ? payload
              : (payload && Array.isArray(payload.rows) ? payload.rows
                : (payload && Array.isArray(payload.list) ? payload.list : null))
            // rows 不是数组 ⇒ 落错误态,不当成空列表
            if (!rows) {
              that.setData({ loadErr: true })
              return
            }
            const total = payload && payload.total != null ? Number(payload.total) : rows.length
            that.setData({
              list: that.data.list.concat(rows.map((item) => Object.assign({}, item, statusView(item.status), {
                receivedAmountText: moneyText(item.receivedAmount),
                createTimeText: item.createTime || '—',
              }))),
              hasMore: app.getTotalPage(Number.isFinite(total) ? total : rows.length, app.getPageSize()) > that.data.page_no,
              loadErr: false,
            })
          } else {
            that.setData({ loadErr: true })
          }
        },
        fail(res, statusCode) { if (!recover(res, statusCode) && current() && !denied(res, statusCode)) that.setData({ loadErr: true }) },
        successStatusAbnormal(res, statusCode) { if (!recover(res, statusCode) && current() && !denied(res, statusCode)) that.setData({ loadErr: true }) },
        complete() {
          if (!current()) return
          that.setData({ loading: false, nodata: that.data.list.length < 1 && !that.data.loadErr })
        },
      })
    },

    onRetry() {
      if (this.data.authRequired) { retryLogin(this, app, () => this.getList()); return }
      this.setData({ page_no: 1, list: [] })
      this.getList()
    },
    onPageRetry() {
      this.setData({ loadErr: false })
      this.getList()
    },
  },
})
