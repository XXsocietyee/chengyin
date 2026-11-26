'use strict';

// 位置（章节）模板指引 roleNeed 的纯解析：只取三个标签后的当行正文，
// 「名称｜参考示例 · 」前缀与括号免责声明行不进入结果。
const LABELS = [
  ['shops', '适合店铺：'],
  ['perkExample', '权益示例：'],
  ['minDelivery', '最低交付要求：'],
];

function parseRoleNeed(text) {
  const out = { shops: '', perkExample: '', minDelivery: '', raw: '' };
  const source = String(text == null ? '' : text).trim();
  if (!source) return out;
  let found = false;
  source.split(/\r?\n/).forEach((line) => {
    LABELS.forEach(([key, label]) => {
      const at = line.indexOf(label);
      if (at < 0 || out[key]) return;
      found = true;
      out[key] = line.slice(at + label.length).trim().replace(/。$/, '').trim();
    });
  });
  if (!found) out.raw = source;
  return out;
}

module.exports = { parseRoleNeed };
