'use strict';
// 「高级设置 · 作答规则」按行动态绑定(data-section="{{item.section}}")可能出现的全部字段。
// 原先放在 pages/publish/temp/editor-layout.js 只给测试用(L04-046),现在由公开的 answerRuleRows 推出来。
const layout = require('../../pages/publish/temp/editor-layout.js');
const cfg = require('../../pages/publish/utils/publish/advanced-game-config.js');

module.exports = function allAnswerRuleFields() {
  const out = [];
  const add = (row) => { if (!out.some((r) => r.section === row.section && r.field === row.field)) out.push({ section: row.section, field: row.field }); };
  ['PICK', 'TYPE'].forEach((mode) => layout.answerRuleRows({ qa: { mode } }, 'qa').forEach(add));
  cfg.SECTIONS.forEach((section) => layout.answerRuleRows({}, section).forEach(add));
  layout.answerRuleRows({ blindTaste: { enabled: true } }, '').forEach(add);
  return out;
};
