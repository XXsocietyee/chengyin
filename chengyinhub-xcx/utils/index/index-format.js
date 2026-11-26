// FE-12 首页格式化纯函数。从 pages/index/index.js 抽出:日期时间展示格式化 + 主题列表日期整形。
// 无 wx / 无 this / 无副作用,可直接单测。逻辑与原 index 内联实现逐字一致。

// 日期时间展示 "YYYY年M月D日 周X HH:mm"(24 小时制)。
function formatDateTimeForDisplay(date) {
  if (!date) return '';

  // 星期几的映射
  const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  // 月份映射
  const months = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

  const weekDay = weekDays[date.getDay()];
  const year = date.getFullYear();
  const month = months[date.getMonth()];
  const day = date.getDate();

  // j1 F18:24 小时制,0 点不再读成「上午12:xx」。
  const formattedHours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');

  return `${year}年${month}${day}日 ${weekDay} ${formattedHours}:${minutes}`;
}

// L10-121:首页三条列表(公开列表 / 底部主题 / 底部活动)共用的日期整形,原来同一段逻辑写了三遍。
// 补 month/day/dateTime/formattedStartDate 与 endmonth/endday/endDateTime/formattedEndDate,
// 以及 formattedDateTime / formattedEndDateTime(日期解析失败就不写,不再出现 NaN 文案)。
// overwrite=false(默认)时只补缺失的 dateTime / endDateTime,保留旧 processTopicDate 的语义。
function hourMinuteOf(timePart) {
  if (!timePart) return '00:00';
  const parts = timePart.split(':');
  return `${parts[0]}:${parts[1]}`;
}
function displayOf(value) {
  try {
    const date = new Date(String(value).replace(/-/g, '/'));
    return isNaN(date.getTime()) ? '' : formatDateTimeForDisplay(date);
  } catch (e) { return ''; }
}
function shapeOne(row, key, prefix, overwrite) {
  const raw = row[key];
  if (!raw) return;
  const shown = displayOf(raw);
  if (shown) row[prefix === 'end' ? 'formattedEndDateTime' : 'formattedDateTime'] = shown;
  const [datePart, timePart] = String(raw).split(' ');
  if (!datePart) return;
  const [, month, day] = datePart.split('-');
  const text = `${month}.${day} ${hourMinuteOf(timePart)}`;
  const timeKey = prefix === 'end' ? 'endDateTime' : 'dateTime';
  if (!overwrite && row[timeKey]) return;
  row[prefix === 'end' ? 'endmonth' : 'month'] = month;
  row[prefix === 'end' ? 'endday' : 'day'] = day;
  row[timeKey] = text;
  row[prefix === 'end' ? 'formattedEndDate' : 'formattedStartDate'] = text;
}
function shapeListDates(list, overwrite) {
  for (let i = 0; i < list.length; i++) {
    shapeOne(list[i], 'startDate', 'start', !!overwrite);
    shapeOne(list[i], 'endDate', 'end', !!overwrite);
  }
  return list;
}

// 旧名保留给既有调用与测试:只补缺失字段。
function processTopicDate(list) {
  return shapeListDates(list, false);
}

module.exports = {
  formatDateTimeForDisplay: formatDateTimeForDisplay,
  processTopicDate: processTopicDate,
  shapeListDates: shapeListDates,
};
