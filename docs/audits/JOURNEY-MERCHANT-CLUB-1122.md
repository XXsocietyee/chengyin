# JOURNEY-MERCHANT-CLUB-1122 · 商家与俱乐部主理人走查

日期 2026-11-22，分支 `fix/merchant-club-journey-1122`。这次在代码里按新商家、新主理人的路径从头走到尾，看每一步有没有下一步动作、按钮去向是否有效、空态和首次使用是否只给一个动作、报错是否显示后端原话、用词是否自然、写接口是否校验 owner/scope。

已经在 1121 复核清单（`audit/verify-1121-D/E`）里的条目一律跳过：

- MC-044 `event-ops` 主题 #id
- MC-047 审核时效句
- MC-049 半角「(选填)」
- PG-046/051/053/054/058/062–066/068/070/071/073/076/086/089 等样式与说明文字

不改金额、退款、结算、提现逻辑，不改 DDL 和 CI 架构，`app.json` 与 `pages/play` 也没有动。

## 走查表

| 旅程 · 步骤 | 问题 | 修复（文件）或需要业主拍板 |
|---|---|---|
| 1 入驻 · 审核通过 | 申请状态页写着「商家身份已生效」，唯一的按钮却是「返回」，新商家找不到经营台入口 | 生效时主按钮改为「进入经营台」，点了直接进经营台（`utils/merchant-identity-policy.js` 新增 `canEnterWorkbench`；`pages/merchant/apply/index.{js,wxml}`） |
| 1 入驻 · 认领门店通过 | 认领通过后面板只有「知道了」，文案还让用户「重新进入商家中心」 | 通过态改为「进入经营台」，去掉多余的那半句（`merchant-claim-sheet/index.{js,wxml}`、`pages/merchant/utils/merchant-claim.js`） |
| 1 入驻 · 认领搜索 | 搜索失败（断网或 5xx）也显示「未找到门店，可申请入驻」，会把店主引去重复入驻 | 失败时用行内错误显示后端原话，真的没搜到才说未找到（`merchant-claim-sheet`） |
| 1 入驻 · 填表 | 选执照、选品牌图、选店址之后回到页面会触发 onShow 整页复检，半填的表单被「正在确认申请资格」盖住，还多打两次请求 | 同一账号从系统选择器回来时不再复检；选择期间切了账号仍然复检，旧账号的选择结果照旧被身份票据丢弃（`apply/index.js`） |
| 1 入驻 · 主理人俱乐部卡 | 俱乐部没有名字时显示「俱乐部 #123」 | 改为「未命名俱乐部」（`merchant-identity-policy.js`） |
| 1 首次登录 · 经营台 | 新商家一个项目都没有时，项目区整块隐藏，经营台没有给出第一步 | **需要业主拍板**：UI-01（2026-09-18）定的是「一个项目都没有时整块不显示」。要不要改成放一张「完善品牌中心」卡？ |
| 2 品牌中心 · 进入 | 身份接口断网或 5xx 时被当成「当前身份不能装修店铺」，只给「返回」，没有重试 | 改为可重试的错误态，显示后端原话，重试时先重读身份（`decor/index.js`） |
| 2 品牌中心 · 运营岗 | 只有合作经营权限的岗位也能看到换 Logo、换封面、营业开关、门店相册、AI 店铺角色、招牌主推、衍生权益，改完才被后端拒绝 | 相册、AI 角色这两个入口和编辑角标只给有资料写权限的岗位；营业开关置灰；其余入口点击时先提示「你的岗位不能修改店铺资料」（`decor/index.{js,wxml}`） |
| 2 AI 店铺角色 | `hasProfile` 只写进了 `this.data`，没走 `setData`，所以审核签、驳回理由、「已设置」都不会上屏 | `hasProfile` 放进 `setData`；`savedAvatar` 仍然只放在 `this.data` 里（受 U4 约束）（`decor/ai-npc/index.js`） |
| 2 AI 店铺角色 · 保存失败 | 画布导出失败时报错内容为空（页面看起来没反应），或者显示英文「canvas not found」 | 报错改成中文；没有原话时用兜底句「保存没有完成，请重试」（`ai-npc/index.js`） |
| 2 门店地址 / 漫游落点 | 定位权限被拒后点选点没有任何反应 | 新增 `utils/location-pick-failure.js`，与入驻页同一口径：取消不提示，拒绝授权给「去设置」，其他失败如实说明（`decor/index.js`、`ai-npc/index.js`） |
| 2 常备权益 | 后端明确拒绝时也写「常备权益保存状态待确认」 | 确定被拒时写「常备权益没有保存」；只有网络未知或回读中才写「待确认」（`decor/perks/index.wxml`） |
| 2 承接设置 | 字段叫「接待人数」，提示却写「可容纳人数要填数字」 | 提示改为「接待人数要填数字」（`decor/coop-setting/index.js`） |
| 3 城市节点 · 核销员 | 共享扫码会把节点码指到「城市节点」页，但这页只放行有项目权限的人，核销员进来只看到「当前身份不能管理节点」 | 有核销权限就放行，页面只给「扫码核销」，不读节点列表（`citynode/index.{js,wxml}`） |
| 3 城市节点 · 列表 | 审核通过的申请和在架节点重复列出，条数算了两遍；列表加载失败不显示后端原话 | 已在架的那条「已通过」申请不再列出；错误态显示后端原话（`citynode/index.{js,wxml}`） |
| 3 合作 · 再邀别人 | 店长从商家视角点「再邀别人」时丢了 `scope=MERCHANT`，后端把店长当成发布者本人，于是拒绝 | 带上 scope（`pages/coop/list/index.js`） |
| 3 合作中心 · 推荐定位 | 从 AI 参谋带 `topicId` 进入时，那条推荐会被标亮，但列表在 scroll-view 里滚动，`pageScrollTo` 滚不到它 | 改用 `scroll-into-view`（`coop-center/index.{js,wxml}`） |
| 3 游戏站点 | 备用方案显示内部编码，例如「RAIN_PLAN v2」 | 按备用站名显示；匹配不上时显示「已设置」（`game-node/index.{js,wxml}`） |
| 3 合作邀请 · 恢复卡 | 「查询原请求」「本机原请求」「原邀请请求」等工程用词 | 改为「查询结果」「查询发给 X 的邀请」「查找已发出的邀请」等（`coop/invite/index.{js,wxml}`）。`index.js:330` 的「#id」属于 PG-089，未动 |
| 4 营销 · 我的内容 | 运营岗点主题/活动格子没有任何反应 | 点击时提示「你的岗位不能管理内容」；无障碍的 button 契约不变（`marketing/index.js`） |
| 4 触达记录 | 「还没有触达记录」没有下一步动作，小程序里也没有发起触达的入口 | **需要业主拍板**：要不要在小程序里补发起入口？还是没有数据时把这个入口藏起来？ |
| 5 核销与退款 / 结算 | 整页加载失败一律写死「请稍后重试」 | 显示后端原话，没有原话时才用兜底句（`ledger/index.{js,wxml}`） |
| 5 核销记录 | 列表在 scroll-view 里，`onReachBottom` 永远不触发，第二页永远读不到；同时页脚还写着「已经到底了」 | 触底续读改挂在 scroll-view 上；还有下一页时页脚写「正在加载更多…」；续读失败显示后端原话（`verify-records/index.{js,wxml}`） |
| 5 评价 · 回复待确认 | 「读取原回复请求」「复制原请求号」等工程用词 | 改为「确认回复是否已发出」「复制核对编号」（`reviews/index.wxml`） |
| 5 团队 · 邀请落地 | 邀请失效被拒之后，「接受邀请」仍然留在页面上，点了没反应，也没有出口 | 失效后换成「返回」按钮（`team/index.{js,wxml}`） |
| 5 团队 · 危险确认 | 经营身份无效时，确认弹窗已经开始转圈，却直接 return，弹窗一直转下去 | 走 `reportDanger` 收口（`team/index.js`） |
| 6 建俱乐部 · 完成 | 「进入俱乐部管理」只打开概览页，看不到「发布主题 / 开一场」 | 带上 `tab=manage`，直接落在管理页（`club/create/index.js`） |
| 6 建俱乐部 · 第二个 | 有一个被驳回后重新提交、正在待审的俱乐部时，再建一个不同名的俱乐部，后端会回放那条待审行，前端显示「已重新提交」并配上新名字，实际上什么都没建 | 待审行只在同名时才算重放，不同名照常走配额并新建（`ClubServiceImpl.insertClubWithinOwnerQuotaLocked`）；新增后端测试 |
| 6 成员治理 | 旧管理员（role=1）看得到「临时封禁 / 成员治理」，进去后后端只认主理人和联合主理人，结果永远卡在「重新加载」 | 入口只给主理人和联合主理人；治理页对其他身份直接显示无权限态（`club/detail/index.{js,wxml}`、`club/governance/index.js`） |
| 6 开一场 · 断网重试 | 每次点「创建」都会生成新的 requestId，断网后重试可能把系列建两遍 | 表单内容不变时沿用同一个 requestId，成功后或表单改了才换号（`club/event-ops/index.js`） |
| 6 个人收款 | 缺少 clubId 时给「重新加载」，但重试也不可能成功；没有俱乐部时页面是空白的 | 缺参数给「返回」；没有俱乐部给「创建俱乐部」（`club/payout-receiver/index.{js,wxml}`） |
| 6 俱乐部资料编辑 | 联合主理人和运营能打开编辑表单，保存前却被拦下，提示「权限已变化」；后端只允许主理人和旧管理员保存；角色页又写着联合主理人「可维护俱乐部资料」 | **需要业主拍板**：二选一。要么后端改按 `CLUB_WRITE` 放行，要么删掉角色页那句说明，并把表单入口收到主理人 |
| 6 角色 / 客户 / 治理空态 | 新俱乐部的「暂无成员」「还没有客户」「暂无可治理成员」都没有动作 | **需要业主拍板**：分别给什么动作（邀请成员？发布主题？）。这些页面不在本 PR 范围内 |
| 6 活动空态文案 | 「暂时俱乐部还没有活动」语序别扭 | **需要业主拍板**：这句是 P-14 Figma 定稿文案，有测试钉死，建议改为「俱乐部还没有活动」 |

