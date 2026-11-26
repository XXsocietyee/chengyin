# 本轮发布：先迁移、后上 jar；提现申请默认关闭

## 1. 两份迁移必须在需要它们的 jar 之前跑

| 迁移 | 来源 | 内容 | 状态 |
|---|---|---|---|
| `chengyinhub-admin/sql/migration_20261122_route_visitor_refund_owner_index.sql` | #914 已合并 | 只加索引 `refund_application(owner_type, owner_id, reviewed_at)`，不改数据 | 可执行 |
| `chengyinhub-admin/sql/migration_20261122_platform_code_grant.sql` | PR #911 **未合并** | 见该 PR | **等 #911 合并后**再执行；未合并前不要从 PR 分支拿文件跑 |

顺序：
1. 备份（[D6](D6-backup-restore.md) 第 1 节）。
2. 取包含该迁移的 master 版本的文件（本地 `git pull` 后的 `chengyinhub-admin/sql/…`）。
   可在本地先做不连库的 dry-run 看分句：`python3 ci/run_migration.py --sql <文件> --dry-run`（不连接任何数据库）。
3. **生产执行只经业主的受保护生产迁移工具**：把该文件交给工具，**先只读预检，再由业主确认执行**，一次一份。
   `migration_20261122_platform_code_grant.sql` 同法，#911 合并后执行。
4. 回读（只读，经受保护工具）：`SHOW INDEX FROM refund_application WHERE Key_name='idx_refund_owner_reviewed';`
5. 记台账：受保护工具目前不传台账参数，生产执行**不会自动记录**（见 [D1](D1-migration-baseline.md)「NEEDS OWNER」）；
   在工具改造完成前，按 D1「以后每次生产迁移」经工具补一行 `RECONCILED`。
6. 之后才部署需要它们的 jar。若迁移失败或结果不确定，**不要上 jar**，先从数据库读回实际结构再处置。

开发、测试库上可以直接用 `python3 ci/run_migration.py --config <开发或测试库的配置> --sql <文件>`，那里会自动记台账；
**生产不用这条命令。**

## 2. 同批其它 1122 迁移

`git ls-tree --name-only origin/master chengyinhub-admin/sql/ | grep 20261122` 列出全部；每一份同样「先迁移、后 jar」，
各自头注释写明影响与回滚。

## 3. 部署 BE1（#934）的 jar 之后：新提现申请默认被拒绝

BE1 加了开关 `withdrawal.request.enabled`，**默认 false**。新 jar 上线后，`/api/withdrawal/create` 对所有新的提现申请
返回明确的「暂不可提现」提示，不进入任何资金服务；已存在的提现单照常由任务 116/117 跟踪。

- 维持关闭：什么都不用做（这是预期状态，直到收款/出款通道获批）。
- 开启（业主决定后）：在 systemd drop-in 的环境变量里加 `WITHDRAWAL_REQUEST_ENABLED=true`
  （Spring 宽松绑定等价于 `withdrawal.request.enabled=true`），`systemctl daemon-reload && systemctl restart <服务名>`，
  用测试账号发起一笔最小额提现申请回读。
- 发布说明里写明这一点，避免把「提现被拒」当成故障。
