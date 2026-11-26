// 外观主色的 JS 镜像(l-icons 2026-11-11):章节门画布画圆点章节号 / 章节印要用外观主色 --lk-a 与墨色 --lk-ink,
// 画布读不到 CSS 变量,所以把 pages/play/look-tokens.wxss 里四种外观 × 五种配色的 a / ink / bg 逐字抄成一份。
// tests/unit/l-icons-20261111.test.js 从 wxss 重新解析并与这里逐项比对,改 wxss 必须同步改这里。
var LOOK_COLORS = {
  STARDUST: { DEFAULT: { a: '#E9E2D0', ink: '#F2F2F0', bg: '#0A0A0A' }, BLUE: { a: '#DCE8D2', ink: '#F2F4EF', bg: '#0E1914' }, RED: { a: '#FFB8AC', ink: '#FFF4F5', bg: '#2A0E12' }, YELLOW: { a: '#F2D58A', ink: '#FFFBEF', bg: '#2A2208' }, WHITE: { a: '#111318', ink: '#111318', bg: '#F5F6F8' } },
  PAPER: { DEFAULT: { a: '#D0503C', ink: '#ECE6D8', bg: '#1D1B18' }, BLUE: { a: '#E8C66A', ink: '#EEEBDF', bg: '#1A2620' }, RED: { a: '#E8C66A', ink: '#F4E6DC', bg: '#3A1A17' }, YELLOW: { a: '#A3281D', ink: '#2B241A', bg: '#E6DCC4' }, WHITE: { a: '#B0302A', ink: '#1E1C19', bg: '#F4F1EA' } },
  SURVIVAL: { DEFAULT: { a: '#FF8A3D', ink: '#E4E7E9', bg: '#0E1012' }, BLUE: { a: '#FFB35C', ink: '#EAF0E6', bg: '#111A14' }, RED: { a: '#7FE6C4', ink: '#F3E3E0', bg: '#1C0A0A' }, YELLOW: { a: '#8FD3FF', ink: '#FFF2DC', bg: '#2A1D0C' }, WHITE: { a: '#D4561E', ink: '#14202B', bg: '#E3E9EE' } },
  CYBER: { DEFAULT: { a: '#F3E600', ink: '#ECEBE4', bg: '#0B0B0F' }, BLUE: { a: '#2DE2E6', ink: '#E4F4EA', bg: '#06120D' }, RED: { a: '#FF2E4C', ink: '#FFE8EA', bg: '#12060A' }, YELLOW: { a: '#FCEE0A', ink: '#FFF6CC', bg: '#100E04' }, WHITE: { a: '#E0002B', ink: '#101216', bg: '#E6E7EA' } },
};
// 老主题(没选过外观)的章节门:回落原型深色(chapter-flip/index.wxss .cf 的 #1F1F21 / #F5F5F2),主色用原来的金
var LEGACY = { a: '#F1C94B', ink: '#F5F5F2', bg: '#1F1F21' };

/** look = { style, palette, legacy } (theme-look.normalizeLook 的产物);palette 没设或读不懂按 DEFAULT。 */
function colorsFor(look) {
  if (!look || look.legacy || !look.style) return LEGACY;
  var st = LOOK_COLORS[String(look.style).toUpperCase()];
  if (!st) return LEGACY;
  return st[String(look.palette || 'DEFAULT').toUpperCase()] || st.DEFAULT;
}

/** 相对亮度(WCAG):'#RRGGBB' -> 0..1。 */
function luminance(hex) {
  var n = parseInt(String(hex || '').replace('#', ''), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].reduce(function (sum, v, i) {
    v /= 255; v = v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    return sum + v * [0.2126, 0.7152, 0.0722][i];
  }, 0);
}
/** 外观 × 配色的底是不是浅底(状态栏 / 胶囊要换黑字)。按底色亮度判,不另列名单:现在是各风格的白,加上纸本 × 黄(牛皮纸)。
 *  palette 传主题配色;主题没设配色时传章节配色(故事流铺的就是它)。老主题(legacy)没有外观底色,一律 false。 */
function isLight(look, palette) {
  if (!look || look.legacy || !look.style) return false;
  return luminance(colorsFor({ style: look.style, palette: palette || look.palette }).bg) > 0.5;
}
/** 玩家页此刻最上面那层整屏面是不是浅底 —— 状态栏前景色只从这里取(2026-11-22 业主:浅底上白字看不见)。
 *  s = { look, chapterPreset, intro, ending, finish, stats, boot, album, gate, held, story, chapterFull }
 *  开场页 / 本局完成 / 完成页 / 初始状态 / 开机 / 等待放行都是深底;相册、章节门取外观底;故事流取主题配色(没设取章节配色)。 */
function statusBarLight(s) {
  s = s || {};
  var look = s.look || null, preset = String(s.chapterPreset || '').toUpperCase();
  if (s.intro || s.ending || s.finish || s.stats || s.boot) return false;
  if (s.album) return isLight(look);
  if (s.gate) return !s.held && isLight(look);
  if (!s.story) return false;
  // 老主题(没配风格):只有章节故事流铺本章配色,白底才换;自由探索 fx-story 仍是纯黑底
  if (!look || look.legacy) return !!s.chapterFull && preset === 'WHITE';
  return isLight(look, look.palette || preset);
}

module.exports = { LOOK_COLORS: LOOK_COLORS, LEGACY: LEGACY, colorsFor: colorsFor, luminance: luminance, isLight: isLight, statusBarLight: statusBarLight };
