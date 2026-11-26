# D5 告警通道：配置并发一条测试告警

**问题**：告警 webhook 11-02 被清空，之后没再确认；现在所有 `AlarmService` 告警（资金对账、留存失败、支付查单失败…）
只进应用 error 日志，没人看得到。

## 应用读哪些配置

`application.yml`：`alarm.webhook: ${ALARM_WEBHOOK:}`、`alarm.failure-webhook: ${ALARM_FAILURE_WEBHOOK:}`。
未配置时 `AlarmService` 只写 error 日志。消息格式是钉钉/企业微信通用的
`{"msgtype":"text","text":{"content":"[城瘾告警] 标题\n详情"}}`；钉钉机器人若开了「自定义关键词」，关键词设为 `城瘾告警`。

## 步骤

1. 在钉钉或企业微信群里建机器人，拿到 `<ALARM_WEBHOOK_URL>`（再建一个独立群/机器人作 `<ALARM_FAILURE_WEBHOOK_URL>`，可选）。
   **这个地址等同口令，不要发到聊天、工单或仓库。**
2. 先在应用机上直接测机器人本身（不经过应用）：
   ```sh
   read -rs ALARM_WEBHOOK && export ALARM_WEBHOOK   # 粘贴地址，不回显、不进 shell 历史
   bash ops/runbook-1122/d5_test_alert.sh
   unset ALARM_WEBHOOK
   ```
   群里收到「[城瘾告警] 通道测试」，脚本打印 `OK`。打印 `REJECTED errcode=…` 多半是关键词或 IP 白名单设置。
3. 配到应用：在 systemd drop-in（与其它密钥同一个文件，权限 600）里加
   ```
   Environment=ALARM_WEBHOOK=<ALARM_WEBHOOK_URL>
   Environment=ALARM_FAILURE_WEBHOOK=<ALARM_FAILURE_WEBHOOK_URL>
   ```
   `systemctl daemon-reload && systemctl restart <服务名>`。
4. 经应用验证：重启后应用日志里不应再有「未配置 webhook」类提示；之后第一条真实告警
   （`grep "\[ALARM\]" /www/wwwlogs/java/springboot/chengyinhub-admin.log`）出现时，群里必须同时收到。
   日志里出现 `告警投递被第三方拒绝` 或 `失败事件投递` 即通道仍不通，回到第 2 步。
5. 回执：群消息截图（打码地址）+ 执行时间，贴回私有仓 D5 条目。

## 定期复核

每月第一个工作日重复第 2 步（机器人会被群主误删、关键词会被改）。

## 回滚

从 drop-in 删掉两行，`daemon-reload` 并重启；应用退回「只记日志」。
