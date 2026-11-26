/**
 * 协作邀约 coop_invite.status 显式状态表（与后端 CoopInvite.status 同值域）。
 * 迁移由服务端执行：待确认 → 已接受 / 已拒绝 / 已取消 / 已顶替 / 已过期；其余为终态。
 * 只做展示与本地守卫；状态真源永远是服务端。未知码一律落 unknown（不猜成某个已知态）。
 * L10-111:原通用工厂 utils/state-machine.js 只有这一张表在用,已并入本文件。
 */
'use strict';

const STATES = Object.freeze([
  { code: 0, key: 'pending', label: '待确认', badge: 'pending:clock' },
  { code: 1, key: 'accepted', label: '已接受', badge: 'accepted:check' },
  { code: 2, key: 'rejected', label: '已拒绝', badge: 'rejected:warning' },
  { code: 3, key: 'cancelled', label: '已取消', badge: 'muted:close-sm' },
  { code: 4, key: 'replaced', label: '已顶替', badge: 'muted:close-sm' },
  { code: 5, key: 'expired', label: '已过期', badge: 'muted:close-sm' },
].map(Object.freeze));
// 未列出的 key 视为终态
const TRANSITIONS = { pending: ['accepted', 'rejected', 'cancelled', 'replaced', 'expired'] };

function normalizeCode(code) {
  if (typeof code === 'number') return Number.isInteger(code) ? code : null;
  if (typeof code === 'string' && /^-?\d+$/.test(code.trim())) return Number(code.trim());
  return null;
}
function stateOf(code) {
  const n = normalizeCode(code);
  return n === null ? null : (STATES.find((s) => s.code === n) || null);
}
function targets(code) {
  const s = stateOf(code);
  return s ? (TRANSITIONS[s.key] || []).slice() : [];
}

const COOP_INVITE_STATUS = Object.freeze({
  name: 'coopInvite',
  states: STATES,
  stateOf,
  keyOf(code) { const s = stateOf(code); return s ? s.key : 'unknown'; },
  /** 未知码返回 fallback（默认 ''），不把未知显示成任何已知态。 */
  label(code, fallback) { const s = stateOf(code); return s ? s.label : (fallback === undefined ? '' : fallback); },
  /** 按 code 下标排好的数组，供保留旧数组导出的模块派生使用。 */
  toArray(field) { return Object.freeze(STATES.map((s) => s[field])); },
  isKnown(code) { return !!stateOf(code); },
  isTerminal(code) { return !!stateOf(code) && targets(code).length === 0; },
  targets,
  can(from, to) { const t = stateOf(to); return !!t && targets(from).indexOf(t.key) >= 0; },
});

module.exports = { COOP_INVITE_STATUS, normalizeCode };
