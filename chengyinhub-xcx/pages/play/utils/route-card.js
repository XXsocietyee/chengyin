// 通关 3:4 分享海报(1080×1440):支持三套可切换版式(电影票根 / 城市轨迹 / 结案档案)。
// 首尾各 150 米不画,保护起终点隐私;纯绘制:canvas 2D 上下文由调用方传入,本文件不碰 wx,方便单测。

const W = 1080;
const H = 1440;
const NUMBER_BOX = Object.freeze({ x: 80, y: 900, w: W - 430, h: 430 });
const CODE = Object.freeze({ cx: W - 196, cy: 1140, r: 132 });
const FUZZ_M = 150;

const LAYOUTS = Object.freeze([
  Object.freeze({ key: 'ticket', label: '电影票根' }),
  Object.freeze({ key: 'track', label: '城市轨迹' }),
  Object.freeze({ key: 'dossier', label: '结案档案' }),
]);

const C = Object.freeze({
  page: '#0B0B0C',
  text: '#F8F8F8',
  muted: 'rgba(248,248,248,.66)',
  ring: '#FFFFFF',
  ticketFrame: '#0E0E10',
  ticketPaper: '#F5F0E6',
  ticketInk: '#1A1714',
  ticketSub: '#6D6253',
  ticketLine: 'rgba(26,23,20,.16)',
  ticketScreen: '#161513',
  ticketAccent: '#B83B2A',
  ticketGold: '#E8C67A',
  dossierBg: '#141311',
  dossierCard: '#201E1B',
  dossierBorder: 'rgba(245,240,230,.16)',
  dossierInk: '#F4EFE4',
  dossierMuted: '#A79E8D',
  dossierStamp: '#C84332',
});

function normalizeLayout(layout) {
  const k = String(layout || '').toLowerCase();
  if (k === 'track' || k === 'dossier' || k === 'ticket') return k;
  return 'ticket';
}

function distM(a, b) {
  const rad = Math.PI / 180;
  const x = (b.lng - a.lng) * rad * Math.cos(((a.lat + b.lat) / 2) * rad);
  const y = (b.lat - a.lat) * rad;
  return Math.sqrt(x * x + y * y) * 6371000;
}

