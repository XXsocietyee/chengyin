// P1-8 柜台手输核销码:码的归类交给服务端 POST /api/merchant/desk/redeem/resolve(只归类、不核销、不验签),
// 这里把它的回包变成与扫码同形的提交路由,之后走工作台同一条 _submitVerification 与结果面板。
// 提交端点只认扫码已在用的四个;服务端给出别的端点一律当作不可核销,不盲发。
const SUBMIT_ENDPOINTS = {
  '/api/verify/groupcode/redeem': '核销中...',
  '/api/registration/scan_dynamic_code': '验票中...',
  '/api/registration/scan_qr_code': '验票中...',
  '/api/coupon/verification': '核销中...',
};
const MAX_CODE_LENGTH = 512;
const record = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value) => (typeof value === 'string' ? value.trim() : '');

function manualCodeError(value) {
  const code = text(value);
  if (!code) return '请输入核销码';
  return code.length > MAX_CODE_LENGTH ? '核销码过长' : '';
}

/**
 * 归类回包 → 路由。
 *   { kind: 'route', code, url, data, loadingTitle, choice: null | { name, title, options: [{ value, label }] } }
 *   { kind: 'redirect', message, path }   码是好的,但要去另一个页面核销
 *   { kind: 'rejected', message }         不是可核销的码,或归类没成功(都没有发生核销)
 */
function manualRoute(response) {
  const rejected = (message) => ({ kind: 'rejected', message: message || '未能识别核销码，请重试' });
  if (!record(response)) return rejected();
  if (!(response.code === 200 || response.code === '200') || !record(response.data)) {
    return rejected(/[一-龥]/.test(text(response.msg)) ? text(response.msg) : '');
  }
  const view = response.data;
  if (view.accepted !== true) {
    const message = text(view.message) || '这不是城瘾的核销码';
    const path = text(view.redirectPath);
    return /^\/pages\/merchant\//.test(path) ? { kind: 'redirect', message, path } : rejected(message);
  }
  const form = record(view.form) ? view.form : {};
  const url = text(form.submitEndpoint);
  if (!Object.prototype.hasOwnProperty.call(SUBMIT_ENDPOINTS, url) || !Array.isArray(form.fields)) return rejected();
  const data = {};
  let choice = null;
  for (const field of form.fields) {
    const name = record(field) ? text(field.name) : '';
    if (!name) return rejected();
    if (field.widget === 'hidden' && typeof field.value === 'string' && field.value) { data[name] = field.value; continue; }
    const options = field.widget === 'select' && Array.isArray(field.options)
      ? field.options.filter((o) => record(o) && text(o.value) && text(o.label)).map((o) => ({ value: text(o.value), label: text(o.label) }))
      : [];
    // 一张表单至多一个必选项(旧静态码的「活动票 / 主题票」);其余形状不认。
    if (!options.length || options.length !== field.options.length || choice) return rejected();
    choice = { name, title: text(field.label) || '请选择', options };
  }
  if (!data.code) return rejected();
  return { kind: 'route', code: data.code, url, data, loadingTitle: SUBMIT_ENDPOINTS[url], choice };
}

/** 选完必选项后的最终路由;下标不在候选里返回 null。 */
function chosenRoute(route, index) {
  const option = route && route.choice && route.choice.options[index];
  if (!option) return null;
  return Object.assign({}, route, { data: Object.assign({}, route.data, { [route.choice.name]: option.value }), choice: null });
}

module.exports = { manualCodeError, manualRoute, chosenRoute, MAX_CODE_LENGTH };
