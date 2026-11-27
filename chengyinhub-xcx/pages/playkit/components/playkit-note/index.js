// cy-playkit-note · 留言(契约 §2.4)
//
// 写一句留给后来的人。审核本轮只做长度 + 预设短句两道(机审不接),
// 组件这边只保证:不超过 maxLength、空句不发、留过之后不再发第二遍。
// ★ 存哪儿是服务端的事(优先复用 dailySign 那套跨玩家存储),客户端不挑存储。
const reducedMotionBehavior = require('../../../../behaviors/reduced-motion.js');
const motion = require('../../../../utils/motion.js');
const cyModal = require('../../../../utils/modal.js');
const kitDraft = require('../../utils/kit-draft.js');
const { holdSubmit, releaseSubmit } = require('../../utils/submit-hold.js');

Component({
  behaviors: [reducedMotionBehavior],
  properties: {
    show: { type: Boolean, value: false },
    title: { type: String, value: '' },
    prompt: { type: String, value: '' },
    maxLength: { type: Number, value: 40 },
    presets: { type: Array, value: [] },
    previous: { type: Array, value: [] },     // 前几条:{ text, at }
    mine: { type: String, value: '' },
    done: { type: Boolean, value: false },
    // 写了一半的那句存哪(页面给;空 = 不存)。中途退出重进还在(2026-09-24)
    draftKey: { type: String, value: '' },
  },
  data: {
    text: '',
    countLabel: '',
    canSubmit: false,
  },
  observers: {
    'show, done, mine, maxLength': function (show, done, mine, maxLength) {
      releaseSubmit(this);
      // L02-040: 这一层收起时立刻落盘。只等停手的话，关掉再打开会读到少几个字的旧稿
      if (!show) {
        if (done) kitDraft.drop(this);
        else kitDraft.flush(this);
        return;
      }
      if (done) { kitDraft.drop(this); kitDraft.clear(this.data.draftKey); }
      const text = done ? String(mine || '') : String(kitDraft.read(this.data.draftKey).text || '');
      this.setData({
        text,
        countLabel: text.length + '/' + (Number(maxLength) || 0),
        canSubmit: !done && !!text.trim(),
      });
    },
  },
  lifetimes: { detached() { kitDraft.flush(this); releaseSubmit(this); } },
  pageLifetimes: { hide() { kitDraft.flush(this); } },
  methods: {
    _applyPreset(text) {
      this.setData({
        text,
        countLabel: text.length + '/' + (Number(this.data.maxLength) || 0),
        canSubmit: !!text.trim(),
      });
      kitDraft.write(this.data.draftKey, { text });
    },
    onInput(e) {
      if (this.data.done) return;
      const text = e.detail.value == null ? '' : String(e.detail.value);
      this.setData({
        text,
        countLabel: text.length + '/' + (Number(this.data.maxLength) || 0),
        canSubmit: !!text.trim(),
      });
      kitDraft.writeSoon(this, this.data.draftKey, { text });  // L02-040
    },
    onPickPreset(e) {
      if (this.data.done) return;
      const text = String(e.currentTarget.dataset.text || '');
      const cur = String(this.data.text || '');
      const presets = this.data.presets || [];
      // 玩家自己打过字(且不是当前选中的预设短句):套用预设前先确认,避免手滑清掉草稿
      if (cur.trim() && cur !== text && presets.indexOf(cur) < 0) {
        cyModal.show({
          title: '替换当前内容？',
          content: '使用预设短句会覆盖已写好的留言。',
          confirmText: '替换',
          cancelText: '取消',
          success: (res) => {
            if (res && res.confirm && !this.data.done) this._applyPreset(text);
          },
        });
        return;
      }
      this._applyPreset(text);
    },
    onSubmit() {
      if (this.data.done || !this.data.canSubmit || !holdSubmit(this)) return;
      // 留言提交不可撤销 —— 与作答同一档触感
      motion.haptic({ reducedMotion: this.data.reducedMotion, type: 'medium' });
      this.triggerEvent('submit', { text: this.data.text });
    },
    onClose() {
      releaseSubmit(this);
      if (this.data.done) kitDraft.drop(this);
      else kitDraft.flush(this);
      this.triggerEvent('close');
    },
  },
});
