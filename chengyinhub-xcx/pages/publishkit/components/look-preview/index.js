// 画面风格预览(发布页):常驻在画面风格面板顶部,给作者一个大概的样子 ——
// 同一份 look-fx(风格层粒子)副本,与玩家页逐字一致(theme-look.test.js 钉住)。
const themeLook = require('../../utils/publish/theme-look.js');
const lookFx = require('../../utils/publish/look-fx.js');
const PUNCT = /^[,.!?;:，。！？；：、」』）)…—]$/;
const GLYPH = 'ｱｲｳｴｵｶｷｸｹｺ01#%&*<>/=+';

// 每种风格的示例文案:让作者一眼认出这是哪种主题的样子(不是可配内容)
const SAMPLE = {
  STARDUST: { kick: '第一章', title: '提篮桥的方舟', story: '1938年11月的一个清晨，一艘邮轮停靠在黄浦江边。', opt: '走去霍山路' },
  PAPER: { kick: '档案 · 第七页', title: '救济点旧址', story: '名单上的字迹已经褪色，最后一行写着：明早六点，霍山路。', opt: '翻到下一页' },
  SURVIVAL: { kick: '外勤点 · 01', title: '风眼之前', story: '气象台说，风眼会在下午三点经过城区，停二十分钟。', opt: '趁风小出门' },
  CYBER: { kick: '// 第二站', title: '十一秒', story: '第三块灯牌又暗了。你数了数，正好十一秒。', opt: 'SOS，有人在求救' },
};

Component({
  // L04-095:调用方从不传 reduced-motion,改用全站的减少动态偏好(同 creation-success)
  behaviors: [require('../../../../behaviors/reduced-motion.js')],
  properties: {
    show: { type: Boolean, value: false },
    look: { type: Object, value: null },
    content: { type: Object, value: null },
  },
  data: { cls: '', sample: SAMPLE.STARDUST, fx: 'rise', fxIn: false, chars: null },
  observers: {
    'show, look, content'(show, look, content) {
      this._stop();
      if (!show) return;
      const n = themeLook.normalizeLook(look);
      this._look = n;
      const time = (n.times || []).find((t) => t);
      this.setData({ cls: themeLook.lookClass(n) + (time ? ' look-time--' + time.toLowerCase() : ''), sample: content || SAMPLE[n.style] });
      this._playText(n);
      // 等面板升起、画布有尺寸再开画;常驻时只是换风格,画布已在
      this._t = setTimeout(() => this._paint(), this._painted ? 0 : 360);
    },
  },
  lifetimes: { detached() { this._stop(); } },
  methods: {
    _stop() { clearTimeout(this._t); clearTimeout(this._fxT); (this._fxD || []).forEach(clearTimeout); if (this._cv && this._raf) this._cv.cancelAnimationFrame(this._raf); this._raf = 0; },
    _paint() {
      wx.createSelectorQuery().in(this).select('#lpfx').fields({ node: true, size: true }).select('#lpfront').fields({ node: true, size: true }).exec((res) => {
        const item = res && res[0]; if (!item || !item.node || !this.properties.show) return;
        // 字前面那张:近星 / 水珠 / 沙雾,与玩家页同一份 drawFront
        const fr = res[1] && res[1].node, fctx = fr && fr.getContext('2d');
        const cv = item.node, ctx = cv.getContext('2d'), dpr = (wx.getWindowInfo && wx.getWindowInfo().pixelRatio) || 2;
        cv.width = item.width * dpr; cv.height = item.height * dpr; ctx.scale(dpr, dpr); if (fr) { fr.width = item.width * dpr; fr.height = item.height * dpr; fctx.scale(dpr, dpr); }
        // 旧版尘点层(dustMod)对现行四种风格恒为 0 个,已删(L04-094)
        const W = item.width, H = item.height, state = lookFx.create(this._look, W, H);
        this._cv = cv; this._painted = true;
        // 减少动态或该风格没有粒子(纸本 kind:'none'):只清一帧,不挂 60fps 空转循环
        const still = this.data.reducedMotion || state.kind === 'none';
        const loop = () => {
          if (!this.properties.show) return;
          ctx.clearRect(0, 0, W, H);
          if (!still) lookFx.draw(state, ctx, W, H, Date.now());
          if (fctx) { fctx.clearRect(0, 0, W, H); if (!still) lookFx.drawFront(state, fctx, W, H, Date.now()); }
          ctx.globalAlpha = 1;
          if (!still) this._raf = cv.requestAnimationFrame(loop);
        };
        loop();
      });
    },
    // 示例正文按当前文字动效重播一次(与玩家页同一份 TEXT_FX;解码在这里逐拍换字符)
    _playText(n) {
      clearTimeout(this._fxT); (this._fxD || []).forEach(clearTimeout); this._fxD = [];
      const fx = themeLook.textFxFor(n, 0), text = this.data.sample.story || '';
      const chars = themeLook.textFxChars(fx) ? Array.from(text).reduce((acc, ch) => { if (acc.length && PUNCT.test(ch)) acc[acc.length - 1] += ch; else acc.push(ch); return acc; }, [])
        .map((ch, i) => { const a = Math.random() * 6.283, d = 30 + Math.random() * 50; return { i, ch, r: Math.random().toFixed(3), dx: (Math.cos(a) * d).toFixed(1), dy: (Math.sin(a) * d).toFixed(1) }; }) : null;
      this.setData({ fx, chars, fxIn: false });
      this._fxT = setTimeout(() => {
        this.setData({ fxIn: true });
        if (fx === 'decode' && chars) for (let k = 0; k <= 6; k++) this._fxD.push(setTimeout(() => this.setData({ chars: chars.map((c, j) => Object.assign({}, c, { ch: j < (chars.length * k) / 6 ? c.ch : GLYPH[(Math.random() * GLYPH.length) | 0], raw: j >= (chars.length * k) / 6 })) }), k * 30));   // 与玩家页解码同拍(reading-motion READ_DECODE_TICK_MS)
      }, 420);
    },
  },
});
