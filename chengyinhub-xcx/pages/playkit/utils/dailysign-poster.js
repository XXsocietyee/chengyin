// pages/playkit/utils/dailysign-poster.js —— 每日一签「保存到相册」的票面版式(纯函数,不依赖 Component)
// L02-156:原先半个 playkit-dailysign/index.js 都是这套;组件 require 它,版式测试也可以直接 require 它。

/* ── 保存到相册:票面在 canvas 上复刻一张 ──
 * canvas 读不到 CSS 变量,所以色值只能照 pages/play 的 PLAY_STORY_CARD 先例逐字抄一张表。
 * 每个值都能在本文件对应的 wxss 选择器上找到同一个数(契约测试逐条钉住:wxss 改了没同步这里就判红)。
 * 1 画布单位 = 1rpx —— 尺寸与 index.wxss 同一把尺,保存下来的才是刚才看到的那张纸。 */
const DAILY_SIGN_CARD = Object.freeze({
  deskTop: '#050505', deskMid: '#050505', deskBottom: '#050505',   /* .ds__bg 的深色台面,同 play-page */
  paper: '#FFFFFF',      /* .ds__slip 热敏纸 */
  ink: '#17191C',        /* .ds__slip 的热敏字 / .ds__bar 条码 */
  ink2: '#5B6169',       /* .ds__d / .ds__sm 次级墨 */
  faint: '#8A9099',      /* .ds__k 淡墨 */
  rule: '#D7DAE0',       /* .ds__hr 热敏纸上的虚线 */
  poemBg: '#F5F6F8',     /* .ds__scratch 签文那块淡底 */
  shadow: 'rgba(20,22,26,.28)',
});

/* 版式数字,右侧注释是它来自 wxss 的哪一条 */
const SLIP = Object.freeze({
  W: 750, DPR: 2,                      /* 画布逻辑宽 = 设计宽;出图倍率同完赛卡 */
  DESK_Y: 64, DESK_BOTTOM: 64,         /* 纸浮在台面上,上下各留一点 */
  PAPER_X: 92, PAPER_W: 566,           /* .ds__slip 屏上实宽:750 − 页面 32×2 − 窗口 44×2 − 内衬 16×2 */
  PAD_X: 28, PAD_TOP: 20, PAD_BOTTOM: 14,   /* .ds__slip padding: 20rpx 28rpx 14rpx */
  TOOTH: 12, PERIOD: 24,               /* .ds__slip::after / ::before 的撕口锯齿 */
  GAP: 16,                             /* .ds__od / .ds__grid 的 gap */
  HR: 26, DASH: 6,                     /* .ds__hr:上下 12 + 2 线;虚线一段长 */
  HEAD_H: 40,                          /* .ds__row */
  MICRO_H: 28, CAP_H: 30, ADDR_H: 36, BIG_H: 48, GRID_H: 38,  /* .ds__k / .ds__sm / .ds__addr / .ds__big / .ds__v 的行高 */
  PHOTO_H: 200, PHOTO_R: 6, PHOTO_CAP_GAP: 8,   /* .ds__photo: height 200 radius 6;.ds__photo-k margin-top 8 */
  POEM_LH: 50, POEM_PAD_X: 18, POEM_PAD_T: 12, POEM_PAD_B: 10, POEM_R: 16, POEM_GAP: 12,  /* .ds__poem line-height 1.8 / .ds__poemwrap margin-top */
  BAR_H: 36, BAR_T: 2, BAR_W_PCT: 0.82,  /* .ds__barcode height 36 / margin-top 2 / width 82% */
});

const F_UI = '-apple-system, "PingFang SC", "Helvetica Neue", sans-serif';        /* = 屏上默认字体 */
const F_NUM = '"SF Mono", "DIN Alternate", ui-monospace, Menlo, Consolas, monospace';  /* = --cy-font-numeric */
const F_SERIF = '"Noto Serif SC", "Songti SC", serif';                            /* = .ds__poem */
const fnt = (weight, size, family) => weight + ' ' + size + 'px ' + family;
const FONT = Object.freeze({
  title: fnt(600, 28, F_UI),        /* .ds__t */
  date: fnt(400, 24, F_NUM),        /* .ds__d */
  k: fnt(400, 20, F_UI),            /* .ds__k */
  addr: fnt(700, 28, F_UI),         /* .ds__addr */
  big: fnt(700, 44, F_UI),          /* .ds__big */
  sm: fnt(400, 22, F_NUM),          /* .ds__sm */
  v: fnt(600, 28, F_UI),            /* .ds__v */
  poem: fnt(600, 28, F_SERIF),      /* .ds__poem */
});

/* ── 票面 → 画布版式(纯函数,与 Component 解耦) ── */

