// 勋章册(收集册 · 勋章):两个一排的列表;L09-132 起原 WebGL 墙面模式(切换钮 2026-10-27 已撤)整块删除,engine.js 留给 badge-3d。
// 身份卡目录的真源在库(growth_badge 里 asset_type='IDENTITY' 的行),本页消费 /api/badge/wall-v2。
// 分工:库存内容(名/宣言/下一步/category,运营可改不发版),本页只存渲染器——
//   徽记几何在 glyphs.js(程序化矢量,不是内容),配色轨道在 CAT_META。
// 对齐《Questify 城市身份卡与勋章增长系统 PRD 2026-07-12》:
//   身份卡不标稀有度只标类别(§7.6),类别复用墙面五档配色轨道(视觉系统不变);
//   FIRST_STEP / TOPIC_CLEAR 复用为 开始在场 / 完成一程(§12.4,已在 p5 迁移里于库中改名);
//   未获得的身份卡以锁定态展示可理解的下一步(§8.3,库 unlock_hint 列)。
const app = getApp();
const { recoverReadSession } = require('../../../../utils/session/login-reload.js');
const { resolveMenuChrome } = require('../../../../utils/nav-safe-area.js'); const pageMotion = require('../../../../utils/page-motion.js');
const ENAMEL = require('./enamel-pin.js'); const PIN_PX = 420; function pinIdOf(b) { return (b.glyph || 'DEFAULT') + (b.locked ? '_l' : ''); } // 2026-10-28 业主:珐琅徽章(enamel-pin.js)
const { chinaDateKey } = require('../../../../utils/datetime');
const { readReducedMotion } = require('../../../../utils/motion-preference.js');
const { isRecord, isRecordList } = require('../../../../utils/response-shape.js');
const { sendUiStateRequest } = require('../../../../utils/ui-state-request.js');
// 2026-10-27 owner P-30:不再按来源分组,一页两段 —— 上面已点亮,下面未解锁(段内保持接口顺序)
const BADGE_SECTIONS = [
  { key: 'lit', title: '已点亮', locked: false },
  { key: 'locked', title: '未解锁', locked: true },
];

// 类别 → 墙面配色轨道。信息层只消费 DS token；WebGL 内部颜色仍由引擎管理。
const CAT_META = [
  { key: 'EXPLORE', zh: '探索', css: 'var(--cy-color-status-success)' },
  { key: 'CREATE', zh: '创造', css: 'var(--cy-color-text-secondary)' },
  { key: 'ORGANIZE', zh: '组织', css: 'var(--cy-color-status-warning)' },
  { key: 'CONNECT', zh: '连接', css: 'var(--cy-color-text-tertiary)' },
  { key: 'CO-CREATE', zh: '共创', css: '' }
];

// 库 category → 配色轨道下标。库里写 CO_CREATE(下划线),CAT_META[4].key 是 CO-CREATE(连字符),
// 两种写法都显式归一到 4 —— 不靠巧合对上。未知类别落 0(探索),不崩。
const CATEGORY_TO_TRACK = {
  EXPLORE: 0, CREATE: 1, ORGANIZE: 2, CONNECT: 3,
  CO_CREATE: 4, 'CO-CREATE': 4, COCREATE: 4
};

// badge_code → 徽记几何。库里再多出身份卡也不必在此登记 —— glyphs.draw() 是
// (G[key] || G.DEFAULT),未知 key 自动落 DEFAULT 坐标点,不会空图;
// 但 DEFAULT 混在手绘徽记里一眼就是占位符,所以【墙上真有的卡都该有自己的徽记】。
const CODE_TO_GLYPH = {
  FIRST_STEP: 'arrival',            // 开始在场(PRD §12.4 复用旧 code)
  TOPIC_CLEAR: 'route',             // 完成一程(PRD §12.4 复用旧 code)
  ID_CITY_PROPOSAL: 'proposal',
  ID_FOUNDING_CIRCLE: 'founding',
  ID_JOINED_CIRCLE: 'joined',
  ID_GATHERING: 'gathering',
  ID_FOLLOWED_PATH: 'followed',
  ID_NEW_COMPANION: 'companion',
  ID_CITY_ALLIANCE: 'alliance',
  ID_CITY_LIT: 'citylit',
  ID_ROAM_FIRST: 'roam'             // 库里既有的第 11 枚,不在 PRD 十张之列
};
// 官方地点挑战的地点勋章(ROAM_POI_<地点ID>,每个地点一枚)统一用「点亮一隅」:城市网格里点亮的那一格就是这个地点。
function glyphFor(code) {
  const key = String(code || '');
  return CODE_TO_GLYPH[key] || (/^ROAM_POI_\d+$/.test(key) ? 'citylit' : undefined);
}

