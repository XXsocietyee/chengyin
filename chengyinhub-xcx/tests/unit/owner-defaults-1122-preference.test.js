'use strict';
// 2026-11-22 业主拍板默认值 F(来自 #901 走查):偏好题组靠手写配置文本,只在官方模板里提供。
// 普通作者的完成方式里不再有它、编辑页不能手写配置;已有的偏好题配置照常回填、保存与运行。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

let pageConfig;
const requests = [];
global.getApp = () => ({ globalData: { statusBarHeight: 20, navBarHeight: 44 },
  getUserID: () => 9, getAuthorization: () => 'test', sendRequest: request => requests.push(request), tips: () => {} });
global.wx = Object.assign({ getStorageSync: () => undefined, setStorageSync: () => {}, removeStorageSync: () => {},
  getBackgroundAudioManager: () => ({ stop: () => {} }), showToast: () => {}, showModal: () => {} },
require('../helpers/memory-storage.js')());
global.Page = config => { pageConfig = config; };

function editor() {
  delete require.cache[require.resolve('../../pages/publish/temp/index.js')];
  require('../../pages/publish/temp/index.js');
  const page = Object.assign({}, pageConfig);
  page.data = JSON.parse(JSON.stringify(pageConfig.data));
  page.setData = function (patch, callback) {
    for (const [key, value] of Object.entries(patch)) {
      const parts = key.split('.'); let at = this.data;
      for (const part of parts.slice(0, -1)) at = at[part];
      at[parts[parts.length - 1]] = value;
    }
    if (callback) callback();
  };
  page._refreshOutcomeContract = () => ({ items: [], errors: [] });
  page._syncCheckDerived = () => {};
  page.refreshPreviewState = () => {};
  page.hasModule = () => false;
  return page;
}

const PREFERENCE = JSON.stringify({
  steps: [{ key: 's', type: 'single', title: '今天想怎样探索？', options: [{ key: 'A', text: '慢慢走', scores: { slow: 1 } }] }],
  dimensions: ['slow'],
  results: { slow: { title: '慢慢走', body: '因为你选择了{{choices}}', nextStep: '再走一段', nextStepDays: 7 } },
});

test('F 普通作者可选的参与方式里没有偏好题组;选它的码也选不上', () => {
  // 旧「完成方式」九宫格(selectValidationMethod / methodTiles)已删(L04-046),作者只能经参与方式改完成方式
  const { PARTICIPATION } = require('../../pages/publish/temp/r5-editor.js');
  const page = editor();
  assert.ok(PARTICIPATION.length > 0);
  assert.ok(!PARTICIPATION.some(row => row.value === 6), '偏好题组不在可选列表');
  page.fillFormWithTemplateData({ title: '普通玩法', validationMethod: 5, advancedConfigJson: '' });
  page.pickParticipation({ currentTarget: { dataset: { key: 'pref' } }, detail: {} });
  assert.equal(page.data.formData.validationMethod, 5, '不认识的参与方式选不上');
  page.pickParticipation({ currentTarget: { dataset: { key: PARTICIPATION[0].key } }, detail: {} });
  assert.equal(page.data.formData.validationMethod, PARTICIPATION[0].value, '负控:可选的参与方式照常切换');
});

test('F 已有的偏好题配置照常回填、按名展示、只读预览结果分支,保存原样带回', () => {
  requests.length = 0;
  const page = editor();
  page.fillFormWithTemplateData({ title: '官方偏好题', validationMethod: 6, preferenceJson: PREFERENCE, advancedConfigJson: '' });
  assert.equal(page.data.formData.validationMethod, 6);
  assert.equal(page._methodTile(6).label, '偏好题组', '旧码仍按名字展示,不落到兜底那一格');
  assert.deepEqual(page.data.preferencePreview.map(row => row.code), ['slow']);
  assert.equal(page.data.preferenceConfigError, '');
  page.saveDraft();
  const payload = JSON.parse(requests.at(-1).data);
  assert.equal(payload.validationMethod, 6);
  assert.equal(payload.preferenceJson, PREFERENCE);
});

test('F 编辑页不再给手写配置框和「填入可编辑示例」,只读展示结果分支', () => {
  const wxml = read('pages/publish/temp/index.wxml');
  const card = wxml.match(/<cy-card id="pref-config"[\s\S]*?<\/cy-card>/);
  assert.ok(card, '偏好题卡锚点失效');
  assert.doesNotMatch(card[0], /<textarea/);
  assert.doesNotMatch(card[0], /fillPreferenceExample|onPreferenceJsonChange|填入可编辑示例/);
  assert.match(card[0], /wx:for="\{\{ preferencePreview \}\}"/);
  const js = read('pages/publish/temp/index.js');
  assert.doesNotMatch(js, /fillPreferenceExample|onPreferenceJsonChange/);
  assert.doesNotMatch(js, /填入可编辑示例/, '报错不再指向已撤掉的按钮');
});

test('F 运行时照旧:游玩页仍渲染偏好题组(validationMethod 6)', () => {
  const play = read('pages/play/index.js');
  assert.match(play, /vm === 6 \? '生活偏好校准'/);
  assert.match(read('utils/validation-method-labels.js'), /6: '偏好题组'/);
});
