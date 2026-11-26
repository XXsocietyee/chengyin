# 运维 runbook（审计 2026-11-22，BE2 车道）

本目录只有文档和脚本，**没有任何东西被执行过**。每一步都由业主（或业主授权的人）亲手执行。
**生产库的只读查询和所有写入（迁移、补台账、清理）只经业主的受保护生产迁移工具：先只读预检，再由业主确认。**
本目录里直接运行 `ci/run_migration.py --config …` 或 `d1_list_landed.py` 的命令只适用于开发、测试、CI 库。
地址、主机名、webhook 一律用占位符：`<APP_HOST>`（应用机）、`<DB_HOST>`（库机）、`<ADMIN_DOMAIN>`（后台域名）、
`<ALLOWED_CIDR_1>`…（允许访问后台的地址）、`<ALARM_WEBHOOK_URL>`（告警机器人地址）。真实值不要写回本仓库（公开仓）。

## 顺序

| # | 步骤 | 文档 | 何时 | 回滚 |
|---|---|---|---|---|
| 0 | 生产备份并保存回执 | [D6](D6-backup-restore.md) 第 1 节 | 任何迁移、任何部署之前 | — |
| 1 | 建台账表 + 补基线 | [D1](D1-migration-baseline.md) | 部署本 PR 的 jar 之前或同一窗口 | 删基线行 |
| 2 | 先跑新迁移，再上 jar | [发布前迁移](release-migrations-1122.md) | 每次带迁移的发布 | 见各迁移头注释 |
| 3 | 部署 jar 后：提现申请默认拒绝 | [发布前迁移](release-migrations-1122.md) 第 3 节 | BE1 的 jar 上线后 | 设 `WITHDRAWAL_REQUEST_ENABLED=true` |
| 4 | 定时任务降噪生效 + 留存任务 | [D2](D2-job-log-noise.md) | 本 PR 的 jar 上线后 | 见文档 |
| 5 | 后台只允许指定地址 | [C2](C2-admin-console-restrict.md) | 尽快；售卖前 | 恢复 nginx 配置备份 |
| 6 | 日志按天轮转，留 30 天 | [D3](D3-log-rotation.md) | 任意窗口 | 删 logrotate 配置 |
| 7 | 告警通道 + 测试告警 | [D5](D5-alert-channel.md) | 任意窗口 | 清空 `ALARM_WEBHOOK` |
| 8 | 备份计划 + 一次恢复演练 | [D6](D6-backup-restore.md) | 售卖前 | — |

## 每一步都要留的回执

执行人、时间、命令输出截屏或文本（去掉口令与地址后）贴回私有仓 `AUDIT-1122/` 下对应条目；
「做了」以回读结果为准，不以命令退出码为准。
