const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { shapeAccount, STATE_TEXT } = require('../../pages/merchant/payout-account/view-model.js');

test('平台未开放时只给不可用态，不显示任何账户数据', () => {
  assert.deepEqual(shapeAccount({ available: false, unavailableReason: 'PLATFORM_NOT_OPEN' }), { pageState: 'unavailable' });
});

test('未登记时为未开通空态', () => {
  assert.deepEqual(shapeAccount({ available: true, state: 'NONE' }), { pageState: 'none' });
});

test('待签约给出 https 签约链接；已开通给掩码商户号且不给链接', () => {
  const sign = shapeAccount({ available: true, state: 'NEED_SIGN', signUrl: 'https://pay.weixin.qq.com/x', stateDesc: '请签约' });
  assert.equal(sign.pageState, 'ready');
  assert.equal(sign.stateText, '待签约');
  assert.equal(sign.signUrl, 'https://pay.weixin.qq.com/x');
  assert.equal(sign.stateDesc, '请签约');
  assert.equal(sign.subMchid, '');
  const done = shapeAccount({ available: true, state: 'FINISH', stateDesc: '完成', subMchidMasked: '19****0101', signUrl: 'https://x' });
  assert.equal(done.stateDesc, '');
  assert.equal(done.stateText, '已开通');
  assert.equal(done.stateTone, 'success');
  assert.equal(done.subMchid, '19****0101');
  assert.equal(done.signUrl, '');
});

test('非 https 链接、未知状态、坏回包一律不当作可用', () => {
  assert.equal(shapeAccount({ available: true, state: 'NEED_SIGN', signUrl: 'http://x' }).signUrl, '');
  assert.equal(shapeAccount({ available: true, state: 'WHATEVER' }), null);
  assert.equal(shapeAccount(null), null);
  assert.equal(shapeAccount([]), null);
  assert.equal(shapeAccount({ available: true }), null);
});

test('每个服务端状态都有中文名', () => {
  for (const s of ['DRAFT', 'CHECKING', 'ACCOUNT_NEED_VERIFY', 'AUDITING', 'REJECTED', 'NEED_SIGN', 'FINISH', 'FROZEN', 'CANCELED']) {
    assert.ok(STATE_TEXT[s], s);
  }
});

test('入口只在财务查看权限下出现，并登记在商家分包', () => {
  const root = path.join(__dirname, '../..');
  const wxml = fs.readFileSync(path.join(root, 'pages/merchant/index/index.wxml'), 'utf8');
  assert.match(wxml, /wx:if="\{\{merchantAccess\.canReadFinance\}\}" bindtap="onMoreItem" data-action="payoutAccount"/);
  const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
  const merchant = app.subPackages.find((p) => p.root === 'pages/merchant');
  assert.ok(merchant.pages.includes('payout-account/index'));
});

// L07-054(业主默认 A):商户号行直接显示服务端打码号,不可点、不复制;签约链接只复制一次、不叠自定义提示
test('商户号显示打码号且不再复制；复制签约链接只调系统复制', () => {
  const wxml = fs.readFileSync(path.resolve(__dirname, '../../pages/merchant/payout-account/index.wxml'), 'utf8')
  const row = wxml.slice(wxml.indexOf('wx:if="{{account.subMchid}}"') - 40, wxml.indexOf('wx:if="{{account.checkedText}}"'))
  assert.match(row, /<text class="fin-row__v">\{\{account\.subMchid\}\}<\/text>/)
  assert.doesNotMatch(row, /bindtap|复制/)
  const done = shapeAccount({ available: true, state: 'FINISH', subMchidMasked: '19****0101' })
  assert.equal(done.account ? done.account.subMchid : done.subMchid, '19****0101')
  const js = fs.readFileSync(path.resolve(__dirname, '../../pages/merchant/payout-account/index.js'), 'utf8')
  assert.doesNotMatch(js, /copySubMchid/)
  assert.match(js, /wx\.setClipboardData\(\{ data: url \}\)/)
})
