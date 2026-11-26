'use strict';
// 2026-11-24 主人规则:每个玩法里「过」恒为成功绿、「没过」恒为危险红,不随路线外观 / 玩法皮肤的强调色变。
// 皮肤与路线外观会改写 --ok / --accent(--pk-embed-ok / --pk-embed-accent),所以判定样式只能读状态 token。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '../..');
const RULES = [
  ['pages/playkit/components/playkit-qa/index.wxss', ['.qa__opt.is-right', '.qa__opt.is-right::after', '.qa__pic.is-right .qa__pic-ring', '.qa__fb--ok', '.qa__fb--ok .qa__fb-h'], ['.qa__opt.is-wrong', '.qa__opt.is-wrong::after', '.qa__pic.is-wrong .qa__pic-ring']],
  ['pages/playkit/components/playkit-pricepair/index.wxss', ['.pp__poster.is-right .pp__tile'], ['.pp__poster.is-wrong .pp__tile']],
  ['pages/playkit/components/playkit-journey-check/index.wxss', ['.jc__fill.is-ok', '.jc__dc.is-ok', '.jc__verdict--ok'], ['.jc__fill.is-no', '.jc__dc.is-no', '.jc__verdict--no']],
  ['pages/playkit/components/playkit-photocheck/index.wxss', ['.pc__verdict--ok'], ['.pc__verdict--no']],
  ['pages/playkit/components/playkit-hangman/index.wxss', ['.hm__cell.is-ok', '.hm__fb'], ['.hm__in.is-wrong', '.hm__err']],
  ['pages/playkit/style/letter-pool.wxss', ['.lp__slot.is-ok'], ['.lp__slot.is-wrong']],
  ['pages/playkit/components/playkit-match/index.wxss', ['.ma__anchor.is-right, .ma__line.is-right', '.ma__fb.is-ok'], ['.ma__fb.is-no']],
  ['pages/playkit/components/playkit-sort/index.wxss', ['.so__row.is-right .so__no', '.so__fb.is-ok'], ['.so__fb.is-no']],
  ['pages/playkit/components/playkit-classify/index.wxss', ['.cf__fb.is-ok'], ['.cf__fb.is-no']],
  ['pages/playkit/components/playkit-accusation/index.wxss', [], ['.ac__end--bad .ac__vt', '.ac__err']],
  ['pages/playkit/components/playkit-hidden/index.wxss', ['.hd__dot', '.hd__dot::after', '.hd__chip.is-found'], []],
  ['pages/playkit/components/playkit-typein/index.wxss', ['.ti__done'], []],
];

function bodyOf(css, selector) {
  // 选择器可以单独成条,也可以在一组「a, b { … }」里
  const i = [' {', '{', ', '].map((t) => css.indexOf(selector + t)).filter((n) => n >= 0).sort((x, y) => x - y)[0];
  assert.ok(i === undefined || !/[\w-]/.test(css[i - 1] || ''), 'selector boundary ' + selector);
  assert.ok(i >= 0, 'missing rule ' + selector);
  const open = css.indexOf('{', i);
  return css.slice(open + 1, css.indexOf('}', open));
}

for (const [file, pass, fail] of RULES) {
  test(`pass is success green and fail is danger red: ${path.basename(path.dirname(file))}`, () => {
    const css = fs.readFileSync(path.join(ROOT, file), 'utf8');
    for (const sel of pass) {
      const body = bodyOf(css, sel);
      assert.match(body, /var\(--cy-color-status-success\)/, sel);
      assert.doesNotMatch(body, /var\(--(ok|accent|lk-a|pk-embed-[\w-]+)\b/, sel);
    }
    for (const sel of fail) {
      const body = bodyOf(css, sel);
      assert.match(body, /var\(--cy-color-status-danger\)/, sel);
      assert.doesNotMatch(body, /var\(--(ok|accent|lk-a|pk-embed-[\w-]+)\b/, sel);
    }
  });
}
