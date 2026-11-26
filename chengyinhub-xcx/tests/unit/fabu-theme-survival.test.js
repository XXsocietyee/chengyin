const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
global.getApp = () => ({ globalData: {}, chooseImage: callback => callback(['https://example.com/card.jpg']) });
global.wx = { showToast() {} };
const survival = require('../../pages/publish/fabu/theme-runtime-survival.js');
const runtime = require('../../pages/publish/fabu/theme-runtime.js');
const base = () => ({ schemaVersion: 1, capacity: 6, hpName: '体力', items: [{ id: 'supply', kind: 'ITEM', name: '补给包', image: 'https://example.com/item.jpg', slotCost: 1 }], gameplayRuntime: { runtimeScope: 'TEAM', worldMode: 'WORLD_SHARED', survival: { zeroHpPolicy: 'BLOCK_PAID', actionLimitPolicy: 'BLOCK_OVERFLOW', consumeOnNoEffect: false }, acts: [{ actKey: 'act_one', questKeys: ['quest_one'], completionRule: { type: 'ALL' } }], quests: [{ questKey: 'quest_one', actKey: 'act_one', nodeId: 101, locationKey: 'gate', settlementSlot: 'quest_one' }] } });
function page(config = base()) {
  const p = { data: { ...structuredClone(runtime.data), ...structuredClone(survival.data), editingTopicId: 77, formData: { themeRuntimeConfig: JSON.stringify(config), journeyRules: JSON.stringify({ stateEnabled: true, hp: { enabled: true, init: 8, max: 10 } }), chapters: [{ name: '启程', nodes: [{ id: 101, name: '广场' }, { id: 102, name: '街角' }] }] } }, setData(patch) { for (const [key, value] of Object.entries(patch)) { const parts = key.split('.'); let o = this.data; for (const part of parts.slice(0, -1)) o = o[part]; o[parts.at(-1)] = value; } } };
  return Object.assign(p, runtime.methods, survival.methods);
}
const e = (dataset = {}, value) => ({ currentTarget: { dataset }, detail: { value } });

// AUDIT-1122 L03-108/205:恢复/配给/设施的列表与单项编辑层没有入口,随死代码删除;
// 作者端只剩结果卡。旧配置由后端共享夹具代表,校验与保留语义直接对 validate/apply 断言。
const FIXTURE = path.join(__dirname, 'fixtures/author-survival-config.json');
const built = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

