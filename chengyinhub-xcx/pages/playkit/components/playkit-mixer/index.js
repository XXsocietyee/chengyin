// cy-playkit-mixer · 调音台
//
// ★ 答案(哪一轨)与答错回复不在客户端:服务端只下发轨道、两段音频与说明,判定也在服务端。
//   组件只让玩家选一条轨、开关各轨,交 { trackId, unmuted }(后端 SUBMIT_MIXER 读的就是这两个)。
//
// 答错:红字一行(服务端回的 lastFeedback)+ 四边一圈柔和红光(只改透明度,不抖、不加 @keyframes)。
// 答对:台面「通过」章(stage.win),点任意处收章,露出复原前 / 复原后的对比卡。
// 对比卡:点一段放、再点停;波形上一根播放头跟着走;两段说明一直在,静音也看得懂。
// 音频:只在本组件里开一个播放器,隐藏 / 收起 / 卸载都停掉并销毁。

const reducedMotionBehavior = require('../../../../behaviors/reduced-motion.js');
const motion = require('../../../../utils/motion.js');
const cyToast = require('../../../../utils/toast.js');

const BARS = 24;
const EDGE_MS = 500;

/** 字符串 → 32 位种子(FNV-1a)。同一个 id 永远画同一条波形。 */
function seedOf(text) {
  let h = 0x811c9dc5;
  const s = String(text || '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** 由 id 确定的装饰波形:BARS 根柱子,高度 20–100(百分比)。 */
function waveOf(id, count) {
  let x = seedOf(id) || 1;
  const n = count || BARS;
  const out = [];
  for (let i = 0; i < n; i++) {
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    const env = 0.55 + 0.45 * Math.sin((i / n) * Math.PI);
    out.push(Math.round(20 + 80 * env * ((x % 1000) / 1000)));
  }
  return out;
}

/** 服务端轨道 → 本地行。on = 当前是否打开(开局按配置的 muted 取反)。 */
function rowsOf(tracks) {
  return (Array.isArray(tracks) ? tracks : []).map((t) => ({
    id: String(t && t.id || ''),
    label: String(t && t.label || ''),
    startMuted: !!(t && t.muted),
    on: !(t && t.muted),
    bars: waveOf(t && t.id),
  })).filter((row) => row.id);
}

/** 玩家亲手打开的轨:开局静音、现在开着。 */
function unmutedIds(rows) {
  return (rows || []).filter((row) => row.startMuted && row.on).map((row) => row.id);
}

/** 选中的那一轨开着才能确认。 */
function canConfirm(rows, selectedId) {
  const row = (rows || []).find((r) => r.id === selectedId);
  return !!(row && row.on);
}

Component({
  behaviors: [reducedMotionBehavior],
  properties: {
    inline: { type: Boolean, value: false },
    show: { type: Boolean, value: false },
    title: { type: String, value: '' },
    tracks: { type: Array, value: [] },
    audioBefore: { type: String, value: '' },
    audioAfter: { type: String, value: '' },
    captionBefore: { type: String, value: '' },
    captionAfter: { type: String, value: '' },
    maxTries: { type: Number, value: 0 },     // 0 = 不限;有上限时台面画「还能错」
    attempts: { type: Number, value: 0 },
    finished: { type: Boolean, value: false },
    passed: { type: Boolean, value: false },
    lastCorrect: { type: Boolean, value: false },
    lastTrackId: { type: String, value: '' },
    lastFeedback: { type: String, value: '' },
    failureSeq: { type: Number, value: 0 },
  },
  data: {
    rows: [],
    selectedId: '',
    ready: false,
    submitting: false,
    feedback: '',
    edge: false,
    phase: 'play',          // play 调音台 / stamp 「通过」章 / ab 对比卡
    seg: 'before',
    playing: false,
    head: 0,                // 播放头位置 0–100
    abBars: [],
  },
  observers: {
    failureSeq: function (value) {
      if (!value || this._locked() || !this.data.submitting) return;
      this.setData({ submitting: false });
    },
    'show, tracks': function (show, tracks) {
      if (!show) { this._signature = ''; this._stopAudio(); if (this.data.submitting) this.setData({ submitting: false }); return; }
      const signature = JSON.stringify(tracks || []);
      if (signature === this._signature) return;
      this._signature = signature;
      const rows = rowsOf(tracks);
      const reentry = this.data.attempts > 0;
      const selectedId = reentry && rows.some((r) => r.id === this.data.lastTrackId) ? this.data.lastTrackId : '';
      this._seenAttempts = this.data.attempts;
      this.setData({
        rows,
        selectedId,
        ready: canConfirm(rows, selectedId),
        submitting: false,
        feedback: reentry && !this.data.passed ? this.data.lastFeedback : '',
        phase: this.data.passed ? 'ab' : 'play',
        seg: 'before', playing: false, head: 0,
        abBars: waveOf('mixer-ab-' + (this.data.title || ''), 40),
      });
      const stage = this.selectComponent('#cy-play-stage');
      if (stage) stage.begin();
    },
    // 回执来了才判:attempts 涨了说明刚交过,不是重进
    'attempts, passed, lastFeedback': function (attempts, passed, lastFeedback) {
      if (!this._signature || !(attempts > 0) || attempts === this._seenAttempts) return;
      this._seenAttempts = attempts;
      const stage = this.selectComponent('#cy-play-stage');
      if (passed) {
        this.setData({ feedback: '', phase: 'stamp', submitting: false });
        if (stage) stage.win('');
        return;
      }
      this.setData({ feedback: lastFeedback || '', submitting: false });
      if (stage && stage.nudge) stage.nudge();
      this._flashEdge();
    },
  },
  lifetimes: {
    detached() { this._clearEdge(); this._destroyAudio(); },
  },
  pageLifetimes: {
    hide() { this._stopAudio(); },
  },
  methods: {
    _waveOf: waveOf,          // 纯算法出口,供单测
    _unmutedIds: unmutedIds,
    _canConfirm: canConfirm,

    _locked() { return this.data.phase !== 'play' || this.data.finished || this.data.passed; },

    onPick(e) {
      if (this._locked()) return;
      const id = e.currentTarget.dataset.id;
      motion.haptic({ reducedMotion: this.data.reducedMotion, type: 'light' });
      this.setData({ selectedId: id, ready: canConfirm(this.data.rows, id) });
    },
    onSwitch(e) {
      if (this._locked()) return;
      const id = e.currentTarget.dataset.id;
      const rows = this.data.rows.map((row) => (row.id === id ? Object.assign({}, row, { on: !row.on }) : row));
      motion.haptic({ reducedMotion: this.data.reducedMotion, type: 'light' });
      // 动过开关就是新的一版:上一次的红字撤掉
      this.setData({ rows, selectedId: id, ready: canConfirm(rows, id), feedback: '' });
    },
    onConfirm() {
      if (this._locked() || !this.data.ready || this.data.submitting) return;
      this.setData({ submitting: true });
      motion.haptic({ reducedMotion: this.data.reducedMotion, type: 'medium' });
      // ★ 只报选了哪一轨、打开了哪些,不报对错 —— 对错在服务端
      this.triggerEvent('submit', { trackId: this.data.selectedId, unmuted: unmutedIds(this.data.rows) });
    },
    /* 「通过」章:点任意处收章,露出对比卡 */
    onStampTap() {
      if (this.data.phase !== 'stamp') return;
      const stage = this.selectComponent('#cy-play-stage');
      if (stage) stage.begin({ immediate: true });
      this.setData({ phase: 'ab' });
    },
    onSeg(e) {
      const seg = e.currentTarget.dataset.seg === 'after' ? 'after' : 'before';
      if (seg === this.data.seg && this.data.playing) { this._stopAudio(); return; }
      this._stopAudio();
      this.setData({ seg, head: 0 });
      const src = seg === 'after' ? this.data.audioAfter : this.data.audioBefore;
      if (src) this._play(src);
    },
    onClose() { this._signature = ''; this._stopAudio(); this.triggerEvent('close'); },

    _flashEdge() {
      this._clearEdge();
      this.setData({ edge: true });
      this._edgeT = setTimeout(() => { this._edgeT = null; this.setData({ edge: false }); }, EDGE_MS);
    },
    _clearEdge() { if (this._edgeT) { clearTimeout(this._edgeT); this._edgeT = null; } },

    _audio() {
      if (this._ctx) return this._ctx;
      if (typeof wx === 'undefined' || typeof wx.createInnerAudioContext !== 'function') return null;
      const ctx = wx.createInnerAudioContext();
      ctx.obeyMuteSwitch = false;
      ctx.onTimeUpdate(() => {
        if (this._ctx !== ctx || !this.data.playing) return;
        const d = Number(ctx.duration) || 0;
        const head = d > 0 ? Math.max(0, Math.min(100, Math.round((Number(ctx.currentTime) || 0) / d * 1000) / 10)) : 0;
        if (head !== this.data.head) this.setData({ head });
      });
      ctx.onEnded(() => { if (this._ctx === ctx) this.setData({ playing: false, head: 0 }); });
      ctx.onStop(() => { if (this._ctx === ctx && this.data.playing) this.setData({ playing: false, head: 0 }); });
      ctx.onError(() => {
        if (this._ctx !== ctx) return;
        this.setData({ playing: false, head: 0 });
        cyToast('这段音频放不出来');
      });
      this._ctx = ctx;
      return ctx;
    },
    _play(src) {
      const ctx = this._audio();
      if (!ctx) return;
      if (ctx.src !== src) ctx.src = src;
      try { ctx.seek && ctx.seek(0); } catch (err) { /* 未加载时 seek 会抛,从头放即可 */ }
      ctx.play();
      this.setData({ playing: true });
    },
    _stopAudio() {
      if (this._ctx) { try { this._ctx.stop(); } catch (err) { /* 已停 */ } }
      if (this.data.playing || this.data.head) this.setData({ playing: false, head: 0 });
    },
    _destroyAudio() {
      const ctx = this._ctx;
      this._ctx = null;
      if (ctx) { try { ctx.stop(); ctx.destroy(); } catch (err) { /* 已销毁 */ } }
    },
  },
});
