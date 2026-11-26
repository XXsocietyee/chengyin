#!/usr/bin/env python3
"""审计 D1：为 cy_migration_history 生成「基线」SQL（只生成文件，不连接任何数据库）。

用法（在仓库根目录、已 checkout 要登记的那个 commit）：

  python3 ops/runbook-1122/d1_baseline_sql.py --verified-list landed.txt --output /private/path/d1-baseline.sql

--verified-list：业主核对过「生产上确实已生效」的迁移文件名，一行一个
                 （例如 migration_20261013_xxx.sql；# 开头为注释）。来源应是
                 D1 runbook 第 4 步的只读判定（生产经受保护工具）+ 人工复核，
                 不能是「仓库里有这个文件」。
输出的每一行都是幂等 INSERT … WHERE NOT EXISTS，状态 RECONCILED（台账合同：
只有依据数据库实际结构/数据核验过的才可标 RECONCILED）。输出文件放仓库外，
复核后交给业主的受保护生产迁移工具：先只读预检，再由业主确认执行。
开发/测试库可直接 `ci/run_migration.py --config <开发或测试库配置> --sql <输出文件>`。
"""
import argparse
import hashlib
import os
import re
import subprocess
import sys

REPO = os.path.realpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
SQL_DIR = "chengyinhub-admin/sql"
NAME = re.compile(r"^migration_([a-z0-9][a-z0-9_]*)\.sql$")
FULL_SHA = re.compile(r"^[0-9a-f]{40}$")


def read_list(path):
    names = []
    for raw in open(path, encoding="utf-8"):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        name = os.path.basename(line)
        if not NAME.fullmatch(name):
            raise SystemExit(f"不是托管迁移文件名：{line}")
        if name in names:
            raise SystemExit(f"清单重复：{name}")
        names.append(name)
    if not names:
        raise SystemExit("清单为空：拒绝生成空基线")
    return names


def head_commit(repo):
    out = subprocess.run(["git", "-C", repo, "rev-parse", "HEAD"], capture_output=True, text=True)
    commit = out.stdout.strip()
    if out.returncode != 0 or not FULL_SHA.fullmatch(commit):
        raise SystemExit("取不到 40 位 HEAD commit")
    dirty = subprocess.run(["git", "-C", repo, "status", "--porcelain", "--", SQL_DIR],
                           capture_output=True, text=True).stdout.strip()
    if dirty:
        raise SystemExit(f"{SQL_DIR} 有未提交改动：基线 checksum 必须对应 commit")
    return commit


def build(repo, names, commit):
    lines = [
        "-- 审计 D1 基线：cy_migration_history 补登记（RECONCILED）。",
        f"-- target_commit={commit}；共 {len(names)} 条；每条幂等，可重复执行。",
        "-- 只写台账元数据，不含 SQL 正文与凭据；执行前请逐条核对清单来源。",
    ]
    for name in names:
        path = os.path.join(repo, SQL_DIR, name)
        if not os.path.isfile(path):
            raise SystemExit(f"仓库里没有 {SQL_DIR}/{name}")
        with open(path, "rb") as stream:
            checksum = hashlib.sha256(stream.read()).hexdigest()
        migration_id = NAME.fullmatch(name).group(1)
        rel = f"{SQL_DIR}/{name}"
        lines.append(
            "INSERT INTO cy_migration_history "
            "(migration_id, migration_path, checksum_sha256, target_commit, applied_at, status) "
            f"SELECT '{migration_id}', '{rel}', '{checksum}', '{commit}', UTC_TIMESTAMP(6), 'RECONCILED' "
            "FROM DUAL WHERE NOT EXISTS "
            f"(SELECT 1 FROM cy_migration_history WHERE migration_id = '{migration_id}');")
    return "\n".join(lines) + "\n"


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--verified-list", required=True)
    ap.add_argument("--output", required=True)
    ap.add_argument("--repo", default=REPO)
    args = ap.parse_args(argv)
    if os.path.realpath(args.output).startswith(os.path.realpath(args.repo) + os.sep):
        raise SystemExit("输出文件请放在仓库外（它带生产事实，不进 Git）")
    names = read_list(args.verified_list)
    sql = build(args.repo, names, head_commit(args.repo))
    with open(args.output, "w", encoding="utf-8") as stream:
        stream.write(sql)
    print(f"已生成 {args.output}：{len(names)} 条 RECONCILED 基线；未连接数据库")


if __name__ == "__main__":
    sys.exit(main())
