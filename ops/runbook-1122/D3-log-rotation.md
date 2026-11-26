# D3 日志按天轮转、保留 30 天

**问题**：访问日志自 2026-03-14 起从未轮转（1.45 GB、890 万行）；应用日志 186 MB。

## 涉及的文件

| 日志 | 位置 | 谁在写 | 轮转方式 |
|---|---|---|---|
| nginx 访问/错误日志 | `<NGINX_LOG_DIR>`（宝塔默认 `/www/wwwlogs/`）下的 `*.log` | nginx | logrotate，轮转后让 nginx 重开文件 |
| 应用标准输出 | `/www/wwwlogs/java/springboot/chengyinhub-admin.log`（见 `ci/deploy-restart.sh` 的 `LOG=`） | systemd 重定向，进程一直持有文件 | logrotate `copytruncate` |
| 应用 logback 文件 | `/home/ruoyi/logs/sys-*.log` | logback 自己按天滚动，`maxHistory` 60 天 | 已在轮转，无需处理 |

## 步骤（应用机 `<APP_HOST>`）

1. 先看现状（只读）：`bash ops/runbook-1122/d3_log_sizes.sh <NGINX_LOG_DIR> /www/wwwlogs/java/springboot`
2. 把 `ops/runbook-1122/d3_logrotate.conf.template` 复制为 `/etc/logrotate.d/chengyin`，替换 `<NGINX_LOG_DIR>`、
   `<NGINX_PID_FILE>`（`nginx -V 2>&1 | grep -o 'pid-path=[^ ]*'` 可查）。
3. 试跑不落地：`logrotate -d /etc/logrotate.d/chengyin`（只打印将做什么）。
4. 第一次手动执行：`logrotate -f /etc/logrotate.d/chengyin`。**选在没有部署的时候**：部署验收脚本按字节偏移读应用日志，
   轮转正好发生在部署验收中会读错位置。
5. 验收：次日目录里出现 `*.log-YYYYMMDD.gz`；`nginx` 仍在写新文件（`tail -f` 有新行）；应用日志仍在增长。
6. 历史大文件：第 4 步会把当前 1.45 GB 文件压缩为一个归档；确认不需要后可直接删除该归档。

## 回滚

`rm /etc/logrotate.d/chengyin`；已轮转的归档不影响服务。
