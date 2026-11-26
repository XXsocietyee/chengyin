const { resolveMenuChrome } = require('../../../../utils/nav-safe-area.js');
const sheetDepth = require('../../../../behaviors/sheet-depth.js');

// L06-107:胶囊与窗口坐标整个运行期不变,本组件所有实例只量一次(主办页一次挂 5 个抽屉 / 6 个叠层)
let sheetTopCache = 0;
function sheetTop() {
  if (!sheetTopCache) {
    try {
      const win = (wx.getWindowInfo && wx.getWindowInfo()) || wx.getSystemInfoSync();
      const capsule = wx.getMenuButtonBoundingClientRect && wx.getMenuButtonBoundingClientRect();
      sheetTopCache = resolveMenuChrome(win, capsule).sheetTop;
    } catch (e) { /* 保留导航坐标缺失时的兜底。 */ }
  }
  return sheetTopCache;
}

// 项目抽屉外壳。只管遮罩、面板、标题与底部动作。
// 内容由调用方用 slot 填,动作按 key 冒泡回去。
Component({
  // 叠层景深由 behaviors/sheet-depth.js 按打开顺序统一判定(_under),页面不再逐个传 under
  behaviors: [sheetDepth],
  options: { addGlobalClass: true, multipleSlots: false },
  properties: {
    show:    { type: Boolean, value: false },
    compact: { type: Boolean, value: false },
    title:   { type: String,  value: '' },
    // 稿 468:960/1009/1086/1126:四套抽屉的标题下面都有一句「这一套为什么长这样」,
    // 商家一打开就知道现在这个状态能做什么、不能做什么,不用逐行试。
    subtitle: { type: String, value: '' },
    // CU-C-126 删掉了 headerVariant:'action' 档(取消/完成都只执行 onClose、面板内无待保存表单),
    // 所有抽屉统一走「标题 + 右上角 ✕」,主动作只在底部 actions 那一行。
    // 客户名单使用普通半屏，其余长列表避开微信导航。
    customerMode: { type: Boolean, value: false },
    doneText: { type: String, value: '' }, // 2026-11-01 客户多选:右上角关闭换成「完成」
    // [{ key, label, ghost? }],最多两个并排
    actions: { type: Array,   value: [] },
  },
  data: { panelTop: 69 },
  lifetimes: {
    // L06-107:created 里直接写进初始数据(此时还没渲染),attached 只在没写上时补一次 setData
    created() { const top = sheetTop(); if (top) this.data.panelTop = top; },
    attached() { const top = sheetTop(); if (top && top !== this.data.panelTop) this.setData({ panelTop: top }); },
  },
  methods: {
    noop() {},
    onClose() { this.triggerEvent('close'); },
    onAction(e) {
      this.triggerEvent('action', { key: e.currentTarget.dataset.key });
    },
  },
});
