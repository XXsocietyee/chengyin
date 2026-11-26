const reducedMotionBehavior = require('../../../behaviors/reduced-motion.js');

Component({
  behaviors: [reducedMotionBehavior],
  properties: {
    message: { type: String, value: '当前离线，内容可能不是最新的' },
    cacheTime: { type: String, value: '' },
    action: { type: String, value: '' },
    // 资金 / 表单等严肃场景使用 danger 语气；默认仍是克制的 warning。
    serious: { type: Boolean, value: false },
    aria: { type: String, value: '' },
  },
  data: {
    _cacheCopy: '',
  },
  observers: {
    // L10-170:只有 cacheTime 影响 _cacheCopy(播报文案直接在 wxml 里由 message / aria 组合)。
    cacheTime(cacheTime) {
      const cacheCopy = cacheTime ? `缓存更新于 ${cacheTime}` : '';
      this.setData({
        _cacheCopy: cacheCopy,
      });
    },
  },
  methods: {
    onAction() { this.triggerEvent('action'); },
  },
});
