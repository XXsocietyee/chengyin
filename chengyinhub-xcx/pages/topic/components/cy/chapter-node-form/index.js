const app = getApp();
const { isRecordList } = require('../../../../../utils/response-shape.js');
const { isAlbumTemplate, ALBUM_ONLY_IN_STORY } = require('../../../../../utils/album-template.js');
const cyToast = require('../../../../../utils/toast.js');
const cyModal = require('../../../../../utils/modal.js');
const { pickLocation, hasCoords } = require('../../../../../utils/location/location-manager.js');
function openAddress() { return require('../../../../../utils/open-address.js') }
const { resolveMenuChrome } = require('../../../../../utils/nav-safe-area.js');
const { explorePerkLine } = require('../../../utils/topic-motion.js');
const { previewFrameStyle } = require('../../../utils/look-preview.js');
const { chinaDateKey } = require('../../../../../utils/datetime.js');

// P1-3:提交权益前勾选的一行条款摘要(线下结算 / 核销规则 / 退出规则)。
const CONSENT_TEXT = '已阅读并同意：票款由主办方收取并与本店线下结算；玩家出示核销码、本店核销后提供权益；退出须填写原因，已售出的票仍需履约';
const INCLUDED_OPTIONS = [
  { value: '', label: '未声明' },
  { value: 'IN', label: '已含在票内' },
  { value: 'EXTRA', label: '需另付' },
];
const { parseRoleNeed } = require('../../../../../utils/role-need.js');

function emptyForm(address) {
  return {
    name: '',
    address: address || '',
    longitude: '',
    latitude: '',
    templateId: 0,
    templateName: '',
    xpValue: '',
    message: '',
    perkTemplateId: 0,
    perkName: '',
    quotaTotal: '',
    familyAccepted: false, // F12:是否接受亲子票(1 大 1 小同享一份权益)
    familyPerkText: '',    // F12:儿童份说明,如「儿童份小杯」
    perHeadFee: '',
    // P1-2:玩家可见条款
    dailyCapacity: '',
    validStart: '',
    soldOutRuleText: '',
    includedMode: '',
    includedName: '未声明',
    extraSpendText: '',
    reserveRequired: false,
    storefrontImg: '',   // 门店照片(1 张):该位置的玩家卡图
    termsAgreed: false,  // P1-3:不默认勾选
    supplyName: '',
    supplyKind: 'SERVICE',
    supplyKindName: '常规服务',
    regularPrice: '',
    durationMinutes: '',
    availableHours: '',
    minPeople: '1',
    maxPeople: '1',
    splitBookingAllowed: 0,
    splitBookingName: '同行同时参与',
    actionType: 'NAVIGATE',
    actionTypeName: '导航到店',
    actionValue: '',
    optionalBenefit: '',
    benefitRules: '',
    merchantRules: '',
  };
}

