/* 路线进度条(2026-10-22 业主):
   · 进入视野后**只走一遍**,快速填到真实进度,颜色由浅渐深;
   · 每过一个章节点亮一个小圆点,并冒出「第 N 章 ✓」;
   · 只有真的全部完成才开宝箱庆祝,不会自己归零重来。
   进度只认后端已下发的 unlockedChapterCount / totalChapterCount,没买或没开局就是 0,不演示假进度。 */
const DUR = 2200;
// easeOutCubic 的反函数:已知进度 p 求到达时刻,用来安排每个圆点何时点亮
const timeAt = (p) => 1 - Math.cbrt(1 - p);

Component({
  options: { styleIsolation: 'isolated' },
  properties: {
    total: { type: Number, value: 0 },
    done: { type: Number, value: 0 },
    labels: { type: Array, value: [] },
    tone: { type: String, value: 'city' },
    reducedMotion: { type: Boolean, value: false },
  },
  data: { marks: [], fill: 0, lit: 0, win: false, running: false, plus: '', msg: '' },
  observers: {
    'total, done, labels'() { this._prepare(); },
  },
  lifetimes: {
    // L06-128:创建时属性 observer 已经 _prepare 过就不再来一遍
    attached() { if (!this._prepared) this._prepare(); },
    ready() { this._ready = true; this._observe(); },
    detached() { this._ready = false; if (this._io) this._io.disconnect(); this._io = null; this._clear(); },
  },
  methods: {
    _clear() { (this._timers || []).forEach(clearTimeout); this._timers = []; },
    // L06-030:.rp 只在 total > 0 时渲染。首次打开时进度还没到,ready 里挂不上;
    // 每次真实进度到达、节点渲染出来后重新挂一次观察器(先断开旧的)。
    _observe() {
      if (!this._ready || !(Number(this.data.total) > 0)) return;
      if (this._io) this._io.disconnect();
      const io = this.createIntersectionObserver({ thresholds: [0.35] });
      this._io = io;
      io.relativeToViewport().observe('.rp', (res) => { if (res.intersectionRatio >= 0.35) this._play(); });
    },
    _prepare() {
      this._prepared = true;
      this._clear(); this._played = false;
      const n = Math.max(0, Number(this.data.total) || 0);
      const marks = [];
      const cur = Math.max(0, Math.min(n, Number(this.data.done) || 0));
      // 站点多于 7 个时标签挤在一起:只留首、尾和当前站(离首尾至少隔一格),圆点照旧
      const fits = (i) => n <= 7 || i === 1 || i === n - 1 || (i === cur && i >= 3 && i <= n - 3);
      for (let i = 1; i < n; i++) marks.push({ left: (i / n * 100).toFixed(2), label: (this.data.labels || [])[i - 1] || ('第 ' + i + ' 段'), show: fits(i) });
      this.setData({ marks, fill: 0, lit: 0, win: false, running: false, plus: '',
        msg: this.data.tone === 'free' ? '没有固定顺序，去一家亮一格' : '按顺序到站，一章一章点亮' }, () => this._observe());
    },
    _play() {
      if (this._played) return;
      this._played = true;
      const n = Math.max(0, Number(this.data.total) || 0);
      const d = Math.max(0, Math.min(n, Number(this.data.done) || 0));
      if (!n) return;
      const target = d / n;
      if (this.data.reducedMotion) { this.setData({ fill: target * 100, lit: Math.min(d, n - 1), win: d === n && n > 0 }); return; }
      this.setData({ running: true, fill: target * 100 });
      // 填充本身由 CSS 过渡完成(时长 DUR、缓出);这里只按时间表点亮圆点
      for (let k = 1; k <= Math.min(d, n - 1); k++) {
        const t = timeAt((k / n) / target) * DUR;
        this._timers.push(setTimeout(() => {
          const m = this.data.marks[k - 1] || {};
          this.setData({ lit: k, plus: this.data.tone === 'free' ? '+1 · ' + (m.label || '') : (m.label || '') + ' ✓', plusLeft: m.left }); // 原型:城市定向「第一章 ✓」,自由探索「+1 · 店名」
        }, t));
      }
      this._timers.push(setTimeout(() => {
        const all = d === n;
        this.setData({ running: false, plus: '', win: all || this.data.win,
          msg: all ? (this.data.tone === 'free' ? '全部到访，宝箱已打开' : '全部章节完成，宝箱已打开') : this.data.msg });
      }, DUR + 60));
    },
  },
});
