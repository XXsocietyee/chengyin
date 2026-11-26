'use strict';
// recheck-1122(VERIFY-E part2 RISK):这些 POST 是写操作,但路径末段(mute / block / unblock / become-leader)
// 不在传输层写词表里,会被按「读」处理——游客 401 时不弹「登录后继续」。显式 write: true 钉住。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '../..');

const CASES = [
  ['subpackageB/pages/im/list/index.js', '/api/im/mute'],
  ['subpackageB/pages/im/chat/index.js', '/api/im/block'],
  ['subpackageB/pages/im/chat/index.js', '/api/im/unblock'],
  ['pages/club/apply/index.js', '/api/club/become-leader'],
];

for (const [file, api] of CASES) {
  test(`${api} 显式标为写请求(${file})`, () => {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const at = src.indexOf(`'${api}'`);
    assert.ok(at >= 0, `${file} 里找不到 ${api}`);
    const call = src.slice(src.lastIndexOf('sendRequest(', at), src.indexOf('success', at));
    assert.match(call, /write:\s*true/, `${api} 的 sendRequest 缺 write: true`);
  });
}

test('负控:去掉 write: true 时这些路径会被按读处理', () => {
  // L10-128 起没有读词表了(写动词优先,其余按读),前提只剩「这些词不在写词表」
  const { isWriteRequest, WRITE_TOKENS } = require('../../utils/transport/request-client.js');
  for (const token of ['mute', 'block', 'unblock', 'leader', 'become']) {
    assert.ok(WRITE_TOKENS.indexOf(token) < 0, `${token} 已进词表,本测试的前提变了`);
  }
  for (const [, api] of CASES) assert.equal(isWriteRequest({ url: api }, 'POST'), false, api);
});
