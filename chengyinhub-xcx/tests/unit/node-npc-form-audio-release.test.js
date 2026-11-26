'use strict';
// B7:NPC 表单组件卸载时销毁 InnerAudioContext(stop 不释放原生实例)。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('detached destroys the audio context it created', () => {
  let definition;
  const audio = { stopped: 0, destroyed: 0, stop() { this.stopped++; }, destroy() { this.destroyed++; },
    onEnded() {}, onStop() {}, onError() {}, onCanplay() {}, play() {} };
  const file = path.resolve(__dirname, '../../pages/topic/components/cy/node-npc-form/index.js');
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    getApp: () => ({ globalData: {}, getUserID: () => '7' }), Component: (d) => { definition = d; },
    wx: { createInnerAudioContext: () => audio, getStorageSync: () => '' }, setTimeout: () => 0, clearTimeout() {}, console,
    require(id) {
      if (id.endsWith('pixel-avatar.js')) return { AVATAR_IDS: ['one'], stringifyCode: () => 'px1:one', isPixelAvatar: () => false, parseCode: () => 'one' };
      if (id.endsWith('pixel-avatar-data.js')) return { AVATARS: { one: { name: 'fixture' } } };
      if (id.endsWith('upload-client.js')) return { MAX_UPLOAD_FILE_SIZE: 10485760 };
      return {};
    },
  }, { filename: file });
  const comp = Object.assign({}, definition.methods, { data: JSON.parse(JSON.stringify(definition.data)), setData(p) { Object.assign(this.data, p); } });
  assert.equal(comp._audioContext(), audio);
  definition.lifetimes.detached.call(comp);
  assert.equal(audio.destroyed, 1);
  assert.equal(comp._audio, null);
});
