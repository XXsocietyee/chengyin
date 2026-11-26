#!/usr/bin/env python3
"""审计 D1：只读列出「迁移自带断言为真」的迁移文件名，作为基线候选清单。

★ 开发/测试库辅助脚本，不对生产使用。它经 ci/run_migration.py 的直连方式（--config 指向的库）连接；
  生产库只经业主的受保护生产迁移工具访问。生产上的同等判定：用该工具的只读预检逐份重放迁移里的
  SET @… 与 scalar-true 断言（见 ops/runbook-1122/D1-migration-baseline.md 第 4 步）。
  可以先在由生产备份恢复出来的测试库上跑本脚本得到候选，再在生产逐条复核。

ci/audit_migrations_applied.py 只打印「已落库」的数量，不打印名字；本脚本用它的同一套判据
（同一连接内按文件重放 SET @… 与 `-- runner: assert=scalar-true` 断言，不执行任何写语句）
把名字写到仓库外的文件里，供业主复核后交给 d1_baseline_sql.py。

  python3 ops/runbook-1122/d1_list_landed.py --output <仓库外>/landed-candidates.txt

输出里还有「判不了」的文件（没写断言）——它们不进候选清单，只作注释列出，需人工逐个核对。
"""
import argparse
import glob
import os
import sys

REPO = os.path.realpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
sys.path.insert(0, os.path.join(REPO, "ci"))


def judge(conn, files, split, scalar_assertions_and_setup):
    landed, not_landed, unjudgeable = [], [], []
    for path in files:
        name = os.path.basename(path)
        with open(path, encoding="utf-8") as stream:
            replay, has_scalar, _ = scalar_assertions_and_setup(stream.read(), split)
        if not has_scalar:
            unjudgeable.append(name)
            continue
        cur = conn.cursor()
        ok = True
        try:
            for kind, sql in replay:
                cur.execute(sql)
                if kind == "assert":
                    row = cur.fetchone()
                    if not (row and row[0]):
                        ok = False
                        break
                elif cur.description:
                    cur.fetchall()
        except Exception:  # noqa: BLE001 - 任何异常都不算落库
            ok = False
        finally:
            cur.close()
        (landed if ok else not_landed).append(name)
    return landed, not_landed, unjudgeable


def render(landed, not_landed, unjudgeable):
    lines = ["# d1_list_landed：断言为真的迁移（基线候选；复核后交给 d1_baseline_sql.py）"]
    lines += landed
    lines.append(f"# 断言为假或报错（不进基线）{len(not_landed)} 个：")
    lines += ["#   " + n for n in not_landed]
    lines.append(f"# 判不了（没写 scalar 断言，人工逐个核对后再决定）{len(unjudgeable)} 个：")
    lines += ["#   " + n for n in unjudgeable]
    return "\n".join(lines) + "\n"


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--output", required=True)
    args = ap.parse_args(argv)
    if os.path.realpath(args.output).startswith(REPO + os.sep):
        raise SystemExit("输出文件请放在仓库外（它带生产事实，不进 Git）")
    import audit_migrations_applied as audit
    rm = audit.rm
    split, _ = rm.load_split_statements()
    if split is None:
        raise SystemExit("找不到 ci/sql_splitter.py")
    conn, _db = rm.connect(audit.DEFAULT_CONFIG)
    try:
        files = sorted(glob.glob(os.path.join(audit.SQL_DIR, "migration_*.sql")))
        result = judge(conn, files, split, audit.scalar_assertions_and_setup)
    finally:
        conn.close()
    with open(args.output, "w", encoding="utf-8") as stream:
        stream.write(render(*result))
    print(f"已写 {args.output}：断言为真 {len(result[0])}，为假 {len(result[1])}，判不了 {len(result[2])}；未写库")


if __name__ == "__main__":
    sys.exit(main())
