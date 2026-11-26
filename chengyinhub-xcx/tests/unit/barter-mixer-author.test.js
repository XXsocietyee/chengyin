// 以物换物(barter)与调音台(mixer):服务端与玩家端早已接通,作者端编辑器一直选不到、配不了。
// 这里钉住:目录可选 → 默认配置在册 → 往返不丢 → 本页校验与服务端同口径 → 先看再选不空白、不漏答案
// → 编辑页真有面板与处理函数 → 发布闸镜像放行。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const catalog = require('../../pages/publish/utils/publish/node-game-catalog.js');
const cfg = require('../../pages/publish/utils/publish/advanced-game-config.js');
const pv = require('../../pages/publish/utils/publish/advanced-game-preview.js');
const outcomeAfter = require('../../pages/publish/utils/publish/outcome-after.js');
const support = require('../../pages/publish/utils/publish/gameplay-support-matrix.js');
const matrix = require('./fixtures/gameplay-support-matrix.json').data;

const root = path.resolve(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const clone = (v) => JSON.parse(JSON.stringify(v));

/* 服务端 BarterGameplay.validate 与 AdvancedGameConfigValidator#validateMixer 的逐条镜像(只测形状)。 */
const ID = /^[A-Za-z0-9_-]{1,32}$/;
const ICONS = ['clip', 'coaster', 'labels', 'strap', 'parcel', 'tape', 'book', 'key', 'ticket', 'bag', 'cup', 'letter'];
function serverBarter(b) {
  const t = (v) => (typeof v === 'string' ? v.trim() : '');
  if (!t(b.title) || t(b.title).length > 40) return 'title';
  if (!Array.isArray(b.items) || b.items.length < 2 || b.items.length > 10) return 'items';
  const ids = new Set();
  for (const it of b.items) {
    if (!ID.test(t(it.id)) || ids.has(it.id)) return 'item id';
    ids.add(it.id);
    if (!t(it.name) || t(it.name).length > 8) return 'item name';
    if (it.icon != null && !ICONS.includes(it.icon)) return 'icon';
  }
  if (!Array.isArray(b.start) || b.start.length < 1 || b.start.length > 6 || b.start.some((s) => !ids.has(s))) return 'start';
  if (!Array.isArray(b.goals) || b.goals.length < 1 || b.goals.length > 3) return 'goals';
  const gids = new Set();
  for (const g of b.goals) {
    if (!ID.test(t(g.id)) || gids.has(g.id)) return 'goal id';
    gids.add(g.id);
    if (!t(g.label) || t(g.label).length > 10) return 'goal label';
    const need = g.need != null, keep = g.keep != null;
    if (need === keep) return 'need/keep';
    if (!ids.has(need ? g.need : g.keep)) return 'goal ref';
  }
  if (!Array.isArray(b.offers) || b.offers.length < 2 || b.offers.length > 6) return 'offers';
  const oids = new Set();
  for (const o of b.offers) {
    if (!ID.test(t(o.id)) || oids.has(o.id)) return 'offer id';
    oids.add(o.id);
    if (!t(o.key) || t(o.key).length > 2) return 'offer key';
    if (!ids.has(o.give) || !ids.has(o.get)) return 'offer ref';
    if (o.fb != null && (typeof o.fb !== 'string' || o.fb.length > 60)) return 'fb';
  }
  if (b.maxTries != null && !(Number.isInteger(b.maxTries) && b.maxTries >= 0)) return 'maxTries';
  if (b.xp != null && !(Number.isInteger(b.xp) && b.xp >= 0 && b.xp <= 1000)) return 'xp';
  return '';
}
function serverMixer(m) {
  const t = (v) => (typeof v === 'string' ? v.trim() : '');
  if (!t(m.title) || t(m.title).length > 40) return 'title';
  if (!Array.isArray(m.tracks) || m.tracks.length < 2 || m.tracks.length > 5) return 'tracks';
  const ids = new Set();
  let muted = false;
  for (const tr of m.tracks) {
    if (!ID.test(t(tr.id)) || ids.has(t(tr.id))) return 'track id';
    ids.add(t(tr.id));
    if (!t(tr.label) || t(tr.label).length > 6) return 'track label';
    if (tr.muted != null && typeof tr.muted !== 'boolean') return 'muted';
    muted = muted || tr.muted === true;
  }
  if (!muted) return 'no muted';
  if (!ids.has(t(m.answer))) return 'answer';
  for (const f of ['wrongReply']) if (m[f] != null && String(m[f]).length > 60) return f;
  for (const f of ['captionBefore', 'captionAfter']) if (m[f] != null && String(m[f]).length > 40) return f;
  if (m.maxTries != null && !(Number.isInteger(m.maxTries) && m.maxTries >= 0 && m.maxTries <= 10)) return 'maxTries';
  return '';
}

test('目录:以物换物与调音台在玩法单子里,选择器能看到,段名即玩法名', () => {
  for (const key of ['barter', 'mixer']) {
    const item = catalog.GROUPS.flatMap((g) => g.items).find((row) => row.key === key);
    assert.ok(item, key + ' 不在 GROUPS 里');
    assert.equal(item.section, key);
    assert.equal(item.validationMethod, 0);
    assert.equal(item.mode, undefined);
    assert.ok(catalog.PICKER_GROUPS.some((g) => g.items.some((row) => row.gameKey === key)), key + ' 选择器里看不到');
    assert.equal(catalog.selection(key).baseKey, key);
    assert.ok(catalog.GAME_SECTIONS.includes(key));
    assert.ok(catalog.PLAYKIT_SECTIONS.includes(key));
    assert.ok(!catalog.ENCOUNTER_SECTIONS.includes(key));
    // 这两屏不接限时条:不给作者一个不会执行的限时开关
    assert.equal(catalog.supportsTimer(key), false);
  }
  // Java 对拍:每条目录行在一行内,key 在前、section 在后(GameplaySupportMatrixTest 按行扫)
  const src = read('pages/publish/utils/publish/node-game-catalog.js');
  const groups = src.slice(src.indexOf('const GROUPS'), src.indexOf('const MODIFIERS'));
  for (const key of ['barter', 'mixer']) {
    assert.match(groups, new RegExp("\\{ key: '" + key + "',[^\\n]*section: '" + key + "', validationMethod: 0 \\},"));
  }
});

test('配置:默认配置在册,选中即开、换走即关,detectGame 认得回来', () => {
  const d = cfg.defaultConfig();
  for (const key of ['barter', 'mixer']) {
    assert.ok(cfg.SECTIONS.includes(key), key + ' 不在 SECTIONS');
    assert.equal(d[key].enabled, false);
    const on = catalog.applyToConfig(d, key);
    assert.equal(on[key].enabled, true);
    assert.equal(catalog.detectGame(on), key);
    const off = catalog.applyToConfig(on, 'sort');
    assert.equal(off[key].enabled, false);
    assert.equal(catalog.detectGame(off), 'sort');
  }
  // 与服务端 GameplayOutcomeRules.MAIN_GAMEPLAYS 同口径:两者都是主玩法,结果规则挂得上
  for (const key of ['barter', 'mixer']) assert.deepEqual(outcomeAfter.mains(catalog.applyToConfig(d, key)), [key]);
});

test('样例:DEMO 形状过服务端校验,往返 serialize/parse 不丢字段', () => {
  for (const key of ['barter', 'mixer']) {
    const demo = catalog.applyToConfig(cfg.defaultConfig(), key, { demo: true });
    const saved = JSON.parse(cfg.serialize(demo));
    assert.equal((key === 'barter' ? serverBarter : serverMixer)(saved[key]), '', key + ' DEMO 过不了服务端');
    const back = cfg.parse(JSON.stringify(saved)).value;
    assert.deepEqual(JSON.parse(cfg.serialize(back))[key], saved[key], key + ' 往返丢字段');
    assert.equal(catalog.detectGame(back), key);
  }
  // 只启用 barter 时 present 不被当成「没玩法」清掉
  const demo = catalog.applyToConfig(cfg.defaultConfig(), 'barter', { demo: true });
  demo.present = 'fullscreen';
  assert.equal(JSON.parse(cfg.serialize(demo)).present, 'fullscreen');
});

test('本页校验与服务端同口径:缺必填就拦下,文案说人话', () => {
  const base = catalog.applyToConfig(cfg.defaultConfig(), 'barter', { demo: true });
  const blank = clone(base); blank.barter.title = '';
  assert.match(cfg.validate(blank), /换物题标题不能为空/);
  const oneOffer = clone(base); oneOffer.barter.offers = oneOffer.barter.offers.slice(0, 1);
  assert.match(cfg.validate(oneOffer), /2 至 6 条换物/);
  const dangling = clone(base); dangling.barter.start = ['nope'];
  assert.match(cfg.validate(dangling), /不存在的物品/);
  const longName = clone(base); longName.barter.items[0].name = '一二三四五六七八九';
  assert.match(cfg.validate(longName), /不能超过 8 字/);
  assert.equal(cfg.validate(base), '');

  const mix = catalog.applyToConfig(cfg.defaultConfig(), 'mixer', { demo: true });
  assert.equal(cfg.validate(mix), '');
  const loud = clone(mix); loud.mixer.tracks.forEach((tr) => { tr.muted = false; });
  assert.match(cfg.validate(loud), /至少要有一条开局静音/);
  const noAnswer = clone(mix); noAnswer.mixer.answer = '';
  assert.match(cfg.validate(noAnswer), /答案必须是其中一条音轨/);
  // 采用公共库模板:answer 被投影剥掉,发布时服务端补回 —— 本页不拦
  assert.equal(cfg.validate(noAnswer, { adoptedFromLibrary: true }), '');
});

test('先看再选:预览不空白,且不带 fb / answer / wrongReply', () => {
  const b = pv.buildPreviewKit(catalog.applyToConfig(cfg.defaultConfig(), 'barter', { demo: true }));
  assert.equal(b.type, 'barter');
  assert.ok(b.title && b.items.length >= 2 && b.start.length && b.goals.length && b.offers.length >= 2);
  assert.ok(b.offers.every((o) => !('fb' in o)), '换物提示只在答错后由服务端回');
  assert.deepEqual(Object.keys(b.offers[0]).sort(), ['get', 'give', 'id', 'key']);
  const m = pv.buildPreviewKit(catalog.applyToConfig(cfg.defaultConfig(), 'mixer', { demo: true }));
  assert.equal(m.type, 'mixer');
  assert.ok(m.title && m.tracks.length >= 2);
  assert.ok(!('answer' in m) && !('wrongReply' in m));
  assert.ok(!JSON.stringify(m).includes('wrongReply'));
  for (const kit of [b, m]) assert.ok(pv.PREVIEW_PRIORITY.includes(kit.type));
});

test('编辑页:两块面板都在,绑定的处理函数真存在,可点元素带读屏与按压态', () => {
  const wxml = read('pages/publish/temp/index.wxml');
  const page = read('pages/publish/temp/index.js');
  const author = require('../../pages/publish/temp/barter-mixer-author.js');
  for (const key of ['barter', 'mixer']) {
    const start = wxml.indexOf("gameSection === '" + key + "'");
    assert.ok(start > 0, key + ' 面板缺失');
    const block = wxml.slice(start, wxml.indexOf('<view class="cg-gcfg"', start + 10));
    for (const m of block.matchAll(/bind(?:tap|input|change|:change)="([A-Za-z_]+)"/g)) {
      assert.ok(author.methods[m[1]] || new RegExp('\\n  ' + m[1] + ':? ?(function)? ?\\(').test(page) || page.includes('  ' + m[1] + ': function'), m[1] + ' 没有处理函数');
    }
    for (const tag of block.match(/<view[^>]*bindtap="[^"]+"[^>]*>/g) || []) {
      assert.match(tag, /aria-role="button"/, tag);
      assert.match(tag, /hover-class="cy-pressed"/, tag);
    }
  }
  assert.ok(page.includes('barterMixerAuthor.methods'), '处理函数没并进页面');
  // 次数上限与奖励分按主人定稿收进「高级设置 · 作答规则」,不在玩法设置里再放一份
  const layout = require('../../pages/publish/temp/editor-layout.js');
  for (const key of ['barter', 'mixer']) {
    assert.deepEqual(layout.answerRuleRows(cfg.defaultConfig(), key, {}).map((row) => row.key),
      [key + '.maxTries', key + '.xp']);
    assert.ok(!wxml.includes('advanced.' + key + '.xp'), key + ' 的奖励分在面板里重复了一份');
  }
});

test('编辑流:从空白起一路填到可存,结果过服务端校验', () => {
  const author = require('../../pages/publish/temp/barter-mixer-author.js');
  const notices = [];
  global.wx = Object.assign({}, global.wx, { showToast: (o) => notices.push(o.title) });
  const host = (section) => {
    const self = { data: { advanced: catalog.applyToConfig(cfg.defaultConfig(), section) } };
    self._setFormState = (patch) => { Object.entries(patch).forEach(([key, value]) => { const parts = key.split('.'); let at = self.data; parts.slice(0, -1).forEach((p) => { at = at[p]; }); at[parts.at(-1)] = value; }); };
    return Object.assign(self, author.methods);
  };
  const page = host('barter');
  const ev = (dataset, value) => ({ currentTarget: { dataset }, detail: { value } });
  page.data.advanced.barter.title = '换一张车票';
  page.bxItemAdd(); page.bxItemAdd();
  const now = Date.now; const rnd = Math.random; Date.now = () => 1700000000000; Math.random = () => 0;
  try {
    const again = host('barter'); again.bxItemAdd(); again.bxItemAdd();
    const added = again.data.advanced.barter.items.slice(-2).map((it) => it.id);
    assert.notEqual(added[0], added[1], '同一毫秒连加两件物品 id 不撞');
  } finally { Date.now = now; Math.random = rnd; }
  page.data.advanced.barter.items.forEach((it, i) => { it.name = ['回形针', '杯垫', '旧书', '车票'][i]; });
  assert.equal(page.data.advanced.barter.items.length, 4);
  page.bxStartPick(ev({ index: 0 }, 0));
  page.bxGoalItem(ev({ index: 0 }, 3));
  page.bxGoalKind(ev({ index: 0 }, 0));
  page.data.advanced.barter.goals[0].label = '换到车票';
  page.bxOfferPick(ev({ index: 0, side: 'give' }, 0)); page.bxOfferPick(ev({ index: 0, side: 'get' }, 1));
  page.bxOfferPick(ev({ index: 1, side: 'give' }, 1)); page.bxOfferPick(ev({ index: 1, side: 'get' }, 3));
  page.bxOfferAdd();
  const keys = page.data.advanced.barter.offers.map((o) => o.key);
  assert.equal(new Set(keys).size, keys.length, '换物标记自动给且不重复');
  page.bxOfferDel(ev({ index: 2 }));
  const saved = JSON.parse(cfg.serialize(page.data.advanced));
  assert.equal(serverBarter(saved.barter), '');
  // 被背包 / 目标 / 换物用着的物品不能删,删了就是悬空引用
  const before = page.data.advanced.barter.items.length;
  page.bxItemDel(ev({ index: 0 }));
  assert.equal(page.data.advanced.barter.items.length, before, '还被引用着的物品不许删');
  assert.equal(notices.length, 1, '不许删时要说一句，别让作者以为按钮坏了');
  // 切成「留住」:同一件物品从 need 挪到 keep
  page.bxGoalKind(ev({ index: 0 }, 1));
  assert.equal(page.data.advanced.barter.goals[0].keep, page.data.advanced.barter.items[3].id);
  assert.ok(!('need' in page.data.advanced.barter.goals[0]));

  const mp = host('mixer');
  mp.data.advanced.mixer.title = '少了哪一轨';
  mp.mxTrackAdd();
  mp.data.advanced.mixer.tracks.forEach((tr, i) => { tr.label = ['鼓', '贝斯', '人声'][i]; });
  mp.mxTrackMuted(ev({ index: 2 }, true));
  mp.mxAnswer(ev({}, 2));
  assert.equal(mp.data.advanced.mixer.answer, mp.data.advanced.mixer.tracks[2].id);
  const mixSaved = JSON.parse(cfg.serialize(mp.data.advanced));
  assert.equal(serverMixer(mixSaved.mixer), '');
  // 删掉答案那一轨:答案清空,不留悬空 id
  mp.mxTrackDel(ev({ index: 2 }));
  assert.equal(mp.data.advanced.mixer.answer, '');
});

test('发布闸镜像:fixture 与后端矩阵同为 35 行,两者都可证明完成', () => {
  assert.equal(matrix.types.length, 35);
  for (const key of ['hangman', 'barter', 'mixer']) {
    const row = matrix.types.find((r) => r.key === key);
    assert.ok(row, key);
    assert.equal(row.section, key);
    assert.equal(row.completionProof, true);
    assert.equal(row.r5CompletionProof, true);
  }
  assert.equal(matrix.types.find((r) => r.key === 'barter').tools.zeroChallenge, 'UNSUPPORTED');
  assert.equal(matrix.types.find((r) => r.key === 'mixer').tools.zeroChallenge, 'UNSUPPORTED');
  for (const key of ['barter', 'mixer']) {
    const tpl = { validationMethod: 0, advancedConfigJson: JSON.stringify(Object.assign(catalog.applyToConfig(cfg.defaultConfig(), key, { demo: true }), { outcomeRules: { version: 1, pass: {}, fail: {} } })) };
    assert.equal(support.validate(matrix, tpl, { settled: true }), '', key + ' 被编辑器发布闸拦住');
    assert.equal(support.choice(matrix, key, { outcomeRules: { version: 1 } }, { settled: true }), '');
  }
});