function clean(points) {
  return (Array.isArray(points) ? points : [])
    .map((p) => ({ lat: Number(p && p.lat), lng: Number(p && p.lng) }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && (p.lat !== 0 || p.lng !== 0));
}

function lengthM(points) {
  let m = 0;
  for (let i = 1; i < points.length; i++) m += distM(points[i - 1], points[i]);
  return m;
}

/** 从一端沿路线走 meters 米,把那一段剪掉(切点按比例插值) */
function cutHead(points, meters) {
  let left = meters;
  for (let i = 1; i < points.length; i++) {
    const d = distM(points[i - 1], points[i]);
    if (d >= left) {
      const t = d > 0 ? left / d : 0;
      const a = points[i - 1], b = points[i];
      return [{ lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t }].concat(points.slice(i));
    }
    left -= d;
  }
  return points.slice(-1);
}

/** 首尾各剪掉 150 米;整条不到 600 米时各剪四分之一,总还留一段能画 */
function fuzzEnds(points, meters) {
  const pts = clean(points);
  if (pts.length < 2) return pts;
  const total = lengthM(pts);
  const cut = Math.min(meters == null ? FUZZ_M : meters, total / 4);
  const head = cutHead(pts, cut);
  return cutHead(head.slice().reverse(), cut).reverse();
}

function kmText(meters) {
  const km = Math.max(0, Number(meters) || 0) / 1000;
  return km >= 10 ? km.toFixed(0) : km.toFixed(1);
}

function trimStr(v, max) {
  const s = String(v == null ? '' : v).trim();
  return max && s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function normalizeMedal(m) {
  if (!m) return null;
  if (typeof m === 'string') return m.trim() ? { name: trimStr(m, 16), sub: '' } : null;
  const name = trimStr(m.name || m.title || '', 16);
  const sub = trimStr(m.sub || m.subtitle || '', 18);
  return name ? { name, sub } : null;
}

function normalizeEnding(e) {
  if (!e) return null;
  if (typeof e === 'string') return e.trim() ? { title: trimStr(e, 20), summary: '' } : null;
  const title = trimStr(e.title || e.name || '', 20);
  const summary = trimStr(e.summary || e.copy || e.desc || '', 54);
  return title || summary ? { title, summary } : null;
}

function normalizeDuoStamp(d) {
  if (!d) return null;
  if (typeof d === 'string') return d.trim() ? { label: trimStr(d, 8), sub: '' } : null;
  const label = trimStr(d.label || '双人同行', 8);
  const sub = trimStr(d.sub || d.names || '', 14);
  return label ? { label, sub } : null;
}

function normalizeBranchPath(list) {
  if (!Array.isArray(list)) return [];
  return list.filter(Boolean).slice(0, 6).map((item, idx) => {
    if (typeof item === 'string') return { step: String(idx + 1).padStart(2, '0'), label: '', choice: trimStr(item, 28) };
    const step = String(item.step || idx + 1).padStart(2, '0');
    const label = trimStr(item.nodeName || item.station || item.label || item.title || '', 14);
    const choice = trimStr(item.choice || item.optionText || item.picked || item.summary || item.text || '', 28);
    return { step, label, choice };
  }).filter((row) => row.label || row.choice);
}

function serialCode(name, date) {
  const seed = String(name || 'CY') + '|' + String(date || '');
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return 'NO.' + String((h >>> 0) % 900000 + 100000);
}

/** 卡片数据模型:distanceM 优先用真实走过的轨迹,没有就用调用方给的站间距离 */
function cardModel(input) {
  const i = input || {};
  const raw = clean(i.track);
  const route = raw.length >= 2 ? raw : clean(i.stops);
  const meters = raw.length >= 2 ? lengthM(raw) : (Number(i.fallbackKm) || 0) * 1000;
  const name = String(i.name || '').trim().slice(0, 14);
  const date = trimStr(i.date || '', 18);
  const photos = (Array.isArray(i.photos) ? i.photos : []).map((p) => {
    if (typeof p === 'string') return p.trim();
    return p && (p.url || p.src || p.photo) ? String(p.url || p.src || p.photo).trim() : '';
  }).filter(Boolean).slice(0, 3);
  return {
    layout: normalizeLayout(i.layout),
    route: fuzzEnds(route, FUZZ_M),
    big: kmText(meters),
    name,
    time: String(i.time || '').trim(),
    stops: Number(i.doneCount) > 0 ? Number(i.doneCount) + ' 站' : '',
    city: String(i.city || '').replace(/市$/, '').trim().slice(0, 8),
    date,
    ending: normalizeEnding(i.ending),
    medal: normalizeMedal(i.medal),
    quote: trimStr(i.quote || i.handwrittenLine || '', 60),
    quoteAuthor: trimStr(i.quoteAuthor || '', 12),
    duoStamp: normalizeDuoStamp(i.duoStamp),
    photos,
    branchPath: normalizeBranchPath(i.branchPath),
    score: i.score != null && String(i.score) !== '' ? String(i.score) : '',
    ticketNo: trimStr(i.ticketNo || serialCode(name, date), 14),
  };
}

/** 生成不剧透小红书分享文案(仅用公开路线名 / 城市 / 里程 / 用时 / 站数 / 勋章,不含谜面答案或剧情剧透) */
function buildXiaohongshuCopy(input) {
  const m = input && typeof input === 'object' && 'big' in input && 'ticketNo' in input ? input : cardModel(input);
  const place = m.city ? m.city + ' · ' : '';
  const title = m.name || '城市漫游剧本';
  const metrics = [];
  if (Number(m.big) > 0) metrics.push('暴走 ' + m.big + 'km');
  if (m.time) metrics.push('用时 ' + m.time);
  if (m.stops) metrics.push('打卡 ' + m.stops);
  const line1 = '刚在' + place + '走完「' + title + '」，把整座城市走成了一场电影！';
  const line2 = metrics.length ? '本场战绩：' + metrics.join(' · ') + (m.medal ? ' · 解锁勋章「' + m.medal.name + '」' : '') : (m.medal ? '解锁勋章「' + m.medal.name + '」' : '边走边解锁线索，沉浸感拉满');
  const line3 = m.duoStamp ? '和搭子一起走完全程，全程不剧透，强烈建议自己来走一遍！' : '全程不剧透，线索和反转留给你们自己去现场拆！';
  const tags = ['#城瘾', '#城市定向', '#城市漫步', '#周末去哪儿'];
  if (m.city) tags.push('#' + m.city + '周末');
  return [line1, line2, line3, '', tags.join(' ')].join('\n');
}

/* ---------- 内部绘制小工具(兼容最小化测试代理,不碰未实现的可选方法) ---------- */

function closePathSafe(g) { if (typeof g.closePath === 'function') g.closePath(); }
function setDashSafe(g, segs) { if (typeof g.setLineDash === 'function') g.setLineDash(segs); }
function textWidth(g, text, fallbackSize) {
  if (g && typeof g.measureText === 'function') {
    const m = g.measureText(text);
    if (m && Number.isFinite(m.width)) return m.width;
  }
  return String(text || '').length * (fallbackSize || 28);
}

function roundRectPath(g, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r || 0, w / 2, h / 2));
  g.beginPath();
  g.moveTo(x + rr, y);
  g.lineTo(x + w - rr, y);
  if (rr > 0) g.arc(x + w - rr, y + rr, rr, -Math.PI / 2, 0);
  g.lineTo(x + w, y + h - rr);
  if (rr > 0) g.arc(x + w - rr, y + h - rr, rr, 0, Math.PI / 2);
  g.lineTo(x + rr, y + h);
  if (rr > 0) g.arc(x + rr, y + h - rr, rr, Math.PI / 2, Math.PI);
  g.lineTo(x, y + rr);
  if (rr > 0) g.arc(x + rr, y + rr, rr, Math.PI, Math.PI * 1.5);
  closePathSafe(g);
}

