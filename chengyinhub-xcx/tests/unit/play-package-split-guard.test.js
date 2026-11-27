'use strict';
/* play-package-split-guard —— pages/play 分包超 2MB 的上线阻断修复护栏(2026-11-21 fix/play-package-split-1121)
 *
 * 背景:DevTools CLI preview(真编译器)在 #891 树上报
 *   subpackage /pages/play/ source size 2157KB exceed max limit 2048KB  ⇒ 小程序无法上传。
 * 修法:玩法组件(cy-playkit 分发器 + 41 个 playkit-* 及其只被它们用到的组件/工具/样式)整体移到
 *   只放组件的新分包 pages/playkit(subpackagePlaykit,只有一个无入口的占位页 index/index——微信要求分包至少一页,否则 preloadRule 报找不到包),目录结构与 pages/play 一一对应;
 *   pages/play 经「跨分包异步组件 + componentPlaceholder」引用,preloadRule 在进 play / 主题详情时预下载。
 *
 * ① 体积:package-graph est(编译后粗估,口径见 scripts/lib/package-graph.js estimate)
 *    pages/play < 1950KB;主包不超过本次基线(见下方说明)。
 * ② 跨分包引用:任何包外文件引用 pages/playkit 里的组件,都必须配 componentPlaceholder;
 *    pages/playkit 里的 JS / WXSS / WXS 不得同步依赖 pages/play(只能依赖主包或本包)。
 * ③ 预下载:pages/play/index、poi-challenge、主题详情预下载 subpackagePlaykit,每页预下载合计 est < 2048KB。
 * ④ 共享件的逐字副本(cy-illus / 4 个工具)与 pages/play 规范实现一致(只允许 /pages/play/ → /pages/playkit/)。
 *
 * 2026-11-22 主包瘦身(同一 PR #895):真编译器在 dface61 上报
 *   main package source size 2061KB exceed max limit 2048KB  ⇒ 仍无法上传。
 * 修法(行为与视觉不变,只改包布局):
 *   - 漫游页 / 玩法页里只在半屏场景、浮层里出现的组件(5 个 scene-roam-* / scene-qr-*、share-card、slide-confirm、proto-cam、route-thumb)
 *     下沉 subpackageRoam,宿主经 componentPlaceholder 异步引用,进漫游 / 玩法页时预下载 subpackageRoam;
 *   - 只被单个分包用到的主包文件下沉到该分包;被 2~3 个分包同步 require 的纯函数工具 / 纯展示组件(不发请求、无模块级状态)
 *     各放一份逐字副本到用它的分包(见下方 COPY_GROUPS,规范实现 = 第一份);
 *   - 两张兜底封面图(route_free_cover / mer1)放进引用它们的分包;
 *   - pages/publish 的非首屏组件(外观预览 / 过场 / 章节门 / 建成页 / 状态键 / 奖励选择…)移到只放组件的新分包 pages/publishkit,
 *     宿主走占位,进 fabu / temp 时预下载。
 * ⑤ 体积:主包与每个分包 est ≤ 1950KB;主包另按基线棘轮。
 * ⑥ 任何跨分包的 usingComponents 都必须配 componentPlaceholder;pages/publishkit 不同步依赖 pages/publish。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const graph = require('../../scripts/lib/package-graph.js');

const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const KB = 1024;
const baseline = require('../../scripts/baselines/package-size.json').est;
const PLAY_EST_LIMIT = 1950 * KB;
const PACKAGE_EST_LIMIT = 1950 * KB;
// 主包:真编译器在 #891 树上只拒了 pages/play,主包未报超限;est 对主包没有真值可校准,
// 所以按「不得增长」棚住(基线 + 不超过 16KB 余量,只许往下调),降到 1950KB 以下需要单独的主包瘦身(见 PR #895)。
const MAIN_EST_CEILING = baseline.mainCeilingBytes;
const PRELOAD_LIMIT = 2048 * KB;

let cached = null;
function measure() {
  if (!cached) { const g = graph.build(); cached = { g, est: graph.estimate(g) }; }
  return cached;
}

test('体积:主包与每个分包 est ≤ 1950KB,主包 est 不增长', () => {
  const { est } = measure();
  assert.equal(baseline.playLimitBytes, PLAY_EST_LIMIT);
  assert.equal(baseline.packageLimitBytes, PACKAGE_EST_LIMIT);
  assert.ok(MAIN_EST_CEILING - baseline.mainBytes <= 16 * KB, '主包 est 棘轮余量不超过 16KB');
  assert.ok(MAIN_EST_CEILING <= PACKAGE_EST_LIMIT, '主包棘轮不得高于 1950KB 硬上限');
  const kb = (n) => (n / KB).toFixed(1) + 'KB';
  assert.ok(est.MAIN <= PACKAGE_EST_LIMIT, `主包 est ${kb(est.MAIN)} > 1950KB(真编译上限 2048KB,主包 est 约比真值高 6%)`);
  assert.ok(est.MAIN <= MAIN_EST_CEILING, `主包 est ${kb(est.MAIN)} 超过基线 ${kb(MAIN_EST_CEILING)}`);
  for (const [pkg, bytes] of Object.entries(est)) {
    assert.ok(bytes <= PACKAGE_EST_LIMIT, `${pkg} est ${kb(bytes)} > 1950KB(真编译上限 2048KB,需留余量)`);
  }
  assert.ok(est['pages/play'] < PLAY_EST_LIMIT, `pages/play est ${kb(est['pages/play'])} ≥ 1950KB`);
});

test('est 口径负控:往主包加 160KB 代码就会越过 1950KB', () => {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'est-main-'));
  try {
    const rel = 'utils/__est_probe__.js';
    fs.mkdirSync(path.join(dir, 'utils'), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), 'var a=' + JSON.stringify('x'.repeat(160 * KB)) + ';');
    const probe = graph.estimate({
      files: new Map([[rel, { size: 160 * KB, owner: 'MAIN' }]]),
      reach: new Map([[rel, new Set(['MAIN'])]]),
      packages: { MAIN: {} },
    }, dir);
    assert.ok(probe.MAIN > 140 * KB);
    assert.ok(measure().est.MAIN + probe.MAIN > PACKAGE_EST_LIMIT);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('est 口径负控:往 pages/play 加 400KB 代码就会越线', () => {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'est-'));
  try {
    const rel = 'pages/play/__est_probe__.js';
    fs.mkdirSync(path.join(dir, 'pages/play'), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), 'var a=' + JSON.stringify('x'.repeat(400 * KB)) + ';');
    const probe = graph.estimate({
      files: new Map([[rel, { size: 400 * KB, owner: 'pages/play' }]]),
      reach: new Map([[rel, new Set(['pages/play'])]]),
      packages: { 'pages/play': {} },
    }, dir);
    assert.ok(probe['pages/play'] > 300 * KB);
    assert.ok(measure().est['pages/play'] + probe['pages/play'] >= PLAY_EST_LIMIT);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('新分包:只放组件加一个无入口占位页,任何分包 pages 不为空、预下载包名都存在;玩法组件不再留在 pages/play', () => {
  const app = JSON.parse(read('app.json'));
  const sub = app.subPackages.find((s) => s.root === 'pages/playkit');
  assert.deepEqual(sub, { root: 'pages/playkit', name: 'subpackagePlaykit', pages: ['index/index'] });
  const pubkit = app.subPackages.find((s) => s.root === 'pages/publishkit');
  assert.deepEqual(pubkit, { root: 'pages/publishkit', name: 'subpackagePublishkit', pages: ['index/index'] });
  for (const s of app.subPackages) assert.ok(Array.isArray(s.pages) && s.pages.length > 0, `${s.root} 分包 pages 不能为空`);
  const names = new Set(app.subPackages.flatMap((s) => [s.root, s.name].filter(Boolean)));
  for (const [page, r] of Object.entries(app.preloadRule || {})) for (const pkg of r.packages) assert.ok(names.has(pkg), `${page} 预下载的 ${pkg} 不存在`);
  assert.equal(app.lazyCodeLoading, 'requiredComponents');
  const left = fs.readdirSync(path.join(ROOT, 'pages/play/components')).filter((d) => /^playkit/.test(d));
  assert.deepEqual(left, []);
  assert.ok(fs.existsSync(path.join(ROOT, 'pages/playkit/components/playkit/index.json')));
});

function jsonFiles(dir, out = []) {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    if (e.name.startsWith('.') || ['node_modules', 'tests', 'scripts', 'docs', 'artifacts'].includes(e.name)) continue;
    const rel = dir ? dir + '/' + e.name : e.name;
    if (e.isDirectory()) jsonFiles(rel, out); else if (e.name.endsWith('.json')) out.push(rel);
  }
  return out;
}

test('任何跨分包的组件引用都配了 componentPlaceholder(主包 / 分包引用另一分包的组件)', () => {
  const app = JSON.parse(read('app.json'));
  const roots = app.subPackages.map((s) => s.root.replace(/\/$/, ''));
  const owner = (f) => roots.find((r) => f.startsWith(r + '/')) || 'MAIN';
  const missing = [];
  let cross = 0;
  for (const file of jsonFiles('')) {
    let j;
    try { j = JSON.parse(read(file)); } catch (_) { continue; }
    for (const [name, spec] of Object.entries((j && j.usingComponents) || {})) {
      if (typeof spec !== 'string' || spec.startsWith('plugin:')) continue;
      const target = spec.startsWith('/') ? spec.slice(1) : path.posix.normalize(path.posix.join(path.posix.dirname(file), spec));
      const to = owner(target);
      if (to === 'MAIN' || to === owner(file)) continue;
      cross += 1;
      if (!(j.componentPlaceholder || {})[name]) missing.push(`${file}:${name} → ${spec}`);
    }
  }
  assert.deepEqual(missing, []);
  assert.ok(cross > 60, '应扫到跨分包引用(含本次下沉到 subpackageRoam / pages/publishkit 的组件)');
  const roam = JSON.parse(read('pages/roam/index.json'));
  // L05-026/038:漫游页的徽章弹窗删了,它是 cy-slide-confirm 在漫游页的唯一用处,注册一并去掉
  assert.equal(roam.usingComponents['cy-slide-confirm'], undefined)
  for (const name of ['cy-scene-roam-task-list', 'cy-scene-qr-citynode', 'cy-proto-cam', 'cy-share-card']) {
    assert.match(roam.usingComponents[name], /^\/subpackageRoam\/components\/cy\//, name);
    assert.equal(roam.componentPlaceholder[name], 'view', name);
  }
});

test('跨分包引用 pages/playkit 的组件都配了 componentPlaceholder', () => {
  const users = [];
  for (const file of jsonFiles('')) {
    if (file.startsWith('pages/playkit/')) continue;
    let j;
    try { j = JSON.parse(read(file)); } catch (_) { continue; }
    for (const [name, spec] of Object.entries(j.usingComponents || {})) {
      if (!/^\/?pages\/playkit\//.test(String(spec))) continue;
      users.push(file + ':' + name);
      assert.ok((j.componentPlaceholder || {})[name], `${file} 引用 ${spec} 缺 componentPlaceholder.${name}`);
    }
  }
  for (const must of ['pages/play/index.json:cy-playkit', 'pages/play/index.json:cy-playkit-journey-check',
    'pages/play/index.json:cy-playkit-album', 'pages/play/poi-challenge/index.json:cy-playkit-qa',
    'pages/publish/temp/index.json:cy-playkit']) assert.ok(users.includes(must), must);
});

test('pages/playkit 不同步依赖 pages/play(JS require / WXSS @import / WXS);组件反向引用必须走占位', () => {
  const { g } = measure();
  for (const [file, info] of g.files) {
    if (info.owner !== 'pages/playkit' || !/\.(js|wxss|wxml|wxs|json)$/.test(file)) continue;
    if (file.endsWith('.json')) {
      const j = JSON.parse(read(file));
      for (const [name, spec] of Object.entries(j.usingComponents || {})) {
        if (/^\/?pages\/play\//.test(spec)) assert.ok((j.componentPlaceholder || {})[name], `${file} → ${spec} 缺 componentPlaceholder`);
      }
      continue;
    }
    const src = graph.stripJsComments(read(file)).replace(/<!--[\s\S]*?-->/g, '');
    assert.doesNotMatch(src, /["'(]\/pages\/play\//, file);
    for (const m of src.matchAll(/(?:require\(|@import\s+|src=)\s*["']((?:\.\.\/)+[^"']+)["']/g)) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), m[1]));
      assert.ok(!target.startsWith('pages/play/'), `${file} → ${target}`);
    }
  }
  // play-verdict 留在 pages/play(它的 @keyframes 不复制一份),play-stage 经占位异步引用
  const stage = JSON.parse(read('pages/playkit/components/play-stage/index.json'));
  assert.equal(stage.usingComponents['cy-play-verdict'], '/pages/play/components/play-verdict/index');
  assert.equal(stage.componentPlaceholder['cy-play-verdict'], 'view');
});

test('pages/publishkit 不同步依赖 pages/publish(JS require / WXSS @import / WXS);组件反向引用必须走占位', () => {
  const { g } = measure();
  for (const [file, info] of g.files) {
    if (info.owner !== 'pages/publishkit' || !/\.(js|wxss|wxml|wxs|json)$/.test(file)) continue;
    if (file.endsWith('.json')) {
      const j = JSON.parse(read(file));
      for (const [name, spec] of Object.entries(j.usingComponents || {})) {
        if (/^\/?pages\/publish\//.test(spec)) assert.ok((j.componentPlaceholder || {})[name], `${file} → ${spec} 缺 componentPlaceholder`);
      }
      continue;
    }
    const src = graph.stripJsComments(read(file)).replace(/<!--[\s\S]*?-->/g, '');
    assert.doesNotMatch(src, /["'(]\/pages\/publish\//, file);
    for (const m of src.matchAll(/(?:require\(|@import\s+|src=)\s*["']((?:\.\.\/)+[^"']+)["']/g)) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), m[1]));
      assert.ok(!target.startsWith('pages/publish/'), `${file} → ${target}`);
    }
  }
});

test('预下载:进 play / poi-challenge / 主题详情时预下载 subpackagePlaykit,每页合计 est < 2MB', () => {
  const app = JSON.parse(read('app.json'));
  const rule = app.preloadRule;
  assert.deepEqual(rule['pages/play/index'], { network: 'all', packages: ['subpackagePlaykit', 'subpackageRoam'] });
  assert.deepEqual(rule['pages/roam/index'], { network: 'all', packages: ['subpackageRoam'] });
  assert.deepEqual(rule['pages/publish/fabu/index'], { network: 'all', packages: ['subpackagePublishkit'] });
  assert.deepEqual(rule['pages/publish/temp/index'], { network: 'all', packages: ['subpackagePublishkit'] });
  assert.deepEqual(rule['pages/play/poi-challenge/index'], { network: 'all', packages: ['subpackagePlaykit'] });
  assert.ok(rule['pages/topic/index/index'].packages.includes('subpackagePlaykit'));
  const { est } = measure();
  const byName = Object.fromEntries(app.subPackages.map((s) => [s.name || s.root, s.root]));
  for (const [page, r] of Object.entries(rule)) {
    const total = r.packages.reduce((s, name) => s + est[byName[name]], 0);
    assert.ok(total < PRELOAD_LIMIT, `${page} 预下载合计 est ${(total / KB).toFixed(0)}KB ≥ 2048KB`);
  }
});

test('共享件的逐字副本与 pages/play 规范实现一致', () => {
  // cy-illus 的副本由 launch-look-tokens-illus.test.js 统一钉住
  const pairs = ['utils/keep-numerals.js', 'utils/sensor-contract.js', 'utils/playkit-steps.js',
    'utils/playkit-questo.js'];
  for (const rel of pairs) {
    const canon = read('pages/play/' + rel).split('/pages/play/').join('/pages/playkit/');
    assert.equal(read('pages/playkit/' + rel), canon, rel + ' 副本与 pages/play 规范实现不一致');
  }
});

test('分包占位页:onLoad 只 reLaunch 回首页,wxml 不渲染实体内容(截图覆盖率按豁免处理)', () => {
  for (const root of ['pages/playkit', 'pages/publishkit']) {
    const calls = [];
    let def;
    const saved = { Page: global.Page, wx: global.wx };
    global.Page = (c) => { def = c; };
    global.wx = { reLaunch: (o) => calls.push(o) };
    try {
      const file = require.resolve('../../' + root + '/index/index.js');
      delete require.cache[file];
      require(file);
      def.onLoad();
    } finally {
      global.Page = saved.Page;
      global.wx = saved.wx;
    }
    assert.deepEqual(calls, [{ url: '/pages/index/index' }], root);
    const wxml = read(root + '/index/index.wxml').replace(/<!--[\s\S]*?-->/g, '').trim();
    assert.match(wxml, /^<view class="[^"]*"><\/view>$/, root);
    const ex = require('../../scripts/uiaudit/coverage-exemptions.json').exemptions.find((e) => e.pagePath === root + '/index/index');
    assert.ok(ex && ex.reason && ex.altVerification, root);
  }
});

// 2026-11-22 主包瘦身:被 2~3 个分包同步 require 的纯工具 / 纯展示组件各放一份副本到使用它的分包
// (分包之间不能同步 require,放主包又会把主包顶过 2MB)。入选条件:不发请求、没有模块级可变状态,
// 所以多份实例与原来共用一份等价。第一份是规范实现,改动必须同步到同组每一份——本用例逐字比对,
// 只把相对路径 / 本包绝对路径归一(目录深度不同,../ 的个数不同)。
// 发请求或有模块级状态的共享件(game-session-client、theme-records.js、cast-config…)不复制,留在主包。
const COPY_GROUPS = [
  ['pages/play/components/cy/theme-records', 'pages/topic/components/cy/theme-records'],
  ['pages/topic/utils/voice-enrollment-journal.js', 'pages/merchant/utils/voice-enrollment-journal.js'],
  ['pages/play/utils/station-image.js', 'pages/topic/utils/station-image.js'],
  ['pages/play/utils/wxs/station-title.wxs', 'pages/topic/utils/wxs/station-title.wxs'],
  ['pages/merchant/utils/pixel-portrait.js', 'pages/topic/utils/pixel-portrait.js'],
  ['pages/club/utils/topic-cancellation-intent.js', 'subpackageA/utils/topic-cancellation-intent.js'],
  ['subpackageMember/utils/template-market.js', 'subpackageA/utils/template-market.js'],
  ['pages/team/utils/team-applicant-rows.js', 'subpackageRoam/utils/team-applicant-rows.js'],
  ['pages/topic/components/cy/npc-avatar', 'subpackageMember/components/cy/npc-avatar'],
  ['pages/coop/utils/coop-invite-request.js', 'pages/topic/utils/coop-invite-request.js', 'subpackageMember/utils/coop-invite-request.js'],
  ['pages/play/components/cy/dot-qr', 'subpackageMember/components/cy/dot-qr'],
  ['pages/play/utils/dot-qr.js', 'subpackageMember/utils/dot-qr.js'],
  ['pages/merchant/components/cy/timeline', 'pages/club/components/cy/timeline', 'subpackageMember/components/cy/timeline'],
  ['pages/topic/utils/refund-tiers.js', 'pages/activity/utils/refund-tiers.js', 'subpackageMember/utils/refund-tiers.js'],
  ['pages/play/utils/ticket-wallet-url.js', 'subpackageJourney/utils/ticket-wallet-url.js'],
  ['pages/playkit/components/cy/spin-card', 'subpackageP3/components/cy/spin-card'],
  ['pages/publish/utils/publish/theme-look.js', 'pages/publishkit/utils/publish/theme-look.js'],
  ['pages/publish/components/topic-state-keys/rules.js', 'pages/publishkit/components/topic-state-keys/rules.js'],
  ['subpackageMember/images/route_free_cover.png', 'pages/club/images/route_free_cover.png',
    'subpackageA/images/route_free_cover.png', 'subpackageB/images/route_free_cover.png'],
  ['subpackageMember/images/mer1.jpg', 'pages/club/images/mer1.jpg', 'pages/gerenziliao/images/mer1.jpg',
    'pages/mylike/images/mer1.jpg', 'pages/publish/images/mer1.jpg'],
];
// 这些原主包路径不得再出现(防止有人把副本又放回主包,主包重新超限)
const RETIRED_MAIN = ['utils/topic-route-preview.js', 'components/cy/theme-records', 'utils/orient-score-view.js',
  'utils/voice-enrollment-journal.js', 'utils/station-image.js', 'utils/wxs/station-title.wxs', 'style/pr-settings.wxss',
  'utils/pixel-portrait.js', 'utils/topic-cancellation-intent.js', 'utils/template-market.js', 'utils/team-applicant-rows.js',
  'components/cy/npc-avatar', 'utils/coop-invite-request.js', 'components/cy/dot-qr', 'utils/dot-qr.js', 'components/cy/timeline',
  'utils/refund-tiers.js', 'utils/ticket-wallet-url.js', 'components/cy/spin-card', 'images/route_free_cover.png', 'images/mer1.jpg'];

function copyFiles(entry) {
  const abs = path.join(ROOT, entry);
  if (!fs.statSync(abs).isDirectory()) return [''];
  return fs.readdirSync(abs).sort().map((name) => '/' + name);
}

function normalizedCopy(file) {
  const app = JSON.parse(read('app.json'));
  const roots = app.subPackages.map((s) => s.root.replace(/\/$/, ''));
  const own = roots.find((r) => file.startsWith(r + '/')) || '';
  const local = (p) => (own && (p === own || p.startsWith(own + '/')) ? '<PKG>' + p.slice(own.length) : p);
  const resolve = (spec) => local(path.posix.normalize(path.posix.join(path.posix.dirname(file), spec)));
  return read(file)
    .replace(/(["'])(\.\.?\/[^"'\n]*)\1/g, (m, q, spec) => q + '@' + resolve(spec) + q)
    .replace(/(["'(])\/([\w-]+(?:\/[\w-]+)*\/)/g, (m, q, p) => q + '/' + local(p.replace(/\/$/, '')) + '/');
}

test('分包副本:同组逐字一致(只归一路径),原主包路径已退场', () => {
  for (const group of COPY_GROUPS) {
    const [canon, ...copies] = group;
    const names = copyFiles(canon);
    for (const copy of copies) assert.deepEqual(copyFiles(copy), names, copy + ' 文件清单与 ' + canon + ' 不一致');
    for (const name of names) {
      const file = canon + name;
      if (/\.(png|jpe?g)$/.test(file)) {
        const bytes = fs.readFileSync(path.join(ROOT, file));
        for (const copy of copies) assert.ok(bytes.equals(fs.readFileSync(path.join(ROOT, copy + name))), copy + name);
        continue;
      }
      const want = normalizedCopy(file);
      for (const copy of copies) assert.equal(normalizedCopy(copy + name), want, `${copy + name} 与规范实现 ${file} 不一致`);
    }
  }
  for (const gone of RETIRED_MAIN) assert.equal(fs.existsSync(path.join(ROOT, gone)), false, gone + ' 不得回到主包');
  // 负控:改动其中一份必须判红
  const probe = normalizedCopy('pages/play/utils/station-image.js');
  assert.notEqual(probe.replace('module.exports', 'module.exports /* drift */'), normalizedCopy('pages/topic/utils/station-image.js'));
});

test('分包副本:不发请求、没有模块级可变状态(多份实例才与共用一份等价)', () => {
  for (const group of COPY_GROUPS) {
    for (const name of copyFiles(group[0])) {
      const file = group[0] + name;
      if (!/\.js$/.test(file)) continue;
      const src = graph.stripJsComments(read(file));
      assert.doesNotMatch(src, /\/api\/|wx\.request|\.sendRequest\(|method\s*:/, file + ' 发请求的模块不能复制');
      assert.doesNotMatch(src, /^(?:let|var)\s+\w+\s*=\s*(?:0|null|\[\]|\{\}|new\s)/m, file + ' 模块级可变状态不能复制');
      assert.doesNotMatch(src, /^const\s+\w+\s*=\s*new\s+(?:Map|Set)\b/m, file + ' 模块级缓存不能复制');
    }
  }
});
