// 本机相对 PCM 峰值持续过线。录音帧仅在内存读取，不上传、不保存文件。
const motion = require('../../../../utils/motion.js');
const { readReducedMotion } = require('../../../../utils/motion-preference.js');
const toast = require('../../../../utils/toast.js');
const { baseline, thresholds, bandOf, pcmPeak, denied } = require('../../utils/play-audio-level.js');
const mediaDenied = require('../../utils/media-denied.js');
const { withAttempt, freshAttempt, rewardNote } = require('../../utils/sensor-contract.js');
const TICK_MS = 100;
const FIRST_FRAME_MS = 3000;
const GAP_MS = 500;
const DIP_GRACE_MS = 280;


Component({
  properties: {
    show: { type: Boolean, value: false },
    kicker: { type: String, value: '喊出来' },
    seconds: { type: Number, value: 5 },
    // C1:服务端开表发的挑战身份(0 = 没有)与奖励上限(空 = 服务端没说,什么都不承诺)
    attemptId: { type: Number, value: 0 },
    rewardCeiling: { type: String, value: '' },
    // 第十一轮 i1:读不出声音或拒了麦克风时的出路,与罗盘同口径 —— 能不能跳、是不是跳过的,都只听服务端
    canSkip: { type: Boolean, value: false },
    skipped: { type: Boolean, value: false },
  },
  data: { left: '5.0', loud: false, meterScale: 0, running: false, preparing: false, stageKeys: [0], rewardNote: '', micDenied: false },
  observers: {
    rewardCeiling(value) { this.setData({ rewardNote: rewardNote(value) }); },
    'show, seconds': function (show, seconds) {
      if (!show) { this._abort(); this._closed = true; this._configSignature = ''; return; }
      // 开表后服务端回流会把同值属性再赋一遍:配置没变就不重置台面(与 typein 的 _roundSignature 同口径)
      const signature = String(seconds);
      if (signature === this._configSignature && !this._closed) return;
      this._configSignature = signature;
      this._abort();
      this._closed = false;
      this.setData({ left: this._total().toFixed(1), meterScale: 0 });
    },
  },
  lifetimes: {
    attached() { this._rm = readReducedMotion(); },
    detached() { this._detached = true; this._abort(); },
  },
  pageLifetimes: {
    hide() { this._hidden = true; this._abort(); },
    show() { this._hidden = false; },
  },
  methods: {
    _total() { const n = this.data.seconds; return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 5; },
    _meterOf(peak) {
      if (typeof peak !== 'number' || !Number.isFinite(peak) || !this._hot) return 0;
      const base = Number.isFinite(this._base) ? this._base : 0;
      const span = Math.max(0.01, this._hot - base);
      return Number(Math.max(0, Math.min(1, (peak - base) / span)).toFixed(2));
    },
    _current(attempt) { return !!attempt && this._attempt === attempt && this.data.show && !this._hidden && !this._closed && !this._detached; },
    _stageAttempt(e) {
      const a = this._attempt;
      return this._current(a) && e && e.currentTarget && e.currentTarget.dataset
        && String(e.currentTarget.dataset.stageKey) === String(a.key) ? a : null;
    },
    _stop() {
      if (this._timer) clearInterval(this._timer);
      if (this._watchdog) clearTimeout(this._watchdog);
      this._timer = null; this._watchdog = null;
    },
    _stopMic(attempt) {
      const a = attempt || this._attempt;
      if (!a || !a.rec) return;
      const rec = a.rec; a.rec = null;
      for (const [name, callback] of a.listeners || []) {
        try { rec['off' + name](callback); } catch (error) { /* stale owned callback is guarded */ }
      }
      try { rec.stop(); } catch (error) { /* already stopped */ }
    },
    _abort(after) {
      const a = this._attempt;
      const stage = a ? a.stage : this.selectComponent('#cy-play-stage');
      this._attempt = null;
      this._stop(); this._stopMic(a);
      this._samples = []; this._peak = null; this._held = 0;
      // L02-191: 台面只在真开过一局时才停掉换新(打开 / 关闭 / 切后台没开局就不白白重挂)
      if (a) { if (stage) stage._stopAll(); this._retiredStage = stage; }
      const key = this.data.stageKeys[0] + (a ? 1 : 0);
      this.setData({ running: false, preparing: false, loud: false, meterScale: 0,
        left: this._total().toFixed(1), stageKeys: [key] }, () => {
        if (after && this.data.stageKeys[0] === key && this.data.show && !this._hidden && !this._closed && !this._detached) after();
      });
    },
    /** 第十二轮 k8(k2 第 5 项遗留):麦克风被拒时屏上写出原因(与计步「需要授权微信运动才能计步」同口径),
     *  失败次数照旧报给服务端,够了才出「跳过这一站」。重新开始时这句清掉。 */
    _micDenied() {
      this.setData({ micDenied: true });
      this.triggerEvent('micdenied');
      if (mediaDenied && typeof mediaDenied.guidePermission === 'function') mediaDenied.guidePermission('mic');
    },
    onOpenSetting() {
      if (mediaDenied && typeof mediaDenied.guidePermission === 'function') {
        mediaDenied.guidePermission('mic', {
          onReturn: (res) => {
            if (res && res.authSetting && res.authSetting['scope.record']) this.setData({ micDenied: false });
          },
        });
      }
    },
    _failure(a, error) {
      if (!this._current(a) || a.phase === 'reporting' || a.phase === 'finished') return;
      this._abort();
      const key = this.data.stageKeys[0];
      if (denied(error)) { this._micDenied(); return; }
      toast('声音读取中断，可重试或退出');
      // 失败次数由服务端记,够两次后它才会给出「跳过这一站」
      this.triggerEvent('readfail');
      // Unknown device/busy errors are not a permission denial. Only read the actual scope flag.
      if (typeof wx.getSetting === 'function') {
        try { wx.getSetting({ success: result => {
          if (this._attempt || this.data.stageKeys[0] !== key || !this.data.show || this._hidden || this._closed || this._detached) return;
          if (result && result.authSetting && result.authSetting['scope.record'] === false) this._micDenied();
        }, fail() {} }); } catch (error) { /* generic retry message already visible */ }
      }
    },
    _armWatchdog(a, ms) {
      if (this._watchdog) clearTimeout(this._watchdog);
      this._watchdog = setTimeout(() => this._failure(a), ms);
    },
    _beginStage(a) {
      if (!this._current(a) || !a.returned || !a.started || a.phase !== 'starting') return;
      a.phase = 'calibrating';
      this._armWatchdog(a, FIRST_FRAME_MS);
      a.stage.begin();
    },
    onStart() {
      if (this.data.skipped) return;   // 第十一轮 i1:跳过的站不再开局(服务端也拒)
      if (this.data.micDenied) this.setData({ micDenied: false });   // 第十二轮 k8:重新开始时清掉上一次的拒绝原因
      if (this._hidden || this._closed || this._detached || !this.data.show) return;
      if (this._attempt) {
        if (this._attempt.phase === 'finished') this._abort(() => this.onStart());
        return;
      }
      const stage = this.selectComponent('#cy-play-stage');
      if (!stage || stage === this._retiredStage) return;
      const a = this._attempt = { stage, key: this.data.stageKeys[0], phase: 'starting', rec: null,
        started: false, returned: false, frameAt: null, frameSeq: 0, sampledSeq: 0,
        runAt: null, runLoud: false, dipSince: null, smoothPeak: null, samples: 0, listeners: [] };
      this._samples = []; this._peak = null; this._held = 0;
      this.setData({ preparing: true, running: false, loud: false, meterScale: 0 });
      this._startMic(a);
    },
    _startMic(a) {
      try {
        if (typeof wx.getRecorderManager !== 'function') throw Error('unsupported');
        const rec = wx.getRecorderManager();
        const names = ['FrameRecorded', 'Error', 'Start', 'Stop'];
        if (!rec || typeof rec.start !== 'function' || typeof rec.stop !== 'function'
          || names.some(name => typeof rec['on' + name] !== 'function' || typeof rec['off' + name] !== 'function')) throw Error('unsupported');
        a.rec = rec;
        const onFrame = result => {
          if (!this._current(a) || !a.started || !['calibrating', 'ready', 'running'].includes(a.phase)) return;
          const peak = pcmPeak(result && result.frameBuffer);
          if (peak === null) {
            if (a.phase === 'running') {
              a.runAt = null; a.runLoud = false; a.dipSince = null; a.smoothPeak = null; this._held = 0;
              this.setData({ loud: false, meterScale: 0, left: this._total().toFixed(1) });
            }
            return;
          }
          const now = Date.now();
          if (a.frameAt !== null && now - a.frameAt >= GAP_MS) { this._failure(a); return; }
          a.frameAt = now; a.frameSeq += 1; this._peak = peak;
          this._armWatchdog(a, GAP_MS);
          if (a.phase !== 'running') return;
          a.smoothPeak = a.smoothPeak === null ? peak : a.smoothPeak * 0.5 + peak * 0.5;
          const meterScale = this._meterOf(a.smoothPeak);
          const loud = bandOf(peak, this._mid, this._hot) === 'hot';
          if (loud) {
            a.dipSince = null;
            if (a.runAt !== null && a.runLoud) this._held += Math.min(0.1, Math.max(0, (now - a.runAt) / 1000));
          } else {
            if (a.dipSince === null) a.dipSince = now;
            // 短暂换气或单帧抖动给 280ms 宽限，持续掉线才清零
            if (now - a.dipSince >= DIP_GRACE_MS) this._held = 0;
          }
          a.runAt = now; a.runLoud = loud; a.samples += 1;
          const left = Math.max(0, this._total() - this._held).toFixed(1);
          if (loud !== this.data.loud || left !== this.data.left || meterScale !== this.data.meterScale) {
            this.setData({ loud, left, meterScale });  // L02-048
          }
          if (this._held >= this._total()) this._finish();
        };
        const onError = error => this._failure(a, error);
        const onStart = () => { if (this._current(a)) { a.started = true; this._beginStage(a); } };
        // RecorderManager is a singleton: a queued old native stop can reach new listeners.
        // It cannot identify a recording, so loss of current frames is owned by the watchdog.
        const onStop = () => { if (!this._current(a)) return; };
        a.listeners = [['FrameRecorded', onFrame], ['Error', onError], ['Start', onStart], ['Stop', onStop]];
        for (const [name, fn] of a.listeners) { rec['on' + name](fn); if (!this._current(a)) return; }
        this._armWatchdog(a, FIRST_FRAME_MS);
        rec.start({ duration: 600000, sampleRate: 16000, numberOfChannels: 1, format: 'PCM', frameSize: 1 });
        if (!this._current(a)) return;
        a.returned = true;
        this._beginStage(a);
      } catch (error) { this._failure(a, error); }
    },
    onSample(e) {
      const a = this._stageAttempt(e);
      if (!a || a.phase !== 'calibrating' || a.frameAt === null || Date.now() - a.frameAt >= GAP_MS || a.sampledSeq === a.frameSeq) return;
      a.sampledSeq = a.frameSeq; this._samples.push(this._peak);
    },
    onCalibrated(e) {
      const a = this._stageAttempt(e);
      if (!a || a.phase !== 'calibrating') return;
      if (a.frameAt === null || Date.now() - a.frameAt >= GAP_MS || !this._samples.length) { this._failure(a); return; }
      const base = baseline(this._samples);
      const t = thresholds(base);
      this._base = base; this._mid = t.mid; this._hot = t.hot; a.phase = 'ready';
    },
    onRun(e) {
      const a = this._stageAttempt(e);
      if (!a || a.phase !== 'ready') return;
      if (a.frameAt === null || Date.now() - a.frameAt >= GAP_MS) { this._failure(a); return; }
      a.phase = 'running'; a.runAt = null; a.runLoud = false; a.dipSince = null; a.smoothPeak = null; a.samples = 0;
      // 开局那一刻手里的号是上一次的;只有这一局开表后服务端新发的号才随成绩交
      a.attemptAtRun = this.data.attemptId;
      this._held = 0; this._last = Date.now();
      this.setData({ preparing: false, running: true, left: this._total().toFixed(1), loud: false, meterScale: 0 });
      this.triggerEvent('start');
      if (!this._current(a)) return;
      this._timer = setInterval(() => {
        if (!this._current(a) || a.phase !== 'running') return;
        const now = Date.now();
        if (a.frameAt === null || now - a.frameAt >= GAP_MS) this._failure(a);
      }, TICK_MS);
    },
    _finish() {
      const a = this._attempt;
      if (!this._current(a) || a.phase !== 'running') return;
      if (a.runAt === null || a.samples < 2 || Date.now() - a.runAt >= GAP_MS
        || !Number.isFinite(this._held) || this._held < this._total() || !a.runLoud) { this._failure(a); return; }
      a.phase = 'reporting';
      const heldMs = Math.round(this._held * 1000);
      this._stop(); this._stopMic(a);
      this.setData({ running: false, preparing: false, meterScale: 1 });
      motion.haptic({ reducedMotion: this._rm, type: 'medium' });
      a.stage.win('连续喊满 ' + this._total() + ' 秒');
      if (!this._current(a)) return;
      a.phase = 'finished';
      this.triggerEvent('submit', withAttempt({ heldMs }, { attemptId: freshAttempt(this.data.attemptId, a.attemptAtRun) }));
    },
    onVerdict(e) { const a = this._stageAttempt(e); if (a && a.phase === 'reporting') this.triggerEvent('verdict', e.detail); },
    /* 跳过由服务端判(次数、拒权限、作者开关或队长放行都在服务端),这里只发请求 */
    onSkip() {
      if (!this.data.canSkip || this.data.skipped || this.data.running || this.data.preparing
        || this._attempt || this._skipping) return;
      this._skipping = true;
      setTimeout(() => { this._skipping = false; }, 1500);
      this.triggerEvent('skip');
    },
    onClose(e) {
      if (e && (!e.currentTarget || !e.currentTarget.dataset || String(e.currentTarget.dataset.stageKey) !== String(this.data.stageKeys[0]))) return;
      this._closed = true; this._abort(); this.triggerEvent('close');
    },
  },
});
