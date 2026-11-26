# 业主 2026-11-22 定稿三项(分支 `fix/owner-decisions-1122`)

只改显示。没有改存储金额、订单/退款/支付逻辑、DDL、配置键、CI 或架构。

## 1) 金额只显示一位小数

业主原话:「数字只需要显示到一位小数。」

| 金额 | 显示 |
|---|---|
| 29.9 | ¥29.9 |
| 39 | ¥39.0 |
| 1200 | ¥1200.0 |
| 0.01 | ¥0.01(第二位小数非零时保留两位,保证金额不会显示错) |
| 12.35 | ¥12.35 |
| 0 | ¥0.0 |
| −15.44(退款冲回) | −¥15.44 |

- 这条规则取代旧的「一律两位小数」(打磨第 3 轮 §4-9 / §4-20)和 OR-046「不补零」。复核了 OR-021(我的订单列表)。
- 小程序:`utils/money-format.js` 新增 `decimalText`,`yuan` / `yuanTrim` 都用它;`utils/wxs/money.wxs` 的 `amount` / `amount2` 用同一规则(WXML 里的 ¥ 都经过它)。凡是 JS 自己拼 ¥ 的地方(玩家、商家、俱乐部、订单、退款、台账、合作分润、定价)都改成调用这个入口。
- 测试:`money-format-r3.test.js` 新增 29.9 / 39 / 0.01 / 12.35 / 0 / 负数退款的用例,并校验 money.wxs 和 JS 输出一致;旧的两位小数和不补零断言都已改成新口径。
- 这次没有改:后端 Java 自己拼好再下发的金额文案(如 `settledAmountText`、`paidAmountText`、站内通知里的「退款 ¥x」)。这些文案仍按服务端原样显示。如果也要统一,需要另开一个后端 PR,并在测试 VPS 上跑 Java 测试。

## 2) PG-086 复核:商家「输入核验编号」手工流程

业主原话:「玩家不需要看到这个编号。」

- 玩家屏不新增任何核验或提交编号。商家的 `pages/merchant/game-node`「输入核验编号」流程保持原样。
- 只记录,不改代码。需要注意:现有玩家答题页在提交待审核时会显示「核验编号 {{submissionId}}」(`pages/play/index.wxml` 待审核行,以及 `pages/play/index.js` 提交成功的 toast)。这是本次之前就有的,按指示没有改动;要不要去掉请业主决定。去掉以后,商家的手工核验就得改用别的凭据。

## 3) V-23 复核:举报按钮(device-walkthrough-20261029)

业主原话:「这个主题不允许举报,所以先不加举报按钮。」

- 主题详情页已经没有任何举报入口(V-23 时就已去掉)。玩法详情页同样没有。
- 俱乐部页的主题活动卡上,原来有「更多 → 举报活动」入口。现在用 `topicReportExposed: false` 把它关掉,不再渲染。`reportTopicActivity`、`reportTopic`、`pages/topic/utils/content-report.js` 和后端接口都保留,只是不对玩家露出。
- 测试:新增 `owner-decisions-1122.test.js`(主题详情、玩法详情、俱乐部活动卡都没有可点的举报入口;处理器保留;商家「输入核验编号」保持原样)。

## 验证

- `node ci/prepare-mini-artifacts.js`:通过
- `node --test "tests/unit/**/*.test.js"`:18111 / 18111 通过(master 基线是 18105 / 18105)
- `node tests/lint/ui-integrity.js --warn-as-error`:UI-GATE-0 PASS
- `js-scope-lint`、`xcx-unit-manifest --selftest`、`verify-mini-artifacts`、`requestbody-contract`:都通过
