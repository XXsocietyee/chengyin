// FE-11 发布器日期时间纯函数。从 pages/publish/fabu/index.js 抽出:日期归一化/API 格式化/营业时间解析/时分格式化/日期列表生成。
// 无 wx / 无 this / 无副作用,可直接单测。逻辑与原 fabu 内联实现逐字一致。
// 页面读 this.data / setData 的部分由调用方保留(buildDateList 接收 today、返回纯数组,setData 仍在页面)。

// 归一化日期时间:纯日期补 defaultTime;带时分则规整为 "YYYY-MM-DD HH:mm:ss";解析不出返 null(= 原 _normalizeDateTime)。
const { chinaParts } = require('../../../../utils/datetime.js');
const pad2 = (n) => (n < 10 ? '0' : '') + n;

function normalizeDateTime(v, defaultTime) {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  let m = s.match(/^(\d{4}-\d{2}-\d{2})$/);
  if (m) return m[1] + ' ' + defaultTime;
  // 带 Z / ±hh:mm 的 ISO 串是一个绝对时刻:换算成北京时间再写,不能直接截掉时区当本地时间(L04-093)
  if (/T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    const p = chinaParts(s);
    const sec = (s.match(/T\d{2}:\d{2}:(\d{2})/) || [0, '00'])[1];
    return p ? p.year + '-' + pad2(p.month) + '-' + pad2(p.day) + ' ' + pad2(p.hours) + ':' + pad2(p.minutes) + ':' + sec : null;
  }
  m = s.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::(\d{2}))?/);
  if (m) return m[1] + ' ' + m[2] + ':' + (m[3] || '00');
  return null;
}

// 组装 API 提交用日期时间 "YYYY-MM-DD HH:mm:00"(= 原 formatDateTimeForAPI)。
//
// 2026-07-31 修时区 bug:原实现绕 new Date(dateStr) 再读本地 getter,负偏移时区下 UTC 午夜会落到前一天。
// 调用方(fabu / activity 的日期表)传的都是 'YYYY-MM-DD' 纯日期串,直接拆字符串即可,不过 Date。
function formatDateTimeForAPI(dateStr, hour, minute) {
  const hourStr = hour.toString().padStart(2, '0');
  const minuteStr = minute.toString().padStart(2, '0');

  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr));
  // 两个调用方(fabu / activity 的日期表)传的恒为 'YYYY-MM-DD';不是这个形状就返回空串,
  // 原先的 new Date 兜底不可达,已删(L04-083)
  return m ? `${m[1]}-${m[2]}-${m[3]} ${hourStr}:${minuteStr}:00` : '';
}

// 解析营业时间 "HH:mm-HH:mm" → {startHour,startMinute,endHour,endMinute};非法返 null(= 原 parseBusinessTime)。
function parseBusinessTime(businessTime) {
  if (!businessTime) return null;

  try {
    const parts = businessTime.split('-');
    if (parts.length !== 2) return null;

    const startParts = parts[0].split(':');
    const endParts = parts[1].split(':');

    if (startParts.length !== 2 || endParts.length !== 2) return null;

    // 每段必须是合法的时 / 分,否则 NaN 会一路流进时间选择器的下标(L04-093)
    const num = (text, max) => (/^\s*\d{1,2}\s*$/.test(text) && parseInt(text, 10) <= max ? parseInt(text, 10) : NaN);
    const out = {
      startHour: num(startParts[0], 23),
      startMinute: num(startParts[1], 59),
      endHour: num(endParts[0], 23),
      endMinute: num(endParts[1], 59)
    };
    return Object.keys(out).every((k) => Number.isInteger(out[k])) ? out : null;
  } catch (error) {
    console.error('解析营业时间失败');
    return null;
  }
}

// 时分补零格式化 "HH:mm"(= 原 formatTime)。
function formatTime(hour, minute) {
  const formatNumber = n => n.toString().padStart(2, '0');
  return `${formatNumber(hour)}:${formatNumber(minute)}`;
}

// 从 today 起 31 天的日期选择列表(= 原 generateDateList 的纯计算部分;setData 仍留在页面)。
//
// 2026-07-31 修同一类时区 bug:原实现的 date 字段走 toISOString()(UTC),display/month/day
// 走本地 getMonth/getDate——正偏移时区(如 UTC+8)下,本地午夜到时区偏移那几个小时内
// (UTC+8 是 00:00-08:00),UTC 还停在前一天,date 字段就会比 display/month/day 慢一天。
// 改成 date 字段也用本地 getter 拼,四个字段单一真源,不会互相对不上。
// range(可选,L04-022):{ start, end } 是表单里已有的起止日(当天 00:00 的 Date)。
// 表从 min(今天, start) 起、至少 31 天且覆盖到 end —— 编辑已开始或很远的场次时原日期也在表里,
// 确认滚轮不会把日期悄悄换成别的。不传 range = 今天起 31 天(原行为)。
function buildDateList(today, range) {
  const dateList = [];
  const r = range || {};
  const first = r.start && r.start < today ? r.start : today;
  const span = r.end ? Math.floor((r.end.getTime() - first.getTime()) / 86400000) + 1 : 0;
  const count = Math.max(31, span);

  for (let i = 0; i < count; i++) {
    const date = new Date(first);
    date.setDate(first.getDate() + i);

    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const dateStr = `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;

    dateList.push({
      date: dateStr,
      display: `${month}月${day}日`,
      month: month,
      day: day
    });
  }

  return dateList;
}

module.exports = {
  normalizeDateTime: normalizeDateTime,
  formatDateTimeForAPI: formatDateTimeForAPI,
  parseBusinessTime: parseBusinessTime,
  formatTime: formatTime,
  buildDateList: buildDateList,
};
