'use strict';
// 创作者全流程走查(JOURNEY-CREATOR-1122):首次作者从「开新主题」走到「发布 / 我的模板」,
// 每一处修复一条用例。样例都是虚构文字。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const story = require('../../pages/publish/utils/publish/pro-editor-story.js');
const cast = require('../../pages/publish/utils/publish/story-cast.js');

const ROOT = path.join(__dirname, '../..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

function loadFabu() {
  const sent = [];
  const toasts = [];
  const stored = {};
  global.wx = {
    getStorageSync: k => stored[k], setStorageSync: (k, v) => { stored[k] = v; }, removeStorageSync: k => { delete stored[k]; },
    showToast(o) { toasts.push(o && o.title); }, showLoading() {}, hideLoading() {}, getSystemInfoSync() { return {}; }, getWindowInfo() { return {}; },
    showModal() {},
  };
  global.getCurrentPages = () => [];
  global.getApp = () => ({ globalData: {}, getUserID: () => 7, getRequestErrorMessage: (r, d) => d, sendRequest: opts => sent.push(opts) });
  let page; global.Page = value => { page = value; };
  delete require.cache[require.resolve('../../pages/publish/fabu/index')];
  require('../../pages/publish/fabu/index');
  page.data = Object.assign({}, page.data, { operationScope: '', editingTopicId: '', editLoaded: false, editIsDraft: false, submitting: false,
    draftSaving: false, draftUuid: 'u-1', draftMemberId: 7, errors: {},
    formData: { name: '', imgUrl: 'media-asset:1', chapters: [], tickets: [] }, pendingMaterials: [] });
  page.setData = (patch, cb) => {
    Object.keys(patch).forEach((key) => {
      const parts = key.split('.');
      let at = page.data;
      for (let i = 0; i < parts.length - 1; i++) { at[parts[i]] = Object.assign({}, at[parts[i]]); at = at[parts[i]]; }
      at[parts[parts.length - 1]] = patch[key];
    });
    if (cb) cb();
  };
  return { page, sent, toasts };
}

/* (1) 起名 / 票务 */

test('没起名就点「保存草稿」:红字落在名字框下并滚过去,不发请求;一输入红字就收', () => {
  const { page, sent } = loadFabu();
  const scrolled = [];
  page._scrollSheetTo = (id) => scrolled.push(id);
  page.saveServerDraft();
  assert.equal(sent.length, 0);
  assert.match(page.data.errors.name, /先给主题起个名字/);
  assert.deepEqual(scrolled, ['fieldName']);
  page.refreshPrimaryActionState = () => {};
  page.onNameChange({ detail: { value: '夜航' } });
  assert.equal(page.data.errors.name, '');
  const wxml = read('pages/publish/fabu/index.wxml');
  assert.match(wxml, /wx:if="\{\{errors\.name\}\}" title="\{\{errors\.name\}\}"/);
  const sheet = read('pages/publish/fabu/topic-detail-sheet.wxml');
  assert.match(sheet, /errors\.categoryIds/);
  assert.match(sheet, /errors\.description/);
});

test('票种能删:编辑器里「删除这个票种」,删完 5 秒内可撤销', () => {
  const { page } = loadFabu();
  page.refreshRouteGraph = () => {};
  page.refreshPrimaryActionState = () => {};
  page.updateAllStatistics = () => {};
  page.data.formData.tickets = [{ name: '成人票', price: 30 }, { name: '亲子票', price: 50 }];
  page.deleteTicket({ currentTarget: { dataset: { index: 1 } } });
  assert.deepEqual(page.data.formData.tickets.map(t => t.name), ['成人票']);
  assert.equal(page.data.pageUndo.show, true);
  assert.match(page.data.pageUndo.text, /亲子票/);
  page.undoPageStep();
  assert.deepEqual(page.data.formData.tickets.map(t => t.name), ['成人票', '亲子票']);
  assert.equal(page.data.pageUndo.show, false);
  const step3 = read('pages/publish/fabu/step3.wxml');
  assert.match(step3, /bindtap="deleteTicket" data-index="\{\{editingTicket\.editIndex\}\}"/);
  assert.match(read('pages/publish/fabu/index.wxml'), /bindtap="undoPageStep"/);
});

/* (2) 章节 / 分支 */

test('删章节后分支去向跟着走:后面的章号前移,指向被删章的改回「继续本章」', () => {
  const branch = (to) => ({ key: 'b' + to, type: 'branch', content: '去哪', options: [{ text: '甲', to }, { text: '乙', to: 'continue' }] });
  const chapters = [
    { name: '一', blocks: [branch('chapter:2'), branch('chapter:3')] },
    { name: '三', blocks: [branch('chapter:1'), branch('end')] },
  ];
  const out = story.remapBranchTargetsAfterChapterRemoval(chapters, 1); // 删掉了原第 2 章
  assert.equal(out.reset, 1);
  assert.deepEqual(out.chapters[0].blocks.map(b => b.options[0].to), ['continue', 'chapter:2']);
  assert.deepEqual(out.chapters[1].blocks.map(b => b.options[0].to), ['chapter:1', 'end']);
  assert.equal(chapters[0].blocks[0].options[0].to, 'chapter:2', '不改入参');
  assert.equal(out.chapters[1], chapters[1], '没变的章节原样返回');
});

test('删章节:确认框说清能撤销,删完出撤销条', () => {
  const src = read('pages/publish/fabu/index.js');
  const del = src.slice(src.indexOf('  deleteChapter(e) {'), src.indexOf('  //显示编辑章节弹框'));
  assert.match(del, /删除后 5 秒内可以撤销/);
  assert.match(del, /remapBranchTargetsAfterChapterRemoval/);
  assert.match(del, /_pageUndoBar\(/);
  assert.doesNotMatch(del, /删除后不可恢复/);
});

test('设为结局被拦:红字写在开关下,不再弹 toast', () => {
  const src = read('pages/publish/fabu/index.js');
  const fn = src.slice(src.indexOf('  onChapterEndingToggle(e) {'), src.indexOf('  onChapterEndingToggle(e) {') + 600);
  assert.match(fn, /chapterEndingError: '结局章里不能放节点或玩法/);
  assert.doesNotMatch(fn, /cyToast\('结局章里不能放节点或玩法'\)/);
});

test('伏笔 / 选项被删后不露内部键名', () => {
  assert.match(read('pages/publish/fabu/index.wxml'), /thoughtNameOf\[block\.thoughtKey\] \|\| '伏笔已删除'/);
});

test('上一张图还在上传时再点「图片」会说一句,不是没反应', () => {
  const { page, toasts } = loadFabu();
  page._storyMediaUploadOperation = { isFinished: () => false, isAborted: () => false };
  page.insertStoryImageAt({ currentTarget: { dataset: { index: 0 } } });
  assert.ok(toasts.some(t => /还在上传/.test(t)));
});

/* (3) 角色 */

test('删角色:对白变段落、信任行去掉、结局章改回未归属;确认框列出影响', () => {
  const id = 'c_ab12cd';
  const chapters = [
    { name: '一', blocks: [
      { key: 'l1', type: 'line', speaker: id, content: '你来了', audioUrl: '' },
      { key: 'l2', type: 'line', speaker: 'c_zz99yy', content: '嗯' },
      { key: 'b1', type: 'branch', content: '信谁', options: [{ text: '她', to: 'continue', trust: [{ castId: id, delta: 1 }] }, { text: '他', to: 'end', trust: [{ castId: id, delta: -1 }, { castId: 'c_zz99yy', delta: 2 }] }] },
    ] },
    { name: '终', ending: { fallback: false, kind: 'cast', endingFor: id }, blocks: [] },
  ];
  assert.deepEqual(cast.memberRefs(chapters, id), { lines: 1, trust: 2, endings: 1 });
  const out = cast.dropMemberRefs(chapters, id);
  assert.deepEqual(out[0].blocks[0], { key: 'l1', type: 'text', content: '你来了' });
  assert.equal(out[0].blocks[1].speaker, 'c_zz99yy');
  assert.equal(out[0].blocks[2].options[0].trust, undefined);
  assert.deepEqual(out[0].blocks[2].options[1].trust, [{ castId: 'c_zz99yy', delta: 2 }]);
  assert.equal(out[1].ending.kind, 'thought');
  assert.equal(chapters[1].ending.endingFor, id, '不改入参');
  const page = read('pages/publish/fabu/theme-cast.js');
  assert.match(page, /storyCast\.memberRefs\(/);
  assert.match(page, /storyCast\.dropMemberRefs\(/);
  assert.match(page, /this\._pushUndo\(\)/);
  assert.match(page, /_pageUndoBar\('已删除「'/);
});

test('页面级撤销条压过整屏角色面板', () => {
  const css = read('pages/publish/fabu/index.wxss');
  assert.match(css, /\.pending-undo\.pending-undo--page \{ z-index: calc\(var\(--cy-z-sheet\) \+ 1\); \}/);
});

/* (4) 站点选玩法 */

test('「我的模板」读失败给重试,不冒充没有模板', () => {
  const { page, sent } = loadFabu();
  page._refreshSupportMatrix = () => {};
  page.getTempList();
  assert.equal(page.data.tempListState, 'loading');
  sent[0].fail({});
  assert.equal(page.data.tempListState, 'error');
  page.getTempList();
  sent[1].success({ code: '200', data: { rows: [] } });
  assert.equal(page.data.tempListState, 'ready');
  assert.match(read('pages/publish/fabu/index.wxml'), /tempListState === 'error'.*action="重试" bind:action="getTempList"/);
});

test('从发布页去建玩法:没起名的节点不再把内部编号 lid3 当玩法名', () => {
  const src = read('pages/publish/fabu/index.js');
  assert.doesNotMatch(src, /'节点' \+ \(this\.data\.editTargetNodeLid/);
});

test('选玩法半屏里点「预览」,关掉预览回到半屏且仍选着那个玩法', () => {
  const src = read('pages/publish/temp/index.js');
  const start = src.indexOf('  closePreview: function () {');
  const closePreview = new Function('return {' + src.slice(start, src.indexOf('\n  },', start) + 4) + '}')().closePreview;
  const data = { gameSheetOpen: false };
  const page = { data, syncNativeTheme() {}, setData(p) { Object.assign(data, p); },
    _pvReturnSheet: { gameSheetOpen: true, sheetGroup: 2, sheetNavAnchor: 'gnav-2', sheetPick: 'riddle', sheetPickItem: { key: 'riddle' } } };
  closePreview.call(page);
  assert.equal(data.gameSheetOpen, true);
  assert.equal(data.sheetPick, 'riddle');
  assert.equal(data.previewVisible, false);
  assert.equal(page._pvReturnSheet, null);
  closePreview.call(Object.assign(page, { data: { gameSheetOpen: false } }));
  assert.equal(page.data.gameSheetOpen, false, '不是从半屏来的预览不重开半屏');
});

test('灰着的「添加加值」点了说出原因;没有数值时「添加效果」直接带去新建数值', () => {
  const toastPath = require.resolve('../../utils/toast.js');
  const said = [];
  require.cache[toastPath] = { id: toastPath, filename: toastPath, loaded: true, exports: (m) => said.push(m) };
  try {
    for (const f of ['check-section.js', 'after-section.js']) delete require.cache[require.resolve('../../pages/publish/temp/' + f)];
    const check = require('../../pages/publish/temp/check-section.js').methods;
    const after = require('../../pages/publish/temp/after-section.js').methods;
    const cfg = require('../../pages/publish/utils/publish/advanced-game-config.js');
    const page = { data: { checkView: { modAddOff: true }, advanced: { check: { mods: new Array(cfg.MAX_MODS).fill({}) } } }, _checkCtx: null,
      setData(p) { Object.assign(this.data, p); } };
    Object.assign(page, check);
    page.openCheckSheet({ currentTarget: { dataset: { mode: 'mod' } } });
    assert.equal(said.at(-1), '最多 ' + cfg.MAX_MODS + ' 条加值');
    assert.equal(page.data.checkSheet, undefined, '没打开空半屏');
    page.data.advanced.check.mods = [];
    assert.match(page._modAddOffReason(), /上限 \+\d/);

    const ap = { data: { r5Editor: { valueSlots: [] } }, setData(p) { Object.assign(this.data, p); } };
    Object.assign(ap, after);
    ap.openAfterAdd();
    assert.match(said.at(-1), /先新建一个数值/);
    assert.equal(ap.data.afterOpen, 'costAdd');
    assert.equal(ap.data.afterNewValue, true);
    assert.equal(ap.data.afterAdd, undefined);
    ap.data.r5Editor.valueSlots = [{ key: 'v1' }];
    ap.openAfterAdd();
    assert.equal(ap.data.afterAdd.show, true);
  } finally {
    delete require.cache[toastPath];
  }
});

test('偏好题配置不对作者露英文键名和 JSON', () => {
  const src = read('pages/publish/temp/index.js');
  const fn = src.slice(src.indexOf('  parsePreferencePreview: function (value) {'), src.indexOf('  // ----- 提示(并入完成方式)'));
  assert.doesNotMatch(fn, /error: '[^']*(steps|dimensions|tiebreak|results|title、body|JSON)/);
  assert.doesNotMatch(read('pages/publish/temp/index.wxml'), /填写 steps \/ dimensions/);
});

/* (5)(6) 草稿 / 发布 */

test('保存草稿失败后点「重试」再存草稿,不会变成发布;发布失败的重试仍是发布', () => {
  const { page } = loadFabu();
  const calls = [];
  page.saveServerDraft = () => calls.push('draft');
  page.submitForm = () => calls.push('publish');
  page._onServerDraftFailed({ stage: 'save', networkError: true }, false, 7, false);
  assert.ok(page.data.submitError);
  assert.equal(page.data.submitErrorRetry, 'draft');
  page.retrySubmitError();
  page._onServerDraftFailed({ stage: 'save', networkError: true }, true, 7, false);
  page.retrySubmitError();
  assert.deepEqual(calls, ['draft', 'publish']);
  assert.match(read('pages/publish/fabu/index.wxml'), /action="重试" aria="[^"]*" bind:action="retrySubmitError"/);
  const src = read('pages/publish/fabu/index.js');
  const submit = src.slice(src.indexOf('  submitForm() {'), src.indexOf('  submitForm() {') + 900);
  assert.match(submit, /submitErrorRetry: ''/);
});

test('发布成功文案按模式:自由探索与商家发布不叫人去找俱乐部带团', () => {
  const { page } = loadFabu();
  page.data.formData.productType = 2;
  assert.doesNotMatch(page._publishedCopy().next, /俱乐部/);
  assert.equal(page._publishedCopy().title, '自由探索已发布');
  page.data.formData.productType = 1;
  page.data.operationScope = 'MERCHANT';
  assert.doesNotMatch(page._publishedCopy().next, /俱乐部/);
  page.data.operationScope = '';
  assert.match(page._publishedCopy().next, /俱乐部带团/);
});

test('发布检查里章节规则问题写成第几章 / 章名,不写 index=', () => {
  assert.doesNotMatch(read('pages/publish/fabu/index.js'), /'章节 index='/);
});

/* (7) 我的模板 / 我的项目 */

test('我的项目 · 模板页:商家点模板带上商家身份;空态有下一步;项目读失败不再整页空白', () => {
  const js = read('subpackageA/pages/myproject/index.js');
  assert.match(js, /templatedetail\?id=' \+ id \+ '&scope=my' \+ merchant/);
  assert.match(js, /'&operationScope=MERCHANT'/);
  assert.match(js, /createTemplate\(\) \{/);
  assert.match(js, /\/pages\/publish\/template-intro\/index/);
  assert.doesNotMatch(js, /toast\('操作成功'\); that\.loadTemplates\(\)/);
  const wxml = read('subpackageA/pages/myproject/index.wxml');
  assert.match(wxml, /\(loaded \|\| projectState === 'error'\) && topicTemplates\.length===0\}\}" title="还没有模板" cta="做一个玩法" bind:cta="createTemplate"/);
});
