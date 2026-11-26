// pages/playkit/utils/barter-plan.js —— 以物换物的本地预演(纯函数,可单测)
//
// 点一张交换卡只是**预演**:背包与目标在本机按同一套规则重算一遍,什么都不交;
// 「就这样换」才把整串 order 交给服务端 SUBMIT_BARTER 重放判定。
// 规则与服务端逐字同口径:每一步背包里必须有 give,拿走一个 give、放进一个 get;
// need / keep 都是「最后背包里有这一件」。本地预演只决定哪些卡能点、目标先亮哪颗,对错仍以服务端为准。

/** 契约里的十二个图标名;别的名字一律按没配图标处理(落回名字首字)。 */
const ICONS = ['clip', 'coaster', 'labels', 'strap', 'parcel', 'tape', 'book', 'key', 'ticket', 'bag', 'cup', 'letter'];

/** 从 start 依次走 order,返回最后的背包(按物品 id 计数)。走不通的那一步之后不再走,并标出第几步断了。 */
function replay(start, offers, order) {
  const bag = {};
  (start || []).forEach((id) => { bag[id] = (bag[id] || 0) + 1; });
  const byId = {};
  (offers || []).forEach((o) => { if (o && o.id) byId[o.id] = o; });
  let broken = -1;
  (order || []).some((offerId, i) => {
    const o = byId[offerId];
    if (!o || !(bag[o.give] > 0)) { broken = i; return true; }
    bag[o.give] -= 1;
    if (!bag[o.give]) delete bag[o.give];
    bag[o.get] = (bag[o.get] || 0) + 1;
    return false;
  });
  return { bag, broken };
}

/** 一个目标在这只背包里算不算达成。need / keep 都是「背包里有」。 */
function goalMet(goal, bag) {
  const id = goal && (goal.need || goal.keep);
  return !!id && (bag[id] || 0) > 0;
}

/** 背包计数 → 一行物品(按 items 的顺序排,同一件重复出现几次就摆几格)。 */
function bagRow(bag, items) {
  const row = [];
  const seen = {};
  (items || []).forEach((it) => {
    seen[it.id] = true;
    for (let i = 0; i < (bag[it.id] || 0); i += 1) row.push({ key: it.id + '-' + i, id: it.id, name: it.name || '', icon: ICONS.indexOf(it.icon) >= 0 ? it.icon : '', glyph: String(it.name || '').slice(0, 1) });
  });
  Object.keys(bag).forEach((id) => {
    if (seen[id]) return;
    for (let i = 0; i < bag[id]; i += 1) row.push({ key: id + '-' + i, id, name: id, icon: '', glyph: id.slice(0, 1) });
  });
  return row;
}

/** 两份 order 是否同一份计划。 */
function sameOrder(a, b) {
  const x = a || [];
  const y = b || [];
  return x.length === y.length && x.every((id, i) => id === y[i]);
}

/**
 * 整屏的派生视图。
 * @param cfg { items, start, goals, offers }
 * @param order 本地预演的 offer id 序列
 * @param receipt { lastOrder, failedGoals, lastFeedback, passed } 服务端回执;只有回执那份计划还等于当前预演时,目标才标红
 */
function view(cfg, order, receipt) {
  const c = cfg || {};
  const r = receipt || {};
  const items = c.items || [];
  const nameOf = {};
  const iconOf = {};
  items.forEach((it) => { nameOf[it.id] = it.name || ''; iconOf[it.id] = ICONS.indexOf(it.icon) >= 0 ? it.icon : ''; });
  const seq = order || [];
  const { bag } = replay(c.start, c.offers, seq);
  const startBag = replay(c.start, c.offers, []).bag;
  const confirmedWrong = !r.passed && seq.length > 0 && sameOrder(r.lastOrder, seq) && Array.isArray(r.failedGoals);
  const failed = confirmedWrong ? r.failedGoals : [];
  const goals = (c.goals || []).map((g) => {
    const met = goalMet(g, bag);
    return {
      id: g.id,
      label: g.label || '',
      met,
      state: met ? 'met' : (failed.indexOf(g.id) >= 0 ? 'failed' : 'open'),
    };
  });
  const offers = (c.offers || []).map((o) => {
    const step = seq.indexOf(o.id);
    const used = step >= 0;
    const usable = !used && (bag[o.give] || 0) > 0;
    return {
      id: o.id,
      key: o.key || '',
      give: o.give, get: o.get,
      giveName: nameOf[o.give] || '', getName: nameOf[o.get] || '',
      giveIcon: iconOf[o.give] || '', getIcon: iconOf[o.get] || '',
      used, step: used ? step + 1 : 0,
      usable,
      state: used ? 'used' : usable ? 'ready' : 'off',
    };
  });
  // 预演弄丢了要留着的东西:开局有、现在没了的那件 keep 物品
  const lost = (c.goals || []).filter((g) => g.keep && (startBag[g.keep] || 0) > 0 && !((bag[g.keep] || 0) > 0));
  const lostKeep = lost.length ? (nameOf[lost[0].keep] || '') : '';
  let wrongLine = '';
  if (confirmedWrong) {
    const firstFailed = goals.find((g) => g.state === 'failed');
    wrongLine = r.lastFeedback || (firstFailed ? '还没换到' + firstFailed.label : '');
  }
  return {
    goals,
    bag: bagRow(bag, items),
    offers,
    lostKeep,
    allMet: goals.length > 0 && goals.every((g) => g.met),
    wrongLine,
    canUndo: seq.length > 0,
    canSubmit: seq.length > 0,
  };
}

/** 点一张卡:能换才追加,否则原样返回(同一引用,调用方据此不 setData)。 */
function pick(cfg, order, offerId) {
  const seq = order || [];
  if (seq.indexOf(offerId) >= 0) return seq;
  const offer = ((cfg && cfg.offers) || []).find((o) => o.id === offerId);
  if (!offer) return seq;
  const { bag } = replay(cfg.start, cfg.offers, seq);
  if (!((bag[offer.give] || 0) > 0)) return seq;
  return seq.concat([offerId]);
}

/** 撤回上一步。 */
function undo(order) {
  const seq = order || [];
  return seq.length ? seq.slice(0, -1) : seq;
}

module.exports = { ICONS, replay, goalMet, bagRow, sameOrder, view, pick, undo };
