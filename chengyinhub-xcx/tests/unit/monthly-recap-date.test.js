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
test('L09-060 周柱只画「第一页即最后一页」的整月数据,翻到的末页不画', () => {
  const page = loadRecap();
  const items = [{ id: '1', occurredAt: '2026-10-25 12:00:00' }];
  const ctx = { _month: '2026-10', data: { kindIndex: 0 }, client: { load: () => ({ items, hasMore: false, counts: {} }), next: () => ({ items, hasMore: false, counts: {} }) },
    run: (action, patch) => patch(action()) };
  assert.equal(page.methods.refresh.call(ctx).weeks.length, 5);
  assert.equal(page.methods.next.call(ctx).weeks.length, 0);
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
  ctx._identity = 'b'; page.show.call(ctx, {});
  assert.notEqual(months.at(-1)[0], picked);
});
