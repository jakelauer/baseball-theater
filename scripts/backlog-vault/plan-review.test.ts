/**
 * scripts/claude-review/test_plan_review.py (S156 AC 2: plan-review.py's review mode and its grader
 * carve-out) and test_post_review.py (post-review.py's `in_body` count, which the required
 * `claude-review/posted` status reads), run in the law-test unit's `test` task (`@bt/scripts#test`) so `pnpm verify` and CI run them too. The
 * environment is built from scratch with PYTHONDONTWRITEBYTECODE=1: importing plan-review.py must not rewrite its tracked __pycache__
 * or add an untracked one.
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	describe, expect, it,
} from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

describe("the review scripts' own tests (test_plan_review.py, test_post_review.py)", () =>
{
	it("pass, and leave scripts/claude-review/ as git has it", () =>
	{
		const before = spawnSync("git", ["status", "--porcelain", "--", "scripts/claude-review/"], {
			cwd: ROOT,
			encoding: "utf8",
		}).stdout;
		const run = spawnSync("python3", ["-m", "unittest", "scripts/claude-review/test_plan_review.py", "scripts/claude-review/test_post_review.py"], {
			cwd: ROOT,
			encoding: "utf8",
			env: {
				PATH: process.env["PATH"] ?? "/usr/bin:/bin",
				PYTHONDONTWRITEBYTECODE: "1",
			},
		});
		expect(run.status, `${run.stdout}${run.stderr}`).toBe(0);
		expect(run.stderr).toMatch(/^OK$/m);
		const after = spawnSync("git", ["status", "--porcelain", "--", "scripts/claude-review/"], {
			cwd: ROOT,
			encoding: "utf8",
		}).stdout;
		expect(after).toBe(before);
	});
});
