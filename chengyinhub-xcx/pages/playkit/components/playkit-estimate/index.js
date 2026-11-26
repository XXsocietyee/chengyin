// cy-playkit-estimate · 猜数字(逐块照抄原型 playkit.html 的 GAMES.estimate)
//
// 是**滚筒**不是输入框。屏上只留三个数:中间那个是实的,上下两个是它的镜像 ——
// 翻过来、发虚、发淡。上一版我做成打字输入,那是另一个玩法:
// 打字要人先在心里有个数,滚轮是让人"滑到差不多"——后者才是估数。
//
// ★ 量程的来源与原型不同,这一处不得不改:
//   原型是本地 demo,拿 answer 的量级推上下限;而线上 **answer 是秘密,不下发**
//   (AdvancedGamePublicProjection#copyEstimate 剥掉 answer / tolerance / reveal)。
//   所以这里用服务端投影里的 min / max —— 那两个字段本来就是为这件事存在的。
//   拿答案推量程会把答案暗示出去,那正是投影要防的事。
//
// ★ 判定同样在服务端:客户端只报"我停在哪个数"。

const reducedMotionBehavior = require('../../../../behaviors/reduced-motion.js');
const motion = require('../../../../utils/motion.js');

/** 滚筒的刻度。
 *  ★ 它是**滚轮**:中间是 500,上下就该是 499 和 501。跳着走的话那不叫滚轮,
 *  叫三个不相干的数摞在一起 —— 原型(playkit.html 的估数轮)一格永远是 1,
 *  量程再宽也靠拖动变速解决,不靠改刻度。
 *  我们的手势交给原生 picker-view,一两千个刻度它还撑得住,几万个会卡,
 *  所以只在超宽量程上才跳格;常见的 0–1000 一律一格一个数。 */
function stepFor(min, max) {
  const span = Math.max(0, num(max, 0) - num(min, 0));
  if (span <= 2000) return 1;
  if (span <= 20000) return 10;
  return Math.pow(10, String(Math.round(span)).length - 3);
}

function num(v, d) { const n = Number(v); return Number.isFinite(n) ? n : d; }

/** 刻度表。上限一定要落在表里,不然滑到底选不到量程上限。 */
function buildTicks(min, max) {
  const lo = num(min, 0);
  const hi = Math.max(lo, num(max, lo + 100));
  const step = stepFor(lo, hi);
  const out = [];
  for (let v = lo; v <= hi; v += step) out.push(v);
  if (out[out.length - 1] !== hi) out.push(hi);
  return out;
}

/** 数字去掉多余的小数尾巴:5.40 → 5.4,6.0 → 6。 */
function fmt(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  return String(Math.round(n * 100) / 100);
}

/**
 * P-09 / P-10:交过之后的结果一行。服务端回执给 tier(HIT / CLOSE / MISS)、你的估数与真值;
 * 交之前三者都不在客户端。返回 null = 还没交。
 */
function resultLine(r) {
  const o = r || {};
  if (!o.submitted || !o.tier) return null;
  const unit = o.unit || '';
  const guess = fmt(o.guess);
  const answer = fmt(o.answer);
  const hasNums = guess !== '' && answer !== '';
  const diff = hasNums ? fmt(Math.abs(Number(o.guess) - Number(o.answer))) : '';
  const head = o.tier === 'HIT' ? '猜中了' : (o.tier === 'CLOSE' ? '差一点' : '差得有点远');
  const detail = !hasNums ? '' : (o.tier === 'HIT' && diff === '0'
    ? '正好 ' + answer + ' ' + unit
    : '你猜 ' + guess + ' ' + unit + ' · 实际 ' + answer + ' ' + unit + (diff !== '' && diff !== '0' ? ' · 差 ' + diff + ' ' + unit : ''));
  return { head, detail: detail.replace(/ +/g, ' ').trim(), reveal: String(o.reveal || '').trim(), miss: o.tier !== 'HIT' };
}

/**
 * 2026-11-24 业主:猜错可以接着猜。还没收摊(submitted=false)但已经交过(attempts>0)且没猜中 ⇒
 * 一行红字回执(服务端给的档位),滚筒与「就这个数」照常可用。真值此时不在客户端。
 */
function retryLine(r) {
  const o = r || {};
  if (o.submitted || !(Number(o.attempts) > 0) || !o.tier || o.tier === 'HIT') return null;
  return { head: o.tier === 'CLOSE' ? '差一点' : '差得有点远', miss: true };
}

/** 失手次数(给台面的次数点用):猜中的那一次不算失手。 */
function usedTries(attempts, tier) {
  const n = Number(attempts) > 0 ? Math.floor(Number(attempts)) : 0;
  return tier === 'HIT' ? Math.max(0, n - 1) : n;
}

/** 开局停在哪一格:量程正中。停在 0 会让人以为还没开始,停在答案附近是作弊。 */
function initialIndex(ticks) {
  return ticks.length ? Math.floor(ticks.length / 2) : 0;
}

