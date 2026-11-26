// REV-AUTO(AUDIT-1122 L01-089 回归):序章 / 纯故事章 0 处地点时,选章行小字不能留一个悬空的「 · 」。
// 把模板里那一行的插值逐段求值(同一份表达式,不另抄一份规则),看玩家真正读到的字。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const wxml = fs.readFileSync(path.resolve(__dirname, '../../pages/play/index.wxml'), 'utf8');

function renderSub(scope) {
  const m = wxml.match(/<block wx:else><text class="chpick__sub">([^<]*)<\/text><\/block>/);
  assert.ok(m, '选章行小字模板仍在');
  const parts = m[1].match(/\{\{[\s\S]*?\}\}/g) || [];
  assert.equal(parts.join(''), m[1], '这一行只由插值组成');
  return parts.map((p) => {
    const v = new Function('chapterPick', 'index', 'item', 'return (' + p.slice(2, -2) + ');')(scope.chapterPick, 0, scope.item);
    return v == null ? '' : String(v);
  }).join('');
}

const done = { states: ['completed'] };
const open = { states: ['open'] };

test('L01-089 已完成的 0 处地点章只写「已完成」,不留悬空分隔符', () => {
  assert.equal(renderSub({ chapterPick: done, item: { nodeCount: 0, mileage: '' } }), '已完成');
  assert.equal(renderSub({ chapterPick: done, item: { nodeCount: 0, mileage: '1.2km' } }), '已完成 · 1.2km');
});

test('L01-089 有地点 / 未完成的各组合照旧', () => {
  assert.equal(renderSub({ chapterPick: done, item: { nodeCount: 3, mileage: '' } }), '已完成 · 3 处地点');
  assert.equal(renderSub({ chapterPick: done, item: { nodeCount: 3, mileage: '1.2km' } }), '已完成 · 3 处地点 · 1.2km');
  assert.equal(renderSub({ chapterPick: open, item: { nodeCount: 0, mileage: '' } }), '');
  assert.equal(renderSub({ chapterPick: open, item: { nodeCount: 2, mileage: '1.2km' } }), '2 处地点 · 1.2km');
  assert.equal(renderSub({ chapterPick: open, item: { nodeCount: 0, mileage: '1.2km' } }), '1.2km');
});