/** 按可用宽折行。**逐字符填**,join('') 与原文一字不差(地址被折掉一个字就是错地址),
 *  与 wxss 的 word-break: break-all 同一语义。lines 由服务端断好行,这里只在超出票面时才折。 */
function wrapText(text, maxW, font, measure) {
  const s = text == null ? '' : String(text);
  if (!s.trim()) return [];
  if (!(maxW > 0)) return [s];
  const out = [];
  let line = '';
  for (const ch of s) {
    if (line && measure(line + ch, font) > maxW) { out.push(line); line = ch; }
    else line += ch;
  }
  if (line) out.push(line);
  return out;
}

/** 纸:左右直边 + 上下撕口锯齿(同 .ds__slip::after / .is-torn ::before 那两排三角) */
function signPaperPath(g, p) {
  const tooth = p.tooth; const period = p.period;
  const bottom = p.y + p.h - tooth;
  g.beginPath();
  g.moveTo(p.x, p.y + tooth);
  for (let x = p.x; x < p.x + p.w - 0.5; x += period) {
    g.lineTo(Math.min(x + period / 2, p.x + p.w), p.y);
    g.lineTo(Math.min(x + period, p.x + p.w), p.y + tooth);
  }
  g.lineTo(p.x + p.w, bottom);
  for (let x = p.x + p.w; x > p.x + 0.5; x -= period) {
    g.lineTo(Math.max(x - period / 2, p.x), p.y + p.h);
    g.lineTo(Math.max(x - period, p.x), bottom);
  }
  g.closePath();
}

/** 圆角矩形路径。热敏纸上的照片只切一点角(.ds__photo radius 6),别吃圆角档位 */
function signRoundRect(g, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  g.beginPath();
  g.moveTo(x + rr, y);
  g.lineTo(x + w - rr, y);
  g.arcTo(x + w, y, x + w, y + rr, rr);
  g.lineTo(x + w, y + h - rr);
  g.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  g.lineTo(x + rr, y + h);
  g.arcTo(x, y + h, x, y + h - rr, rr);
  g.lineTo(x, y + rr);
  g.arcTo(x, y, x + rr, y, rr);
  g.closePath();
}

const CONTENT_X = SLIP.PAPER_X + SLIP.PAD_X;    // 120:.ds__slip 的左内衬之内
const CONTENT_W = SLIP.PAPER_W - SLIP.PAD_X * 2;  // 510

/** 把票面 props 装配成一张画布版式:块序列 + 每块的绝对 y 与高。
 *  ★ 顺序与 index.wxml 的 .ds__slip 逐段对应:标题行 / 出发·签号 / 留签人·留于 / (照片) / 那句 / 条码。
 *  @param measure (text, font) => width 由调用方注入(真机是 ctx.measureText)
 *  @param hasPhoto 照片是否已经解码成功;假了就把「虚线 + 照片 + 标注」整段一起跳掉 */
