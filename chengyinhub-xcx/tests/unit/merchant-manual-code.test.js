// P1-8 柜台手输核销码:归类回包 → 与扫码同形的提交路由;工作台接线(同一把写闸与结果处理)。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const { manualCodeError, manualRoute, chosenRoute } = require('../../pages/merchant/utils/manual-code.js');

const hidden = (name, value) => ({ name, label: null, widget: 'hidden', required: true, value, options: null });
const resolved = (patch) => ({ code: 200, data: Object.assign({ kind: 'DYNAMIC_TICKET', accepted: true, errorCode: null,
  message: null, redirectPath: null, inputMode: 'MANUAL',
  form: { submitEndpoint: '/api/registration/scan_dynamic_code', method: 'POST', offline: false, fields: [hidden('code', 'v1.9.activity.1.2.sig')] } }, patch) });

test('空码与超长码在弹窗里就拦下,不发请求', () => {
  assert.equal(manualCodeError('  '), '请输入核销码');
  assert.equal(manualCodeError('x'.repeat(513)), '核销码过长');
  assert.equal(manualCodeError(' VER1700000000000ABC123 '), '');
});

test('动态票 / 团码 / 券:路由与扫码同形,端点与载荷照服务端表单', () => {
  assert.deepEqual(manualRoute(resolved()), { kind: 'route', code: 'v1.9.activity.1.2.sig',
    url: '/api/registration/scan_dynamic_code', data: { code: 'v1.9.activity.1.2.sig' }, loadingTitle: '验票中...', choice: null });
  const coupon = manualRoute(resolved({ kind: 'COUPON', form: { submitEndpoint: '/api/coupon/verification',
    fields: [hidden('code', 'cq1.1.2.sig'), hidden('scope', 'MERCHANT')] } }));
  assert.equal(coupon.url, '/api/coupon/verification');
  assert.deepEqual(coupon.data, { code: 'cq1.1.2.sig', scope: 'MERCHANT' });
  assert.equal(coupon.loadingTitle, '核销中...');
});

test('旧静态码要店员自己选「活动票 / 主题票」,选完才成路由;客户端不替他猜', () => {
  const route = manualRoute(resolved({ kind: 'LEGACY_TICKET', form: { submitEndpoint: '/api/registration/scan_qr_code',
    fields: [hidden('code', 'VER1700000000000ABC123'), { name: 'type', label: '票的类型', widget: 'select', required: true, value: null,
      options: [{ value: 'activity', label: '活动票' }, { value: 'topic', label: '主题票' }] }] } }));
  assert.equal(route.kind, 'route');
  assert.deepEqual(route.data, { code: 'VER1700000000000ABC123' }, '未选之前载荷里没有 type');
  assert.deepEqual(route.choice, { name: 'type', title: '票的类型',
    options: [{ value: 'activity', label: '活动票' }, { value: 'topic', label: '主题票' }] });
  const chosen = chosenRoute(route, 1);
  assert.deepEqual(chosen.data, { code: 'VER1700000000000ABC123', type: 'topic' });
  assert.equal(chosen.choice, null);
  assert.equal(chosenRoute(route, 2), null);
  assert.equal(chosenRoute(route, -1), null);
  assert.equal(chosenRoute(null, 0), null);
});

test('不可核销的码:节点码指路、张贴码与坏码按服务端原话拒绝,都没有路由', () => {
  assert.deepEqual(manualRoute(resolved({ kind: 'CITY_NODE_VOUCHER', accepted: false, message: '这是据点核销码，请从「城市据点」页扫码核销',
    redirectPath: '/pages/merchant/citynode/index', form: { submitEndpoint: null, fields: [] } })),
  { kind: 'redirect', message: '这是据点核销码，请从「城市据点」页扫码核销', path: '/pages/merchant/citynode/index' });
  assert.deepEqual(manualRoute(resolved({ accepted: false, message: '二维码格式错误', form: { submitEndpoint: null, fields: [] } })),
    { kind: 'rejected', message: '二维码格式错误' });
  assert.equal(manualRoute(resolved({ accepted: false, message: 'x', redirectPath: 'https://evil.example/x' })).kind, 'rejected',
    '只认本包商家页面的指路');
});

