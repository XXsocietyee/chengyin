'use strict';
const route = require('./topic-route-graph');
// 旧的逐行表单编辑器(rows / change / conditionTypes / effectTypes)已被 story-rule-sentence 取代,
// 只剩 errors() 有调用方(story-rule-editor、fabu),其余删掉(L04-096)。
function errors(value,nodes,variables) {
  const ids=nodes.map(n=>String(n.id));
  const graph={schemaVersion:1,startNodeId:ids[0] || '',terminalNodeIds:ids.slice(-1),variables,
    edges:[{id:'author_rules',fromNodeId:ids[0] || '',toNodeId:ids[ids.length-1] || '',trigger:{type:'CHOICE',outcomeCode:'GO'},conditions:value.conditions || [],effects:value.effects || []}],fallbacks:[]};
  return route.validate(graph,nodes).errors.filter(e=>/^(conditions|effects)\[/.test(e.field || ''));
}
module.exports={errors};
