const moneyFormat = require('../../utils/money-format.js')
// §17.1 / §17.2 / §17.3 / §17.4 / P6:通行证与礼品只读服务端事实。
// - 可买与否只看服务端:列表只来自 /api/marketing/product/list(listSellable),购买按钮只在
//   报价回 availablePayModes 非空时出现;现金关闭写 cashUnavailableReason,不自判。
// - 价格、期限、席位、覆盖作品都原样显示,不乘人数、不拼折扣。
// - 礼品:待领取时买家也不能玩;领取页按 reasonCode 分别说,不泄露他人订单。
const datetime = require('../../utils/datetime.js');

function ts(v) {
  const t = datetime.toTimestamp(v);
  return Number.isFinite(t) ? t : null;
}
function isNum(v) {
  return v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
}
function day(v) {
  const t = ts(v);
  return t === null ? '' : datetime.formatDayDots(t);
}

const KIND_TEXT = {
  1: '单关票', 2: '城市包', 3: '时限通票', 4: '固定期年卡',
  5: '团体票', 6: '学校团体票', 7: '礼品通行证', 8: '加座'
};
const { PAY_MODE, FULFILLMENT, reasonText, orderRequest } = require('../../utils/commerce/product-order.js');
const ROUTE = { SELF_PLAY: 1, TICKET: 2, EXTRA_SEAT: 3 };

/** 期限文案:固定期是固定有效期,不写订阅;首次使用型写「首次游玩起」。 */
function validityText(p) {
  if (!p) return '';
  const k = Number(p.validityKind);
  if (k === 1 && isNum(p.validDays)) return '购买后 ' + Number(p.validDays) + ' 天内有效';
  if (k === 2) {
    const from = day(p.fixedValidFrom);
    const to = day(p.fixedValidTo);
    if (from && to) return from + ' – ' + to;
    return to ? ('有效至 ' + to) : '';
  }
  if (k === 3 && isNum(p.validDays)) return '首次游玩起 ' + Number(p.validDays) + ' 天内有效';
  return '';
}

/** 价格只显示服务端给的单价;现金为空写积分价;都为空不显示价格(不写 0)。 */
function priceText(cash, points) {
  const parts = [];
  if (isNum(cash)) parts.push('¥' + moneyFormat.decimalText(cash));
  if (isNum(points)) parts.push(Number(points) + ' 积分');
  return parts.join(' / ');
}

function productCard(p) {
  if (!p || !p.productId) return null;
  const items = Array.isArray(p.items) ? p.items : [];
  return {
    id: p.productId,
    name: p.productName || '',
    kind: KIND_TEXT[p.productKind] || '',
    city: p.saleCity || '',
    validity: validityText(p),
    seats: isNum(p.seatCount) && Number(p.seatCount) > 1 ? (Number(p.seatCount) + ' 人') : '',
    price: priceText(p.cashPrice, p.pointsPrice),
    coverCount: items.length,
    topics: items.map((it) => it && it.topicTitle).filter(Boolean),
    giftAllowed: Number(p.giftAllowed) === 1 && Number(p.productKind) !== 7,
    // 礼品通行证(kind=7)只能走赠送履约
    giftOnly: Number(p.productKind) === 7,
    // §17.3 加座:独立增购分支未合入,只显示不可用原因,不报价、不收款
    isExtraSeat: Number(p.productKind) === 8 || Number(p.purchaseRoute) === ROUTE.EXTRA_SEAT
  };
}

// reasonCode → 人话的码表在 utils/commerce/product-order.js(主题页结算层共用)

/**
 * 报价 → 购买区。
 * - route=2 团体/学校:不出本域购买按钮,给原报名结算入口(checkout 指针)。
 * - route=3 加座:只显示不可用原因(§17.3 共享分支未合入,不先收款)。
 * - 其它:availablePayModes 里有什么出什么;现金关闭写原因。
 */
