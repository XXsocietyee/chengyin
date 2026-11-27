'use strict';

const { beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const uiSandbox = require('../helpers/ui-sandbox-vm.js');

const ROOT = path.resolve(__dirname, '../..');
const NODE_FORM_JS = path.join(ROOT, 'pages/topic/components/cy/chapter-node-form/index.js');
const NODE_FORM_WXML = fs.readFileSync(path.join(ROOT, 'pages/topic/components/cy/chapter-node-form/index.wxml'), 'utf8');
const QUICK_JOIN_JS = path.join(ROOT, 'pages/topic/components/cy/quick-join-sheet/index.js');
const QUICK_JOIN_WXML = fs.readFileSync(path.join(ROOT, 'pages/topic/components/cy/quick-join-sheet/index.wxml'), 'utf8');
const APPLY_JS = path.join(ROOT, 'pages/merchant/apply/index.js');
const APPLY_WXML = fs.readFileSync(path.join(ROOT, 'pages/merchant/apply/index.wxml'), 'utf8');

function mountComponent(componentFile, initialData) {
  let def = null;
  const requests = [];
  const tips = [];
  const events = [];
  const chooseImageCallbacks = [];
  global.getApp = () => ({
    globalData: {},
    getUserID: () => 88,
    sendRequest: (req) => requests.push(req),
    tips: (msg) => tips.push(msg),
    chooseImage: (cb) => chooseImageCallbacks.push(cb),
  });
  global.Component = (cfg) => { def = cfg; };
  global.wx = {
    getWindowInfo: () => ({ windowHeight: 800, statusBarHeight: 20 }),
    showToast: (o) => tips.push(o && o.title),
    showModal: () => {},
    navigateTo: () => {},
  };
  delete require.cache[require.resolve(componentFile)];
  require(componentFile);
  const comp = Object.assign({}, def.methods);
  comp.data = Object.assign(JSON.parse(JSON.stringify(def.data)), initialData || {});
  comp.setData = function (patch, cb) {
    Object.entries(patch).forEach(([key, value]) => {
      if (key.includes('.')) {
        const parts = key.split('.');
        let cur = this.data;
        for (let i = 0; i < parts.length - 1; i += 1) cur = cur[parts[i]];
        cur[parts[parts.length - 1]] = value;
      } else {
        this.data[key] = value;
      }
    });
    if (cb) cb();
  };
  comp.triggerEvent = (name, detail) => events.push({ name, detail });
  return { comp, requests, tips, events, chooseImageCallbacks };
}

test('§4.3 (1) PERK/TRAFFIC 节点表单隐藏玩法模板与探索值，允许无 templateId 提交', () => {
  assert.match(NODE_FORM_WXML, /wx:if="\{\{termsMode !== 'PERK' && termsMode !== 'TRAFFIC'\}\}"/,
    'WXML 须在 PERK/TRAFFIC 档隐藏玩法模板与探索值');

  for (const mode of ['PERK', 'TRAFFIC']) {
    const { comp, requests, events } = mountComponent(NODE_FORM_JS, {
      show: true,
      chapterId: 20,
      termsMode: mode,
      formMode: 'application',
      submitting: false,
    });
    comp.openForm();
    assert.equal(requests.some((r) => r.url === '/api/template/my-list'), false,
      mode + ' 档打开节点表单不应强制拉取玩法模板列表');
    comp.setData({
      'form.name': '角落咖啡',
      'form.address': '星海街 8 号',
      'form.longitude': '120.70',
      'form.latitude': '31.30',
      locationReady: true,
    }, () => comp.refreshSubmitState());
    assert.equal(comp.data.canSubmit, true, mode + ' 档无 templateId 也应可提交');
    comp.onSubmit();
    assert.equal(events.length, 1);
    assert.equal(events[0].detail.templateId, null);
    assert.equal(events[0].detail.xpValue, null);
  }

  // REVSHARE 档仍要求玩法模板
  const rev = mountComponent(NODE_FORM_JS, {
    show: true,
    chapterId: 20,
    termsMode: 'REVSHARE',
    formMode: 'application',
    submitting: false,
  });
  rev.comp.setData({
    'form.name': '剧本馆',
    'form.address': '星海街 9 号',
    'form.longitude': '120.71',
    'form.latitude': '31.31',
    locationReady: true,
  }, () => rev.comp.refreshSubmitState());
  assert.equal(rev.comp.data.canSubmit, false);
  rev.comp.onSubmit();
  assert.equal(rev.events.length, 0);
});

test('§4.3 (2) 商家入驻支持 4 字段轻量合作档（免营业执照与 18 位实名）', () => {
  assert.match(APPLY_WXML, /bindtap="startLightForm"/, '开场屏应提供轻量合作入驻入口');
  assert.match(APPLY_WXML, /uploadStorefrontPhoto/, '轻量合作档应包含门头照片上传');

  const requests = [];
  let roleCb = null;
  let definition = null;
  const app = {
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    getUserID: () => 88,
    getAuthorization: () => 'tok',
    sendRequest: (opt) => requests.push(opt),
    chooseImage: (cb) => cb(['https://www.chengyinhub.com/prod-api/profile/shop.jpg']),
  };
  const sandbox = {
    Array, Date, Math, Object, RegExp, String, JSON, Number, Boolean,
    getApp: () => app,
    Page(cfg) { definition = cfg; },
    wx: {
      showModal: (o) => o.success && o.success({ confirm: true }),
      showToast() {},
      chooseLocation: (o) => o.success && o.success({ address: '星海街 8 号', latitude: 31.3, longitude: 120.7 }),
      nextTick() {},
      pageScrollTo() {},
    },
    require(req) {
      if (req.endsWith('roleGuard.js')) {
        return { load: (cb) => { roleCb = cb; }, hasSnapshot: () => true, clear() {} };
      }
      if (req.endsWith('merchant-theme.js')) return { merchantPageShow() {}, merchantPageRestore() {} };
      if (req.endsWith('merchant-identity-policy.js')) return require(path.join(ROOT, 'utils/merchant-identity-policy.js'));
      if (req.endsWith('merchant-business-hours.js')) return require(path.join(ROOT, 'pages/merchant/utils/merchant-business-hours.js'));
      if (req.endsWith('merchant-industry.js')) return require(path.join(ROOT, 'pages/merchant/utils/merchant-industry.js'));
      if (req.endsWith('motion-preference.js')) return require(path.join(ROOT, 'utils/motion-preference.js'));
      if (req.endsWith('wizard-morph.js') || req.endsWith('publisher-identity.js')) {
        const rel = req.endsWith('wizard-morph.js') ? 'utils/wizard-morph.js' : 'utils/publisher-identity.js';
        const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
        const mod = { exports: {} };
        const ctx = Object.assign({}, sandbox, { module: mod, exports: mod.exports });
        ctx.require = (dep) => (dep.startsWith('.') ? require(path.join(ROOT, 'utils', dep.replace(/^\.\//, ''))) : require(dep));
        vm.runInNewContext(src, ctx, { filename: rel });
        return mod.exports;
      }
      if (uiSandbox.isUiModule(req)) return uiSandbox.loadUiModule(req, sandbox);
      if (req.endsWith('login-reload.js')) return require(path.join(ROOT, 'utils/session/login-reload.js'));
      if (req.endsWith('form-state.js')) return require(path.join(ROOT, 'utils/form-state.js'));
      return require(req);
    },
  };
  vm.runInNewContext(fs.readFileSync(APPLY_JS, 'utf8'), sandbox, { filename: 'pages/merchant/apply/index.js' });
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch, cb) {
      Object.entries(patch).forEach(([k, v]) => {
        if (k.includes('.')) {
          const [a, b] = k.split('.');
          this.data[a] = Object.assign({}, this.data[a], { [b]: v });
        } else this.data[k] = v;
      });
      if (cb) cb.call(this);
    },
  });

  page.onLoad({});
  roleCb({ ownedClubs: [] });
  requests.find((r) => r.url === '/api/merchant/info').success({ code: '200', data: null, applicationState: 'NONE' });

  page.startLightForm();
  assert.equal(page.data.partnerTier, 'LIGHT');
  assert.equal(page.data.canNext, false);

  page.onInput({ currentTarget: { dataset: { field: 'name' } }, detail: { value: '巷口咖啡' } });
  page.chooseLocation();
  page.onInput({ currentTarget: { dataset: { field: 'phone' } }, detail: { value: '13800138000' } });
  page.uploadStorefrontPhoto();
  assert.equal(page.data.canNext, true, '4 项齐备即可提交，无需营业执照与 18 位身份证');

  page.onNext();
  // 不得发起实名登记请求
  assert.equal(requests.some((r) => /identity/i.test(r.url)), false, '轻量合作档不应调用前置实名接口');
  const regReq = requests.find((r) => r.url === '/api/merchant/merchant_registration');
  assert.ok(regReq, '应直接提交入驻申请');
  assert.equal(regReq.header['Content-Type'], 'application/json');
  const body = JSON.parse(regReq.data);
  assert.equal(body.partnerTier, 'LIGHT');
  assert.equal(body.name, '巷口咖啡');
  assert.equal(body.phone, '13800138000');
  assert.equal(body.address, '星海街 8 号');
  assert.equal(body.storefrontPhoto, 'https://www.chengyinhub.com/prod-api/profile/shop.jpg');
});

test('§4.3 (3) 白话半屏快速加入表单无内部黑话，自动带出入驻门头照并调用 /api/merchant/fe/quick-join', () => {
  assert.doesNotMatch(QUICK_JOIN_WXML, /variant="full"/, '快速加入应为半屏弹窗，不使用 variant="full"');
  for (const jargon of ['玩法模板', '探索值', '常备权益', '条款档', '承接标的']) {
    assert.equal(QUICK_JOIN_WXML.includes(jargon), false, '白话半屏不得出现内部黑话：' + jargon);
  }

  const { comp, requests, events } = mountComponent(QUICK_JOIN_JS, {
    show: true,
    chapterId: 20,
    applicationId: 301,
    chapterName: '第一站 · 咖啡歇脚',
    termsMode: 'PERK',
    perkMinValue: '20',
  });
  comp.openSheet();

  // 默认复用商家入驻门头照
  const infoReq = requests.find((r) => r.url === '/api/merchant/info');
  assert.ok(infoReq);
  infoReq.success({ code: '200', data: { coverImage: 'https://www.chengyinhub.com/prod-api/profile/apply.jpg' } });
  assert.equal(comp.data.form.storefrontPhoto, 'https://www.chengyinhub.com/prod-api/profile/apply.jpg');

  // 低于门槛不可提交
  comp.onInput({ currentTarget: { dataset: { key: 'perkDescription' } }, detail: { value: '美式咖啡一杯' } });
  comp.onInput({ currentTarget: { dataset: { key: 'originalPrice' } }, detail: { value: '15' } });
  comp.onTermsAgreedChange({ detail: { checked: true } });
  assert.equal(comp.data.priceBelowMin, true);
  assert.equal(comp.data.canSubmit, false);

  // 填齐 4 字段后提交
  comp.onInput({ currentTarget: { dataset: { key: 'originalPrice' } }, detail: { value: '28' } });
  comp.pickHourPreset({ currentTarget: { dataset: { value: '14:00-17:00' } } });
  comp.onInput({ currentTarget: { dataset: { key: 'dailyCap' } }, detail: { value: '15' } });
  assert.equal(comp.data.canSubmit, true);

  comp.onSubmit();
  const joinReq = requests.find((r) => r.url === '/api/merchant/fe/quick-join');
  assert.ok(joinReq);
  assert.equal(joinReq.method, 'POST');
  assert.equal(joinReq.header['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(joinReq.data), {
    chapterId: 20,
    applicationId: 301,
    perkDescription: '美式咖啡一杯',
    originalPrice: 28,
    offPeakHours: '14:00-17:00',
    dailyCap: 15,
    storefrontPhoto: 'https://www.chengyinhub.com/prod-api/profile/apply.jpg',
    termsAgreed: true,
  });

  joinReq.success({ code: 200, data: { status: 'JOINED', offerId: 801 } });
  assert.equal(events.length, 1);
  assert.equal(events[0].name, 'joined');
  assert.equal(events[0].detail.status, 'JOINED');
});
