'use strict';

// R4 完局优惠卡 / 主题送礼入口:只验证视图模型对服务端事实的投影(不读页面源码)。
const test = require('node:test');
const assert = require('node:assert/strict');
const fo = require('../../subpackageJourney/utils/finish-offer.js');
const { giftProductId } = require('../../pages/topic/utils/gift-entry.js');

const PASS = { enabled: true, libraryCount: 12, plans: [{ planCode: 'MONTH', title: '月卡', priceFen: 2990, validDays: 30 }], holding: { active: false } };
const BUNDLE = { productId: 41, productName: '上海城市包', productKind: 2, cashPrice: 59.9, giftAllowed: 1,
  items: [{ topicId: 7, topicTitle: 'A' }, { topicId: 8, topicTitle: 'B' }] };

test('没有可售商品:不出卡', () => {
  assert.equal(fo.finishOffer({ pass: { enabled: false, unavailableReason: 'PLATFORM_PASS_DISABLED' }, products: [], topicId: '7' }), null);
  assert.equal(fo.finishOffer({ pass: Object.assign({}, PASS, { plans: [] }), products: [], topicId: '7' }), null);
  // 单关票(kind 1)不算覆盖更多路线
  assert.equal(fo.finishOffer({ pass: null, products: [Object.assign({}, BUNDLE, { productKind: 1 })], topicId: '7' }), null);
  // 城市包只覆盖本主题:不算更多路线
  assert.equal(fo.finishOffer({ pass: null, products: [Object.assign({}, BUNDLE, { items: [{ topicId: 7 }] })], topicId: '7' }), null);
});

test('只有通行证:名称与价格取服务端,点进通行证页', () => {
  const offer = fo.finishOffer({ pass: PASS, products: [], topicId: '7' });
  assert.deepEqual(offer, { kind: 'pass', id: 'MONTH', name: '月卡', price: '¥29.9', url: '/subpackageMember/market/membership/index' });
  // 通行证优先于商品
  assert.equal(fo.finishOffer({ pass: PASS, products: [BUNDLE], topicId: '7' }).kind, 'pass');
});

test('通行证持有中:整卡不出,不向已能玩曲库的人再推城市包', () => {
  const held = Object.assign({}, PASS, { holding: { active: true } });
  assert.equal(fo.finishOffer({ pass: held, products: [BUNDLE], topicId: '7' }), null);
  assert.equal(fo.finishOffer({ pass: held, products: [], topicId: '7' }), null);
});

test('曲库只含一个主题:不推通行证,回落到城市包', () => {
  const single = Object.assign({}, PASS, { libraryCount: 1 });
  const offer = fo.finishOffer({ pass: single, products: [BUNDLE], topicId: '7' });
  assert.deepEqual(offer, { kind: 'product', id: '41', name: '上海城市包', price: '¥59.9', url: '/subpackageMember/market/pass/index?id=41' });
  assert.equal(fo.finishOffer({ pass: single, products: [], topicId: '7' }), null);
  // 第一版只卖月卡:其他套餐即使服务端返回也不出
  assert.equal(fo.finishOffer({ pass: Object.assign({}, PASS, { plans: [{ planCode: 'YEAR', title: '年卡', priceFen: 19900 }] }), products: [], topicId: '7' }), null);
});

test('通行证与促销同在:价格仍是服务端原价,客户端不折算、不出倒计时', () => {
  // 促销目录的完局触发只作用于报名报价;卡片没有 deal 字段,价格不被任何折扣字段改写
  const pass = Object.assign({}, PASS, { promotions: [{ triggerKind: 1, eligible: true, discountType: 2, discountValue: 0.5, windowEndsAt: Date.now() + 3600e3 }] });
  const offer = fo.finishOffer({ pass, products: [], topicId: '7' });
  assert.equal(offer.price, '¥29.9');
  assert.deepEqual(Object.keys(offer).sort(), ['id', 'kind', 'name', 'price', 'url']);
});

test('时限通票在售窗口已过:服务端列表不再返回,卡不出(客户端不自判 saleEndAt)', () => {
  // 服务端 listSellable 已按在售窗口过滤;客户端只认列表里有没有
  assert.equal(fo.finishOffer({ pass: null, products: [], topicId: '7' }), null);
  const listed = Object.assign({}, BUNDLE, { productKind: 3, saleEndAt: '2020-01-01 00:00:00' });
  assert.equal(fo.finishOffer({ pass: null, products: [listed], topicId: '7' }).id, '41');
});

test('请求失败:不出卡,不显示 0', () => {
  assert.equal(fo.finishOffer({ pass: null, products: null, topicId: '7' }), null);
  assert.equal(fo.finishOffer(undefined), null);
  // 价格缺失或为 0:不画 ¥0.0
  assert.equal(fo.finishOffer({ pass: Object.assign({}, PASS, { plans: [{ planCode: 'MONTH', title: '月卡', priceFen: null }] }), products: null }), null);
  assert.equal(fo.finishOffer({ pass: null, products: [Object.assign({}, BUNDLE, { cashPrice: null, pointsPrice: null })], topicId: '7' }), null);
  assert.equal(fo.finishOffer({ pass: null, products: [Object.assign({}, BUNDLE, { cashPrice: 0, pointsPrice: 0 })], topicId: '7' }), null);
});

test('积分价商品:原样显示积分', () => {
  const offer = fo.finishOffer({ pass: null, products: [Object.assign({}, BUNDLE, { cashPrice: null, pointsPrice: 800 })], topicId: '7' });
  assert.equal(offer.price, '800 积分');
});

test('埋点载荷只带卡种、商品 id 与主题 id', () => {
  assert.deepEqual(fo.trackPayload(fo.passOffer(PASS), '7'), { bizType: 'platform_pass', bizId: null, properties: { offerKind: 'pass', planCode: 'MONTH', topicId: 7 } });
  assert.deepEqual(fo.trackPayload(fo.productOffer([BUNDLE], '9'), '9'), { bizType: 'marketing_product', bizId: 41, properties: { offerKind: 'product', topicId: 9 } });
  assert.equal(fo.trackPayload(null, '7'), null);
});

test('送礼入口:只认覆盖本主题且可赠送的在售商品', () => {
  assert.equal(giftProductId([BUNDLE], '8'), '41');
  assert.equal(giftProductId([BUNDLE], '9'), '');
  assert.equal(giftProductId([Object.assign({}, BUNDLE, { giftAllowed: 0 })], '8'), '');
  assert.equal(giftProductId([Object.assign({}, BUNDLE, { giftAllowed: 0, productKind: 7 })], '8'), '41');
  assert.equal(giftProductId([Object.assign({}, BUNDLE, { productKind: 8 })], '8'), '');
  assert.equal(giftProductId(null, '8'), '');
  assert.equal(giftProductId([BUNDLE], ''), '');
});
