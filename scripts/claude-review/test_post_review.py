"""post-review.py's `in_body` output, which the workflow's required `claude-review/posted` status reads, and
its fallback when GitHub refuses the inline review (HTTP 422): each finding on a file in the pull
request's diff becomes its own file-level thread, and only one on a file outside the diff goes in the
body and is counted, so the status fails instead of passing a finding no thread holds. Nothing here
reaches the network: `post` is replaced.

Run with PYTHONDONTWRITEBYTECODE=1 (the tracked __pycache__ there must not change):
    python3 -m unittest scripts/claude-review/test_post_review.py
"""

import importlib.util
import json
import os
import tempfile
import unittest

_SPEC = importlib.util.spec_from_file_location("post_review", os.path.join(os.path.dirname(os.path.abspath(__file__)), "post-review.py"))
post_review = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(post_review)

FINDING = {"path": "a.ts", "line": 3, "body": "wrong"}


class InBody(unittest.TestCase):
    def run_main(self, findings: list, answers: list[str], changed: str = "M\ta.ts\n") -> tuple[int, str, list[tuple[str, dict]]]:
        """main() with the reviewer's output, the diff's changed.txt and each post's answer scripted;
        returns its exit code, what it wrote to GITHUB_OUTPUT and every (endpoint, payload) it tried
        to post."""
        with tempfile.TemporaryDirectory() as tmp:
            execution = os.path.join(tmp, "execution.json")
            with open(execution, "w", encoding="utf-8") as f:
                json.dump([{"type": "result", "result": json.dumps({"summary": "s", "findings": findings})}], f)
            with open(os.path.join(tmp, "changed.txt"), "w", encoding="utf-8") as f:
                f.write(changed)
            output = os.path.join(tmp, "output")
            open(output, "w").close()
            posted: list[tuple[str, dict]] = []
            scripted = list(answers)

            def fake_post(data: dict, endpoint: str = "reviews") -> str:
                posted.append((endpoint, data))
                return scripted.pop(0)

            env = {"HEAD_SHA": "b" * 40, "EXECUTION_FILE": execution, "GITHUB_OUTPUT": output, "MODE": "full", "REVIEW_DIR": tmp}
            saved_env = {k: os.environ.get(k) for k in env}
            saved_post = post_review.post
            os.environ.update(env)
            post_review.post = fake_post
            try:
                code = post_review.main()
            finally:
                post_review.post = saved_post
                for k, v in saved_env.items():
                    if v is None:
                        os.environ.pop(k, None)
                    else:
                        os.environ[k] = v
            with open(output, encoding="utf-8") as f:
                return code, f.read(), posted

    def test_anchored_findings_report_zero(self):
        code, out, posted = self.run_main([FINDING], ["ok"])
        self.assertEqual((code, out), (0, "in_body=0\n"))
        self.assertEqual(posted[0][0], "reviews")
        self.assertEqual(len(posted[0][1]["comments"]), 1)

    def test_refused_inline_posts_in_diff_findings_as_file_threads(self):
        code, out, posted = self.run_main([FINDING, dict(FINDING, line=9)], ["unprocessable", "ok", "ok", "ok"])
        self.assertEqual((code, out), (0, "in_body=0\n"))
        # The summary, which carries the record, posts last.
        self.assertEqual([endpoint for endpoint, _ in posted], ["reviews", "comments", "comments", "reviews"])
        retry = posted[-1][1]
        self.assertNotIn("comments", retry)
        self.assertNotIn("wrong", retry["body"].split("claude-review-record")[0])
        for (_, comment), line in zip(posted[1:3], (3, 9)):
            self.assertEqual(comment["subject_type"], "file")
            self.assertEqual((comment["path"], comment["commit_id"]), ("a.ts", "b" * 40))
            self.assertNotIn("line", comment)
            self.assertIn(f"Line {line}", comment["body"])

    def test_renamed_file_counts_by_its_new_path(self):
        code, out, posted = self.run_main([FINDING], ["unprocessable", "ok", "ok"], changed="R090\told.ts\ta.ts\n")
        self.assertEqual((code, out), (0, "in_body=0\n"))
        self.assertEqual(posted[1][0], "comments")

    def test_out_of_diff_finding_goes_in_the_body(self):
        code, out, posted = self.run_main([FINDING, dict(FINDING, path="elsewhere.ts")], ["unprocessable", "ok", "ok"])
        self.assertEqual((code, out), (0, "in_body=1\n"))
        self.assertEqual([endpoint for endpoint, _ in posted], ["reviews", "comments", "reviews"])
        self.assertIn("**elsewhere.ts:3**", posted[-1][1]["body"])
        self.assertNotIn("**a.ts:3**", posted[-1][1]["body"])

    def test_failed_file_comment_fails_before_the_summary_posts(self):
        # No summary means no record, so a re-run is never `unchanged`: it reviews again, fully or
        # incrementally.
        code, out, posted = self.run_main([FINDING, dict(FINDING, line=9)], ["unprocessable", "failed"])
        self.assertEqual((code, out), (1, ""))
        self.assertEqual([endpoint for endpoint, _ in posted], ["reviews", "comments"])

    def test_file_comment_refused_with_422_goes_in_the_body(self):
        # A 422 on the file too would only repeat on a re-run, so the finding goes in the body, counted,
        # and the status fails on it.
        code, out, posted = self.run_main([FINDING, dict(FINDING, line=9)], ["unprocessable", "unprocessable", "ok", "ok"])
        self.assertEqual((code, out), (0, "in_body=1\n"))
        self.assertEqual([endpoint for endpoint, _ in posted], ["reviews", "comments", "comments", "reviews"])
        self.assertIn("**a.ts:3**", posted[-1][1]["body"])
        self.assertNotIn("**a.ts:9**", posted[-1][1]["body"])

    def test_non_ascii_path_matches_its_finding(self):
        # The workflow writes changed.txt with core.quotePath=false; a C-quoted line (git's default)
        # still matches once unquoted.
        name = "docs/v3/backlog/frame/00 Baseball Theater v3 \u2014 Checkable backlog.md"
        quoted = '"docs/v3/backlog/frame/00 Baseball Theater v3 \\342\\200\\224 Checkable backlog.md"'
        for changed in (f"M\t{name}\n", f"M\t{quoted}\n"):
            code, out, posted = self.run_main([dict(FINDING, path=name)], ["unprocessable", "ok", "ok"], changed=changed)
            self.assertEqual((code, out), (0, "in_body=0\n"))
            self.assertEqual((posted[1][0], posted[1][1]["path"]), ("comments", name))

    def test_refused_summary_after_the_threads_fails_the_step(self):
        code, out, posted = self.run_main([FINDING], ["unprocessable", "ok", "failed"])
        self.assertEqual((code, out), (1, ""))
        self.assertEqual([endpoint for endpoint, _ in posted], ["reviews", "comments", "reviews"])

    def test_no_findings_report_zero(self):
        code, out, _ = self.run_main([], ["ok"])
        self.assertEqual((code, out), (0, "in_body=0\n"))

    def test_failed_post_reports_nothing(self):
        code, out, _ = self.run_main([FINDING], ["failed"])
        self.assertEqual((code, out), (1, ""))


if __name__ == "__main__":
    unittest.main()
