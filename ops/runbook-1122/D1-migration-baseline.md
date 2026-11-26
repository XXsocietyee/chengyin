# D1 迁移台账：建表、补基线、何时开始自动记录

**问题**：`cy_migration_history` 0 行，没人能说清哪些迁移在生产跑过；核心表 11-22 还被重建过。

## 先说清楚：生产怎么到达、这个 PR 改变了什么

- **生产的只读查询与迁移只走业主的受保护生产迁移工具。** 该工具原样打包 `ci/run_migration.py` 与
  `ci/sql_splitter.py`，在服务器上于内存中加载（Python 3.6，无 PyMySQL，无 git 检出），通过它自己的 MySQL 客户端连接调用
  `run_connected(args, statements, splitter_src, conn, db)`。**没有人用 `python3 ci/run_migration.py --config …` 直连生产库。**
  本文中所有生产步骤都写成「把这份 SQL / 这几条只读语句交给受保护工具：先只读预检，再由业主确认」。
- 本 PR 给 `ci/run_migration.py` 加的台账记录，只在调用方**传入** `history=` 参数时生效：
  - 直接运行 `python3 ci/run_migration.py --config … --sql chengyinhub-admin/sql/migration_*.sql`（**仅限开发、测试、CI 库**）时，
    `main()` 会在本地算出身份并传入，执行前写 `APPLYING`，成功 `APPLIED`，失败 `UNKNOWN`；
    已记录、状态未知或 checksum 漂移的迁移在执行任何语句前被拒绝；台账表不存在时醒目警告「本次不会被记录」并照旧执行。
  - **只合并本 PR，生产执行仍然不会被记录。** 受保护工具调用 `run_connected` 时没有传 `history=`（新参数默认 `None`，调用形状不变、
    行为与以前一样），而且它的远程连接不支持台账函数用到的带参游标调用。

### NEEDS OWNER：要让生产执行开始记录，受保护工具（业主维护）需要改三处

1. **在本地算身份**：对要执行的那份迁移文件调用 `history_identity(sql_path)`（在有 git 检出的机器上调用，它要读 git 的 HEAD、
   确认文件已提交且未改动、算 SHA-256），得到 `{"migrationId", "path", "checksum", "targetCommit"}`；随 SQL 一起带到服务器。
   非托管文件返回 `None`，照旧不记录。
2. **传入**：服务器端调用改成 `run_connected(args, statements, splitter_src, conn, db, history=<上一步的 dict>)`。
3. **游标能力**：`conn.cursor()` 返回的对象要支持
   - `execute(sql, params)`：`params` 为元组，按 `%s` 占位安全绑定（台账写入用的是带参语句，不是拼接字符串）；
   - `fetchone()`：返回元组或 `None`；
   - `rowcount`：最近一条语句影响的行数（`APPLYING→APPLIED` 要求恰好 1 行）；
   - 表不存在时抛出的异常 `args[0]` 为 MySQL 错误码 `1146`（runner 据此判断「无台账表」）。
   事务模式下还要支持 `conn.autocommit(True/False)`（runner 已有的事务路径本来就用到）。

在这三处改完之前，下面第 3–6 步建立的台账只能代表「截至基线那一刻」的状态；之后的生产迁移需要业主在每次执行后
手工补一行（第 7 步给出语句），否则台账会再次落后。

## 步骤（全部由业主经受保护工具执行）

1. **先备份**（[D6](D6-backup-restore.md) 第 1 节），保存回执。
2. 只读确认台账表是否存在——交给受保护工具只读执行：
   ```sql
   SELECT COUNT(*) FROM information_schema.tables
   WHERE table_schema = DATABASE() AND table_name = 'cy_migration_history';
   ```
   结果 `0` → 第 3 步；`1` → 跳到第 4 步。
