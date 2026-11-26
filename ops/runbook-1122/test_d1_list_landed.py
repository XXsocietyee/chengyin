import importlib.util
import pathlib
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location("d1_list_landed", pathlib.Path(__file__).with_name("d1_list_landed.py"))
MOD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MOD)


class Cursor:
    def __init__(self, answers):
        self.answers, self.description, self.last = answers, None, None
        self.writes = []

    def execute(self, sql):
        self.last = sql
        if sql.startswith("BOOM"):
            raise RuntimeError("x")

    def fetchone(self):
        return (self.answers.get(self.last, 0),)

    def fetchall(self):
        return []

    def close(self):
        pass


class Conn:
    def __init__(self, answers):
        self.answers = answers

    def cursor(self):
        return Cursor(self.answers)


class ListLandedTest(unittest.TestCase):
    def test_only_true_scalar_assertions_are_candidates(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        root = pathlib.Path(tmp.name)
        texts = {"migration_a.sql": "A", "migration_b.sql": "B", "migration_c.sql": "C", "migration_d.sql": "D"}
        for name, text in texts.items():
            (root / name).write_text(text, encoding="utf-8")
        replays = {
            "A": ([("setup", "SET @x := 1"), ("assert", "SELECT ok_a")], True, False),
            "B": ([("assert", "SELECT ok_b")], True, False),
            "C": ([], False, True),
            "D": ([("assert", "BOOM")], True, False),
        }
        landed, not_landed, unjudgeable = MOD.judge(
            Conn({"SELECT ok_a": 1, "SELECT ok_b": 0}),
            sorted(str(p) for p in root.iterdir()), None, lambda text, split: replays[text])
        self.assertEqual(["migration_a.sql"], landed)
        self.assertEqual(["migration_b.sql", "migration_d.sql"], not_landed)
        self.assertEqual(["migration_c.sql"], unjudgeable)
        rendered = MOD.render(landed, not_landed, unjudgeable)
        self.assertEqual(["migration_a.sql"],
                         [l for l in rendered.splitlines() if l and not l.startswith("#")])


if __name__ == "__main__":
    unittest.main()
