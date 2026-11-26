# JOURNEY-CREATOR-1122 · 首次作者创作全流程走查

走法：在代码里按首次作者的顺序走一遍：开新主题 → 章节故事流 → 角色 → 站点选玩法 → 草稿 → 发布 → 我的模板 / 我的项目。走的时候查五件事：

- 下一步清不清楚
- 跳转有没有断
- 空态能不能往下走
- 删除能不能撤销
- 有没有「点了没反应」

所有修复都在小程序端，没有改支付、DDL、密钥、CI 和架构，也没有动 `app.json` 和 `pages/play`。复核清单 audit/verify-1121-D/E 里已经登记的条目都没有碰，包括：

- PG-066：temp 预览副行、图片地址栏
- PG-073：半角括号
- PG-076：「· 标准玩法」
- PG-003：safeDecode
- V-13：官方模板封面

测试在 `chengyinhub-xcx/tests/unit/creator-journey-1122.test.js`，每条修复对应一条用例，共 18 条。

| 步骤 | 问题 | 修复（文件） | 需业主决定 |
|---|---|---|---|
| 1 起名 | 没起名就点「保存草稿」只弹一句会消失的 toast，名字框没有红字 | 改为名字框下出红字并滚动到名字框；一输入就清掉（`fabu/index.js` saveServerDraft / onNameChange，`fabu/index.wxml`，`index.wxss`） | — |
| 1 主题详情 | 校验袋里有 `errors.name / description / categoryIds`，但页面只给封面和必达数渲染了红字 | 名称、类别、剧情详情三栏下加 `cy-inline-error kind="field"`；改动后清掉（`fabu/index.wxml`、`topic-detail-sheet.wxml`、`index.js`） | 档期、票种各栏的内联红字（`ticketName{i}` 等）这次没做，要不要统一到栏下 |
| 1 票务设置 | 保存过的票种删不掉：`deleteTicket` 没有绑定任何控件 | 票种编辑器底部加「删除这个票种」，删完出 5 秒「撤销」条（`fabu/step3.wxml`、`index.js` deleteTicket、`index.wxss`） | 「收起」会直接丢掉未保存的票种修改，要不要加「放弃修改？」确认 |
| 2 章节 | 删章节只有一句「删除后不可恢复」，撤销栈压了快照却没有入口 | 新增页面级撤销条 `_pageUndoBar` / `undoPageStep`，复用 `_undoStack`；确认框改为「删除后 5 秒内可以撤销」（`fabu/index.js`、`index.wxml`、`index.wxss`） | — |
| 2 分支去向 | 分支去向按章号存（`chapter:N`），删掉前面的章后会悄悄跳错章，指向已删章的显示原始 `chapter:5` | `remapBranchTargetsAfterChapterRemoval`：后面的章号前移一位，指向被删章的改回「继续本章」，撤销条写明改了几条（`utils/publish/pro-editor-story.js`、`fabu/index.js`） | 长期做法是把去向改存章节 id 而不是位置，这要和服务端 `ChapterFlowCompiler` 的去向语法一起改 |
| 2 结局章 | 「设为结局」被拦时弹 toast，可开关下面就有现成的红字位 | 改写 `chapterEndingError`，红字出现在开关下（`fabu/index.js` onChapterEndingToggle） | — |
| 2 伏笔 / 选项 | 引用的伏笔或选项被删后，编辑器和试玩结局卡露出内部键名 | 改为显示「伏笔已删除」、「某个伏笔」、「某个选项」（`fabu/index.wxml`、`utils/publish/topic-draft-preview.js`） | — |
| 2 图片 | 上一张图还在上传时再点「图片」，什么反应都没有 | 提示「上一张还在上传，传完再加」（`fabu/index.js` insertStoryImageAt） | — |
| 2 分支选项 | 点 ✕ 删掉一条分支选项不能撤销 | 未改：故事流的撤销条在分支半屏下面，直接接上会被盖住 | 分支半屏里要不要做就地撤销 |
| 3 角色 | 删角色不能撤销；它的对白留着失效的说话人编号，结局章仍挂在它名下（还被显示成「不归属」），分支信任里的这一行界面上看不见却照样上送 | `memberRefs` / `dropMemberRefs`：对白变成同内容的段落，结局章改回未归属，去掉信任行；确认框列出影响；可撤销；撤销条压过整屏角色面板（`utils/publish/story-cast.js`、`fabu/theme-cast.js`、`index.wxss`） | 已删角色的录音和线索随撤销窗口过去就找不回，可以接受吗 |
| 4 选玩法 | 「我的模板」读取失败时和「没有模板」看起来一样 | 新增 `tempListState`，失败时显示「我的模板加载失败 · 重试」，重新打开选玩法时自动重读（`fabu/index.js` getTempList、`index.wxml`） | 审核中的模板现在被直接过滤掉，作者看不到它们。要不要列出来标「审核中」 |
| 4 新建玩法 | 节点没起名就去建玩法，玩法名被预填成内部编号「节点lid3」 | 不起名就留空，由作者在玩法页起名（`fabu/index.js`） | — |
| 4 预览 | 在选玩法半屏里点「预览」，关掉预览后半屏没了，刚选的玩法也丢了 | 记下半屏状态，关掉预览后回到半屏、仍选着原来那个玩法（`temp/index.js` previewGameFromSheet / closePreview） | — |
| 4 配置 | 灰着的「添加加值」点了没有反应；「添加效果」在还没有数值时打开一个空半屏 | 加值说清是哪一种满了（`_modAddOffReason`）；没有数值时提示并直接打开「新建数值」（`temp/check-section.js`、`temp/after-section.js`） | — |
| 4 偏好题 | 报错和占位直接露英文键名和「JSON」：steps、dimensions、tiebreak、title、body 等 | 改成作者能看懂的中文（`temp/index.js`、`temp/index.wxml`） | 偏好题整体还是手写配置文本框，跟「选而不配」不符。是保留、只开放给官方模板，还是做成选择式 |
| 5 草稿 | 保存草稿失败后，页内「重试」绑的是 `submitForm`，点下去会走发布流程 | 加 `retrySubmitError`：存草稿失败就重存草稿，发布失败仍走发布（`fabu/index.js`、`index.wxml`） | — |
| 5 草稿 | 「保存为主题后才能添加线索与物品」这个空态没有下一步按钮 | 未改：这句在主题详情半屏里，「保存草稿」按钮被半屏压在下面 | 这里是否就地放一个「保存草稿」 |
| 6 发布检查 | 章节规则问题在检查清单里显示成「章节 index=0：…」 | 改为显示章名或「第 N 章」（`fabu/index.js` buildPublishCheck） | — |
| 6 发布成功 | 自由探索和商家发布成功后，也叫人「找俱乐部带团」，标题也恒为「城市路线已发布」 | 新增 `_publishedCopy()`，按模式和身份给标题与下一步（`fabu/index.js`） | — |
| 7 我的项目·模板 | 商家点自己的模板时没带 `operationScope`，详情页会按玩家身份去读 | 点模板时带上 `&operationScope=MERCHANT`（`subpackageA/pages/myproject/index.js`） | — |
| 7 我的项目·模板 | 项目列表读失败时模板页整页空白；空态也没有下一步 | 项目读失败时照常显示空态；空态加 CTA「做一个玩法」，进入 template-intro（`myproject/index.wxml`、`index.js`） | — |
| 7 我的项目·模板 | 下架、撤回广场审核一点就执行，成功只提示「操作成功」 | 提示里说清做了什么、怎么改回来；两者都能用同一个按钮改回，所以没加确认框（`myproject/index.js` tplToggle） | 「从广场下架」影响正在用这个模板的人，要不要改成先确认 |
| 7 我的模板（旧页） | `subpackageMember/mytemplate` 还在 app.json 里，但已经没有任何入口跳到它 | 未改：本线不改 app.json | 删掉这个页面，还是重新接上入口 |

## 验证

| 检查 | 结果 |
|---|---|
| `node --test tests/unit/creator-journey-1122.test.js` | 18/18 通过 |
| 小程序全量单测 `tests/unit/**/*.test.js` | 18105 条中 18104 条通过；唯一失败是按钮台账闸，原因是新加的「重试」没有登记分支。已在 `scripts/uiaudit/build-action-ledger.js` 登记 retrySubmitError 的草稿 / 发布四个分支，相关的 200 个文件、2287 条复跑全绿 |
| 受影响的单测，共 305 个文件 | 3788 条全绿。其中 `fabu-cloud-autosave` 的一条断言跟着这次改动更新：从「toast 提示」改为「名字框下红字」 |
| `node tests/lint/ui-integrity.js --warn-as-error` | UI-GATE-0 PASS |
| `lint:scope`、`lint:requestbody`、`lint:danger-confirm`、`lint:sticky-bottom-bar`、`audit:actions`、`ci/verify-mini-artifacts.js`、`ci/silent-error-gate.js`、`ci/api-existence-gate.js` | 全部通过 |
| `node ci/prepare-mini-artifacts.js` | 通过 |

没有截模拟器图：这次在云端容器里跑，没有微信开发者工具。
