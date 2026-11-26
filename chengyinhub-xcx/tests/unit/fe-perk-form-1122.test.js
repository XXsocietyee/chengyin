// 2026-11-22 自由探索商家参与缺口:权益表单的玩家可见条款(P1-2)、同意条款(P1-3)、玩家卡片预览(P1-4)、
// 门店照片当章节卡图、店铺退出后的「门店调整中」(P1-9)。
const { beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const COMPONENT = '../../pages/topic/components/cy/chapter-node-form/index.js';

let componentConfig;
let requests;
let tips;
let chosen;

global.getApp = () => ({
  getUserID: () => 1,
  sendRequest: (request) => requests.push(request),
  tips: (message) => tips.push(message),
  chooseImage: (callback, count, options) => chosen.push({ callback, count, options }),
});
global.Component = (config) => { componentConfig = config; };
global.wx = { showToast: (options) => tips.push(options.title) };

beforeEach(() => {
  componentConfig = null;
  requests = [];
  tips = [];
  chosen = [];
  delete require.cache[require.resolve(COMPONENT)];
  require(COMPONENT);
});

function makeComponent(props) {
  const events = [];
  const component = Object.assign({}, componentConfig.methods);
  component.data = Object.assign({}, JSON.parse(JSON.stringify(componentConfig.data)), {
    show: true, chapterId: 33, chapterName: '日常一杯', termsMode: 'PERK', formMode: 'offer', circleMode: false,
    submitting: false, perkMinValue: '', presetNode: null, defaultAddress: '', lookJson: '', topicCover: 'cover.jpg',
    editOffer: null, perkTemplates: [{ id: 7, name: '手冲一杯', retailValue: 30, quota: 50 }],
  }, props || {});
  component.setData = (patch, callback) => {
    Object.entries(patch).forEach(([key, value]) => {
      if (key.startsWith('form.')) component.data.form[key.slice(5)] = value;
      else component.data[key] = value;
    });
    if (callback) callback();
  };
  component.triggerEvent = (name, detail) => events.push({ name, detail });
  component._formVersion = 0;
  return { component, events };
}

test('P1-2 权益行:每日容量 / 开始日期 / 售罄或替代规则接在已含 / 需另付 / 需预约之后', () => {
  const m = require('../../pages/topic/utils/topic-motion.js');
  assert.equal(
    m.explorePerkLine({ perkName: '手冲一杯', included: true, reserveRequired: true, dailyCapacity: 20, validStart: '2026-12-01', soldOutRuleText: '售罄换同价饮品' }),
    '手冲一杯 · 已含 · 需预约 · 每日 20 份 · 12/1 起 · 售罄换同价饮品');
  assert.equal(m.explorePerkLine({ perkName: '甜点', included: false, extraSpendText: '饮品另付', dailyCapacity: 0 }), '甜点 · 需消费 饮品另付', '0 / 空不写');
});

test('购票前的逐店卡:主题详情自带的 exploreMerchantCards 并进商家卡,门店照片当卡图,没有保持原图', () => {
  const m = require('../../pages/topic/utils/topic-motion.js');
  const cards = [{ key: 'm-1', name: '旧城咖啡', img: 'shop.jpg' }, { key: 'm-2', name: '老面馆', img: 'noodle.jpg' }];
  const merged = m.mergeExploreCards(cards, [
    { storeName: '旧城咖啡', perkName: '手冲一杯', included: true, dailyCapacity: 20, storefrontImg: 'front.jpg' },
    { storeName: '老面馆', perkName: '小菜' },
  ]);
  assert.equal(merged[0].img, 'front.jpg');
  assert.equal(merged[0].perk, '手冲一杯 · 已含 · 每日 20 份');
  assert.equal(merged[1].img, 'noodle.jpg', '没有门店照片保持原图');
  assert.equal(merged[1].perk, '小菜');
  assert.deepEqual(m.mergeExploreCards(cards, null), cards, '没下发保持原卡');
  assert.match(read('pages/topic/index/index.js'), /motion\.mergeExploreCards\(motion\.buildMerchantCards\(data\.chaptersList\), data\.exploreMerchantCards\)/);
});

test('P1-4 预览取色表与玩家页的外观主色表逐项一致;读不懂回落老主题深色', () => {
  const preview = require('../../pages/topic/utils/look-preview.js');
  const play = require('../../pages/play/utils/look-colors.js');
  assert.deepEqual(preview.LOOK_COLORS, play.LOOK_COLORS);
  assert.deepEqual(preview.LEGACY, play.LEGACY);
  assert.deepEqual(preview.colorsForLookJson('{"style":"PAPER","palette":"YELLOW"}'), play.LOOK_COLORS.PAPER.YELLOW);
  assert.deepEqual(preview.colorsForLookJson({ style: 'cyber' }), play.LOOK_COLORS.CYBER.DEFAULT);
  assert.deepEqual(preview.colorsForLookJson('not json'), play.LEGACY);
  assert.deepEqual(preview.colorsForLookJson(''), play.LEGACY);
  assert.equal(preview.previewFrameStyle('{"style":"PAPER","palette":"YELLOW"}'),
    'background:#E6DCC4;color:#2B241A;border-color:#A3281D;' + preview.PLAYER_CARD_TOKENS);
  // 卡片字色用玩家端深色语义色:与 style/tokens.wxss 基础(深色)块的同名 token 逐值一致
  const tokens = read('style/tokens.wxss');
  preview.PLAYER_CARD_TOKENS.split(';').filter(Boolean).forEach((pair) => {
    const [name, value] = pair.split(':');
    assert.match(tokens, new RegExp(name + ':\\s*' + value + ';'), name);
  });
});

test('P1-3 入驻必须先勾选同意条款(不默认勾选),提交带 termsAgreed 与玩家可见条款', () => {
  const { component, events } = makeComponent();
  component.openForm();
  assert.equal(component.data.shopTermsOn, true);
  assert.equal(component.data.form.termsAgreed, false, '不默认勾选');
  assert.match(component.data.consentText, /线下结算/);
  assert.match(component.data.consentText, /核销/);
  assert.match(component.data.consentText, /退出/);
  component.setData({ 'form.perkTemplateId': 7, 'form.perkName': '手冲一杯', 'form.quotaTotal': '50' }, () => component.refreshSubmitState());
  assert.equal(component.data.canSubmit, false, '未勾选不能提交');
  component.onSubmit();
  assert.equal(events.length, 0);
  assert.deepEqual(tips, ['请先勾选同意条款']);

  component.onInput({ currentTarget: { dataset: { key: 'dailyCapacity' } }, detail: { value: '20' } });
  component.onValidStartChange({ detail: { value: '2026-12-01' } });
  component.onIncludedPick({ detail: { value: 2 } });
  assert.equal(component.data.canSubmit, false, '选了需另付必须写清另付什么');
  component.onInput({ currentTarget: { dataset: { key: 'extraSpendText' } }, detail: { value: ' 饮品另付 ' } });
  component.onReserveRequiredChange({ detail: { value: true } });
  component.onInput({ currentTarget: { dataset: { key: 'soldOutRuleText' } }, detail: { value: '售罄换同价饮品' } });
  component.onTermsAgreedChange({ detail: { checked: true } });
  assert.equal(component.data.canSubmit, true);
  component.onSubmit();
  assert.equal(events.length, 1);
  assert.equal(events[0].detail.termsAgreed, true);
  assert.deepEqual(events[0].detail.displayTerms, {
    included: 0, extraSpendText: '饮品另付', reserveRequired: 1, dailyCapacity: 20,
    validStart: '2026-12-01', soldOutRuleText: '售罄换同价饮品', storefrontImg: '',
  });
});

test('P1-2 每日容量填了必须是正整数', () => {
  const { component } = makeComponent();
  component.openForm();
  component.setData({ 'form.perkTemplateId': 7, 'form.quotaTotal': '50', 'form.termsAgreed': true }, () => component.refreshSubmitState());
  assert.equal(component.data.canSubmit, true);
  component.onInput({ currentTarget: { dataset: { key: 'dailyCapacity' } }, detail: { value: '0' } });
  assert.equal(component.data.canSubmit, false);
  component.onInput({ currentTarget: { dataset: { key: 'dailyCapacity' } }, detail: { value: '' } });
  assert.equal(component.data.canSubmit, true, '选填:留空可以提交');
});

test('门店照片走统一上传链只收 1 张;P1-4 预览卡用门店照片,没有回落主题封面', () => {
  const { component } = makeComponent({ lookJson: '{"style":"PAPER","palette":"YELLOW"}' });
  component.openForm();
  assert.match(component.data.previewStyle, /^background:#E6DCC4;color:#2B241A;border-color:#A3281D;/);
  assert.equal(component.data.previewCards[0].img, 'cover.jpg', '没有门店照片回落主题封面');
  assert.equal(component.data.previewCards[0].name, '本店');
  assert.equal(component.data.previewCards[0].place, '日常一杯');
  const shopInfo = requests.filter((r) => r.url === '/api/merchant/info')[0];
  shopInfo.success({ code: 200, data: { name: '旧城咖啡' } });
  assert.equal(component.data.previewCards[0].name, '旧城咖啡');

  component.chooseStorefront();
  assert.equal(chosen.length, 1);
  assert.equal(chosen[0].count, 1);
  chosen[0].callback(['https://img.example/front.jpg']);
  assert.equal(component.data.form.storefrontImg, 'https://img.example/front.jpg');
  assert.deepEqual(component.data.storefrontUrls, ['https://img.example/front.jpg']);
  assert.equal(component.data.previewCards[0].img, 'https://img.example/front.jpg');
  component.onPerkPick({ detail: { value: 0 } });
  component.onIncludedPick({ detail: { value: 1 } });
  assert.equal(component.data.previewCards[0].perk, '手冲一杯 · 已含');
  component.removeStorefront();
  assert.equal(component.data.previewCards[0].img, 'cover.jpg');
});

test('已生效供给改说明:回填当前值,只提交 offerId + 展示条款,不要求重新勾选', () => {
  const { component, events } = makeComponent({
    editOffer: { offerId: 9, perkName: '手冲一杯', included: true, extraSpendText: null, reserveRequired: true,
      dailyCapacity: 20, validStart: '2026-12-01', soldOutRuleText: '售罄换同价饮品', storefrontImg: 'front.jpg' },
  });
  component.openForm();
  assert.equal(component.data.termsEditing, true);
  assert.equal(component.data.form.includedMode, 'IN');
  assert.equal(component.data.form.dailyCapacity, '20');
  assert.deepEqual(component.data.storefrontUrls, ['front.jpg']);
  assert.equal(component.data.canSubmit, true);
  assert.equal(requests.some((r) => r.url === '/api/coop/perk-template/list'), false, '改说明不重新选权益模板');
  component.onReserveRequiredChange({ detail: { value: false } });
  component.onSubmit();
  assert.deepEqual(events[0].detail, { chapterId: 33, offerId: 9, displayTerms: {
    included: 1, extraSpendText: '', reserveRequired: 0, dailyCapacity: 20,
    validStart: '2026-12-01', soldOutRuleText: '售罄换同价饮品', storefrontImg: 'front.jpg' } });
});

test('圈层供给与非权益档不出门店条款和同意勾选', () => {
  const circle = makeComponent({ circleMode: true });
  circle.component.openForm();
  assert.equal(circle.component.data.shopTermsOn, false);
  const traffic = makeComponent({ termsMode: 'TRAFFIC' });
  traffic.component.openForm();
  assert.equal(traffic.component.data.shopTermsOn, false);
  assert.equal(traffic.component.data.canSubmit, true);
});

test('表单与商家页的接线:预览复用玩家端逐店卡组件;入驻与改说明走既有接口', () => {
  const wxml = read('pages/topic/components/cy/chapter-node-form/index.wxml');
  const json = JSON.parse(read('pages/topic/components/cy/chapter-node-form/index.json'));
  assert.equal(json.usingComponents['cy-merchant-cards'], '/pages/topic/components/cy/merchant-cards/index');
  assert.match(wxml, /<cy-merchant-cards items="\{\{previewCards\}\}" \/>/);
  assert.match(wxml, /<cy-consent-check wx:if="\{\{!termsEditing\}\}" checked="\{\{form\.termsAgreed\}\}"/);
  assert.match(wxml, /<cy-upload urls="\{\{storefrontUrls\}\}" max="\{\{1\}\}"/);
  const page = read('pages/topic/merchantinfo/merchantinfo.js');
  assert.match(page, /payload\.termsAgreed = true/);
  assert.match(page, /payload\.storefrontImg = String\(terms\.storefrontImg\)/);
  assert.match(page, /url: '\/api\/coop\/offer\/display-terms',\s+method: 'POST'/);
  const pageWxml = read('pages/topic/merchantinfo/merchantinfo.wxml');
  assert.match(pageWxml, /lookJson="\{\{info\.lookJson \|\| ''\}\}"/);
  assert.match(pageWxml, /bindtap="openChapterOfferTerms">改说明</);
});

test('P1-9 店铺退出或补位中:玩家页收起核销码入口,显示「门店调整中」', () => {
  const play = read('pages/play/index.js');
  assert.match(play, /supplyState: n\.supplyState === 'WITHDRAWN' \|\| n\.supplyState === 'REPLACING' \? n\.supplyState : ''/);
  const playWxml = read('pages/play/index.wxml');
  assert.match(playWxml, /wx:if="\{\{mode==2 && sheet\.node\.supplyState\}\}" aria-role="status">门店调整中</);
  assert.match(playWxml, /sheet-nav--verify" wx:if="\{\{mode==2 && regId && !isPreview && !isMock && !sheet\.node\.supplyState\}\}"/);
  const shopWxml = read('pages/play/merchant/index.wxml');
  const adjusting = shopWxml.indexOf('wx:elif="{{node.supplyState && !node.done}}"');
  assert.ok(adjusting > 0 && adjusting < shopWxml.indexOf('bindtap="arriveHere"') && adjusting < shopWxml.indexOf('bindtap="openVerifyCode"'),
    '「门店调整中」排在「我已到店 / 出示核销码」之前,两颗按钮都不再出现');
  assert.match(shopWxml, /node\.supplyState && !node\.done\}\}" class="mp-cta__main is-dead" aria-role="status">门店调整中</);
  assert.match(read('pages/play/merchant/index.js'), /if \(this\.data\.node && this\.data\.node\.supplyState\) \{\s+this\.setData\(\{ feedback: '门店调整中，暂不能出示核销码' \}\)\s+return/);
});

test('每日名额已满 / 权益还没开始:玩家在出示核销码的位置看到服务端给的同一句话,这时不出码', () => {
  const shopWxml = read('pages/play/merchant/index.wxml');
  const blocked = shopWxml.indexOf('wx:elif="{{!node.done && node.perk && node.perk.redeemBlockedText}}"');
  assert.ok(blocked > 0 && blocked > shopWxml.indexOf('bindtap="arriveHere"') && blocked < shopWxml.indexOf('bindtap="openVerifyCode"'),
    '排在「我已到店」之后、「出示核销码」之前:占的就是核销码按钮的位置');
  assert.match(shopWxml, /node\.perk\.redeemBlockedText\}\}" class="mp-cta__main is-dead" aria-role="status">\{\{node\.perk\.redeemBlockedText\}\}</);
  const shopJs = read('pages/play/merchant/index.js');
  assert.match(shopJs, /if \(this\.data\.node && this\.data\.node\.perk && this\.data\.node\.perk\.redeemBlockedText\) \{\s*this\.setData\(\{ feedback: this\.data\.node\.perk\.redeemBlockedText \}\)\s*return/);
  assert.doesNotMatch(shopWxml + shopJs, /今日名额已满|权益还没开始/, '文案只有服务端一份,端上不另写');
});