// 2026-10-30 收集册计数环(参考 mymind):固定 24 颗点,按已点亮比例点亮;右边一句宋体。
const RING_DOTS = 24;
const CN = ['零', '一', '两', '三', '四', '五', '六', '七', '八', '九', '十'];
function cnNum(n) { return n <= 10 ? CN[n] : (n < 20 ? '十' + (n === 10 ? '' : CN[n - 10].replace('两', '二')) : String(n)); }
function ringOf(lit, total) {
  const on = total > 0 ? Math.round(RING_DOTS * lit / total) : 0;
  const dots = [];
  for (let i = 0; i < RING_DOTS; i++) {
    const a = (i / RING_DOTS) * Math.PI * 2 - Math.PI / 2;
    dots.push({ i: i, x: +(50 + Math.cos(a) * 46).toFixed(2), y: +(50 + Math.sin(a) * 46).toFixed(2), lit: i < on, d: i * 45 });
  }
  const rest = Math.max(0, total - lit);
  const say = total ? cnNum(lit) + '枚勋章。\n' + (rest ? '还差' + cnNum(rest) + '枚。' : '一枚不少。') : '';
  return { dots: dots, say: say };
}

// 详情只展示日期,兼容后端 Date 的字符串与时间戳序列化。
function isValidDateParts(year, month, day) {
  if (month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonth[month - 1];
}

function displayDate(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return '';
    return chinaDateKey(value);
  }
  if (typeof value !== 'string') return '';

  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]);
    const day = Number(dateOnly[3]);
    return isValidDateParts(year, month, day) ? value : '';
  }

  const dateTime = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(\.\d{1,3})?(Z|[+-]\d{2}:?\d{2})?$/.exec(value);
  if (!dateTime) return '';
  const year = Number(dateTime[1]);
  const month = Number(dateTime[2]);
  const day = Number(dateTime[3]);
  const hour = Number(dateTime[4]);
  const minute = Number(dateTime[5]);
  const second = Number(dateTime[6]);
  if (!isValidDateParts(year, month, day) || hour > 23 || minute > 59 || second > 59) return '';

  const offset = dateTime[8];
  if (offset && offset !== 'Z') {
    const parts = /^([+-])(\d{2}):?(\d{2})$/.exec(offset);
    if (!parts || Number(parts[2]) > 23 || Number(parts[3]) > 59) return '';
  }
  return chinaDateKey(value);
}

// wall-v2 的 identity[] 一枚 → 引擎认识的 badge
function itemToBadge(item) {
  // 用「查出来的下标在 CAT_META 里存在吗」做判据,一次盖住 null / 未知类别 / 越界 /
  // category 撞上 Object.prototype 键名(如 'toString' 会查出个函数)四种情况。
  const t = CATEGORY_TO_TRACK[item.category];
  const track = CAT_META[t] ? t : 0;
  return {
    code: item.badgeCode || '',        // 稳定 ID:玩法侧带着它跳进来做回读,不能在映射里丢掉
    name: item.badgeName || '勋章', en: item.nameEn || '',
    iconUrl: '',                       // 勋章墙用统一单色徽记(程序化 glyph;正式素材经 glyph_url 替换)
    glyph: glyphFor(item.badgeCode),
    rarity: track,                     // 类别占用配色轨道,不是稀有度(PRD §7.6)
    tierKey: CAT_META[track].key, tierZh: CAT_META[track].zh,
    locked: !item.unlocked,
    time: displayDate(item.unlockTime),
    family: 'identity',
    source: CAT_META[track].zh,
    desc: item.statement || '',
    cond: item.unlockHint || ''
  };
}

// /api/medal/wall 的模板勋章由「已完成节点 + 模板 medalImg 非空」推导,
// 条件文案由后端明确返回。成就行(kind=achievement)来自 player_badge,
// 接口没有条件字段,不能套用城市节点条件或编造一条。

