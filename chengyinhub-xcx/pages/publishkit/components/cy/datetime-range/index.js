// cy-datetime-range · 起止时刻(带日期的区间)选择(2026-08-27 新建)
//
// 为什么要有它:创建优惠券原先用 **4 个滚轮 + 两个独立面板**拼一个区间 —— 选结束的时候看不到开始选了什么,
// 也没有任何地方显示这段有多长;校验是「确定结束」时弹一句 toast,面板已经关了才发现值没落上。
// 现在唯一的调用方是 publishkit/components/reward-selector(只传 show / title / value,L04-104),
// 其余旋钮(起始日 / 天数 / 分钟粒度 / 跨度上下限 / 默认时刻)一律取下面的固定值。
//
// 变的是三件:
//   ① 两头一屏内切换,当前编辑哪一头有下划线指示,另一头的值始终在场;
//   ② 当场显示「共 N 天 M 小时」+ 当场判定,不合法时确定键不放行、面板不关;
//   ③ 日期与时刻合成**一个** 3 列滚轮 —— 原来「日期」「时间」是两个 picker-view,
//      中间要塞一个连接词,而它们本就是同一个时刻的三个部分,没有连接词可言。
//
// 形态仍是滚轮不变(与 cy-time-range 同理:时间不适合网格);日期这一列沿用原来的
// 「今天起 N 天」列表,不换成月历 —— 券有效期基本都在一个月内,换月历是另一个决定。
//
// 计算全在 utils/datetime-range.js(跨天跨度那条只能在那里算,见其注释),
// 滚轮选项复用 utils/time-picker-options.js,不另造第二套。
const dtr = require('../../../utils/datetime-range.js')
const cal = require('../../../../../utils/calendar.js')
const opts = require('../../../../../utils/time-picker-options.js')
const reducedMotionBehavior = require('../../../../../behaviors/reduced-motion.js')

// 可选范围:从今天起 31 天;分钟粒度 1(60 格);未选值时默认 09:00 / 18:00
const DAYS = 31
const MINUTE_STEP = 1
const DEFAULT_START = '09:00'
const DEFAULT_END = '18:00'

