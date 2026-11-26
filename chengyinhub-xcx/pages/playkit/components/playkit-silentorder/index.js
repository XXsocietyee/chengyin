// cy-playkit-silentorder · 沉默点单 · 店员见证制(Figma v5.1,node 46:295)
//
// 计时是"已表演多久"的正计时,纯陪伴用:它不参与判定,判定发生在店员扫见证码那一刻。
// 所以组件断电重开时从 elapsedSeconds 续,不试图自己持久化。
// 秒 → MM:SS 用仓库已有的那一份(utils/play-ui-contract),不在这里再写一遍
const { formatElapsed } = require('../../../../utils/play-ui-contract.js');

const TICK_MS = 1000;

const reducedMotionBehavior = require('../../../../behaviors/reduced-motion.js');
const motion = require('../../../../utils/motion.js');
// 2026-08-27 触感:落在「放弃」这一下 —— 不可逆的动作才该有手感。
Component({
  behaviors: [reducedMotionBehavior],
  properties: {
    inline: { type: Boolean, value: false }, // 故事流内嵌:不出半屏,原位渲染
    show:    { type: Boolean, value: false },
    eyebrow: { type: String,  value: '沉默点单 · 店员见证制' },
    title:   { type: String,  value: '' },
    rule:    { type: String,  value: '' },
    qrUrl:   { type: String,  value: '' },
    elapsedSeconds: { type: Number, value: 0 },
  },
  data: {
    clock: '00:00',
  },
  observers: {
    'elapsedSeconds, show': function (elapsedSeconds, show) {
      this._stop();
      // 同 timewindow:秒数是内部游标,wxml 只渲染 clock,进 data 会变成没人渲染的死字段
      this._elapsed = elapsedSeconds > 0 ? Math.floor(elapsedSeconds) : 0;
      // L02-177: 记起点时刻,每跳按墙钟算已过秒数 —— 切后台回来不会慢半拍
      this._t0 = Date.now() - this._elapsed * 1000;
      this.setData({ clock: formatElapsed(this._elapsed) });
      if (show) this._start();
    },
  },
  lifetimes: {
    detached() { this._stop(); },
  },
  // L02-177: 后台不空跑;回前台按墙钟对一次再接着走
  pageLifetimes: {
    hide() { this._stop(); },
    show() {
      if (!this.data.show || !this._t0 || this._timer) return;
      this._tick();
      this._start();
    },
  },
  methods: {
    _formatElapsed: formatElapsed,   // 纯算法出口,供单测

    _start() {
      this._timer = setInterval(() => this._tick(), TICK_MS);
    },
    _tick() {
      this._elapsed = Math.max(0, Math.floor((Date.now() - this._t0) / 1000));
      this.setData({ clock: formatElapsed(this._elapsed) });
    },
    _stop() {
      if (this._timer) { clearInterval(this._timer); this._timer = null; }
    },

    onGiveUp() {
      this._stop();
      this._t0 = 0;   // 放弃后回前台不再续表
      // 放弃是不可逆的(这一轮表演就结束了),给 medium —— 与「作答」同级
      motion.haptic({ reducedMotion: this.data.reducedMotion, type: 'medium' });
      this.triggerEvent('giveup', { elapsedSeconds: this._elapsed || 0 });
    },
    onClose() { this.triggerEvent('close'); },
  },
});
