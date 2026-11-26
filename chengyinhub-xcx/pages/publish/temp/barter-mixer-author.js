/**
 * 模板编辑页 · 以物换物(barter)与调音台(mixer)的作者配置。
 *
 * 两段的服务端判定(SUBMIT_BARTER / SUBMIT_MIXER)与玩家端 kit 早就在,作者端一直没有入口。
 * 这里只往原 advancedConfigJson 里写服务端已接线的键,不新增接口:
 *   barter{enabled,title,items[{id,name,icon?}],start[itemId],goals[{id,label,need|keep}],
 *          offers[{id,key,give,get,fb?}],maxTries,xp}
 *   mixer{enabled,title,tracks[{id,label,muted}],answer,wrongReply,captionBefore,captionAfter,
 *         audioBefore,audioAfter,maxTries,xp}
 *
 * 界面不露这些键名。标量字段(标题 / 次数 / 奖励分 / 两句说明 / 音频地址)走页面通用的
 * onAdvancedField;文本行(物品名、目标名、换物提示、音轨名)走通用 updateAdvancedRow。
 * 这里只管**形状**:id 与换物标记自动给、引用不许悬空、答案跟着音轨走。
 *
 * ★ 秘密字段:每条换物的 fb、mixer 的 answer 与 wrongReply。它们存进配置、由服务端判定时用,
 *   公开投影一个字不下发(BarterGameplay.safeConfig / AdvancedGamePublicProjection#copyMixer),
 *   试玩预览也不带(advanced-game-preview 的 barter / mixer 两条)。
 */

const advancedGameConfig = require('../utils/publish/advanced-game-config.js');
const toast = require('../../../utils/toast.js');

const MAX_ITEMS = 10;
const MIN_ITEMS = 2;
const MAX_START = 6;
const MAX_GOALS = 3;
const MAX_OFFERS = 6;
const MIN_OFFERS = 2;
const MAX_TRACKS = 5;
const MIN_TRACKS = 2;
const OFFER_KEYS = 'ABCDEF'.split('');

/** 物品图标:键是服务端 BarterGameplay.ICONS 的值,字是给作者看的(玩家端画的是线条图)。 */
const ICON_LABELS = { clip: '回形针', coaster: '杯垫', labels: '标签', strap: '挂绳', parcel: '包裹',
  tape: '胶带', book: '书', key: '钥匙', ticket: '票', bag: '布袋', cup: '杯子', letter: '信' };
const ICON_OPTIONS = [{ key: '', label: '不用图标' }].concat(
  advancedGameConfig.BARTER_ICONS.map((key) => ({ key, label: ICON_LABELS[key] || key })));
/** 目标两档:换到 = 背包里有它(need);留住 = 一路别换出去(keep)。服务端二者必有且只有一个。 */
const GOAL_KINDS = [{ key: 'need', label: '换到' }, { key: 'keep', label: '留住' }];

const clone = (value) => JSON.parse(JSON.stringify(value == null ? null : value));
const rowId = (prefix) => prefix + '_' + Date.now().toString(36) + Math.floor(Math.random() * 1000);
const list = (value) => (Array.isArray(value) ? value : []);

/** 这件物品还被谁引用着(背包 / 目标 / 换物)。删物品前要问它 —— 悬空引用服务端整份判死。 */
function itemUsed(barter, id) {
  return list(barter.start).indexOf(id) >= 0
    || list(barter.goals).some((goal) => goal && (goal.need === id || goal.keep === id))
    || list(barter.offers).some((offer) => offer && (offer.give === id || offer.get === id));
}

