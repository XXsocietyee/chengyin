'use strict';
// L07-110:商家页「当前账号」与「无权限」判据只此一份(客户 / 账本 / 营销 / 店铺参谋原来各抄一份)。

/** 当前登录会员 ID 的字符串形式;未登录返回 ''。app 由页面传入(页面顶部的 getApp())。 */
function memberIdOf(app) {
  if (!app || typeof app.getUserID !== 'function') return '';
  const memberId = app.getUserID();
  return memberId === null || memberId === undefined ? '' : String(memberId);
}

/** 业务码或 HTTP 状态任一是 401/403 即无权限(L07-149 业主默认 A)。 */
function isAccessDenied(res) {
  if (!res) return false;
  return ['401', '403'].includes(String(res.code)) || ['401', '403'].includes(String(res.statusCode));
}

// L07-141:登录态失效判据(team / reviews 原来各抄一份):HTTP 401 或业务码 2(会话失效)
function isAuthenticationFailure(res, status) {
  const candidates = [status, res && res.statusCode, res && res.code];
  for (let index = 0; index < candidates.length; index += 1) {
    const code = String(candidates[index] == null ? '' : candidates[index]);
    if (code === '401' || code === '2') return true;
  }
  return false;
}

module.exports = { memberIdOf, isAccessDenied, isAuthenticationFailure };
