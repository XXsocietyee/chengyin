'use strict';

// 个性化地图集中配置:所有 <map> 共用同一个 subkey,样式只靠 layer-style(该 key 下绑定样式的序号,从 1 起)区分。
// 仓库里永远空 key、四个序号为 0;上传前由 scripts/release-map-style.js 填进上传拷贝。
// 四套(owner 2026-11-04 定稿):black 漫游 / 附近 / 玩家搜索地图与星尘、末世、没设外观的主题;white 商家与编辑器;
// paper 纸本;cyber 即 2077,夜城。没填 key = 微信官方默认底图。背景、费用与接入步骤见 components/cy/free-map/DARK_MAP.md。
const MAP_STYLE = {
  subkey: '',
  black: 0,
  white: 0,
  paper: 0,
  cyber: 0,
};

const DEFAULT_STYLE = { subkey: '', layerStyle: 1 };
const KINDS = ['black', 'white', 'paper', '2077'];
const FIELD = { black: 'black', white: 'white', paper: 'paper', 2077: 'cyber' };

function configured(style) {
  const s = style || MAP_STYLE;
  return !!s.subkey;
}

/** kind: black / white / paper / 2077 → { subkey, layerStyle };没配 = 官方默认。 */
function mapStyleFor(kind, style) {
  const s = style || MAP_STYLE;
  const n = Number(s[FIELD[kind] || 'black']);
  if (!s.subkey || !Number.isInteger(n) || n < 1) return Object.assign({}, DEFAULT_STYLE);
  return { subkey: s.subkey, layerStyle: n };
}

/** 主题外观 → 样式:作者单独选了底图(look.map)就用它;否则纸本 paper,夜城 2077,其余 black。 */
function kindForLook(look) {
  const picked = look && !look.legacy ? validKind(look.map) : '';
  if (picked) return picked;
  const style = look && !look.legacy ? look.style : '';
  // 2026-11-22 owner「地图颜色和主题相近就行」:深色卡纸的纸本主题页面是深底,配黑底图
  if (style === 'PAPER' && String((look.params && look.params.paper) || '').toUpperCase() === 'CARD') return 'black';
  if (style === 'PAPER') return 'paper';
  if (style === 'CYBER') return '2077';
  return 'black';
}

// 2026-11-14 owner:自由图(漫游、附近)玩家可切四套底图,默认 black;选择用 wx 本地存储记住。
// layerStyle 是该 key 下的「绑定序号」(white 1 / black 2 / paper 3 / 2077 4),不是控制台 styleId;仓库里序号为 0,上传拷贝由 scripts/release-map-style.js 填。
const KIND_KEY = 'cy_map_kind';
const KIND_ITEMS = [
  { kind: 'white', label: '白' },
  { kind: 'black', label: '黑' },
  { kind: 'paper', label: '纸本' },
  { kind: '2077', label: '2077' },
];

function validKind(kind) { return KINDS.indexOf(String(kind)) >= 0 ? String(kind) : ''; }

/** 玩家在自由图上选的底图;没存过、读不到、读到不认识的值都回 black。 */
function freeMapKind(storage) {
  try {
    const store = storage || (typeof wx !== 'undefined' ? wx : null);
    return (store && validKind(store.getStorageSync(KIND_KEY))) || 'black';
  } catch (e) { return 'black'; }
}

/** 记住玩家的选择;存不上返回 false(本次仍然生效)。 */
function saveFreeMapKind(kind, storage) {
  const k = validKind(kind);
  if (!k) return false;
  try {
    const store = storage || (typeof wx !== 'undefined' ? wx : null);
    if (!store) return false;
    store.setStorageSync(KIND_KEY, k);
    return true;
  } catch (e) { return false; }
}

/** 主题发布时存的 look_json(字符串或对象)→ 底图;读不懂 = black。 */
function kindForLookJson(raw) {
  let look = raw;
  if (typeof raw === 'string') {
    try { look = raw.trim() ? JSON.parse(raw) : null; } catch (e) { look = null; }
  }
  if (!look || typeof look !== 'object') return 'black';
  return kindForLook({ style: String(look.style || '').toUpperCase(), map: look.map, params: look.params });
}

