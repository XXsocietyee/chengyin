// 主题画面风格在玩家页的两个入口(theme-look.js 读 / look-transition 转场)。从 index.js 抽出:
// 那个文件的 UI 门禁基线按行号登记,新方法放这里,index.js 只留单行挂钩,行号不动。
const themeLook = require('./theme-look.js');
const mapStyle = require('../../../utils/map-style.js');
const storyResume = require('./story-resume.js');
const readingMotion = require('./reading-motion.js');
const lookColors = require('./look-colors.js');
const TYPED_MAX = 400;
/** 同一批显形逐条错开(秒,写进 --d):阅读面 read-stagger 档。 */
const READ_STAGGER_S = readingMotion.READ_STAGGER_MS / 1000;
/** 抬手前这么久内还在滚 = 这是一次拖动 / 惯性,不是点。 */
const READ_TAP_SCROLL_MS = 150;
/** 段落显形还在进行的窗口:最近一次显形开始后这么久内的点击只落定文字(见 skipReveal / onStoryTap)。 */
const REVEAL_BUSY_MS = 900;

/** CG-ALL-23:一段正文的「打字身份」= 章 id + 段序 + 文字摘要。文字改了就是另一段,会重新逐字打一遍。 */
function typedKey(chapterId, i, text) {
  let h = 0;
  const str = String(text || '');
  for (let k = 0; k < str.length; k += 1) h = (h * 31 + str.charCodeAt(k)) | 0;
  return String(chapterId == null ? '' : chapterId) + ':' + i + ':' + str.length + ':' + (h >>> 0).toString(36);
}
const PUNCT = /^[,.!?;:，。！？；：、」』）)…—]$/;
/** L01-037:逐字特效的上限 —— 每章前 CHAR_FX_HEAD 段照旧逐字;之后超过 CHAR_FX_MAX_LEN 字的段改整段浮现。 */
const CHAR_FX_HEAD = 3, CHAR_FX_MAX_LEN = 120;
const GLYPH = 'ｱｲｳｴｵｶｷｸｹｺ01#%&*<>/=+';