function fillRoundRect(g, x, y, w, h, r, color) {
  roundRectPath(g, x, y, w, h, r);
  g.fillStyle = color;
  g.fill();
}

function strokeRoundRect(g, x, y, w, h, r, color, lw) {
  roundRectPath(g, x, y, w, h, r);
  g.strokeStyle = color;
  g.lineWidth = lw || 2;
  g.stroke();
}

function wrapLines(g, text, maxW, fontSize, maxLines) {
  const str = String(text || '').trim();
  if (!str) return [];
  const lines = [];
  let cur = '';
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    const next = cur + ch;
    if (cur && textWidth(g, next, fontSize) > maxW) {
      lines.push(cur);
      cur = ch;
      if (lines.length >= maxLines) break;
    } else {
      cur = next;
    }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  if (lines.length === maxLines && lines.join('').length < str.length) {
    lines[maxLines - 1] = lines[maxLines - 1].slice(0, Math.max(1, lines[maxLines - 1].length - 1)) + '…';
  }
  return lines;
}

function drawQrCircle(g, codeImage, cx, cy, r, ringColor) {
  if (!codeImage) return;
  g.fillStyle = ringColor || C.ring;
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fill();
  g.save();
  g.beginPath();
  g.arc(cx, cy, r - 12, 0, Math.PI * 2);
  g.clip();
  const s = (r - 12) * 2;
  g.drawImage(codeImage, cx - s / 2, cy - s / 2, s, s);
  g.restore();
}

