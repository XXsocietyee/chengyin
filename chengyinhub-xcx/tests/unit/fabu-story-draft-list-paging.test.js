const test = require('node:test');
const assert = require('node:assert/strict');

test('站点选玩法：不请求或展示草稿，只保留最新返回的已发布模板（审核中的标记出来）', () => {
  const sent = [];
  global.wx = { getStorageSync() { return ''; }, setStorageSync() {}, showToast() {}, getSystemInfoSync() { return {}; }, getWindowInfo() { return {}; } };
  global.getApp = () => ({ globalData: {}, getUserID: () => 42, sendRequest: opts => sent.push(opts) });
  let page; global.Page = value => { page = value; };
  delete require.cache[require.resolve('../../pages/publish/fabu/index')];
  require('../../pages/publish/fabu/index');
  page.data = { operationScope: '' }; page.setData = patch => Object.assign(page.data, patch); page._refreshSupportMatrix = () => {};
  assert.equal(page.getStoryDraftList, undefined, 'AUDIT-1122 L03-177:草稿列表桩已删除');
  assert.equal('storyDraftList' in page.data, false);

  page.getTempList();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].data.is_quote, 1); assert.equal(sent[0].data.draft_status, 1);
  const published = { id: 141, title: '已发布玩法', draftStatus: 1, status: 1, publishStatus: 0 };
  sent[0].success({ code: 200, data: { rows: [published,
    { ...published, id: 142, draftStatus: 0 }, { ...published, id: 143, status: 0 },
    { id: 144, title: '缺少状态' }], total: 4 } });
  // 2026-11-22 业主拍板 C:审核中的照列并标 _reviewing(点了说明要等审核通过),草稿、驳回和状态缺失仍不列
  assert.deepEqual(page.data.tempList, [{ ...published, _reviewing: false }, { ...published, id: 143, status: 0, _reviewing: true }],
    '本人私有的已发布模板可列，草稿和状态缺失均不可用');
  page.getTempList(); const stale = sent.at(-1);
  page.getTempList(); const fresh = sent.at(-1);
  fresh.success({ code: 200, data: { rows: [{ ...published, id: 2, title: 'new' }], total: 1 } });
  stale.success({ code: 200, data: { rows: [{ ...published, id: 1, title: 'old' }], total: 1 } });
  assert.deepEqual(page.data.tempList.map(r => r.id), [2], '旧请求回包不覆盖最新模板');
});
