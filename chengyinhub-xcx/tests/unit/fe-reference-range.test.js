// P1-10 自由探索参考结算:日期范围 + CSV 导出(分包组件,包住主包的 cy-fe-reference-settlement)。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '../..');
const DIR = 'components/cy/fe-reference-range';
const { rangeQuery, exportFile } = require('../../pages/merchant/' + DIR + '/view-model.js');
const modalPath = require.resolve('../../utils/modal.js');
const toastPath = require.resolve('../../utils/toast.js');

test('pages/merchant 与 pages/club 两份组件逐字相同(不进主包,各分包一份)', () => {
  for (const file of ['index.js', 'index.json', 'index.wxml', 'index.wxss', 'view-model.js']) {
    assert.equal(fs.readFileSync(path.join(ROOT, 'pages/merchant', DIR, file), 'utf8'),
      fs.readFileSync(path.join(ROOT, 'pages/club', DIR, file), 'utf8'), file);
  }
  assert.equal(JSON.parse(fs.readFileSync(path.join(ROOT, 'pages/merchant/ledger/index.json'), 'utf8'))
    .usingComponents['cy-fe-reference-range'], '/pages/merchant/' + DIR + '/index');
  assert.equal(JSON.parse(fs.readFileSync(path.join(ROOT, 'pages/club/settlement/index.json'), 'utf8'))
    .usingComponents['cy-fe-reference-range'], '/pages/club/' + DIR + '/index');
});

test('日期范围:只发合法日期,起止颠倒时对调;导出回包不合合同不落盘', () => {
  assert.deepEqual(rangeQuery('', ''), {});
  assert.deepEqual(rangeQuery('2026-11-01', ''), { from: '2026-11-01' });
  assert.deepEqual(rangeQuery('', '2026-11-07'), { to: '2026-11-07' });
  assert.deepEqual(rangeQuery('2026-11-07', '2026-11-01'), { from: '2026-11-01', to: '2026-11-07' });
  assert.deepEqual(rangeQuery('2026/11/01', 20261107), {});
  const ok = { code: 200, data: { fileName: 'fe-reference-settlement-2026-11-01-2026-11-07.csv', content: '\uFEFF场次,主办方\r\n' } };
  assert.deepEqual(exportFile(ok), ok.data);
  for (const bad of [null, { code: 500, msg: '日期格式无效' }, { code: 200, data: { fileName: '../x.csv', content: 'a' } },
    { code: 200, data: { fileName: 'a.html', content: 'a' } }, { code: 200, data: { fileName: 'a.csv', content: '' } }]) {
    assert.equal(exportFile(bad), null);
  }
});

function mount(pkg, kind) {
  let config; let modalOptions = null; const toasts = [];
  const requests = [];
  const componentPath = '../../pages/' + pkg + '/' + DIR + '/index.js';
  global.getApp = () => ({ getUserID: () => 9001, sendRequest: (r) => requests.push(r) });
  global.Component = (c) => { config = c; };
  require.cache[modalPath] = { id: modalPath, filename: modalPath, loaded: true, exports: { show: (o) => { modalOptions = o; } } };
  require.cache[toastPath] = { id: toastPath, filename: toastPath, loaded: true, exports: (t) => toasts.push(t) };
  delete require.cache[require.resolve(componentPath)]; require(componentPath);
  delete require.cache[modalPath]; delete require.cache[toastPath];
  const vm = { ...config.methods, properties: { kind }, data: JSON.parse(JSON.stringify(config.data)),
    setData(patch) { Object.assign(this.data, patch); } };
  config.lifetimes.attached.call(vm);
  return { vm, requests, toasts, modal: () => modalOptions };
}

