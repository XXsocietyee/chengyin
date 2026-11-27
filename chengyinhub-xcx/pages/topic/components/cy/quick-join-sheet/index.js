const app = getApp();

const CONSENT_TEXT = '已阅读并同意：玩家到店出示核销码，扫码核销后提供对应福利；每日名额满或不在可用时段可改天再来';
const HOUR_PRESETS = [
  { label: '全天可用', value: '' },
  { label: '14:00-17:00', value: '14:00-17:00' },
  { label: '工作日 10:00-17:00', value: '工作日 10:00-17:00' },
];

function emptyForm() {
  return {
    perkDescription: '',
    originalPrice: '',
    offPeakHours: '',
    dailyCap: '',
    storefrontPhoto: '',
    termsAgreed: false,
  };
}

function firstPhotoFromMerchant(data) {
  if (!data || typeof data !== 'object') return '';
  if (data.coverImage && String(data.coverImage).trim()) return String(data.coverImage).trim();
  if (data.derivatives) {
    const first = String(data.derivatives).split(',').map((s) => s.trim()).filter(Boolean)[0];
    if (first) return first;
  }
  if (data.logo && String(data.logo).trim()) return String(data.logo).trim();
  return '';
}

Component({
  options: { addGlobalClass: true },
  properties: {
    show: { type: Boolean, value: false },
    chapterId: { type: Number, value: 0 },
    applicationId: { type: Number, value: 0 },
    chapterName: { type: String, value: '' },
    termsMode: { type: String, value: 'PERK' },
    perkMinValue: { type: String, value: '' },
  },

  data: {
    form: emptyForm(),
    photoUrls: [],
    hourPresets: HOUR_PRESETS,
    consentText: CONSENT_TEXT,
    perkMinText: '',
    priceBelowMin: false,
    canSubmit: false,
    submitting: false,
    submitError: '',
  },

  observers: {
    show(value) {
      if (value) this.openSheet();
      else this._sheetVersion = (this._sheetVersion || 0) + 1;
    },
  },

  methods: {
    openSheet() {
      this._sheetVersion = (this._sheetVersion || 0) + 1;
      const perkMin = Number(this.data.perkMinValue);
      const perkMinText = this.data.termsMode !== 'TRAFFIC'
        && this.data.perkMinValue !== '' && Number.isFinite(perkMin) && perkMin > 0
        ? ('¥' + (perkMin % 1 === 0 ? String(perkMin) : perkMin.toFixed(2))) : '';
      this.setData({
        form: emptyForm(),
        photoUrls: [],
        perkMinText,
        priceBelowMin: false,
        canSubmit: false,
        submitting: false,
        submitError: '',
      }, () => this.refreshSubmitState());
      this.loadDefaultApplyPhoto();
    },

    loadDefaultApplyPhoto() {
      const version = this._sheetVersion;
      app.sendRequest({
        hideLoading: true,
        autoErrorToast: false,
        url: '/api/merchant/info',
        method: 'POST',
        success: (res) => {
          if (version !== this._sheetVersion || !this.data.show) return;
          if (!res || String(res.code) !== '200' || !res.data) return;
          const photo = firstPhotoFromMerchant(res.data);
          if (photo && !this.data.form.storefrontPhoto) {
            this.setData({ 'form.storefrontPhoto': photo, photoUrls: [photo] });
          }
        },
      });
    },

    onInput(e) {
      if (this.data.submitting) return;
      const key = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.key;
      if (!key || !Object.prototype.hasOwnProperty.call(this.data.form, key)) return;
      const nextForm = Object.assign({}, this.data.form);
      nextForm[key] = e.detail.value;
      this.setData({ form: nextForm, submitError: '' }, () => this.refreshSubmitState());
    },

    pickHourPreset(e) {
      if (this.data.submitting) return;
      const value = String((e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.value) || '');
      this.setData({ 'form.offPeakHours': value, submitError: '' }, () => this.refreshSubmitState());
    },

    onTermsAgreedChange(e) {
      if (this.data.submitting) return;
      this.setData({ 'form.termsAgreed': !!(e && e.detail && e.detail.checked), submitError: '' },
        () => this.refreshSubmitState());
    },

    choosePhoto() {
      if (this.data.submitting) return;
      const version = this._sheetVersion;
      app.chooseImage((urls) => {
        const url = urls && urls.length ? String(urls[0] || '') : '';
        if (!url || version !== this._sheetVersion || !this.data.show) return;
        this.setData({ 'form.storefrontPhoto': url, photoUrls: [url] });
      }, 1, { crop: true, cropScale: '3:4' });
    },

    removePhoto() {
      if (this.data.submitting) return;
      this.setData({ 'form.storefrontPhoto': '', photoUrls: [] });
    },

    refreshSubmitState() {
      const form = this.data.form || {};
      const isTraffic = this.data.termsMode === 'TRAFFIC';
      const dailyCapNum = Number(form.dailyCap);
      const dailyCapValid = form.dailyCap === ''
        || (Number.isInteger(dailyCapNum) && dailyCapNum >= 1 && dailyCapNum <= 99999);
      const priceNum = Number(form.originalPrice);
      const priceValid = form.originalPrice !== '' && Number.isFinite(priceNum) && priceNum > 0;
      const minNum = Number(this.data.perkMinValue);
      const priceBelowMin = !isTraffic && !!this.data.perkMinText && Number.isFinite(minNum) && minNum > 0
        && priceValid && priceNum < minNum;
      const canSubmit = isTraffic
        ? dailyCapValid
        : !!String(form.perkDescription || '').trim()
          && priceValid && !priceBelowMin
          && dailyCapValid
          && !!form.termsAgreed;
      if (priceBelowMin !== this.data.priceBelowMin || canSubmit !== this.data.canSubmit) {
        this.setData({ priceBelowMin, canSubmit });
      }
    },

    onSubmit() {
      if (this.data.submitting || !this.data.canSubmit) return;
      const form = this.data.form || {};
      const isTraffic = this.data.termsMode === 'TRAFFIC';
      const payload = {
        chapterId: Number(this.data.chapterId),
        offPeakHours: String(form.offPeakHours || '').trim(),
        dailyCap: form.dailyCap === '' ? null : Number(form.dailyCap),
        storefrontPhoto: String(form.storefrontPhoto || '').trim(),
        termsAgreed: isTraffic ? true : !!form.termsAgreed,
      };
      if (Number(this.data.applicationId) > 0) payload.applicationId = Number(this.data.applicationId);
      if (!isTraffic) {
        payload.perkDescription = String(form.perkDescription || '').trim();
        payload.originalPrice = Number(form.originalPrice);
      }
      const version = this._sheetVersion;
      this.setData({ submitting: true, submitError: '' });
      app.sendRequest({
        autoErrorToast: false,
        url: '/api/merchant/fe/quick-join',
        method: 'POST',
        header: { 'Content-Type': 'application/json' },
        data: JSON.stringify(payload),
        success: (res) => {
          if (version !== this._sheetVersion) return;
          if (res && (res.code === 200 || res.code === '200')) {
            this.setData({ submitting: false });
            this.triggerEvent('joined', res.data || {});
            return;
          }
          this.setData({
            submitting: false,
            submitError: (res && res.msg) || '加入失败，请检查填写后重试',
          });
        },
        fail: () => {
          if (version !== this._sheetVersion) return;
          this.setData({ submitting: false, submitError: '网络异常，请重试' });
        },
      });
    },

    onClose() {
      if (!this.data.submitting) {
        this._sheetVersion = (this._sheetVersion || 0) + 1;
        this.triggerEvent('close');
      }
    },
  },
});
