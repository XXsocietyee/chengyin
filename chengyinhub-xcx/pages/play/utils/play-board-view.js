'use strict';
const { id, integer, centi, precise } = require('./orient-score-view.js');
// L02-083(业主 2026-11-24 默认 A):排行榜用时与成绩弹层同一种「时:分:秒」写法(play-hud-overlays 也用这一份)
function clock(ms) {
  // 服务端给的是 int64 十进制串:按字符串长除,超出安全整数也不丢位
  const digits = integer(ms);
  if (!digits) return '';
  if (digits[0] === '-') return '00:00';
  let sec = '', rem = 0;
  for (const ch of digits.slice(0, -3) || '0') { rem = rem * 10 + Number(ch); sec += Math.floor(rem / 3600); rem %= 3600; }
  const h = sec.replace(/^0+/, ''), m = Math.floor(rem / 60), x = rem % 60;
  const pad = v => (v < 10 ? '0' : '') + v;
  return h ? h + ':' + pad(m) + ':' + pad(x) : pad(m) + ':' + pad(x);
}
function project(data) {
  if (!data || !Array.isArray(data.list)) return null;
  if (!['SCORE', 'ROUTE'].includes(data.mode)) return {
    mode: data.rankMode || 'LINEAR',
    list: data.list.map(row => ({ ...row, rowKey: String(row.memberId), scoreText: String(row.score) + ' 关' })),
    me: data.me ? { ...data.me, scoreText: String(data.me.score) + ' 关' } : null
  };
  const rows = data.me ? data.list.concat(data.me) : data.list;
  if (!precise(data) || rows.some(row => !row || typeof row.rowKey !== 'string' || !row.rowKey
      || !id(row.rank) || !integer(row.scoreCenti)
      || typeof row.reachedEnding !== 'boolean' || typeof row.mine !== 'boolean'
      || row.elapsedMs != null && (!integer(row.elapsedMs) || integer(row.elapsedMs)[0] === '-'))) return null;
  if (new Set(data.list.map(row => row.rowKey)).size !== data.list.length) return null;
  const item = row => ({ ...row, nickname: row.mine ? '我' : '同行者',
    scoreText: data.mode === 'SCORE' ? centi(row.scoreCenti) : row.reachedEnding ? '已到达结局' : '尚未到达结局',
    elapsedText: row.elapsedMs == null ? '用时待确认' : clock(integer(row.elapsedMs)) });
  return { mode: data.mode, list: data.list.map(item), me: data.me ? item(data.me) : null };
}
module.exports = { project, clock };
