'use strict';
// 故事流「点屏幕往下走」(2026-11-24 业主:故事流里除了到站「我已到达」和答题确认,不留按钮)。
// 章末能不能点一下就进下一章 / 下一站 / 结局:最后一块是还没玩完的玩法(game / kit / encounter 检定 / 行内选项)时不能 ——
// 那一块自己就是下一步。原来这条写在 wxml 的「继续探索」显示条件里,按钮撤了以后由 onStoryTap 读这里。
const PENDING_KINDS = ['game', 'kit', 'journeyCheck', 'choice'];

function storyEndReady(paras) {
  const last = (paras || [])[(paras || []).length - 1];
  return !last || PENDING_KINDS.indexOf(last.kind) < 0 || !!last.done;
}

module.exports = { storyEndReady, PENDING_KINDS };
