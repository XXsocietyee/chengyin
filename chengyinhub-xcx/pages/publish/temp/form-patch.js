'use strict';

/* 改一个字段时只把变了的字段放进 setData。删掉整个顶层键时才回写整份 advanced。 */
function advancedFieldPatch(before, next) {
  const prior = before || {};
  const patch = {};
  const seen = {};
  const plain = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
  let removed = false;
  Object.keys(prior).concat(Object.keys(next || {})).forEach((key) => {
    if (seen[key]) return;
    seen[key] = true;
    if (!Object.prototype.hasOwnProperty.call(next, key)) { removed = true; return; }
    if (JSON.stringify(prior[key]) === JSON.stringify(next[key])) return;
    const left = prior[key];
    const right = next[key];
    if (!plain(left) || !plain(right)) { patch['advanced.' + key] = right; return; }
    const childSeen = {};
    let childRemoved = false;
    Object.keys(left).concat(Object.keys(right)).forEach((child) => {
      if (childSeen[child]) return;
      childSeen[child] = true;
      if (!Object.prototype.hasOwnProperty.call(right, child)) { childRemoved = true; return; }
      if (JSON.stringify(left[child]) !== JSON.stringify(right[child])) patch['advanced.' + key + '.' + child] = right[child];
    });
      if (childRemoved) {
        Object.keys(patch).forEach((path) => { if (path.indexOf('advanced.' + key + '.') === 0) delete patch[path]; });
        patch['advanced.' + key] = right;
      }
  });
  if (removed) return { advanced: next };
  return Object.keys(patch).length ? patch : null;
}

module.exports = { advancedFieldPatch };
