'use strict';

const installed = new WeakSet();
// 426「需更新」可借此补弹同一重启提示(每次启动至多一次)。
let promptCurrent = () => false;

function installAppUpdate(wxApi) {
  if (!wxApi || typeof wxApi.getUpdateManager !== 'function') return false;
  if (typeof wxApi.canIUse === 'function' && !wxApi.canIUse('getUpdateManager')) return false;
  let manager;
  try { manager = wxApi.getUpdateManager(); } catch (error) { return false; }
  if (!manager || typeof manager.onUpdateReady !== 'function'
      || typeof manager.onUpdateFailed !== 'function' || typeof manager.applyUpdate !== 'function') return false;
  if (installed.has(manager)) return true;
  installed.add(manager);
  let readyHandled = false;
  let failureHandled = false;
  let modalHandled = false;
  let modalShown = false;
  function promptRestart() {
    if (modalShown || typeof wxApi.showModal !== 'function') return false;
    try {
      wxApi.showModal({
        title: '新版本已就绪',
        content: '请先保存未保存的内容。立即重启小程序后，新版本才会生效。',
        confirmText: '立即重启', cancelText: '稍后',
        success(result) {
          if (modalHandled) return;
          modalHandled = true;
          if (!result || result.confirm !== true || result.cancel === true) return;
          try { manager.applyUpdate(); } catch (error) {
            showFailure('新版本未能启用，请稍后重新打开小程序');
          }
        },
      });
    } catch (error) { return false; /* 下载就绪不能替代用户明确确认。 */ }
    modalShown = true;
    return true;
  }
  promptCurrent = () => readyHandled && promptRestart();
  try {
    manager.onUpdateReady(() => {
      if (readyHandled) return;
      readyHandled = true;
      promptRestart();
    });
    manager.onUpdateFailed(() => showFailure('新版本下载失败，请稍后重新打开小程序'));
  } catch (error) { return false; }
  function showFailure(title) {
    if (failureHandled) return;
    failureHandled = true;
    if (typeof wxApi.showToast !== 'function') return;
    try { wxApi.showToast({ title, icon: 'none' }); } catch (error) {}
  }
  return true;
}

// 已就绪且未弹过才弹;true = 已弹出。
function promptUpdateIfAvailable() { return promptCurrent(); }

// ---- 以下原在 utils/update-manager.js(只转发 installAppUpdate 的一层壳),L10-111 并入 ----
// F-L6-09 更新提示 + 失效页兜底;app.js 接线见 CY-HANDOFF(#328)。

// = app.json pages[0](单测对齐)
const HOME_PAGE = 'pages/index/index';
// L10-114:只防循环(缺的正是上次兜底跳去的页)而不是一次启动只兜一次 —— 同一次启动里点第二张失效分享卡也要能落地。
let lastFallbackPath = '';

function wxOrNull(wxApi) {
  return wxApi || (typeof wx !== 'undefined' ? wx : null);
}

// 与既有 installAppUpdate(wx) 共用管理器,重复安装幂等。
function installUpdateManager(app, wxApi) {
  if (app) app.promptUpdateIfAvailable = promptUpdateIfAvailable;
  return installAppUpdate(wxOrNull(wxApi));
}

// 旧分享卡/下线页回首页;首页本身或上次兜底目标缺失时不跳,防循环。
function handlePageNotFound(res, wxApi) {
  const api = wxOrNull(wxApi);
  const missing = String((res && res.path) || '').replace(/^\//, '');
  if (missing === HOME_PAGE || missing === lastFallbackPath || !api || typeof api.reLaunch !== 'function') return false;
  const url = retiredPageTarget(missing, res && res.query) || '/' + HOME_PAGE;
  lastFallbackPath = url.replace(/^\//, '').split('?')[0];
  api.reLaunch({ url });
  return true;
}

// F14c:已下线的合集详情旧分享卡带着主题 id,落到对应主题页;其余失效页回首页。
function retiredPageTarget(path, query) {
  const id = String((query && query.id) || '');
  if (path === 'pages/topic/catalog/detail' && /^\d{1,19}$/.test(id)) return '/pages/topic/index/index?id=' + id;
  return '';
}

module.exports = { installAppUpdate, promptUpdateIfAvailable, HOME_PAGE, installUpdateManager, handlePageNotFound, retiredPageTarget };
