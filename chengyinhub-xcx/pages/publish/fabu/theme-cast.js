'use strict';
// 角色(Cast)编辑 —— docs/design/cast-contract-1119.md(业主 2026-11-19 批准 A + B + D2)。
// 数据只有一份:formData.castConfig(界面形状,见 utils/publish/story-cast.js);setData 'formData.castConfig'
// 就走现有的本地草稿 / 云端自动保存。关掉开关只置 enabled=false,角色与台词、信任、归属都留着,只是不露面。
const storyCast = require('../utils/publish/story-cast.js');
const cyToast = require('../../../utils/toast.js');
const modal = require('../../../utils/modal.js');

const STORY_LINE_ITEM = { kind: 'line', label: '对白', icon: 'comment' };
const REC_MAX_MS = 60000;
const VOICE_CHIPS = storyCast.PRESETS.map((p) => ({ value: p.value, label: p.label })).concat([{ value: 'none', label: '不出声' }]);
// 成员弹窗里各字段的锚点(问题 field → scroll-into-view 的 id)
const MEMBER_ANCHOR = { name: 'cm-name', identity: 'cm-identity', avatar: 'cm-avatar', color: 'cm-color', voice: 'cm-voice', clues: 'cm-clues', ending_low: 'cm-ending', ending_mid: 'cm-ending', ending_high: 'cm-ending' };

function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
function anchorOf(field) { return MEMBER_ANCHOR[field] || (/^clue\d+$/.test(field) ? 'cm-' + field : 'cm-name'); }
// TTS 没配置:服务端回 code=503 + data.errorCode=CAST_TTS_NOT_CONFIGURED(#873)。编辑器只把「试听」收起来,不弹错(契约 Voice 一节)。
function ttsNotConfigured(res) {
  const data = (res && res.data) || {};
  return data.errorCode === 'CAST_TTS_NOT_CONFIGURED' || Number(res && res.code) === 503;
}

const data = {
  castCard: { on: false, count: 0, faces: [] },
  castOn: false,
  castSheetShow: false,
  castView: { list: [], playerName: false, playerIdentity: false, identities: [], atMax: false, idAtMax: false },
  castError: { field: '', message: '' },
  castEdit: { show: false, isNew: false, m: null, initial: '', errField: '', errMsg: '', scrollTo: '', recording: false, avatarPreview: '', clueLabels: [], atClueMax: false },
  castVoiceChips: VOICE_CHIPS,
  castColors: storyCast.COLORS,
  castClueOptions: [],
  castTtsOff: false,
  castPreviewing: '',
  storyLinePlaying: '', // L03-086:正在回放的对白 blockKey
  castRowMenu: { show: false, id: '', items: [] },
  storySpeakers: [],
  storySpeakerNameOf: {},
  storyLineRec: '',
  storyBranchTrust: [],
  chapterEndingCastOptions: [],
  chapterEndingCastIndex: 0,
};