function projectMiniTrack(points, box) {
  if (!Array.isArray(points) || points.length < 2) return [];
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  points.forEach((p) => {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  });
  const pad = box.pad || 32;
  const innerW = Math.max(10, box.w - pad * 2);
  const innerH = Math.max(10, box.h - pad * 2);
  const spanLng = Math.max(1e-5, maxLng - minLng);
  const spanLat = Math.max(1e-5, maxLat - minLat);
  const scale = Math.min(innerW / spanLng, innerH / spanLat);
  const drawW = spanLng * scale;
  const drawH = spanLat * scale;
  const ox = box.x + pad + (innerW - drawW) / 2;
  const oy = box.y + pad + (innerH - drawH) / 2;
  return points.map((p) => ({
    x: ox + (p.lng - minLng) * scale,
    y: oy + (maxLat - p.lat) * scale,
  }));
}

function drawMiniTrackBox(g, box, route, mapImage, accentColor) {
  g.save();
  roundRectPath(g, box.x, box.y, box.w, box.h, 24);
  g.clip();
  g.fillStyle = C.ticketScreen;
  g.fillRect(box.x, box.y, box.w, box.h);
  if (mapImage) {
    g.drawImage(mapImage, box.x, box.y, box.w, box.h);
    g.fillStyle = 'rgba(14,14,16,.28)';
    g.fillRect(box.x, box.y, box.w, box.h);
  }
  const pts = projectMiniTrack(route, box);
  if (pts.length >= 2) {
    g.beginPath();
    g.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
    g.strokeStyle = accentColor || C.ticketGold;
    g.lineWidth = 7;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.stroke();
    // 起点空心环 + 终点实心点
    g.beginPath();
    g.arc(pts[0].x, pts[0].y, 9, 0, Math.PI * 2);
    g.fillStyle = C.ticketScreen;
    g.fill();
    g.strokeStyle = '#FFFFFF';
    g.lineWidth = 4;
    g.stroke();
    const end = pts[pts.length - 1];
    g.beginPath();
    g.arc(end.x, end.y, 10, 0, Math.PI * 2);
    g.fillStyle = accentColor || C.ticketGold;
    g.fill();
  }
  g.restore();
  strokeRoundRect(g, box.x, box.y, box.w, box.h, 24, 'rgba(26,23,20,.14)', 2);
}