/** 主题 look_json → 主题配色(DEFAULT / BLUE / RED / YELLOW / WHITE);没设、读不懂 = ''。 */
function paletteForLookJson(raw) {
  let look = raw;
  if (typeof raw === 'string') {
    try { look = raw.trim() ? JSON.parse(raw) : null; } catch (e) { look = null; }
  }
  const p = look && typeof look === 'object' ? String(look.palette || '').toUpperCase() : '';
  return Object.prototype.hasOwnProperty.call(DARK_ACCENT, p) ? p : '';
}

/** 路线地图给谁看:编辑器 / 商家 / 创作者预览一律 white;玩家看主题发布时的外观。 */
function routeMapKind(lookRaw, preview) {
  return preview ? 'white' : kindForLookJson(lookRaw);
}

/** 叠加层按哪种底配色;没配 key 时返回 '',配色不变。 */
function mapToneFor(kind, style) {
  return configured(style) && mapStyleFor(kind, style).subkey ? kind : '';
}

// 浅底上白线白圈看不见:换墨色、浅描边;队色线只加深描边。
const LIGHT_TONES = {
  white: { core: '#1F1F1FF2', glow: '#1F1F1F2E', edge: '#FFFFFFCC', team: '#0000008C',
    fill: 'rgba(31,31,31,.10)', ring: 'rgba(31,31,31,.42)', targetFill: 'rgba(31,31,31,.14)', targetRing: 'rgba(31,31,31,.6)' },
  paper: { core: '#3B2A1CF2', glow: '#3B2A1C2E', edge: '#F3EAD8CC', team: '#2A1A0E8C',
    fill: 'rgba(59,42,28,.10)', ring: 'rgba(59,42,28,.42)', targetFill: 'rgba(59,42,28,.14)', targetRing: 'rgba(59,42,28,.6)' },
};

// 2026-11-22 owner:路线、站点光圈、目标光晕跟主题配色。深底用亮色,浅底用读得清的深色;
// 白 / 默认(null)= 沿用原来的白线或墨色,输出与不传配色完全相同。队色线不动。
const DARK_ACCENT = { DEFAULT: null, WHITE: null, RED: '#FF5A4E', BLUE: '#5AC8FA', YELLOW: '#FFD60A' };
const LIGHT_ACCENT = { DEFAULT: null, WHITE: null, RED: '#B3261E', BLUE: '#0B57D0', YELLOW: '#8A6100' };

/** 配色在这种底上的强调色(#RRGGBB);没设配色、白 / 默认 = ''(照旧)。 */
function paletteAccent(palette, tone) {
  const table = LIGHT_TONES[tone] ? LIGHT_ACCENT : DARK_ACCENT;
  return table[String(palette || '').toUpperCase()] || '';
}
function hexByte(a) { return ('0' + Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16)).slice(-2).toUpperCase(); }
function rgbaOf(hex, a) {
  const n = parseInt(hex.slice(1, 7), 16);
  return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')';
}
// 路线中性色(白线 / 墨线):有配色时换成强调色;饱和的队色不算
function isInk(color) {
  return /^#(1[0-9A-F]){3}([0-9A-F]{2})?$/i.test(String(color || ''));
}

function isWhitish(color) {
  const c = String(color || '').toUpperCase();
  return /^#(F[0-9A-F]){3}/.test(c) || /^RGBA?\(\s*2[3-5]\d\s*,\s*2[3-5]\d\s*,\s*2[3-5]\d/.test(c);
}
function alphaOf(color) {
  const c = String(color || '');
  if (/^#[0-9A-Fa-f]{8}$/.test(c)) return parseInt(c.slice(7), 16) / 255;
  const m = c.match(/^rgba\([^)]*,\s*([\d.]+)\s*\)$/i);
  return m ? Number(m[1]) : 1;
}

