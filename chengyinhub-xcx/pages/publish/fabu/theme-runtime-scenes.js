const initial = require('../utils/publish/story-initial-state.js');
const advanced = require('../utils/publish/advanced-game-config.js');
const { memberId } = require('../../../utils/session/login-reload.js');
const app = getApp();
const clone = value => JSON.parse(JSON.stringify(value));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const integer = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;
function syncCommon(previous, next) {
  for (const scene of next.scenes || []) {
    const game = scene.gameplayRuntime;
    if (!game) continue;
    const before = previous.gameplayRuntime || {}, after = next.gameplayRuntime || {};
    for (const field of ['survival']) if (!same(before[field], after[field])) {
      // 主题级恢复设置适用于每个场景，场景题目、路线与人物条件仍各自保留。
      game[field] = clone(after[field] || {});
    }
    for (const quest of game.quests || []) {
      const old = (before.quests || []).find(row => row.nodeId === quest.nodeId);
      const changed = (after.quests || []).find(row => row.nodeId === quest.nodeId);
      if (!old || !changed) continue;
      for (const field of ['locationKey', 'guideKey', 'approvedFallbackNodeIds']) if (!same(old[field], changed[field])) {
        if (changed[field] === undefined) delete quest[field]; else quest[field] = clone(changed[field]);
      }
    }
  }
  return next;
}
function validate(config, rules) {
  if (config.hpCostFloor != null && !integer(config.hpCostFloor, 0, 999)) return '最低保暖消耗须为0至999的整数';
  for (const scene of config.scenes || []) {
    for (const quest of scene.gameplayRuntime?.quests || []) {
      for (const field of ['hpCost', 'actionCost']) if (quest[field] != null && !integer(quest[field], 0, 999)) return '站点消耗须为0至999的整数';
      for (const choice of quest.choices || []) {
        if (choice.hpDelta != null && !integer(choice.hpDelta, -999, 999)) return '取暖增减值须为负999至999的整数';
        if ((choice.grants || []).some(row => !integer(row.quantity, 1, 99))) return '奖励数量须为1至99的整数';
      }
    }
    for (const recovery of scene.gameplayRuntime?.survival?.recoveries || []) {
      if (!integer(recovery.limit, 1, 99)) return '救援次数须为1至99的整数';
      if (recovery.kind === 'RESCUE' && (!integer(recovery.hpFloor, 1, 999) || recovery.hpFloor > rules.hp.max)) return '救援恢复值须大于0，且不超过保暖上限';
    }
  }
  return '';
}
const data = { runtimeScenes: [], runtimeSceneEditor: { show: false, index: 0, error: '' }, runtimeSceneRows: [], runtimeSceneRecoveries: [] };
const methods = {
  _refreshRuntimeScenes(c = this._runtimeConfig()) {
    this.setData({ runtimeScenes: (c.scenes || []).map(row => ({ id: row.id, name: row.name })) });
  },
  openRuntimeScenes() {
    this._sceneDraft = this._runtimeConfig(); this._sceneBase = clone(this._sceneDraft); this._sceneOwner = memberId(app);
    this.setData({ runtimeSceneEditor: { show: true, index: 0, error: '' } }); this._refreshRuntimeScene();
  },
  closeRuntimeScenes() { this._sceneDraft = null; this.setData({ 'runtimeSceneEditor.show': false }); },
  chooseRuntimeScene(e) { this.setData({ 'runtimeSceneEditor.index': Number(e.detail.value), 'runtimeSceneEditor.error': '' }); this._refreshRuntimeScene(); },
  _refreshRuntimeScene() {
    const config = this._sceneDraft, scene = config?.scenes?.[this.data.runtimeSceneEditor.index]; if (!scene) return;
    const nodes = (this.data.formData.chapters || []).flatMap(row => row.nodes || []);
    this.setData({ runtimeSceneRows: (scene.gameplayRuntime?.quests || []).map((quest, index) => ({ ...clone(quest), index,
      name: nodes.find(row => Number(row.id) === quest.nodeId)?.name || '站点' + (index + 1),
      choices: (quest.choices || []).map(choice => ({ ...clone(choice), grants: (choice.grants || []).map(row => ({ ...row, name: config.items.find(item => item.id === row.itemId)?.name || row.itemId })) })) })),
      runtimeSceneRecoveries: clone(scene.gameplayRuntime?.survival?.recoveries || []) });
  },
  onRuntimeSceneNumber(e) {
    const d = e.currentTarget.dataset, scene = this._sceneDraft?.scenes?.[this.data.runtimeSceneEditor.index]; if (!scene) return;
    const text = String(e.detail.value).trim(), value = /^-?\d+$/.test(text) ? Number(text) : text;
    if (d.recovery != null) {
      if (!['hpFloor', 'limit'].includes(d.field)) return;
      const row = scene.gameplayRuntime?.survival?.recoveries?.[Number(d.recovery)]; if (row) row[d.field] = value;
    } else {
      const quest = scene.gameplayRuntime?.quests?.[Number(d.quest)]; if (!quest) return;
      if (d.choice != null) {
        const choice = quest.choices?.[Number(d.choice)]; if (!choice) return;
        if (d.grant != null) { const row = choice.grants?.[Number(d.grant)]; if (row && d.field === 'quantity') row.quantity = value; }
        else if (d.field === 'hpDelta') choice.hpDelta = value;
      } else if (['hpCost', 'actionCost'].includes(d.field)) quest[d.field] = value;
    }
    this.setData({ 'runtimeSceneEditor.error': '' }); this._refreshRuntimeScene();
  },
  editRuntimeSceneGame(e) {
    const draft = this._sceneDraft, scene = draft?.scenes?.[this.data.runtimeSceneEditor.index], nodeId = String(e.currentTarget.dataset.node);
    if (!scene?.nodeConfigs?.[nodeId]) return;
    const owner = this._sceneOwner, sceneId = scene.id, config = clone(scene.nodeConfigs[nodeId]);
    const row = this.data.runtimeSceneRows.find(row => String(row.nodeId) === nodeId);
    wx.navigateTo({ url: '/pages/publish/temp/index?from=fabu&scene=1',
      events: { sceneGameChanged: value => {
        if (this._sceneDraft !== draft || !this.data.runtimeSceneEditor.show || memberId(app) !== owner) return;
        const parsed = advanced.parse(value); const issue = parsed.error || advanced.validate(parsed.value);
        if (issue) return this.setData({ 'runtimeSceneEditor.error': issue });
        const current = draft.scenes.find(row => row.id === sceneId);
        if (current?.nodeConfigs?.[nodeId]) current.nodeConfigs[nodeId] = clone(parsed.value);
      } },
      success: res => res.eventChannel.emit('sceneGame', { title: row?.name || '场景玩法', advancedConfigJson: JSON.stringify(config), validationMethod: 4 }) });
  },
  saveRuntimeScenes() {
    if (!this._sceneDraft || memberId(app) !== this._sceneOwner) return;
    const current = this._runtimeConfig();
    if (!same(current.scenes, this._sceneBase.scenes)) return this.setData({ 'runtimeSceneEditor.error': '场景已发生变化，请退出后重新打开' });
    const issue = validate(this._sceneDraft, initial.parse(this.data.formData.journeyRules));
    if (issue) return this.setData({ 'runtimeSceneEditor.error': issue });
    current.scenes = clone(this._sceneDraft.scenes); this._saveRuntime(current); this.closeRuntimeScenes();
  },
};
module.exports = { syncCommon, validate, data, methods };
