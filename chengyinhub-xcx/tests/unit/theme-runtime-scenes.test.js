const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let owner = '7', navigation;
const requests = [], app = { globalData: {}, getUserID: () => owner, getAuthorization: () => '', sendRequest: row => requests.push(row) };
global.getApp = () => app;
global.wx = { getStorageSync() {}, showToast() {}, getBackgroundAudioManager: () => ({ stop() {} }), navigateTo: row => { navigation = row; } };

const runtime = require('../../pages/publish/fabu/theme-runtime.js');
const advanced = require('../../pages/publish/utils/publish/advanced-game-config.js');
const clone = value => JSON.parse(JSON.stringify(value));

function makeScene(id, name, nodeOrder) {
  const quests = nodeOrder.map((nodeId, idx) => ({
    questKey: 'q_' + nodeId,
    nodeId,
    hpCost: 1,
    actionCost: 1,
    locationKey: 'loc_' + nodeId,
    choices: idx === 4
      ? [{ choiceKey: 'c_heat', label: '营地取暖', hpDelta: 3, grants: [] }]
      : [{ choiceKey: 'c_' + nodeId, label: '领取补给', grants: [{ itemId: 'ration', quantity: 1 }] }],
    prerequisites: idx === 0 ? [] : [{ type: 'QUEST_DONE', key: 'q_' + nodeOrder[0] }],
  }));
  return {
    id,
    name,
    nodeOrder,
    nodeConfigs: {
      '5': { schemaVersion: 1, stopwatch: { enabled: true, kicker: '校准', targetSeconds: 5, toleranceMs: 500, tries: 3, xp: 10 } },
    },
    gameplayRuntime: {
      quests,
      facilities: [{ facilityKey: 'f_' + id, nodeId: nodeOrder[0] }],
      survival: {
        recoveries: [{ recoveryKey: 'rec_1', kind: 'RESCUE', title: '应急救援', limit: 2, hpFloor: 4 }],
      },
    },
  };
}

const pack = {
  schemaVersion: 1,
  capacity: 14,
  items: [{ id: 'ration', name: '口粮', kind: 'ITEM', slotCost: 1, image: 'https://example.com/r.png' }],
  gameplayRuntime: {
    quests: [{ questKey: 'q_1', nodeId: 1, locationKey: 'loc_1', guideKey: 'g_1' }],
    survival: {
      recoveries: [{ recoveryKey: 'rec_1', kind: 'RESCUE', title: '应急救援', limit: 2, hpFloor: 4 }],
    },
  },
  scenes: [
    makeScene('park', '静安雕塑公园', [1, 2, 3, 4, 5]),
    makeScene('campus', '大学校园版', [2, 3, 4, 5, 1]),
    makeScene('indoor', '室内商场版', [4, 5, 1, 2, 3]),
  ],
};

const rules = { hp: { enabled: true, init: 8, max: 10 }, luck: { enabled: false, init: 0, max: 0 } };

function mount(definition, data = {}) {
  const p = { ...definition, data: { ...clone(definition.data), ...data } };
  p.setData = function (patch, cb) {
    for (const [key, value] of Object.entries(patch)) {
      const fields = key.replace(/\[(\d+)\]/g, '.$1').split('.');
      let at = this.data;
      for (const field of fields.slice(0, -1)) at = at[field];
      at[fields.at(-1)] = value;
    }
    if (cb) cb();
  };
  return p;
}

function page() {
  owner = '7';
  return mount(
    { ...runtime.methods, data: runtime.data },
    {
      formData: {
        themeRuntimeConfig: JSON.stringify(pack),
        journeyRules: JSON.stringify(rules),
        chapters: [{ nodes: Array.from({ length: 7 }, (_, i) => ({ id: i + 1, name: '新地点' + (i + 1), address: '真实地点待选择' })) }],
      },
    },
  );
}

const event = (dataset, value) => ({ currentTarget: { dataset }, detail: { value } });

