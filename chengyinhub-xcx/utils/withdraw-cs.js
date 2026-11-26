'use strict'
// 提现留在小程序客服会话里确认金额。平台不直接打款。
// 弹层复用既有 cy-modal-host / cy-modal,不新造弹窗形态。
const modal = require('./modal.js')

function showWithdrawCsPopup() {
  modal.show({
    title: '联系平台客服提现',
    content: '请在小程序客服会话里确认金额。平台不直接打款。',
    confirmText: '知道了',
    showCancel: false,
  })
}

module.exports = { showWithdrawCsPopup }
