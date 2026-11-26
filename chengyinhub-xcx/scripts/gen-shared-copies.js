#!/usr/bin/env node
'use strict';
/* gen-shared-copies.js —— 由唯一规范源生成分包副本(AUDIT-1122 A5,2026-11-22)
 *
 * 小程序分包之间不能互相 require,共享件只能在每个分包放一份副本。以前副本靠手抄、靠测试钉
 * 「逐字相同」;本脚本把副本变成生成物:规范源 + scripts/shared-copies.json 的家族清单 ⇒ 副本。
 *
 *   node scripts/gen-shared-copies.js            同 --check
 *   node scripts/gen-shared-copies.js --check    副本与生成结果不一致则列出并退出 1
 *   node scripts/gen-shared-copies.js --write    按规范源重写全部副本
 *
 * 每个家族可选的改写(只做这两种,其余逐字复制):
 *   rebaseRelativeRequires  require('../…') 指向家族目录之外的文件时,按副本所在位置重算相对路径
 *   replace                 [[from, to], …] 字面量替换(如分包根路径 '/pages/play/' → '/pages/playkit/')
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MANIFEST = path.join(__dirname, 'shared-copies.json');
const RE_REL_REQUIRE = /(\brequire\(\s*)(['"])(\.{1,2}\/[^'"]+)\2/g;

function render(src, family, file, dest) {
  let out = src;
  if (family.rebaseRelativeRequires && /\.(js|wxs)$/.test(file)) {
    const fromDir = path.posix.dirname(path.posix.join(family.source, file));
    const toDir = path.posix.dirname(path.posix.join(dest, file));
    out = out.replace(RE_REL_REQUIRE, (all, head, q, spec) => {
      const target = path.posix.normalize(path.posix.join(fromDir, spec));
      if (target === family.source || target.startsWith(family.source + '/')) return all; // 家族内部:原样
      let rel = path.posix.relative(toDir, target);
      if (!rel.startsWith('.')) rel = './' + rel;
      return head + q + rel + q;
    });
  }
  for (const [from, to] of family.replace || []) out = out.split(from).join(to);
  return out;
}

/** plan(root, manifest) ⇒ [{ dest, expected, actual }] 每个副本文件的期望内容与现状(null = 不存在) */
function plan(root = ROOT, manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'))) {
  const out = [];
  for (const family of manifest.families) {
    for (const file of family.files) {
      const src = fs.readFileSync(path.join(root, family.source, file), 'utf8');
      for (const dest of family.copies) {
        const rel = path.posix.join(dest, file);
        const abs = path.join(root, rel);
        out.push({
          family: family.name, dest: rel,
          expected: render(src, family, file, dest),
          actual: fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null,
        });
      }
    }
  }
  return out;
}

function stale(items) { return items.filter((x) => x.actual !== x.expected); }

function write(root, items) {
  for (const x of stale(items)) {
    fs.mkdirSync(path.dirname(path.join(root, x.dest)), { recursive: true });
    fs.writeFileSync(path.join(root, x.dest), x.expected);
  }
}

module.exports = { plan, stale, write, render };

if (require.main === module) {
  const items = plan();
  const bad = stale(items);
  if (process.argv.includes('--write')) {
    write(ROOT, items);
    console.log(`gen-shared-copies: ${bad.length} 个副本已重写,共 ${items.length} 个`);
    process.exit(0);
  }
  for (const x of bad) console.error(`stale copy: ${x.dest} (family ${x.family})`);
  console.log(`gen-shared-copies: ${items.length} 个副本,${bad.length} 个与规范源不一致`);
  process.exit(bad.length ? 1 : 0);
}