test('旧恢复/配给/设施配置：改结果卡保存时原样保留，夹具本身通过整体校验', () => {
  const c = built(); assert.equal(survival.validate(c, [{ value: 101 }, { value: 102 }]), '');
  const p = page(c); p.openSurvivalEditor(); p.toggleSurvivalCardField(e({ value: 'story' })); assert.equal(p.saveSurvivalEditor(), true, p.data.survivalEditor.error);
  const saved = JSON.parse(p._runtimePayload());
  assert.deepEqual(saved.gameplayRuntime, c.gameplayRuntime); assert.ok(saved.card.fields.includes('story'));
});
test('结果卡：退出丢弃；未改动完成不写草稿；空白主题不创建运行段', () => {
  const p = page({ schemaVersion: 1, capacity: 0 }); const before = p.data.formData.themeRuntimeConfig;
  p.openSurvivalEditor(); assert.equal(p.data.survivalEditor.kind, 'card'); assert.equal(p.data.survivalEditor.section, 'card');
  p.toggleSurvivalCardField(e({ value: 'hp' })); p.closeSurvivalEditor(); assert.equal(p.data.formData.themeRuntimeConfig, before);
  let saves = 0; const real = p._saveRuntime; p._saveRuntime = function (c) { saves += 1; return real.call(this, c); };
  p.openSurvivalEditor(); assert.equal(p.saveSurvivalEditor(), true); assert.equal(saves, 0); assert.equal(p.data.formData.themeRuntimeConfig, before);
  p.openSurvivalEditor(); p.toggleSurvivalCardField(e({ value: 'ending' })); p.saveSurvivalEditor(); assert.equal(Object.hasOwn(JSON.parse(p._runtimePayload()), 'gameplayRuntime'), false);
});
test('结果卡白名单使用主题名称、上传封面、恢复默认；队伍玩法不能开个人重玩', () => {
  const p = page(); p.openSurvivalEditor(); p.toggleSurvivalCardField(e({ value: 'hp' })); p.toggleSurvivalCardUnlocks(e({}, true)); p.uploadSurvivalCover();
  assert.equal(p.data.survivalCardFields.find(f => f.value === 'hp').label, '体力'); assert.equal(p.data.survivalEditor.row.cover, 'https://example.com/card.jpg');
  assert.equal(p.saveSurvivalEditor(), true); assert.deepEqual(JSON.parse(p._runtimePayload()).card, { fields: ['hp'], showUnlocks: true, cover: 'https://example.com/card.jpg' });
  p._refreshSurvivalSummary(); assert.deepEqual(p.data.survivalSummary, { cardText: '已自定义' });
  p.openSurvivalEditor(); assert.equal(p.data.survivalEditor.customized, true); p.removeSurvivalRow(); assert.equal(p.saveSurvivalEditor(), true); assert.equal(Object.hasOwn(JSON.parse(p._runtimePayload()), 'card'), false);
  p.openSurvivalEditor(); p.removeSurvivalRow(); p.toggleSurvivalCardField(e({ value: 'luck' })); p.saveSurvivalEditor(); assert.deepEqual(JSON.parse(p._runtimePayload()).card, { fields: ['luck'] });
  assert.equal(p.toggleThemeReplay(e({}, true)), false); assert.match(p.data.themeReplayError, /队伍玩法/);
  const personal = page({ schemaVersion: 1 }); assert.equal(personal.toggleThemeReplay(e({}, true)), true); assert.equal(JSON.parse(personal._runtimePayload()).replayEnabled, true); assert.equal(Object.hasOwn(JSON.parse(personal._runtimePayload()), 'gameplayRuntime'), false);
});
test('旧配置的引用错误不卡住结果卡保存，但发布前整体校验仍拦下', () => {
  const c = built(); c.gameplayRuntime.survival.rations[0].actKey = 'removed';
  assert.match(survival.validate(c), /幕已删除/);
  const p = page(c); p.openSurvivalEditor(); p.toggleSurvivalCardField(e({ value: 'medals' })); assert.equal(p.saveSurvivalEditor(), true);
  assert.equal(JSON.parse(p._runtimePayload()).gameplayRuntime.survival.rations[0].actKey, 'removed');
});
test('校验：数量、次数、幕引用、物品种类、节点与公共世界边界', () => {
  const c = built(); assert.match(survival.validate(c, undefined, { stateEnabled: false, hp: { enabled: false } }), /请先开启体力/); c.gameplayRuntime.survival.recoveries[0].limit = 100; assert.match(survival.validate(c), /次数/);
  c.gameplayRuntime.survival.recoveries[0].limit = 2; c.gameplayRuntime.survival.rations[0].quantity = 0; assert.match(survival.validate(c), /配给数量/);
  c.gameplayRuntime.survival.rations[0].quantity = 2; c.gameplayRuntime.survival.rations[0].actKey = 'removed'; assert.match(survival.validate(c), /幕已删除/);
  const d = built(); d.items.push({ id: 'medal', kind: 'MEDAL', name: '纪念章' }); d.gameplayRuntime.survival.rations[0].itemId = 'medal'; assert.match(survival.validate(d), /配给物品/);
  const f = built(); assert.equal(survival.validate(f, [{ value: 101 }, { value: 102 }]), ''); assert.match(survival.validate(f, []), /保存主题/);
  f.gameplayRuntime.worldMode = 'TEAM_INDEPENDENT'; assert.match(survival.validate(f), /公共世界/);
  assert.equal(survival.key([{ k: 'facility_1' }], 'k', 'facility_'), 'facility_2');
});
test('复制保留恢复/配给/费用/奖励/结果卡，移除真实节点引用且告知作者', () => {
  const c = built(), notices = []; const recovery = structuredClone(c.gameplayRuntime.survival), card = structuredClone(c.card);
  survival.copyReferences(c, notices); assert.deepEqual(c.gameplayRuntime.survival, recovery); assert.deepEqual(c.card, card); assert.deepEqual(notices, ['设施1操作与前置节点']);
  assert.equal(Object.hasOwn(c.gameplayRuntime.facilities[0], 'operationNodeId'), false); assert.deepEqual(c.gameplayRuntime.facilities[0].when.map(w => w.op), ['ITEM_HELD', 'GTE']);
  assert.equal(survival.validate(c, []), ''); const source = fs.readFileSync(path.join(__dirname, '../../pages/publish/fabu/index.js'), 'utf8'); assert.match(source, /survivalEditor.copyReferences\(runtime, reselect\)/);
});
test('删幕保留费用与效果，恢复的未解决引用不能变成全幕，作者可明确重选', () => {
  const c = built(), recovery = structuredClone(c.gameplayRuntime.survival.recoveries[0]);
  const notices = survival.pruneActRefs(c, ['act_one']);
  assert.equal(notices.length, 3); assert.ok(notices.every(n => /引用的幕已删除，请重新选择/.test(n)));
  assert.equal(Object.hasOwn(c.gameplayRuntime.facilities[0], 'actKey'), false); assert.equal(c.gameplayRuntime.facilities[0].hpDelta, 2);
  assert.equal(Object.hasOwn(c.gameplayRuntime.survival.rations[0], 'actKey'), false); assert.equal(c.gameplayRuntime.survival.rations[0].quantity, 2);
  assert.deepEqual(c.gameplayRuntime.survival.recoveries[0], recovery); c.gameplayRuntime.acts = [{ actKey: 'new_act' }];
  assert.match(survival.validate(c), /引用的幕已删除/);
});
test('表单入口和原生接线、无开发标识或不支持场景开关', () => {
  const wxml = fs.readFileSync(path.join(__dirname, '../../pages/publish/fabu/survival-editor.wxml'), 'utf8');
  assert.doesNotMatch(wxml, /recoveryKey|rationKey|facilityKey|settlementSlot|allowReplay|<picker|editSurvivalRow|commitSurvivalRow|backSurvivalList/);
  for (const control of wxml.matchAll(/<view\b[^>]*bindtap=[^>]*>/g)) { assert.match(control[0], /hover-class="cy-pressed"/); assert.match(control[0], /hover-stay-time="80"/); }
  const detail = fs.readFileSync(path.join(__dirname, '../../pages/publish/fabu/topic-detail-sheet.wxml'), 'utf8');
  assert.match(detail, /data-section="card" bindtap="openSurvivalEditor"/);
  for (const gone of ['editSurvivalRow', 'backSurvivalList', 'commitSurvivalRow', 'pickRecoveryKind', 'toggleRecoveryAct', 'toggleSurvivalReplay', 'editSurvivalCondition']) assert.equal(survival.methods[gone], undefined, gone);
});
