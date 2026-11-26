'use strict';
const DOT_SCALE = 14;
const PIN_SIZE = 40;
const PIN_SIZE_NEAR = 46;
const PIN_SIZE_FOCUS = 60;
const EDGE_SIZE = 26;
const DEMOTED_SIZE = 10;
const EDGE_INSET = 0.06;
const NEAR_SPAN = 0.6;
const MAX_PHOTO_PINS = 40;
const COUNT_MIN = 10;

function pinPhoto(p, placeholder) {
  const url = p && (p.photo || '');
  if (!url || (placeholder && url === placeholder)) return '';
  return String(url);
}

function isParticipating(p) {
  if (!p || p.demo) return false;
  if (p.cat === 'merchant' && (p.regId || p.nodeId)) return true;
  return !!(p.isCityNode && p.merchantId);
}

function regionBox(region) {
  const sw = region && region.southwest;
  const ne = region && region.northeast;
  if (!sw || !ne) return null;
  const s = Number(sw.latitude), w = Number(sw.longitude), n = Number(ne.latitude), e = Number(ne.longitude);
  if (![s, w, n, e].every(Number.isFinite) || n <= s || e <= w) return null;
  return { s, w, n, e, h: n - s, wd: e - w };
}

/* 第十二轮 k7(j4 N2):贴边图钉只收进「看得见的那块地图」——搜索栏下沿到底部卡片上沿之间,
   左右至少留半枚图钉加一道缝。safe = { top, bottom, width, height }(px,bottom 为底部被挡住的高度);
   不给时退回原来的四边 6%。 */
const EDGE_SIDE_PX = 24;
function safeInsets(safe) {
  const h = Number(safe && safe.height), w = Number(safe && safe.width);
  if (!(h > 0) || !(w > 0)) return { top: EDGE_INSET, bottom: EDGE_INSET, side: EDGE_INSET };
  const top = Math.max(EDGE_INSET, (Number(safe.top) || 0) / h + EDGE_SIZE / 2 / h);
  const bottom = Math.max(EDGE_INSET, (Number(safe.bottom) || 0) / h + EDGE_SIZE / 2 / h);
  const side = Math.max(EDGE_INSET, EDGE_SIDE_PX / w);
  if (top + bottom >= 0.9) return { top: EDGE_INSET, bottom: EDGE_INSET, side };
  return { top, bottom, side };
}

function placeInView(lat, lng, region, safe) {
  const b = regionBox(region);
  if (!b) return { kind: 'in', lat, lng };
  if (lat >= b.s && lat <= b.n && lng >= b.w && lng <= b.e) return { kind: 'in', lat, lng };
  const padLat = b.h * NEAR_SPAN, padLng = b.wd * NEAR_SPAN;
  if (lat < b.s - padLat || lat > b.n + padLat || lng < b.w - padLng || lng > b.e + padLng) return { kind: 'far' };
  const ins = safeInsets(safe);
  return {
    kind: 'edge',
    lat: Math.min(b.n - b.h * ins.top, Math.max(b.s + b.h * ins.bottom, lat)),
    lng: Math.min(b.e - b.wd * ins.side, Math.max(b.w + b.wd * ins.side, lng)),
  };
}

function densityMode(scale) {
  return Number(scale) > 0 && Number(scale) <= DOT_SCALE ? 'dots' : 'pins';
}

// 经纬度 → 屏幕 px(视口内线性近似,够做图钉避让)
function toScreen(lat, lng, region, viewport) {
  const b = regionBox(region);
  if (!b) return null;
  const w = Number(viewport && viewport.width) || 390, h = Number(viewport && viewport.height) || 844;
  return { x: (lng - b.w) / b.wd * w, y: (b.n - lat) / b.h * h };
}

// 第九轮 m2 补充第 2 项:任意缩放下图钉互不重叠。
// 按相关度从高到低放:选中的 > 演示点 > 参与商铺 > 有照片 > 离视野中心近(L05-059:注释照权重改正);和已放下的任何一枚(照片、形象、深色圆都算)
// 圆心距小于两者半径之和加间隙的,降成小圆点,拉近后自然会放出来。带店名贴纸的按更大的占位算。
const PIN_GAP = 6;
const LABEL_EXTRA = 14;
function footprint(c) {
  return (Number(c.size) || PIN_SIZE) / 2 + (c.label ? LABEL_EXTRA : 0);
}
function relevance(c) {
  return (c.focused ? 1e6 : 0) + (c.demo ? 5e5 : 0) + (c.participating ? 1e5 : 0) + (c.photo ? 1e4 : 0) - (Number(c.d) || 0);
}
/** 返回放得下的候选(按相关度排好);没放下的由调用方降成小圆点 */
function layoutPins(cands, region, viewport, obstacles) {
  const sorted = (cands || []).slice().sort((a, b) => relevance(b) - relevance(a));
  if (!regionBox(region)) return sorted;
  const placed = [];
  // 固定占位(玩家自己的点):先放进去,任何图钉都不压它(rig 走查:店名贴纸压在蓝点上)
  (obstacles || []).forEach((o) => {
    const s0 = o && toScreen(o.lat, o.lng, region, viewport);
    if (s0) placed.push({ x: s0.x, y: s0.y, r: (Number(o.size) || 40) / 2 });
  });
  const kept = [];
  sorted.forEach((c) => {
    const s = toScreen(c.lat, c.lng, region, viewport);
    if (!s) { kept.push(c); return; }
    const r = footprint(c);
    const hit = placed.some((q) => {
      const min = q.r + r + PIN_GAP;
      return (q.x - s.x) * (q.x - s.x) + (q.y - s.y) * (q.y - s.y) < min * min;
    });
    if (hit) return;
    placed.push({ x: s.x, y: s.y, r });
    kept.push(c);
  });
  return kept;
}

function nearbyCountLabel(n) {
  const count = Number(n) || 0;
  return count >= COUNT_MIN ? '附近 ' + count + ' 个地点' : '';
}

function markerSignature(markers, pins) {
  const parts = [];
  (markers || []).forEach((m) => {
    parts.push(m.id + ',' + Number(m.latitude).toFixed(6) + ',' + Number(m.longitude).toFixed(6) + ','
      + m.width + ',' + (m.iconPath || '') + ',' + (m.rotate || 0) + ',' + (m.callout ? m.callout.content : '')
      + ',' + (m.customCallout ? m.customCallout.anchorY : ''));
  });
  (pins || []).forEach((p) => parts.push('p' + p.id + ',' + p.img + ',' + p.label + ',' + p.size + ',' + (p.edge ? 1 : 0) + ',' + (p.on ? 1 : 0)));
  return parts.join('|');
}

// L05-059:toScreen / footprint / PIN_GAP 只为单测核对「互不重叠」保留导出;bucketDots / declutter / heatLevel 无人调用已删
module.exports = {
  DOT_SCALE, PIN_SIZE, PIN_SIZE_NEAR, PIN_SIZE_FOCUS, EDGE_SIZE, DEMOTED_SIZE, MAX_PHOTO_PINS,
  pinPhoto, isParticipating, placeInView, safeInsets, densityMode, nearbyCountLabel, markerSignature, regionBox, toScreen,
  layoutPins, footprint, PIN_GAP,
};
