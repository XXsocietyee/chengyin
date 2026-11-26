'use strict';
// P-16:人民广场真实站点不应被当成默认坐标;只拦地图没动过的兜底中心,且在选点处拦。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const view = require('../../pages/publish/utils/publish/route-map-view.js');

test('兜底中心(六位小数)判为未选点', () => {
  assert.equal(view.isUntouchedDefaultCenter({ latitude: 31.230416, longitude: 121.473701 }), true);
  assert.equal(view.isUntouchedDefaultCenter({ latitude: '31.230416', longitude: '121.473701' }), true);
});

test('作者选中的人民广场站点不算默认', () => {
  assert.equal(view.isUntouchedDefaultCenter({ latitude: 31.2304, longitude: 121.4737 }), false);
  assert.equal(view.isUntouchedDefaultCenter({ latitude: 31.2312, longitude: 121.4751 }), false);
  assert.equal(view.isUntouchedDefaultCenter(null), false);
});

// AUDIT-1122 L03-143:编辑页的地图准星加点/移点(saveNodeLocation)没有任何入口,整链删除;
// 默认中心判定仍由上面两条覆盖 route-map-view 的纯函数。
