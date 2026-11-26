# D6 备份：确认计划，并做一次真实恢复演练

**问题**：没有找到生产定时备份或恢复演练的证据。工具已有：`scripts/db-backup-restore.py`，完整说明在
[`ops/db-backup-restore.md`](../db-backup-restore.md)（备份前后快照比对、回执、只往空的异 UUID 实例恢复）。

## 业主要先回答的（写进私有仓 D6 条目）

1. 云厂商是否开着库盘/系统盘的**自动快照**？频率与保留天数？（控制台「快照」页截图）
2. 生产 binlog 保留天数（经受保护工具只读查询）：`SELECT @@binlog_expire_logs_seconds/86400 AS days, @@log_bin, @@binlog_format;`
3. 选哪种日常备份：
   - A. 云盘自动快照（每天，留 7–14 天）+ 每周一次本工具逻辑备份（维护窗口，停写）；
   - B. 只读从库上每天跑本工具；
   - C. 只在每次发布前跑本工具（最少；不建议作为唯一手段）。

## 1. 立即：一次逻辑备份（每次迁移/发布前都要）

维护窗口、应用停写后，由业主在能连库、且已按 `ops/db-backup-restore.md` 配好私有 defaults 文件的机器上执行
（这是备份工具，不经迁移工具；它只读源库）：
```sh
python3 scripts/db-backup-restore.py backup \
  --defaults-file <私有路径>/source.cnf --database chengyinhubdb \
  --server-uuid <SOURCE_UUID> --output <私有路径>/backup-$(date +%Y%m%d-%H%M).sql
```
`<SOURCE_UUID>` 先 `SELECT @@server_uuid;` 人工核对。成功后同目录有 `.json` 回执（600 权限）。
备份文件拷一份到**另一台机器或对象存储**（不同账号/不同地域更好），只放在库机上不算备份。

## 2. 定时（选 A/B 后）

方案 A 的每周逻辑备份可用 `d6_backup_cron.template`：每周一 04:10 跑，保留最近 8 份。
脚本不处理停写：**只能用在只读从库上**（方案 B），或者由业主改为维护窗口手动触发。

## 3. 恢复演练（售卖前至少一次，之后每月一次）

1. 准备一台**新的、空的、不同 server_uuid、同 MySQL 版本、`event_scheduler=OFF`** 的实例，建同名空库。
2. 按 `ops/db-backup-restore.md` 第 3 节执行 `restore … --confirm-test-target`。
3. 工具会逐表比对行数与校验和、逐对象比对定义；不一致即失败。
4. 按第 4 节起一个不接生产流量的应用实例指向恢复库（独立 Redis），回读：健康检查、后台登录、`/api/topic/list`、一笔历史订单。
5. 记录 RPO/RTO 表（第 4 节模板），贴回私有仓 D6 条目。
6. 演练完销毁恢复实例（里面是生产数据）。

## 验收

- D6 条目里有：快照/备份计划截图、最近一次备份回执的 SHA-256、一次成功的恢复演练记录（含行数比对结果、RPO/RTO）。
