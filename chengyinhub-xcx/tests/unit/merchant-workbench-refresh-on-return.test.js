const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

// L07-010(业主 2026-11-24 选「回来就刷新」):写方在接受合作 / 发布活动成功时打标记,
// 工作台 onShow 消费它走整链(行为见 merchant-verification-scope-epoch.test.js)。
const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('接受合作邀约的各入口都标记工作台待刷新', () => {
  const list = read('pages/coop/list/index.js');
  assert.match(list, /if \(accept && res\.code == '200'\) app\.globalData\.merchantWorkbenchStale = true;/);
  assert.match(list, /if \(status === 1\) app\.globalData\.merchantWorkbenchStale = true;/);
  const detail = read('pages/coop/invite-detail/index.js');
  assert.match(detail, /const markMerchantWorkbenchStale = \(\) => \{ app\.globalData\.merchantWorkbenchStale = true; \};/);
  assert.match(detail, /if \(status === 1 && String\(res && res\.code\) === '200'\) markMerchantWorkbenchStale\(\);/);
  const chapter = read('pages/topic/merchantinfo/merchantinfo.js');
  assert.match(chapter, /if \(accepted && res\.code == '200' && app\.globalData\) app\.globalData\.merchantWorkbenchStale = true;/);
});

test('发布活动成功标记工作台待刷新', () => {
  const src = read('pages/publish/activity/index.js');
  const onSuccess = src.slice(src.indexOf('onSuccess: (resData) => {'), src.indexOf('onFail: (res) => {'));
  assert.match(onSuccess, /app\.globalData\.merchantWorkbenchStale = true/);
});

test('工作台消费标记后关闭轻量回读', () => {
  const src = read('pages/merchant/index/index.js');
  assert.match(src, /const stale = !!\(app\.globalData && app\.globalData\.merchantWorkbenchStale === true\);/);
  assert.match(src, /this\._lightReload = !stale && /);
});
