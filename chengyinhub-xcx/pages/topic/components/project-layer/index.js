// 工作台叠层:与 project-drawer 同一套面板,只是顶端比下一层低一点;展示组件,返回从 bind:back 冒泡。
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

Component({
  // 叠层景深由 behaviors/sheet-depth.js 按打开顺序统一判定(_under),页面不再逐个传 under
  behaviors: [sheetDepth],
  options: { multipleSlots: true, addGlobalClass: true },
  properties: {
    show:  { type: Boolean, value: false },
    title: { type: String, value: '' },
    // 2 = 叠在抽屉上,3 = 再叠一层;每深一层顶端再低 12px
    depth: { type: Number, value: 2 },
  },
  data: { panelTop: 69 },
  lifetimes: {
    // L06-107:created 里直接写进初始数据(此时还没渲染),attached 只在没写上时补一次 setData
    created() { const top = sheetTop(); if (top) this.data.panelTop = top; },
    attached() { const top = sheetTop(); if (top && top !== this.data.panelTop) this.setData({ panelTop: top }); },
  },
  methods: {
    noop() {},
    onBack() { this.triggerEvent('back'); },
  },
});
