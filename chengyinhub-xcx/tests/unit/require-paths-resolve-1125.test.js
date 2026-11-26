'use strict';
// 2026-11-25 发布前走查:会员页 / 通行证揭晓页白屏 —— 分包里拷过去的 cy-frames 仍按 pages/play 的层级写
// require('../../../../utils/…'),多退一层出了小程序根目录,真机 "can not find module"。
// 守住:小程序代码里每个相对 require 都必须落在项目内、且文件真实存在。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '../..');
const SKIP = new Set(['node_modules', 'tests', 'scripts', 'miniprogram_npm', '.git']);

function walk(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (name.endsWith('.js')) out.push(p);
  }
  return out;
}

test('every relative require in mini-program code resolves to a file inside the project', () => {
  const broken = [];
  for (const file of walk(ROOT, [])) {
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/require\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g)) {
      const target = path.resolve(path.dirname(file), m[1]);
      const inside = target.startsWith(ROOT + path.sep);
      const exists = [target, target + '.js', path.join(target, 'index.js'), target + '.json'].some(c => fs.existsSync(c) && fs.statSync(c).isFile());
      if (!inside || !exists) broken.push(path.relative(ROOT, file) + ' -> ' + m[1]);
    }
  }
  assert.deepEqual(broken, []);
});
