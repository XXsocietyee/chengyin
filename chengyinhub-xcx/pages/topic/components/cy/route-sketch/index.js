/* v13 路线小地图兜底:主题没有任何有效坐标时才出现(有坐标时页面直接给真实地图)。
   只画一次深色底 + 固定种子的示意街道,不代表真实道路;点一下打开真实地图。 */
function rng(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

Component({
  options: { styleIsolation: 'isolated' },
  lifetimes: { ready() { this._draw(); }, detached() { this._dead = true; } },
  methods: {
    onTap() { this.triggerEvent('open'); },
    _draw() {
      if (this._dead || typeof wx === 'undefined' || typeof wx.createSelectorQuery !== 'function') return;
      try {
        this.createSelectorQuery().select('#rscv').fields({ node: true, size: true }).exec((r) => {
          const n = r && r[0];
          if (!n || !n.node || this._dead) return;
          const cv = n.node, w = n.width, h = n.height, d = 2;
          cv.width = w * d; cv.height = h * d;
          const g = cv.getContext('2d');
          const R = rng(20261022);
          g.setTransform(d, 0, 0, d, 0, 0);
          g.fillStyle = '#15171b'; g.fillRect(0, 0, w, h); // ds-ok v13 地图底
          for (let i = 0; i < 9; i++) {
            const a = (R() - 0.5) * 0.9 + (i % 2 ? Math.PI / 2 : 0); const cx = R() * w, cy = R() * h; const wide = i % 3 === 0;
            g.strokeStyle = wide ? '#262a31' : '#1f232a'; g.lineWidth = wide ? 7 : 3; // ds-ok 示意街道
            g.beginPath(); g.moveTo(cx - Math.cos(a) * w, cy - Math.sin(a) * w); g.lineTo(cx + Math.cos(a) * w, cy + Math.sin(a) * w); g.stroke();
          }
        });
      } catch (e) { /* 画不出就留深色底 */ }
    },
  },
});
