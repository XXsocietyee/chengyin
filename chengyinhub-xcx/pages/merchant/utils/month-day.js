'use strict';
// L07-124:场次 / 趋势轴的「几月几日」写法只此一份(店铺参谋与合作中心原来各抄一份)。
const { toTimestamp, chinaParts } = require('../../../utils/datetime.js');

function partsOf(value) {
  const timestamp = toTimestamp(value);
  return timestamp ? chinaParts(timestamp) : null;
}

/** 9月28日;认不出返回 '' */
function monthDay(value) {
  const parts = partsOf(value);
  return parts ? parts.month + '月' + parts.day + '日' : '';
}

/** 9/28;认不出返回 '' */
function slashDay(value) {
  const parts = partsOf(value);
  return parts ? parts.month + '/' + parts.day : '';
}

module.exports = { monthDay, slashDay };