function drawDuoStamp(g, stamp, cx, cy) {
  if (!stamp) return;
  g.save();
  if (typeof g.translate === 'function') g.translate(cx, cy);
  if (typeof g.rotate === 'function') g.rotate(-0.18);
  const ox = typeof g.translate === 'function' ? 0 : cx;
  const oy = typeof g.translate === 'function' ? 0 : cy;
  g.strokeStyle = C.ticketAccent;
  g.lineWidth = 4;
  g.beginPath();
  g.arc(ox, oy, 74, 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = 2;
  g.beginPath();
  g.arc(ox, oy, 64, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = C.ticketAccent;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = '700 24px -apple-system, "PingFang SC", sans-serif';
  g.fillText(stamp.label, ox, oy - (stamp.sub ? 12 : 0));
  if (stamp.sub) {
    g.font = '500 18px -apple-system, "PingFang SC", sans-serif';
    g.fillText(stamp.sub.slice(0, 8), ox, oy + 18);
  }
  g.restore();
}

function drawMedalSeal(g, medal, x, y, darkMode) {
  if (!medal) return;
  const bg = darkMode ? 'rgba(232,198,122,.16)' : 'rgba(184,59,42,.10)';
  const stroke = darkMode ? C.ticketGold : C.ticketAccent;
  const ink = darkMode ? C.dossierInk : C.ticketInk;
  const sub = darkMode ? C.dossierMuted : C.ticketSub;
  fillRoundRect(g, x, y, 420, 96, 20, bg);
  strokeRoundRect(g, x, y, 420, 96, 20, stroke, 2);
  // 六边形勋章徽记
  const hx = x + 48, hy = y + 48, hr = 28;
  g.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 3;
    const px = hx + Math.cos(a) * hr;
    const py = hy + Math.sin(a) * hr;
    if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
  }
  closePathSafe(g);
  g.fillStyle = stroke;
  g.fill();
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  g.fillStyle = ink;
  g.font = '700 28px -apple-system, "PingFang SC", sans-serif';
  g.fillText(medal.name, x + 94, y + 46);
  g.fillStyle = sub;
  g.font = '500 22px -apple-system, "PingFang SC", sans-serif';
  g.fillText(medal.sub || '通关勋章', x + 94, y + 78);
}

/* ---------- 版式 1: 电影票根 (3:4 1080×1440 City Movie Ticket Stub) ---------- */

function drawTicketLayout(g, model, codeImage, mapImage, photoImages) {
  g.fillStyle = C.ticketFrame;
  g.fillRect(0, 0, W, H);

  // 纸面票根主体
  const tx = 56, ty = 52, tw = W - 112, th = H - 104;
  fillRoundRect(g, tx, ty, tw, th, 36, C.ticketPaper);

  // 顶部电影票眉栏
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  g.fillStyle = C.ticketSub;
  g.font = '600 22px Menlo, "Courier New", monospace';
  g.fillText('CHENGYIN · CITY MOVIE TICKET', tx + 44, ty + 62);
  g.textAlign = 'right';
  g.fillText([model.city, model.date || model.ticketNo].filter(Boolean).join(' · '), tx + tw - 44, ty + 62);

  g.strokeStyle = C.ticketLine;
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(tx + 44, ty + 84);
  g.lineTo(tx + tw - 44, ty + 84);
  g.stroke();

  // 标题 + 结局标签 + 关键指标
  g.textAlign = 'left';
  g.fillStyle = C.ticketInk;
  g.font = '700 54px "Songti SC", "STSong", Georgia, serif';
  g.fillText(model.name || '城市探索', tx + 44, ty + 156);

  if (model.ending && model.ending.title) {
    const tag = '结局 · ' + model.ending.title;
    g.font = '600 24px -apple-system, "PingFang SC", sans-serif';
    const pillW = Math.min(tw - 88, textWidth(g, tag, 24) + 40);
    fillRoundRect(g, tx + 44, ty + 178, pillW, 44, 22, C.ticketAccent);
    g.fillStyle = '#FFFFFF';
    g.fillText(tag, tx + 64, ty + 208);
  }

  const statRow = [
    Number(model.big) > 0 ? model.big + ' 公里' : '',
    model.time,
    model.stops,
  ].filter(Boolean).join('  ·  ');
  g.fillStyle = C.ticketSub;
  g.font = '600 26px -apple-system, "PingFang SC", sans-serif';
  g.fillText(statRow || '城市漫步放映厅', tx + 44, ty + 266);

  // 路线小轨银幕框(先画真实地图快照,再叠路线小轨)
  const trackBox = { x: tx + 44, y: ty + 292, w: tw - 88, h: 258, pad: 34 };
  drawMiniTrackBox(g, trackBox, model.route, mapImage, C.ticketGold);

  // 1-3 张旅途胶片照片条
  const photos = (Array.isArray(photoImages) ? photoImages : []).filter(Boolean).slice(0, 3);
  const stripY = ty + 576, stripH = 228;
  if (photos.length > 0) {
    const gap = 18;
    const count = photos.length;
    const cellW = (tw - 88 - gap * (count - 1)) / count;
    for (let i = 0; i < count; i++) {
      const px = tx + 44 + i * (cellW + gap);
      fillRoundRect(g, px, stripY, cellW, stripH, 18, '#1A1714');
      g.save();
      roundRectPath(g, px + 6, stripY + 6, cellW - 12, stripH - 12, 14);
      g.clip();
      g.drawImage(photos[i], px + 6, stripY + 6, cellW - 12, stripH - 12);
      g.restore();
      g.fillStyle = 'rgba(26,23,20,.65)';
      fillRoundRect(g, px + 14, stripY + 14, 52, 30, 15, 'rgba(26,23,20,.65)');
      g.fillStyle = '#F5F0E6';
      g.font = '600 18px Menlo, monospace';
      g.textAlign = 'center';
      g.fillText(String(i + 1).padStart(2, '0'), px + 40, stripY + 35);
    }
    g.textAlign = 'left';
  } else {
    // 无旅途照片时用胶片场次条稳住节奏
    fillRoundRect(g, tx + 44, stripY, tw - 88, stripH, 20, 'rgba(26,23,20,.05)');
    strokeRoundRect(g, tx + 44, stripY, tw - 88, stripH, 20, C.ticketLine, 2);
    g.fillStyle = C.ticketSub;
    g.font = '600 22px Menlo, monospace';
    g.fillText('SCREENING REEL · ' + model.ticketNo, tx + 76, stripY + 64);
    g.fillStyle = C.ticketInk;
    g.font = '600 32px "Songti SC", Georgia, serif';
    const summary = (model.ending && model.ending.summary) || '你走过的每一条街巷，都在此刻定格。';
    const sLines = wrapLines(g, summary, tw - 152, 32, 2);
    sLines.forEach((ln, idx) => g.fillText(ln, tx + 76, stripY + 124 + idx * 48));
  }

  // 勋章 + 角色台词 / 手写句 + 双人印章
  const midY = ty + 832;
  if (model.medal) drawMedalSeal(g, model.medal, tx + 44, midY, false);
  const quoteY = model.medal ? midY + 136 : midY + 36;
  const quoteText = model.quote || (model.ending && model.ending.summary) || '「走完这一程，城市记住你的脚步。」';
  const quoteMaxW = model.duoStamp ? tw - 270 : tw - 88;
  g.fillStyle = C.ticketInk;
  g.font = 'italic 500 30px "Kaiti SC", "Songti SC", Georgia, serif';
  const qLines = wrapLines(g, quoteText, quoteMaxW, 30, 2);
  qLines.forEach((ln, idx) => g.fillText(ln, tx + 44, quoteY + idx * 44));
  if (model.quoteAuthor) {
    g.fillStyle = C.ticketSub;
    g.font = '500 22px -apple-system, "PingFang SC", sans-serif';
    g.fillText('—— ' + model.quoteAuthor, tx + 44, quoteY + qLines.length * 44 + 8);
  }
  if (model.duoStamp) drawDuoStamp(g, model.duoStamp, tx + tw - 126, midY + 112);

  // 电影票撕裂虚线与左右半圆缺口
  const tearY = ty + 1068;
  g.save();
  setDashSafe(g, [14, 12]);
  g.strokeStyle = C.ticketLine;
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(tx + 34, tearY);
  g.lineTo(tx + tw - 34, tearY);
  g.stroke();
  setDashSafe(g, []);
  g.restore();

  g.fillStyle = C.ticketFrame;
  g.beginPath();
  g.arc(tx, tearY, 26, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.arc(tx + tw, tearY, 26, 0, Math.PI * 2);
  g.fill();

  // 底部票根联:品牌 + 序列号 + 二维码
  g.textAlign = 'left';
  g.fillStyle = C.ticketInk;
  g.font = '700 34px "Songti SC", Georgia, serif';
  g.fillText('城 瘾 · 走 进 城 市 的 瘾', tx + 44, tearY + 86);
  g.fillStyle = C.ticketSub;
  g.font = '500 24px -apple-system, "PingFang SC", sans-serif';
  g.fillText('扫码开启同一场城市漫步剧本', tx + 44, tearY + 134);
  g.font = '600 22px Menlo, monospace';
  g.fillText(model.ticketNo + (model.city ? '  ·  ' + model.city : ''), tx + 44, tearY + 186);

  drawQrCircle(g, codeImage, tx + tw - 132, tearY + 134, 96, '#FFFFFF');
}

/* ---------- 版式 2: 城市轨迹 (3:4 1080×1440 Full-Bleed Track) ---------- */

// 底图只用真实地图快照;没有快照就是纯底色,不画替代底图
function drawTrackBase(g, mapImage) {
  g.fillStyle = C.page;
  g.fillRect(0, 0, W, H);
  if (!mapImage) return;
  g.drawImage(mapImage, 0, 0, W, H);
  if (typeof g.createLinearGradient === 'function') {
    const sh = g.createLinearGradient(0, H * 0.48, 0, H);
    sh.addColorStop(0, 'rgba(11,11,12,0)');
    sh.addColorStop(0.55, 'rgba(11,11,12,.82)');
    sh.addColorStop(1, 'rgba(11,11,12,.95)');
    g.fillStyle = sh;
    g.fillRect(0, H * 0.48, W, H * 0.52);
  }
}

function drawTrackLayout(g, model, codeImage, mapImage) {
  drawTrackBase(g, mapImage);
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  g.fillStyle = C.muted;
  g.font = '600 24px Menlo, monospace';
  g.fillText('CHENGYIN · CITY TRACK', NUMBER_BOX.x, 86);
  if (model.date || model.city) {
    g.textAlign = 'right';
    g.fillText([model.city, model.date].filter(Boolean).join(' · '), W - 80, 86);
    g.textAlign = 'left';
  }
  g.fillStyle = C.text;
  g.font = 'italic 800 220px -apple-system, "Helvetica Neue", sans-serif';
  g.fillText(model.big, NUMBER_BOX.x, NUMBER_BOX.y + 200);
  const bigW = textWidth(g, model.big, 150);
  g.font = '600 46px -apple-system, sans-serif';
  g.fillText('公里', NUMBER_BOX.x + bigW + 18, NUMBER_BOX.y + 192);
  if (model.name) {
    g.font = '700 54px -apple-system, sans-serif';
    g.fillText(model.name, NUMBER_BOX.x, NUMBER_BOX.y + 292);
  }
  const row = [model.time, model.stops, model.city].filter(Boolean);
  if (row.length) {
    g.fillStyle = C.muted;
    g.font = '500 34px -apple-system, sans-serif';
    let x = NUMBER_BOX.x;
    row.forEach((t) => {
      g.fillText(t, x, NUMBER_BOX.y + 368);
      x += textWidth(g, t, 34) + 38;
    });
  }
  drawQrCircle(g, codeImage, CODE.cx, CODE.cy, CODE.r, C.ring);
}

/* ---------- 版式 3: 结案档案 (3:4 1080×1440 Case Dossier with branchPath) ---------- */

function drawDossierLayout(g, model, codeImage, mapImage) {
  g.fillStyle = C.dossierBg;
  g.fillRect(0, 0, W, H);
  // 顶部档案卷宗色条
  g.fillStyle = C.ticketGold;
  g.fillRect(0, 0, W, 14);

  const px = 68, pw = W - 136;
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  g.fillStyle = C.dossierMuted;
  g.font = '600 24px Menlo, monospace';
  g.fillText('CASE DOSSIER · 结案档案 · ' + model.ticketNo, px, 88);

  // 结案印章
  strokeRoundRect(g, W - 266, 52, 198, 56, 10, C.dossierStamp, 3);
  g.fillStyle = C.dossierStamp;
  g.textAlign = 'center';
  g.font = '700 26px -apple-system, "PingFang SC", sans-serif';
  g.fillText('已 结 案', W - 167, 89);

  g.textAlign = 'left';
  g.fillStyle = C.dossierInk;
  g.font = '700 60px "Songti SC", Georgia, serif';
  g.fillText(model.name || '城市结案记录', px, 178);

  g.fillStyle = C.dossierMuted;
  g.font = '500 26px -apple-system, "PingFang SC", sans-serif';
  const meta = [model.city, model.date, Number(model.big) > 0 ? model.big + ' 公里' : '', model.time, model.stops, model.score ? model.score + ' 分' : ''].filter(Boolean).join(' · ');
  g.fillText(meta || '实地探索结案记录', px, 224);

  // 结局摘要卡
  const endY = 262;
  fillRoundRect(g, px, endY, pw, 166, 24, C.dossierCard);
  strokeRoundRect(g, px, endY, pw, 166, 24, C.dossierBorder, 2);
  g.fillStyle = C.ticketGold;
  g.font = '600 22px Menlo, monospace';
  g.fillText('FINAL VERDICT · 本局结局', px + 34, endY + 46);
  g.fillStyle = C.dossierInk;
  g.font = '700 36px "Songti SC", Georgia, serif';
  g.fillText((model.ending && model.ending.title) || '真相已归档', px + 34, endY + 96);
  if (model.ending && model.ending.summary) {
    g.fillStyle = C.dossierMuted;
    g.font = '500 24px -apple-system, "PingFang SC", sans-serif';
    g.fillText(trimStr(model.ending.summary, 36), px + 34, endY + 138);
  }

  // 分支轨迹 branchPath 档案时间线
  const bpY = 462;
  g.fillStyle = C.dossierMuted;
  g.font = '600 22px Menlo, monospace';
  g.fillText('BRANCH PATH · 关键抉择轨迹', px, bpY);

  const list = model.branchPath || [];
  if (list.length > 0) {
    const rowH = 96;
    const spineX = px + 34;
    // 纵轴线
    g.strokeStyle = 'rgba(232,198,122,.35)';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(spineX, bpY + 46);
    g.lineTo(spineX, bpY + 46 + (list.length - 1) * rowH);
    g.stroke();

    list.forEach((item, idx) => {
      const ry = bpY + 28 + idx * rowH;
      g.beginPath();
      g.arc(spineX, ry + 18, 12, 0, Math.PI * 2);
      g.fillStyle = C.ticketGold;
      g.fill();
      fillRoundRect(g, px + 68, ry - 12, pw - 68, 76, 16, C.dossierCard);
      g.fillStyle = C.ticketGold;
      g.font = '600 22px Menlo, monospace';
      g.fillText(item.step + (item.label ? '  ' + item.label : ''), px + 92, ry + 18);
      g.fillStyle = C.dossierInk;
      g.font = '500 26px -apple-system, "PingFang SC", sans-serif';
      g.fillText(item.choice || item.label, px + 92, ry + 52);
    });
  } else {
    // 无分支记录时展示路线小轨档案框
    drawMiniTrackBox(g, { x: px, y: bpY + 26, w: pw, h: 420, pad: 42 }, model.route, mapImage, C.ticketGold);
  }

  // 勋章与语录
  const footTop = 1090;
  if (model.medal) drawMedalSeal(g, model.medal, px, footTop, true);
  if (model.quote) {
    g.fillStyle = C.dossierMuted;
    g.font = 'italic 500 26px "Kaiti SC", "Songti SC", serif';
    g.fillText(trimStr('「' + model.quote + '」', 30), px, footTop + 144);
  }

  // 底部二维码与品牌角标
  g.fillStyle = C.dossierInk;
  g.font = '700 32px "Songti SC", Georgia, serif';
  g.fillText('城瘾 · 城市场景档案', px, H - 108);
  g.fillStyle = C.dossierMuted;
  g.font = '500 22px -apple-system, "PingFang SC", sans-serif';
  g.fillText('不剧透通关凭证 · 扫码进入同款路线', px, H - 68);
  drawQrCircle(g, codeImage, W - 168, H - 156, 100, '#FFFFFF');
}

/** 渲染 3:4 1080×1440 海报。extras 可选: { layout, photos }。 */
function drawCard(g, model, _progress, codeImage, mapImage, extras) {
  const m = model || cardModel({});
  const ex = extras || {};
  const layout = normalizeLayout(ex.layout || m.layout);
  if (layout === 'track') {
    drawTrackLayout(g, m, codeImage, mapImage);
  } else if (layout === 'dossier') {
    drawDossierLayout(g, m, codeImage, mapImage);
  } else {
    drawTicketLayout(g, m, codeImage, mapImage, ex.photos || []);
  }
}

module.exports = {
  W,
  H,
  NUMBER_BOX,
  CODE,
  FUZZ_M,
  LAYOUTS,
  normalizeLayout,
  fuzzEnds,
  lengthM,
  cardModel,
  drawCard,
  buildXiaohongshuCopy,
  kmText,
  distM,
};