// L02-042
function nearestIndex(ticks, value) {
  const v = Number(value);
  if (!Array.isArray(ticks) || !ticks.length || !Number.isFinite(v)) return 0;
  let best = 0;
  ticks.forEach((t, k) => { if (Math.abs(Number(t) - v) < Math.abs(Number(ticks[best]) - v)) best = k; });
  return best;
}

Component({
  behaviors: [reducedMotionBehavior],
  properties: {
    show: { type: Boolean, value: false },
    title: { type: String, value: '' },
    unit: { type: String, value: '' },
    min: { type: Number, value: 0 },
    max: { type: Number, value: 1000 },
    limitSeconds: { type: Number, value: 0 },
    maxTries: { type: Number, value: 0 },
    // 2026-11-24 可重猜:服务端已记下的作答次数;submitted 现在是「收摊了」(猜中或次数用完)
    attempts: { type: Number, value: 0 },
    // P-09:交过之后服务端回执才带这几样;交之前 submitted=false,其余为空
    submitted: { type: Boolean, value: false },
    tier: { type: String, value: '' },
    guess: { type: Number, value: 0 },
    answer: { type: Number, value: 0 },
    reveal: { type: String, value: '' },
  },
  data: {
    ticks: [],
    pickerValue: [0],
    curText: '0', prevText: '', nextText: '',
    locked: false,
    result: null,
    retry: null,
    used: 0,
    hit: false,
  },
  observers: {
    'submitted, tier, guess, answer, reveal, unit, attempts': function (submitted, tier, guess, answer, reveal, unit, attempts) {
      const result = resultLine({ submitted, tier, guess, answer, reveal, unit });
      const retry = retryLine({ submitted, tier, attempts });
      // 只认本机刚交上去的那一次回执(重进页面带着旧回执不闪、不弹判定屏)
      const fresh = !!this._pending && Number(attempts) > (this._seenAttempts || 0);
      if (fresh) this._pending = false;
      this._seenAttempts = Number(attempts) > 0 ? Number(attempts) : 0;
      this.setData({ retry, used: usedTries(attempts, tier), hit: !!result && tier === 'HIT' });
      // 新的一次没猜中:台面淡红闪一下(stage.nudge);新的一次猜中:台面的「通过」判定屏,整屏点一下继续
      const stage = fresh && tier && typeof this.selectComponent === 'function' ? this.selectComponent('#cy-play-stage') : null;
      if (stage && tier !== 'HIT' && stage.nudge) stage.nudge();
      if (stage && tier === 'HIT' && result && stage.win) stage.win(result.detail || result.head);
      // 第十二轮 k7 N2:服务端把这一局重开了(回执从「交过」回到「没交」)⇒ 解锁,「就这个数」重新能交。
      // 以前 locked 只增不减,重开后按钮要么不见、要么点了不发,只能退出再进
      const reset = !result && !!this.data.result;
      this.setData({ result, locked: !!result || (!reset && this.data.locked) });
      // L02-042
      if (result && this._ticks) { const g = nearestIndex(this._ticks, guess); this.setData({ pickerValue: [g] }); this._paint(g); }
    },
    'show, min, max': function (show, min, max) {
      if (!show) { this._begunSig = null; return; }
      const ticks = buildTicks(min, max);
      const i = (this.data.result || this.data.retry) ? nearestIndex(ticks, this.data.guess) : initialIndex(ticks);
      this._ticks = ticks;
      this.setData({
        ticks, pickerValue: [i], locked: !!this.data.result,
      });
      this._paint(i);
      // L02-036
      const sig = min + ':' + max;
      if (this._begunSig === sig) return;
      this._begunSig = sig;
      const stage = this.selectComponent('#cy-play-stage');
      if (stage) stage.begin();
    },
  },
  methods: {
    _stepFor: stepFor,          // 纯算法出口,供单测
    _buildTicks: buildTicks,
    _initialIndex: initialIndex,
    _resultLine: resultLine,
    _retryLine: retryLine,
    _usedTries: usedTries,

    /** 三条道各画一个数。上下两条是镜像,内容就是相邻的那个数。 */
    _paint(i) {
      const t = this._ticks || [];
      this._index = i;
      this.setData({
        curText: String(t[i] == null ? '' : t[i]),
        prevText: String(t[i - 1] == null ? '' : t[i - 1]),
        nextText: String(t[i + 1] == null ? '' : t[i + 1]),
      });
    },

    onScroll(e) {
      const i = Number((e.detail.value || [])[0]) || 0;
      if (i === this._index) return;
      // L02-042
      if (this.data.locked) { this.setData({ pickerValue: [this._index] }); return; }
      this._paint(i);
      // 每过一格给一下轻触感 —— 滚筒有没有"咔哒"是它像不像实物的关键
      motion.haptic({ reducedMotion: this.data.reducedMotion, type: 'light' });
    },

    onSubmit() {
      if (this.data.locked) return;
      const guess = (this._ticks || [])[this._index];
      if (guess == null) return;
      motion.haptic({ reducedMotion: this.data.reducedMotion, type: 'medium' });
      this._pending = true;
      this.triggerEvent('submit', { guess });
    },

    onVerdict(e) { this.triggerEvent('verdict', e.detail); },
    onClose() { this.triggerEvent('close'); },
  },
});
