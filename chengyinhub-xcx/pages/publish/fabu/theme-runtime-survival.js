// 兼容旧恢复/配给/设施配置；新作者路径归属模板效果与章节。
const toast = require('../../../utils/toast.js');
const initial = require('../utils/publish/story-initial-state.js');
const clone = value => JSON.parse(JSON.stringify(value));
const CARD_FIELDS = ['scene', 'ending', 'hp', 'luck', 'actions', 'medals', 'items', 'story', 'rescue'];
const TARGETS = [{ value: 'OWNER', label: '本队 / 本人' }, { value: 'PARTICIPANTS', label: '选择参与队伍' }, { value: 'WORLD', label: '全场队伍' }];
const OPS = [{ value: 'EQ', label: '等于' }, { value: 'NE', label: '不等于' }, { value: 'GT', label: '大于' }, { value: 'GTE', label: '至少' }, { value: 'LT', label: '小于' }, { value: 'LTE', label: '至多' }, { value: 'ITEM_HELD', label: '持有物品' }, { value: 'ITEM_ACQUIRED', label: '曾获得物品' }, { value: 'NODE_COMPLETED', label: '已完成节点' }];
const integer = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
function key(rows, field, prefix) { let n = 1; while (rows.some(row => row[field] === prefix + n)) n++; return prefix + n; }
function validate(c, nodes, rules) {
  const game = c.gameplayRuntime || {}, survival = game.survival || {};
  if (Object.prototype.hasOwnProperty.call(survival, 'consumeOnNoEffect') && typeof survival.consumeOnNoEffect !== 'boolean') return '无效果消耗策略请选择开启或关闭';
  const acts = new Set((game.acts || []).map(row => row.actKey));
  if (rules && (!rules.stateEnabled || !rules.hp.enabled) && ((survival.recoveries || []).length || (survival.rations || []).some(r => r.fallbackHpCost > 0) || (game.facilities || []).some(f => f.hpDelta))) return '请先开启' + (c.hpName || '生命值') + '，再配置恢复或数值消耗';
  const items = new Set((c.items || []).filter(row => row.kind === 'ITEM').map(row => row.id));
  if ((survival.recoveries || []).length > 20) return '休整与救助合计最多 20 项';
  if ((survival.rations || []).length > 200) return '配给最多 200 项';
  for (const [field, id] of [['recoveries', 'recoveryKey'], ['rations', 'rationKey']]) {
    const rows = survival[field] || [];
    if (new Set(rows.map(row => row[id])).size !== rows.length || rows.some(row => !/^[a-z][a-z0-9_]{0,31}$/.test(row[id] || ''))) return '恢复或配给记录重复，请重新添加';
  }
  for (const row of survival.recoveries || []) {
    if (!['REST', 'RESCUE'].includes(row.kind) || !integer(row.limit, 1, 99)) return '恢复次数须为 1 到 99 的整数';
    if (!integer(row[row.kind === 'REST' ? 'hpDelta' : 'hpFloor'], 1, 999) || row[row.kind === 'REST' ? 'hpFloor' : 'hpDelta'] != null) return '休整增加值或救助恢复下限须为 1 到 999 的整数';
    if ((row.actKeys || []).some(k => !acts.has(k)) || new Set(row.actKeys || []).size !== (row.actKeys || []).length) return '引用的幕已删除或重复，请重新选择';
  }
  for (const row of survival.rations || []) {
    if (!acts.has(row.actKey)) return '引用的幕已删除，请重新选择';
    if (!items.has(row.itemId)) return '请选择主题中的配给物品';
    if (!integer(row.quantity, 1, 999) || (row.fallbackHpCost != null && !integer(row.fallbackHpCost, 0, 999))) return '配给数量须为 1 到 999，物品不足时消耗须为 0 到 999 的整数';
    if (row.fallback) {
      if (!integer(row.fallback.amount, 0, 999)) return '物品不足时减少的数值须为 0 到 999 的整数';
      if (rules && !(rules.attributes || []).some(attr => attr.key === row.fallback.statKey)) return '章末配给扣减的数值已不存在，请重新选择';
    }
  }
  if ((game.facilities || []).length > 100) return '设施最多 100 项';
  if (c.replayEnabled === true && game.runtimeScope === 'TEAM') return '队伍玩法不支持个人重玩，请关闭再玩一次';
  for (const row of game.facilities || []) {
    if (!acts.has(row.actKey)) return '引用的幕已删除，请重新选择';
    if (!integer(row.limit, 1, 99)) return '设施次数须为 1 到 99 的整数';
    if (!['OWNER', 'WORLD'].includes(row.scope) || (row.scope === 'WORLD' && game.worldMode !== 'WORLD_SHARED')) return '全场共用次数仅适用于公共世界';
    if (!TARGETS.some(option => option.value === row.targetScope)) return '请选择设施作用对象';
    if (row.targetScope !== 'OWNER' && game.worldMode !== 'WORLD_SHARED') return '多人设施仅适用于公共世界';
    if (row.targetScope === 'PARTICIPANTS' && (game.quests || []).some(q => q.facilityKey === row.facilityKey)) return '参与队伍设施不能绑定单队任务';
    if (row.hpDelta != null && !integer(row.hpDelta, -999, 999)) return '设施增减值须为负 999 到 999 的整数';
    if (row.arrivalLocationKey && !/^[a-z][a-z0-9_]{0,31}$/.test(row.arrivalLocationKey)) return '请选择有效的到场节点';
    if (row.arrivalLocationKey && game.runtimeScope === 'PLAYER') return '个人玩法不支持工作人员到场核验';
    if (row.operationNodeId != null && (!integer(row.operationNodeId, 1, Number.MAX_SAFE_INTEGER) || (nodes && !nodes.some(n => n.value === row.operationNodeId)))) return '请先保存主题与节点，再选择设施操作节点';
    if ((row.when || []).length > 30) return '设施前置条件最多 30 项';
    for (const condition of row.when || []) {
      if (['ITEM_HELD', 'ITEM_ACQUIRED'].includes(condition.op)) {
        if (!(c.items || []).some(i => i.id === condition.itemId) || !integer(condition.quantity, 1, 999)) return '请选择前置物品，数量须为 1 到 999 的整数';
      } else if (condition.op === 'NODE_COMPLETED') {
        if (!integer(condition.nodeId, 1, Number.MAX_SAFE_INTEGER) || (nodes && !nodes.some(n => n.value === condition.nodeId))) return '请先保存主题与前置节点，再选择';
      } else if (!OPS.slice(0, 6).some(op => op.value === condition.op) || !/^(sys\.(hp|luck|actions)|(clue|relation|counter)\.[a-z][a-z0-9_]{0,47})$/.test(condition.var || '') || !integer(condition.value, -999999, 999999)) return '请选择前置数值，比较值须为负 999999 到 999999 的整数';
    }
  }
  if (c.card) {
    if (c.card.cover && !/^https:\/\/[^\s]{1,492}$/.test(c.card.cover)) return '请上传有效的结果卡封面';
    if ((c.card.fields || []).some(field => !CARD_FIELDS.includes(field))) return '请选择支持的结果卡内容';
  }
  return '';
}
function apply(base, draft, dirty) {
  const out = clone(base);
  for (const field of ['recoveries', 'rations']) if (dirty[field]) {
    const rows = draft.gameplayRuntime.survival[field];
    if (rows.length) {
      out.gameplayRuntime = out.gameplayRuntime || { runtimeScope: 'PLAYER' };
      out.gameplayRuntime.survival = out.gameplayRuntime.survival || {};
      out.gameplayRuntime.survival[field] = clone(rows);
    } else if (out.gameplayRuntime && out.gameplayRuntime.survival) delete out.gameplayRuntime.survival[field];
  }
  if (dirty.facilities) out.gameplayRuntime.facilities = clone(draft.gameplayRuntime.facilities);
  if (dirty.replayEnabled) out.replayEnabled = draft.replayEnabled;
  if (dirty.card) { if (draft.card) out.card = clone(draft.card); else delete out.card; }
  return out;
}
function copyReferences(c, notices) {
  for (const [i, facility] of ((c.gameplayRuntime || {}).facilities || []).entries()) {
    let changed = false;
    if (facility.operationNodeId != null) { delete facility.operationNodeId; changed = true; }
    const when = (facility.when || []).filter(row => row.op !== 'NODE_COMPLETED');
    if (when.length !== (facility.when || []).length) { facility.when = when; changed = true; }
    if (changed) notices.push('设施' + (i + 1) + '操作与前置节点');
  }
}
// 删除幕后保留规则内容；恢复的空幕集合代表全幕，不能自动清空适用范围。
function pruneActRefs(runtime, removedActKeys) {
  const removed = new Set(removedActKeys || []), game = runtime.gameplayRuntime || {}, notices = [];
  (game.facilities || []).forEach((row, i) => { if (removed.has(row.actKey)) { delete row.actKey; notices.push('设施' + (i + 1) + '：引用的幕已删除，请重新选择'); } });
  ((game.survival || {}).rations || []).forEach((row, i) => { if (removed.has(row.actKey)) { delete row.actKey; notices.push('配给' + (i + 1) + '：引用的幕已删除，请重新选择'); } });
  ((game.survival || {}).recoveries || []).forEach((row, i) => { if ((row.actKeys || []).some(k => removed.has(k))) notices.push((row.kind === 'REST' ? '休整' : '救助') + (i + 1) + '：引用的幕已删除，请重新选择'); });
  return notices;
}
// L03-108:编辑层只剩结果卡(主题详情「结果卡」一个入口);旧恢复/配给/设施配置不再有编辑入口,保存时原样保留并照常校验
const data = { survivalEditor: { show: false, section: '', kind: '', index: -1, row: null, error: '' }, themeReplayEnabled: false, themeReplayError: '', themeTeamTrail: true, survivalSummary: { cardText: '默认' }, survivalCardFields: [] };
const methods = {
  _pruneSurvivalActRefs: pruneActRefs,
  _refreshSurvivalSummary(c = this._runtimeConfig()) {
    this.setData({ themeReplayEnabled: c.replayEnabled === true, themeTeamTrail: c.teamTrail === true || (c.teamTrail !== false && ((c.gameplayRuntime || {}).runtimeScope) !== 'PLAYER'), survivalSummary: { cardText: c.card ? '已自定义' : '默认' } });
  },
  openSurvivalEditor() {
    const c = this._runtimeConfig();
    this._survivalDraft = clone(c); this._survivalDirty = {}; this._survivalCardReset = false;
    const row = clone(c.card || {});
    const labels = ['场景', '结局', c.hpName || '生命值', c.luckName || '幸运值', c.actionName || '行动次数', '勋章', '物品', '故事', '救助记录'];
    this.setData({ survivalEditor: { show: true, section: 'card', kind: 'card', index: -1, row, customized: !!c.card, error: '' },
      survivalCardFields: CARD_FIELDS.map((value, i) => ({ value, label: labels[i], checked: (row.fields || []).includes(value) })) });
  },
  closeSurvivalEditor() { this._survivalDraft = null; this.setData({ survivalEditor: { show: false, section: '', kind: '', index: -1, row: null, error: '' } }); },
  _setSurvivalRow(row) {
    this._survivalCardReset = false;
    this.setData({ 'survivalEditor.row': row, 'survivalEditor.error': '',
      survivalCardFields: this.data.survivalCardFields.map(field => Object.assign({}, field, { checked: (row.fields || []).includes(field.value) })) });
  },
  clearSurvivalField(e) { const row = clone(this.data.survivalEditor.row); delete row[e.currentTarget.dataset.field]; this._setSurvivalRow(row); },
  toggleSurvivalCardField(e) {
    const field = e.currentTarget.dataset.value, row = clone(this.data.survivalEditor.row), fields = row.fields || [];
    row.fields = fields.includes(field) ? fields.filter(f => f !== field) : fields.concat(field); this._setSurvivalRow(row);
  },
  toggleSurvivalCardUnlocks(e) { this.setData({ 'survivalEditor.row.showUnlocks': e.detail.value === true }); },
  uploadSurvivalCover() { getApp().chooseImage(res => { if (this.data.survivalEditor.show && this.data.survivalEditor.kind === 'card' && res[0]) this.setData({ 'survivalEditor.row.cover': res[0] }); }, 1, { crop: true, cropScale: '1:1' }); },
  toggleThemeReplay(e) {
    const c = this._runtimeConfig(), value = e.detail.value === true;
    if (value && (c.gameplayRuntime || {}).runtimeScope === 'TEAM') { const error = '队伍玩法不支持个人重玩，请关闭再玩一次'; this.setData({ themeReplayError: error, themeReplayEnabled: c.replayEnabled === true }); toast.error(error); return false; }
    c.replayEnabled = value; this._saveRuntime(c);
    this.setData({ themeReplayEnabled: value, themeReplayError: '' }); return true;
  },
  toggleThemeTeamTrail(e) {
    const c = this._runtimeConfig(), value = e.detail.value === true;
    // 个人独立进行的单人主题默认关:作者打开要明写 true;队伍玩法默认开,开 = 不写
    if (value && (c.gameplayRuntime || {}).runtimeScope === 'PLAYER') c.teamTrail = true;
    else if (value) delete c.teamTrail; else c.teamTrail = false;
    this._saveRuntime(c);
    this.setData({ themeTeamTrail: value }); return true;
  },
  // 恢复默认结果卡:清空本次编辑,完成时删除 card;删除后再改任一项则按新卡保存
  removeSurvivalRow() {
    this.setData({ 'survivalEditor.customized': false }); this._setSurvivalRow({}); this._survivalCardReset = true;
  },
  saveSurvivalEditor() {
    const draft = clone(this._survivalDraft), row = this.data.survivalEditor.row || {};
    if ((this._survivalCardReset || !this._survivalDraft.card) && !Object.keys(row).length) delete draft.card; else draft.card = clone(row);
    // 没改就不算编辑(不写草稿)
    if (JSON.stringify(draft.card) !== JSON.stringify(this._survivalDraft.card)) this._survivalDirty.card = true;
    // 只验结果卡本身(同旧「单项提交」);旧恢复/配给/设施已无编辑入口,由发布前整体校验兜底,不卡住结果卡保存
    const c = apply(this._runtimeConfig(), draft, this._survivalDirty), check = clone(c), game = check.gameplayRuntime;
    if (game) { game.facilities = []; if (game.survival) { game.survival.recoveries = []; game.survival.rations = []; } }
    delete check.replayEnabled;
    const issue = validate(check, undefined, initial.parse(this.data.formData.journeyRules));
    if (issue) { this.setData({ 'survivalEditor.error': issue }); return false; }
    this._survivalCardReset = false;
    if (Object.keys(this._survivalDirty).length) this._saveRuntime(c);
    this._refreshSurvivalSummary(c); this.closeSurvivalEditor(); return true;
  },
};
module.exports = { data, methods, validate, apply, key, copyReferences, pruneActRefs, CARD_FIELDS };