function purchaseView(quote) {
  const out = { state: 'unavailable', reason: '', payModes: [], total: '', checkout: null, expiresAt: null };
  if (!quote || typeof quote !== 'object') return out;
  const route = Number(quote.purchaseRoute);
  if (route === ROUTE.TICKET || quote.purchaseRouteReason === 'USE_REGISTRATION_CHECKOUT') {
    const c = quote.checkout && typeof quote.checkout === 'object' ? quote.checkout : null;
    out.state = c ? 'checkout' : 'unavailable';
    out.checkout = c;
    out.reason = c ? '' : reasonText('USE_REGISTRATION_CHECKOUT');
    return out;
  }
  if (route === ROUTE.EXTRA_SEAT || quote.purchaseRouteReason === 'EXTRA_SEAT_REQUIRES_ORIGINAL_ORDER') {
    out.reason = reasonText('EXTRA_SEAT_REQUIRES_ORIGINAL_ORDER');
    return out;
  }
  const modes = Array.isArray(quote.availablePayModes) ? quote.availablePayModes.map(Number) : [];
  if (modes.indexOf(PAY_MODE.POINTS) >= 0 && isNum(quote.totalPointsAmount)) {
    out.payModes.push({ mode: PAY_MODE.POINTS, label: Number(quote.totalPointsAmount) + ' 积分兑换' });
  }
  if (modes.indexOf(PAY_MODE.CASH) >= 0 && isNum(quote.totalCashAmount)) {
    out.payModes.push({ mode: PAY_MODE.CASH, label: '支付 ¥' + moneyFormat.decimalText(quote.totalCashAmount) });
  }
  out.expiresAt = ts(quote.quoteExpiresAt);
  if (out.payModes.length && quote.quoteSign && out.expiresAt !== null) {
    out.state = 'buyable';
    if (quote.cashUnavailableReason) out.reason = reasonText(quote.cashUnavailableReason);
    return out;
  }
  out.reason = quote.cashUnavailableReason ? reasonText(quote.cashUnavailableReason) : reasonText(null);
  return out;
}

/**
 * r2-join:后端提示原样显示,但去掉给开发看的内部编号(如「topicId=990014」「orderNo: x」),
 * 不改写其余文字。去完为空就退回通用原因。
 */
function playerText(msg) {
  if (typeof msg !== 'string') return '';
  const out = msg
    .replace(/[\s,，;；(（]*\b[A-Za-z]*(?:Id|ID|No|Key|Code)\s*[=:：]\s*[\w-]+[)）]?/g, '')
    .replace(/[\s,，;；:：]+$/, '')
    .trim();
  return out;
}

/**
 * r2-join 结算摘要:只列报价里真实存在的支付方式和金额。
 * 现金与积分是服务端给的两种独立方式(不是叠加抵扣);现金关闭时那一行写原因,不出金额按钮。
 */
function checkoutRows(quote, card) {
  const rows = [];
  if (!quote || typeof quote !== 'object') {
    if (card && card.price) rows.push({ key: 'price', k: '价格', v: card.price });
    return rows;
  }
  const modes = Array.isArray(quote.availablePayModes) ? quote.availablePayModes.map(Number) : [];
  if (isNum(quote.totalCashAmount)) {
    const cashOn = modes.indexOf(PAY_MODE.CASH) >= 0;
    rows.push({ key: 'cash', k: '现金', v: '¥' + moneyFormat.decimalText(quote.totalCashAmount),
      note: !cashOn && quote.cashUnavailableReason ? reasonText(quote.cashUnavailableReason) : '', off: !cashOn });
  }
  if (isNum(quote.totalPointsAmount) && modes.indexOf(PAY_MODE.POINTS) >= 0) {
    rows.push({ key: 'points', k: '积分兑换', v: Number(quote.totalPointsAmount) + ' 积分' });
  }
  return rows;
}


/**
 * 订单状态:支付成功(SDK)不等于已付,只认服务端 status。
 * fulfillmentState=2 = 已付但等待首次游玩激活。
 */