const methods = {
  _castConfig() { return (this.data.formData && this.data.formData.castConfig) || null; },

  // 所有派生视图一处算:首页卡、列表、谁在说话、添加栏。updateAllStatistics 每次都调,回填 / 恢复 / 撤销都覆盖到。
  _refreshCastViews(cfgArg) {
    const cfg = cfgArg === undefined ? this._castConfig() : cfgArg;
    // 打字时每次都会走到这里:配置没变就不重算、不 setData
    const memo = JSON.stringify(cfg) + '|' + (this.data.storyAddItems || []).length;
    if (memo === this._castViewMemo) return;
    this._castViewMemo = memo;
    const on = storyCast.isEnabled(cfg);
    const list = storyCast.listView(cfg);
    const items = this.data.storyAddItems || [];
    const hasLine = items.some((i) => i.kind === 'line');
    const patch = {
      castCard: storyCast.cardView(cfg), castOn: on,
      castView: {
        list, playerName: !!(cfg && cfg.playerName), playerIdentity: !!(cfg && cfg.playerIdentity),
        identities: (cfg && cfg.identities) || [], atMax: list.length >= storyCast.MAX_CAST,
        idAtMax: ((cfg && cfg.identities) || []).length >= storyCast.MAX_IDENTITIES,
      },
      storySpeakers: storyCast.speakerOptions(cfg), storySpeakerNameOf: storyCast.speakerNameMap(cfg),
    };
    // 添加栏:「对白」紧跟「段落」,只在开关开着时出现
    if (on && !hasLine) {
      const at = Math.max(0, items.findIndex((i) => i.kind === 'text')) + 1;
      patch.storyAddItems = items.slice(0, at).concat([STORY_LINE_ITEM], items.slice(at));
    } else if (!on && hasLine) {
      patch.storyAddItems = items.filter((i) => i.kind !== 'line');
    }
    this.setData(patch);
  },

  // L03-210:配置与派生视图合成一次 setData
  _writeCast(cfg, extra) {
    this._collectSetData(() => {
      this.setData(Object.assign({ 'formData.castConfig': cfg }, extra || {}));
      this._refreshCastViews(cfg);
    });
  },

  // ── 主题首页「角色」卡 ──
  onCastSwitch(e) {
    const on = !!(e && e.detail && e.detail.value);
    const cfg = clone(this._castConfig()) || (on ? storyCast.emptyCastConfig() : null);
    if (!cfg) return;
    cfg.enabled = on;
    this._writeCast(cfg);
  },
  // L03-211:只打开不写配置;第一次真正改动(开关/加角色/加身份)时各处理函数才建 emptyCastConfig,打开面板不算草稿编辑
  openCastSheet() {
    this.setData({ castSheetShow: true, 'mounted.cast': true, castError: { field: '', message: '' } });
  },
  // 「完成」:玩家身份开着时先把身份清单过一遍,有问题就停在那一行红字(#871)
  doneCastSheet() {
    const cfg = this._castConfig();
    if (cfg && cfg.playerIdentity) {
      const issue = storyCast.identityIssues(cfg.identities)[0]
        || (!(cfg.identities || []).length ? { field: 'identities', message: '打开了玩家身份，至少加一个身份' } : null);
      if (issue) { this.setData({ castError: { field: issue.field, message: issue.message } }); return; }
    }
    this.closeCastSheet();
  },
  closeCastSheet() { this.setData({ castSheetShow: false, castError: { field: '', message: '' }, 'castRowMenu.show': false }); },

  // ── 列表:玩家起名 / 玩家身份 / 身份清单 ──
  onCastPlayerSwitch(e) {
    const field = e.currentTarget.dataset.field;
    if (field !== 'playerName' && field !== 'playerIdentity') return;
    const cfg = clone(this._castConfig()) || storyCast.emptyCastConfig();
    cfg[field] = !!(e.detail && e.detail.value);
    this._writeCast(cfg, { castError: { field: '', message: '' } });
  },
  addCastIdentity() {
    const cfg = clone(this._castConfig()) || storyCast.emptyCastConfig();
    if ((cfg.identities || []).length >= storyCast.MAX_IDENTITIES) {
      this.setData({ castError: { field: 'identities', message: '玩家身份最多 ' + storyCast.MAX_IDENTITIES + ' 个' } });
      return;
    }
    cfg.identities = (cfg.identities || []).concat([storyCast.newIdentity(cfg)]);
    this._writeCast(cfg, { castError: { field: '', message: '' } });
  },
  onCastIdentityInput(e) {
    const i = Number(e.currentTarget.dataset.i);
    const field = e.currentTarget.dataset.field === 'sub' ? 'sub' : 'title';
    const cfg = this._castConfig();
    if (!cfg || !cfg.identities || !cfg.identities[i]) return;
    // L03-210:逐字输入只回传这一格,不整份回传 castConfig
    this._collectSetData(() => {
      this.setData({ ['formData.castConfig.identities[' + i + '].' + field]: e.detail.value });
      if (this.data.castError.field === 'identity' + i) this.setData({ castError: { field: '', message: '' } });
      this._refreshCastViews(this._castConfig());
    });
  },
  removeCastIdentity(e) {
    const i = Number(e.currentTarget.dataset.i);
    const cfg = clone(this._castConfig());
    if (!cfg || !cfg.identities || !cfg.identities[i]) return;
    cfg.identities.splice(i, 1);
    this._writeCast(cfg, { castError: { field: '', message: '' } });
  },

  // ── 列表:角色行(点开编辑;右侧 ⋯ = 上移 / 下移 / 删除)──
  addCastMember() {
    const cfg = this._castConfig() || storyCast.emptyCastConfig();
    if ((cfg.cast || []).length >= storyCast.MAX_CAST) {
      this.setData({ castError: { field: 'add', message: '角色最多 ' + storyCast.MAX_CAST + ' 位' } });
      return;
    }
    this._openMember(storyCast.newMember(cfg), true);
  },
  editCastMember(e) {
    const id = e.currentTarget.dataset.id;
    const hit = ((this._castConfig() || {}).cast || []).find((m) => m.id === id);
    if (hit) this._openMember(clone(hit), false);
  },
  openCastRowMenu(e) {
    const id = e.currentTarget.dataset.id;
    const cast = (this._castConfig() || {}).cast || [];
    const at = cast.findIndex((m) => m.id === id);
    if (at < 0) return;
    const values = [];
    if (at > 0) values.push('up');
    if (at < cast.length - 1) values.push('down');
    values.push('delete');
    this._castRowMenuValues = values;
    const labels = { up: '上移', down: '下移', delete: '删除' };
    this.setData({ castRowMenu: { show: true, id, items: values.map((v) => ({ label: labels[v], danger: v === 'delete' })) } });
  },
  closeCastRowMenu() { this.setData({ 'castRowMenu.show': false }); },
  onCastRowMenu(e) {
    const value = (this._castRowMenuValues || [])[Number(e && e.detail && e.detail.index)];
    const id = this.data.castRowMenu.id;
    this.setData({ 'castRowMenu.show': false });
    if (value === 'delete') { this._confirmRemoveMember(id); return; }
    const cfg = clone(this._castConfig());
    const at = cfg ? cfg.cast.findIndex((m) => m.id === id) : -1;
    const to = value === 'up' ? at - 1 : value === 'down' ? at + 1 : -1;
    if (at < 0 || to < 0 || to >= cfg.cast.length) return;
    const moved = cfg.cast.splice(at, 1)[0];
    cfg.cast.splice(to, 0, moved);
    this._writeCast(cfg);
  },
  _confirmRemoveMember(id, after) {
    const member = ((this._castConfig() || {}).cast || []).find((m) => m.id === id);
    if (!member) return;
    const name = String(member.name || '').trim() || '未命名角色';
    const refs = storyCast.memberRefs(this.data.formData.chapters, id);
    const parts = [];
    if (refs.lines) parts.push('说过的 ' + refs.lines + ' 句对白会变成段落');
    if (refs.endings) parts.push(refs.endings + ' 个结局章要重选归属');
    if (refs.trust) parts.push(refs.trust + ' 条分支的信任变化一并去掉');
    modal.show({
      title: '删除「' + name + '」？',
      content: (parts.length ? parts.join('，') + '。' : '') + '删除后 5 秒内可以撤销。',
      success: (res) => {
        if (!res.confirm) return;
        this._pushUndo(); // L03-216:页面上恒有,与本文件其它调用一致
        const cfg = clone(this._castConfig());
        cfg.cast = cfg.cast.filter((m) => m.id !== id);
        const extra = (refs.lines || refs.endings || refs.trust)
          ? { 'formData.chapters': storyCast.dropMemberRefs(this.data.formData.chapters, id) } : null;
        this._writeCast(cfg, extra);
        if (typeof after === 'function') after();
        if (typeof this._pageUndoBar === 'function') this._pageUndoBar('已删除「' + name + '」');
      },
    });
  },

  // ── 编辑角色弹窗 ──
  _openMember(member, isNew) {
    const options = storyCast.clueChapterOptions(this.data.formData.chapters);
    this.setData({
      castClueOptions: options,
      castEdit: Object.assign({}, this.data.castEdit, {
        show: true, isNew, m: member, errField: '', errMsg: '', scrollTo: '', recording: false, initial: storyCast.initialOf(member.name),
        avatarPreview: (this._castAvatarPreview || {})[member.id] || '',
        clueLabels: (member.clues || []).map((c) => storyCast.clueChapterLabel(options, c.chapterId)),
        atClueMax: (member.clues || []).length >= storyCast.MAX_CLUES,
      }),
    });
  },
  _patchMember(mutate, clearField) {
    const m = clone(this.data.castEdit.m);
    if (!m) return;
    mutate(m);
    const patch = {
      'castEdit.m': m,
      'castEdit.initial': storyCast.initialOf(m.name),
      'castEdit.clueLabels': (m.clues || []).map((c) => storyCast.clueChapterLabel(this.data.castClueOptions, c.chapterId)),
      'castEdit.atClueMax': (m.clues || []).length >= storyCast.MAX_CLUES,
    };
    if (clearField && (this.data.castEdit.errField === clearField || clearField === '*')) Object.assign(patch, { 'castEdit.errField': '', 'castEdit.errMsg': '' });
    this.setData(patch);
  },
  // L03-085:角色头像/录音上传在途时记下句柄;关面板时中止,「完成」时先等上传
  _startCastUpload(field, filePath, opts, onDone) {
    const job = { field };
    this._castUploads = this._castUploads || [];
    this._castUploads.push(job);
    job.handle = getApp().getUploadClient().uploadOne(filePath, Object.assign({}, opts, { onDone: (up) => {
      this._castUploads = (this._castUploads || []).filter((x) => x !== job);
      if (!job.aborted) onDone(up);
    } }));
    return job;
  },
  _abortCastUploads() {
    (this._castUploads || []).forEach((job) => { job.aborted = true; try { job.handle && job.handle.abort(); } catch (e) { /* 已结束 */ } });
    this._castUploads = [];
  },
  closeCastMember() {
    this._abortCastUploads();
    this._stopCastRecording(true);
    this._stopCastPreview();
    this.setData({ 'castEdit.show': false, 'castEdit.recording': false });
  },
  onCastMemberInput(e) {
    const field = e.currentTarget.dataset.field;
    if (field !== 'name' && field !== 'identity') return;
    this._patchMember((m) => { m[field] = e.detail.value; }, field);
  },
  onCastColor(e) {
    const color = e.currentTarget.dataset.color;
    if (storyCast.COLORS.indexOf(color) < 0) return;
    this._patchMember((m) => { m.color = color; }, 'color');
  },
  onCastVoice(e) {
    const value = e.currentTarget.dataset.value;
    this._patchMember((m) => {
      m.voice = value === 'none' ? { mode: 'none' } : { mode: 'preset', preset: value };
    }, 'voice');
  },
  pickCastAvatar() {
    const app = getApp();
    const edit = this.data.castEdit;
    if (!edit.show || !edit.m) return;
    const id = edit.m.id;
    const token = this._castAvatarToken = (this._castAvatarToken || 0) + 1;
    const current = () => !this._unloaded && this.data.castEdit.show && this.data.castEdit.m && this.data.castEdit.m.id === id && token === this._castAvatarToken;
    wx.chooseMedia({ count: 1, mediaType: ['image'], sourceType: ['album', 'camera'], sizeType: ['compressed'],
      success: (res) => {
        const file = res.tempFiles && res.tempFiles[0];
        if (!current() || !file) return;
        this._startCastUpload('avatar', file.tempFilePath, { fileSize: file.size, formData: { fileName: 'avatar.jpg', fileType: 'jpg' } }, (up) => {
          if (!current()) return;
          if (!up.ok || !up.data || !up.data.assetId) {
            this.setData({ 'castEdit.errField': 'avatar', 'castEdit.errMsg': up.msg || '头像上传失败，请重试', 'castEdit.scrollTo': 'cm-avatar' });
            return;
          }
          this._castAvatarPreview = Object.assign({}, this._castAvatarPreview, { [id]: file.tempFilePath });
          this.setData({ 'castEdit.avatarPreview': file.tempFilePath });
          this._patchMember((m) => { m.avatarUrl = 'media-asset:' + up.data.assetId; }, 'avatar');
        });
      },
      fail: (err) => { if (current() && !/cancel/.test((err && err.errMsg) || '')) this.setData({ 'castEdit.errField': 'avatar', 'castEdit.errMsg': '无法选择图片，请重试' }); },
    });
  },

  // 试听:拿预设声音念一句示例。TTS 没配置就把「试听」收起来,不弹错。
  previewCastVoice() {
    const app = getApp();
    const m = this.data.castEdit.m;
    if (!m || !m.voice || m.voice.mode !== 'preset' || this.data.castTtsOff) return;
    this._stopCastPreview();
    const preset = m.voice.preset;
    const token = this._castPreviewToken = (this._castPreviewToken || 0) + 1;
    this.setData({ castPreviewing: preset });
    app.sendRequest({
      url: '/api/topic/cast/voice', method: 'GET', hideLoading: true, autoErrorToast: false,
      data: { topicId: this.data.editingTopicId || '', preset },   // 试听念服务端固定的示例句(CastVoicePresets.SAMPLE_LINE),不上传文本
      success: (res) => {
        if (this._unloaded || token !== this._castPreviewToken) return;
        const url = res && Number(res.code) === 200 && res.data && res.data.url;
        if (!url) {
          if (ttsNotConfigured(res)) this.setData({ castTtsOff: true, castPreviewing: '' });
          else { this.setData({ castPreviewing: '' }); cyToast((res && res.msg) || '试听没有成功，请重试'); }
          return;
        }
        this._playCastUrl(url, token);
      },
      fail: () => { if (!this._unloaded && token === this._castPreviewToken) { this.setData({ castPreviewing: '' }); cyToast('试听没有成功，请重试'); } },
    });
  },
  _playCastUrl(url, token) {
    const audio = this._castAudio = wx.createInnerAudioContext();
    audio.src = url;
    audio.obeyMuteSwitch = false; // L03-204:静音键开着也能试听,与本页其它预听一致
    const done = () => {
      if (this._castAudio === audio) { try { audio.destroy(); } catch (e) { /* 已销毁 */ } this._castAudio = null; } // 放完即收
      if (token === this._castPreviewToken && !this._unloaded) this.setData({ castPreviewing: '', storyLinePlaying: '' });
    };
    audio.onEnded(done); audio.onError(done);
    audio.play();
  },
  _stopCastPreview() {
    this._castPreviewToken = (this._castPreviewToken || 0) + 1;
    if (this._castAudio) { try { this._castAudio.destroy(); } catch (e) { /* 已销毁 */ } }
    this._castAudio = null;
    if (this.data.castPreviewing || this.data.storyLinePlaying) this.setData({ castPreviewing: '', storyLinePlaying: '' });
  },

  // ── 录音(角色声音 / 单句对白共用一台 recorder)──
  _castRecorder() {
    if (this._castRec) return this._castRec;
    if (typeof wx.getRecorderManager !== 'function') return null;
    const rec = wx.getRecorderManager();
    rec.onStop((res) => this._onCastRecStop(res));
    rec.onError(() => {
      const target = this._castRecTarget;
      this._castRecTarget = null;
      if (this._unloaded || !target) return;
      this.setData({ 'castEdit.recording': false, storyLineRec: '' });
      cyToast('录音没有开始，请检查麦克风权限');
    });
    // L03-203:来电/切后台会暂停录音,界面却还显示「停止」;暂停即按停止收尾(已录的照常保存)
    const interrupted = () => this._stopCastRecording(false);
    if (typeof rec.onPause === 'function') rec.onPause(interrupted);
    if (typeof rec.onInterruptionBegin === 'function') rec.onInterruptionBegin(interrupted);
    this._castRec = rec;
    return rec;
  },
  _startCastRecording(target) {
    const rec = this._castRecorder();
    if (!rec) { cyToast('当前微信版本不支持录音'); return false; }
    // L03-203:同一台 recorder 正在录时再起一段会让 start 失败、把前一段的 onStop 丢掉;先丢弃正在录的那段,这次不起
    if (this._castRecTarget) { this._stopCastRecording(true); return false; }
    this._castRecTarget = target;
    rec.start({ duration: REC_MAX_MS, format: 'mp3', sampleRate: 44100, numberOfChannels: 1, encodeBitRate: 96000 });
    return true;
  },
  _stopCastRecording(discard) {
    const target = this._castRecTarget;
    if (!target) return;
    // 已在收尾(等 onStop)时只补记「丢弃」,不重复 stop
    this._castRecTarget = Object.assign({}, target, { discard: !!(target.discard || discard), stopping: true });
    if (target.stopping) return;
    try { this._castRec && this._castRec.stop(); } catch (e) { /* 没在录 */ }
  },
  _onCastRecStop(res) {
    const target = this._castRecTarget;
    this._castRecTarget = null;
    if (this._unloaded || !target) return;
    this.setData({ 'castEdit.recording': false, storyLineRec: '' });
    if (target.discard) return;
    if (!res || !res.tempFilePath || (Number(res.duration) || 0) < 500) { cyToast('录音太短，请再录一次'); return; }
    const opts = { fileSize: res.fileSize, timeoutMs: 60000, formData: { fileName: 'voice.mp3', fileType: 'mp3' } };
    const onDone = (up) => {
        if (this._unloaded) return;
        if (!up.ok || !up.data || !up.data.assetId) { cyToast(up.msg || '录音上传失败，请重试'); return; }
        const url = 'media-asset:' + up.data.assetId;
        if (target.kind === 'member') {
          const m = this.data.castEdit.m;
          if (this.data.castEdit.show && m && m.id === target.id) this._patchMember((x) => { x.voice = { mode: 'record', url }; }, 'voice');
        } else if (target.kind === 'line') {
          const chapter = this._storyChapter();
          if (!chapter || chapter._localId !== target.chapterLocalId) return;
          try {
            this._storyCommand({ type: 'updateLine', blockKey: target.blockKey, audioUrl: url });
            // L03-086:media-asset:N 在编辑器里放不了,刚录的这一句用本机临时文件回放
            this._lineAudioLocal = Object.assign({}, this._lineAudioLocal, { [url]: res.tempFilePath });
          } catch (error) { cyToast(getApp().getRequestErrorMessage(error, '保存录音失败')); }
        }
      };
    // 角色声音随角色面板走(关面板中止、完成前等它);单句对白的录音不挂在面板上
    if (target.kind === 'member') this._startCastUpload('voice', res.tempFilePath, opts, onDone);
    else getApp().getUploadClient().uploadOne(res.tempFilePath, Object.assign({ onDone }, opts));
  },
  toggleCastRecord() {
    const m = this.data.castEdit.m;
    if (!m) return;
    if (this.data.castEdit.recording) { this._stopCastRecording(false); return; }
    this._stopCastPreview();
    if (this._startCastRecording({ kind: 'member', id: m.id })) this.setData({ 'castEdit.recording': true });
  },

  // ── 你知道的(线索)/ 结局台词 ──
  addCastClue() {
    const m = this.data.castEdit.m;
    if (!m) return;
    if ((m.clues || []).length >= storyCast.MAX_CLUES) {
      this.setData({ 'castEdit.errField': 'clues', 'castEdit.errMsg': '「你知道的」最多 ' + storyCast.MAX_CLUES + ' 条', 'castEdit.scrollTo': 'cm-clues' });
      return;
    }
    this._patchMember((x) => { x.clues = (x.clues || []).concat([{ text: '', chapterId: null }]); }, 'clues');
  },
  onCastClueInput(e) {
    const i = Number(e.currentTarget.dataset.i);
    this._patchMember((x) => { if (x.clues[i]) x.clues[i].text = e.detail.value; }, 'clue' + i);
  },
  onCastClueChapter(e) {
    const i = Number(e.currentTarget.dataset.i);
    const opt = this.data.castClueOptions[Number(e.detail.value)];
    if (!opt) return;
    this._patchMember((x) => { if (x.clues[i]) x.clues[i].chapterId = opt.value; }, 'clue' + i);
  },
  removeCastClue(e) {
    const i = Number(e.currentTarget.dataset.i);
    this._patchMember((x) => { x.clues.splice(i, 1); }, '*');
  },
  onCastEndingLine(e) {
    const band = e.currentTarget.dataset.band;
    if (['low', 'mid', 'high'].indexOf(band) < 0) return;
    this._patchMember((x) => { x.endingLines = Object.assign({}, x.endingLines, { [band]: e.detail.value }); }, 'ending_' + band);
  },

  // 完成:有问题就滚到那一栏、红字说清楚(同 #871);没问题才写回清单
  saveCastMember() {
    const edit = this.data.castEdit;
    const m = edit.m;
    if (!m) return;
    const uploading = (this._castUploads || [])[0];
    if (uploading) { // L03-085:不在上传途中保存,否则头像/声音会悄悄丢掉
      this.setData({ 'castEdit.errField': uploading.field, 'castEdit.errMsg': '还在上传，请稍候再点完成', 'castEdit.scrollTo': anchorOf(uploading.field) });
      return;
    }
    const cfg = clone(this._castConfig()) || storyCast.emptyCastConfig();
    const chapterIds = (this.data.formData.chapters || []).filter((c) => c && c.id != null && c.id !== '').map((c) => c.id);
    const issues = storyCast.memberIssues(m, cfg.cast, chapterIds);
    if (issues.length) {
      this.setData({ 'castEdit.errField': issues[0].field, 'castEdit.errMsg': issues[0].message, 'castEdit.scrollTo': '' },
        () => this.setData({ 'castEdit.scrollTo': anchorOf(issues[0].field) }));
      return;
    }
    const at = cfg.cast.findIndex((x) => x.id === m.id);
    if (at >= 0) cfg.cast[at] = m;
    else {
      if (cfg.cast.length >= storyCast.MAX_CAST) { this.setData({ 'castEdit.errField': 'name', 'castEdit.errMsg': '角色最多 ' + storyCast.MAX_CAST + ' 位' }); return; }
      cfg.cast.push(m);
    }
    this._stopCastRecording(true);
    this._stopCastPreview();
    this._writeCast(cfg, { 'castEdit.show': false, castError: { field: '', message: '' } });
  },
  deleteCastMember() {
    const m = this.data.castEdit.m;
    if (!m) return;
    if (this.data.castEdit.isNew) { this.closeCastMember(); return; }
    this._confirmRemoveMember(m.id, () => this.closeCastMember());
  },

  // ── 故事编辑器:「谁在说话」 ──
  _openSpeakerSheet(blockKey) {
    this._storyLineKey = blockKey || ''; // L03-213:不渲染,放实例
    this.setData({ storySheet: 'speaker' });
  },
  onStoryLineSpeakerTap(e) {
    if (this.data.storyEditor.preview || !this.data.castOn) return;
    this._openSpeakerSheet(e.currentTarget.dataset.blockkey);
  },
  onStorySpeakerPick(e) {
    const value = e.currentTarget.dataset.value;
    const blockKey = this._storyLineKey;
    this._storyLineKey = '';
    this.setData({ storySheet: '' });
    if (blockKey) {
      try { this._pushUndo(); this._storyCommand({ type: 'updateLine', blockKey, speaker: value }); }
      catch (error) { cyToast(getApp().getRequestErrorMessage(error, '换说话的人失败')); }
      return;
    }
    const index = Number.isInteger(this._storyAddAt) ? this._storyAddAt : (((this._storyChapter() || {}).blocks) || []).length;
    this._storyAddAt = null;
    this._pushUndo();
    if (value === 'narrator') {
      this.insertStoryTextAt({ currentTarget: { dataset: { index } } });
      this._storyUndoBar('已添加段落');
      return;
    }
    if (this._insertStoryMedia('line', index, { speaker: value })) this._storyUndoBar('已添加对白');
  },
  onStoryLineInput(e) {
    try { this._storyCommand({ type: 'updateLine', blockKey: e.currentTarget.dataset.blockkey, content: e.detail.value }); }
    catch (error) { cyToast(getApp().getRequestErrorMessage(error, '修改失败')); }
  },
  toggleStoryLineRecord(e) {
    const blockKey = e.currentTarget.dataset.blockkey;
    if (this.data.storyLineRec) { this._stopCastRecording(this.data.storyLineRec !== blockKey); return; }
    const chapter = this._storyChapter();
    if (!chapter) return;
    this._stopCastPreview(); // 开录前停掉正在回放的那一句
    if (this._startCastRecording({ kind: 'line', blockKey, chapterLocalId: chapter._localId })) this.setData({ storyLineRec: blockKey });
  },
  clearStoryLineAudio(e) {
    if (this.data.storyLinePlaying) this._stopCastPreview();
    try { this._storyCommand({ type: 'updateLine', blockKey: e.currentTarget.dataset.blockkey, audioUrl: '' }); }
    catch (error) { cyToast(getApp().getRequestErrorMessage(error, '修改失败')); }
  },
  // L03-086 业主默认 A:回放这一句。已保存的录音由服务端换成 https 地址;刚录的 media-asset:N 用本机临时文件
  playStoryLineAudio(e) {
    const blockKey = e.currentTarget.dataset.blockkey;
    const raw = String(e.currentTarget.dataset.src || '');
    const playing = this.data.storyLinePlaying;
    this._stopCastPreview();
    if (playing === blockKey) return;
    const src = /^https:\/\//.test(raw) ? raw : ((this._lineAudioLocal || {})[raw] || '');
    if (!src) { cyToast('这段录音保存后才能回放'); return; }
    const token = this._castPreviewToken;
    this.setData({ storyLinePlaying: blockKey });
    this._playCastUrl(src, token);
  },

  // ── 分支选项的「信任」(D2):每个角色一个 ±stepper,0 收起 ──
  _refreshBranchTrust(options) {
    const cfg = this._castConfig();
    this.setData({ storyBranchTrust: (options || []).map((opt) => storyCast.trustRows(cfg, opt && opt.trust)) });
  },
  onStoryBranchTrust(e) {
    const i = Number(e.currentTarget.dataset.i);
    const castId = e.currentTarget.dataset.cast;
    const opt = (this.data.storyBranch.options || [])[i];
    if (!opt) return;
    const order = ((this._castConfig() || {}).cast || []).map((m) => m.id);
    const value = e.detail && e.detail.value != null ? Number(e.detail.value) : Number(e.currentTarget.dataset.v);
    this._storyBranchCommand({ option: { index: i, trust: storyCast.setTrust(opt.trust, castId, value, order) } });
  },

  // ── 结局章「归属角色」(D2)──
  _syncChapterEndingCast(ending) {
    const options = storyCast.endingForOptions(this._castConfig());
    const at = ending && ending.kind === 'cast' ? options.findIndex((o) => o.value === ending.endingFor) : -1;
    this.setData({ chapterEndingCastOptions: options, chapterEndingCastIndex: Math.max(0, at) });
  },
  onChapterEndingCast(e) {
    const opt = this.data.chapterEndingCastOptions[Number(e.detail.value)];
    if (!opt) return;
    const ending = opt.value ? { fallback: false, kind: 'cast', endingFor: opt.value }
      : { fallback: false, kind: 'thought', thoughtKey: '', thoughtName: '', tag: '', tagLabel: '', nodeId: null, nodeName: '' };
    const kinds = this.data.chapterEndingKinds || [];
    this.setData({ 'chapterForm.ending': ending, chapterEndingCastIndex: Number(e.detail.value),
      chapterEndingKindIndex: Math.max(0, kinds.findIndex((k) => k.key === ending.kind)), chapterEndingPickIndex: -1 },
    () => this._refreshChapterEndingError());
  },

  _castCleanup() {
    this._stopCastRecording(true);
    this._stopCastPreview();
  },
};

// 保存闸:上送前把整份配置过一遍,第一处问题直接抛错,由提交方 toast 原因(L03-212:不会自动打开角色弹窗定位)
// 草稿 / 自动保存:写了一半的不带、带不了就整份不带(服务端不改这一列),不拦整份主题的保存
function payloadOf(page, draft) {
  const cfg = page._castConfig();
  if (!cfg) return null;
  const chapterIds = (page.data.formData.chapters || []).filter((c) => c && c.id != null && c.id !== '').map((c) => c.id);
  return storyCast.serializeCastConfig(cfg, chapterIds, { draft: !!draft });
}

module.exports = { data, methods, payloadOf, STORY_LINE_ITEM };
