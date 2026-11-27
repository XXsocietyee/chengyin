'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { summarizeOrderState, formatPayCountdown } = require('../../utils/order-status.js');

describe('P0 payment countdown, ticket wallet defense & trial-unlock verification (1127)', () => {
  it('formatPayCountdown formats remaining time, marks <5m urgent, and expires at 0', () => {
    const base = new Date('2026-11-27T12:00:00+08:00').getTime();
    const normal = formatPayCountdown(base + 12 * 60 * 1000 + 34 * 1000, base);
    assert.equal(normal.text, '12:34');
    assert.equal(normal.urgent, false);
    assert.equal(normal.expired, false);

    const urgent = formatPayCountdown(base + 4 * 60 * 1000 + 5 * 1000, base);
    assert.equal(urgent.text, '04:05');
    assert.equal(urgent.urgent, true);
    assert.equal(urgent.expired, false);

    const expired = formatPayCountdown(base - 1000, base);
    assert.equal(expired.expired, true);
    assert.equal(expired.text, '00:00');
  });

  it('summarizeOrderState flips registrationStatus=1 past payExpireTime to expired', () => {
    const base = new Date('2026-11-27T12:30:00+08:00').getTime();
    const stillPending = summarizeOrderState({
      registrationStatus: 1,
      paymentStatus: 1,
      payExpireTime: '2026-11-27 12:45:00',
    }, base);
    assert.equal(stillPending.key, 'pending_payment');

    const pastDue = summarizeOrderState({
      registrationStatus: 1,
      paymentStatus: 1,
      payExpireTime: '2026-11-27 12:29:00',
    }, base);
    assert.equal(pastDue.key, 'expired');
    assert.equal(pastDue.text, '已过期');
  });

  it('pages/play trial unlock uses xpayPay.pay and verifies payment server-side before unlocking', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../pages/play/index.js'), 'utf8');
    assert.ok(!src.includes('xpayPay.requestPayment'), 'must not call nonexistent xpayPay.requestPayment');
    assert.ok(src.includes('xpayPay.pay(app, wx, payData'), 'must call xpayPay.pay');
    assert.ok(src.includes('verifyAndUnlock(d, false)'), 'must verify wx.requestPayment server-side before unlocking');
    assert.ok(src.includes('xpayPay.verify(app, verifyRegistrationPayment'), 'must verify xpay server-side');
    assert.ok(src.includes('clientPlatform,'), 'single trial unlock must report clientPlatform for iOS guard');
    assert.ok(src.includes("'?clientPlatform=' + encodeURIComponent(seatPlatform)"), 'duo trial unlock must report clientPlatform for iOS guard');
  });

  it('app.json declares scope.userLocationBackground permission for background location mode', () => {
    const appJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../../app.json'), 'utf8'));
    assert.ok(appJson.permission && appJson.permission['scope.userLocationBackground'] && appJson.permission['scope.userLocationBackground'].desc,
      'scope.userLocationBackground desc is required when startLocationUpdateBackground is declared');
  });

  it('signup ticket wallet requires paymentStatus=2 on focus lookup and updates _walletOwner on login', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../subpackageMember/signup/index.js'), 'utf8');
    assert.ok(src.includes("![2, '2'].includes(row.paymentStatus)"), 'focus ticket lookup must require paymentStatus=2');
    assert.ok(src.includes('this._walletOwner = walletOwner();'), 'loginWallet must update _walletOwner');
  });
});
