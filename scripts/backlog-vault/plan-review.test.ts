/**
 * scripts/claude-review/test_plan_review.py (S156 AC 2: plan-review.py's review mode and its grader
 * carve-out), run in `pnpm test:backlog` so CI runs it too. The environment is built from scratch
 * with PYTHONDONTWRITEBYTECODE=1: importing plan-review.py must not rewrite its tracked __pycache__
 * or add an untracked one.
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	describe, expect, it,
} from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

describe("plan-review.py's own tests (test_plan_review.py)", () =>
{
	it("pass, and leave scripts/claude-review/ as git has it", () =>
	{
		const before = spawnSync("git", ["status", "--porcelain", "--", "scripts/claude-review/"], {
			cwd: ROOT,
			encoding: "utf8",
		}).stdout;
		const run = spawnSync("python3", ["-m", "unittest", "scripts/claude-review/test_plan_review.py"], {
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
