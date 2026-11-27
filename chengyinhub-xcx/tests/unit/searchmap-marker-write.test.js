'use strict';

// L05-153:一次搜索不能把同一批 markers 写进视图两三次。两路结果都到齐再写一次。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

function setPath(target, dotted, value) {
  const parts = dotted.split('.');
  let cursor = target;
  parts.slice(0, -1).forEach((part) => {
    cursor[part] = cursor[part] || {};
    cursor = cursor[part];
  });
  cursor[parts.at(-1)] = value;
}

function loadPage() {
  const requests = [];
  let definition;
  global.getApp = () => ({
    globalData: {},
    sendRequest(options) { requests.push(options); },
  });
  global.wx = {
    showToast() {},
    getNetworkType(options) { options.success({ networkType: 'wifi' }); },
    onNetworkStatusChange() {},
    offNetworkStatusChange() {},
  };
  global.Page = (value) => { definition = value; };
  const modulePath = path.resolve(__dirname, '../../pages/searchmap/index.js');
  delete require.cache[require.resolve(modulePath)];
  require(modulePath);
  const markerWrites = [];
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
  });
  page.setData = function setData(patch, callback) {
    Object.entries(patch).forEach(([key, value]) => setPath(this.data, key, value));
    if (Object.prototype.hasOwnProperty.call(patch, 'markers')) markerWrites.push(patch.markers);
    if (callback) callback();
  };
  page._hasLocation = true;
  return { page, requests, markerWrites };
}

const activityRow = { id: 3, name: '甲', latitude: 31.2, longitude: 121.4 };
const merchantRow = { poiId: 5, name: '乙', lat: 31.1, lng: 121.3 };

test('一次搜索等活动点和商家点都到齐,只写一次 markers', () => {
  const { page, requests, markerWrites } = loadPage();
  page.runFreshQuery();
  const activity = requests.find((request) => request.url === '/api/activity/list');
  const merchant = requests.find((request) => request.url === '/api/city/nodes');
  activity.success({ code: 200, data: { rows: [activityRow] } });
  assert.equal(markerWrites.length, 0, '活动先回来时先不写点');
  merchant.success({ code: 200, data: [merchantRow] });
  assert.equal(markerWrites.length, 1, '两路都齐了只写一次');
  assert.deepEqual(page.data.markers.map((marker) => marker.kind).sort(), ['activity', 'merchant']);
});

test('商家点先回来也只在活动点到齐后写一次', () => {
  const { page, requests, markerWrites } = loadPage();
  page.runFreshQuery();
  const activity = requests.find((request) => request.url === '/api/activity/list');
  const merchant = requests.find((request) => request.url === '/api/city/nodes');
  merchant.success({ code: 200, data: [merchantRow] });
  assert.equal(markerWrites.length, 0);
  activity.success({ code: 200, data: { rows: [activityRow] } });
  assert.equal(markerWrites.length, 1);
  assert.equal(page.data.markers.length, 2);
});

test('活动失败时商家点仍只写一次,不把失败再写一遍', () => {
  const { page, requests, markerWrites } = loadPage();
  page.runFreshQuery();
  requests.find((request) => request.url === '/api/activity/list').fail({ errMsg: 'request:fail timeout' });
  requests.find((request) => request.url === '/api/city/nodes').success({ code: 200, data: [merchantRow] });
  assert.equal(markerWrites.length, 1);
  assert.deepEqual(page.data.markers.map((marker) => marker.kind), ['merchant']);
});

test('单独刷新商家点不跟活动点绑在一起,回来就写一次', () => {
  const { page, requests, markerWrites } = loadPage();
  page.getMerchantNodes();
  requests[0].success({ code: 200, data: [merchantRow] });
  assert.equal(markerWrites.length, 1);
  assert.equal(page.data.markers[0].id, 1000005);
});

test('没有定位时商家侧立即结束,活动点回来仍只写一次', () => {
  const { page, requests, markerWrites } = loadPage();
  page._hasLocation = false;
  page.runFreshQuery();
  assert.equal(requests.some((request) => request.url === '/api/city/nodes'), false);
  requests.find((request) => request.url === '/api/activity/list').success({ code: 200, data: { rows: [activityRow] } });
  assert.equal(markerWrites.length, 1);
  assert.deepEqual(page.data.markers.map((marker) => marker.kind), ['activity']);
});

test('上一轮已经写完后,翻页回来再写一次,不等商家点', () => {
  const { page, requests, markerWrites } = loadPage();
  page.runFreshQuery();
  requests.find((request) => request.url === '/api/activity/list').success({ code: 200, data: { rows: [activityRow] } });
  requests.find((request) => request.url === '/api/city/nodes').success({ code: 200, data: [merchantRow] });
  assert.equal(markerWrites.length, 1);
  page.setData({ pageNum: 2, hasMore: true });
  page.getList();
  const next = requests.filter((request) => request.url === '/api/activity/list').pop();
  next.success({ code: 200, data: { rows: [{ id: 8, name: '丙', latitude: 31.3, longitude: 121.5 }] } });
  assert.equal(markerWrites.length, 2);
  assert.equal(page.data.markers.filter((marker) => marker.kind === 'activity').length, 2);
});
