'use strict';
/* package-graph-shipped —— 体积估算必须计入每个会上传的文件(AUDIT-1122 A1 / A3,2026-11-22)
 *
 * A1:旧估算只认 images/ 目录下被字面量引用的资源,pages/templatedetail(art/ 下 138 个媒体文件)
 *     与 subpackagePass(frames/ 序列帧)几乎整包不计,体积护栏对它们是瞎的。
 *     这里用临时小程序目录做行为测试:运行时拼路径引用的资源、任意目录名下的资源都必须计入。
 * A3:全部包合计 est 有棘轮与硬上限(scripts/baselines/package-size.json total)。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const graph = require('../../scripts/lib/package-graph.js');
const baseline = require('../../scripts/baselines/package-size.json').total;

const KB = 1024;

function fixture(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pkg-graph-'));
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body);
  }
  return dir;
}

function miniApp(extra) {
  return fixture(Object.assign({
    'app.json': JSON.stringify({
      pages: ['pages/index/index'],
      subPackages: [{ root: 'pkgA', pages: ['detail/index'] }],
    }),
    'project.config.json': JSON.stringify({
      packOptions: { ignore: [{ type: 'folder', value: 'pkgA/raw-src' }] },
    }),
    'app.js': 'App({});',
    'app.wxss': '',
    'sitemap.json': '{}',
    'pages/index/index.js': 'Page({});',
    'pages/index/index.json': '{}',
    'pages/index/index.wxml': '<view/>',
    'pkgA/detail/index.js': "Page({ cover(n) { return '/pkgA/art/props/' + n + '.png'; } });",
    'pkgA/detail/index.json': '{}',
    'pkgA/detail/index.wxml': '<image src="{{cover}}"/>',
    'pkgA/art/props/a.png': Buffer.alloc(30 * KB),
    'pkgA/frames/f01.webp': Buffer.alloc(20 * KB),
    'pkgA/raw-src/big.png': Buffer.alloc(500 * KB),
    'pkgA/unused/dead.js': 'module.exports = ' + JSON.stringify('x'.repeat(8 * KB)) + ';',
  }, extra || {}));
}

test('A1:运行时拼路径 / 非 images 目录下的资源全部计入所在包', () => {
  const dir = miniApp();
  try {
    const g = graph.build(dir);
    for (const f of ['pkgA/art/props/a.png', 'pkgA/frames/f01.webp']) {
      assert.ok(g.shipped.has(f), f + ' 应计入');
      assert.equal(g.reach.has(f), false, f + ' 不在依赖图里,reach 保持真实依赖语义');
    }
    const est = graph.estimate(g, dir);
    assert.ok(est.pkgA >= 50 * KB, `pkgA est ${est.pkgA}B 少算了资源`);
    assert.ok(g.packages.pkgA.bytes >= 50 * KB);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('A1:packOptions.ignore 的资源与依赖图走不到的代码仍不计', () => {
  const dir = miniApp();
  try {
    const g = graph.build(dir);
    assert.equal(g.files.has('pkgA/raw-src/big.png'), false);
    assert.equal(g.shipped.has('pkgA/unused/dead.js'), false);
    const est = graph.estimate(g, dir);
    assert.ok(est.pkgA < 60 * KB, `pkgA est ${est.pkgA}B 不该含被忽略或不可达的文件`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('A1 负控:分包加 300KB 动态引用的图片,est 随之增长', () => {
  const base = miniApp();
  const grown = miniApp({ 'pkgA/art/covers/big.jpg': Buffer.alloc(300 * KB) });
  try {
    const a = graph.estimate(graph.build(base), base).pkgA;
    const b = graph.estimate(graph.build(grown), grown).pkgA;
    assert.equal(b - a, 300 * KB);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
    fs.rmSync(grown, { recursive: true, force: true });
  }
});

test('A1:真实仓库里 templatedetail 与 subpackagePass 的媒体全部计入', () => {
  const g = graph.build();
  const est = graph.estimate(g);
  for (const pkg of ['pages/templatedetail', 'subpackagePass']) {
    let media = 0;
    for (const [f, info] of g.files) if (info.owner === pkg && !/\.(js|json|wxml|wxss|wxs)$/.test(f)) media += info.size;
    assert.ok(media > 1000 * KB, pkg + ' 媒体应超过 1MB(审计时 1.6–1.7MB)');
    assert.ok(est[pkg] >= media, `${pkg} est ${est[pkg]}B 小于其媒体字节 ${media}B`);
  }
});

test('A3:全部包合计 est 不超过棚线与硬上限', () => {
  const est = graph.estimate(graph.build());
  const total = Object.values(est).reduce((s, n) => s + n, 0);
  assert.ok(baseline.estCeilingBytes - baseline.estBytes <= 64 * KB, '合计棘轮余量不超过 64KB');
  assert.ok(baseline.estCeilingBytes <= baseline.estLimitBytes);
  assert.ok(total <= baseline.estCeilingBytes,
    `全部包 est 合计 ${(total / KB).toFixed(1)}KB 超过棘轮 ${(baseline.estCeilingBytes / KB).toFixed(1)}KB`);
  assert.ok(total <= baseline.estLimitBytes);
});
