// 分包占位页:微信要求每个分包至少一页,否则 preloadRule 找不到 subpackagePublishkit。
// 本分包只放创作页(pages/publish)的非首屏组件,没有任何入口指向这一页;万一误入,直接回首页。
Page({
  onLoad() {
    wx.reLaunch({ url: '/pages/index/index' });
  },
});