Component({
  behaviors: [reducedMotionBehavior],
  properties: {
    // G-2:透传给内层弹层的返回守卫开关(全站共享弹层同一合同);宿主页已有自己的 page-container 覆盖它时传 false
    backGuard: { type: Boolean, value: true },
    show: { type: Boolean, value: false },
    title: { type: String, value: '选择有效期' },
    // ['YYYY-MM-DD HH:mm:ss', 'YYYY-MM-DD HH:mm:ss'];调用方的已选值,打开时载入
    value: { type: Array, value: [] },
  },
  data: {
    _dates: [],       // [{ date, display }]
    _hours: [],
    _minutes: [],
    _index: [0, 0, 0], // [日期, 时, 分] —— 当前编辑那一头的滚轮位置
    _phase: 'start',
    _startText: '',
    _endText: '',
    _spanText: '',
    _hint: '',
  },
  observers: {
    'show, value': function (show) {
      if (!show) return
      // 每次打开都从调用方的值重新起草,不留上一次的残留
      this._draft()
    },
  },
  methods: {
    _draft() {
      const d = this.data
      const first = cal.today()
      const dates = []
      for (let i = 0; i < DAYS; i++) {
        const date = cal.addDays(first, i)
        const p = cal.parse(date)
        dates.push({ date: date, display: p.month + '月' + p.day + '日' })
      }
      const v = d.value || []
      // 落不进列表的历史值(比如已过期的券)不硬塞:退回列表首日,
      // 否则滚轮会停在一个用户滚不回去的位置。
      const clamp = (raw, fallbackTime) => {
        const p = dtr.split(raw)
        const inList = p && dates.some((x) => x.date === p.date)
        return dtr.join(inList ? p.date : dates[0].date, p ? p.time : fallbackTime)
      }
      // ⚠️ _start/_end 不走 setData:wxml 读的是算好的 _startText/_endText 与滚轮下标,
      // 原值只在组件内部用,setData 只会白白过一次桥(与 cy-time-range 同一手法)。
      this._start = clamp(v[0], DEFAULT_START)
      this._end = clamp(v[1], DEFAULT_END)
      this.setData({
        _dates: dates,
        // ⚠️ 选项数组是【数字】不是补零字符串(time-picker-options 明确警告过:调用方要做算术),
        // 补零只在展示层由 utils/time-format.wxs 的 pad2 做。
        _hours: opts.HOURS,
        _minutes: opts.minuteOptions(MINUTE_STEP),
        _phase: 'start',
      // ⚠️ _index 必须等这次渲染完成再下发(走 setData 回调),不能和列一起发:
      // picker-view 的 value 早于 picker-view-column 到达时会被夹回 0 ——
      // 实测首次打开时摘要写着 09:00、滚轮却停在 00:00,而第二次打开(列已存在)就正常。
      }, () => this._syncWheel('start'))
      this._revalidate()
    },

    /** 把某一头的值映射成滚轮下标 */
    _syncWheel(phase) {
      const raw = phase === 'end' ? this._end : this._start
      const p = dtr.split(raw)
      if (!p) return
      const di = this.data._dates.findIndex((x) => x.date === p.date)
      const total = opts.minutesOfDay(+p.time.slice(0, 2), +p.time.slice(3, 5))
      this.setData({
        _index: [di < 0 ? 0 : di, Math.floor(total / 60), opts.minuteIndex(total % 60, MINUTE_STEP)],
      })
    },

    _fmt(raw) {
      const p = dtr.split(raw)
      if (!p) return ''
      const d = cal.parse(p.date)
      return d.month + ' 月 ' + d.day + ' 日 ' + p.time
    },

    _revalidate() {
      const r = dtr.validate(this._start, this._end)
      // ⚠️ _ok 不走 setData:徽章改成「算不出跨度就不出现」之后 wxml 再没引用过它,
      // 只有 onConfirm 读一次。留在 data 里就是一条死字段(U4 门禁会判红)。
      this._ok = r.ok
      this.setData({
        _startText: this._fmt(this._start),
        _endText: this._fmt(this._end),
        _spanText: r.minutes > 0 ? '共 ' + dtr.formatSpan(r.minutes) : '',
        _hint: this._hintOf(r),
      })
    },

    _hintOf(r) {
      return !r.ok && r.reason === 'not-after' ? '结束时间要晚于开始时间' : ''
    },

    // 两支各自写字面量 setData,不合并成一个动态 key —— 动态 setData 让门禁没法静态核对
    // 顶层字段有没有被消费(与 cy-time-range 同一理由)。
    onPickStart() {
      if (this.data._phase === 'start') return
      this.setData({ _phase: 'start' })
      this._syncWheel('start')
    },
    onPickEnd() {
      if (this.data._phase === 'end') return
      this.setData({ _phase: 'end' })
      this._syncWheel('end')
    },

    onWheel(e) {
      const idx = e.detail.value
      const row = this.data._dates[idx[0]]
      if (!row) return
      const next = dtr.join(row.date, opts.formatHM(Number(idx[1]) || 0, opts.minuteAt(idx[2], MINUTE_STEP)))
      if (this.data._phase === 'end') this._end = next
      else this._start = next
      this.setData({ _index: idx })
      this._revalidate()
    },

    onCancel() {
      // 取消什么也不抛:草稿丢掉,调用方的值不动
      this.triggerEvent('cancel')
    },

    onConfirm() {
      // 校验不过就不抛,也不关面板 —— 让用户在原地看着提示改,
      // 而不是关掉之后才发现值没落上去(原来两个页面就是弹 toast 后关掉)
      if (!this._ok) {
        this._revalidate()
        return
      }
      this.triggerEvent('confirm', {
        value: [this._start, this._end],
        minutes: dtr.spanMinutes(this._start, this._end),
      })
    },
  },
})
