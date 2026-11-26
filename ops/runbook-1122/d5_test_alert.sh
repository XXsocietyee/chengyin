#!/usr/bin/env bash
# 审计 D5：向告警机器人发一条测试消息，确认通道可达。只发这一条，不改任何配置。
# 地址只从环境变量 ALARM_WEBHOOK 读取（不要放在命令行参数里，会进 shell 历史和进程列表）。
# 输出不打印地址；只打印 OK / REJECTED / HTTP 码。
set -euo pipefail
: "${ALARM_WEBHOOK:?先 read -rs ALARM_WEBHOOK && export ALARM_WEBHOOK}"
case "$ALARM_WEBHOOK" in https://*) ;; *) echo "地址必须是 https://" >&2; exit 2 ;; esac
host=$(printf '%s' "$ALARM_WEBHOOK" | sed -E 's#^https://([^/]+).*#\1#')
now=$(date '+%Y-%m-%d %H:%M:%S %z')
body=$(printf '{"msgtype":"text","text":{"content":"[城瘾告警] 通道测试\\n%s 由 runbook D5 发送，收到即通道正常"}}' "$now")
resp=$(mktemp); trap 'rm -f "$resp"' EXIT
code=$(curl -sS -m 10 -o "$resp" -w '%{http_code}' -H 'Content-Type: application/json' --data "$body" "$ALARM_WEBHOOK") || {
  echo "FAILED host=$host（网络不通或超时）"; exit 1; }
errcode=$(grep -o '"errcode":[ ]*-\?[0-9]*' "$resp" | head -1 | grep -o -- '-\?[0-9]*$' || true)
if [ "${code:0:1}" = "2" ] && { [ -z "$errcode" ] || [ "$errcode" = "0" ]; }; then
  echo "OK host=$host http=$code"
else
  echo "REJECTED host=$host http=$code errcode=${errcode:-none}"; exit 1
fi
