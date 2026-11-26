const { page } = require('../cloud-ten-runtime');
const { createMonthlyRecapClient } = require('../utils/features/monthly-recap-client');
const { toTimestamp } = require('../../utils/datetime');
const occurredAt = item => toTimestamp(item.occurredAtMs == null ? item.occurredAt : item.occurredAtMs);
const COVERAGE = '仅权威完成路线会话、主题首次通关、已结算漫游地点与本人有效城市签；不从报名或客户端进度推测完成';
function shanghai(ms) { return new Date(Number(ms) + 8 * 3600000); }
function thisMonth() { const d = shanghai(Date.now()); return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0'); }
function shift(month, delta) { const [y, m] = month.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + delta, 1)); return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0'); }
// 周柱按已读页累计,上海日期分到第 1–5 周;当月还没读完不画,读完后的后续页不再丢掉前面的周
function bars(counts) {
  const max = Math.max(...counts);
  if (!(max > 0)) return [];
  return counts.map((count, i) => ({ label: '第' + (i + 1) + '周', count, height: Math.round(count / max * 220), isMax: count === max }));
}
// L09-060:next() 只替换当前可见记录。周次按 id 累计,末页用全部已读周,未读完的下一页保留已经画出的周柱
function recapPatch(page, value, reset) {
  const items = value.items.map(item => { const ms = occurredAt(item); const d = shanghai(ms); return Object.assign({}, item, { dateText: Number.isFinite(Number(ms)) ? (d.getUTCMonth() + 1) + '/' + d.getUTCDate() : '' }); });
  if (reset || !page._weekCounts) { page._weekCounts = [0, 0, 0, 0, 0]; page._weekSeen = new Set(); }
  items.forEach(item => {
    const id = String(item.id);
    if (page._weekSeen.has(id)) return;
    page._weekSeen.add(id);
    const ms = occurredAt(item);
    if (Number.isFinite(Number(ms))) page._weekCounts[Math.min(4, Math.floor((shanghai(ms).getUTCDate() - 1) / 7))]++;
  });
  const weeks = value.hasMore ? (reset ? [] : (page.data && page.data.weeks) || []) : bars(page._weekCounts);
  return { items, hasMore: value.hasMore, counts: value.counts, coverage: COVERAGE, weeks, weekPicked: -1, weeksLabel: weeks.map(w => w.label + ' ' + w.count + ' 次').join('，') };
}
Page(page({
  data: {"kindIndex": 0, "kinds": ["路线", "首次地点", "城市签"], "counts": null, "coverage": "", "monthLabel": "", "isCurrentMonth": true, "weeks": [], "weekPicked": -1, "weeksLabel": ""},
  client: createMonthlyRecapClient,
  // L09-061:切走前记下同一账号的月份和已选类型(含「路线」);回来由 runtime resume 原样放回,不重新请求
  hold() {
    if (!this._identity || !this._month || !Number.isInteger(this.data.kindIndex)) return;
    if (this.data.busy || this.data.status === 'loading') return;
    this._heldView = { identity: this._identity, month: this._month, kindIndex: this.data.kindIndex, weekCounts: this._weekCounts ? this._weekCounts.slice() : null, weekSeen: this._weekSeen ? [...this._weekSeen] : null, data: JSON.parse(JSON.stringify(this.data)) };
  },
  resume() {
    const held = this._heldView;
    if (!held || held.identity !== this._identity || !held.month || !Number.isInteger(held.kindIndex)) return false;
    this._month = held.month; this._kindIndex = held.kindIndex; this._viewIdentity = this._identity;
    this._weekCounts = held.weekCounts ? held.weekCounts.slice() : null; this._weekSeen = held.weekSeen ? new Set(held.weekSeen) : null;
    const data = JSON.parse(JSON.stringify(held.data)); data.kindIndex = held.kindIndex; data.busy = false;
    this.setData(data);
    return true;
  },
  show(query) {
    const keep = !!(this._month && this._viewIdentity === this._identity);
    const month = keep ? this._month : /^\d{4}-\d{2}$/.test(query.month || '') && query.month <= thisMonth() ? query.month : thisMonth();
    if (!keep) this._kindIndex = 0;
    this.setData({ kindIndex: Number.isInteger(this._kindIndex) ? this._kindIndex : 0 });
    this._viewIdentity = this._identity;
    this.setMonth(month);
  },
  methods: {
    chooseMonth(event) { this._month = event.detail.value.slice(0, 7); this.refresh(); },
    chooseKind(event) { const index = Number(event.detail.value); this._kindIndex = index; this.setData({ kindIndex: index }); this.refresh(); },
    refresh() { return this.run(() => this.client.load(this._month, ['routes', 'places', 'stamps'][this.data.kindIndex]), value => recapPatch(this, value, true)); },
    next() { return this.run(() => this.client.next(), value => recapPatch(this, value, false)); },
    setMonth(month) { const [y, m] = month.split('-'); this._month = month; this.setData({ monthLabel: y + ' 年 ' + Number(m) + ' 月', isCurrentMonth: month >= thisMonth() }); this.refresh(); },
    prevMonth() { if (!this.data.busy) this.setMonth(shift(this._month, -1)); },
    nextMonth() { if (!this.data.busy && !this.data.isCurrentMonth) this.setMonth(shift(this._month, 1)); },
    pickKind(event) { const index = Number(event.currentTarget.dataset.index); if (this.data.busy || index === this.data.kindIndex) return; this._kindIndex = index; this.setData({ kindIndex: index }); this.refresh(); },
    pickWeek(event) { this.setData({ weekPicked: Number(event.currentTarget.dataset.index) }); }
  }
}));
