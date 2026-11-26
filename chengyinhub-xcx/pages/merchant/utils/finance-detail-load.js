'use strict';
// L07-134:账本两张详情页(订单 / 对公批次)共用的加载收尾与失败判据,原来两页逐行各抄一份。

// wx 由页面传入(页面里的全局 wx),本模块不直接碰全局
function stopPullDownRefresh(api) {
  if (api && typeof api.stopPullDownRefresh === 'function') api.stopPullDownRefresh();
}

/** 只有当前这一轮加载能收尾;旧轮回调返回 false。 */
function settleLoad(page, epoch, api) {
  if (epoch !== page._loadEpoch) return false;
  page._loading = false;
  stopPullDownRefresh(api);
  return true;
}

function isTransportFailure(error) {
  if (!error || typeof error !== 'object') return false;
  if (error.statusCode !== undefined || error.code !== undefined) return false;
  return /request:fail|timeout|network|网络|断网/i.test(String(error.errMsg || ''));
}

// L07-135:先认状态码 404,再认服务端原话(旧服务端只给中文 msg)
function isMissingRecordResponse(response) {
  if (!response) return false;
  if (String(response.code) === '404' || String(response.statusCode) === '404') return true;
  return /记录(?:不可见|不存在)/.test(String(response.msg || ''));
}

function hasValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

module.exports = { stopPullDownRefresh, settleLoad, isTransportFailure, isMissingRecordResponse, hasValue };
