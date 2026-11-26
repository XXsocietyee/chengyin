'use strict';
// pages/play 只用到精确整数 id、分值格式、结算判定与范围比对;完整的成绩页投影只留在
// subpackageMember/utils/orient-score-view.js(成绩页在那个分包)。L02-053
function integer(value) {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) return '';
  if (typeof value !== 'number' && typeof value !== 'string') return '';
  const text = String(value);
  if (!/^-?(0|[1-9]\d*)$/.test(text)) return '';
  const digits = text.replace(/^-/, '');
  const limit = text[0] === '-' ? '9223372036854775808' : '9223372036854775807';
  return digits.length < 19 || digits.length === 19 && digits <= limit ? text : '';
}
function id(value) { const text = integer(value); return text && text !== '0' && text[0] !== '-' ? text : ''; }
function centi(value, signed) {
  const text = integer(value);
  if (!text) return '—';
  const digits = text.replace(/^-/, '').padStart(3, '0');
  return (text[0] === '-' ? '-' : signed && text !== '0' ? '+' : '')
    + digits.slice(0, -2) + '.' + digits.slice(-2) + ' 分';
}
function precise(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value);
  if (Array.isArray(value)) return value.every(precise);
  if (value && typeof value === 'object') return Object.keys(value).every(key => precise(value[key]));
  return true;
}
function sameScope(data, target) {
  return !!data && !!id(data.sessionId) && (!target.sessionId || id(data.sessionId) === target.sessionId)
    && (!target.activityId || integer(data.activityId) === target.activityId)
    && (!target.topicId || id(data.topicId) === target.topicId);
}
function settled(data, sessionId) {
  return !!data && data.state === 'SETTLED' && id(data.sessionId) === sessionId
    && !!id(data.settlementId) && !!integer(data.totalCenti)
    && /^\d+$/.test(integer(data.pointsAwarded)) && /^\d+$/.test(integer(data.xpAwarded));
}
// L02-054: 局阶段文案只此一份(orient-lifecycle 引用)
const PHASES = { PREPARED: '待开始', RUNNING: '进行中', FINISHED: '已完成', ABANDONED: '已放弃', DISQUALIFIED: '已取消资格' };

module.exports = { integer, id, centi, precise, sameScope, settled, PHASES };
