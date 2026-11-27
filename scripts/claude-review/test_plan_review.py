"""plan-review.py's `is_reviewer_path` (S156 AC 2): a grader is not CI or deploy machinery, so it makes no
`/run-backlog` barrier, while everything the list covered before still does. Pure: nothing here runs git or
reaches the network. (Its tests of the retired pull request review's mode went with that review, 2026-11-26.)

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

CHECKS = "scripts/lib/checks.sh"


class IsReviewerPath(unittest.TestCase):
    def test_graders_are_not_reviewer_paths(self):
        for path in ["scripts/verify-S156.sh", "scripts/verify-B87.sh", "scripts/verify-V3.sh", "scripts/verify-S1.sh"]:
            self.assertFalse(plan_review.is_reviewer_path(path), path)

    def test_what_it_covered_before_still_counts(self):
        for path in [CHECKS, "scripts/audit.sh", ".github/workflows/ci.yml", "package.json", "web/package.json",
                     "scripts/verify-all.sh", "scripts/lib/verify-S1.sh", "scripts/verify-S1.sh.orig", "scripts/claude-review/plan-review.py"]:
            self.assertTrue(plan_review.is_reviewer_path(path), path)

    def test_a_grader_name_must_match_whole(self):
        # `re.match` with `$` also matches before a trailing newline, which would carve this path out.
        for path in ["scripts/verify-S1.sh\n", "scripts/verify-B87.sh\n"]:
            self.assertTrue(plan_review.is_reviewer_path(path), repr(path))


if __name__ == "__main__":
    unittest.main()
