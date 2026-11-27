// l-play(2026-11-10,业主批准 proto/game 第二组「游玩与阶段弹窗」):主题内的几张阶段弹窗 / 整屏,
//   ① 玩法开始弹窗(pop-kitstart):故事流入口卡 / 地点卡点开先看一张弹窗(封面 · 模板 · 绑定地点 · 一句说明),选「嵌入故事流 / 全屏」再开始;
//   ② 延伸任务翻页卡(pop-ext):一次一张,点卡或箭头翻到下一张;
//   ③ 本局完成屏的奖励事实(真夺到的勋章);
//   ④ 地点卡玻璃面板上的三个数字(距离 / 步行 / 开放),只写拿得到的;
//   ⑤ f-play:走完后的只读回看与选章状态(V3-07/08/09)。
// index.js 的 UI 门禁基线按行号登记,新方法都放这里,index.js 只留单行挂钩。

// 玩法段名 → 作者在玩法目录里看到的名字(pages/publish/utils/publish/node-game-catalog.js 的 label;分包之间不能 require,这里抄常用的一份)
// L02-086:只按服务端段名登记一份;小写的 kit 类型(试玩预览 kit 的 type)经 playkit-view 的 TYPE_OF 反查回段名
const KIT_LABELS = {
  qa: '问答', hangman: '逐字猜词', branch: '分支剧情', accusation: '判案', sort: '排序', match: '连线', classify: '分类', barter: '以物换物',
  estimate: '猜数字', pricePair: '猜图', hidden: '找东西', hiddenObject: '找东西', predict: '预测', random: '翻卡',
  coinFlip: '抛硬币', diceRoll: '掷骰子', album: '相册', ballShake: '弹球',
  reaction: '变色就点', countdown: '倒计时', stopwatch: '精准停表', note: '留言', profile: '角色建档', photoCheck: '拍照',
  steps: '计步挑战', quietHold: '安静挑战', compass: '罗盘指向', shout: '喊一嗓子', typeIn: '输入挑战',
  scan: '扫码参与', bingo: '九宫格', blindTaste: '闭眼盲品', dailySign: '今日城市签', objectCard: '拍物成卡', check: 'D20', musicCorner: '音乐角',
};
const { TYPE_OF } = require('./playkit-view.js');
const SEG_OF_TYPE = {};
Object.keys(TYPE_OF).forEach((seg) => { if (!SEG_OF_TYPE[TYPE_OF[seg]]) SEG_OF_TYPE[TYPE_OF[seg]] = seg; });
function kitLabel(key) { return KIT_LABELS[key] || KIT_LABELS[SEG_OF_TYPE[key]] || ''; }
const WALK_M_PER_MIN = 80;
const chapterTrail = require('./chapter-trail.js');
const storyResume = require('./story-resume.js');
const countUp = require('./count-roll.js');
const { pickEndingMedal, themeMedals } = require('./finish-medals.js');
const { distanceText } = require('../../../utils/geo.js');
const entryRhythm = require('../../../utils/entry-rhythm.js');

const stationImage = require('./station-image.js');
/** 这一站玩法的类型名:试玩读草稿预览 kit,真实游玩读节点配置里启用的那一段;认不出就不写(不写「玩法」凑数) */
function kitTypeLabel(node) {
  if (!node) return '';
  const t = node.previewKit && node.previewKit.type;
  if (t && kitLabel(t)) return kitLabel(t);
  let cfg = node.advancedConfig;
  if (!cfg && node.advancedConfigJson) { try { cfg = JSON.parse(node.advancedConfigJson); } catch (e) { cfg = null; } }
  if (cfg && typeof cfg === 'object') {
    const key = Object.keys(cfg).find((k) => cfg[k] && cfg[k].enabled && KIT_LABELS[k]);
    if (key) return KIT_LABELS[key];
  }
  return '';
}
/** 玩家只看站名和任务:去掉编辑器里的「第04关」「问答：」「模板 ·」这类制作用前缀;
 *  「路线名 · 第4关 站名」这种连路线名带关号的,路线名一起去掉(路线名在页头已有,关号不是玩家口径) */
