// 深链兼容壳。RunCard 与汇总正文只在 scene-roam-history 维护(本页也是应用内「漫游记录」的入口)。
const app = getApp()
// L05-148:连点只推一层
function go(page, url) {
  if (page._navigating) return
  page._navigating = true
  wx.navigateTo({ url, complete: () => { page._navigating = false } })
}

Page({
  // 漫游记录里的那年今日 / 月度回顾 / 导出(2026-10-14 随漫游上线):弹窗组件只发事件,跳转在宿主页
  openRoamTool(e) {
    const key = e && e.detail && e.detail.key;
    if (key === 'anniversary') go(this, '/subpackageTools/anniversary/index');
    else if (key === 'recap') go(this, '/subpackageTools/monthly-recap/index');
    else if (key === 'export') go(this, '/subpackageTools/exploration-export/index');
  },
  data: {
    statusBarHeight: app.globalData.statusBarHeight,
    navBarHeight: app.globalData.navBarHeight,
    guest: false,
  },
  // L05-148:游客在登录闸下不挂历史组件(它挂上就读账号历史),与 citynode-code 一致;登录后闸会重开本页
  onLoad() { this.setData({ guest: !(typeof app.getUserID === 'function' && app.getUserID()) }) },
  openSession(event) {
    const detail = event.detail || {}
    go(this, `/subpackageRoam/session/index?ts=${encodeURIComponent(detail.params && detail.params.ts || '')}&sessionId=${encodeURIComponent(detail.params && detail.params.sessionId || '')}`)
  },
  goBack() {
    if (getCurrentPages().length > 1) wx.navigateBack()
    else wx.switchTab({ url: '/pages/roam/index' })
  },
})