function orderStateText(order) {
  if (!order) return '';
  const s = order.statusLabel;
  if (s === 'PAID') {
    if (Number(order.fulfillmentState) === 2) return '已购买 · 首次游玩时开始计算有效期';
    if (Number(order.fulfillmentKind) === FULFILLMENT.GIFT) return '已购买 · 礼品';
    return '已购买';
  }
  if (s === 'PENDING_CASH') {
    const blocked = order.payment && order.payment.blockedReason;
    return blocked ? ('待支付 · ' + reasonText(blocked)) : '待支付';
  }
  if (s === 'CANCELLED') return '已取消';
  if (s === 'REFUNDED') return '已退款';
  return '状态待确认';
}

function orderRow(order, nameById) {
  if (!order || !order.orderNo) return null;
  const amount = Number(order.payMode) === PAY_MODE.POINTS
    ? (isNum(order.pointsAmount) ? Number(order.pointsAmount) + ' 积分' : '')
    : (isNum(order.cashAmount) ? '¥' + moneyFormat.decimalText(order.cashAmount) : '');
  return {
    key: order.orderNo,
    name: (nameById && nameById[order.productId]) || '通行证订单',
    state: orderStateText(order),
    amount,
    time: day(order.paidAt || order.createdAt)
  };
}

const GIFT_STATE = { 0: '待领取', 1: '已领取', 2: '已过期', 3: '已撤销' };
// 买家走查 1122:礼品行带上商品名(与订单行同源 nameById),只看状态分不清送的是哪张
function giftRow(gift, side, nameById) {
  if (!gift || gift.giftId === undefined || gift.giftId === null) return null;
  const status = Number(gift.status);
  let state = GIFT_STATE[status] || '状态待确认';
  if (side === 'bought' && status === 0) state = '待领取 · 领取前你和对方都不能游玩';
  if (side === 'bought' && status === 3) state = '已撤销 · 退回给你';
  return {
    key: side + '-' + gift.giftId,
    name: (nameById && nameById[gift.productId]) || '',
    state,
    expires: status === 0 && day(gift.claimExpiresAt) ? ('领取截止 ' + day(gift.claimExpiresAt)) : '',
    time: day(gift.claimedAt || gift.createdAt)
  };
}

// §17.2 领取失败按原因分别说,不泄露他人订单
const CLAIM_REASON_TEXT = {
  GIFT_CLAIM_EXPIRED: '礼品领取码已过期',
  GIFT_NOT_FOUND: '礼品不存在',
  GIFT_NOT_FOR_YOU: '这份礼品不是给你的',
  GIFT_ALREADY_CLAIMED: '礼品已被领取',
  GIFT_UNAVAILABLE: '礼品当前不可领取',
  GIFT_SOURCE_UNLINKED: '礼品当前不可领取',
  GIFT_SOURCE_MISSING: '礼品当前不可领取',
  GIFT_SOURCE_OWNER_MISMATCH: '礼品当前不可领取',
  GIFT_SOURCE_SCOPE_INVALID: '礼品当前不可领取',
  GIFT_SOURCE_INACTIVE: '礼品当前不可领取',
  GIFT_SOURCE_EXPIRED: '礼品已过期',
  GIFT_PRODUCT_MISSING: '礼品当前不可领取',
  GIFT_TOPIC_NOT_COVERED: '礼品当前不可领取',
  GIFT_SOURCE_ALREADY_USED: '礼品已开始使用，不能领取'
};
function claimReasonText(code) {
  return CLAIM_REASON_TEXT[code] || '礼品当前不可领取';
}

// U07-03 已购工坊:只显示不可用原因,不画安装/购买入口
const WORKSHOP_REASON_TEXT = {
  CHANNEL_NOT_CONFIGURED: '暂不可购买',
  SERVER_VERIFICATION_UNAVAILABLE: '暂不可购买'
};
function workshopReasonText(code) {
  return WORKSHOP_REASON_TEXT[code] || '暂不可购买';
}

module.exports = {
  playerText,
  checkoutRows,
  workshopReasonText,
  KIND_TEXT, PAY_MODE, FULFILLMENT, ROUTE,
  validityText, priceText, productCard, purchaseView, orderRequest,
  orderStateText, orderRow, giftRow, reasonText, claimReasonText
};