const methods = {
  /** 改一份新的 advanced 写回页面;mutate 返回 false = 这一下不写(到上限 / 不该改)。 */
  _bxEdit(mutate) {
    const next = clone(this.data.advanced);
    if (mutate(next) === false) return;
    this._setFormState({ advanced: next, advancedConfigError: '' });
  },

  /* ---- 以物换物 ---- */
  bxItemAdd() {
    this._bxEdit((a) => {
      if (list(a.barter.items).length >= MAX_ITEMS) { toast('最多 ' + MAX_ITEMS + ' 件物品'); return false; }
      a.barter.items = list(a.barter.items).concat({ id: rowId('item'), name: '', icon: '' });
    });
  },
  bxItemDel(e) {
    const index = Number(e.currentTarget.dataset.index);
    this._bxEdit((a) => {
      const item = list(a.barter.items)[index];
      if (!item) return false;
      if (list(a.barter.items).length <= MIN_ITEMS) { toast('至少 ' + MIN_ITEMS + ' 件物品'); return false; }
      // 背包 / 目标 / 换物还在用它:先改那边,否则存出去是一份服务端必拒的配置
      if (itemUsed(a.barter, item.id)) { toast('背包或换物还在用它'); return false; }
      a.barter.items = list(a.barter.items).filter((_, i) => i !== index);
    });
  },
  bxItemIcon(e) {
    const index = Number(e.currentTarget.dataset.index);
    const picked = ICON_OPTIONS[Number(e.detail.value)];
    if (!picked) return;
    this._bxEdit((a) => { const item = list(a.barter.items)[index]; if (!item) return false; item.icon = picked.key; });
  },
  bxStartAdd() {
    this._bxEdit((a) => {
      if (list(a.barter.start).length >= MAX_START) { toast('开局最多 ' + MAX_START + ' 件'); return false; }
      const first = list(a.barter.items)[0];
      if (!first) return false;
      a.barter.start = list(a.barter.start).concat(first.id);
    });
  },
  bxStartPick(e) {
    const index = Number(e.currentTarget.dataset.index);
    const item = list(this.data.advanced.barter.items)[Number(e.detail.value)];
    if (!item) return;
    this._bxEdit((a) => {
      const start = list(a.barter.start).slice();
      if (index >= 0 && index < start.length) start[index] = item.id; else start.push(item.id);
      a.barter.start = start;
    });
  },
  bxStartDel(e) {
    const index = Number(e.currentTarget.dataset.index);
    this._bxEdit((a) => { a.barter.start = list(a.barter.start).filter((_, i) => i !== index); });
  },
  bxGoalAdd() {
    this._bxEdit((a) => {
      if (list(a.barter.goals).length >= MAX_GOALS) { toast('最多 ' + MAX_GOALS + ' 个目标'); return false; }
      a.barter.goals = list(a.barter.goals).concat({ id: rowId('goal'), label: '', need: '' });
    });
  },
  bxGoalDel(e) {
    const index = Number(e.currentTarget.dataset.index);
    this._bxEdit((a) => {
      if (list(a.barter.goals).length <= 1) { toast('至少一个目标'); return false; }
      a.barter.goals = list(a.barter.goals).filter((_, i) => i !== index);
    });
  },
  /** 目标指哪件物品:原来是「换到」还是「留住」不变。 */
  bxGoalItem(e) {
    const index = Number(e.currentTarget.dataset.index);
    const item = list(this.data.advanced.barter.items)[Number(e.detail.value)];
    if (!item) return;
    this._bxEdit((a) => {
      const goal = list(a.barter.goals)[index];
      if (!goal) return false;
      if ('keep' in goal && !('need' in goal)) goal.keep = item.id; else { delete goal.keep; goal.need = item.id; }
    });
  },
  /** 换到 ↔ 留住:同一件物品换一档,两个键不能同时在(服务端「须且仅须其一」)。 */
  bxGoalKind(e) {
    const index = Number(e.currentTarget.dataset.index);
    const kind = GOAL_KINDS[Number(e.detail.value)];
    if (!kind) return;
    this._bxEdit((a) => {
      const goal = list(a.barter.goals)[index];
      if (!goal) return false;
      const target = goal.need || goal.keep || '';
      delete goal.need; delete goal.keep;
      goal[kind.key] = target;
    });
  },
  bxOfferAdd() {
    this._bxEdit((a) => {
      const offers = list(a.barter.offers);
      if (offers.length >= MAX_OFFERS) { toast('最多 ' + MAX_OFFERS + ' 条换物'); return false; }
      // 标记 A/B/C… 顺位补第一个没被占用的,不让作者手填 —— 重复与空值都要到服务端才被拦下
      const used = offers.map((offer) => String(offer && offer.key || ''));
      const key = OFFER_KEYS.find((letter) => used.indexOf(letter) < 0) || String(offers.length + 1);
      const items = list(a.barter.items);
      a.barter.offers = offers.concat({ id: rowId('offer'), key,
        give: (items[0] || {}).id || '', get: (items[1] || items[0] || {}).id || '', fb: '' });
    });
  },
  bxOfferDel(e) {
    const index = Number(e.currentTarget.dataset.index);
    this._bxEdit((a) => {
      if (list(a.barter.offers).length <= MIN_OFFERS) { toast('至少 ' + MIN_OFFERS + ' 条换物'); return false; }
      a.barter.offers = list(a.barter.offers).filter((_, i) => i !== index);
    });
  },
  /** 一条换物的两头:data-side 是 give(交出去)或 get(换回来)。 */
  bxOfferPick(e) {
    const index = Number(e.currentTarget.dataset.index);
    const side = e.currentTarget.dataset.side === 'get' ? 'get' : 'give';
    const item = list(this.data.advanced.barter.items)[Number(e.detail.value)];
    if (!item) return;
    this._bxEdit((a) => { const offer = list(a.barter.offers)[index]; if (!offer) return false; offer[side] = item.id; });
  },

  /* ---- 调音台 ---- */
  mxTrackAdd() {
    this._bxEdit((a) => {
      if (list(a.mixer.tracks).length >= MAX_TRACKS) { toast('最多 ' + MAX_TRACKS + ' 条音轨'); return false; }
      a.mixer.tracks = list(a.mixer.tracks).concat({ id: rowId('track'), label: '', muted: false });
    });
  },
  mxTrackDel(e) {
    const index = Number(e.currentTarget.dataset.index);
    this._bxEdit((a) => {
      const track = list(a.mixer.tracks)[index];
      if (!track) return false;
      if (list(a.mixer.tracks).length <= MIN_TRACKS) { toast('至少 ' + MIN_TRACKS + ' 条音轨'); return false; }
      a.mixer.tracks = list(a.mixer.tracks).filter((_, i) => i !== index);
      // 删掉的正好是答案那一轨 ⇒ 答案清空,不留一个指向不存在音轨的悬空 id
      if (a.mixer.answer === track.id) a.mixer.answer = '';
    });
  },
  mxTrackMuted(e) {
    const index = Number(e.currentTarget.dataset.index);
    const on = !!e.detail.value;
    this._bxEdit((a) => { const track = list(a.mixer.tracks)[index]; if (!track) return false; track.muted = on; });
  },
  mxAnswer(e) {
    const track = list(this.data.advanced.mixer.tracks)[Number(e.detail.value)];
    if (!track) return;
    this._bxEdit((a) => { a.mixer.answer = track.id; });
  },
};

module.exports = { ICON_OPTIONS, GOAL_KINDS, itemUsed, methods };
