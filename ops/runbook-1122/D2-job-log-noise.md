# D2 定时任务日志降噪与保留期

**问题**：30 个启用任务每天约 11,650 次运行，每次一行 `sys_job_log`：945,617 行、171 MB，占库 65%；
`metrics_snapshot` 另有 61 MB。

## 代码侧（本 PR，部署后自动生效）

- `sys_job_log` 只写：失败（每次）、后台「执行一次」（每次）、状态变化（进程启动后首轮、成功↔失败切换、
  任务恢复或修改后的首轮）。连续成功不再落库，只在应用日志 debug 级留一行。
- 任务可调用 `JobRunOutcome.skipped("原因")` 声明「功能关闭本轮跳过」，这一轮不落库（手动执行除外）。
- **任务行为不变**：每个任务照常按 cron 执行，资金类任务（105 分润结算、108 T+7 打款、110、116、117 等）的执行、
  加锁、失败上抛与告警全部不变；只是成功回执不再每轮写一行。
- `sys_job_log` 保留 30 天：调度模块自带的 `SysJobLogRetention` 每天 03:40 在调度 leader 上分批删除 30 天前的行
  （每批 1000、最多 500 批，每批独立提交）。**它不依赖数据留存任务，部署后自动生效。**
  天数 `chengyin.retention.ops-log-days`（默认 30，<=0 关闭），时间 `chengyin.quartz.job-log.prune-cron`。
  第一次运行时积压约 94 万行，单晚最多删 50 万行，第二晚删完；也可先做下面的一次性手工清理。
- `metrics_snapshot` 保留 30 天：数据留存任务 `dataRetentionCleanupTask.run()` 新增一步 `metrics_snapshot`，同一个天数键。
  **这一步要等留存任务启用后才会跑**（见下）。

## 业主要做的

1. 部署后看一眼：后台「调度日志」里不再每分钟出现成功行；失败照常出现。
2. **留存任务目前在生产是暂停的**（登记时备注「默认暂停；核对隐私指引、留存配置后由责任人启用」）。
   它除了本次新增的指标快照清理，还会按隐私政策删除浏览记录（180 天）、行为事件（365 天）、NPC 对话（90 天）、
   AI 生成日志（180 天）、漫游精确位置（30 天）。启用前请确认这些天数与线上《隐私政策》一致；
   只想先清指标快照、暂不动其它数据的话，见下面「一次性手工清理」。
3. 启用（决定后）：后台「定时任务」→ `数据留存清理` → 启用；次日 03:30 后在调度日志里看到一行成功。
4. 一次性手工清理（可选，先备份，维护窗口里做；不依赖留存任务）。以下语句**经业主的受保护生产迁移工具执行：先只读预检，再由业主确认**：
   ```sql
   -- 先看量
   SELECT COUNT(*) FROM sys_job_log WHERE create_time < NOW() - INTERVAL 30 DAY;
   SELECT COUNT(*) FROM metrics_snapshot WHERE sampled_at < NOW() - INTERVAL 30 DAY;
   -- 每次 5000 行，重复执行到影响行数为 0
   DELETE FROM sys_job_log WHERE create_time < NOW() - INTERVAL 30 DAY ORDER BY job_log_id LIMIT 5000;
   DELETE FROM metrics_snapshot WHERE sampled_at < NOW() - INTERVAL 30 DAY LIMIT 5000;
   ```
   删除后 InnoDB 文件不会自动变小；需要回收空间时，维护窗口里 `OPTIMIZE TABLE sys_job_log;`（会锁表重建，先备份）。
5. 验收：一周后经受保护工具只读执行
   `SELECT DATE(create_time) d, COUNT(*) FROM sys_job_log GROUP BY d ORDER BY d DESC LIMIT 7;` 每天行数应从上万降到个位或两位数；
   `SELECT table_name, ROUND((data_length+index_length)/1024/1024) mb FROM information_schema.tables WHERE table_schema=DATABASE() ORDER BY mb DESC LIMIT 10;`

## 回滚

降噪是代码行为，回滚 = 回滚 jar。两处保留期删除可一起关：环境变量 `CHENGYIN_RETENTION_OPS_LOG_DAYS=0`
（对应 `chengyin.retention.ops-log-days=0`），重启生效。