function playerTitle(t) {
  const raw = String(t == null ? '' : t);
  const s = raw.replace(/^\s*(?:[^·:：]{1,40}?\s*[·:：]\s*)?第\s*\d+\s*关\s*[:：·\-－—\s]\s*/, '')
    .replace(/^\s*(?:第\s*\d+\s*关|模板|问答)\s*[:：·\-－—\s]\s*/, '').trim();
  return s || raw.trim();
}
/** 站名开头的序号(「1 · 老门」「2. 老门」)去掉,只留站名;去完为空则保留原样 */
function stationLabel(t) {
  const raw = String(t == null ? '' : t).trim();
  const s = raw.replace(/^\d+\s*[·.、\-－—:：]\s*/, '').trim();
  return s || raw;
}
/** 地点卡上的数字:距离(有定位或上一站才算)、步行分钟(按 80 m/min,只在有距离时)、开放时段(节点营业时间原样) */
const WALK_MAX_MIN = 60; // 超过一小时步行不报分钟,只留距离(km,一位小数)
// L02-009: geo.distanceText 实际是「1.2 公里 / 800 米」(空格可有可无,也认旧的 1.2km)。认不出就留上次的读数,不改成空白,也不把原文再摆成另一种写法。
function sheetMeters(text) {
  const m = /^([\d.]+)\s*(km|m|公里|米)$/.exec(String(text || '').trim());
  if (!m) return null;
  const meters = (m[2] === 'km' || m[2] === '公里') ? Number(m[1]) * 1000 : Number(m[1]);
  return Number.isFinite(meters) ? meters : null;
}
function applySheetDistance(out, meters) {
  out.distText = distanceText(meters);
  if (meters > 0) {
    const min = Math.max(1, Math.ceil(meters / WALK_M_PER_MIN));
    if (min <= WALK_MAX_MIN) out.walkText = String(min);
  }
}
function sheetFacts(node, distText) {
  const out = { distText: '', walkText: '', hoursText: '' };
  const meters = sheetMeters(distText);
  if (meters != null) applySheetDistance(out, meters);
  else {
    const prev = sheetMeters(node && node.distText);
    if (prev != null) applySheetDistance(out, prev);
  }
  const biz = String(node && node.businessTime || '');
  if (biz && !/^\s*00:00\s*[-–~至]\s*23:59\s*$/.test(biz)) out.hoursText = biz.replace(/:00/g, '').replace(/\s*[-~至]\s*/, '–');
  // x-fix2 P-8:大字格只放时段;「公共区域观察;以现场…为准」这类说明已在地址行(metaLine)里,不挤进数字位
  if (!/^\d{1,2}(:\d{2})?–\d{1,2}(:\d{2})?$/.test(out.hoursText.trim())) out.hoursText = '';
  return out;
}
/** 玩法开始弹窗的封面走站点配图兜底链(pages/play/utils/station-image.js,#883):站点图 → 章节封面 → 章节第一张故事块图 → 路线封面;
 *  只用页面上已解析的地址,media-asset: 引用一律跳过。故事玩法自己没图时先借它绑定的地点。都没有 = '' → 模板回插图。 */
function kitStartCover(page, node, place) {
  const data = (page && page.data) || {};
  const viaChain = (n) => {
    if (!n) return '';
    if (stationImage.isDisplayable(n.photo)) return n.photo;
    const viaCtx = page && typeof page._stationPhotos === 'function' ? page._stationPhotos(n).photo : '';
    return stationImage.isDisplayable(viaCtx) ? viaCtx : stationImage.resolvePageStationImage(data, n);
  };
  return stationImage.firstImage(node && node.imgUrl) || viaChain(place) || viaChain(node);
}
/** 翻页卡组:当前下标 + 下一张(循环) */
function nextIndex(i, n) { return n ? (((i || 0) + 1) % n) : 0; }

const data = {
  kitStart: { show: false, nodeId: '', origin: 'story', cover: '', title: '', type: '', place: '', arrived: false, lede: '', station: '', chapter: '', coverIn: false, mode: 'embed', modes: true },
  extDeck: { idx: 0, flipping: false },
};

