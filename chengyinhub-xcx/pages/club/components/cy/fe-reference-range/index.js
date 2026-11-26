// P1-10 自由探索结算（参考）外加日期范围与 CSV 导出:包住主包的 cy-fe-reference-settlement,
// 起止日期经属性传给它(列表按范围重读),导出走同侧 /export(与列表同一归属与筛选)。
// 本组件在 pages/merchant 与 pages/club 两个分包各有一份,内容逐字相同。
const app = getApp();
const modal = require('../../../../../utils/modal.js');
const toast = require('../../../../../utils/toast.js');
const { rangeQuery, exportFile } = require('./view-model.js');

Component({
  properties: {
    kind: { type: String, value: 'merchant' },
  },
  data: { from: '', to: '', exporting: false },
  lifetimes: {
    attached() { this._attached = true; },
    detached() { this._attached = false; },
  },
  methods: {
    onFromChange(event) { this.setRange(event.detail.value, this.data.to); },
    onToChange(event) { this.setRange(this.data.from, event.detail.value); },
    onClearRange() { this.setRange('', ''); },
    setRange(from, to) {
      const range = rangeQuery(from, to);
      this.setData({ from: range.from || '', to: range.to || '' });
    },

    onExport() {
      const kind = this.properties.kind;
      if (this.data.exporting || !['merchant', 'payer'].includes(kind)) return;
      const memberId = String(app.getUserID());
      const current = () => this._attached && memberId === String(app.getUserID());
      const failed = () => { if (current()) { this.setData({ exporting: false }); toast('导出失败，请重试'); } };
      this.setData({ exporting: true });
      app.sendRequest({
        hideLoading: true, silentError: true,
        url: (kind === 'payer' ? '/api/fe/reference-settlement/payer' : '/api/fe/reference-settlement/merchant') + '/export',
        method: 'GET',
        data: rangeQuery(this.data.from, this.data.to),
        success: (res) => {
          if (!current()) return;
          const file = exportFile(res);
          if (!file) { failed(); return; }
          this.setData({ exporting: false });
          this.saveExport(file);
        },
        fail: failed, successStatusAbnormal: failed,
      });
    },

    // 写到本地用户目录后由用户点按发到微信(发文件必须由点按触发);不支持或发送失败时改为复制内容。
    saveExport(file) {
      const copy = () => wx.setClipboardData({
        data: file.content.replace(/^\uFEFF/, ''),
        success: () => toast('已复制对账表内容'),
        fail: () => toast('导出失败，请重试'),
      });
      if (typeof wx.shareFileMessage !== 'function' || typeof wx.getFileSystemManager !== 'function') { copy(); return; }
      const filePath = wx.env.USER_DATA_PATH + '/' + file.fileName;
      wx.getFileSystemManager().writeFile({
        filePath, data: file.content, encoding: 'utf8',
        success: () => {
          if (!this._attached) return;
          modal.show({
            title: '对账表已生成',
            content: file.fileName,
            confirmText: '发送到微信',
            cancelText: '取消',
            success: (res) => {
              if (!res || !res.confirm) return;
              wx.shareFileMessage({
                filePath, fileName: file.fileName,
                fail: (err) => { if (!/cancel/i.test(String(err && err.errMsg || ''))) copy(); },
              });
            },
          });
        },
        fail: copy,
      });
    },
  },
});