3. 建台账表：把 `chengyinhub-admin/sql/migration_schema_history_20260724.sql` 交给受保护工具，**先只读预检，再由业主确认执行**。
   工具不传 `history=` 时不会自动补记这一行；执行后再交给工具执行（同样先预检、再确认）：
   ```sql
   INSERT INTO cy_migration_history (migration_id, migration_path, checksum_sha256, target_commit, applied_at, status)
   SELECT 'schema_history_20260724', 'chengyinhub-admin/sql/migration_schema_history_20260724.sql',
          '<该文件的 SHA-256>', '<当前 master 的 40 位 commit>', UTC_TIMESTAMP(6), 'RECONCILED'
   FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM cy_migration_history WHERE migration_id = 'schema_history_20260724');
   ```
   SHA-256 用本地 `shasum -a 256 chengyinhub-admin/sql/migration_schema_history_20260724.sql` 计算，commit 用 `git rev-parse HEAD`。
4. 列出生产上**确实已经生效**的迁移（只读）。判据是每份迁移自带的 `-- runner: assert=scalar-true` 断言：
   - **生产**：对每份 `chengyinhub-admin/sql/migration_*.sql`，用受保护工具的**只读预检**重放该文件里的 `SET @… := (SELECT …)`
     与 `-- runner: assert=scalar-true` 的 SELECT（同一连接、按文件顺序，不执行任何写语句），断言全部为真的记为已生效。
     没写 scalar 断言的文件判不了，**不要放进基线**，以后执行时逐个只读核对再决定。
   - `ops/runbook-1122/d1_list_landed.py` 是**开发/测试库辅助脚本**：它用 `ci/run_migration.py` 的直连方式
     （`--config` 指向的开发或测试库）批量做同样的判定。**不要对生产使用**；可以先在一份由生产备份恢复出来的测试库上跑它，
     得到候选清单，再用上一条的生产只读预检逐条复核。
   人工复核清单（尤其是 11-22 重建过的核心表涉及的迁移），存成仓库外的 `landed.txt`，一行一个文件名。
5. 生成基线 SQL（本地运行，不连任何数据库）并复核：
   ```sh
   python3 ops/runbook-1122/d1_baseline_sql.py --verified-list <仓库外>/landed.txt --output <仓库外>/d1-baseline.sql
   ```
   每行是幂等的 `INSERT … WHERE NOT EXISTS`，状态 `RECONCILED`，带文件 SHA-256 和当前 commit。
6. 执行基线：把 `<仓库外>/d1-baseline.sql` 交给受保护工具，**先只读预检，再由业主确认执行**。
7. 回读（只读，经受保护工具）：`SELECT status, COUNT(*) FROM cy_migration_history GROUP BY status;`
   `RECONCILED` 行数应等于 `landed.txt` 行数加 1（台账表自身）。

## 以后每次生产迁移（受保护工具改造完成前）

经受保护工具执行迁移成功并读回后，再经工具执行一行（先预检、再确认）：
```sql
INSERT INTO cy_migration_history (migration_id, migration_path, checksum_sha256, target_commit, applied_at, status)
SELECT '<migration_ 之后、.sql 之前的部分>', 'chengyinhub-admin/sql/<文件名>', '<文件 SHA-256>', '<执行时的 commit>',
       UTC_TIMESTAMP(6), 'RECONCILED'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM cy_migration_history WHERE migration_id = '<同上>');
```
受保护工具按上面三处改造完成后，这一步由 runner 自动完成，不再手写。

## 开发、测试、CI 库

这些库可以直接用 runner（**不是生产**）：
```sh
python3 ci/run_migration.py --config <开发或测试库的配置> --sql chengyinhub-admin/sql/migration_xxx.sql
```
文件须已提交且与 HEAD 一致，否则连库前就拒绝。台账有 `UNKNOWN`/`APPLYING` 时会拒绝重跑：先读回实际结构/数据，
确认已生效就改 `RECONCILED`，确认未生效就删掉该行，不要重跑碰运气。`--exec` 单条语句不写台账。

## 回滚

基线只是台账元数据：经受保护工具执行
`DELETE FROM cy_migration_history WHERE status='RECONCILED' AND target_commit='<第 5 步 commit>';`
