/**
 * scripts/lib/checks.sh's own-commit helpers (S156 AC 11): `story_own_diff` and
 * `story_own_changed_files` see only the story's own first-parent commits and, while it is
 * unshipped, its working tree and untracked files, never what a merge from `stage` brought in. With
 * no output option `story_own_diff` prints the patch (as `git diff` does); any option that chooses
 * the output is left to choose it. Runs the real script in a throwaway repository with no ledger,
 * so the story is unshipped.
 */
import { spawnSync } from "node:child_process";
import {
	mkdtempSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	afterAll, beforeAll, describe, expect, it,
} from "vitest";

const CHECKS = join(dirname(fileURLToPath(import.meta.url)), "../lib/checks.sh");

let repo = "";
let base = "";

function git(...args: string[]): string
{
	const run = spawnSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args], {
		cwd: repo,
		encoding: "utf8",
	});
	if (run.status !== 0) throw new Error(`git ${args.join(" ")}: ${run.stderr}`);
	return run.stdout.trim();
}

/** Run a checks.sh helper in the repository and return its output. */
function helper(call: string): string
{
	const run = spawnSync("bash", ["-c", `source "${CHECKS}"; ${call}`], {
		cwd: repo,
		encoding: "utf8",
	});
	if (run.status !== 0) throw new Error(`${call}: ${run.stderr}`);
	return run.stdout;
}

beforeAll(() =>
{
	repo = mkdtempSync(join(tmpdir(), "checks-own-"));
	git("init", "-q", "-b", "stage");
	writeFileSync(join(repo, "c.txt"), "c\n");
	git("add", "-A");
	git("commit", "-q", "-m", "base");
	base = git("rev-parse", "HEAD");
	git("switch", "-q", "-c", "story/S9");
	writeFileSync(join(repo, "a.txt"), "own line one\n");
	git("add", "-A");
	git("commit", "-q", "-m", "S9: a");
	// Another story lands on stage, which the branch merges in.
	git("switch", "-q", "stage");
	writeFileSync(join(repo, "b.txt"), "merged in from stage\n");
	git("add", "-A");
	git("commit", "-q", "-m", "S10: b");
	git("switch", "-q", "story/S9");
	git("merge", "-q", "--no-ff", "-m", "Merge stage", "stage");
	writeFileSync(join(repo, "a.txt"), "own line one\nown line two\n");
	git("commit", "-qam", "S9: more a");
	// Unshipped work: an edit and a new file.
	writeFileSync(join(repo, "c.txt"), "c\nworking edit\n");
	writeFileSync(join(repo, "d.txt"), "untracked\n");
});

afterAll(() => rmSync(repo, {
	recursive: true,
	force: true,
}));

describe("story_own_changed_files / story_own_diff", () =>
{
	it("list the story's own files, its working tree and untracked files, never a merged-in story's", () =>
	{
		expect(helper(`story_own_changed_files S9 ${base} .`).trim().split("\n")).toEqual(["a.txt", "c.txt", "d.txt"]);
	});

	it("print the patch by default, with the story's own lines and none of the merge's", () =>
	{
		const out = helper(`story_own_diff S9 ${base}`);
		expect(out).toContain("+own line two");
		expect(out).toContain("+working edit");
		expect(out).not.toContain("merged in from stage");
	});

	it("give numstat lines for --numstat", () =>
	{
		const out = helper(`story_own_diff S9 ${base} --numstat`);
		expect(out).toMatch(/^1\t0\ta\.txt$/m);
		expect(out).not.toContain("@@");
	});

	it("leave the output to any option that chooses it: no patch for a stat, raw or no-patch", () =>
	{
		for (const opt of ["--stat=80", "--raw", "-s", "--no-patch", "--name-status", "--compact-summary"])
		{
			expect(helper(`story_own_diff S9 ${base} ${opt}`), opt).not.toContain("@@");
		}
		expect(helper(`story_own_diff S9 ${base} --unified=0`)).toContain("+own line two");
	});
});
