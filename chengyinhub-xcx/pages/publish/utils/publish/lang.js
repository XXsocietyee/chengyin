'use strict';
// 发布分包里反复手写的三个小工具,收成一处(L04-089)。
//   text(v)            去首尾空白的字符串,null/undefined 当空串
//   clone(v)           JSON 深拷贝;null/undefined 得 null
//   parseJsonObject(v) 对象原样返回,JSON 字符串解析成对象;空、非法、数组或基本类型一律 null
function text(value) {
  return String(value == null ? '' : value).trim();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value == null ? null : value));
}

function parseJsonObject(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return Array.isArray(raw) ? null : raw;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (error) {
    return null;
  }
}

// 1 至 64 位字母、数字、下划线或短横线:选项 / 图片 / 检定 / 结果码 / 下一段 id 同一条规则(L04-078)
const ID_64 = /^[A-Za-z0-9_-]{1,64}$/;

/** 媒体地址:https 链接或站内路径(/ 开头、不是 // 、不含反斜杠);opts.mediaAsset 时另认 media-asset:N。 */
function isMediaUrl(value, opts) {
  const s = typeof value === 'string' ? value : '';
  if (!s) return false;
  if (s.slice(0, 8) === 'https://') return true;
  if (s.charAt(0) === '/' && s.slice(0, 2) !== '//' && s.indexOf('\\') < 0) return true;
  return !!(opts && opts.mediaAsset) && /^media-asset:[1-9][0-9]{0,18}$/.test(s);
}

module.exports = { text, clone, parseJsonObject, ID_64, isMediaUrl };
