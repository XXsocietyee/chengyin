'use strict';
// B1:线上脚本错误/未处理的 Promise 拒绝 → 微信「实时日志」(小程序管理后台 → 开发 → 运维中心 → 实时日志)。
// 脱敏:长数字(手机号/订单号/openid 片段)、长令牌串一律打码;截断;同一消息只报一次,单次启动最多 10 条。
const MAX_REPORTS = 10;
const seen = Object.create(null);
let reported = 0;

function sanitize(value) {
  let text = '';
  if (value instanceof Error) text = (value.message || '') + '\n' + (value.stack || '');
  else if (typeof value === 'string') text = value;
  else { try { text = JSON.stringify(value); } catch (e) { text = String(value); } }
  return String(text || '')
    .replace(/Bearer\s+\S+/gi, 'Bearer ***')
    .replace(/[A-Za-z0-9._~+/=-]{24,}/g, '***')
    .replace(/\d{7,}/g, '#')
    .slice(0, 400);
}

function reportClientError(kind, value, deps) {
  const wxApi = (deps && deps.wx) || (typeof wx !== 'undefined' ? wx : null);
  if (!wxApi || reported >= MAX_REPORTS) return false;
  const message = sanitize(value);
  const key = kind + ':' + message.slice(0, 120);
  if (!message || seen[key]) return false;
  seen[key] = true;
  reported += 1;
  try {
    const log = typeof wxApi.getRealtimeLogManager === 'function' ? wxApi.getRealtimeLogManager() : null;
    if (!log) return false;
    if (typeof log.addFilterMsg === 'function') log.addFilterMsg('client_error');
    log.error('client_error', kind, message);
    return true;
  } catch (e) { return false; }
}

function resetClientErrorReports() { reported = 0; for (const k of Object.keys(seen)) delete seen[k]; }

module.exports = { reportClientError, sanitize, resetClientErrorReports, MAX_REPORTS };
