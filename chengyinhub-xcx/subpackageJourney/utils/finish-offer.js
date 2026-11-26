'use strict';

/* R4 完局优惠卡:结算总览下方一张卡,只读服务端事实。
 * - 通行证:GET /api/platform-pass 的 enabled / plans / libraryCount / holding;第一版只卖月卡(同 membership 页 passView)。
 * - 商品:GET /api/marketing/product/list(listSellable,服务端已判在售)里的城市包(2)/ 时限通票(3),覆盖本主题以外的路线。
 * - 名称与价格原样取服务端字段,金额只做显示格式化;不算折扣、不算倒计时。
 * - 读不到 / 不在售 / 已持有 ⇒ 返回 null,页面整卡不出(不写 0、不出占位)。
 * 促销引擎的完局触发(trigger=1/2)目前只作用于报名报价,不作用于通行证与商品,所以这里不接 deal。 */

const moneyFormat = require('../../utils/money-format.js');

const PASS_PLAN = 'MONTH';
const BUNDLE_KINDS = [2, 3];
const MEMBERSHIP_URL = '/subpackageMember/market/membership/index';
const PRODUCT_URL = '/subpackageMember/market/pass/index?id=';

function isNum(v) {
  return v !== null && v !== undefined && v !== '' && typeof v !== 'boolean' && Number.isFinite(Number(v));
}
function isId(v) { return /^[1-9]\d{0,18}$/.test(String(v == null ? '' : v)); }
function text(v) { return typeof v === 'string' ? v.trim() : ''; }

function passOffer(ov) {
  if (!ov || ov.enabled !== true) return null;
  if (ov.holding && ov.holding.active === true) return null;
  if (!isNum(ov.libraryCount) || Number(ov.libraryCount) < 2) return null;
  const plan = (Array.isArray(ov.plans) ? ov.plans : [])
    .find((p) => p && p.planCode === PASS_PLAN && text(p.title) && isNum(p.priceFen) && Number(p.priceFen) > 0);
  if (!plan) return null;
  return {
    kind: 'pass', id: PASS_PLAN, name: text(plan.title),
    price: '¥' + moneyFormat.decimalText(Number(plan.priceFen) / 100),
    url: MEMBERSHIP_URL
  };
}

function productPrice(p) {
  if (isNum(p.cashPrice) && Number(p.cashPrice) > 0) return '¥' + moneyFormat.decimalText(p.cashPrice);
  if (isNum(p.pointsPrice) && Number(p.pointsPrice) > 0) return Number(p.pointsPrice) + ' 积分';
  return '';
}

function coversOtherRoute(p, topicId) {
  const items = Array.isArray(p.items) ? p.items : [];
  return items.some((it) => it && isId(it.topicId) && String(it.topicId) !== String(topicId || ''));
}

function productOffer(rows, topicId) {
  const list = Array.isArray(rows) ? rows : [];
  for (const p of list) {
    if (!p || !isId(p.productId) || BUNDLE_KINDS.indexOf(Number(p.productKind)) < 0) continue;
    const name = text(p.productName);
    const price = productPrice(p);
    if (!name || !price || !coversOtherRoute(p, topicId)) continue;
    return { kind: 'product', id: String(p.productId), name, price, url: PRODUCT_URL + encodeURIComponent(String(p.productId)) };
  }
  return null;
}

/** @param {{pass?: object|null, products?: Array|null, topicId?: string}} facts 失败的请求传 null */
function finishOffer(facts) {
  const f = facts || {};
  // 通行证持有中:曲库里的路线已经都能玩,不再向他推城市包 / 通票(免得为已有的权益再付一次钱)
  if (f.pass && f.pass.holding && f.pass.holding.active === true) return null;
  return passOffer(f.pass) || productOffer(f.products, f.topicId) || null;
}

/** 埋点载荷(finish_offer_shown / finish_offer_click):只放卡种、商品 id 与主题 id,不放名称与价格。 */
function trackPayload(offer, topicId) {
  if (!offer) return null;
  const product = offer.kind === 'product';
  const properties = { offerKind: offer.kind };
  if (!product) properties.planCode = offer.id;
  if (isId(topicId)) properties.topicId = Number(topicId);
  return { bizType: product ? 'marketing_product' : 'platform_pass', bizId: product ? Number(offer.id) : null, properties };
}

module.exports = { finishOffer, passOffer, productOffer, trackPayload };
