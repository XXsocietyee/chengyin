'use strict';
// 2026-11-24 主人规则(FIXA item 1):主题路线里「过 / 对」恒为成功绿、「没过 / 错」恒为危险红,
// 任何外观(纸本 / 末世 2077 / 星尘 / 手绘 …)、任何配色、任何玩法皮肤都一样。
// 旧代码里证据表行(qa__tr)、规则签(qa__rule.is-hot)、旅程检定优劣签、以物换物达成、留言完成、盲品结语
// 读的是 --ok / --accent,而路线外观把 --pk-embed-ok 设成 --lk-a(路线强调色)→ 路线 07 对错都是红。
// 这里扫描全部 playkit 组件:凡是对 / 错状态的规则,只能读 status-success / status-danger。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '../..');
const KIT_DIR = path.join(ROOT, 'pages/playkit/components');
const VAR_LEAK = /var\(--(ok|accent|lk-a|lk-ok|pk-embed-[\w-]+|look-a|atmo-[\w-]+)\b/;
const PASS_CLASS = /(\.is-(right|ok|met|held)|--(ok|good|hit))\b/;
const FAIL_CLASS = /(\.is-(wrong|no|failed|hot)|--(no|bad|miss))\b/;

function rules(css) {
  const out = [];
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(clean))) out.push({ sel: m[1].trim(), body: m[2] });
  return out;
}
const colourBody = (body) => /(^|;|\s)(color|background|background-color|border|border-color|box-shadow)\s*:/.test(body);

function kitFiles() {
  return fs.readdirSync(KIT_DIR)
    .filter((d) => d.startsWith('playkit-'))
    .map((d) => path.join(KIT_DIR, d, 'index.wxss'))
    .filter((f) => fs.existsSync(f));
}

test('every playkit: correct / passed states read status-success, wrong / failed read status-danger', () => {
  const problems = [];
  let checked = 0;
  for (const file of kitFiles()) {
    for (const { sel, body } of rules(fs.readFileSync(file, 'utf8'))) {
      if (sel.startsWith('@') || !colourBody(body)) continue;
      const isPass = PASS_CLASS.test(sel);
      const isFail = FAIL_CLASS.test(sel);
      if (!isPass && !isFail) continue;
      // 只有「对 / 过」或「错 / 没过」的着色规则才算;不染色的(动画、透明度)跳过
      if (!/var\(--cy-color-status-|var\(--(ok|accent|lk-a)\b|#[0-9a-fA-F]{3,8}|rgba?\(/.test(body)) continue;
      checked++;
      const rel = path.relative(ROOT, file) + ' ' + sel;
      if (VAR_LEAK.test(body)) problems.push(rel + ' reads a route / skin accent: ' + body.trim());
      if (isPass && !isFail && /var\(--cy-color-status-danger\b/.test(body)) problems.push(rel + ' pass state uses danger');
      if (isFail && !isPass && /var\(--cy-color-status-success\b/.test(body)) problems.push(rel + ' fail state uses success');
    }
  }
  assert.ok(checked >= 30, 'scanned verdict rules: ' + checked);
  assert.deepEqual(problems, []);
});

test('the audited rows map exactly to success / danger tokens', () => {
  const EXPECT = [
    ['playkit-qa', '.qa__tr.is-wrong .qa__cells', 'danger'],
    ['playkit-qa', '.qa__tr.is-wrong .qa__dot', 'danger'],
    ['playkit-qa', '.qa__tr.is-right .qa__cells', 'success'],
    ['playkit-qa', '.qa__tr.is-right .qa__dot', 'success'],
    ['playkit-qa', '.qa__rule.is-hot', 'danger'],
    ['playkit-journey-check', '.jc__tag--good', 'success'],
    ['playkit-journey-check', '.jc__tag--bad', 'danger'],
    ['playkit-journey-check', '.jc__mod.is-held .jc__mod-v', 'success'],
    ['playkit-barter', '.bt__goal.is-met', 'success'],
    ['playkit-barter', '.bt__goal.is-failed', 'danger'],
    ['playkit-note', '.nt__done', 'success'],
    ['playkit-blindtaste', '.bt__foot', 'success'],
  ];
  for (const [kit, sel, kind] of EXPECT) {
    const all = rules(fs.readFileSync(path.join(KIT_DIR, kit, 'index.wxss'), 'utf8'));
    const hit = all.filter((r) => r.sel.split(',').map((s) => s.trim()).includes(sel) && colourBody(r.body));
    assert.ok(hit.length, kit + ' missing ' + sel);
    for (const r of hit) {
      assert.match(r.body, new RegExp('var\\(--cy-color-status-' + kind + '\\)'), kit + ' ' + sel);
      assert.doesNotMatch(r.body, VAR_LEAK, kit + ' ' + sel);
    }
  }
});

test('route looks feed --pk-embed-ok from status-success and no playkit reads the skin --ok', () => {
  // 皮肤表 --ok 仍逐字是原型值(playkit-fidelity 契约),但任何玩法都不再读它:判定色只读状态 token
  const readers = [];
  for (const file of kitFiles().concat([path.join(ROOT, 'pages/playkit/style/letter-pool.wxss'), path.join(ROOT, 'pages/playkit/style/playkit.wxss')])) {
    const css = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    if (/var\(--ok\b/.test(css)) readers.push(path.relative(ROOT, file));
  }
  assert.deepEqual(readers, [], 'nothing reads the skin --ok');
  const HOSTS = ['pages/play/look-tokens.wxss', 'pages/publish/fabu/look-tokens.wxss'];
  for (const f of HOSTS) {
    const css = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const defs = css.match(/--pk-embed-ok\s*:[^;]+;/g) || [];
    assert.ok(defs.length, f + ' sets --pk-embed-ok');
    for (const d of defs) assert.match(d, /^--pk-embed-ok\s*:\s*var\(--cy-color-status-success\);$/, f);
  }
  // look 目录里每种外观(paper / survival=2077 / stardust / hand …)都只改 --lk-*,不重设 --pk-embed-ok
  const look = fs.readFileSync(path.join(ROOT, 'pages/play/look-tokens.wxss'), 'utf8');
  for (const m of look.matchAll(/\.look--([\w-]+)[^{]*\{([^}]*)\}/g)) {
    assert.doesNotMatch(m[2], /--pk-embed-ok|--ok\s*:/, 'look ' + m[1] + ' overrides ok');
  }
});

test('neutral (choice) states stay neutral: is-on reads ink, not success / danger', () => {
  const qa = rules(fs.readFileSync(path.join(KIT_DIR, 'playkit-qa/index.wxss'), 'utf8'));
  const on = qa.filter((r) => /^\.qa__tr\.is-on\b/.test(r.sel));
  assert.ok(on.length);
  for (const r of on) assert.doesNotMatch(r.body, /status-(success|danger)/, r.sel);
});