function medalToBadge(item) {
  const achievement = item.kind === 'achievement';
  const time = displayDate(item.getTime);
  if (achievement) {
    return {
      code: item.badgeCode || '',      // 同上:成就徽章也要能被 code 找回
      name: item.medalName || '成就徽章',
      style: item.style || 'glow',
      iconUrl: item.medalImg || '',
      glyph: glyphFor(item.badgeCode),
      rarity: 1, tierKey: 'ACHIEVEMENT', tierZh: '成就徽章',
      locked: false,
      time,
      family: 'achievement',
      source: '成长成就',
      desc: '',
      cond: ''
    };
  }
  return {
    name: item.medalName || '城市纪念章',
    style: item.style || 'glow',   // 模板勋章正是可选 enamel 的那类;漏了它「查看 3D」永不出现(review 抓出)
    iconUrl: item.medalImg || '',
    rarity: 1, tierKey: 'CITY', tierZh: '城市纪念章',
    locked: false,
    time,
    family: 'medal',
    source: '城市纪念章 · 节点通关',
    desc: '城市节点点亮奖励',
    cond: item.condition || ''
  };
}

function req(url, onFailure) {
  return new Promise(function (resolve) {
    sendUiStateRequest(app, url, {
      method: 'POST', data: {},
      success: function (res) { resolve(res || {}); },
      successStatusAbnormal: function (res, statusCode) { resolve({ code: statusCode || res && (res.code || res.statusCode) || 'fail', msg: res && res.msg }); },
      fail: function (res, statusCode) { const reply = Object.assign({}, res || {}, { code: statusCode || res && (res.code || res.statusCode) || 'fail' }); if (onFailure) onFailure(reply); resolve(reply); }
    });
  });
}

