'use strict';
// cy-tag-sheet 的纯逻辑(图标表 + 排行 + 点选),组件与门店信息页共用,单测直接测。
// 图标表(owner 2026-10-22 · L11 Figma「Edit Interests」胶囊)。
//
// 图标放在本分包 images/tags/ 下(主包已过 3.00MB 棘轮,不进主包):
//   · Figma「Edit Interests」原样导出的 14 枚 + check(只把未选态 #777777 填色统一成 #131313,
//     未选态由组件用 opacity .58 还原成 #777);
//   · 其余是 Lucide(ISC,署名在「关于」页)的同风格线性图标,描边统一 #131313 / 1.6。
// SHIPPED 只列「文件真的已经入库」的名字:没入库的名字一律解析成空串,胶囊退回无图标排版,
// 不会去请求一张不存在的图;tests/unit/merchant-tag-sheet.test.js 会逐个核对文件存在。
const { tagIcon } = require('../../../../../utils/tag-library.js');
const ICON_DIR = '/pages/merchant/images/tags/';
const SHIPPED = [
  'check',
  // Figma
  'camera', 'game-handle', 'music', 'noodles', 'outdoor', 'parachute', 'platte',
  'ripple', 'sport', 'tennis', 'viencharts', 'voice', 'weixin-market',
  // Lucide
  'baby', 'bike', 'book-open', 'brush', 'coffee', 'croissant', 'cup-soda', 'dices', 'drama',
  'flower-2', 'footprints', 'frame', 'heart-pulse', 'landmark', 'moon', 'paw-print', 'scissors',
  'tent', 'wine',
];

/** 标签名 → 图标文件名(未映射返回 '')。与是否已入库无关,纯映射。 */
// L07-017(业主 11-24 默认 A):与个人主页/俱乐部页同一套规则(utils/tag-library),以后加关键词只改那一处
function tagIconName(label) {
  return tagIcon(label, 'merchant');
}

/** 图标文件名 → 可渲染的路径;未入库返回 ''。 */
function tagIconSrc(name) {
  return name && SHIPPED.indexOf(name) >= 0 ? ICON_DIR + name + '.svg' : '';
}

function normalize(items, selected) {
  const sel = (selected || []).map(String);
  return (Array.isArray(items) ? items : []).filter(it => it && it.key != null && it.key !== '').map(it => ({
    key: String(it.key),
    label: String(it.label == null ? it.key : it.label),
    iconSrc: tagIconSrc(it.icon),
    checked: sel.indexOf(String(it.key)) >= 0,
  }));
}

/** 胶囊估算宽度(rpx):左右内边距 + 图标 + 文字(中文按 26rpx/字,其余 15rpx)+ 勾位。只用来平衡行长。 */
function estimateWidth(tag) {
  let text = 0;
  for (const ch of tag.label) text += /[\u0000-ÿ]/.test(ch) ? 15 : 26;
  return 48 + (tag.iconSrc ? 44 : 0) + text + 17;
}

/**
 * items + 选中 key → 若干行(默认 3 行),每行左边对齐,整片横向自由滚动。
 * 按原顺序依次放进当前最短的一行,行长大致相等,顺序也大致保留。纯函数,单测直接测。
 */
function buildRows(items, selected, rows) {
  const n = Math.max(1, Number(rows) || 3);
  const list = normalize(items, selected);
  const out = Array.from({ length: Math.min(n, Math.max(1, list.length)) }, () => []);
  const width = out.map(() => 0);
  list.forEach(tag => {
    let at = 0;
    for (let i = 1; i < out.length; i += 1) if (width[i] < width[at]) at = i;
    out[at].push(tag);
    width[at] += estimateWidth(tag) + 16;
  });
  return list.length ? out : [];
}

/** 点选一次后的新选中数组;到上限返回 null(调用方弹 toast)。 */
function toggleValue(selected, key, max) {
  const sel = (selected || []).map(String);
  const k = String(key);
  const at = sel.indexOf(k);
  if (at >= 0) return sel.slice(0, at).concat(sel.slice(at + 1));
  if (max > 0 && sel.length >= max) return null;
  return sel.concat(k);
}

module.exports = { ICON_DIR, SHIPPED, tagIconName, tagIconSrc, buildRows, toggleValue, estimateWidth };
