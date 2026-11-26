'use strict';
// L07-086:品牌中心四页(首页 / 承接设置 / 门店相册 / 常备权益)共用的请求失败分类,原来四页逐字各抄一份。

/** 后端原话优先,没有原话用兜底句。app 由页面传入。 */
function requestText(app, error, fallback) {
  if (app && app.getRequestErrorMessage) return app.getRequestErrorMessage(error, fallback);
  return error && error.msg ? String(error.msg) : fallback;
}

/** 失败分三类:permission(401/403 或资格原话)/ network(设备断网)/ data(其它,带后端原话)。 */
function classifyFailure(app, error, fallback, permissionText) {
  const code = error && (error.statusCode !== undefined ? error.statusCode : error.code);
  const message = error && error.msg ? String(error.msg) : '';
  if (String(code) === '401' || String(code) === '403'
      || /仅.*商家|商家资格|无权限|没有权限|权限不足|审核通过.*商家/.test(message)) {
    return { kind: 'permission', text: permissionText };
  }
  const transportText = error && typeof error === 'object' ? String(error.errMsg || '') : '';
  if (code === undefined && /request:fail|timeout|network|网络|断网/i.test(transportText)) {
    return { kind: 'network', text: '网络异常，请重试。' };
  }
  return { kind: 'data', text: requestText(app, error, fallback) };
}

module.exports = { requestText, classifyFailure };