## 权限与归属

三个子代理把每个写接口追到了 Controller 和 Service，又逐条复核：

- 商家侧：资料、装修、营业状态、NPC、合作档案、权益模板、认领、团队 7 个接口、CRM、城市节点、合作处理、章节邀请、评价、售后。
- 俱乐部侧：入会审核、移除成员、开放设置、徽章、帖文、CRM、活动运营、通知、角色、治理、资料修改。

结论：这些写接口都从登录 token 取商家或俱乐部身份，没有发现信任请求体 owner 的写接口。本 PR 没有放宽任何权限：

- 前端入口只按后端的现有口径收紧（成员治理、品牌中心写入、城市节点只给核销员扫码）。
- 后端唯一的改动是建俱乐部的幂等判定，没有改权限。

## 测试

- 新增 `chengyinhub-xcx/tests/unit/merchant-club-journey-1122.test.js`：每一行修复对应一条用例，用沙箱跑真实页面代码，并内联负控。
- 新增后端用例 `ClubCreateRetryIdempotencyConcurrencyTest.aDifferentlyNamedClubIsCreatedInsteadOfReplayingTheOnePendingReview`。本地跑了 5 个俱乐部配额与幂等测试类，共 29 条，全部通过。
- 更新了 7 个原来钉住旧行为的契约：
  - `club-create-state` / `club-management-flow`：跳转改为带 `&tab=manage`。
  - `merchant-apply-state`：同账号从选点返回不再复检。
  - `merchant-citynode-access`：只有核销权限也放行。
  - `merchant-decor-figma-save` / `store-info-l04`：模拟的是店主，所以补上写权限。
  - `merchant-reco-topic-session`：滚动定位改为 scroll-into-view。
  - `visual-report-funds-loading`：骨架复位时允许同时清掉 `errorText`。
- 已跑：`node tests/lint/ui-integrity.js --warn-as-error`、`node ci/prepare-mini-artifacts.js`、js-scope-lint、api-existence-gate、silent-error-gate，以及小程序全量单测。