function methods() {
  // 写成 const 对象再返回:台账 / 处理器门禁只扫模块里 `const X = {` 的键
  const api = {
    /** 「开始任务」入口。2026-11-23 业主:地点卡 / 入口卡点了「开始任务」又弹一张同图同名、没有可选项的开始卡,是多确认一次 →
     *  这两个入口直接开始(地点卡 startGame、入口卡整屏 / 岔路弹窗);开始弹窗只留给真有「嵌入 / 全屏」可选的故事流入口。
     *  origin=story 沿用 startStoryGame 的前置(不是故事玩法 / 已完成就直接走老路) */
    openKitStart(e) {
      const ds = (e && e.currentTarget && e.currentTarget.dataset) || {};
      const origin = ds.origin || 'story';
      const pk = this.data.playKit || {};
      if (origin === 'card') { this.expandPlayKit(); return; }
      if (origin === 'sheet') { if (this.data.sheet && this.data.sheet.node) this.startGame(); return; }
      const node = (this.data.nodes || []).find((n) => String(n.nodeId) === String(ds.nodeid));
      if (!node) return;
      const entry = (this.data.chapterParas || []).find((p) => p.kind === 'game' && String(p.nodeId) === String(node.nodeId));
      if (!entry || !this._isStoryGame(node) || node.done) { this.startStoryGame(e); return; }
      const place = (this.data.nodes || []).find((n) => String(n.nodeId) === String(node.placeNodeId)) || null;
      // 外壳(2026-11-21):弹窗抬头写「第N站」(路线全程站序,与地点卡角标同号)+ 章名小字;站名 / 玩法名只在大标题写一次;
      //   说明用这一站的引子 —— 与开始后整屏台面左上那一行同一份(utils/game-shell.js)
      const shell = require('./game-shell.js');
      const head = shell.stationHead(node, this.data.chapter, this.data.nodes);
      const title = shell.stationTitle(node, pk.kit) || '玩法';
      const placeName = place ? place.name || '' : '';
      this.setData({ kitStart: {
        show: true, nodeId: String(node.nodeId), origin,
        cover: kitStartCover(this, node, place), coverIn: false,
        title, type: kitTypeLabel(node),
        place: placeName && !shell.sameStation(placeName, title) ? placeName : '', arrived: !!(place ? place.arrived || place.done : node.arrived),
        lede: shell.storyLead(node, pk.kit), station: head.station, chapter: head.chapter,
        mode: 'embed', modes: true,
      } });
    },
    /** 封面图加载完再淡入(占位底色先在;减弱动态在 wxss 里不走过渡) */
    onKitCoverLoad() { if (this.data.kitStart && this.data.kitStart.show) this.setData({ 'kitStart.coverIn': true }); },
    /** 封面图挂了:不留破图,回插图 */
    onKitCoverError() { if (this.data.kitStart && this.data.kitStart.show) this.setData({ 'kitStart.cover': '' }); },
    closeKitStart() { this.setData({ 'kitStart.show': false }); },
    pickKitMode(e) { this.setData({ 'kitStart.mode': (e.currentTarget.dataset.mode === 'full') ? 'full' : 'embed' }); },
    /** 「开始」:故事流入口按所选方式开(全屏 = 同一个 kit 盖整屏,退出回到流里) */
    confirmKitStart() {
      const ks = this.data.kitStart || {};
      if (!ks.show) return;
      this.setData({ 'kitStart.show': false });
      this._kitStartFull = ks.mode === 'full' ? ks.nodeId : '';
      this.startStoryGame({ currentTarget: { dataset: { nodeid: ks.nodeId } } });
    },
    /** 延伸任务翻页卡:点卡 / 箭头翻到下一张(绕竖轴;减弱动态直接切) */
    flipExtTask() {
      const rows = (this.data.storyTasks && this.data.storyTasks.rows) || [];
      const deck = this.data.extDeck || {};
      if (deck.flipping || rows.length < 2) return;
      const idx = nextIndex(deck.idx, rows.length);
      if (this.data.reducedMotion) { this.setData({ extDeck: { idx, flipping: false } }); return; }
      this.setData({ extDeck: { idx: deck.idx || 0, next: idx, flipping: true } });
      clearTimeout(this._extFlipT);
      this._extFlipT = setTimeout(() => { if (!this._playDisposed) this.setData({ extDeck: { idx, flipping: false } }); }, 520);
    },
    /** 「去做」:当前这张任务卡 → 打开那一站的地点卡(沿用 openStoryTask) */
    goExtTask() {
      const rows = (this.data.storyTasks && this.data.storyTasks.rows) || [];
      const row = rows[(this.data.extDeck || {}).idx || 0];
      if (!row) return;
      this.openStoryTask({ currentTarget: { dataset: { nodeid: row.nodeId } } });
    },
    /** 本局完成屏的奖励:只写这一局真夺到的勋章(_wonMedals,与完成页勋章堆同口径);没有就不写 */
    _endingReward() {
      const won = (this._wonMedals || []).filter((m) => m && m.name);
      const first = won[0];
      const d = this.data || {};
      // 主视觉:这条路线自己的徽章(主题通关徽章 → 本局夺到的站点奖牌),没有才回落通用成功插图;探店日没有主题徽章口径,与完成页一致
      const medal = pickEndingMedal({ allDone: !!d.allDone && d.mode !== 2, reward: this._themeReward, won: this._wonMedals, nodes: d.nodes, theme: d.mode !== 2 ? themeMedals(d.themeBag) : [] });
      // 2026-11-23:名字跟主视觉是同一枚 —— 主视觉是路线自己的勋章时也写出勋章名(原来只有夺到站点奖牌才写名字,主题勋章只有一枚图)
      const named = medal || first;
      return { reward: named ? { name: named.name, img: named.img || '', count: Math.max(won.length, 1) } : null, medal };
    },
    /** 地点卡玻璃面板上的数字(见 sheetFacts) */
    /* 细节打磨 G4:地点卡的距离 / 步行分钟从 0 滚上来(开放时段是时间段,不滚);入场节奏 G7:卡内块依次浮上 */
    _sheetRollFacts(node) { return { dist: (node && node.distText) || '', walk: (node && node.walkText) || '' }; },
    _sheetRollInit(node) { return countUp.init(this._sheetRollFacts(node), this.data.reducedMotion === true); },
    _sheetRoll(node) {
      countUp.roll(this, 'sheetShown', this._sheetRollFacts(node), { delay: 260 });
      entryRhythm.play(this, ['.sheet-name', '.sheet-meta', '.sheet-desc', '.sheet-dist', '.sheet-row'], 120);
    },
    _sheetFacts(node) { return sheetFacts(node, typeof this._distText === 'function' ? this._distText(node) : ''); },
    /** f-play:地点卡开着时定位每一跳都重算距离 / 步行 —— 开卡时算一次的话,走到站上还写着出发时的「1.7km · 22 分钟」。文字没变不 setData */
    _refreshSheetFacts() {
      const sh = this.data.sheet || {};
      const node = sh.show && sh.node;
      if (!node || !node.lat || !node.lng) return;
      const f = this._sheetFacts(node);
      if (f.distText === node.distText && f.walkText === node.walkText) return;
      this.setData({ 'sheet.node.distText': f.distText, 'sheet.node.walkText': f.walkText });
    },
    /** f-play V3-09:选章每一行的状态,与 onPickChapter 放行同一判据(chapterReadState):completed 写「已完成」、locked 压暗不可点 */
    _chapterPickStates() {
      // 自由探索按到访解锁:锁定的章标 visit(锁图标 +「到访后解锁」,点开锁卡),其余照旧
      const gate = !!this.data.storyGate;
      return (this.data.chapterCards || []).map((c) => (gate && c && c.chapterLocked ? 'visit'
        : chapterTrail.chapterReadState(c, this.data.nodes, this._historyNodes)));
    },
    /** 回看打不开 / 没有可读内容时:只在「走完后回看」这一次里按走完离开 */
    _afterFinishLeave() {
      if (!this._reviewPending) return;
      this._reviewPending = false;
      this.setData({ chapterFull: false });
      if (typeof this.goBackDetail === 'function') this.goBackDetail();
    },
    /** 末章的收尾(最后一站之后的正文 / 结语 cap:end)要在通关页之前读到:本章各站都完成、收尾还没读过 ⇒ 先停在故事流里把它铺出来,
     *  点章末「继续探索」(continueChapterStory 的 _afterEndingChapter)才接着进通关。返回 true = 这一次先不开通关页。
     *  收尾还没到手(块流是最后一站完成前拉的)就等同页重拉(rebuild 再叫一次 openFinish),最多等 6 秒,拿不到照常通关,不挡路。 */
    _holdFinishForTrail() {
      const d = this.data;
      const wait = this._finishTrailWait;
      const drop = () => { if (wait && wait.timer) clearTimeout(wait.timer); this._finishTrailWait = null; };
      if (d.isPreview || d.isMock || Number(d.mode) === 2 || d.showFinish || this._afterEndingChapter || this._chapterReadCursor) { drop(); return false; }
      const id = (d.chapter || {}).id;
      const card = id == null ? null : (d.chapterCards || []).find((c) => c && !c.history && String(c.id) === String(id));
      const scope = this._runSessionScope();
      const state = chapterTrail.trailState(card, d.nodes, Object.assign({}, storyResume.read(scope).trails, this._chapterTrailRead), this._trailDoneAtLoad);
      const keyOf = () => JSON.stringify([this._sessionKey(), String((this._routeState || {}).sessionId || ''), String(id)]);
      const key = keyOf();
      if (state === 'none' || (state === 'unknown' && wait && wait.key === key && wait.expired)) { drop(); return false; }
      if (state === 'unknown') {
        if (wait && wait.key === key) return true;
        drop();
        const next = this._finishTrailWait = { key, expired: false, timer: 0 };
        // 藏到后台或已经离页时不能打开通关页:那一拍会停表并写上完成屏。回到前台再放行。
        const fire = () => {
          if (this._playDisposed || this._unloaded || this._detached) return;
          if (this._finishTrailWait !== next || keyOf() !== key) return;
          if (this._themeHidden) {
            next.timer = setTimeout(fire, 400);
            this._fxTimers = (this._fxTimers || []).concat(next.timer);
            return;
          }
          next.expired = true;
          this.openFinish();
        };
        next.timer = setTimeout(fire, 6000);
        this._fxTimers = (this._fxTimers || []).concat(next.timer);
        return true;
      }
      drop();
      this._afterEndingChapter = () => {
        if (keyOf() !== key) return;   // 换了局 / 换了账号:旧局的通关不再接
        this._chapterTrailRead = Object.assign({}, this._chapterTrailRead, { [String(id)]: true });
        storyResume.patch(scope, { trails: Object.assign({}, storyResume.read(scope).trails, this._chapterTrailRead) });
        this.openFinish();
      };
      this.setData({ chapter: this._chapterFromCard(card) }, () => this.openChapterFull());
      return true;
    },
    /** f-play V3-07/08:真实局走完后,完成页「继续」回到故事流的只读回看(最后一章已完成的那章,停在末尾,往上滑读完整个故事;
     *  多章时「…」里有「切换章节」换章)。不是走完的局 / 自由探索 / 一章都没读完时返回 false,照旧离开。 */
    _reviewAfterFinish() {
      const d = this.data;
      if (!d.allDone || d.isPreview || d.isMock || Number(d.mode) === 2 || typeof this.onPickChapter !== 'function') return false;
      // 只回看真有故事可读的已完成章:城市路线往往只有站点没有正文,回过去是一张空故事页,这时直接按走完离开
      const states = this._chapterPickStates();
      const cards = d.chapterCards || [];
      const history = typeof this._currentCompletedHistory === 'function' ? this._currentCompletedHistory() : null;
      let idx = -1;
      for (let i = states.length - 1; i >= 0; i--) {
        if (states[i] !== 'completed') continue;
        const frozen = history && history.chapters.find((c) => c.id === String(cards[i].id));
        if (chapterTrail.hasReadableStory((frozen || cards[i]).blocks)) { idx = i; break; }
      }
      if (idx < 0) return false;
      // 回看真的打开才算数;选章被拦(未解锁 / 历史没读到)就按走完离开,不留一张空故事页
      this._reviewPending = true;
      if (this.onPickChapter({ currentTarget: { dataset: { idx } } }) === false) { this._reviewPending = false; return false; }
      clearTimeout(this._reviewEndT);
      // 停在末尾:滚到最后一段(scroll-into-view 认段落 id,与 wxml 的 chapter-game- / chapter-block- 同一口径)
      this._reviewEndT = setTimeout(() => {
        const paras = this.data.chapterParas || [];
        const last = paras[paras.length - 1];
        if (this._playDisposed || !this.data.chapterFull || !last) return;
        this.setData({ chapterGameAnchor: last.nodeId ? 'chapter-game-' + last.nodeId : 'chapter-block-' + last.i });
      }, 700);
      return true;
    },
  };
  return api;
}

module.exports = { KIT_LABELS, kitTypeLabel, kitStartCover, playerTitle, stationLabel, sheetFacts, nextIndex, data, methods };
