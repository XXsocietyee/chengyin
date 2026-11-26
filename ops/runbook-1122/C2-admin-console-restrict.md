# C2 后台只允许指定地址访问

**问题**：后台登录页对公网开放；2026-08-27 一个地址 419 次失败登录、试了 74 个用户名。业主已决定按地址或 VPN 限制。

## 需要业主先给的

- 允许访问后台的地址：`<ALLOWED_CIDR_1>`、`<ALLOWED_CIDR_2>`…（办公网出口、家里、VPN 出口），或选定的 VPN 方案。
- 后台域名 `<ADMIN_DOMAIN>`，以及它在 nginx 里对应的 `server` 块文件 `<NGINX_SITE_CONF>`。

## 限制范围（不能多也不能少）

- **要挡**：后台页面（`<ADMIN_DOMAIN>` 整站）和后台接口：`/login`、`/captchaImage`、`/getInfo`、`/getRouters`、
  `/logout`、`/system/`、`/monitor/`、`/tool/`、`/business/` 等管理端前缀。
- **不能挡**：小程序和 App 用的 `/api/`、微信支付/退款回调、上传文件读取路径。它们通常和后台共用同一个 jar；
  如果后台与 `/api/` 在同一个域名下，只能按路径挡，不能整站挡。部署前用 `nginx -T | grep -n "location"` 核对。

## 步骤（应用机 `<APP_HOST>`）

1. 备份：`cp <NGINX_SITE_CONF> <NGINX_SITE_CONF>.bak-$(date +%Y%m%d%H%M)`
2. 用 `ops/runbook-1122/c2_nginx_allowlist.conf.template` 生成片段（把占位符换成真实地址，**真实值不要提交到仓库**），
   放到 `/etc/nginx/snippets/admin-allowlist.conf`（宝塔环境放在站点配置可 include 的目录）。
3. 后台独立域名：在 `<ADMIN_DOMAIN>` 的 `server {}` 第一行 `include snippets/admin-allowlist.conf;`
   与 `/api/` 共用域名：只在管理端 `location` 块里 include。
4. `nginx -t && nginx -s reload`
5. 验收：
   - 在允许地址：后台可登录。
   - 在手机 4G（不在名单）：后台页面与 `/login` 返回 403；小程序首页、下单、支付回调正常
     （`curl -s -o /dev/null -w '%{http_code}' https://<API_DOMAIN>/api/<一个公开 GET 接口>` 为 200）。
6. 之后一周经受保护工具只读查询 `sys_logininfor`，看失败登录是否归零：
   `SELECT DATE(login_time), COUNT(*) FROM sys_logininfor WHERE status='1' GROUP BY 1 ORDER BY 1 DESC LIMIT 7;`

## 回滚

`cp <NGINX_SITE_CONF>.bak-<时间> <NGINX_SITE_CONF> && nginx -t && nginx -s reload`

## 补充

- 云厂商安全组同样可以只对白名单开放后台端口（若后台单独端口）；两层都做更稳。
- 地址会变的（家庭宽带）优先用 VPN；名单变更同样走本流程并留回执。
