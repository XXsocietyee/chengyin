'use strict';
// 支付失败提示(OR-033):SDK 原文(requestPayment:fail …、英文)不给用户看,统一成可读文案。
// 订单列表与订单详情共用(L09-016)。
function payFailText(res) {
  const raw = String((res && res.errMsg) || '');
  if (!raw || /^[\x00-\x7F]*$/.test(raw) || /:fail/.test(raw)) return '支付未完成，请重试';
  return raw;
}
module.exports = { payFailText };
