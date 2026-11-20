"""plan-review.py's review mode (S156 AC 2): a grader is not reviewer machinery, so a pull request whose
only machinery is its grader gets an `unchanged` review after a merge from stage, while one that also
changes scripts/lib/checks.sh still re-reviews that file. Pure: `decide_mode` takes the record, the pull
request's files and the rule files, and nothing here runs git or reaches the network.

Run from the repository root or from scripts/claude-review/, with PYTHONDONTWRITEBYTECODE=1 (the
tracked __pycache__ there must not change):
    python3 -m unittest scripts/claude-review/test_plan_review.py
"""

import importlib.util
import os
import unittest

_SPEC = importlib.util.spec_from_file_location("plan_review", os.path.join(os.path.dirname(os.path.abspath(__file__)), "plan-review.py"))
plan_review = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(plan_review)

RULES = {p: f"rule-blob-{i}" for i, p in enumerate(plan_review.RULE_FILES)}
GRADER = "scripts/verify-S9001.sh"
NOTE = "docs/v3/backlog/stories/doing/S9001.md"
CHECKS = "scripts/lib/checks.sh"


def record_of(files: dict[str, str], rules: dict[str, str] = RULES) -> dict:
    """A record as a previous review would have left it, covering exactly these blobs."""
    return {"version": plan_review.RECORD_VERSION, "head": "a" * 40, "rules": rules, "files": dict(files), "findings": []}


class IsReviewerPath(unittest.TestCase):
    def test_graders_are_not_reviewer_paths(self):
        for path in ["scripts/verify-S156.sh", "scripts/verify-B87.sh", "scripts/verify-V3.sh", "scripts/verify-S1.sh"]:
            self.assertFalse(plan_review.is_reviewer_path(path), path)

    def test_what_it_covered_before_still_counts(self):
        for path in [CHECKS, "scripts/audit.sh", ".github/workflows/ci.yml", "package.json", "web/package.json",
                     "scripts/verify-all.sh", "scripts/lib/verify-S1.sh", "scripts/verify-S1.sh.orig", "scripts/claude-review/plan-review.py"]:
            self.assertTrue(plan_review.is_reviewer_path(path), path)


class DecideMode(unittest.TestCase):
    def test_grader_only_pull_request_with_matching_record_is_unchanged(self):
        files = {GRADER: "g1", NOTE: "n1"}
        mode, why, reviewed = plan_review.decide_mode(record_of(files), files, RULES, True)
        self.assertEqual(mode, "unchanged", why)
        self.assertEqual(reviewed, [])

    def test_checks_sh_is_reviewed_again_even_when_unchanged(self):
        files = {GRADER: "g1", NOTE: "n1", CHECKS: "c1"}
        mode, why, reviewed = plan_review.decide_mode(record_of(files), files, RULES, True)
        self.assertEqual(mode, "incremental", why)
        self.assertEqual(reviewed, [CHECKS])

    def test_a_changed_file_is_reviewed(self):
        files = {GRADER: "g2", NOTE: "n1"}
        mode, _, reviewed = plan_review.decide_mode(record_of({GRADER: "g1", NOTE: "n1"}), files, RULES, True)
        self.assertEqual(mode, "incremental")
        self.assertEqual(reviewed, [GRADER])

    def test_no_record_is_full(self):
        files = {GRADER: "g1", NOTE: "n1"}
        self.assertEqual(plan_review.decide_mode(None, files, RULES, False), ("full", "first review", [GRADER, NOTE]))

    def test_changed_rules_are_full(self):
        files = {GRADER: "g1"}
        older = dict(RULES, **{"CLAUDE.md": "older"})
        mode, _, reviewed = plan_review.decide_mode(record_of(files, older), files, RULES, True)
        self.assertEqual((mode, reviewed), ("full", [GRADER]))

    def test_a_record_out_of_history_is_full(self):
        files = {GRADER: "g1"}
        mode, _, _ = plan_review.decide_mode(record_of(files), files, RULES, False)
        self.assertEqual(mode, "full")


if __name__ == "__main__":
    unittest.main()
