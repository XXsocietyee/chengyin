'use strict';
// §3.2 第 1 站免费试玩 → 第 2 站剧内解锁 + 自玩双人 3 秒视角选择（纯函数，可单测）。
const { duoRoleOptions } = require('./role-card-view.js');

function formatYuan(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return '';
  if (num === 0) return '免费';
  const fixed = Math.round(num * 100) / 100;
  return '¥' + (Number.isInteger(fixed) ? String(fixed) : fixed.toFixed(2).replace(/0$/, ''));
}

/** 判定当前节点是否因试玩态被锁在第 2 站及之后。 */
function isTrialBlockedNode(node, state) {
  if (!node || !state || state.trialMode !== true) return false;
  if (node.trialLocked === true) return true;
  if (node.trialStation === true) return false;
  const firstId = state.trialStationId;
  if (firstId != null && String(firstId) !== '' && node.nodeId != null) {
    return String(node.nodeId) !== String(firstId);
  }
  return false;
}

function productCoversTopic(product, topicId) {
  if (!product || typeof product !== 'object') return false;
  const tid = String(topicId || '');
  if (!tid) return false;
  if (product.topicId != null && String(product.topicId) === tid) return true;
  const ids = Array.isArray(product.topicIds) ? product.topicIds
    : (Array.isArray(product.eligibleTopicIds) ? product.eligibleTopicIds : []);
  return ids.some((id) => String(id) === tid);
}

/** 从自玩单人价 + 营销多席位商品构造剧内解锁底单选项（支持单人票 + 双人/多人同行票）。 */
function buildTrialUnlockOptions(input) {
  const cfg = input || {};
  const opts = [];
  const singlePrice = cfg.selfPlayPrice != null && cfg.selfPlayPrice !== '' ? Number(cfg.selfPlayPrice) : null;
  opts.push({
    key: 'single',
    kind: 'single',
    name: '单人自玩票',
    sub: '立即解锁完整路线，90 天内随时续玩',
    seats: 1,
    productId: null,
    price: Number.isFinite(singlePrice) ? singlePrice : null,
    priceText: Number.isFinite(singlePrice) ? formatYuan(singlePrice) : '',
    perPersonText: '',
  });
  const list = Array.isArray(cfg.products) ? cfg.products : [];
  const multiSeats = list
    .filter((p) => p && Number(p.seatCount) >= 2 && productCoversTopic(p, cfg.topicId))
    .sort((a, b) => Number(a.seatCount) - Number(b.seatCount));
  const duo = multiSeats.find((p) => Number(p.seatCount) === 2) || multiSeats[0];
  if (duo) {
    const seats = Number(duo.seatCount) || 2;
    const rawPrice = duo.cashPrice != null ? duo.cashPrice : (duo.price != null ? duo.price : duo.salePrice);
    const price = rawPrice != null && rawPrice !== '' ? Number(rawPrice) : null;
    opts.push({
      key: 'duo',
      kind: 'product',
      name: seats === 2 ? '双人同行票' : (seats + '人同行票'),
      sub: seats === 2 ? '含 2 个席位，支持双人 A/B 视角协作' : ('含 ' + seats + ' 个席位，支持多人视角协作'),
      seats,
      productId: Number(duo.productId || duo.id) || null,
      price: Number.isFinite(price) ? price : null,
      priceText: Number.isFinite(price) ? formatYuan(price) : '',
      perPersonText: Number.isFinite(price) && price > 0 ? ('人均 ' + formatYuan(price / seats)) : '',
    });
  }
  return opts;
}

function duoRoleStorageKey(memberId, topicId, runKey) {
  return 'play_duo_role_v1_' + String(memberId || 'anon') + '_' + String(topicId || 0) + '_' + String(runKey || '0');
}

function buildDuoPickerOptions(roleView) {
  const roles = duoRoleOptions(roleView);
  if (roles.length < 2) return [];
  return roles.map((r) => ({
    id: r.id,
    label: r.label,
    desc: r.title || ('仅看「' + r.label + '」专属线索'),
  }));
}

module.exports = {
  formatYuan,
  isTrialBlockedNode,
  buildTrialUnlockOptions,
  duoRoleStorageKey,
  buildDuoPickerOptions,
};
