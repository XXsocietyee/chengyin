'use strict';
// 选点失败统一处理:取消不打扰;权限被拒给「去设置」;其他失败如实说明。
// 与 pages/merchant/apply openLocationPicker 的 fail 分支同口径。
const modal = require('../../../utils/modal.js');

function handleLocationPickFailure(err) {
  const message = String((err && err.errMsg) || '');
  if (/cancel/i.test(message)) return false;
  const denied = /auth deny|authorize|permission/i.test(message);
  modal.show({
    title: '无法选择位置',
    content: denied ? '请开启定位权限后重试。' : '地图暂时无法打开，请稍后重试。',
    confirmText: denied ? '去设置' : '知道了',
    cancelText: '稍后再试',
    showCancel: denied,
    success(result) {
      if (denied && result && result.confirm) wx.openSetting();
    }
  });
  return true;
}

module.exports = { handleLocationPickFailure };
