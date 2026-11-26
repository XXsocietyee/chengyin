/* ============================================================
 * 城瘾 主题机制(P0-1)—— 仅机制,不定世界观配色
 *
 * 业务区域的颜色走 CSS 变量(style/tokens.wxss),自动继承。
 * 但原生区域(导航栏/tabBar)吃不了 CSS 变量,必须 JS 同步 —— 这就是本文件的职责。
 *
 * 全站默认深色:app.js 启动即 applyTheme('dark');商家域等页面按需切 light。
 * ============================================================ */

// 原生导航栏配色表。
const NATIVE_THEMES = {
  light: { frontColor: '#000000', backgroundColor: '#ffffff' },
  dark:  { frontColor: '#ffffff', backgroundColor: '#020104' }, // 暗底:白字 + 虚空底(frontColor 仅支持 #fff/#000)
};

/**
 * 应用主题:记录到 globalData + 同步原生导航栏。
 * @param {'light'|'dark'} theme
 */
function applyTheme(theme) {
  const t = NATIVE_THEMES[theme] ? theme : 'light';
  const app = getApp();
  if (app && app.globalData) app.globalData.theme = t;

  const conf = NATIVE_THEMES[t];
  wx.setNavigationBarColor({
    frontColor: conf.frontColor,
    backgroundColor: conf.backgroundColor,
  });
  // Custom-navigation pages expose the webview/page canvas around the
  // component nav. Keep that native canvas in the same theme as the chrome;
  // otherwise a shared player/merchant page can show a dark status strip over
  // a light merchant surface (or the inverse) before its root view paints.
  if (typeof wx.setBackgroundColor === 'function') {
    wx.setBackgroundColor({
      backgroundColor: conf.backgroundColor,
      backgroundColorTop: conf.backgroundColor,
      backgroundColorBottom: conf.backgroundColor,
    });
  }
  return t;
}

module.exports = { applyTheme };
