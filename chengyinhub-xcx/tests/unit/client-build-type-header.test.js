'use strict';
// B3:开发版/体验版请求落生产库是 owner 裁决;每个请求带 X-Client-Env,报表可据此排除非正式版流量。
const test = require('node:test');
const assert = require('node:assert/strict');
const {createRequestClient, clientBuildType} = require('../../utils/transport/request-client');
const {createUploadClient} = require('../../utils/transport/upload-client');

test('request carries the build type; unknown or injected values are dropped', () => {
  for (const [value, expected] of [['release', 'release'], ['trial', 'trial'], ['develop', 'develop'], ['unknown', undefined], ['x\r\nA: b', undefined], [undefined, undefined]]) {
    let options;
    const client = createRequestClient({wxRequest: o => {options = o;}, getBaseUrl: () => 'https://base', getBuildType: () => value});
    client.send({url: '/read'});
    assert.equal(options.header['X-Client-Env'], expected);
  }
  let options;
  createRequestClient({wxRequest: o => {options = o;}, getBaseUrl: () => 'https://base', getBuildType: () => { throw Error('x'); }}).send({url: '/read'});
  assert.equal(options.header['X-Client-Env'], undefined);
  assert.equal(clientBuildType('trial'), 'trial');
});

test('upload carries the same build type header', () => {
  const calls = [];
  const client = createUploadClient({wxUploadFile: o => { calls.push(o); return {abort() {}}; }, getBaseUrl: () => 'https://base', getAuthorization: () => 't', getBuildType: () => 'trial', setTimer: () => 0, clearTimer() {}});
  client.uploadAll(['wxfile://a.jpg']);
  assert.equal(calls[0].header['X-Client-Env'], 'trial');
});

