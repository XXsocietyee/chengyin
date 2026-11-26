'use strict';

const { safeUserMessage } = require('../../../utils/transport/safe-user-message.js');

function rawText(error) {
  if (typeof error === 'string') return error;
  if (!error || typeof error !== 'object') return '';
  if (typeof error.msg === 'string' && error.msg) return error.msg;
  if (typeof error.message === 'string') return error.message;
  return '';
}

function looksLikeException(text) {
  return /typeerror|syntaxerror|urierror|referenceerror|rangeerror|evalerror|cannot read|is not a function|is not defined|is not iterable|request:fail|[a-z]*exception|\bat\s+\S+\(/i.test(text);
}

/** 店员能看的失败句。异常栈、传输层原文退回本场景的兜底，短业务文案照常留下。 */
function staffErrorText(error, fallback) {
  const raw = String(rawText(error) || '').trim();
  const safeFallback = fallback || '';
  if (!raw || looksLikeException(raw)) return safeFallback;
  return safeUserMessage(error, safeFallback || '请稍后重试');
}

module.exports = { staffErrorText };
