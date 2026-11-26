// 权益表单底部「玩家看到的卡片」预览用的主题外观取色。
// 分包之间不能互相 require,这里放 pages/play/utils/look-colors.js 那张表的逐字副本(只取底色 bg / 墨色 ink / 主色 a);
// tests/unit/fe-perk-form-1122.test.js 钉住两份一致。主题没选过外观(老主题)时回落原型深色。
var LOOK_COLORS = {
  STARDUST: { DEFAULT: { a: '#E9E2D0', ink: '#F2F2F0', bg: '#0A0A0A' }, BLUE: { a: '#DCE8D2', ink: '#F2F4EF', bg: '#0E1914' }, RED: { a: '#FFB8AC', ink: '#FFF4F5', bg: '#2A0E12' }, YELLOW: { a: '#F2D58A', ink: '#FFFBEF', bg: '#2A2208' }, WHITE: { a: '#111318', ink: '#111318', bg: '#F5F6F8' } },
  PAPER: { DEFAULT: { a: '#D0503C', ink: '#ECE6D8', bg: '#1D1B18' }, BLUE: { a: '#E8C66A', ink: '#EEEBDF', bg: '#1A2620' }, RED: { a: '#E8C66A', ink: '#F4E6DC', bg: '#3A1A17' }, YELLOW: { a: '#A3281D', ink: '#2B241A', bg: '#E6DCC4' }, WHITE: { a: '#B0302A', ink: '#1E1C19', bg: '#F4F1EA' } },
  SURVIVAL: { DEFAULT: { a: '#FF8A3D', ink: '#E4E7E9', bg: '#0E1012' }, BLUE: { a: '#FFB35C', ink: '#EAF0E6', bg: '#111A14' }, RED: { a: '#7FE6C4', ink: '#F3E3E0', bg: '#1C0A0A' }, YELLOW: { a: '#8FD3FF', ink: '#FFF2DC', bg: '#2A1D0C' }, WHITE: { a: '#D4561E', ink: '#14202B', bg: '#E3E9EE' } },
  CYBER: { DEFAULT: { a: '#F3E600', ink: '#ECEBE4', bg: '#0B0B0F' }, BLUE: { a: '#2DE2E6', ink: '#E4F4EA', bg: '#06120D' }, RED: { a: '#FF2E4C', ink: '#FFE8EA', bg: '#12060A' }, YELLOW: { a: '#FCEE0A', ink: '#FFF6CC', bg: '#100E04' }, WHITE: { a: '#E0002B', ink: '#101216', bg: '#E6E7EA' } },
};
var LEGACY = { a: '#F1C94B', ink: '#F5F5F2', bg: '#1F1F21' };

/** lookJson = cms_topic.look_json(字符串或对象);读不懂 / 没配一律回落老主题的深色。 */
function colorsForLookJson(lookJson) {
  var look = lookJson;
  if (typeof lookJson === 'string') {
    try { look = lookJson ? JSON.parse(lookJson) : null; } catch (e) { look = null; }
  }
  if (!look || typeof look !== 'object' || !look.style) return LEGACY;
  var st = LOOK_COLORS[String(look.style).toUpperCase()];
  if (!st) return LEGACY;
  return st[String(look.palette || 'DEFAULT').toUpperCase()] || st.DEFAULT;
}

// 逐店卡是压在照片上的深色卡,字色用玩家端(深色)的语义色。表单在商家浅色域里、组件又是样式隔离的,
// 全局 .theme-dark 进不来,所以把卡片用到的三个玩家端 token(style/tokens.wxss page{} 的同名值)随外框行内给。
var PLAYER_CARD_TOKENS = '--cy-color-text-primary:#F8F8F8;--cy-color-text-secondary:#C7C7C7;--cy-color-bg-surface-strong:#3B3B3D;'; /* ds-ok: 玩家端深色卡的 token 值，注入到商家浅色页里的预览卡 */

/** 预览外框的行内样式:底色、标题墨色、主色描边都取主题外观。 */
function previewFrameStyle(lookJson) {
  var c = colorsForLookJson(lookJson);
  return 'background:' + c.bg + ';color:' + c.ink + ';border-color:' + c.a + ';' + PLAYER_CARD_TOKENS;
}

module.exports = { PLAYER_CARD_TOKENS: PLAYER_CARD_TOKENS, LOOK_COLORS: LOOK_COLORS, LEGACY: LEGACY, colorsForLookJson: colorsForLookJson, previewFrameStyle: previewFrameStyle };
