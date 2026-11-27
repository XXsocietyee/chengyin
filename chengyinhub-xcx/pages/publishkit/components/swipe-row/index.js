// cy-swipe-row · 列表编辑的一行(2026-10-28 文档二):左滑露出红色「删除」;editing 时左边红色减号、右边三条线拖动排序。
// 内容(一般是 cy-list-row)放默认 slot;就地展开的内容放 slot="xp",跟着这一行一起滑。
// 「一次只开一行」归父页:open 受控,左滑 / 点减号发 swipe {open},父页决定哪一行开。
// 拖动排序只算步数:松手发 move {from, to},数组怎么挪由父页做 —— 组件不碰数据。
// 跟手在渲染层(swipe-row.wxs):touchmove 不 setData,松手才回到这里(AUDIT-1122 L04-020)。
const OPEN_RPX = 156;   // = 删除按钮宽,与 wxss .sw.is-open .sw__row 的 translateX(-156rpx) 同一个数

// rpx → px 按真实屏宽换算(以前按 2 倍屏粗算成 78px,414pt 宽的屏上松手会跳一下)
function openPx() {
  try {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const width = Number(info && info.windowWidth);
    if (width > 0) return Math.round(OPEN_RPX * width / 750 * 100) / 100;
  } catch (e) { /* 取不到屏宽就用 375 宽的值 */ }
  return OPEN_RPX / 2;
}

Component({
  options: { addGlobalClass: true, multipleSlots: true },
  properties: {
    index: { type: Number, value: 0 },
    count: { type: Number, value: 0 },
    open: { type: Boolean, value: false },
    editing: { type: Boolean, value: false },
    hr: { type: Boolean, value: false },
    deleteText: { type: String, value: '删除' },
    label: { type: String, value: '' },     // 读屏:这一行叫什么
    disabled: { type: Boolean, value: false },
  },
  data: { _dragging: false, _openPx: OPEN_RPX / 2 },
  lifetimes: {
    attached() { this.setData({ _openPx: openPx() }); },
  },
  methods: {
    // WXS 松手回调:横向滑过阈值才发 swipe
    onSwipeEnd(e) {
      const open = !!(e && e.open);
      if (!this.data.disabled && open !== this.data.open) this.triggerEvent('swipe', { index: this.data.index, open });
    },
    onMinus() { if (!this.data.disabled) this.triggerEvent('swipe', { index: this.data.index, open: !this.data.open }); },
    onDelete() { if (!this.data.disabled) this.triggerEvent('delete', { index: this.data.index }); },

    onGripStart() {
      if (this.data.disabled) return;
      this._drag = { h: 0 };
      this.createSelectorQuery().select('.sw').boundingClientRect((r) => {
        if (this._drag && r) this._drag.h = r.height;
      }).exec();
      this.setData({ _dragging: true });
    },
    onGripEnd(e) {
      const d = this._drag;
      this._drag = null;
      if (!d) return;
      const dy = Number(e && e.dy) || 0;
      const steps = d.h ? Math.round(dy / d.h) : 0;
      this.setData({ _dragging: false });
      const max = Math.max(0, (this.data.count || 1) - 1);
      const to = Math.max(0, Math.min(max, this.data.index + steps));
      if (to !== this.data.index) this.triggerEvent('move', { from: this.data.index, to });
    },
  },
});
