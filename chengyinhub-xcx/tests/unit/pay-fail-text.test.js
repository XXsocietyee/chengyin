'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { payFailText } = require('../../subpackageMember/utils/pay-fail-text.js');

test('L09-016 支付失败文案:SDK 原文/英文/空值统一成可读提示,中文业务原因保留', () => {
  assert.equal(payFailText({ errMsg: 'requestPayment:fail cancel' }), '支付未完成，请重试');
  assert.equal(payFailText({ errMsg: 'network error' }), '支付未完成，请重试');
  assert.equal(payFailText(null), '支付未完成，请重试');
  assert.equal(payFailText({ errMsg: '余额不足' }), '余额不足');
});
