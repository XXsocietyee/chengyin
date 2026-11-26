// cy-playkit-dailysign · 每日签：出票、撕下、刮开、收下，可保存签图。
// launch 只保留领取签文；不采集留言或照片。
const reducedMotionBehavior = require('../../../../behaviors/reduced-motion.js');
const motion = require('../../../../utils/motion.js');
const toast = require('../../../../utils/toast.js');
function openAddress() { return require('../../../../utils/open-address.js') }
const { readReducedMotion } = require('../../../../utils/motion-preference.js');
const { resolveMenuChrome } = require('../../../../utils/nav-safe-area.js');

const TEAR_PX = 80;      // 拉过这个距离(css px)松手才撕断,不到就弹回去
const DRAG_DAMP = 0.7;   // 纸还连在机器上:手拉 1 它走 0.7
const ROT_MAX = 9;       // 拉的时候最多歪几度
const PRINT_DELAY_MS = 40;   // 先渲染在槽里,下一帧再加 is-printed,过渡才会跑(同帧加 class 等于没动画)
const PRINT_MS = 1500;       // 出纸时长(和 wxss 的 .is-printing 同一个数):出纸中途不许抓
const HINT = {
  print: '出票中',
  pull: '按住小票，往下拉',
  scratch: '刮开今日签文',
  write: '',
  done: '',
};

// L02-156:票面版式引擎(色表、版式数字、折行、纸边路径、条码)搬到 utils/dailysign-poster.js;组件只管拖拽、领取与落笔
const { SLIP, FONT, signPaperPath, signRoundRect, buildSignPoster, pad2, clamp, buildBars } = require('../../utils/dailysign-poster.js');

const { holdSubmit, releaseSubmit } = require('../../utils/submit-hold.js');

