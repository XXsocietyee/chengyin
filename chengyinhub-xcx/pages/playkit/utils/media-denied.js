// 系统权限被拒(微信不会再弹授权框)时统一走 cyModal 引导「去设置」→ wx.openSetting。取消操作不算。
const cyModal = require('../../../utils/modal.js');

const GUIDE = {
  title: '打开相机和相册',
  content: '点右上角「···」→「设置」，打开「摄像头」和「相册」。',
  confirmText: '去设置',
  cancelText: '取消',
};

const PERMISSIONS = {
  media: GUIDE,
  camera: {
    title: '打开摄像头权限',
    content: '点「去设置」打开「摄像头」权限后即可拍摄，也可以从相册选图。',
    confirmText: '去设置',
    cancelText: '取消',
  },
  album: {
    title: '打开相册权限',
    content: '点「去设置」打开「添加到相册」权限后即可保存或选图。',
    confirmText: '去设置',
    cancelText: '取消',
  },
  mic: {
    title: '打开麦克风权限',
    content: '点「去设置」打开「麦克风」权限后即可继续挑战。',
    confirmText: '去设置',
    cancelText: '取消',
  },
  werun: {
    title: '打开微信运动权限',
    content: '点「去设置」打开「微信运动步数」权限后即可同步今日步数。',
    confirmText: '去设置',
    cancelText: '取消',
  },
};

function deniedBySystem(err) {
  return /auth|deny|denied|authorize|permission/i.test(String((err && err.errMsg) || ''));
}

/** 统一拒权引导:弹 cyModal 确认后才调 wx.openSetting(满足小程序点击态要求)。 */
function guidePermission(kind, opts) {
  const cfg = PERMISSIONS[kind] || GUIDE;
  const o = opts || {};
  try {
    cyModal.show(Object.assign({}, cfg, {
      success(r) {
        if (r && r.confirm && typeof wx !== 'undefined' && typeof wx.openSetting === 'function') {
          wx.openSetting({
            success(res) { if (typeof o.onReturn === 'function') o.onReturn(res); },
            fail() {},
          });
        }
      },
    }));
  } catch (e) { /* 无弹窗宿主或无原生 showModal 的沙箱静默跳过 */ }
}

/** chooseMedia 的 fail 回调用:被拒就弹引导并返回 true;取消/其它返回 false */
function guideIfDenied(err, kind) {
  if (!deniedBySystem(err)) return false;
  guidePermission(kind || 'media');
  return true;
}

module.exports = { GUIDE, PERMISSIONS, deniedBySystem, guidePermission, guideIfDenied };
