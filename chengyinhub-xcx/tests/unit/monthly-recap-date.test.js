const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const pagePath = path.resolve(__dirname, '../../subpackageTools/monthly-recap/index.js');
for (const timezone of ['America/Los_Angeles', 'UTC', 'Asia/Shanghai']) {
  test('monthly Shanghai dates and week buckets independent of device zone: ' + timezone, () => {
    const code = `
      const fs=require('fs'),vm=require('vm'),path=require('path'); let page;
      vm.runInNewContext(fs.readFileSync(${JSON.stringify(pagePath)},'utf8'),{Page:p=>page=p,require:r=>r==='../cloud-ten-runtime'?{page:p=>p}:require(path.resolve(path.dirname(${JSON.stringify(pagePath)}),r))});
      const items=[{id:'1',occurredAt:'2026-10-25 12:00:00'},{id:'2',occurredAt:'2026-09-30 23:59:59'},{id:'3',occurredAt:'2026-10-01 00:00:00'},{id:'4',occurredAtMs:Date.parse('2026-10-25T04:00:00Z')},{id:'5',occurredAt:'invalid'}];
      const ctx={_month:'2026-10',data:{kindIndex:2},client:{load:()=>({items,hasMore:false,counts:{}})},run:(action,patch)=>patch(action())};
      console.log(JSON.stringify(page.methods.refresh.call(ctx)));
    `;
    const value = JSON.parse(execFileSync(process.execPath, ['-e', code], { env: { ...process.env, TZ: timezone }, encoding: 'utf8' }));
    assert.deepEqual(value.items.map(r => r.dateText), ['10/25', '9/30', '10/1', '10/25', '']);
    assert.deepEqual(value.weeks.map(r => r.count), [1, 0, 0, 2, 1]);
  });
}