test('三场景独立调整站点消耗、奖励、取暖和救援，取消不写入，保存重开保留原路线和条件', () => {
  const p = page(), original = p.data.formData.themeRuntimeConfig;
  p.openRuntimeScenes(); p.chooseRuntimeScene({ detail: { value: 2 } });
  assert.equal(p.data.runtimeSceneRows[0].name, '新地点4');
  p.onRuntimeSceneNumber(event({ quest: 0, field: 'hpCost' }, '2'));
  p.onRuntimeSceneNumber(event({ quest: 0, choice: 0, grant: 0, field: 'quantity' }, '3'));
  p.onRuntimeSceneNumber(event({ quest: 4, choice: 0, field: 'hpDelta' }, '5'));
  p.onRuntimeSceneNumber(event({ recovery: 0, field: 'hpFloor' }, '6'));
  p.closeRuntimeScenes(); assert.equal(p.data.formData.themeRuntimeConfig, original);
  p.openRuntimeScenes(); p.chooseRuntimeScene({ detail: { value: 2 } });
  p.onRuntimeSceneNumber(event({ quest: 0, field: 'hpCost' }, '2'));
  p.onRuntimeSceneNumber(event({ quest: 0, choice: 0, grant: 0, field: 'quantity' }, '3'));
  p.onRuntimeSceneNumber(event({ recovery: 0, field: 'hpFloor' }, '6'));
  p.saveRuntimeScenes(); assert.equal(p.data.runtimeSceneEditor.show, false);
  const c = p._runtimeConfig();
  assert.equal(c.scenes[2].gameplayRuntime.quests[0].hpCost, 2);
  assert.equal(c.scenes[2].gameplayRuntime.quests[0].choices[0].grants[0].quantity, 3);
  assert.equal(c.scenes[2].gameplayRuntime.survival.recoveries[0].hpFloor, 6);
  assert.deepEqual(c.scenes[0], pack.scenes[0]);
  assert.deepEqual(c.scenes[1], pack.scenes[1]);
  assert.deepEqual(c.scenes[2].nodeOrder, pack.scenes[2].nodeOrder);
  assert.deepEqual(c.scenes[2].gameplayRuntime.facilities, pack.scenes[2].gameplayRuntime.facilities);
  assert.deepEqual(c.scenes[2].gameplayRuntime.quests[0].prerequisites, pack.scenes[2].gameplayRuntime.quests[0].prerequisites);
  p.openRuntimeScenes(); p.chooseRuntimeScene({ detail: { value: 2 } });
  assert.equal(p.data.runtimeSceneRecoveries[0].hpFloor, 6);
});

test('非法数字和超上限救援不能保存；切换身份、过期弹窗不能覆盖新草稿', () => {
  const p = page(), original = p.data.formData.themeRuntimeConfig;
  p.openRuntimeScenes();
  p.onRuntimeSceneNumber(event({ quest: 0, field: 'hpCost' }, '1.2')); p.saveRuntimeScenes();
  assert.match(p.data.runtimeSceneEditor.error, /整数/); assert.equal(p.data.formData.themeRuntimeConfig, original);
  p.onRuntimeSceneNumber(event({ quest: 0, field: 'hpCost' }, '1'));
  p.onRuntimeSceneNumber(event({ recovery: 0, field: 'hpFloor' }, '11')); p.saveRuntimeScenes();
  assert.match(p.data.runtimeSceneEditor.error, /上限/); assert.equal(p.data.formData.themeRuntimeConfig, original);
  p.onRuntimeSceneNumber(event({ recovery: 0, field: 'hpFloor' }, '5')); owner = '8'; p.saveRuntimeScenes();
  assert.equal(p.data.formData.themeRuntimeConfig, original);
  owner = '7'; const c = p._runtimeConfig(); c.scenes[0].name = '其它编辑'; p._saveRuntime(c); p.saveRuntimeScenes();
  assert.match(p.data.runtimeSceneEditor.error, /发生变化/);
});

