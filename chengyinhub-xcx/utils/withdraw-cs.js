'use strict'
// 2026-11-26 拍板:提现仍由平台客服线下处理(平台不直接打款)，但客户端不再内置个人微信号。
// 四个入口继续打开这一层，不发 /api/withdrawal/create。
const modal = require('./modal.js')

const WITHDRAW_CS_TIP = '请在小程序客服会话里确认金额。平台不直接打款。'

function showWithdrawCsPopup() {
  modal.show({
    title: '联系平台客服提现',
    content: WITHDRAW_CS_TIP,
    confirmText: '知道了',
    showCancel: false,
  })
}

module.exports = { WITHDRAW_CS_TIP, showWithdrawCsPopup }
