'use strict';

const { formatDayDots } = require('../../../utils/datetime.js');

const CHINA_OFFSET_MS = 8 * 60 * 60 * 1000;

function pad2(n) {
  return String(Math.max(0, Number(n) || 0)).padStart(2, '0');
}

function formatClockParts(nowMs) {
  const ts = typeof nowMs === 'number' && Number.isFinite(nowMs) ? nowMs : Date.now();
  const d = new Date(ts + CHINA_OFFSET_MS);
  const year = d.getUTCFullYear();
  const month = pad2(d.getUTCMonth() + 1);
  const day = pad2(d.getUTCDate());
  const hh = pad2(d.getUTCHours());
  const mm = pad2(d.getUTCMinutes());
  const ss = pad2(d.getUTCSeconds());
  return {
    dateText: year + '-' + month + '-' + day,
    clockText: hh + ':' + mm + ':' + ss,
  };
}

function formatDailySerial(serialNo) {
  const num = Number(serialNo);
  const safe = Number.isFinite(num) && num > 0 ? Math.floor(num) : 1;
  const padded = String(safe).padStart(3, '0');
  return {
    serialNo: safe,
    serialCode: 'NO.' + padded,
    serialLabel: '今日第 ' + padded + ' 号',
  };
}

/**
 * 柜台台卡自助核销确认视图：只展示店名、加粗权益名、当日核销序号、脱敏昵称与实时跳动秒表，
 * 绝不透传手机号或未脱敏 PII。
 */
function buildStandRedeemView(payload, fallbackNode, nowMs) {
  const data = payload || {};
  const node = fallbackNode || {};
  const serial = formatDailySerial(data.dailySerialNo || data.redemptionId || 1);
  const clock = formatClockParts(nowMs);
  const shopName = String(data.shopName || node.name || '合作门店').trim();
  const perkTitle = String(
    data.perkTitle
    || (node.perk && node.perk.name)
    || shopName
  ).trim();
  const playerName = String(data.playerName || '').trim();
  return {
    show: true,
    shopName,
    perkTitle,
    serialCode: serial.serialCode,
    serialLabel: serial.serialLabel,
    playerName,
    clockText: clock.clockText,
    dateText: clock.dateText,
    replayed: data.replayed === true,
  };
}

function pickFinishCouponHistory(rows, couponId) {
  if (!Array.isArray(rows) || !couponId) return null;
  const target = String(couponId);
  const matched = rows.filter((row) => row && String(row.couponId) === target);
  if (!matched.length) return null;
  const unused = matched.find((row) => Number(row.useStatus) === 0);
  return unused || matched[0];
}

function formatCouponAmount(amount) {
  if (amount == null || amount === '') return '';
  const cleaned = String(amount).replace(/\.0+$/, '');
  return cleaned ? cleaned + '元' : '';
}

/**
 * §4.2 19-route 终点完赛驿站卡视图模型：复用 finishCoupon + finishStation + ApiCouponController myrecvlist。
 */
function buildFinishStationView(finishCoupon, historyRow, stationMeta, fallbackNode) {
  if (!finishCoupon || typeof finishCoupon !== 'object') return null;
  const hist = historyRow || null;
  const meta = stationMeta || {};
  const node = fallbackNode || {};
  const endDay = formatDayDots((hist && hist.endTime) || finishCoupon.endTime);
  const redeemed = !!(hist && Number(hist.useStatus) === 1);
  const couponHistoryId = hist && hist.id != null ? String(hist.id) : '';
  const shopName = String((hist && hist.shopName) || meta.shopName || node.name || '终点完赛驿站').trim();
  const shopAddress = String((hist && hist.shopAddress) || meta.shopAddress || node.address || '').trim();
  const perkName = String((hist && hist.couponName) || finishCoupon.name || '完赛专属权益').trim();
  const amountText = formatCouponAmount(finishCoupon.amount);
  return {
    eyebrow: '终点完赛驿站',
    couponId: finishCoupon.id != null ? String(finishCoupon.id) : '',
    couponHistoryId,
    perkName,
    amountText,
    expiresText: endDay ? ('有效期至 ' + endDay) : '有效期见券包',
    shopName,
    shopAddress,
    redeemed,
    ctaText: redeemed ? '已核销' : '出示核销码',
  };
}

module.exports = {
  formatClockParts,
  formatDailySerial,
  buildStandRedeemView,
  pickFinishCouponHistory,
  buildFinishStationView,
};
