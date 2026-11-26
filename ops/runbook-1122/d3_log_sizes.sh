#!/usr/bin/env bash
# 审计 D3：只读列出日志目录里最大的文件与最早修改时间。不删除、不改动任何文件。
# 用法：bash ops/runbook-1122/d3_log_sizes.sh <目录> [<目录> ...]
set -euo pipefail
[ "$#" -ge 1 ] || { echo "用法: $0 <日志目录> [...]" >&2; exit 2; }
for dir in "$@"; do
  [ -d "$dir" ] || { echo "跳过（不存在）: $dir"; continue; }
  echo "== $dir  合计 $(du -sh "$dir" 2>/dev/null | cut -f1)"
  find "$dir" -maxdepth 2 -type f -printf '%s\t%TY-%Tm-%Td\t%p\n' 2>/dev/null \
    | sort -rn | head -15 \
    | awk -F'\t' '{ printf "%10.1f MB  %s  %s\n", $1/1048576, $2, $3 }'
done
