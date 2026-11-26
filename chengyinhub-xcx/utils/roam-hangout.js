'use strict';
// 漫游·附近的局:页面之外的纯函数(marker 构造 / 空态文案 / 表单校验),便于单测钉住。
// 契约:无坐标不画点(与 searchmap.createMarkersFromActivities 同一条铁律)。
// marker id 必须是数字(微信 <map> 契约):局 = id*10+1,活动 = id*10+2,主题 = id*10+3,三类不撞号。

// 城市定向只在独立主题入口展示；旧主题缺少玩法类型时也不进入探店地图。
function isMapItem(it) {
  return !!it && (it.kind === 'activity' || (it.kind === 'topic' && Number(it.productType) === 2));
}

const HANGOUT_FALLBACK_ICON = '/images/d_smapicon.png';

function numOrNull(v) {
  // Number(null) / Number('') 都是 0,会把「没坐标」画到几内亚湾 —— 空值先拦
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const { NEAR_M, markerSpec, iconKey, whenParts } = require('./roam-hangout-marker.js');
const { MAP_AVATAR_COLORS: C } = require('./play-visual-tokens.js');
const { readFontScale, mapFontSize } = require('./font-scale.js');

/**
 * items 来自 GET /api/roam/hangout/nearby;icons = 已生成的 tempFilePath 表({key: path});farIcons = {color: path}。
 * LOD:distance ≤ NEAR_M 且有头像图 → 54px 头像 marker + 名牌;否则远距点(14px,无文字)。
 * 没生成出图的一律先用远距点,一个点位都不少。
 */
function buildHangoutMarkers(items, icons, farIcons) {
  const ic = icons || {}; const far = farIcons || {};
  const out = [];
  const fontScale = readFontScale();
  (items || []).forEach((it) => {
    if (!it) return;
    const lat = numOrNull(it.latitude);
    const lng = numOrNull(it.longitude);
    if (lat == null || lng == null) return;
    const isHangout = it.kind === 'hangout';
    const isTopic = it.kind === 'topic';
    const spec = markerSpec(it);
    const near = numOrNull(it.distance) != null && Number(it.distance) <= NEAR_M;
    const key = iconKey(spec, spec.initial);
    const nearIcon = near && ic[key];
    const m = {
      id: Number(it.id) * 10 + (isHangout ? 1 : isTopic ? 3 : 2),
      latitude: lat, longitude: lng,
      width: nearIcon ? 54 : 14, height: nearIcon ? 54 : 14,
      anchor: { x: 0.5, y: 0.5 },
      zIndex: spec.state === 'joined' ? 12 : isHangout ? 10 : 5,
      iconPath: nearIcon || far[spec.color] || HANGOUT_FALLBACK_ICON,
    };
    if (nearIcon) {
      // 名牌按身份换色(Figma marker set):个人局深底奶油字写标题;商家局金底写「商家局 · N 人」;限时活动粉底写倒计时
      const plate = spec.role === 'merchant' && isHangout
        ? { content: '商家局 · ' + (Number(it.memberCount) || 0) + ' 人', color: C.panel, bgColor: C.merchant }
        : spec.role === 'event'
          ? { content: spec.badge || String(it.name || ''), color: C.cream, bgColor: C.event }
          : { content: isHangout ? String(it.title || '') : String(it.name || ''), color: C.cream, bgColor: C.panel + 'E6' };
      m.callout = Object.assign({ fontSize: mapFontSize(11, fontScale), borderRadius: 10, padding: 6, display: 'ALWAYS' }, plate);
    }
    out.push(m);
  });
  return out;
}

const SELF_MARKER_ID = 9;   // 末位 9:parseMarkerId 不认,点它不弹卡

/** 「我」的 marker(Figma S01:青环头像,位于定位点)。icon 没生成时不画,别用别的图冒充自己 */
function buildSelfMarker(center, icon) {
  if (!center || !icon) return [];
  const lat = numOrNull(center.lat); const lng = numOrNull(center.lng);
  if (lat == null || lng == null) return [];
  return [{ id: SELF_MARKER_ID, latitude: lat, longitude: lng, width: 64, height: 64, anchor: { x: 0.5, y: 0.94 }, zIndex: 20, iconPath: icon }]; // 2026-10-28 头像定位针:尖角对准自己的位置
}

/** marker id → {kind,id};非本页 marker 返回 null。 */
function parseMarkerId(markerId) {
  const n = Number(markerId);
  if (!Number.isFinite(n) || n <= 0) return null;
  const tag = n % 10;
  const id = Math.floor(n / 10);
  if (tag === 1) return { kind: 'hangout', id };
  if (tag === 2) return { kind: 'activity', id };
  if (tag === 3) return { kind: 'topic', id };
  return null;
}

function fmtKm(m) {
  const n = numOrNull(m);
  if (n == null) return '';
  return n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'km' : Math.round(n) + 'm';
}

module.exports = {
  isMapItem, buildHangoutMarkers, buildSelfMarker,  SELF_MARKER_ID, whenParts, parseMarkerId,   fmtKm, numOrNull,
  HANGOUT_FALLBACK_ICON,   
};
