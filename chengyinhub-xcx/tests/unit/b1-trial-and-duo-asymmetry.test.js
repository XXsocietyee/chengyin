'use strict';
// §3.2 Item 3 (第 1 站免费试玩 → 第 2 站剧内解锁) & Item 4 (自玩双人真不对称视角 + 常驻可折叠角色卡 + 全量逃生舱)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const topicMotion = require('../../pages/topic/utils/topic-motion.js');
const trialUnlock = require('../../pages/play/utils/trial-unlock.js');
const { roleCardView, duoRoleOptions, ESCAPE_LABEL, TEAM_FOOTER } = require('../../pages/play/utils/role-card-view.js');

test('主题详情页:仅未购线性自玩主题展示「免费试玩第 1 站」CTA', () => {
  assert.equal(topicMotion.canOfferFirstStationTrial({ selfPlay: 1, productType: 1 }, { isJoin: 0, priceText: '¥39' }), true);
  assert.equal(topicMotion.canOfferFirstStationTrial({ selfPlay: 1, productType: 1 }, { isJoin: 1, priceText: '¥39' }), false, '已购不显示试玩');
  assert.equal(topicMotion.canOfferFirstStationTrial({ selfPlay: 1, productType: 2 }, { isJoin: 0, priceText: '¥39' }), false, '自由探索不显示试玩');
  assert.equal(topicMotion.canOfferFirstStationTrial({ selfPlay: 0, productType: 1 }, { isJoin: 0 }), false, '非自玩不显示试玩');
  assert.equal(topicMotion.canOfferFirstStationTrial({ selfPlay: 1, productType: 1 }, { isJoin: 0, merchantClosed: true }), false, '打烊不显示试玩');
  assert.equal(topicMotion.canOfferFirstStationTrial({ selfPlay: 1, productType: 1, lifecycle: 1 }, { isJoin: 0 }), false, '未开售不显示试玩');

  const wxml = read('pages/topic/index/index.wxml');
  const js = read('pages/topic/index/index.js');
  assert.match(wxml, /class="hero-trial[\s\S]*?bindtap="onStartTrial"[\s\S]*?>免费试玩第 1 站<\/view>/);
  assert.match(js, /\/pages\/play\/index\?topicId='\s*\+\s*topicId\s*\+\s*'&trial=1/);
});

test('试玩第 2 站拦截与单人/双人解锁票种构造', () => {
  const s1 = { nodeId: 1001, trialStation: true, trialLocked: false };
  const s2 = { nodeId: 1002, trialLocked: true };
  assert.equal(trialUnlock.isTrialBlockedNode(s1, { trialMode: true, trialStationId: 1001 }), false);
  assert.equal(trialUnlock.isTrialBlockedNode(s2, { trialMode: true, trialStationId: 1001 }), true);
  assert.equal(trialUnlock.isTrialBlockedNode(s2, { trialMode: false, trialStationId: 1001 }), false);

  const opts = trialUnlock.buildTrialUnlockOptions({
    selfPlayPrice: 39,
    topicId: 88,
    products: [
      { productId: 501, seatCount: 2, cashPrice: 59, topicIds: [88] },
      { productId: 502, seatCount: 2, cashPrice: 49, topicIds: [99] },
    ],
  });
  assert.equal(opts.length, 2);
  assert.equal(opts[0].kind, 'single');
  assert.equal(opts[0].priceText, '¥39');
  assert.equal(opts[1].kind, 'product');
  assert.equal(opts[1].name, '双人同行票');
  assert.equal(opts[1].productId, 501);
  assert.equal(opts[1].priceText, '¥59');
  assert.equal(opts[1].perPersonText, '人均 ¥29.5');
});

test('角色卡视图:展示真实 otherRoleLabel + 搭档走散逃生舱 + 提取双人 3 秒视角选项', () => {
  const viewA = { roleId: 'A', label: '看实物', title: '实物清单', body: '门牌号', items: [] };
  const viewB = { roleId: 'B', label: '查档案', title: '档案摘录', body: '旧账本', items: [] };

  const teamCard = roleCardView({ role: 'A', roleLabel: '看实物', otherRoleLabel: '查档案', views: [viewA] });
  assert.equal(teamCard.mode, 'team');
  assert.equal(teamCard.otherRoleLabel, '查档案');
  assert.match(teamCard.partnerLine, /查档案/);
  assert.equal(teamCard.footer, TEAM_FOOTER);
  assert.equal(teamCard.escapeLabel, ESCAPE_LABEL);
  assert.equal(ESCAPE_LABEL, '搭档走散了？查看全量线索');

  const pickerOpts = duoRoleOptions({ role: 'SOLO', views: [viewA, viewB] });
  assert.deepEqual(pickerOpts.map((o) => o.id), ['A', 'B']);
  assert.deepEqual(pickerOpts.map((o) => o.label), ['看实物', '查档案']);
  assert.deepEqual(trialUnlock.buildDuoPickerOptions({ role: 'A', views: [viewA] }), []);
});

test('cy-role-card 组件:支持可折叠切换与 escapesolo 逃生事件', () => {
  let def = null;
  const prev = global.Component;
  global.Component = (d) => { def = d; };
  try {
    delete require.cache[require.resolve('../../pages/play/components/role-card/index.js')];
    require('../../pages/play/components/role-card/index.js');
  } finally {
    global.Component = prev;
  }
  const events = [];
  const inst = {
    data: Object.assign({}, def.data, { collapsible: true, collapsed: false }),
    setData(patch) { Object.assign(this.data, patch); },
    triggerEvent(name, detail, opts) { events.push({ name, detail, opts }); },
  };
  def.methods.toggleCollapse.call(inst);
  assert.equal(inst.data.collapsed, true);
  def.methods.toggleCollapse.call(inst);
  assert.equal(inst.data.collapsed, false);
  def.methods.onEscapeSolo.call(inst);
  assert.equal(events.length, 1);
  assert.equal(events[0].name, 'escapesolo');
  assert.equal(events[0].opts.bubbles, true);
});

test('游玩页集成:剧内 --lk-* 解锁底单 + 无缝 loadData(false) 续玩 + 谜题页常驻可折叠角色卡 + 3 秒视角选择', () => {
  const wxml = read('pages/play/index.wxml');
  const wxss = read('pages/play/index.wxss');
  const js = read('pages/play/index.js');

  assert.match(wxml, /class="trial-sheet \{\{lookClass\}\}"/);
  assert.match(wxml, /bindtap="onConfirmTrialUnlock"/);
  assert.match(wxml, /class="duo-sheet \{\{lookClass\}\}"/);
  assert.match(wxml, /bindtap="onPickDuoRole"/);
  assert.match(wxml, /<view class="gp2__role"[\s\S]*?<cy-role-card view="\{\{stationRole\.view\}\}" collapsible="\{\{true\}\}" bind:escapesolo="onRoleEscapeSolo"/);
  assert.match(wxml, /<view class="fx-story__role"[\s\S]*?<cy-role-card view="\{\{stationRole\.view\}\}" collapsible="\{\{true\}\}" bind:escapesolo="onRoleEscapeSolo"/);
  assert.match(wxss, /\.trial-sheet[\s\S]*?var\(--lk-pop/);
  assert.match(wxss, /\.trial-sheet__cta[\s\S]*?var\(--lk-a/);
  assert.match(js, /nodesParams\.trial\s*=\s*true/);
  assert.match(js, /if\s*\(d\.registered === false && !d\.leadSpectator && !d\.trialMode\)/);
  assert.match(js, /_completeTrialUnlock\(\)[\s\S]*?this\.loadData\(false\)/);
  assert.match(js, /if\s*\(this\._duoRoleHint\)\s*params\.roleHint\s*=\s*this\._duoRoleHint/);
  assert.match(js, /onRoleEscapeSolo\(\)[\s\S]*?this\._duoRoleHint\s*=\s*'SOLO'/);
});
