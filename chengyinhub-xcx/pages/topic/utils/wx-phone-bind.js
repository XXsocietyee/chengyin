/* 微信手机号绑定一次请求(与 pages/gerenziliao/gerenziliao.js getPhoneNumber 同一合同):
   getPhoneNumber 回调的 code → POST /api/getwxbindphone → 回包里取出合法手机号。
   getPhoneNumber 是付费接口:只在用户点按钮后调用一次,这里不自动发、不重试。
   空号保护:200 但取不出合法手机号仍算失败(c5e491e)。
   放在 pages/topic 分包内:只有结算层用,不占主包;资料页仍用自己的实现(其沙箱测试按白名单装依赖)。 */
const { isValidMobile } = require('../../../utils/form-state.js');

function boundPhoneFromResponse(res) {
  if (!res) return '';
  const candidates = [];
  if (typeof res.data === 'string') candidates.push(res.data);
  if (res.data && typeof res.data === 'object' && typeof res.data.phone === 'string') candidates.push(res.data.phone);
  if (typeof res.msg === 'string') candidates.push(res.msg);
  for (let i = 0; i < candidates.length; i++) {
    const phone = String(candidates[i]).trim();
    if (isValidMobile(phone)) return phone;
  }
  return '';
}

/* detail = getPhoneNumber 事件的 e.detail;done({ ok, phone } | { ok: false, cancelled?, msg })。
   未授权 / 无 code 时不发请求。返回 true 表示真的发出了绑定请求。 */
function bindWxPhone(app, detail, done) {
  if (!detail || detail.errMsg !== 'getPhoneNumber:ok') { done({ ok: false, cancelled: true, msg: '您已取消授权' }); return false; }
  const code = detail.code;
  if (!code) { done({ ok: false, msg: '获取手机号失败' }); return false; }
  app.sendRequest({
    url: '/api/getwxbindphone',
    method: 'POST',
    hideLoading: true,
    data: { code: code },
    success(res) {
      if (res && res.code == '200') {
        const phone = boundPhoneFromResponse(res);
        if (phone) { done({ ok: true, phone: phone }); return; }
      }
      done({ ok: false, msg: (res && res.msg) || '获取手机号失败' });
    },
    fail() { done({ ok: false, msg: '网络错误，请重试' }); },
  });
  return true;
}

module.exports = { bindWxPhone, boundPhoneFromResponse };