test('选日期只改传给列表的范围,自己不发请求;导出走同侧 /export 并带同一范围,落盘后由点按发到微信,失败改复制', () => {
  const { vm, requests, toasts, modal } = mount('merchant', 'merchant');
  vm.onFromChange({ detail: { value: '2026-11-07' } });
  vm.onToChange({ detail: { value: '2026-11-01' } });
  assert.deepEqual([vm.data.from, vm.data.to], ['2026-11-01', '2026-11-07']);
  assert.equal(requests.length, 0);

  const written = []; const shared = []; const copied = [];
  global.wx = { env: { USER_DATA_PATH: 'wxfile://usr' },
    getFileSystemManager: () => ({ writeFile: (o) => { written.push(o); o.success(); } }),
    shareFileMessage: (o) => { shared.push(o); },
    setClipboardData: (o) => { copied.push(o.data); o.success(); } };
  vm.onExport();
  vm.onExport();
  assert.equal(requests.length, 1, '导出进行中不重复发');
  assert.equal(requests[0].url, '/api/fe/reference-settlement/merchant/export');
  assert.equal(requests[0].method, 'GET');
  assert.deepEqual(requests[0].data, { from: '2026-11-01', to: '2026-11-07' });
  requests[0].success({ code: 200, data: { fileName: 'fe-reference-settlement-2026-11-01-2026-11-07.csv', content: '\uFEFF场次,主办方\r\n' } });
  assert.equal(vm.data.exporting, false);
  assert.equal(written[0].filePath, 'wxfile://usr/fe-reference-settlement-2026-11-01-2026-11-07.csv');
  assert.equal(written[0].data, '\uFEFF场次,主办方\r\n');
  assert.equal(shared.length, 0, '发文件要等用户点按');
  assert.equal(modal().confirmText, '发送到微信');
  modal().success({ confirm: true });
  assert.equal(shared[0].filePath, written[0].filePath);
  shared[0].fail({ errMsg: 'shareFileMessage:fail cancel' });
  assert.equal(copied.length, 0, '用户自己取消不算失败');
  shared[0].fail({ errMsg: 'shareFileMessage:fail not supported' });
  assert.deepEqual(copied, ['场次,主办方\r\n'], '复制内容不带 BOM');
  assert.deepEqual(toasts, ['已复制对账表内容']);

  vm.onExport();
  requests[1].success({ code: 500, msg: '日期格式无效' });
  assert.equal(vm.data.exporting, false);
  assert.equal(toasts[1], '导出失败，请重试');
  assert.equal(written.length, 1, '失败回包不落盘');

  vm.onClearRange();
  assert.deepEqual([vm.data.from, vm.data.to], ['', '']);
  delete global.wx;
});

test('收款人侧(俱乐部分包那一份)导出走 payer/export;不支持发文件的微信直接复制;模板有起止日期与导出', () => {
  const { vm, requests, toasts } = mount('club', 'payer');
  const copied = [];
  global.wx = { env: { USER_DATA_PATH: 'wxfile://usr' }, setClipboardData: (o) => { copied.push(o.data); o.success(); } };
  vm.onExport();
  assert.equal(requests[0].url, '/api/fe/reference-settlement/payer/export');
  assert.deepEqual(requests[0].data, {});
  requests[0].success({ code: 200, data: { fileName: 'fe-reference-settlement.csv', content: '\uFEFF场次\r\n' } });
  assert.deepEqual(copied, ['场次\r\n']);
  assert.deepEqual(toasts, ['已复制对账表内容']);
  delete global.wx;
  const wxml = fs.readFileSync(path.join(ROOT, 'pages/club', DIR, 'index.wxml'), 'utf8');
  assert.match(wxml, /<cy-date-field class="fe-range-date" mode="date" value="\{\{from\}\}" title="开始日期" bind:change="onFromChange">/);
  assert.match(wxml, /<cy-date-field class="fe-range-date" mode="date" value="\{\{to\}\}" title="结束日期" bind:change="onToChange">/);
  assert.match(wxml, /bindtap="onExport"[\s\S]*?>导出<\/button>/);
  const wxss = fs.readFileSync(path.join(ROOT, 'pages/club', DIR, 'index.wxss'), 'utf8');
  assert.doesNotMatch(wxss.replace(/\/\*[\s\S]*?\*\//g, ''), /#[0-9a-fA-F]{3,8}\b|rgba?\(/, '颜色只走设计 token');
});
