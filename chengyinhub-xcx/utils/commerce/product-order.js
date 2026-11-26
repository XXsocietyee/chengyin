// 营销商品(通行证 / 双人票 / 小队票)下单的共用口径:报价 → 下单 → 付款 → 只认服务端订单状态。
// 主题页结算层与通行证详情页共用。金额只来自服务端报价,下单只回传 quoteSign/quoteExpiresAt,不提交金额。
const datetime = require('../datetime.js');

const PAY_MODE = { CASH: 1, POINTS: 2 };
const FULFILLMENT = { SELF: 1, GIFT: 2, EXTRA_SEAT: 3 };

function isNum(v) {
  return v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
}
function ts(v) {
  const t = datetime.toTimestamp(v);
  return Number.isFinite(t) ? t : null;
}

// 服务端 reasonCode → 人话。码不可改,文案可改;未知码统一「暂不可购买」,不解析中文。
const REASON_TEXT = {
  PAYMENT_OWNER_ROUTE_NOT_WIRED: '现金支付暂未开通',
  CASH_DISABLED: '现金支付暂未开通',
  PRODUCT_NOT_FOUND: '商品不存在或已下架',
  PRODUCT_NOT_ON_SALE: '商品当前未在售',
  SALE_NOT_STARTED: '商品尚未开售',
  SALE_ENDED: '商品已停售',
  PERIOD_ENDED: '商品有效期已结束',
  PRODUCT_HAS_NO_CONTENT: '商品未覆盖可玩内容',
  PAYMENT_UNAVAILABLE: '支付暂不可用',
  ORDER_NOT_PAYABLE: '订单当前不可支付',
  ORDER_STATE_CHANGED: '订单状态已变化，请刷新',
  REFUND_POLICY_NOT_DEFINED: '退款规则未配置，暂不可购买',
  CURRENCY_UNSUPPORTED: '该商品币种暂不支持',
  PAY_MODE_UNAVAILABLE: '该支付方式不可用',
  QUOTE_EXPIRED: '报价已过期，请重新确认',
  QUOTE_STALE: '商品价格或内容已变化，请重新确认',
  INSUFFICIENT_POINTS: '积分不足',
  POINTS_INSUFFICIENT: '积分不足',
  GIFT_NOT_ALLOWED: '该商品不支持赠送',
  USE_REGISTRATION_CHECKOUT: '该商品需在报名结算中购买',
  EXTRA_SEAT_REQUIRES_ORIGINAL_ORDER: '加座需从原订单发起，暂不可直接购买',
  REQUEST_CONFLICT: '同一请求内容不一致，请重新确认'
};
function reasonText(code) {
  return REASON_TEXT[code] || '暂不可购买';
}

/** 报价请求体:只说买哪件、几份、给谁用。 */
function quoteRequest(productId, fulfillmentKind) {
  return { productId: Number(productId), quantity: 1, fulfillmentKind: fulfillmentKind || FULFILLMENT.SELF };
}

/** 下单请求:只回传服务端报价;金额不由客户端提交。 */
function orderRequest(productId, quote, payMode, fulfillmentKind, requestId) {
  return {
    productId: productId,
    payMode: payMode,
    quantity: Number(quote && quote.quantity) || 1,
    fulfillmentKind: fulfillmentKind || FULFILLMENT.SELF,
    quoteSign: quote && quote.quoteSign,
    quoteExpiresAt: ts(quote && quote.quoteExpiresAt),
    requestId: requestId
  };
}

/** 现金报价能不能付:服务端给了现金方式、金额、签名与过期时间才算;否则只给原因。 */
function cashQuote(quote) {
  if (!quote || typeof quote !== 'object') return { buyable: false, total: null, reason: reasonText(null) };
  const modes = Array.isArray(quote.availablePayModes) ? quote.availablePayModes.map(Number) : [];
  const total = isNum(quote.totalCashAmount) ? Number(quote.totalCashAmount) : null;
  const ok = modes.indexOf(PAY_MODE.CASH) >= 0 && total !== null && !!quote.quoteSign && ts(quote.quoteExpiresAt) !== null;
  return { buyable: ok, total, reason: ok ? '' : reasonText(quote.cashUnavailableReason || quote.purchaseRouteReason || null) };
}

function newRequestId() {
  return 'mkp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
}

module.exports = { PAY_MODE, FULFILLMENT, REASON_TEXT, reasonText, quoteRequest, orderRequest, cashQuote, newRequestId };
