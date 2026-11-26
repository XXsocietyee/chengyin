// 身份标识小标(RBAC):player/club/merchant/official
// 设计来源 Figma: club 107-10399 / merchant 107-10371 / official 109-10406
Component({
  properties: {
    // 角色:player(不显示) / club / merchant / official
    // L09-099
    // 业主默认 B:颜色不动,只删没有调用方用的「玩家」标开关与从未加载的花体字
    role: { type: String, value: 'player' }
  }
});