test('归类没成功或表单不合合同一律当作未核销,不盲发任何端点', () => {
  assert.deepEqual(manualRoute({ code: 404, msg: '商家工作台新功能暂未开放', errorCode: 'F4_DISABLED' }),
    { kind: 'rejected', message: '商家工作台新功能暂未开放' });
  assert.deepEqual(manualRoute({ code: 500, msg: 'NullPointerException' }), { kind: 'rejected', message: '未能识别核销码，请重试' });
  assert.equal(manualRoute(null).kind, 'rejected');
  for (const form of [
    { submitEndpoint: '/api/registration/refund', fields: [hidden('code', 'c')] },
    { submitEndpoint: '/api/registration/scan_dynamic_code', fields: [] },
    { submitEndpoint: '/api/registration/scan_dynamic_code', fields: [hidden('code', 'c'), { name: 'x', widget: 'text' }] },
    { submitEndpoint: '/api/registration/scan_qr_code', fields: [hidden('code', 'c'),
      { name: 'type', widget: 'select', options: [{ value: 'activity', label: '活动票' }, { value: '', label: '坏项' }] }] },
    { submitEndpoint: '/api/registration/scan_dynamic_code' },
  ]) assert.equal(manualRoute(resolved({ form })).kind, 'rejected');
});

test('工作台接线:「更多」里有手输码入口;归类后与扫码共用 _submitScanRoute(同一把写闸、选章、选据点、结果面板)', () => {
  const js = fs.readFileSync(path.join(root, 'pages/merchant/index/index.js'), 'utf8');
  const wxml = fs.readFileSync(path.join(root, 'pages/merchant/index/index.wxml'), 'utf8');
  assert.match(wxml, /wx:if="\{\{merchantAccess\.canVerify\}\}" bindtap="goManualCode"[^>]*>[\s\S]*?<text class="rv-more-label">手输码<\/text>/);
  const manual = js.slice(js.indexOf('  goManualCode() {'), js.indexOf('  onManualChoiceCancel() {'));
  assert.match(manual, /this\.closeMoreMenu\(\);\s*if \(!this\.data\.merchantAccess \|\| !this\.data\.merchantAccess\.canVerify\) return;/);
  assert.match(manual, /editable: true/);
  assert.match(manual, /validate: manualCodeError/);
  assert.match(manual, /url: '\/api\/merchant\/desk\/redeem\/resolve'/);
  assert.match(manual, /data: JSON\.stringify\(\{ code: code, mode: 'MANUAL' \}\)/);
  assert.equal((manual.match(/that\._submitScanRoute\(route\)|this\._submitScanRoute\(route\)/g) || []).length, 2, '直接路由与选完类型后都走同一个提交');
  assert.doesNotMatch(manual, /scan_qr_code|scan_dynamic_code|groupcode/, '手输路径不自己拼核销端点');
  // 扫码与手输只有一个提交实现
  assert.match(js, /that\._submitScanRoute\(scan\);/);
  const shared = js.slice(js.indexOf('  _submitScanRoute(scan) {'), js.indexOf('  goManualCode() {'));
  assert.match(shared, /this\._submitVerification\(url \+ ':' \+ scan\.code, scan\.loadingTitle, \{\s*url,/);
  // 提交端点收敛成四个 /api 字面量(与 manual-code.js 的 SUBMIT_ENDPOINTS 同一组),别的一律不发
  for (const endpoint of ['/api/verify/groupcode/redeem', '/api/registration/scan_dynamic_code', '/api/registration/scan_qr_code', '/api/coupon/verification']) {
    assert.ok(shared.includes("'" + endpoint + "'"), endpoint);
    assert.ok(fs.readFileSync(path.join(root, 'pages/merchant/utils/manual-code.js'), 'utf8').includes("'" + endpoint + "'"), endpoint);
  }
  assert.match(shared, /if \(url !== scan\.url\) \{ this\.showRejectedScan\('未能识别核销码，请重试'\); return; \}/);
  assert.match(shared, /if \(d\.needChapterChoice\) \{\s*that\.openChapterSheet\(scan\.code, d\);/);
  assert.match(shared, /if \(d\.needStationChoice\) \{\s*that\.openStationSheet\(scan\.code, d\);/);
  assert.match(shared, /that\.showVerificationResult\(res, action\);/);
  assert.equal((js.match(/this\._submitVerification\(url \+ ':' \+ scan\.code/g) || []).length, 1);
  // 票类型选择用现成的 cy-option-sheet,不用系统弹层
  assert.match(wxml, /<cy-option-sheet show="\{\{manualChoice\.show\}\}"[^>]*immediate\s+bind:select="onManualChoicePick" bind:cancel="onManualChoiceCancel" \/>/);
  assert.doesNotMatch(manual, /showActionSheet/);
});

test('选章面板在退款审核中的票上给出提醒', () => {
  const js = fs.readFileSync(path.join(root, 'pages/merchant/index/index.js'), 'utf8');
  const wxml = fs.readFileSync(path.join(root, 'pages/merchant/index/index.wxml'), 'utf8');
  assert.match(js, /refundUnderReview: d\.refundUnderReview === true/);
  assert.match(wxml, /<text class="chpick__warn" wx:if="\{\{chapterSheet\.refundUnderReview\}\}" aria-role="alert">退款审核中<\/text>/);
});
