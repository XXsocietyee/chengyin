'use strict';
// 章节「第一个节点之前的正文」投影:存盘的 chapter.description 与发布前的剧情闸用同一份(L04-116)。
// 节点叙事段(beat)和条件正文(when)都不算 —— 前者属于节点,后者不是每个玩家都看得到。
function hasNarrativeBeat(block) {
  return !!block && block.beat != null && String(block.beat).trim() !== '';
}

function projectedDescription(blocks) {
  const list = Array.isArray(blocks) ? blocks : [];
  const textBlocks = [];
  for (let i = 0; i < list.length; i += 1) {
    const block = list[i] || {};
    if (block.type === 'node') break;
    if (block.type === 'text' && !hasNarrativeBeat(block) && block.when == null) textBlocks.push(String(block.content == null ? '' : block.content));
  }
  return textBlocks.join('\n');
}

module.exports = { hasNarrativeBeat, projectedDescription };