function loadRecap() {
  const fs = require('fs'), vm = require('vm'); let page;
  vm.runInNewContext(fs.readFileSync(pagePath, 'utf8'), { Page: p => page = p,
    require: r => r === '../cloud-ten-runtime' ? { page: p => p } : require(path.resolve(path.dirname(pagePath), r)) });
  return page;
}
test('L09-060 后续页保留已经读到的周次,可见列表仍只换当前页', () => {
  const page = loadRecap();
  const ctx = { _month: '2026-10', data: { kindIndex: 0, weeks: [] },
    client: { load: () => ({ items: [{ id: '1', occurredAt: '2026-10-02 12:00:00' }], hasMore: true, counts: {} }),
      next: () => ({ items: [{ id: '1', occurredAt: '2026-10-02 12:00:00' }, { id: '2', occurredAt: '2026-10-25 12:00:00' }], hasMore: false, counts: {} }) },
    run(action, patch) { const value = patch(action()); Object.assign(this.data, value); return value; } };
  assert.equal(page.methods.refresh.call(ctx).weeks.length, 0);
  const kept = [{ label: '第1周', count: 4, height: 220, isMax: true }];
  ctx.data.weeks = kept;
  ctx.client.next = () => ({ items: [{ id: '3', occurredAt: '2026-10-09 12:00:00' }], hasMore: true, counts: {} });
  assert.equal(page.methods.next.call(ctx).weeks, kept);
  ctx.client.next = () => ({ items: [{ id: '1', occurredAt: '2026-10-02 12:00:00' }, { id: '2', occurredAt: '2026-10-25 12:00:00' }], hasMore: false, counts: {} });
  const last = page.methods.next.call(ctx);
  assert.deepEqual(Array.from(last.items, item => String(item.id)), ['1', '2']);
  assert.deepEqual(Array.from(last.weeks, week => Number(week.count)), [1, 1, 0, 1, 0]);
});
test('L09-061 同一身份回到页面保留月份与类型', () => {
  const page = loadRecap();
  const months = [];
  const ctx = Object.assign({}, page.methods, { _identity: 'a', data: { kindIndex: 0 }, setData(p) { Object.assign(this.data, p); }, refresh() { months.push([this._month, this.data.kindIndex]); } });
  page.show.call(ctx, {});
  ctx.prevMonth(); ctx.pickKind({ currentTarget: { dataset: { index: 2 } } });
  const picked = ctx._month;
  ctx.data.kindIndex = 0; // runtime clearPrivate on hide
  page.show.call(ctx, {});
  assert.deepEqual(months.at(-1), [picked, 2]);
  ctx.pickKind({ currentTarget: { dataset: { index: 0 } } });
  ctx.data.kindIndex = 2;
  page.show.call(ctx, {});
  assert.deepEqual(months.at(-1), [picked, 0]);
  ctx._identity = 'b'; page.show.call(ctx, {});
  assert.notEqual(months.at(-1)[0], picked);
});
test('L09-061 隐藏后同一账号保留已选类型和已读周柱', async () => {
  const runtimeFile = require.resolve('../../subpackageTools/cloud-ten-runtime.js');
  const livePage = require.resolve('../../subpackageTools/monthly-recap/index.js');
  const previous = { wx: global.wx, getApp: global.getApp, Page: global.Page };
  const storage = { authorization_issued_at: 'issued-a' };
  const sent = [];
  const app = { DEV_TOKEN: 'dev-token', _id: '7', _token: 'tok-a', getUserID() { return this._id; }, getAuthorization() { return this._token; },
    sendRequest(request) { sent.push(request.data.kind); request.success({ code: 200, data: { month: request.data.month, kind: request.data.kind, items: [{ id: '1', title: '一条', occurredAt: request.data.month + '-03 08:00:00' }], hasMore: false, counts: { routes: 1, places: 0, stamps: 0 }, nextBeforeId: null } }); } };
  delete require.cache[runtimeFile]; delete require.cache[livePage];
  global.wx = { getStorageSync: key => storage[key] || '', setStorageSync(key, value) { storage[key] = value; }, setClipboardData() {} };
  global.getApp = () => app;
  let definition;
  global.Page = value => { definition = value; };
  try {
    require(livePage);
    const instance = Object.assign({}, definition);
    instance.data = JSON.parse(JSON.stringify(definition.data));
    instance.setData = function (patch) { Object.assign(this.data, patch); };
    const tick = () => new Promise(resolve => setImmediate(resolve));
    instance.onLoad({});
    instance.onShow();
    await tick();
    assert.equal(instance.data.status, 'ready');
    instance.prevMonth();
    await tick();
    instance.pickKind({ currentTarget: { dataset: { index: 2 } } });
    await tick();
    const picked = instance._month;
    assert.equal(instance.data.kindIndex, 2);
    assert.equal(instance.data.weeks.length, 5);
    const reads = sent.length;
    instance.onHide();
    assert.equal(instance.data.kindIndex, 0);
    assert.equal(instance.data.weeks.length, 0);
    instance.onShow();
    await tick();
    assert.equal(instance.data.kindIndex, 2);
    assert.equal(instance._month, picked);
    assert.equal(instance.data.weeks[0].count, 1);
    assert.equal(sent.length, reads);
    instance.pickKind({ currentTarget: { dataset: { index: 0 } } });
    await tick();
    const afterRoute = sent.length;
    instance.onHide();
    instance.onShow();
    await tick();
    assert.equal(instance.data.kindIndex, 0);
    assert.equal(instance._month, picked);
    assert.equal(sent.length, afterRoute);
    app._id = '8'; app._token = 'tok-b'; storage.authorization_issued_at = 'issued-b';
    instance.onShow();
    await tick();
    assert.equal(instance.data.kindIndex, 0);
    assert.notEqual(instance._month, picked);
    assert.equal(sent.length, afterRoute + 1);
  } finally {
    global.wx = previous.wx; global.getApp = previous.getApp; global.Page = previous.Page;
    delete require.cache[runtimeFile]; delete require.cache[livePage];
  }
});