Component({
  behaviors: [reducedMotionBehavior],
  properties: {
    inline:      { type: Boolean, value: false }, // 故事流内嵌:原位一块纸台,不铺整屏
    show:        { type: Boolean, value: false },
    dateLabel:   { type: String,  value: '' },
    /* 出发 = 这一站的地址(服务端从节点取,谁发的就是哪个地址) */
    address:     { type: String,  value: '' },
    /* 服务端下发的签文 */
    lines:       { type: Array,   value: [] },
    /* 留签人昵称;开场签是发起人落款;都没有时票面写「这一站的发起人」 */
    signer:      { type: String,  value: '' },
    /* 上一张留下的时刻;开场签没有 */
    leftAt:      { type: String,  value: '' },
    serialLabel: { type: String,  value: '' },
    /* 已经留过的签不该再盖一层刮层 —— 昨天擦过的今天重开还要再擦一遍是折磨 */
    revealed:    { type: Boolean, value: false },
    /* 上一个人拍的那张,印在票上。服务端没给就没有这一段,不放占位图 */
    photoUrl:    { type: String,  value: '' },
    /* 服务端已确认领取 */
    claimed:     { type: Boolean, value: false },
  },
  data: {
    printing: false,     // 正在出纸(这段时间抓不动,过渡也用 1.5s 档)
    printed: false,      // 小票已从槽里出来
    torn: false,         // 已撕断
    dragging: false,     // 手正按着(关掉过渡,纸跟手)
    paperStyle: '',      // 拖拽中的 transform;松手清空,交回给 css 过渡
    writing: false,      // 签文已揭示,等待收下
    ctaDisabled: true,   // 揭示后才能收下
    bars: [],            // 条形码:按签号种子生成,同一张签每次一样
    timeLabel: '',       // 出票时刻 HH:MM
    hint: '',
    saving: false,       // 正在画票 / 写相册:这段时间按钮是「生成中…」的禁用态,不许连点
    stagePadTop: 0,      // 胶囊底实测 + 48px 台面留白;0=走 wxss 的 --cy-safe-top 兜底(env 在无刘海机解析为 0,裸 token 会顶太浅)
  },
  observers: {
    'show': function (show) { if (show) this._open(); else this._reset(); },
    'revealed': function (revealed) {
      if (revealed && !this._unlocked) this._unlock();
    },
    'claimed': function () { releaseSubmit(this); this._syncStep(); },
    'serialLabel': function (serial) { this.setData({ bars: buildBars(serial) }); },
  },
  lifetimes: {
    detached() { this._clearTimers(); releaseSubmit(this); },
  },
  methods: {
    // 第九轮 m1-9:这一站的地址一点开地图(签上只有文字,走缓存的地址解析)
    onAddressTap() { openAddress().openAddress({ address: this.data.address }, { geocode: true }); },
    _open() {
      this._clearTimers();
      if (!this.data.stagePadTop) {
        let windowInfo; let menuButtonInfo;
        try { windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync(); } catch (e) {}
        try { menuButtonInfo = wx.getMenuButtonBoundingClientRect(); } catch (e) {}
        this.setData({ stagePadTop: resolveMenuChrome(windowInfo, menuButtonInfo).contentTop + 48 });
      }
      const now = new Date();
      const timeLabel = pad2(now.getHours()) + ':' + pad2(now.getMinutes());
      // 直接读偏好,不读 this.data.reducedMotion:宿主一次 setData 就 show=true 时,这个 observer
      // 跑在 behavior 的 attached() 同步之前,data 里还是默认 false —— 减少动态效果的人会被要求拉纸
      const reduced = readReducedMotion();
      const revealed = !!this.data.revealed;
      // 减少动态效果 / 已领过的签:不出纸动画、不要求拉 —— 直接是撕好的一张票
      const skip = reduced || revealed;
      this._unlocked = revealed;
      this.setData({
        printing: false, printed: skip, torn: skip, dragging: false, paperStyle: '',
        timeLabel,
        hint: skip ? '' : HINT.print,
      });
      // L02-154: 条形码由 serialLabel 的 observer 生成;打开时只在还没有时补一次,不再每次重发 46 条
      if (!(this.data.bars && this.data.bars.length)) this.setData({ bars: buildBars(this.data.serialLabel) });
      this._syncStep(skip && !revealed ? HINT.scratch : '');
      if (skip) return;
      this._printTimer = setTimeout(() => {
        this.setData({ printing: true, printed: true });
        this._printDoneTimer = setTimeout(() => this.setData({ printing: false, hint: HINT.pull }), PRINT_MS);
      }, PRINT_DELAY_MS);
    },
    _reset() {
      this._clearTimers();
      this._drag = null;
      this._unlocked = false;
      this.setData({
        printing: false, printed: false, torn: false, dragging: false, paperStyle: '',
        writing: false, ctaDisabled: true, hint: '',
      });
    },
    _clearTimers() {
      if (this._printTimer) { clearTimeout(this._printTimer); this._printTimer = null; }
      if (this._printDoneTimer) { clearTimeout(this._printDoneTimer); this._printDoneTimer = null; }
      if (this._tearTimer) { clearTimeout(this._tearTimer); this._tearTimer = null; }
    },
    /** 揭示后才能收下，领取后可回看。 */
    _syncStep(hintOverride) {
      const claimed = !!this.data.claimed;
      const unlocked = !!this._unlocked;
      const writing = unlocked && !claimed;
      const hint = hintOverride || (claimed ? HINT.done : writing ? HINT.write : this.data.hint);
      this.setData({
        writing,
        ctaDisabled: claimed ? false : !writing,
        hint,
      });
    },
    _unlock() {
      this._unlocked = true;
      this._syncStep();
    },

    /* ── 拉纸 ── */
    onPaperStart(e) {
      // 出纸中途不许抓(抓了纸会瞬移到位);已经按着的时候第二根手指进来也不重算起点
      if (this.data.torn || !this.data.printed || this.data.printing || this._drag) return;
      const t = e.touches && e.touches[0];
      if (!t) return;
      this._drag = { x0: t.clientX, y0: t.clientY, dy: 0, lastY: 0 };
      this.setData({ dragging: true });
    },
    /** 拖拽中 / 撕断时的 transform,只此一处拼字符串 */
    _paperStyle(y, rot) {
      return 'transform:translateY(' + y.toFixed(1) + 'px) rotate(' + rot.toFixed(1) + 'deg)';
    },
    onPaperMove(e) {
      const d = this._drag;
      if (!d) return;
      const t = e.touches && e.touches[0];
      if (!t) return;
      d.dy = Math.max(0, t.clientY - d.y0);
      // 抓的位置偏一点,纸就歪一点;拉得越长也歪一点
      const rot = clamp((t.clientX - d.x0) / 40 + d.dy * 0.03, -ROT_MAX, ROT_MAX);
      const y = d.dy * DRAG_DAMP;
      // 每次 touchmove 都 setData 会掉帧:位移没过 2px 就不刷
      if (Math.abs(y - d.lastY) < 2) return;
      d.lastY = y;
      this.setData({ paperStyle: this._paperStyle(y, rot) });
    },
    onPaperEnd() {
      const d = this._drag;
      if (!d) return;
      this._drag = null;
      if (d.dy >= TEAR_PX) return this._tear(d.dy * DRAG_DAMP);
      // 不够:交回给 css 过渡弹回去
      this.setData({ dragging: false, paperStyle: '' });
    },
    /** 撕断:先往下再甩半步(视频里那一下),再落到手里 */
    _tear(fromY) {
      motion.haptic({ reducedMotion: this.data.reducedMotion, type: 'medium' });
      this.setData({ dragging: false, paperStyle: this._paperStyle(fromY + 54, -6) });
      this._tearTimer = setTimeout(() => {
        this.setData({ torn: true, paperStyle: '', hint: this.data.revealed ? '' : HINT.scratch });
        this._syncStep();
      }, 280);
    },
    /** 拉不动的人的出口:点一下等于拉过阈值 */
    onTearTap() {
      if (this.data.torn) return;
      this._drag = null;
      this._tear(0);
    },

    /* ── 刮开 / 留一句 / 收下 ── */
    onReveal() { this._unlock(); },
    onAccept() {
      if (this.data.claimed) { this.triggerEvent('close'); return; }
      // cy-btn disabled 已拦,这里是第二道
      if (!this.data.writing || !holdSubmit(this)) return;
      // 留下这一句是仪式的收尾,用 medium:比普通点击重一档,和「敲木鱼」同级
      motion.haptic({ reducedMotion: this.data.reducedMotion, type: 'medium' });
      this.triggerEvent('accept', {});
    },
    /* ── 保存到相册 ──
     * 这是一张纸的事:组件自己把票面画到离屏 canvas 上导出,不往父级抛事件 ——
     * 原本那句往父级抛的 save 全链路无人接收,玩家点了什么都没发生。
     * ⚠️ 相册要授权、会失败,三种结局分开说:生成失败 / 没写进相册 / 玩家自己取消(静默,不是错误)。 */
    onSave() {
      if (this.data.saving) return Promise.resolve();     // 画票 + 写相册是慢活,连点会叠两条链
      if (!this.data.claimed) return Promise.resolve();   // cy 层已 wx:if 拦过,这里是第二道
      const that = this;
      this.setData({ saving: true });
      return this._signCardPath()
        .then((path) => {
          if (!path) {
            that.setData({ saving: false });
            toast('签卡生成失败，再试一次');
            return null;
          }
          return that._saveSignCard(path).then((r) => {
            that.setData({ saving: false });
            if (r === 'saved') { toast.success('已保存到相册'); return; }
            // 拒过一次授权的人,自己再 authorize 不会再弹,只能把他带去设置页
            if (r === 'denied') { wx.openSetting({}); return; }
            if (r === 'fail') toast('没存进相册，检查存储空间后再试');
            /* r === 'cancel':玩家自己点了取消,不打扰 */
          });
        })
        .catch(() => {
          // 兜底:任何一环抛出来都不许把按钮永久留在「生成中…」
          that.setData({ saving: false });
          toast('签卡生成失败，再试一次');
        });
    },
    /** 取画布 → 落照片 → 排版 → 落笔 → 导出。任何一环没成就给空串,由 onSave 报错。 */
    _signCardPath() {
      const that = this;
      return this._getSignCanvas().then((entry) => {
        if (!entry) return '';
        return that._loadSignPhoto(entry).then((photo) => {
          const poster = that._buildSignPoster(function (text, font) {
            entry.ctx.font = font;
            return entry.ctx.measureText(String(text)).width;
          }, !!photo);
          that._drawSignPoster(entry, poster, photo);
          return that._exportSignCanvas(entry.cv);
        });
      });
    },
    /** L02-155: 签卡画在离屏 2d 画布上,不再在版面里挂一块藏到屏外的 canvas 节点;
     *  尺寸由 _drawSignPoster 按海报定。没有离屏画布的基础库给 null,由 onSave 报错。 */
    _getSignCanvas() {
      let cv = null;
      try { cv = wx.createOffscreenCanvas({ type: '2d', width: 375, height: 500 }); } catch (e) { /* 基础库没有离屏画布 */ }
      return Promise.resolve(cv && cv.getContext ? { cv, ctx: cv.getContext('2d') } : null);
    },
    /** 上一个人拍的那张:先落成本地临时文件再交给 canvas 解码。
     *  ★ 任一环节没成一律给 null —— 那张票**整块不排**(票面往上收),不留空洞,也不画假占位。 */
    _loadSignPhoto(entry) {
      const url = String(this.data.photoUrl || '').trim();
      // 只认 https:统一上传通道(app.chooseImage)回来的就是 https;别的地址宁可不画
      if (!/^https:\/\//i.test(url)) return Promise.resolve(null);
      return new Promise((resolve) => {
        wx.downloadFile({
          url: url,
          success: (res) => {
            const local = res && res.statusCode === 200 && res.tempFilePath;
            if (!local) { resolve(null); return; }
            let img = null;
            try { img = entry.cv.createImage(); } catch (e) { resolve(null); return; }
            if (!img) { resolve(null); return; }
            img.onload = () => resolve(img);
            img.onerror = () => resolve(null);
            img.src = local;
          },
          fail: () => resolve(null),
        });
      });
    },
    /** 票面 props → 画布版式。**纯函数**:量字靠注入的 measure,不碰 wx / ctx,所以能真测。
     *  hasPhoto 由调用方在照片解码有结果之后才给,所以「没有照片」这件事会影响整张票的高度。 */
    _buildSignPoster(measure, hasPhoto) {
      return buildSignPoster(this.data, measure, !!hasPhoto);
    },
    /** 只把装配好的版式落笔。排版与量字都不在这里发生(见 _buildSignPoster)。 */
    _drawSignPoster(entry, poster, photo) {
      const cv = entry.cv; const g = entry.ctx; const c = poster.c;
      cv.width = poster.w * poster.dpr;
      cv.height = poster.h * poster.dpr;
      g.scale(poster.dpr, poster.dpr);
      g.textBaseline = 'middle';      // 一块一行,行心就是 y,不再算基线
      g.textAlign = 'left';
      const desk = g.createLinearGradient(0, 0, 0, poster.h);
      desk.addColorStop(0, c.deskTop);
      desk.addColorStop(0.45, c.deskMid);
      desk.addColorStop(1, c.deskBottom);
      g.fillStyle = desk;
      g.fillRect(0, 0, poster.w, poster.h);
      // 纸:上下都是撕口锯齿 + 落在台面上的影(同 .ds__slip 的 box-shadow)
      const paper = poster.paper;
      g.save();
      g.shadowColor = c.shadow; g.shadowBlur = 44; g.shadowOffsetY = 20;
      g.fillStyle = c.paper;
      signPaperPath(g, paper);
      g.fill();
      g.restore();
      for (let i = 0; i < poster.blocks.length; i++) this._paintSignBlock(g, poster.blocks[i], c, photo);
    },
    _paintSignBlock(g, b, c, photo) {
      const t = (text, x, cy, font, color, align) => this._signText(g, text, x, cy, font, color, align);
      if (b.type === 'head') {
        t(b.title, b.x, b.y + b.h / 2, FONT.title, c.ink);
        t(b.date, b.x + b.w, b.y + b.h / 2, FONT.date, c.ink2, 'right');
        return;
      }
      if (b.type === 'hr') {
        g.strokeStyle = c.rule; g.lineWidth = 2;
        const y = b.y + b.h / 2;
        for (let x = b.x; x < b.x + b.w; x += SLIP.DASH * 2) {
          g.beginPath();
          g.moveTo(x, y);
          g.lineTo(Math.min(x + SLIP.DASH, b.x + b.w), y);
          g.stroke();
        }
        return;
      }
      if (b.type === 'od') {
        // 两列各自垂直居中(.ds__od 是 align-items: center):地址折到第二行时签号那列不该顶在上沿
        const lt = b.y + (b.h - b.leftH) / 2;
        const rt = b.y + (b.h - b.rightH) / 2;
        t(b.pickLabel, b.x, lt + SLIP.MICRO_H / 2, FONT.k, c.faint);
        const addrY = lt + (b.addrLines.length ? SLIP.MICRO_H + 2 : 0);
        for (let i = 0; i < b.addrLines.length; i++) {
          t(b.addrLines[i], b.x, addrY + b.addrLineH * (i + 0.5), FONT.addr, c.ink);
        }
        const smY = addrY + b.addrLines.length * b.addrLineH + 4;
        t(b.time, b.x, smY + SLIP.CAP_H / 2, FONT.sm, c.ink2);
        const rx = b.x + b.w;
        t('签号', rx, rt + SLIP.MICRO_H / 2, FONT.k, c.faint, 'right');
        t(b.serialLabel, rx, rt + SLIP.MICRO_H + 2 + SLIP.BIG_H / 2, FONT.big, c.ink, 'right');
        t(b.serialCaption, rx, rt + SLIP.MICRO_H + 2 + SLIP.BIG_H + 4 + SLIP.CAP_H / 2,
          FONT.sm, c.ink2, 'right');
        return;
      }
      if (b.type === 'grid') {
        for (let i = 0; i < b.cells.length; i++) {
          const x = b.x + i * (b.colW + SLIP.GAP);
          t(b.cells[i].k, x, b.y + SLIP.MICRO_H / 2, FONT.k, c.faint);
          for (let j = 0; j < b.cells[i].lines.length; j++) {
            t(b.cells[i].lines[j], x, b.y + SLIP.MICRO_H + 4 + SLIP.GRID_H * (j + 0.5), FONT.v, c.ink);
          }
        }
        return;
      }
      if (b.type === 'photo') {
        if (!photo) return;   // 装配已经把它整块跳过了;万一还在,这里也不画占位
        // aspectFill:与 <image mode="aspectFill"> 同一裁法(短边铺满、居中裁长边)
        const ir = Math.max(b.w / (photo.width || b.w), b.imgH / (photo.height || b.imgH));
        const sw = b.w / ir; const sh = b.imgH / ir;
        g.save();
        signRoundRect(g, b.x, b.y, b.w, b.imgH, b.radius);
        g.clip();
        g.drawImage(photo, (photo.width - sw) / 2, (photo.height - sh) / 2, sw, sh, b.x, b.y, b.w, b.imgH);
        g.restore();
        const cy = b.y + b.imgH + SLIP.PHOTO_CAP_GAP + SLIP.MICRO_H / 2;
        t(b.captionL, b.x, cy, FONT.k, c.faint);
        t(b.captionR, b.x + b.w, cy, FONT.k, c.faint, 'right');
        return;
      }
      if (b.type === 'poem') {
        t(b.k, b.x, b.y + SLIP.MICRO_H / 2, FONT.k, c.faint);
        g.fillStyle = c.poemBg;
        signRoundRect(g, b.x, b.boxY, b.w, b.boxH, SLIP.POEM_R);
        g.fill();
        for (let i = 0; i < b.lines.length; i++) {
          t(b.lines[i], b.x + SLIP.POEM_PAD_X, b.boxY + SLIP.POEM_PAD_T + b.lineH * (i + 0.5),
            FONT.poem, c.ink);
        }
        return;
      }
      if (b.type === 'barcode') {
        g.fillStyle = c.ink;
        let x = b.x0;
        for (let i = 0; i < b.bars.length; i++) {
          const bar = b.bars[i];
          g.fillRect(x, b.y + SLIP.BAR_T, bar.w * b.scale, b.barH);
          x += (bar.w + bar.g) * b.scale;
        }
      }
    },
    /** 一处落笔:字体/颜色/对齐都在调用处给。空串不画(空 `<text>` 在屏上也是零宽)。 */
    _signText(g, text, x, cy, font, color, align) {
      const s = text == null ? '' : String(text);
      if (!s) return;
      g.font = font;
      g.fillStyle = color;
      g.textAlign = align || 'left';
      g.fillText(s, x, cy);
      g.textAlign = 'left';
    },
    _exportSignCanvas(cv) {
      return new Promise((resolve) => {
        wx.canvasToTempFilePath({
          canvas: cv, fileType: 'png',
          // 显式 dest=画布物理尺寸:不传时默认再乘一次 dpr,真机(dpr3)导出发糊
          destWidth: cv.width, destHeight: cv.height,
          success: (r) => resolve((r && r.tempFilePath) || ''),
          fail: () => resolve(''),
        });
      });
    },
    _saveSignCard(path) {
      return new Promise((resolve) => {
        wx.saveImageToPhotosAlbum({
          filePath: path,
          success: () => resolve('saved'),
          fail: (e) => {
            const msg = String((e && e.errMsg) || '');
            if (/auth|deny/i.test(msg)) resolve('denied');
            else if (/cancel/i.test(msg)) resolve('cancel');
            else resolve('fail');
          },
        });
      });
    },
    onClose() { this.triggerEvent('close'); },
    noop() {},
  },
});
