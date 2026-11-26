'use strict';
// L09-119:parseHtml 的标签名锚定到词边界,<abbr/<pre/<link 不被当成 <a/<p/<li 注入样式。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

for (const [rel, kind] of [['subpackageA/components/scene-how-to-play-detail/index.js', 'component'], ['subpackageA/pages/infomationdetail/infomationdetail.js', 'page']]) {
  test(`${kind} parseHtml anchors tag names`, () => {
    const file = path.resolve(__dirname, '../..', rel);
    let def;
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), { Component: (d) => { def = d; }, Page: (d) => { def = d; },
      getApp: () => ({ globalData: {}, getImgUrl: (x) => x }), wx: {}, require: createRequire(file), setTimeout, clearTimeout, console }, { filename: file });
    const parse = (def.methods || def).parseHtml;
    const out = JSON.stringify(parse.call({}, '<abbr>x</abbr><pre>y</pre><a href="#">z</a><p>w</p>'));
    assert.match(out, /<abbr>x/);
    assert.match(out, /<pre>y/);
    assert.match(out, /<a style=/);
    assert.match(out, /<p style=/);
  });
}
