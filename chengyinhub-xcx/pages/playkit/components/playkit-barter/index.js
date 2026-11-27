// cy-playkit-barter · 以物换物(交换规划)
//
// 点一张交换卡只是**预演**:背包和目标就地更新,「撤回上一步」退回去;什么都不交。
// 只有底部那一枚「就这样换」把整串顺序交给服务端(SUBMIT_BARTER {order}),由服务端从开局背包重放判定。
// 预演算法在 utils/barter-plan.js(纯函数,单测钉住);这里只管点击、回执与台面。
//
// 回执:服务端给 lastOrder / failedGoals / lastFeedback。目标只有在「交上去的那份计划 == 眼前的预演」时才标红,
// 玩家一动卡片,红就退回未达成的灰 —— 那已经是另一份计划了。判对走 stage.win(绿「通过」章)。

const reducedMotionBehavior = require('../../../../behaviors/reduced-motion.js');
const motion = require('../../../../utils/motion.js');
const cyToast = require('../../../../utils/toast.js');
const plan = require('../../utils/barter-plan.js');

function config(data) {
  return { items: data.items, start: data.start, goals: data.goals, offers: data.offers };
}

/** 服务端回执那几项(不是写回 data,只是喂给预演视图) */
function receipt(data) {
  return { lastOrder: data.lastOrder, failedGoals: data.failedGoals, lastFeedback: data.lastFeedback, passed: data.passed };
}

Component({
  behaviors: [reducedMotionBehavior],
  properties: {
    inline: { type: Boolean, value: false },
    show: { type: Boolean, value: false },
    title: { type: String, value: '' },
    items: { type: Array, value: [] },
    start: { type: Array, value: [] },
    goals: { type: Array, value: [] },
    offers: { type: Array, value: [] },
    maxTries: { type: Number, value: 0 },     // 0 = 不限;台面上那排「还能错几次」的点
    attempts: { type: Number, value: 0 },
    passed: { type: Boolean, value: false },
    finished: { type: Boolean, value: false },
    lastCorrect: { type: Boolean, value: false },
    lastOrder: { type: Array, value: [] },
    lastFeedback: { type: String, value: '' },
    failedGoals: { type: Array, value: [] },
  },
  data: {
    v: { goals: [], bag: [], offers: [], lostKeep: '', allMet: false, wrongLine: '', canUndo: false, canSubmit: false },
  },
  observers: {
    'show, items, start, goals, offers': function (show) {
      if (!show) { this._signature = ''; return; }
      const signature = JSON.stringify(config(this.data));
      if (signature === this._signature) return;
      this._signature = signature;
      this._seenAttempts = this.data.attempts;
      this._submittedAt = 0;
      // 重进页面:服务端记着上一份交过的计划,按它摆回去(通过了就是那份赢的计划,错了就接着改)
      const kept = (this.data.lastOrder || []).length && this.data.attempts > 0 ? this.data.lastOrder.slice() : [];
      this._render(kept);
      const stage = this.selectComponent('#cy-play-stage');
      if (stage) stage.begin();
    },
    // 回执来了才判。attempts 没变说明不是新的一次提交
    'attempts, passed, lastFeedback, failedGoals': function (attempts, passed) {
      if (!(attempts > 0) || attempts === this._seenAttempts) return;
      this._seenAttempts = attempts;
      const mine = this._submittedAt > 0;
      this._submittedAt = 0;
      this._render(this._order || []);
      const stage = mine ? this.selectComponent('#cy-play-stage') : null;
      if (!stage) return;
      if (passed) stage.win('');
      else if (stage.nudge) stage.nudge();
    },
  },
  methods: {
    _render(order) {
      const v = plan.view(config(this.data), order, receipt(this.data));
      // 预演顺序只是组件内部状态(界面渲染的是 v),不走 setData
      this._order = order;
      this.setData({ v });
    },
    /* 过了 / 次数用完就不再动;刚交出去的 1.5 秒内也不动(回执还在路上,别让人改了一份没交的计划)。
       不用常驻的「提交中」锁:请求失败时页面不回执,锁会一直挂着。 */
    _locked() { return this.data.passed || this.data.finished || (this._submittedAt > 0 && Date.now() - this._submittedAt < 1500); },

    onPick(e) {
      if (this._locked()) return;
      const id = e.currentTarget.dataset.id;
      const next = plan.pick(config(this.data), (this._order || []), id);
      if (next === (this._order || [])) {
        const offer = ((this.data.v && this.data.v.offers) || []).find((o) => o.id === id);
        if (offer && offer.state === 'off' && offer.giveName) {
          cyToast('背包里还没有「' + offer.giveName + '」');
        }
        return;
      }
      motion.haptic({ reducedMotion: this.data.reducedMotion, type: 'light' });
      this._render(next);
    },
    onUndo() {
      if (this._locked() || !(this._order || []).length) return;
      this._render(plan.undo((this._order || [])));
    },
    onReset() {
      if (this._locked() || !(this._order || []).length) return;
      motion.haptic({ reducedMotion: this.data.reducedMotion, type: 'light' });
      this._render([]);
    },
    onSubmit() {
      if (this._locked() || !(this._order || []).length) return;
      motion.haptic({ reducedMotion: this.data.reducedMotion, type: 'medium' });
      this._submittedAt = Date.now();
      this.triggerEvent('submit', { order: (this._order || []).slice() });
    },
    onClose() { this._signature = ''; this.triggerEvent('close'); },
  },
});