Component({
  properties: {
    show: { type: Boolean, value: false },
    chapterId: { type: Number, value: 0 },
    chapterName: { type: String, value: '' },
    // F3(cy-chapter-target-picker)里已经选过的玩法,带过来预填 —— 在这儿还能改。
    // 不覆盖用户在本表单里已经选过的:预填只发生在 show 打开、且本表单还没选时。
    presetTemplateId: { type: Number, value: 0 },
    presetTemplateName: { type: String, value: '' },
    termsMode: { type: String, value: '' },
    // 本章节的权益零售价门槛(元);空 = 不设门槛。服务端 MerchantOfferServiceImpl 按同一门槛拒收
    perkMinValue: { type: String, value: '' },
    // 本位置的模板指引原文(适合店铺 / 权益示例 / 最低交付要求),只读展示
    roleNeed: { type: String, value: '' },
    formMode: { type: String, value: 'application' },
    /* CU-M-58:同一个(商家 + 章节)在后端是唯一键原地覆盖(findMine → update,并回待审核),
       所以再次打开不是「新申请」。调用方把我已有的那个点位传进来,表单据此回填
       并把标题/按钮/提示都说成编辑与覆盖。 */
    presetNode: { type: Object, value: null },
    circleMode: { type: Boolean, value: false },
    // P1-4:预览外框取主题外观;没有门店照片时卡图回落主题封面。
    lookJson: { type: String, value: '' },
    topicCover: { type: String, value: '' },
    // 已生效供给改展示条款(GET /api/coop/offer/display-terms 的回包);非空 = 只改说明,不重新入驻。
    editOffer: { type: Object, value: null },
    defaultAddress: { type: String, value: '' },
    submitting: { type: Boolean, value: false },
  },

  data: {
    sheetStyle: '--cy-comp-sheet-max-h:var(--cy-comp-sheet-max-height);',
    form: emptyForm(''),
    // CU-M-58:true = 本次提交会覆盖已有点位(不是新增)
    editing: false,
    templates: [],
    templatesLoading: false,
    templatesError: '',
    perkTemplates: [],
    perkTemplatesError: '',
    perkTemplatesLoading: false,
    perkMinText: '',
    perkBelowMin: false,
    roleNeedInfo: parseRoleNeed(''),
    // F11:自由探索权益卡的线下结算说明(服务端下发,含场次主办方名);取不到就不显示。
    settlementNote: '',
    canSubmit: false,
    locationReady: false,
    // P1-2 / P1-3 / P1-4
    shopTermsOn: false,
    termsEditing: false,
    includedOptions: INCLUDED_OPTIONS,
    consentText: CONSENT_TEXT,
    storefrontUrls: [],
    previewCards: [],
    previewStyle: '',
    today: '',
    supplyKinds: [
      { value: 'SERVICE', label: '常规服务' },
      { value: 'PRODUCT', label: '正常商品' },
      { value: 'EVENT', label: '已有活动' },
      { value: 'ZERO_BROWSE', label: '0元浏览/试用' },
    ],
    actionTypes: [
      { value: 'NAVIGATE', label: '导航到店' },
      { value: 'BOOK', label: '预约入口' },
      { value: 'BUY', label: '购买入口' },
    ],
    splitBookingOptions: [
      { value: 0, label: '同行同时参与' },
      { value: 1, label: '允许分开预约/轮换' },
    ],
  },

  lifetimes: {
    attached() {
      const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      const sheetTop = resolveMenuChrome(windowInfo, (app.globalData || {}).menuButtonInfo).sheetTop;
      this.setData({ sheetStyle: `--cy-comp-sheet-max-h:calc(100vh - ${sheetTop}px);` });
    },
  },

  observers: {
    show(value) {
      if (value) this.openForm();
      else this._formVersion = (this._formVersion || 0) + 1;
    },
  },

  pageLifetimes: {
    show() {
      if (!this.data.show) return;
      // L06-032:地图选点/选地址回来不重拉;只有去创建过玩法(或上次失败)才重拉模板列表
      if (this.data.formMode !== 'offer' && (this._templatesStale || this.data.templatesError)) this.loadMyTemplates();
      // 地图选点 / 选图也会让页面 show 一次。权益模板只在打开表单、去创建过、或上次没拉到时重拉。
      if (this.data.formMode === 'offer' && this.data.termsMode === 'PERK'
          && (this._perkTemplatesStale || this.data.perkTemplatesError)) {
        this.loadMyPerkTemplates();
      }
    },
  },

  methods: {
    openForm() {
      this._formVersion = (this._formVersion || 0) + 1;
      const preset = this.data.presetNode;
      // CU-M-58「编辑已有点位」只属于承接申请;「填写实际供给」不是改点位,不能沿用上一次申请留下的预填
      const editing = this.data.formMode !== 'offer' && !!(preset && Number(preset.id) > 0);
      this.setData({
        form: emptyForm(this.data.defaultAddress),
        canSubmit: false,
        locationReady: false,
        editing: editing,
      });
      if (this.data.formMode === 'offer') {
        const edit = this.data.editOffer && Number(this.data.editOffer.offerId) > 0 ? this.data.editOffer : null;
        const shopTermsOn = this.data.termsMode === 'PERK' && !this.data.circleMode;
        this.setData({
          settlementNote: '', shopTermsOn, termsEditing: !!(shopTermsOn && edit), storefrontUrls: [],
          today: chinaDateKey(Date.now()) || '', previewStyle: previewFrameStyle(this.data.lookJson),
        });
        if (shopTermsOn && edit) {
          const includedMode = edit.included === true ? 'IN' : (edit.included === false ? 'EXTRA' : '');
          const img = String(edit.storefrontImg || '');
          this.setData({
            'form.perkName': String(edit.perkName || ''),
            'form.dailyCapacity': edit.dailyCapacity == null ? '' : String(edit.dailyCapacity),
            'form.validStart': String(edit.validStart || ''),
            'form.soldOutRuleText': String(edit.soldOutRuleText || ''),
            'form.includedMode': includedMode,
            'form.includedName': INCLUDED_OPTIONS.filter((o) => o.value === includedMode)[0].label,
            'form.extraSpendText': String(edit.extraSpendText || ''),
            'form.reserveRequired': edit.reserveRequired === true,
            'form.storefrontImg': img,
            storefrontUrls: img ? [img] : [],
          });
        }
        if (this.data.termsMode === 'PERK') {
          if (!this.data.termsEditing) this.loadMyPerkTemplates();
          this.loadSettlementNote();
        }
        if (shopTermsOn) this.loadShopName();
        this.refreshSubmitState();
        return;
      }
      this.loadMyTemplates();
      if (!editing && !this.data.defaultAddress) this.loadMerchantAddress();
      /* F3 里已经选过玩法就预填。emptyForm() 刚把表单清空,所以放在它之后 ——
         这是「打开表单」这一刻的初值,不是覆盖用户在本表单里的选择:
         这里之后的每一次改动都走 onTemplatePick,不再经过 openForm。 */
      if (this.data.presetTemplateId) {
        this.setData({
          'form.templateId': this.data.presetTemplateId,
          'form.templateName': this.data.presetTemplateName || '',
        });
        this.refreshSubmitState();
      }
      /* CU-M-58:已有点位回填。放在玩法预选之后 —— 点位自己那份玩法才是原值,
         别被上一屏顺手选的那个盖掉。已有点位缺地址时必须重新选点，不能与门店地址拼接。 */
      if (editing) {
        this.setData({
          'form.name': String(preset.name || ''),
          'form.address': String(preset.address || ''),
          'form.longitude': preset.longitude == null ? '' : String(preset.longitude),
          'form.latitude': preset.latitude == null ? '' : String(preset.latitude),
          locationReady: hasCoords(preset) && !!String(preset.address || '').trim(),
          'form.templateId': Number(preset.templateId) || 0,
          'form.templateName': '',
          'form.xpValue': preset.xpValue === null || preset.xpValue === undefined ? '' : String(preset.xpValue),
        }, () => this.refreshSubmitState());
      }
    },

    loadMerchantAddress() {
      const that = this;
      app.sendRequest({
        hideLoading: true,
        url: '/api/merchant/info',
        method: 'POST',
        success(res) {
          const address = res.code == '200' && res.data ? String(res.data.address || '').trim() : '';
          if (address && !that.data.form.address) {
            that.setData({ 'form.address': address });
          }
        },
      });
    },

    // P1-4:预览卡上的店名取商家资料;取不到就写「本店」。
    loadShopName() {
      const version = this._formVersion;
      app.sendRequest({
        hideLoading: true,
        url: '/api/merchant/info',
        method: 'POST',
        success: (res) => {
          if (version !== this._formVersion || !this.data.show) return;
          const name = res && res.code == '200' && res.data ? String(res.data.name || '').trim() : '';
          if (name) { this._shopName = name; this.refreshPreview(); }
        },
      });
    },

    onValidStartChange(e) {
      if (this.data.submitting) return;
      this.setData({ 'form.validStart': String((e && e.detail && e.detail.value) || '') }, () => this.refreshSubmitState());
    },

    onIncludedPick(e) {
      if (this.data.submitting) return;
      const item = INCLUDED_OPTIONS[Number(e.detail.value)] || INCLUDED_OPTIONS[0];
      this.setData({
        'form.includedMode': item.value,
        'form.includedName': item.label,
        'form.extraSpendText': item.value === 'EXTRA' ? this.data.form.extraSpendText : '',
      }, () => this.refreshSubmitState());
    },

    onReserveRequiredChange(e) {
      if (this.data.submitting) return;
      this.setData({ 'form.reserveRequired': !!(e && e.detail && e.detail.value) }, () => this.refreshSubmitState());
    },

    onTermsAgreedChange(e) {
      if (this.data.submitting) return;
      this.setData({ 'form.termsAgreed': !!(e && e.detail && e.detail.checked) }, () => this.refreshSubmitState());
    },

    // 门店照片:走全站统一的选图 → 裁剪 → 上传链(app.chooseImage),只收 1 张。
    chooseStorefront() {
      if (this.data.submitting) return;
      const version = this._formVersion;
      app.chooseImage((urls) => {
        const url = urls && urls.length ? String(urls[0] || '') : '';
        if (!url || version !== this._formVersion || !this.data.show) return;
        this.setData({ 'form.storefrontImg': url, storefrontUrls: [url] }, () => this.refreshSubmitState());
      }, 1, { crop: true, cropScale: '3:4' });
    },

    removeStorefront() {
      if (this.data.submitting) return;
      this.setData({ 'form.storefrontImg': '', storefrontUrls: [] }, () => this.refreshSubmitState());
    },

    /** 表单里的玩家可见条款 → 提交字段;与后端 /api/coop/offer/enroll、/offer/display-terms 同名。 */
    shopTermsPayload() {
      const form = this.data.form || {};
      const daily = Number(form.dailyCapacity);
      const mode = form.includedMode;
      return {
        included: mode === 'IN' ? 1 : (mode === 'EXTRA' ? 0 : null),
        extraSpendText: mode === 'EXTRA' ? String(form.extraSpendText || '').trim().slice(0, 100) : '',
        reserveRequired: form.reserveRequired ? 1 : 0,
        dailyCapacity: form.dailyCapacity !== '' && Number.isInteger(daily) && daily > 0 ? daily : null,
        validStart: String(form.validStart || ''),
        soldOutRuleText: String(form.soldOutRuleText || '').trim().slice(0, 100),
        storefrontImg: String(form.storefrontImg || ''),
      };
    },

    // P1-4:预览与玩家端主题详情用同一个组件、同一条权益行拼法(explorePerkLine)。
    refreshPreview() {
      if (!this.data.shopTermsOn) {
        if ((this.data.previewCards || []).length) this.setData({ previewCards: [] });
        return;
      }
      const form = this.data.form || {};
      const terms = this.shopTermsPayload();
      const card = {
        key: 'preview',
        targetId: 0,
        name: this._shopName || '本店',
        img: terms.storefrontImg || String(this.data.topicCover || '').split(',')[0],
        perk: explorePerkLine({
          perkName: form.perkName,
          included: terms.included === 1 ? true : (terms.included === 0 ? false : null),
          extraSpendText: terms.extraSpendText,
          reserveRequired: terms.reserveRequired === 1,
          dailyCapacity: terms.dailyCapacity,
          validStart: terms.validStart,
          soldOutRuleText: terms.soldOutRuleText,
        }),
        place: this.data.chapterName || '',
      };
      const prev = (this.data.previewCards || [])[0];
      if (!prev || prev.name !== card.name || prev.img !== card.img || prev.perk !== card.perk || prev.place !== card.place) {
        this.setData({ previewCards: [card] });
      }
    },

    loadMyTemplates() {
      const that = this;
      if (that.data.templatesLoading) return;
      that._templatesStale = false;
      that.setData({ templatesLoading: true, templatesError: '' });
      app.sendRequest({
        hideLoading: true,
        url: '/api/template/my-list',
        method: 'POST',
        data: { scope: 'MERCHANT' },
        success(res) {
          // L06-031:读失败不能显示成「还没有可配置的玩法」,给错误态与重试
          if (!(res && res.code == '200' && res.data && isRecordList(res.data.rows))) {
            that.setData({ templates: [], templatesError: (res && res.msg) || '玩法模板读取失败' });
            return;
          }
          const rows = res.data.rows;
          that.setData({ templates: rows });
          /* CU-M-58:回填只给得了 templateId(点位行上没有玩法标题),名字要等这份列表回来才补得上,
             否则选择器会显示成「选择我已有的玩法」而其实已经选好了。 */
          const id = Number(that.data.form.templateId);
          if (id && !that.data.form.templateName) {
            const hit = rows.filter(function (t) { return Number(t.id) === id; })[0];
            if (hit) that.setData({ 'form.templateName': hit.title || '' }, () => that.refreshSubmitState());
          }
        },
        fail() {
          that.setData({ templates: [], templatesError: '网络异常，玩法模板未读取' });
        },
        complete() {
          that.setData({ templatesLoading: false });
        },
      });
    },

    loadSettlementNote() {
      const chapterId = Number(this.data.chapterId);
      if (!Number.isSafeInteger(chapterId) || chapterId <= 0) return;
      const version = this._formVersion;
      app.sendRequest({
        hideLoading: true,
        silentError: true,
        url: '/api/fe/reference-settlement/note',
        method: 'GET',
        data: { chapterId },
        success: (res) => {
          if (version !== this._formVersion || !this.data.show) return;
          // FE-G23:优先显示 perkNoCashReason(核销后商家账本里那句零现金原因),缺省回落 text。
          const data = res && (res.code === 200 || res.code === '200') && res.data;
          const pick = (v) => (typeof v === 'string' ? v.trim() : '');
          const note = data ? (pick(data.perkNoCashReason) || pick(data.text)) : '';
          this.setData({ settlementNote: note });
        },
        // 说明取不到就整行不显示,不影响填写与提交。
        fail: () => { if (version === this._formVersion) this.setData({ settlementNote: '' }); },
        successStatusAbnormal: () => { if (version === this._formVersion) this.setData({ settlementNote: '' }); },
      });
    },

    loadMyPerkTemplates() {
      const that = this;
      if (that.data.perkTemplatesLoading) return;
      that._perkTemplatesStale = false;
      const seq = (that._perkListSeq = (that._perkListSeq || 0) + 1);
      that.setData({ perkTemplatesLoading: true, perkTemplatesError: '' });
      app.sendRequest({
        hideLoading: true,
        url: '/api/coop/perk-template/list',
        method: 'POST',
        header: { 'Content-Type': 'application/json' },
        data: JSON.stringify({}),
        success(res) {
          if (seq !== that._perkListSeq || !that.data.show) return;
          // 读失败不能显示成「还没有常备权益」(与玩法模板 L06-031 同一口径)
          const ok = (res && (res.code == '200' || res.code === 200) && Array.isArray(res.data));
          if (!ok) {
            that._perkTemplatesStale = true;
            that.setData({ perkTemplates: [], perkTemplatesError: (res && res.msg) || '常备权益读取失败' });
            return;
          }
          const rows = res.data.filter(function (row) {
            const retailValue = Number(row && row.retailValue);
            const quota = Number(row && row.quota);
            return Number.isFinite(retailValue) && retailValue > 0
              && Number.isInteger(quota) && quota > 0;
          });
          that.setData({ perkTemplates: rows, perkTemplatesError: '' }, () => that.refreshSubmitState());
        },
        fail() {
          if (seq !== that._perkListSeq || !that.data.show) return;
          that._perkTemplatesStale = true;
          that.setData({ perkTemplates: [], perkTemplatesError: '网络异常，常备权益未读取' });
        },
        complete() {
          if (seq !== that._perkListSeq) return;
          that.setData({ perkTemplatesLoading: false });
        },
      });
    },

    // F12:接受亲子票开关(关掉时清空儿童份说明)
    onFamilyAcceptedChange(e) {
      if (this.data.submitting) return;
      const on = !!(e && e.detail && e.detail.value);
      this.setData({ 'form.familyAccepted': on, 'form.familyPerkText': on ? this.data.form.familyPerkText : '' });
    },

    onInput(e) {
      if (this.data.submitting) return;
      const key = e.currentTarget.dataset.key;
      if (!key || !Object.prototype.hasOwnProperty.call(this.data.form, key)) return;
      // L06-121:只写改动的那一格,不再每次按键整份 form(约 30 项)来回拷贝
      if (key === 'address' && e.detail.value !== this.data.form.address) {
        this.setData({ 'form.address': e.detail.value, 'form.longitude': '', 'form.latitude': '', locationReady: false }, () => this.refreshSubmitState());
        return;
      }
      this.setData({ ['form.' + key]: e.detail.value }, () => this.refreshSubmitState());
    },

    chooseNodeLocation() {
      if (this.data.submitting || this.data.formMode === 'offer') return;
      const version = this._formVersion || 0;
      const chapterId = this.data.chapterId;
      const formMode = this.data.formMode;
      const memberId = typeof app.getUserID === 'function' ? app.getUserID() : null;
      const isCurrent = () => this.data.show && !this.data.submitting
        && (this._formVersion || 0) === version
        && this.data.chapterId === chapterId && this.data.formMode === formMode
        && (typeof app.getUserID !== 'function' || app.getUserID() === memberId);
      cyModal.show({
        title: '确认到店位置',
        content: '地图选点用于保存这个节点的到店位置，供玩家导航和现场位置校验。',
        confirmText: '去地图选点',
        success: (res) => {
          if (!res || !res.confirm || !isCurrent()) return;
          pickLocation({
            latitude: this.data.locationReady ? this.data.form.latitude : '',
            longitude: this.data.locationReady ? this.data.form.longitude : '',
            onPick: (poi) => {
              if (!isCurrent()) return;
               const address = String(poi.address || '').trim() || String(poi.name || '').trim();
               if (!address) {
                 app.tips('请选择有地址的到店位置');
                 return;
               }
               this.setData({
                  'form.address': address,
                  'form.longitude': String(poi.longitude),
                  'form.latitude': String(poi.latitude),
                  'form.name': String(this.data.form.name || '').trim() ? this.data.form.name : String(poi.name || ''),
                 locationReady: true,
               }, () => this.refreshSubmitState());
            },
          });
        },
      });
    },

    // 第九轮 m1-9:已确认的到店位置点开地图看;改位置走「地图选点」
    viewNodeLocation() {
      const f = this.data.form || {};
      if (this.data.locationReady) openAddress().openAddress({ latitude: f.latitude, longitude: f.longitude, name: f.name, address: f.address });
    },

    onTemplatePick(e) {
      if (this.data.submitting) return;
      const template = this.data.templates[Number(e.detail.value)] || {};
      if (isAlbumTemplate(template)) {
        cyToast(ALBUM_ONLY_IN_STORY);
        return;
      }
      this.setData({
        'form.templateId': Number(template.id) || 0,
        'form.templateName': template.title || '',
      }, () => this.refreshSubmitState());
    },

    onPerkPick(e) {
      if (this.data.submitting) return;
      const perk = this.data.perkTemplates[Number(e.detail.value)] || {};
      this.setData({
        'form.perkTemplateId': Number(perk.id) || 0,
        'form.perkName': perk.name || '',
      }, () => this.refreshSubmitState());
    },

    onSupplyKindPick(e) {
      const item = this.data.supplyKinds[Number(e.detail.value)] || this.data.supplyKinds[0];
      this.setData({ 'form.supplyKind': item.value, 'form.supplyKindName': item.label },
        () => this.refreshSubmitState());
    },

    onActionTypePick(e) {
      const item = this.data.actionTypes[Number(e.detail.value)] || this.data.actionTypes[0];
      this.setData({ 'form.actionType': item.value, 'form.actionTypeName': item.label },
        () => this.refreshSubmitState());
    },

    onSplitBookingPick(e) {
      const item = this.data.splitBookingOptions[Number(e.detail.value)] || this.data.splitBookingOptions[0];
      this.setData({
        'form.splitBookingAllowed': item.value,
        'form.splitBookingName': item.label,
      }, () => this.refreshSubmitState());
    },

    goCreateTemplate() {
      if (this.data.submitting) return;
      this._templatesStale = true; // 回来时重拉模板列表
      // M-09:from=join ⇒ 发布后回到本表单(不再 reLaunch 去模板库),新玩法直接选上
      const version = this._formVersion;
      wx.navigateTo({
        url: '/pages/publish/temp/index?scope=MERCHANT&from=join',
        events: {
          templateCreated: (tpl) => {
            if (version !== this._formVersion || !this.data.show || !tpl || !Number(tpl.id)) return;
            this.setData({
              'form.templateId': Number(tpl.id),
              'form.templateName': String(tpl.title || ''),
            }, () => this.refreshSubmitState());
          },
        },
      });
    },

    goCreatePerkTemplate() {
      if (this.data.submitting) return;
      this._perkTemplatesStale = true;
      wx.navigateTo({ url: '/pages/merchant/decor/perks/index' });
    },

    refreshSubmitState() {
      const form = this.data.form || {};
      const quota = Number(form.quotaTotal);
      const quotaValid = Number.isInteger(quota) && quota >= 1;
      const fee = Number(form.perHeadFee);
      const feeValid = form.perHeadFee !== '' && Number.isFinite(fee) && fee >= 0;
      const perkMin = Number(this.data.perkMinValue);
      const perkMinText = this.data.termsMode === 'PERK' && this.data.perkMinValue !== '' && Number.isFinite(perkMin) && perkMin > 0
        ? (perkMin % 1 === 0 ? String(perkMin) : perkMin.toFixed(2)) : '';
      const pickedPerk = (this.data.perkTemplates || []).filter((p) => Number(p.id) === Number(form.perkTemplateId))[0];
      const perkBelowMin = !!perkMinText && !!pickedPerk && Number(pickedPerk.retailValue) < perkMin;
      if (perkMinText !== this.data.perkMinText || perkBelowMin !== this.data.perkBelowMin) {
        this.setData({ perkMinText, perkBelowMin });
      }
      // P1-2:每日容量填了就必须是正整数;选了「需另付」必须写清另付什么。P1-3:入驻必须勾选同意。
      const daily = Number(form.dailyCapacity);
      const shopTermsValid = !this.data.shopTermsOn || (
        (form.dailyCapacity === '' || (Number.isInteger(daily) && daily >= 1 && daily <= 99999))
        && (form.includedMode !== 'EXTRA' || !!String(form.extraSpendText || '').trim())
        && (this.data.termsEditing || !!form.termsAgreed)
      );
      this.refreshPreview();
      const roleNeedSource = String(this.data.roleNeed || '');
      if (roleNeedSource !== this._roleNeedSource) {
        this._roleNeedSource = roleNeedSource;
        this.setData({ roleNeedInfo: parseRoleNeed(roleNeedSource) });
      }
      const termsSupplyValid = this.data.termsEditing ? shopTermsValid : this.data.termsMode === 'PERK'
        ? !!Number(form.perkTemplateId) && quotaValid && !perkBelowMin && shopTermsValid
        : this.data.termsMode === 'REVSHARE'
          ? feeValid
          : this.data.termsMode === 'TRAFFIC';
      const price = Number(form.regularPrice);
      const duration = Number(form.durationMinutes);
      const minPeople = Number(form.minPeople);
      const maxPeople = Number(form.maxPeople);
      const circleSupplyValid = !this.data.circleMode || (
        !!String(form.supplyName || '').trim()
        && form.regularPrice !== '' && Number.isFinite(price) && price >= 0
        && Number.isInteger(duration) && duration > 0
        && !!String(form.availableHours || '').trim()
        && Number.isInteger(minPeople) && minPeople > 0
        && Number.isInteger(maxPeople) && maxPeople >= minPeople
        && (maxPeople >= 2 || Number(form.splitBookingAllowed) === 1)
        && !!String(form.actionValue || '').trim()
        && (!String(form.optionalBenefit || '').trim() || !!String(form.benefitRules || '').trim())
        && !!String(form.merchantRules || '').trim()
      );
      const canSubmit = this.data.formMode === 'offer'
        ? termsSupplyValid && circleSupplyValid
        : !!String(form.name || '').trim() && !!String(form.address || '').trim()
          && !!Number(form.templateId) && hasCoords(form);
      if (canSubmit !== this.data.canSubmit) this.setData({ canSubmit });
    },

    onSubmit() {
      if (this.data.submitting) return;
      const form = this.data.form || {};
      if (this.data.formMode !== 'offer') {
        const name = String(form.name || '').trim();
        if (!name) {
          app.tips('请填写节点名称');
          return;
        }
        if (!Number(form.templateId)) {
          app.tips('请选择玩法模板');
          return;
        }
        if (!String(form.address || '').trim()) {
          app.tips('请在地图选择有地址的到店位置');
          return;
        }
        if (!hasCoords(form)) {
          app.tips('请在地图选择到店位置');
          return;
        }
        this.triggerEvent('submit', {
          chapterId: Number(this.data.chapterId),
          templateId: Number(form.templateId),
          name,
          address: String(form.address || '').trim(),
          longitude: String(form.longitude),
          latitude: String(form.latitude),
          xpValue: form.xpValue === '' ? null : Number(form.xpValue),
          message: String(form.message || '').trim(),
        });
        return;
      }

      const termsMode = this.data.termsMode;
      if (this.data.termsEditing) {
        if (!this.data.canSubmit) return;
        this.triggerEvent('submit', {
          chapterId: Number(this.data.chapterId),
          offerId: Number(this.data.editOffer.offerId),
          displayTerms: this.shopTermsPayload(),
        });
        return;
      }
      if (this.data.shopTermsOn && !form.termsAgreed) {
        app.tips('请先勾选同意条款');
        return;
      }
      const quotaTotal = Number(form.quotaTotal);
      if (termsMode === 'PERK' && (!Number.isInteger(quotaTotal) || quotaTotal < 1)) {
        app.tips('请填写至少 1 人次的核销额度');
        return;
      }
      if (termsMode === 'PERK' && !Number(form.perkTemplateId)) {
        app.tips('请选择实际供给的权益');
        return;
      }
      // 低于门槛的提示已经红字挂在字段下,这里只拦,不再弹
      if (termsMode === 'PERK' && this.data.perkBelowMin) return;
      const perHeadFee = Number(form.perHeadFee);
      if (termsMode === 'REVSHARE'
          && (form.perHeadFee === '' || !Number.isFinite(perHeadFee) || perHeadFee < 0)) {
        app.tips('请填写有效的每人次计酬金额');
        return;
      }
      if (termsMode !== 'TRAFFIC' && termsMode !== 'PERK' && termsMode !== 'REVSHARE') {
        app.tips('章节供给档位无效');
        return;
      }
      const detail = { chapterId: Number(this.data.chapterId), termsMode };
      if (this.data.circleMode) {
        const durationMinutes = Number(form.durationMinutes);
        const optionalBenefit = String(form.optionalBenefit || '').trim();
        detail.circleSupplyProfile = {
          supplyName: String(form.supplyName || '').trim(),
          supplyKind: form.supplyKind,
          regularPrice: Number(form.regularPrice),
          actionType: form.actionType,
          actionValue: String(form.actionValue || '').trim(),
          availableHours: String(form.availableHours || '').trim(),
          minPeople: Number(form.minPeople),
          maxPeople: Number(form.maxPeople),
          durationMinutes,
          splitBookingAllowed: Number(form.splitBookingAllowed),
          optionalBenefit,
          benefitRules: String(form.benefitRules || '').trim(),
          merchantRules: String(form.merchantRules || '').trim(),
        };
      }
      if (termsMode === 'PERK') {
        detail.perkTemplateId = Number(form.perkTemplateId);
        detail.quotaTotal = quotaTotal;
        detail.familyAccepted = form.familyAccepted ? 1 : 0;
        detail.familyPerkText = form.familyAccepted ? String(form.familyPerkText || '').trim().slice(0, 200) : '';
        if (this.data.shopTermsOn) {
          detail.displayTerms = this.shopTermsPayload();
          detail.termsAgreed = true;
        }
      }
      if (termsMode === 'REVSHARE') detail.perHeadFee = perHeadFee;
      this.triggerEvent('submit', detail);
    },

    onClose() {
      if (!this.data.submitting) {
        this._formVersion = (this._formVersion || 0) + 1;
        this.triggerEvent('close');
      }
    },
  },
});