function methods() {
  // 写成 const 对象再返回:台账 / 处理器门禁(xcx-scan)只扫模块里 `const X = {` 的键
  const api = {
    /** 读不懂的值回落默认(星尘 + 光圈 + 手写),老主题外观不变。 */
    _applyLook(raw) {
      // 没配过风格的老主题:标 legacy,星尘的新银河不套上去,原来的浮尘与场景光照旧
      const look = Object.assign(themeLook.normalizeLook(raw), raw ? {} : { legacy: true });
      this._look = look;
      this._lookKey = JSON.stringify(look);
      // lookOn:选过风格的主题,故事流才铺章节 / 主题配色的底(老主题保持纯黑故事背景)
      this.setData({ lookClass: themeLook.lookClass(look), lookTransition: themeLook.resolveTransition(look), lookOn: !look.legacy });
      this._applyMapLook(look);
    },
    /** 第九轮 m4 第 2 项:底图按外观选(纸本 paper、夜城 2077、其余 black)。layer-style 不能运行时改:
     *  第一次外观落定才放地图出来;同一页里外观真变了,先撤地图、下一拍按新样式重建,不在旧图上改属性。 */
    _applyMapLook(look) {
      const kind = mapStyle.kindForLook(look), next = mapStyle.mapStyleFor(kind), tone = mapStyle.mapToneFor(kind);
      const d = this.data || {};
      const same = d.fmSubkey === next.subkey && d.fmLayerStyle === next.layerStyle;
      const patch = { fmSubkey: next.subkey, fmLayerStyle: next.layerStyle, fmTone: tone, fmPalette: (look && !look.legacy && look.palette) || '', fmStyleReady: true };
      if (same || !d.fmStyleReady) { this.setData(patch); return; }
      this.setData({ fmStyleReady: false });
      const later = typeof wx !== 'undefined' && wx.nextTick ? wx.nextTick : (fn) => setTimeout(fn, 0);
      later(() => { if (!this._playDisposed) this.setData(patch); });
    },
    /** 主题配色设了就统一用它,没设(老主题)各章沿用自己的章节配色。 */
    _themePalette(chapterPreset) {
      return (this._look && this._look.palette) || chapterPreset;
    },
    /** 末世每章的时间段(清晨 / 正午 / 日落 / 夜晚):按章节顺序取,只在末世里生效;没设 = 不加。 */
    _chapterTime(i) {
      const look = this._look, t = look && look.style === 'SURVIVAL' && look.times && look.times[i];
      return t ? ' look-time--' + t.toLowerCase() : '';
    },
    /** 雷暴打闪:字跟着亮一下(远景画布已经整屏闪过);同一道闪只照一次。 */
    _lookLightUp(flashAt) {
      if (!flashAt || flashAt === this._litAt) return;
      this._litAt = flashAt;
      this.setData({ lookLit: true });
      clearTimeout(this._litTimer);
      this._litTimer = setTimeout(() => this.setData({ lookLit: false }), 420);
    },
    /** 故事正文第 i 段的文字动效(选过风格的主题才有):fx = 动效名;逐字类再给 chars(标点粘在前一个字上,不会单独掉到行首)。 */
    _textFx(item, i) {
      const look = this._look;
      if (i === 0) this._textSeq = -1;   // 每章从第一段重新数(轮换只数正文段)
      if (!look || look.legacy || !item || item.kind !== 'text' || !item.text) return {};
      this._textSeq = (this._textSeq == null ? -1 : this._textSeq) + 1;
      const fx = themeLook.textFxFor(look, this._textSeq);
      // CG-ALL-23:这一局里已经逐字打出过的段,再进故事流(如完成第 1 站后)直接显示全文
      const tk = typedKey((this.data && this.data.chapter || {}).id, i, item.text);
      if (this._isTyped(tk)) return {};
      if (!themeLook.textFxChars(fx)) return { fx, typedKey: tk };
      // L01-037(业主 2026-11-24 默认 A):逐字特效只给每章前几段或较短的段,其余长段改用整段「浮现」,长章节不再每个字一个节点
      if (this._textSeq >= CHAR_FX_HEAD && Array.from(item.text).length > CHAR_FX_MAX_LEN) return { fx: 'rise', typedKey: tk };
      const parts = Array.from(item.text).reduce((acc, ch) => { if (acc.length && PUNCT.test(ch)) acc[acc.length - 1] += ch; else acc.push(ch); return acc; }, []);
      return { fx, typedKey: tk, chars: parts.map((ch, k) => { const a = Math.random() * 6.283, d = 30 + Math.random() * 50;
        return { i: k, ch, r: Math.random().toFixed(3), dx: (Math.cos(a) * d).toFixed(1), dy: (Math.sin(a) * d).toFixed(1) }; }) };
    },
    /** 本局读过(打完)的段:内存一份 + 续玩存储一份(按账号 + 局号隔离,预览不存)。 */
    _typedSet() {
      const scope = this._runSessionScope ? this._runSessionScope() : null;
      const owner = scope ? [scope.memberId, scope.topicId, scope.routeSessionId].join('|') : '';
      if (!this._typed || this._typedOwner !== owner) {   // 换了一局 / 换了账号:不带上一局的已读
        const saved = this.data && this.data.isPreview ? [] : (storyResume.read(scope).typed || []);
        this._typed = new Set(Array.isArray(saved) ? saved : []);
        this._typedOwner = owner;
      }
      return this._typed;
    },
    _isTyped(key) { return !!key && this._typedSet().has(key); },
    _markTyped(key) {
      if (!key) return;
      const set = this._typedSet();
      if (set.has(key)) return;
      set.add(key);
      if (this.data && this.data.isPreview) return;
      const list = Array.from(set).slice(-TYPED_MAX);
      storyResume.patch(this._runSessionScope ? this._runSessionScope() : null, { typed: list });
    },
    /** 解码:这一段刚滑进屏幕时,单字先显示成乱码,分几拍逐字还原(只发这一段的 chars)。 */
    _decodeLine(i) {
      const key = 'chapterParas[' + i + '].chars', para = (this.data.chapterParas || [])[i];
      if (!para || !para.chars || this.data.reducedMotion) return;
      this._decodeReal = this._decodeReal || {};
      // 原文记一份:上一轮还没还原完就又滑进来 / 点一下即走完,都按它落定,不把乱码当原文
      const kept = this._decodeReal[i], real = kept && kept.text === para.text ? kept.real : para.chars.map((c) => c.ch), steps = 6;
      this._decodeReal[i] = { text: para.text, real };
      clearTimeout((this._decodeTimers || {})[i]); this._decodeTimers = this._decodeTimers || {};
      const tick = (k) => {
        this.setData({ [key]: para.chars.map((c, j) => Object.assign({}, c, { ch: j < (real.length * k) / steps ? real[j] : GLYPH[(Math.random() * GLYPH.length) | 0], raw: j >= (real.length * k) / steps })) });
        if (k < steps) this._decodeTimers[i] = setTimeout(() => tick(k + 1), readingMotion.READ_DECODE_TICK_MS);
        else delete this._decodeTimers[i];
      };
      tick(0);
    },
    /** 点一下即走完(2026-11-21 业主「读得快的人会着急」):显形 / 逐字 / 解码途中点正文,
     *  在屏的段直接落定、全文可见(.is-read-skip 去掉过渡);不拦这次点击本身(按钮照常响应)。
     *  挂在故事流 scroll-view 的 touchend 上(不是 tap:正文面不是按钮,不该有按压态);
     *  刚滚过(手指拖动 / 惯性)的那次抬手不算点。下一次滚动(_resumeReveal)恢复动效,新滑进来的段照常显形。 */
    skipReveal() {
      if (this._storyAt && Date.now() - this._storyAt < READ_TAP_SCROLL_MS) return;
      const timers = this._decodeTimers || {};
      // 点屏继续(onStoryTap)要知道这一下是不是「只把正在显形的字落定」:是的话这次点不再往前翻
      const busy = Object.keys(timers).length > 0 || (this._revealAt && Date.now() - this._revealAt < REVEAL_BUSY_MS);
      this._tapSettledAt = busy && !this.data.readSkip ? Date.now() : 0;
      Object.keys(timers).forEach((i) => {
        clearTimeout(timers[i]);
        const para = (this.data.chapterParas || [])[i];
        const kept = (this._decodeReal || {})[i], real = kept && para && kept.text === para.text ? kept.real : null;
        if (para && para.chars && real) this.setData({ ['chapterParas[' + i + '].chars']: para.chars.map((c, j) => Object.assign({}, c, { ch: real[j], raw: false })) });
      });
      this._decodeTimers = {};
      if (!this.data.readSkip) this.setData({ readSkip: true });
    },
    _resumeReveal() {
      if (this.data.readSkip) this.setData({ readSkip: false });
    },
    /** 故事流开 / 关时调:记下故事流在不在屏上,状态栏颜色统一由 _syncStatusBar 按最上面那层面来定。 */
    _storyStatusBar(on) {
      this._storyOn = !!on;
      // 章节门还在屏上时收起故事流(返回卡包):这一刻 data 里门还没撤,记下「正在离开」,门不再算浅底面
      this._storyLeaving = !on;
      this._syncStatusBar();
    },
    /** 章节门挂上时调(showChapterGate):门在屏上、故事流还没开始。 */
    _gateStatusBar() {
      this._storyLeaving = false;
      this._syncStatusBar();
    },
    /** 状态栏 / 胶囊前景色:最上面那层整屏面是浅底就黑字,否则白字(look-colors.statusBarLight 一处判定)。
     *  开场页、章节门、故事流、相册、本局完成、完成页开关时都调这一个;颜色没变不重复调微信 API。 */
    _syncStatusBar() {
      const d = this.data || {}, gate = d.chapterGate || {};
      const light = lookColors.statusBarLight({
        look: this._look, chapterPreset: (d.chapter || {}).atmospherePreset,
        intro: !!(d.storyIntro || {}).show, ending: !!(d.previewEnding || {}).show, finish: !!d.showFinish,
        stats: !!(d.startState || {}).show, boot: !!d.bootStage, album: !!(d.album || {}).show,
        gate: !!d.chapterFull && !!gate.show && !this._storyLeaving, held: !!gate.held,
        story: !!this._storyOn, chapterFull: !!d.chapterFull,
      });
      if (light === !!this._barLight || typeof wx === 'undefined' || typeof wx.setNavigationBarColor !== 'function') return;
      this._barLight = light;
      wx.setNavigationBarColor({ frontColor: light ? '#000000' : '#ffffff', backgroundColor: light ? '#ffffff' : '#000000' }); /* ds-ok 微信 API 只收这两个字面色 */
    },
    /** 用风格的转场盖住画面,在完全盖住时执行 swap(换内容),再揭开;转场层不在 / 减动效时直接执行。 */
    _withLookTransition(swap) {
      const tx = this.data.reducedMotion || typeof this.selectComponent !== 'function' ? null : this.selectComponent('#lookTx');
      if (!tx) { swap(); return; }
      tx.run(swap);
    },
  };
  return api;
}

/** L01-008 / L01-146(业主 2026-11-24 默认 A):低端手机(微信 benchmarkLevel 1–19,与 chapter-flip 粉尘降档同一口径)。
 *  只在这类手机上去掉剧情显形的模糊、外圈地环静止;取不到等级(iOS / DevTools 为 -1 或缺省)按非低端,观感不变。 */
function readLiteDevice() {
  try {
    const info = (wx.getDeviceInfo ? wx.getDeviceInfo() : (wx.getSystemInfoSync ? wx.getSystemInfoSync() : null)) || {};
    const level = Number(info.benchmarkLevel);
    return level > 0 && level < 20;
  } catch (e) { return false; }
}

module.exports = { methods, typedKey, READ_STAGGER_S, readLiteDevice, CHAR_FX_HEAD, CHAR_FX_MAX_LEN };
