// cy-role-card · F05 组队角色卡(站点卡 encounter 区域)。
// 数据只来自 GET /api/play/encounter 的 roleView;组队只给本人那一份,SOLO 合并全部视图(见 utils/role-card-view.js)。
const { roleCardView } = require('../../utils/role-card-view.js');

Component({
  properties: {
    view: { type: Object, value: null },
    collapsible: { type: Boolean, value: false },
    defaultCollapsed: { type: Boolean, value: false },
  },
  data: { card: null, collapsed: false },
  observers: {
    view(value) { this.setData({ card: roleCardView(value) }); },
    defaultCollapsed(value) { this.setData({ collapsed: !!value }); },
  },
  methods: {
    toggleCollapse() {
      if (!this.data.collapsible) return;
      this.setData({ collapsed: !this.data.collapsed });
    },
    onEscapeSolo() {
      this.triggerEvent('escapesolo', {}, { bubbles: true, composed: true });
    },
  },
});
