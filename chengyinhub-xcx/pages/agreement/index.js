// 通用协议展示页：按 type 渲染协议文本。
// 文本本身已抽到 utils/agreement-docs.js 作为单一真源 —— 同一份法律文本还被
// components/cy/agreement-sheet(全屏弹窗)消费,存两份必然改一处漏一处。
const { DEFAULT_TYPE, getDoc, resolveKey } = require('../../utils/agreement-docs.js');
// PG-092/OR-043:协议页按身份切主题(商家浅色 / 玩家深色),与关于页同源判断
const policy = require('../../utils/identity/identity-policy.js');
const merchantTheme = require('../../utils/merchant-theme.js');

// 本页只作深链/分享落地页:站内的设置页、注销页都改用 cy-agreement-sheet 弹层,不再跳到这里(L10-197)。
// 栈首页时 navigateBack 会失败,按 type 落回与该协议相关的页面:
// ⚠️ 别退回「一律回设置页」:那会让用户从注销页点进《账号注销须知》再返回时被丢到设置页,
//    他正在走的注销流程整段丢失、也没有任何回去的路。
const ORIGIN_BY_TYPE = {
  user_agreement: '/pages/shezhi/shezhi',
  cancellation_notice: '/pages/deregister/index',
};

Page({
  data: { doc: null, isMerchantView: false },

  onShow() { this.syncViewTheme(); },
  onHide() { merchantTheme.merchantPageRestore(); },
  onUnload() { merchantTheme.merchantPageRestore(); },

  syncViewTheme() {
    const isMerchantView = policy.isMerchantView({
      role: wx.getStorageSync('role'),
      userType: wx.getStorageSync('user_type'),
      debugView: wx.getStorageSync('debug_user_view'),
    });
    if (isMerchantView !== this.data.isMerchantView) this.setData({ isMerchantView });
    if (isMerchantView) merchantTheme.merchantPageShow();
    else merchantTheme.merchantPageRestore();
  },

  onLoad(query) {
    const type = (query && query.type) || DEFAULT_TYPE;
    const doc = getDoc(type);
    // 兜底路由必须与上面 doc 的回退**同步**:未知 type 既落 user_agreement 文档,
    // 也就该落 user_agreement 的 caller(设置页)。
    const docType = resolveKey(type);
    wx.setNavigationBarTitle({ title: doc.title });
    // L10-197:只给 JS 用,不进视图层
    this._docType = docType;
    this.setData({ doc });
  },

  // redirectTo 而非 navigateTo:兜底不该把页面栈越堆越深。
  // 两个兜底目标自身都还有下一层出口(设置页有 member tab 兜底;注销页是设置的子页)。
  onBack() {
    const url = ORIGIN_BY_TYPE[this._docType] || ORIGIN_BY_TYPE[DEFAULT_TYPE];
    wx.navigateBack({ fail() { wx.redirectTo({ url }); } });
  },
});
