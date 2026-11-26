'use strict';
// L03-206:章节视频与章节音频(上传/清空/读时长)同住这里
const { memberId } = require('../../../utils/session/login-reload.js');
const MAX_BYTES = 10 * 1024 * 1024;
function videoError(file) {
  if (!file || !/\.mp4(?:$|\?)/i.test(file.tempFilePath || '')) return '请选择 mp4 视频';
  if (!Number.isFinite(file.duration) || file.duration <= 0 || file.duration > 30) return '视频不能超过 30 秒';
  if (!Number.isFinite(file.size) || file.size <= 0 || file.size > MAX_BYTES) return '视频不能超过 10 MB';
  if (!file.thumbTempFilePath) return '无法读取视频封面，请更换文件';
  return '';
}
const methods = {
  // L03-089:章节视频(封面 + 视频两段上传)的句柄,重选/清空/取消章节编辑时中止,不让被丢弃的 10 MB 上传继续跑
  _abortChapterVideoUpload() {
    (this._chapterVideoUploads || []).forEach((handle) => { try { handle && handle.abort(); } catch (e) { /* 已结束 */ } });
    this._chapterVideoUploads = [];
  },
  uploadChapterVideo() {
    const app = getApp(), chapter = this.data.chapterForm;
    if (!chapter || (!chapter.opening && !chapter.ending)) return;
    this._abortChapterVideoUpload();
    const owner = String(app.getUserID() || ''), scope = this.data.operationScope;
    const token = this._chapterVideoToken = (this._chapterVideoToken || 0) + 1;
    const current = () => !this._unloaded && this.data.popChapter && chapter === this.data.chapterForm
      && token === this._chapterVideoToken && owner === String(app.getUserID() || '') && scope === this.data.operationScope;
    this.setData({ chapterVideoError: '' });
    wx.chooseMedia({ count: 1, mediaType: ['video'], sourceType: ['album', 'camera'], maxDuration: 30,
      success: res => {
        if (!current()) return;
        const file = res.tempFiles && res.tempFiles[0], error = videoError(file);
        if (error) { this.setData({ chapterVideoError: error }); return; }
        // Commit the pair only after both uploads succeed; an unsuccessful replacement preserves the old clip.
        const uploads = this._chapterVideoUploads = [];
        uploads.push(app.getUploadClient().uploadOne(file.thumbTempFilePath, { formData: { fileName: 'poster.jpg', fileType: 'jpg' }, onDone: poster => {
          if (!current()) return;
          if (!poster.ok || !poster.data || !poster.data.assetId) { this.setData({ chapterVideoError: poster.msg || '封面上传失败，请重试' }); return; }
          uploads.push(app.getUploadClient().uploadOne(file.tempFilePath, { fileSize: file.size, timeoutMs: 60000,
            formData: { fileName: 'chapter.mp4', fileType: 'mp4' }, onDone: video => {
              if (!current()) return;
              if (!video.ok || !video.data || !video.data.assetId) { this.setData({ chapterVideoError: video.msg || '视频上传失败，请重试' }); return; }
              this.setData({ 'chapterForm.videoUrl': 'media-asset:' + video.data.assetId,
                'chapterForm.videoPosterUrl': 'media-asset:' + poster.data.assetId,
                chapterVideoError: video.data.reviewState === 'APPROVED' ? '' : '视频已提交审核，通过后可发布' });
            } }));
        } }));
      },
      fail: err => { if (current() && !/cancel/.test(err.errMsg || '')) this.setData({ chapterVideoError: '无法选择视频，请重试' }); }
    });
  },
  clearChapterVideo() {
    this._chapterVideoToken = (this._chapterVideoToken || 0) + 1;
    this._abortChapterVideoUpload();
    this.setData({ 'chapterForm.videoUrl': '', 'chapterForm.videoPosterUrl': '', chapterVideoError: '' });
  },
  uploadThemeAudio() {
    const app = getApp(), form = this.data.formData, owner = String(app.getUserID() || ''), scope = this.data.operationScope;
    const target = JSON.stringify([this.data.editingTopicId, this.data.draftUuid, this._editLoadToken]);
    const token = this._themeAudioToken = (this._themeAudioToken || 0) + 1;
    app.chooseDocument(files => {
      if (this._unloaded || this.data.formData !== form || token !== this._themeAudioToken
          || owner !== String(app.getUserID() || '') || scope !== this.data.operationScope
          || target !== JSON.stringify([this.data.editingTopicId, this.data.draftUuid, this._editLoadToken])) return;
      if (files && files[0] && files[0].url) this.setData({ 'formData.audioUrl': files[0].url, 'formData.audioDuration': 0 }); // L03-088:换文件不沿用上一段的时长
    }, 1, ['mp3', 'm4a', 'aac']);
  },
  clearThemeAudio() {
    this._themeAudioToken = (this._themeAudioToken || 0) + 1;
    this.setData({ 'formData.audioUrl': '', 'formData.audioDuration': 0 });
  },

  // ===== 章节音频(2026-09-04 拍板:一章最多一段,挂在章节上而不是故事流的块里)=====
  // 章节旁白与主题循环配乐各自保存。
  uploadChapterAudio() {
    const that = this;
    const chapterForm = this.data.chapterForm;
    const chapterIndex = this.data.popChapterIndex;
    const owner = memberId(getApp());
    const token = (this._chapterAudioToken || 0) + 1;
    this._chapterAudioToken = token;
    this._destroyChapterDurationAudio();
    getApp().chooseDocument(function (res) {
      if (that._unloaded || !that.data.popChapter
          || token !== that._chapterAudioToken || chapterForm !== that.data.chapterForm
          || chapterIndex !== that.data.popChapterIndex
          || owner !== memberId(getApp())) return;
      if (res && res[0] && res[0].url) {
        const file = res[0];
        that.setData({
          'chapterForm.audioUrl': file.url,
          'chapterForm.audioFileName': file.filename || '',
          'chapterForm.audioDuration': 0
        });
        that.autoDetectAudioDuration(file.url);
      }
    }, 1, ['mp3', 'm4a', 'aac']);
  },

  _destroyChapterDurationAudio() {
    if (this._chapterDurationPoll) clearTimeout(this._chapterDurationPoll);
    this._chapterDurationPoll = null;
    const audio = this._chapterDurationAudio;
    this._chapterDurationAudio = null;
    if (audio) audio.destroy();
  },

  autoDetectAudioDuration(url) {
    const that = this;
    const chapterForm = this.data.chapterForm;
    const chapterIndex = this.data.popChapterIndex;
    const owner = memberId(getApp());
    const token = this._chapterAudioToken;
    this._destroyChapterDurationAudio();
    const audio = wx.createInnerAudioContext();
    this._chapterDurationAudio = audio;
    audio.src = url;
    audio.obeyMuteSwitch = false;
    audio.onCanplay(function () {
      if (that._chapterDurationAudio !== audio) return;
      const current = !that._unloaded && that.data.popChapter
        && token === that._chapterAudioToken && chapterForm === that.data.chapterForm
        && chapterIndex === that.data.popChapterIndex && that.data.chapterForm.audioUrl === url
        && owner === memberId(getApp());
      if (!current) { that._destroyChapterDurationAudio(); return; }
      // L03-048:iOS 的 InnerAudioContext 在 canplay 时常报 0,隔一会儿再读几次
      let tries = 0;
      const read = () => {
        if (that._chapterDurationAudio !== audio) return;
        const duration = Math.round(audio.duration || 0);
        if (duration > 0 && that.data.popChapter && token === that._chapterAudioToken && that.data.chapterForm.audioUrl === url) {
          that.setData({ 'chapterForm.audioDuration': duration });
        } else if (duration <= 0 && tries < 5) {
          tries += 1; that._chapterDurationPoll = setTimeout(read, 200); return;
        }
        that._destroyChapterDurationAudio();
      };
      read();
    });
    audio.onError(function () {
      if (that._chapterDurationAudio === audio) that._destroyChapterDurationAudio();
    });
  },

  clearChapterAudio() {
    this._chapterAudioToken = (this._chapterAudioToken || 0) + 1;
    this._destroyChapterDurationAudio();
    this.destroyPreviewAudio();
    this.setData({
      'chapterForm.audioUrl': '', 'chapterForm.audioDuration': 0,
      'chapterForm.audioFileName': ''
    });
  },
};
const data = { chapterVideoError: '' };
module.exports = { videoError, methods, data };
