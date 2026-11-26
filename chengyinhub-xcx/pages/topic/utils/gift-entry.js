'use strict';

/* R4 主题详情送礼入口:只认服务端 /api/marketing/product/list(已判在售)里覆盖本主题、可赠送的商品。
 * 可赠送 = giftAllowed === 1(加座 kind 8 除外),或礼品通行证 kind 7(只能赠送)。挑不出就返回 '',入口不出。 */

function isId(v) { return /^[1-9]\d{0,18}$/.test(String(v == null ? '' : v)); }

function giftProductId(rows, topicId) {
  if (!isId(topicId)) return '';
  const list = Array.isArray(rows) ? rows : [];
  for (const p of list) {
    if (!p || !isId(p.productId)) continue;
    const kind = Number(p.productKind);
    const giftable = kind === 7 || (Number(p.giftAllowed) === 1 && kind !== 8);
    const items = Array.isArray(p.items) ? p.items : [];
    if (giftable && items.some((it) => it && String(it.topicId) === String(topicId))) return String(p.productId);
  }
  return '';
}

module.exports = { giftProductId };