Page({
  data: {
    statusBarHeight: 44,
    sheetTop: 0,
    navBarHeight: (app.globalData && app.globalData.navBarHeight) || 44,
    loaded: false,
    loadFail: false,
    wallAuthRequired: false,
    wallAccessDenied: false,
    partialFail: false,
    badges: [],
    badgeGroups: [],
    iconBroken: {},
    focusCell: '', focusIdx: -1,
    unlockedCount: 0,
    sheetOn: false, pins: {},
    ringDots: [], ringOn: false, flyIdx: -1, fly: { show: false, on: false, src: '', style: '', name: '', meta: '', locked: false },
    sheet: { name: '', rarZh: '', rarColor: '', desc: '', time: '', source: '', cond: '' }
  },

  onLoad(query) {
    // 玩法完成后「查看收藏」会带上服务端给的 badgeCode —— 这里要真的去墙上找它，
    // 找不到就说找不到。否则这个入口只是把人送到一面墙前面，等于没有回读。
    this._focusCode = String((query && query.badgeCode) || '');
    try {
      const sys = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      const patch = { statusBarHeight: sys.statusBarHeight || 44, sheetTop: resolveMenuChrome(sys, app.globalData.menuButtonInfo).sheetTop };
      this.setData(patch);
    } catch (e) {}
    this.loadData();
  },

  onShow() {
    this._hidden = false;
    if (this._readSessionChanged) { this._readSessionChanged = false; this.loadData(); return; }
    if (this._wallOwner !== undefined && this._wallOwner !== String(app.getUserID && app.getUserID() || '')) this.loadData();
  },
  onHide() { this._hidden = true; },
  onUnload() {
    this._unloaded = true;
    if (this._ringTimer) clearTimeout(this._ringTimer);
    if (this._flyTimer) clearTimeout(this._flyTimer);
    if (this._focusTimer) clearTimeout(this._focusTimer);
    this._loadRequestId = (this._loadRequestId || 0) + 1;
  },

  loadData() {
    if (this._unloaded) return;
    const that = this;
    const owner = String(app.getUserID && app.getUserID() || '');
    if (this._wallOwner !== undefined && owner !== this._wallOwner) { this._badgeCache = []; this.setData({ badges: [], loaded: false, sheetOn: false }); }
    this._wallOwner = owner;
    if (!owner) { this.setData({ loaded: true, loadFail: true, wallAuthRequired: true, wallAccessDenied: false }); return; }
    const requestId = this._loadRequestId = (this._loadRequestId || 0) + 1;
    this.setData({ loadFail: false, partialFail: false, wallAuthRequired: false, wallAccessDenied: false });
    const recover = res => !that._unloaded && requestId === that._loadRequestId && recoverReadSession(that, app, res,
      function (anonymous) { this._loadRequestId++; this._wallOwner = undefined; this._badgeCache = []; this.setData({ badges: [], loaded: true, loadFail: true, sheetOn: false, wallAuthRequired: anonymous, wallAccessDenied: false }); }, that.loadData);
    Promise.all([req('/api/medal/wall', recover), req('/api/badge/wall-v2', recover)]).then(function (arr) {
      if (that._unloaded || requestId !== that._loadRequestId || owner !== String(app.getUserID && app.getUserID() || '')) return;
      const auth = arr.some(res => Number(res.code) === 401);
      const denied = arr.some(res => Number(res.code) === 403);
      if (auth || denied) {
        that._badgeCache = [];
        that.setData({ loaded: true, loadFail: true, wallAuthRequired: auth, wallAccessDenied: denied && !auth, badges: [], sheetOn: false });
        return;
      }
      const wall = (arr[0].code == '200' && isRecord(arr[0].data) && isRecordList(arr[0].data.medals)) ? arr[0].data : null;
      const wallV2 = (arr[1].code == '200' && isRecord(arr[1].data) && isRecordList(arr[1].data.identity)) ? arr[1].data : null;

      // 身份卡是本页主体,且目录已不在前端 —— wall-v2 挂了就报错,不静默显示一面没有身份卡的墙。
      // (纪念章还在也不行:那会让用户以为自己一张身份卡都没有,是撒谎不是降级。)
      if (!wallV2) {
        const empty = [];
        that._badgeCache = empty;
        that.setData({
          loaded: true, loadFail: true, partialFail: false,
          badges: empty, unlockedCount: 0, sheetOn: false,
          sheet: { name: '', rarZh: '', rarColor: '', desc: '', time: '', source: '', cond: '' }
        });
        return;
      }

      // 1) 身份卡:目录与点亮事实同源,都来自库(wall-v2 的 identity 层)。
      //    GROWTH/COLLECTION/HONOR 三层本页不渲染:成长六枚无徽记无宣言,
      //    纪念/荣誉两层是运营上传物(L3/L4),都不在本页范围。
      const list = wallV2.identity.map(itemToBadge);

      // 2) /api/medal/wall:模板勋章与成就行各自保留来源,不混入身份卡(PRD §3.2)
      (wall ? wall.medals : []).forEach(function (m) {
        list.push(medalToBadge(m));
      });
      that.applyBadges(list);
      if (!wall) {
        that.setData({
          partialFail: true,
          sheetOn: false,
          sheet: { name: '', rarZh: '', rarColor: '', desc: '', time: '', source: '', cond: '' },
        });
      } else {
        that.setData({ partialFail: false });
      }
    });
  },

  retryWall() {
    if (!this.data.wallAuthRequired) { this.loadData(); return; }
    if (this._wallLoginPending) return;
    this._wallLoginPending = true;
    const login = app.getUserID && app.getUserID() && typeof app.reLogin === 'function' ? app.reLogin()
      : typeof app.firstLogin === 'function' ? app.firstLogin() : null;
    Promise.resolve(login).then(result => {
      this._wallLoginPending = false;
      if (!this._unloaded && app.getUserID && app.getUserID() && !(result && result.ok === false)) this.loadData();
    }).catch(() => { this._wallLoginPending = false; });
  },

  /** 玩法侧「查看收藏」带来的 badgeCode:找到就记下它在列表里的位置,由 _showFocus 滚过去高亮。
   *  找不到(成长六枚等非身份卡本就不在这页)就不滚,也不加说明文字。
   *  L09-049 / L09-132:原「已在墙上 / 还没点亮 / 不是身份卡」那行字只在已删除的墙面模式里显示过。 */
  _resolveFocus(list) {
    if (!this._focusCode) { this._focusIdx = -1; return; }
    this._focusIdx = (list || []).findIndex((badge) => badge.code === this._focusCode);
  },

  applyBadges(list) {
    const unlockedCount = list.filter(function (badge) { return !badge.locked; }).length;
    const numbered = list.map(function (badge, idx) {
      return Object.assign({}, badge, { _idx: idx, pinId: pinIdOf(badge) });
    });
    const badgeGroups = BADGE_SECTIONS.map(function (sec) {
      return {
        key: sec.key,
        title: sec.title,
        items: numbered.filter(function (badge) { return !!badge.locked === sec.locked; }),
      };
    }).filter(function (group) { return group.items.length; });
    if (!this.data.badges.length) pageMotion.enter(this, 'pmList'); this._badgeCache = list; // 2026-10-23:列表首次到达时依次浮上来
    this._resolveFocus(list);
    const ring = ringOf(unlockedCount, list.length);
    this.setData({
      loaded: true,
      badges: list, iconBroken: {},
      badgeGroups: badgeGroups,
      unlockedCount: unlockedCount,
      ringDots: ring.dots, ringOn: false,
    });
    // 点阵进场:先全灰落定,下一拍挂 is-on,亮着的点按各自 transition-delay 一颗颗变红(纯过渡,不用 keyframes)
    clearTimeout(this._ringTimer);
    this._ringTimer = setTimeout(() => { if (!this._unloaded) this.setData({ ringOn: true }); }, 120);
    this._renderPins(list);
    this._showFocus();
  },

  _showFocus() {
    if (this._focusShown || !(this._focusIdx >= 0)) return;
    this._focusShown = true;
    const idx = this._focusIdx;
    this.setData({ focusCell: 'bw-cell-' + idx, focusIdx: idx });
    clearTimeout(this._focusTimer);
    this._focusTimer = setTimeout(() => { if (!this._unloaded) this.setData({ focusIdx: -1 }); }, 1600);
  },

  /** 双样式分流:enamel 徽章从墙上点开 3D 转台 */
  goBadge3d() {
    const sh = this.data.sheet || {};
    if (!sh.iconUrl && sh.pinId && !sh.locked) { // 2026-10-28 业主:珐琅勋章点开能转(badge-3d 的 pin 样式)
      wx.navigateTo({ url: '/subpackageP3/pages/badge-3d/index?style=pin&glyph=' + encodeURIComponent(sh.glyph) + '&name=' + encodeURIComponent(sh.name || '徽章') + '&rarity=' + (sh.rarity || 0) });
      return;
    }
    wx.navigateTo({ url: '/subpackageP3/pages/badge-3d/index?name=' + encodeURIComponent(sh.name || '徽章')
      + '&style=' + (sh.style || 'glow') + '&rarity=' + (sh.rarity || 0)
      + (sh.iconUrl ? '&img=' + encodeURIComponent(sh.iconUrl) : '') });
  },

  noop() {},

  openSheet(idx) {
    const b = this.data.badges[idx];
    if (!b) return;
    const meta = CAT_META[b.rarity] || CAT_META[0];
    this.setData({
      sheetOn: true,
      sheet: {
        style: b.style || 'glow', iconUrl: b.iconUrl || '', rarity: b.rarity || 0, pinId: pinIdOf(b), glyph: b.glyph || 'DEFAULT', locked: !!b.locked,
        name: b.name,
        rarZh: b.tierZh || meta.zh,
        rarColor: b.rarity === 4 ? 'var(--cy-color-status-danger)' : meta.css,
        desc: b.desc || '',
        time: b.locked ? '未点亮' : (b.time || '—'),
        source: b.source || '',
        cond: b.cond || ''
      }
    });
  },
  closeSheet() {
    if (!this.data.sheetOn) return;
    this.setData({ sheetOn: false });
  },

  /** x-fix2 M-2:单枚图片加载失败(地址签不出 / 404)只把这一枚降级,不报整页错 */
  onIconError(e) {
    const idx = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.idx : undefined;
    if (idx === undefined || idx === null || this.data.iconBroken[idx]) return;
    this.setData({ ['iconBroken.' + idx]: true });
  },

  onFbTap(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    this.openFly(idx);
  },

  // ── 点开:那一枚从格子里飞到屏幕中间(FLIP:先摆在原位,下一拍放开) ──
  openFly(idx) {
    const b = this.data.badges[idx];
    if (!b || this.data.fly.show) return;
    const src = b.iconUrl || this.data.pins[pinIdOf(b)] || '';
    if (!src) { this.openSheet(idx); return; }
    const that = this;
    this.createSelectorQuery().select('#bw-medal-' + idx).boundingClientRect().exec(function (res) {
      const r = res && res[0];
      if (!r || that._unloaded) return;
      let w = 375, h = 667;
      try { const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync(); w = info.windowWidth; h = info.windowHeight; } catch (e) {}
      const size = Math.round(w * 0.72), left = Math.round((w - size) / 2), top = Math.round(h * 0.42 - size / 2);
      const base = 'left:' + left + 'px;top:' + top + 'px;width:' + size + 'px;height:' + size + 'px;';
      const from = 'transform:translate(' + Math.round(r.left + r.width / 2 - (left + size / 2)) + 'px,' + Math.round(r.top + r.height / 2 - (top + size / 2)) + 'px) scale(' + (r.width / size).toFixed(3) + ');';
      that._flyFrom = base + from + 'transition:none;';
      that._flyBadge = b;
      const meta = b.locked ? (b.cond || '还没点亮') : (b.time || '已点亮');
      that.setData({ flyIdx: idx, fly: { show: true, on: false, src: src, style: that._flyFrom, name: b.name, meta: meta, locked: !!b.locked } });
      const reduced = readReducedMotion();
      clearTimeout(that._flyTimer);
      that._flyTimer = setTimeout(function () {
        if (that._unloaded) return;
        that.setData({ 'fly.on': true, 'fly.style': base + 'transform:none;transition:' + (reduced ? 'none' : 'transform .6s cubic-bezier(.2,.9,.25,1.06)') + ';' });
      }, 30);
    });
  },
  closeFly() {
    if (!this.data.fly.show) return;
    const that = this;
    this.setData({ 'fly.on': false, 'fly.style': (this._flyFrom || '').replace('transition:none;', 'transition:transform .42s cubic-bezier(.4,0,.2,1);') });
    clearTimeout(this._flyTimer);
    this._flyTimer = setTimeout(function () { if (!that._unloaded) that.setData({ flyIdx: -1, fly: { show: false, on: false, src: '', style: '', name: '', meta: '', locked: false } }); }, 420);
  },
  // 中间那枚再点一下:进 3D 转台(与原详情里的「查看 3D 徽章」同一条路);没点亮的不进
  onFlyPin() {
    const b = this._flyBadge;
    if (!b || b.locked) return;
    this.setData({ sheet: Object.assign({}, this.data.sheet, { style: b.style || 'glow', iconUrl: b.iconUrl || '', rarity: b.rarity || 0, pinId: pinIdOf(b), glyph: b.glyph || 'DEFAULT', locked: false, name: b.name }) });
    this.goBadge3d();
  },

  goExplore() {
    wx.switchTab({ url: '/pages/index/index' });
  },


  // 自动化自证用:注入受控的 wall-v2 identity[],走与线上同一条 itemToBadge 装配链路。
  // 目录已搬进库,本页不再留硬编码全集 —— fixture 由 driver 传入,
  // 这样断言的是真实映射(category→轨道、unlock_hint→cond、code→徽记),不是另一套演示码。
  __injectDemo(identity) {
    const list = (identity || []).map(itemToBadge);
    this.applyBadges(list);
    return list.length;
  },

  /** 2026-10-28 业主:珐琅徽章。没有上传图的徽记在隐藏的 2D canvas 上逐枚画好、转成临时图;
   *  同一枚(已点亮 / 未解锁各一张)整页只画一次,画失败的不再重试,格子里就空着底板位置。 */
  _renderPins(list) {
    const tried = this._pinTried || (this._pinTried = {});
    const todo = [], track = {};
    list.forEach(function (b) { const id = pinIdOf(b); track[id] = b.rarity; if (!b.iconUrl && !tried[id] && todo.indexOf(id) < 0) todo.push(id); });
    if (!todo.length || this._pinBusy) return;
    this._pinBusy = true;
    const that = this;
    wx.createSelectorQuery().in(this).select('#pinCanvas').fields({ node: true }).exec(function (res) {
      const canvas = res && res[0] && res[0].node;
      if (!canvas || that._unloaded) { that._pinBusy = false; return; }
      canvas.width = PIN_PX; canvas.height = PIN_PX;
      const ctx = canvas.getContext('2d');
      (function next(i) {
        if (i >= todo.length || that._unloaded) { that._pinBusy = false; if (!that._unloaded) that._renderPins(that.data.badges || []); return; }
        const id = todo[i];
        tried[id] = true;
        try { ENAMEL.render(ctx, PIN_PX, id.replace(/_l$/, ''), /_l$/.test(id), ENAMEL.optsFor(track[id])); } catch (e) { next(i + 1); return; }
        wx.canvasToTempFilePath({
          canvas: canvas, fileType: 'png', destWidth: PIN_PX, destHeight: PIN_PX,
          success(r) { if (!that._unloaded) that.setData({ ['pins.' + id]: r.tempFilePath }); },
          complete() { next(i + 1); }
        });
      })(0);
    });
  }
});
