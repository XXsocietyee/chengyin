import importlib.util
import os
import pathlib
import subprocess
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location("d1_baseline", pathlib.Path(__file__).with_name("d1_baseline_sql.py"))
MOD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MOD)


class BaselineSqlTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.repo = pathlib.Path(self.tmp.name) / "repo"
        (self.repo / MOD.SQL_DIR).mkdir(parents=True)
        (self.repo / MOD.SQL_DIR / "migration_a_20260101.sql").write_text("SELECT 1;\n", encoding="utf-8")
        env = {**os.environ, "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@example.invalid",
               "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@example.invalid"}
        for args in (["init", "-q"], ["add", "-A"], ["commit", "-q", "-m", "x"]):
            subprocess.run(["git", "-C", str(self.repo), *args], check=True, env=env, capture_output=True)
        self.out = pathlib.Path(self.tmp.name) / "out.sql"
        self.listing = pathlib.Path(self.tmp.name) / "landed.txt"

    def run_main(self, listing):
        self.listing.write_text(listing, encoding="utf-8")
        return MOD.main(["--verified-list", str(self.listing), "--output", str(self.out), "--repo", str(self.repo)])

    def test_generates_idempotent_reconciled_rows_with_checksum(self):
        self.run_main("# verified\nmigration_a_20260101.sql\n")
        sql = self.out.read_text(encoding="utf-8")
        import hashlib
        self.assertIn(hashlib.sha256(b"SELECT 1;\n").hexdigest(), sql)
        self.assertIn("'RECONCILED'", sql)
        self.assertIn("WHERE NOT EXISTS", sql)
        self.assertEqual(1, sql.count("INSERT INTO cy_migration_history"))

    def test_refuses_empty_unknown_or_unmanaged_lists(self):
        for listing in ("# nothing\n", "migration_missing_20260101.sql\n", "seed_demo.sql\n",
                        "migration_a_20260101.sql\nmigration_a_20260101.sql\n"):
            with self.assertRaises(SystemExit, msg=listing):
                self.run_main(listing)

    def test_refuses_output_inside_repo_and_dirty_sql_dir(self):
        self.listing.write_text("migration_a_20260101.sql\n", encoding="utf-8")
        with self.assertRaises(SystemExit):
            MOD.main(["--verified-list", str(self.listing), "--output", str(self.repo / "x.sql"),
                      "--repo", str(self.repo)])
        (self.repo / MOD.SQL_DIR / "migration_a_20260101.sql").write_text("SELECT 2;\n", encoding="utf-8")
        with self.assertRaises(SystemExit):
            self.run_main("migration_a_20260101.sql\n")


if __name__ == "__main__":
    unittest.main()