/** polyline 按底配色;深底与默认底原样返回。palette:主题配色,白线 / 墨线换成该配色的强调色(透明度、宽度、描边结构不变)。 */
function toneLines(lines, tone, palette) {
  const t = LIGHT_TONES[tone], accent = paletteAccent(palette, tone);
  if ((!t && !accent) || !Array.isArray(lines)) return lines;
  return lines.map((line) => {
    if (!line || typeof line !== 'object') return line;
    if (accent && (isWhitish(line.color) || isInk(line.color))) {
      const a = alphaOf(line.color), out = Object.assign({}, line);
      // 浅底沿用墨色的两档透明度(实线 F2 / 光晕 2E);深底保留原线自己的透明度
      out.color = t ? accent + (a < 0.5 ? '2E' : 'F2') : accent + (a < 1 ? hexByte(a) : '');
      if (t && line.borderWidth && isWhitish(line.color)) out.borderColor = t.edge;
      return out;
    }
    if (!t) return line;
    if (isWhitish(line.color)) {
      const out = Object.assign({}, line, { color: alphaOf(line.color) < 0.5 ? t.glow : t.core });
      if (line.borderWidth) out.borderColor = t.edge;
      return out;
    }
    return line.borderWidth ? Object.assign({}, line, { borderColor: t.team }) : line;
  });
}

/** 节点光圈 / 目标光晕:kind = candidate | target。palette:主题配色,光圈换成强调色,透明度同原来。 */
function toneCircle(kind, tone, palette) {
  const t = LIGHT_TONES[tone], accent = paletteAccent(palette, tone);
  if (accent) {
    const a = t ? (kind === 'target' ? [0.14, 0.6] : [0.10, 0.42]) : (kind === 'target' ? [0.22, 0.55] : [0.16, 0.4]);
    return { fillColor: rgbaOf(accent, a[0]), color: rgbaOf(accent, a[1]) };
  }
  if (kind === 'target') return t ? { fillColor: t.targetFill, color: t.targetRing } : { fillColor: 'rgba(255,255,255,.22)', color: 'rgba(255,255,255,.55)' };
  return t ? { fillColor: t.fill, color: t.ring } : { fillColor: 'rgba(255,255,255,.16)', color: 'rgba(255,255,255,.4)' };
}

/** 主题详情 / 广场的路线图:有主题配色时把墨线换成强调色;预览(white)、没设配色、白 / 默认 = 原样返回。 */
function routeMapLines(lines, lookRaw, preview) {
  const palette = preview ? '' : paletteForLookJson(lookRaw);
  const kind = routeMapKind(lookRaw, preview);
  const tone = mapToneFor(kind);
  if (paletteAccent(palette, tone)) return toneLines(lines, tone, palette);
  // 主题详情 / 广场的路线线是墨色(按浅底画的);玩家看深底(black / 2077)且没有强调色时换成白线,不然墨线压在黑底上
  let styled = false;
  try { const look = typeof lookRaw === 'string' ? (lookRaw.trim() ? JSON.parse(lookRaw) : null) : lookRaw; styled = !!(look && typeof look === 'object' && look.style); } catch (e) { styled = false; }
  if (preview || !styled || (kind !== 'black' && kind !== '2077') || !Array.isArray(lines)) return lines;
  return lines.map((line) => {
    if (!line || typeof line !== 'object' || !isInk(line.color)) return line;
    const a = alphaOf(line.color);
    return Object.assign({}, line, { color: '#FFFFFF' + (a < 1 ? hexByte(a) : ''), borderColor: line.borderColor ? '#00000055' : line.borderColor }); /* ds-ok: 深底路线白线与暗描边,与 play 页白线同色 */
  });
}

// 试做,默认关:漫游 16 级以上显示 3D 楼块并俯仰约 30°。
const ROAM_3D = { on: false, minScale: 16, skew: 30 };

function roam3dFor(scale, cfg) {
  const c = cfg || ROAM_3D;
  return !!c.on && Number(scale) >= c.minScale;
}

/** 玩家地图:black。 */
function playerMapStyle(style) { return mapStyleFor('black', style); }

/** 商家 / 编辑器地图:white。 */
function lightMapStyle(style) { return mapStyleFor('white', style); }

module.exports = { MAP_STYLE, ROAM_3D, roam3dFor, KINDS, KIND_ITEMS, KIND_KEY, freeMapKind, saveFreeMapKind, kindForLookJson, paletteForLookJson, routeMapKind, routeMapLines, paletteAccent, DARK_ACCENT, LIGHT_ACCENT, configured, mapStyleFor, kindForLook, mapToneFor, toneLines, toneCircle, playerMapStyle, lightMapStyle };
