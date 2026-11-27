'use strict';

// 主题客户名单:卸载后的回包不能再 setData;失败文案不能把异常原文给用户看。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const FILE = path.resolve(__dirname, '../../components/cy/scene-topic-customers/index.js');

function mount() {
  let definition;
  const requests = [];
  global.Component = (config) => { definition = config; };
  global.getApp = () => ({ sendRequest(options) { requests.push(options); } });
  delete require.cache[FILE];
  require(FILE);
  const vm = Object.assign({}, definition.methods, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) { Object.assign(this.data, patch); },
  });
  return { definition, vm, requests };
}

const EMPTY = { sessions: [], soldCount: 0, pendingCount: 0, contactedCount: 0, verifiedCount: 0 };

test('卸载后的客户名单回包不再写入', () => {
  const { definition, vm, requests } = mount();
  vm.load();
  definition.lifetimes.detached.call(vm);
  requests[0].success({ code: '200', data: EMPTY });
  assert.equal(vm.data.state, 'loading');
  assert.equal(vm.data.summary, null);
});

test('没有权限仍进无权限态,异常原文不进错误文案', () => {
  const denied = mount();
  denied.vm.load();
  denied.requests[0].success({ code: 403, msg: '没有权限' });
  assert.equal(denied.vm.data.state, 'no-permission');
  assert.match(denied.vm.data.errorText, /没有权限/);

  const broken = mount();
  broken.vm.load();
  broken.requests[0].success({ code: 500, msg: 'java.lang.NullPointerException: boom' });
  assert.equal(broken.vm.data.state, 'error');
  assert.equal(broken.vm.data.errorText, '服务开小差了，请稍后重试');
  assert.doesNotMatch(broken.vm.data.errorText, /Exception/);
});
