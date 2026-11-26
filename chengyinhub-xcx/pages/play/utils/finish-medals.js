'use strict';
/* 完成页勋章堆(2026-10-22 业主:主题/玩法结束时多枚勋章叠放、可切换)。
   只放真拿到的:① 主题通关徽章 —— 后端 /api/play/nodes 的 reward.finishMedalName(全部完成才算);
   ② 本局真夺到的站点名次奖牌 —— 打卡回包 medalRank > 0 时记下的那些,且该站仍是已完成。
   ③ 主题自己配的勋章(2026-11-23 业主「路线有自己的勋章「一个安字」,通关屏却是一枚通用旗子」):主题规则 items 里 kind=MEDAL 的那些,
      名字 + 图由作者配,拿到后只在背包视图(/theme 的 contents / result.catalog)里 —— 原来这里只认 ①②,它们从没上过完成页。
      opts.theme = themeMedals(themeBag);legacy_ 前缀的是 ①② 的兼容副本,不重复列。
   ① 没配图(reward.finishMedalImg 空)时借同名勋章的图:先 ③ 再站点模板(nodes[].medalName 同名的 medalImg);都没有才回落字形。
   没有就返回空数组,完成页整块不出。 */
/** 背包视图里这一局真拿到的主题勋章:[{ id, name, img }]。contents = 手里有的;result = 结局快照(catalog × acquired)。 */
function themeMedals(view) {
  const v = view || {};
  const out = [];
  const seen = {};
  const take = (row, qty) => {
    if (!row || row.kind !== 'MEDAL' || !row.name || !(Number(qty) > 0) || seen[String(row.id)]) return;
    seen[String(row.id)] = true;
    out.push({ id: String(row.id), name: String(row.name), img: row.image || '' });
  };
  (Array.isArray(v.contents) ? v.contents : []).forEach((row) => take(row, row && row.quantity));
  const result = v.result || {};
  const acquired = result.acquired || {};
  (Array.isArray(result.catalog) ? result.catalog : []).forEach((row) => take(row, row && acquired[row.id]));
  return out;
}

function buildFinishMedals(opts) {
  const o = opts || {};
  const out = [];
  const reward = o.reward || {};
  const theme = Array.isArray(o.theme) ? o.theme : [];
  const artByName = {};
  theme.forEach((m) => { if (m && m.name && m.img && !artByName[m.name]) artByName[m.name] = m.img; });
  (o.nodes || []).forEach((n) => { if (n && n.medalName && n.medalImg && !artByName[n.medalName]) artByName[n.medalName] = n.medalImg; });
  const listed = {};
  if (o.allDone && reward.finishMedalName) {
    const name = String(reward.finishMedalName);
    listed[name] = true;
    out.push({ key: 'theme', name, img: reward.finishMedalImg || artByName[name] || '', sub: '通关 · 主题徽章', glyph: 'flag' });
  }
  theme.forEach((m) => {
    if (!m || !m.name || listed[m.name] || /^legacy_/.test(String(m.id))) return;
    listed[m.name] = true;
    out.push({ key: 'bag-' + m.id, name: m.name, img: m.img || '', sub: '主题勋章', glyph: 'flag' });
  });
  const doneIds = {};
  (o.nodes || []).forEach((n) => { if (n && n.done) doneIds[String(n.nodeId)] = true; });
  const seen = {};
  (o.won || []).forEach((m) => {
    if (!m || !doneIds[String(m.nodeId)] || seen[String(m.nodeId)]) return;
    seen[String(m.nodeId)] = true;
    const rank = Number(m.rank) > 0 ? Number(m.rank) : 0;
    out.push({ key: 'node-' + m.nodeId, name: m.name || '专属徽章', img: m.img || '', sub: (rank ? '第 ' + rank + ' 名 · ' : '') + '节点奖牌', glyph: 'star' });
  });
  return out;
}

/* 本局完成屏的主徽章(2026-11-22 业主:每条路线都是同一枚绿色对勾 → 换成这条路线自己的徽章)。
   与完成页勋章堆同一口径、同一顺序:主题通关徽章优先,其次主题自己配的勋章,再其次本局真夺到的第一枚站点奖牌;
   一枚都没有返回 null,屏上回落通用成功插图。 */
function pickEndingMedal(opts) {
  const first = buildFinishMedals(opts)[0];
  return first ? { name: first.name, img: first.img, glyph: first.glyph } : null;
}

module.exports = { buildFinishMedals, pickEndingMedal, themeMedals };
