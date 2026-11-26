const reducedMotionBehavior = require('../../../../behaviors/reduced-motion.js');

// cy-slide-confirm · 滑动确认条(Figma 3965:17359)
//
// 三态与稿子一一对应:
//   default → 蓝底,圆钮在左,文案是 label
//   release → 拖过阈值,底色转渐变,文案换 releaseLabel(松手即确认)
//   done    → 已确认,绿底 + 勾
//
// ⚠️ 为什么不用简单按钮:这条用在「核销」「领勋章」这种一按下去就不可撤销的动作上,
//    滑动是刻意的防误触闸(稿子把它单列成一页规格,就是这个意思)。
const TRACK = 300;   // 稿子:轨道 300pt
const KNOB = 40;     // 稿子:圆钮 40pt
const PAD = 8;       // 稿子:内边距 8pt

Component({
  behaviors: [reducedMotionBehavior],
  options: { addGlobalClass: true },
  properties: {
    label:        { type: String, value: '滑动确认' },
    releaseLabel: { type: String, value: '松手确认' },
    doneLabel:    { type: String, value: '已确认' },
    disabled:     { type: Boolean, value: false },
    reduced:      { type: Boolean, value: false },
  },
  data: { x: 0, state: 'default', dragging: false },
  // L05-077:轨道在 ready 量(attached 时占位还没换成真组件,常量 0 会退回 300 的稿子宽度),每次按下再量一次
  lifetimes: { ready() { this._measure(); } },
  methods: {
    // 减少动态时不播放拖动过程，退化成点按；调用方仍负责确认动作的业务安全。
    onTap() {
      if (this.data.disabled || !(this.data.reduced || this.data.reducedMotion)) return;   // 两个减少动态来源同一口径
      this._fire();
    },
    _measure() {
      if (typeof this.createSelectorQuery !== 'function') return;
      this.createSelectorQuery().select('.sc').boundingClientRect((r) => {
        if (r && r.width) { this._w = r.width; this._left = r.left || 0; }
      }).exec();
    },
    onStart() {
      if (this.data.disabled || this.data.state === 'done') return;
      this._dragging = true;
      this._measure();
      this.setData({ dragging: true });   // 拖动时钮不带过渡,跟手
    },
    // 每次 touchmove 只写位置;状态只在跨过阈值时写一次(原来每帧连同不渲染的 pct 一起发)
    onMove(e) {
      if (!this._dragging || this.data.disabled) return;
      const left = Number.isFinite(this._left) ? this._left : 0;
      const w = this._w || TRACK;
      const max = Math.max(1, w - KNOB - PAD * 2);
      const x = Math.min(max, Math.max(0, e.touches[0].clientX - left - KNOB / 2));
      const state = x / max > 0.92 ? 'release' : 'default';
      if (state !== this.data.state) this.setData({ x, state });
      else this.setData({ x });
    },
    onEnd() {
      if (!this._dragging) return;
      this._dragging = false;
      if (this.data.state === 'release') return this._fire();
      this.setData({ x: 0, state: 'default', dragging: false });   // 没滑到底就弹回,不算数
    },
    onCancel() {
      if (!this._dragging) return;
      this._dragging = false;
      this.setData({ x: 0, state: 'default', dragging: false });
    },
    _fire() {
      if (this.data.state === 'done') return;
      this._dragging = false;
      this.setData({ state: 'done', dragging: false });
      this.triggerEvent('confirm');
    },
  },
});
