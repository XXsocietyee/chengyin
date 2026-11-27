'use strict';
// L10-200:个人主页深链。坏掉的 % 不能让 onLoad 抛错，章节编号要从参数读进来。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function mount() {
  let def;
  const file = path.resolve(__dirname, '../../pages/userinfo/userinfo.js');
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    Page: (v) => { def = v; },
    wx: { hideShareMenu() {} },
  }, { filename: file });
  const page = { data: JSON.parse(JSON.stringify(def.data)), setData(v) { Object.assign(this.data, v); } };
  return Object.assign(page, def);
}

test('坏掉的 topicName 不会让 onLoad 抛错，chapterId 从参数读入', () => {
  const page = mount();
  assert.doesNotThrow(() => page.onLoad({ userId: '9', topicName: '%E4', chapterId: '42', topicId: '7' }));
  assert.equal(page.data.topicName, '%E4');
  assert.equal(page.data.chapterId, '42');
  assert.equal(page.data.topicId, '7');
  assert.equal(page.data.userId, '9');
});

test('正常编码的主题名会解开', () => {
  const page = mount();
  page.onLoad({ userId: '1', topicName: '%E5%9F%8E%E7%98%BE' });
  assert.equal(page.data.topicName, '城瘾');
  assert.equal(page.data.chapterId, '');
});