test('修改主题通用恢复和到达地点会同步三个场景，不冲掉场景路线、题目和专属选择', () => {
  const p = page(), c = p._runtimeConfig();
  c.gameplayRuntime.survival.recoveries[0].hpFloor = 5;
  c.gameplayRuntime.quests[0].locationKey = 'new_store';
  p._saveRuntime(c);
  for (let i = 0; i < 3; i++) {
    const scene = p._runtimeConfig().scenes[i];
    assert.equal(scene.gameplayRuntime.survival.recoveries[0].hpFloor, 5);
    assert.equal(scene.gameplayRuntime.quests.find(q => q.nodeId === 1).locationKey, 'new_store');
    assert.deepEqual(scene.nodeOrder, pack.scenes[i].nodeOrder);
    assert.deepEqual(scene.nodeConfigs, pack.scenes[i].nodeConfigs);
    assert.deepEqual(scene.gameplayRuntime.facilities, pack.scenes[i].gameplayRuntime.facilities);
  }
});

test('复用真实玩法编辑器回填并修改场景题目，不写独立玩法，不改其它场景；取消后的回调失效', () => {
  const p = page(); p.openRuntimeScenes(); p.editRuntimeSceneGame(event({ node: 5 }));
  assert.match(navigation.url, /from=fabu&scene=1/);
  let received;
  navigation.success({ eventChannel: { emit: (name, value) => { assert.equal(name, 'sceneGame'); received = value; } } });
  let definition; global.Page = value => { definition = value; };
  require('../../pages/publish/temp/index.js');
  const game = mount(definition); game.data.from = 'fabu'; game._themeSceneEditor = true;
  game.fillFormWithTemplateData(received);
  game.data.advanced.stopwatch.targetSeconds = 7; game.data.advanced.stopwatch.toleranceMs = 800;
  game.getOpenerEventChannel = () => ({ emit: (name, value) => { assert.equal(name, 'sceneGameChanged'); navigation.events.sceneGameChanged(value); } });
  let exited = false; game.exitPage = () => { exited = true; }; requests.length = 0; game.publishGame();
  assert.equal(exited, true, JSON.stringify(game.data.errors)); assert.equal(requests.length, 0);
  p.saveRuntimeScenes(); const saved = p._runtimeConfig();
  assert.equal(saved.scenes[0].nodeConfigs['5'].stopwatch.targetSeconds, 7);
  assert.equal(saved.scenes[0].nodeConfigs['5'].stopwatch.toleranceMs, 800);
  assert.deepEqual(saved.scenes[1], pack.scenes[1]);
  p.openRuntimeScenes(); p.editRuntimeSceneGame(event({ node: 5 }));
  const callback = navigation.events.sceneGameChanged; p.closeRuntimeScenes();
  callback(advanced.serialize(game.data.advanced));
  assert.equal(p._runtimeConfig().scenes[0].nodeConfigs['5'].stopwatch.targetSeconds, 7);
});

test('场景编辑器热重载失去返回通道时明确提示，不空屏或发送独立玩法写入', () => {
  owner = '7'; let definition; global.Page = value => { definition = value; };
  delete require.cache[require.resolve('../../pages/publish/temp/index.js')];
  require('../../pages/publish/temp/index.js');
  global.wx.getWindowInfo = () => ({ windowWidth: 375, windowHeight: 800, statusBarHeight: 20 });
  const game = mount(definition); game._loadSupportMatrix = () => {}; game.getOpenerEventChannel = () => undefined;
  requests.length = 0; game.onLoad({ from: 'fabu', scene: '1' });
  assert.match(game.data.loadError, /从主题场景重新打开/); assert.equal(requests.length, 0);
});

test('场景调节入口、节点换地点与模板采用保持实际页面链路', () => {
  const root = path.resolve(__dirname, '../../pages');
  assert.match(fs.readFileSync(path.join(root, 'publish/fabu/topic-detail-sheet.wxml'), 'utf8'), /bindtap="openRuntimeScenes"/);
  assert.match(fs.readFileSync(path.join(root, 'publish/fabu/index.wxml'), 'utf8'), /include src="runtime-scenes-editor.wxml"/);
  assert.match(fs.readFileSync(path.join(root, 'templatedetail/utils/topic-use-flow.js'), 'utf8'), /\/api\/template\/topic-template\/use/);
});
