// cy-playkit-timewindow · 「还没到开播时间」(Figma v5.1,node 45:293)
//
// 倒计时只在本组件里跑,并且**只倒计时不判开放**:到 0 时向上发 open 事件,由页面重新问
// 服务端拿状态。本地时钟到点就自己开门 = 把开放判定交给用户改手机时间。
const TICK_MS = 1000;

/** 纯函数:剩余秒 → HH:MM:SS。负数与非数字一律归零(不显示 "-1:59:59")。 */
function formatClock(seconds) {
  const total = seconds > 0 ? Math.floor(seconds) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => (n < 10 ? '0' + n : String(n));
  return pad(h) + ':' + pad(m) + ':' + pad(s);
}

const reducedMotionBehavior = require('../../../../behaviors/reduced-motion.js');
const motion = require('../../../../utils/motion.js');
// 2026-08-27 触感:只落在「订阅开播提醒」上;倒计时归零不震(用户多半没在看)。
Component({
  behaviors: [reducedMotionBehavior],
  properties: {
    inline: { type: Boolean, value: false }, // 故事流内嵌:不出半屏,原位渲染
    show:      { type: Boolean, value: false },
    eyebrow:   { type: String,  value: '时段限定' },
    glyph:     { type: String,  value: '🌙' },
    title:     { type: String,  value: '还没到开播时间' },
    openFrom:  { type: String,  value: '' },
    openTo:    { type: String,  value: '' },
    remainSeconds: { type: Number, value: 0 },
    subscribed:    { type: Boolean, value: false },
  },
  data: {
    clock: '00:00:00',
  },
  observers: {
    'remainSeconds, show': function (remainSeconds, show) {
      this._stop();
      // 剩余秒只是倒计时的内部游标,不进 data:wxml 只渲染 clock,进 data 就是一个永远没人看的字段
      this._left = remainSeconds > 0 ? Math.floor(remainSeconds) : 0;
      // L02-177: 记绝对到点时刻,每跳按墙钟算剩余 —— 切后台时计时器被压慢,回来不会多出时间
      this._deadline = Date.now() + this._left * 1000;
      this.setData({ clock: formatClock(this._left) });
      if (show && this._left > 0) this._start();
    },
  },
  lifetimes: {
    detached() { this._stop(); },
  },
  // L02-177: 后台不空跑;回前台先按墙钟对一次再接着走(到点就照常请页面回服务端问)
  pageLifetimes: {
    hide() { this._stop(); },
    show() {
      if (!this.data.show || this._timer || !(this._left > 0)) return;
      this._tick();
      if (this._left > 0) this._start();
    },
  },
  methods: {
    _formatClock: formatClock,   // 纯算法出口,供单测直接验边界

    _start() {
      this._timer = setInterval(() => this._tick(), TICK_MS);
    },
    _tick() {
      this._left = Math.max(0, Math.ceil((this._deadline - Date.now()) / 1000));
      if (this._left <= 0) {
        this._stop();
        this.setData({ clock: formatClock(0) });
        // 到点不自己开门:让页面回服务端问一次,本地时钟不是权威
        this.triggerEvent('open');
        return;
      }
      this.setData({ clock: formatClock(this._left) });
    },
    _stop() {
      if (this._timer) { clearInterval(this._timer); this._timer = null; }
    },

    onSubscribe() {
      if (this.data.subscribed) return;
      // 订阅成功是一次真实承诺,给一记确认。倒计时归零那一下**不震** ——
      // 用户多半没在看这一屏,凭空震一下是打扰不是反馈。
      motion.haptic({ reducedMotion: this.data.reducedMotion });
      this.triggerEvent('subscribe');
    },
    onClose() { this.triggerEvent('close'); },
  },
});
