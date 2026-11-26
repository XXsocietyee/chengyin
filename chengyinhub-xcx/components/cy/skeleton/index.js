// 统一加载骨架屏:首屏 loading 期间占位,避免白屏→突现。
// type:旧档 list/card/detail/amount；新档 feed-card/map-card/merchant-metric/merchant-insight/form-section/ticket(route-timeline 无调用方,L10-172 删)。
// count: list/card 重复几条(默认 list=4 / card=2,由使用方传)
const reducedMotionBehavior = require('../../../behaviors/reduced-motion.js');
const roleGuard = require('../../../utils/roleGuard.js');

let merchantViewAt = 0;
let merchantView = false;
function merchantViewCached() {
  const now = Date.now();
  if (now - merchantViewAt > 1000) { merchantView = roleGuard.isMerchantView(); merchantViewAt = now; }
  return merchantView;
}

Component({
  options: { multipleSlots: false },
  behaviors: [reducedMotionBehavior],
  properties: {
    type: { type: String, value: 'list' },
    count: { type: Number, value: 4 },
    loadingLabel: { type: String, value: '正在加载内容' },
    // 超过这么久还在加载才画骨架(ms);快加载什么都不闪。0 = 立即画。
    delay: { type: Number, value: 400 },
  },
  observers: {
    count(n) {
      this.setData({ items: Array.from({ length: Math.max(1, n) }) });
    },
  },
  // light:G-10(owner 2026-10-27)商家视角骨架一律浅色,不随宿主页根节点主题变黑。
  data: { items: [], ready: false, light: false },
  lifetimes: {
    // L10-172:一次挂载只发一次 setData(items 已由 count observer 给过就不重算),
    // 商家视角判定 1 秒内复用(同屏 N 个骨架不再各读一遍 storage)。
    attached() {
      const light = merchantViewCached();
      const n = Math.max(1, this.data.count);
      const needItems = this.data.items.length !== n;
      const delay = Number(this.data.delay);
      const ready = !(delay > 0);
      if (needItems && ready) this.setData({ light, items: Array.from({ length: n }), ready: true });
      else if (needItems) this.setData({ light, items: Array.from({ length: n }) });
      else if (ready) this.setData({ light, ready: true });
      else this.setData({ light });
      if (delay > 0) this._readyTimer = setTimeout(() => { this._readyTimer = null; this.setData({ ready: true }); }, delay);
    },
    detached() {
      if (this._readyTimer) { clearTimeout(this._readyTimer); this._readyTimer = null; }
    },
  },
});