function buildSignPoster(d, measure, hasPhoto) {
  const blocks = [];
  let cy = SLIP.DESK_Y + SLIP.PAD_TOP;
  const add = (b) => { b.y = cy; cy += b.h; blocks.push(b); return b; };
  // 相邻两道虚线会在票面上留一条看得见的空带 —— 那就是没照片时的「空洞」,一律并掉
  const hr = () => {
    const last = blocks[blocks.length - 1];
    if (last && last.type === 'hr') return last;
    return add({ type: 'hr', h: SLIP.HR, x: CONTENT_X, w: CONTENT_W });
  };
  const m = typeof measure === 'function' ? measure : () => 0;

  add({
    type: 'head', h: SLIP.HEAD_H, x: CONTENT_X, w: CONTENT_W,
    title: '今日城市签', date: String(d.dateLabel || ''),
  });
  hr();

  /* 出发 = 这一站的地址;右边签号那列有多宽决定左边还能用多宽(同 .ds__od 的 space-between + gap) */
  const address = String(d.address || '');
  const serialLabel = String(d.serialLabel || '');
  const rightW = Math.max(
    m('签号', FONT.k), m(serialLabel, FONT.big), m('你是第几位', FONT.sm));
  const addrMaxW = Math.max(120, CONTENT_W - SLIP.GAP - rightW);
  const addrLines = wrapText(address, addrMaxW, FONT.addr, m);
  const leftH = (addrLines.length ? SLIP.MICRO_H + 2 : 0)
    + addrLines.length * SLIP.ADDR_H + (address || addrLines.length ? 4 : 0) + SLIP.CAP_H;
  const rightH = SLIP.MICRO_H + 2 + SLIP.BIG_H + 4 + SLIP.CAP_H;
  add({
    type: 'od', h: Math.max(leftH, rightH), x: CONTENT_X, w: CONTENT_W,
    leftH: leftH, rightH: rightH,
    pickLabel: '出发', address: address, addrLines: addrLines, addrMaxW: addrMaxW, addrLineH: SLIP.ADDR_H,
    time: String(d.timeLabel || ''), serialLabel: serialLabel, serialCaption: '你是第几位', rightW: rightW,
  });
  hr();

  const cells = [
    { k: '留签人', v: String(d.signer || '') || '这一站的发起人' },
    { k: '留于', v: String(d.leftAt || '') || '这一站开场' },
  ];
  const colW = (CONTENT_W - SLIP.GAP) / 2;
  let cellLines = 1;
  for (const cell of cells) {
    cell.lines = wrapText(cell.v, colW, FONT.v, m);
    cellLines = Math.max(cellLines, cell.lines.length || 1);
  }
  add({
    type: 'grid', h: SLIP.MICRO_H + 4 + cellLines * SLIP.GRID_H, x: CONTENT_X, w: CONTENT_W,
    colW: colW, cells: cells,
  });

  /* 上一个人拍的那张:没解码成就整段不排(票面往上收),既不空一块白也不画假占位 —— 同 wxml 那个 wx:if */
  if (hasPhoto) {
    hr();
    add({
      type: 'photo', h: SLIP.PHOTO_H + SLIP.PHOTO_CAP_GAP + SLIP.MICRO_H,
      x: CONTENT_X, w: CONTENT_W, imgH: SLIP.PHOTO_H, radius: SLIP.PHOTO_R,
      captionL: (String(d.signer || '') || 'TA') + ' 拍的', captionR: String(d.leftAt || ''),
    });
  }
  hr();

  const srcLines = Array.isArray(d.lines) ? d.lines : [];
  const lines = [];
  for (const one of srcLines) {
    const parts = wrapText(one, CONTENT_W - SLIP.POEM_PAD_X * 2, FONT.poem, m);
    for (const part of parts) lines.push(part);
  }
  const rowCount = lines.length || 1;
  const boxH = SLIP.POEM_PAD_T + rowCount * SLIP.POEM_LH + SLIP.POEM_PAD_B;
  add({
    type: 'poem', h: SLIP.MICRO_H + SLIP.POEM_GAP + boxH, x: CONTENT_X, w: CONTENT_W,
    k: '留给你的一句', lines: lines, lineH: SLIP.POEM_LH, boxH: boxH,
    boxY: cy + SLIP.MICRO_H + SLIP.POEM_GAP,
  });
  hr();

  const bars = (Array.isArray(d.bars) && d.bars.length) ? d.bars : buildBars(d.serialLabel);
  const maxW = Math.round(CONTENT_W * SLIP.BAR_W_PCT);   // .ds__barcode width 82%
  let natural = 0;
  for (const bar of bars) natural += bar.w + bar.g;
  const scale = natural > maxW ? maxW / natural : 1;     // 宽到画不下就整体压,不许溢出票面
  const drawW = natural - (bars.length ? bars[bars.length - 1].g : 0);
  add({
    type: 'barcode', h: SLIP.BAR_H + SLIP.BAR_T, x: CONTENT_X, w: CONTENT_W,
    bars: bars, maxW: maxW, scale: scale, barH: SLIP.BAR_H,
    x0: CONTENT_X + (CONTENT_W - drawW * scale) / 2,    // justify-content: center
  });

  const paperY = SLIP.DESK_Y;
  const paperH = (cy + SLIP.PAD_BOTTOM) - paperY;
  return {
    w: SLIP.W, h: paperY + paperH + SLIP.DESK_BOTTOM, dpr: SLIP.DPR,
    c: DAILY_SIGN_CARD,
    paper: { x: SLIP.PAPER_X, y: paperY, w: SLIP.PAPER_W, h: paperH, tooth: SLIP.TOOTH, period: SLIP.PERIOD },
    blocks: blocks,
  };
}

function pad2(n) { return String(n).padStart(2, '0'); }
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

/** 条形码只是票面的"像":按签号做种子,同一张签每次长一样;46 根,宽 2/4/6rpx,间隔 2/4rpx */
function buildBars(serial) {
  let s = 77;
  for (let i = 0; i < (serial || '').length; i++) s = (s * 31 + serial.charCodeAt(i)) & 0x7fffffff;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const W = [2, 2, 2, 4, 4, 6];
  const out = [];
  for (let i = 0; i < 46; i++) out.push({ w: W[Math.floor(rnd() * 6)], g: 2 + Math.floor(rnd() * 2) * 2 });
  return out;
}

module.exports = { DAILY_SIGN_CARD, SLIP, FONT, wrapText, signPaperPath, signRoundRect, buildSignPoster, pad2, clamp, buildBars };
