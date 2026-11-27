'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('UI-C1 徽章墙: 无专属徽记的通关成就徽章显示名字首字，不回退统一 DEFAULT 靶心', async () => {
  const js = read('subpackageP3/pages/badge-wall/index/index.js');
  const wxml = read('subpackageP3/pages/badge-wall/index/index.wxml');
  const wxss = read('subpackageP3/pages/badge-wall/index/index.wxss');

  assert.match(wxml, /class="bw-medal__mono bw-medal__mono--\{\{item\.monoTone\}\}/);
  assert.match(wxml, /\{\{item\.monogram\}\}/);
  assert.match(wxss, /\.bw-medal__mono--0/);
  assert.match(wxss, /\.bw-medal__mono--5/);

  let def = null;
  const sandbox = {
    Page: (d) => { def = d; },
    getApp: () => ({ globalData: { navBarHeight: 44, menuButtonInfo: {} }, getUserID: () => 990050 }),
    require: (p) => {
      if (p.includes('enamel-pin')) return { render() {}, optsFor() { return { finish: 'gold', enamel: 'hard' }; } };
      if (p.includes('page-motion')) return { enter() {} };
      if (p.includes('login-reload')) return { recoverReadSession() { return false; } };
      if (p.includes('nav-safe-area')) return { resolveMenuChrome() { return { sheetTop: 90 }; } };
      if (p.includes('datetime')) return { chinaDateKey: () => '2026-11-19' };
      if (p.includes('motion-preference')) return { readReducedMotion: () => true };
      if (p.includes('response-shape')) return { isRecord: (x) => !!x && typeof x === 'object', isRecordList: Array.isArray };
      if (p.includes('ui-state-request')) return { sendUiStateRequest: (a, u, o) => sandbox.__reqs.push({ u, o }) };
      throw new Error('unexpected require: ' + p);
    },
    wx: {
      createSelectorQuery: () => ({ in: () => ({ select: () => ({ fields: () => ({ exec() {} }) }) }) }),
    },
    __reqs: [],
  };
  new Function('Page', 'getApp', 'require', 'wx', js)(sandbox.Page, sandbox.getApp, sandbox.require, sandbox.wx);
  const ctx = Object.assign({
    data: JSON.parse(JSON.stringify(def.data)),
    setData(patch) { Object.assign(this.data, patch); },
  }, def);
  ctx.loadData();
  sandbox.__reqs[0].o.success({
    code: 200,
    data: {
      medals: [
        { kind: 'achievement', badgeCode: 'TOPIC_FINISH_9913901', medalName: '归名者', medalImg: '' },
        { kind: 'achievement', badgeCode: 'TOPIC_FINISH_9914001', medalName: '署名人', medalImg: '' },
        { kind: 'achievement', badgeCode: 'TOPIC_FINISH_9914101', medalName: '夜稿读者', medalImg: '' },
      ],
    },
  });
  sandbox.__reqs[1].o.success({ code: 200, data: { identity: [{ badgeCode: 'FIRST_STEP', badgeName: '开始在场', category: 'EXPLORE', unlocked: true }] } });
  await new Promise((r) => setImmediate(r));
  ctx.onUnload();
  const lit = ctx.data.badgeGroups[0].items;
  const known = lit.find((b) => b.code === 'FIRST_STEP');
  assert.equal(known.pinId, 'arrival');
  assert.equal(known.monogram, '');

  const finishBadges = lit.filter((b) => b.code.startsWith('TOPIC_FINISH_'));
  assert.equal(finishBadges.length, 3);
  assert.deepEqual(finishBadges.map((b) => b.monogram), ['归', '署', '夜']);
  for (const b of finishBadges) {
    assert.equal(b.pinId, '', '无专属徽记的路线通关徽章不得回退 DEFAULT 靶心');
  }
});

test('UI-C2 发布活动: 无权限空态居中放大且保持浅色主题高对比按钮', () => {
  const wxml = read('pages/publish/activity/index.wxml');
  const wxss = read('pages/publish/activity/index.wxss');
  assert.match(wxml, /<view class="fabu theme-topic-editor/);
  assert.match(wxml, /<cy-empty fill size="lg" title="暂时不能发布活动" sub="\{\{deniedReason\}\}" cta="返回" bind:cta="onNavBack" \/>/);
  assert.match(wxss, /@import '\.\.\/\.\.\/\.\.\/style\/merchant-light\.wxss';/);
  assert.match(wxss, /\.publish-access-state > cy-empty \{ flex: 1; display: flex; flex-direction: column; \}/);
});

test('UI-C3 优惠券页: 玩家误入商家优惠券管理页不再引导申请入驻，改去我的优惠券包', () => {
  const wxml = read('subpackageMember/coupon/coupon.wxml');
  const js = read('subpackageMember/coupon/coupon.js');
  assert.doesNotMatch(wxml, /申请入驻/);
  assert.match(wxml, /cta="\{\{isMerchant \? '返回' : '查看我的优惠券'\}\}"/);
  assert.match(js, /\/subpackageMember\/coupon-wallet\/index/);
});

test('UI-C4 玩法库: 分类筛选栏吸顶避让状态栏与顶栏安全高度', () => {
  const pageWxml = read('pages/template/index.wxml');
  const shelfWxss = read('pages/templatedetail/shelf/index.wxss');
  assert.match(pageWxml, /--template-safe-top:\s*\{\{\s*safeTop\s*\}\}px;/);
  assert.match(shelfWxss, /\.sh-tags\s*\{[\s\S]*?position:\s*sticky;[\s\S]*?top:\s*var\(--template-safe-top,\s*0px\);[\s\S]*?background:\s*var\(--cy-color-bg-page\);/);
});

test('UI-C5 主题编辑器: 底部内容留空让出固定操作栏高度，空章节主按钮不被挡住', () => {
  const wxss = read('pages/publish/fabu/index.wxss');
  assert.match(wxss, /\.slopes-sheet\s*\{[\s\S]*?padding-bottom:\s*calc\(220rpx \+ env\(safe-area-inset-bottom\)\);/);
  assert.match(wxss, /\.slopes-empty-card__body\s*\{[\s\S]*?padding:\s*var\(--cy-space-3\) var\(--cy-space-3\);/);
});

test('Bug 1 营销商品购买: 退款窗口缺失原因码有明确玩家文案', () => {
  const { reasonText } = require(path.join(ROOT, 'utils/commerce/product-order.js'));
  assert.equal(reasonText('REFUND_WINDOW_MISSING'), '该商品暂不可售');
});

test('Bug 2 收益页错误态: 商家浅色主题下错误可见且可点重试，cy-error 消费 v2 语义 token', () => {
  const earningsWxml = read('subpackageA/components/scene-asset-earnings/index.wxml');
  const errWxss = read('components/cy/error/index.wxss');
  assert.doesNotMatch(earningsWxml, /load-failure=/, '账户收益错误态不再用空白占位隐藏');
  assert.match(earningsWxml, /<cy-error fill="\{\{true\}\}" size="lg" title="/);
  assert.match(errWxss, /\.cy-error-title\s*\{[\s\S]*?color:\s*var\(--cy-color-text-primary\);/);
  assert.match(errWxss, /\.cy-error-retry\s*\{[\s\S]*?background:\s*var\(--cy-color-action-primary-bg\);[\s\S]*?color:\s*var\(--cy-color-action-primary-fg\);/);
});
