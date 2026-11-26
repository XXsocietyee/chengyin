'use strict';
/* gen-shared-copies —— 分包副本由规范源生成(AUDIT-1122 A5,2026-11-22) */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const gen = require('../../scripts/gen-shared-copies.js');

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-copies-'));
  const put = (rel, body) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), body); };
  put('utils/motion.js', 'module.exports = 1;');
  put('pages/play/components/x/index.js',
    "const m = require('../../../../utils/motion.js');\nconst a = require('./art.js');\nconst url = '/pages/play/x';\n");
  put('pages/play/components/x/art.js', 'module.exports = 2;');
  const manifest = { families: [{
    name: 'x', source: 'pages/play/components/x', files: ['index.js', 'art.js'], rebaseRelativeRequires: true,
    replace: [['/pages/play/', '/pages/playkit/']],
    copies: ['pages/playkit/components/x', 'subA/components/x'],
  }] };
  return { dir, manifest };
}

test('A5:生成的副本按所在深度重算外部 require,家族内 require 与其余内容逐字保留', () => {
  const { dir, manifest } = fixture();
  try {
    gen.write(dir, gen.plan(dir, manifest));
    const deep = fs.readFileSync(path.join(dir, 'pages/playkit/components/x/index.js'), 'utf8');
    const shallow = fs.readFileSync(path.join(dir, 'subA/components/x/index.js'), 'utf8');
    assert.match(deep, /require\('\.\.\/\.\.\/\.\.\/\.\.\/utils\/motion\.js'\)/);
    assert.match(shallow, /require\('\.\.\/\.\.\/\.\.\/utils\/motion\.js'\)/);
    assert.match(shallow, /require\('\.\/art\.js'\)/);
    assert.match(shallow, /'\/pages\/playkit\/x'/);
    // 生成的相对路径真的能解析到同一个模块
    assert.equal(require(path.join(dir, 'subA/components/x/index.js')) !== undefined, true);
    assert.equal(fs.readFileSync(path.join(dir, 'subA/components/x/art.js'), 'utf8'), 'module.exports = 2;');
    assert.equal(gen.stale(gen.plan(dir, manifest)).length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('A5 负控:手改副本或缺副本都会被 --check 判出', () => {
  const { dir, manifest } = fixture();
  try {
    gen.write(dir, gen.plan(dir, manifest));
    fs.appendFileSync(path.join(dir, 'subA/components/x/art.js'), '// hand edit');
    fs.rmSync(path.join(dir, 'pages/playkit/components/x/index.js'));
    const bad = gen.stale(gen.plan(dir, manifest)).map((x) => x.dest).sort();
    assert.deepEqual(bad, ['pages/playkit/components/x/index.js', 'subA/components/x/art.js']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('A5:仓库里登记的副本全部等于生成结果', () => {
  const items = gen.plan();
  assert.ok(items.length >= 29);
  assert.deepEqual(gen.stale(items).map((x) => x.dest), []);
});
