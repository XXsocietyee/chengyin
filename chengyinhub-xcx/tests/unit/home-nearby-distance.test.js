'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');

function setPath(target, dotted, value) {
  const parts = dotted.split('.');
  let cursor = target;
  parts.slice(0, -1).forEach((part) => { cursor = cursor[part] || (cursor[part] = {}); });
  cursor[parts.at(-1)] = value;
}

function loadPage() {
  let config;
  const requests = [];
  global.Page = (value) => { config = value; };
  global.Component = () => {};
  global.wx = {
    getStorageSync: () => '',
    getAccountInfoSync: () => ({ miniProgram: { envVersion: 'release' } }),
    showToast() {},
  };
  global.getApp = () => ({
    globalData: { features: {} },
    getUserID: () => '',
    getUserType: () => 1,
    getPageSize: () => 10,
    setOpenID() {},
    tips() {},
    getImgUrl: (src) => src,
    sendRequest: (options) => {
      requests.push(options);
      return { abort() {} };
    },
  });
  delete require.cache[require.resolve('../../pages/index/index.js')];
  require('../../pages/index/index.js');
  const page = Object.assign({}, config, { data: JSON.parse(JSON.stringify(config.data)) });
  page.setData = (patch, callback) => {
    Object.entries(patch).forEach(([key, value]) => setPath(page.data, key, value));
    if (callback) callback();
  };
  return { page, requests };
}

test('L10-122:附近活动请求不带坐标时,回包里的距离不能显示', () => {
  const { page, requests } = loadPage();
  page.getListData('nearbyActivityList', '/api/activity/list', {
    is_my: 0,
    sort_type: 2,
    pageNum: 1,
    pageSize: 4,
  });
  assert.equal('latitude' in requests[0].data, false);
  assert.equal('longitude' in requests[0].data, false);
  requests[0].success({
    code: 200,
    data: {
      rows: [
        { id: 1, name: '非零', distance: 3200 },
        { id: 2, name: '零', distance: 0 },
        { id: 3, name: '字符串', distance: '1500' },
        { id: 4, name: '空', distance: null },
      ],
    },
  });
  requests[0].complete();
  for (const row of page.data.nearbyActivityList) {
    assert.equal(row.distance, '', row.name + ' 的距离不是这次请求测的');
  }
});

test('L10-122:请求带了坐标时只保留正数实测距离,0 不是距离', () => {
  const { page, requests } = loadPage();
  page.getListData('nearbyActivityList', '/api/activity/list', {
    is_my: 0,
    sort_type: 2,
    latitude: 31.23,
    longitude: 121.47,
  });
  requests[0].success({
    code: 200,
    data: {
      rows: [
        { id: 1, name: '原地', distance: 0 },
        { id: 2, name: '两公里半', distance: 2500 },
        { id: 3, name: '字符串零', distance: '0' },
        { id: 4, name: '没有距离字段' },
        { id: 5, name: '坏距离', distance: '不是数' },
        { id: 6, name: '空白', distance: '  ' },
      ],
    },
  });
  const rows = page.data.nearbyActivityList;
  assert.equal(rows[0].distance, '');
  assert.equal(rows[1].distance, '2.50km');
  assert.equal(rows[2].distance, '');
  assert.equal(rows[3].distance, '');
  assert.equal(rows[4].distance, '');
  assert.equal(rows[5].distance, '');
});

test('L10-122:字符串坐标和 0,0 算测过;空白或只传一个不算', () => {
  const cases = [
    [{ latitude: '31.2', longitude: '121.5' }, 0, ''],
    [{ latitude: 0, longitude: 0 }, 100, '0.10km'],
    [{ latitude: '  ', longitude: 121.5 }, 800, ''],
    [{ latitude: 31.2, longitude: '' }, 800, ''],
    [{ latitude: 31.2 }, 800, ''],
    [{ longitude: 121.5 }, 800, ''],
    [{ latitude: 91, longitude: 121.5 }, 800, ''],
    [{ latitude: 31.2, longitude: 181 }, 800, ''],
  ];
  for (const [params, distance, expected] of cases) {
    const { page, requests } = loadPage();
    page.getListData('nearbyActivityList', '/api/activity/list', params);
    requests[0].success({ code: 200, data: { rows: [{ id: 1, distance }] } });
    assert.equal(page.data.nearbyActivityList[0].distance, expected, JSON.stringify(params));
  }
});

test('L10-122:首页刷新的附近列表本身不传坐标,因此不显示距离', () => {
  const { page, requests } = loadPage();
  let locationCalls = 0;
  wx.getLocation = () => { locationCalls += 1; };
  page.loadPageData();
  const nearby = requests.find((request) => request.url === '/api/activity/list'
    && request.data && request.data.is_my === 0 && request.data.pageSize === 4);
  assert.ok(nearby);
  assert.equal('latitude' in nearby.data, false);
  assert.equal('longitude' in nearby.data, false);
  assert.equal(locationCalls, 0);
  nearby.success({ code: 200, data: { rows: [{ id: 9, name: '外滩', distance: 0 }, { id: 10, name: '外滩东', distance: 1200 }] } });
  assert.equal(page.data.nearbyActivityList[0].name, '外滩');
  assert.equal(page.data.nearbyActivityList[0].distance, '');
  assert.equal(page.data.nearbyActivityList[1].distance, '');
});

test('L10-122:附近卡只在有距离文案时渲染徽标', () => {
  const wxml = fs.readFileSync(path.resolve(__dirname, '../../pages/index/index.wxml'), 'utf8');
  const start = wxml.indexOf('class="v3-nearby-viewers');
  assert.ok(start > -1);
  const tag = wxml.slice(wxml.lastIndexOf('<view', start), wxml.indexOf('>', start));
  assert.match(tag, /wx:if="\{\{item\.distance\}\}"/);
});
