/**
 * Law L13 (S156, AC 10; owner, 2026-11-20: "Add both (Recommended)"): story records are
 * merge-safe. Three stories finished on three branches cut from one base each write every record
 * a finished story writes since S164 — an `edit` text record adding its `**Baseline:**` line (rule 17),
 * then a ship-time `snapshot` and a completion fragment written by the real `scripts/audit.sh` (new
 * files under docs/v3/audit/), a `changelog.d/<ID>.md` fragment (rule 16) and an edit to its own
 * Current baseline area row — and each branch also records a `create` for a new story of its own;
 * and the branches merge in all six orders with no conflict, `pnpm backlog:check` passing after
 * every merge. Before S156 the same three would have conflicted on AUDIT.md, CHANGELOG.md, the
 * As of line and the generated files.
 *
 * Runs in a throwaway repository under the OS temp directory holding a copy of today's frame notes and text records,
 * FEATURES/INTENT (rule 19's **Source:** check), the frozen AUDIT.md (which draws the pre-S156
 * line for records.ts) and changelog.d/, so it checks the real record formats rather than a
 * fixture's. The three stories are the first migrated open stories with no design and no dependencies,
 * so the test keeps working as the backlog moves. Child processes get an environment built
 * from scratch (no user git config, hooks or signing), so the developer's setup can't change
 * the result.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	afterAll, beforeAll, describe, expect, it,
} from "vitest";
import { FROZEN_AUDIT_SHA256, readLedger } from "./ledger.ts";
import {
	parseFields, readRecords, renderFields,
} from "./text-records.ts";
import { renderRunEntry, summarizeRun } from "./runs.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const CLI = join(ROOT, "scripts/backlog-vault/cli.ts");
const BASELINE_NOTE = "docs/v3/backlog/frame/01 Current baseline.md";

let tmp: string;
let repo: string;
let env: NodeJS.ProcessEnv;
let stories: string[];

/** Run a command in the throwaway repository; returns its status and output. */
function run(cmd: string, args: string[], input = ""): { status: number | null;
	out: string }
{
	const result = spawnSync(cmd, args, {
		cwd: repo,
		env,
		input,
		encoding: "utf8",
	});
	return {
		status: result.status,
		out: `${result.stdout}${result.stderr}`,
	};
}

/** git with a fixed identity, no hooks and no signing; throws on failure unless `allowFail`. */
function git(args: string[], allowFail = false): { status: number | null;
	out: string }
{
	const result = run("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args]);
	if (!allowFail && result.status !== 0)
	{
		throw new Error(`git ${args.join(" ")}: ${result.out}`);
	}
	return result;
}

/** `pnpm backlog:check` (or `build`) on the throwaway repository's notes and ledger. */
function backlog(command: "check" | "build"): { status: number | null;
	out: string }
{
	return run(process.execPath, [CLI, command, "--quiet", "--dir", join(repo, "docs/v3/backlog"), "--audit", join(repo, "docs/v3/AUDIT.md"), "--index", join(repo, "docs/v3/audit.jsonl")]);
}

/** The first three open stories (a migration record with a rewrite) with no design and no dependencies (no gate stops them going `done`). */
function pickStories(): string[]
{
	return readRecords(join(repo, "docs/v3/audit"))
		.filter((r) => r.kind === "migration" && r.id.startsWith("S") && r.rewrites.length > 0)
		.filter((r) =>
		{
			const fields = parseFields(r.body, r.id);
			return fields.design.length === 0 && fields.depends_on.length === 0;
		})
		.map((r) => r.id)
		.sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
		.slice(0, 3);
}

/** The Current baseline's area rows (table rows after the header and its separator), as line numbers. */
function areaRows(): number[]
{
	const lines = readFileSync(join(repo, BASELINE_NOTE), "utf8").split("\n");
	return lines.flatMap((line, i) => (/^\| /.test(line) && !/^\| Area \|/.test(line) ? [i] : []));
}

/** Append `marker` to line `index` of the Current baseline note. */
function editRow(index: number, marker: string): void
{
	const path = join(repo, BASELINE_NOTE);
	const lines = readFileSync(path, "utf8").split("\n");
	lines[index] = lines[index]!.replace(/ \|$/, ` ${marker} |`);
	writeFileSync(path, lines.join("\n"));
}

/**
 * Finish `id` on its own branch from `base`: every record a done story writes, then the commit.
 * The completion fragment comes from the real audit.sh (`--no-verify`: the repo-wide verify is
 * not what this test is about), run against a one-check grader the branch adds.
 */
function finishOnBranch(id: string, base: string, row: number): void
{
	git(["switch", "-q", "-c", `story/${id}`, base]);
	const newest = readRecords(join(repo, "docs/v3/audit")).filter((r) => r.id === id).at(-1)!;
	writeFileSync(join(tmp, `${id}.md`), newest.body.replace(/^(\*\*Impact:\*\*.*)$/m, `$1\n\n**Baseline:** ${id} finished in the merge-safety test; the baseline row it reaches says so.`));
	const edit = run("bash", ["scripts/audit.sh", "edit", id, "--body-file", join(tmp, `${id}.md`), "--reason", "its Baseline line"]);
	expect(edit.status, edit.out).toBe(0);
	// A new story of the branch's own, so a create fragment merges too.
	const created = `S${9000 + Number(id.slice(1))}`;
	writeFileSync(join(tmp, `${created}.md`), `**Gap:** g\n\n**Source:** ${/^\*\*Source:\*\*.*$/m.exec(newest.body)![0].replace("**Source:** ", "")}\n\n${renderFields({
		priority: 500,
	})}`);
	const create = run("bash", ["scripts/audit.sh", "create", created, "--title", "a new story", "--body-file", join(tmp, `${created}.md`), "--reason", "merge-safety"]);
	expect(create.status, create.out).toBe(0);
	editRow(row, `(${id} merge-safety)`);
	mkdirSync(join(repo, "changelog.d"), {
		recursive: true,
	});
	writeFileSync(join(repo, `changelog.d/${id}.md`), [
		"---",
		"effort: none",
		`title: ${id} merge-safety entry`,
		"---",
		"",
		`- **Before, the test had nothing. Now, ${id} has finished.** Details: **${id}** — the merge-safety test's story.`,
		"",
	].join("\n"));
	// A run entry of the branch's own (S158), so run fragments merge in any order too.
	const runId = `R20261121T${String(Number(id.slice(1)) % 1000000).padStart(6, "0")}Z`;
	mkdirSync(join(repo, "docs/v3/audit/2026-11-21"), {
		recursive: true,
	});
	writeFileSync(join(repo, `docs/v3/audit/2026-11-21/${runId.slice(1)}-${runId}-run.md`), renderRunEntry(summarizeRun({
		id: runId,
		n: 1,
		c: 2,
		startedAt: "2026-11-21T00:00:00.000Z",
		events: [],
	}, {}, [], {
		abandoned: false,
	}), {
		date: "2026-11-21",
		stamp: "2026-11-21T00:00:00Z",
		head: "`base`",
	}));
	const grader = join(repo, `scripts/verify-${id}.sh`);
	writeFileSync(grader, ["#!/usr/bin/env bash", "source scripts/lib/checks.sh", "check 1 \"the test story holds\"", `report "verify-${id}"`, "exit $?", ""].join("\n"));
	chmodSync(grader, 0o755);
	const build = backlog("build");
	expect(build.status, build.out).toBe(0);
	const audit = run("bash", ["scripts/audit.sh", "story", id, "--no-verify"]);
	expect(audit.status, audit.out).toBe(0);
	git(["add", "-A"]);
	git(["commit", "-q", "-m", `${id}: finished`]);
}

/** Every ordering of `items`. */
function permutations<T>(items: T[]): T[][]
{
	return items.length <= 1 ? [items] : items.flatMap((item, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]));
}

beforeAll(() =>
{
	tmp = mkdtempSync(join(tmpdir(), "merge-safety-"));
	repo = join(tmp, "repo");
	mkdirSync(join(tmp, "home"));
	env = {
		PATH: process.env.PATH,
		HOME: join(tmp, "home"),
		TMPDIR: tmp,
		LANG: "C.UTF-8",
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_CONFIG_GLOBAL: "/dev/null",
	};
	for (const path of ["docs/v3/backlog", "docs/v3/audit", "changelog.d"])
	{
		if (existsSync(join(ROOT, path)))
		{
			cpSync(join(ROOT, path), join(repo, path), {
				recursive: true,
			});
		}
	}
	for (const path of ["docs/v3/FEATURES.md", "docs/v3/INTENT.md", "docs/v3/AUDIT.md", "scripts/audit.sh", "scripts/lib/checks.sh", "scripts/lib/reverify.sh",
		"scripts/backlog-vault/text-records.ts", "scripts/backlog-vault/ledger.ts"])
	{
		mkdirSync(dirname(join(repo, path)), {
			recursive: true,
		});
		cpSync(join(ROOT, path), join(repo, path));
	}
	// audit.sh runs text-records.ts, which needs yaml: this checkout's node_modules, linked (and git-ignored).
	spawnSync("ln", ["-s", join(ROOT, "node_modules"), join(repo, "node_modules")]);
	// The built files are git-ignored by the real repository's own .gitignore (AC 8), copied rather than
	// restated, so a .gitignore that stopped ignoring them would fail here.
	cpSync(join(ROOT, ".gitignore"), join(repo, ".gitignore"));
	git(["init", "-q", "-b", "stage"]);
	git(["add", "-A"]);
	git(["commit", "-q", "-m", "base"]);
	stories = pickStories();
	const rows = areaRows();
	// Rows two apart: git merges by line, so edits to adjacent rows conflict (tested below).
	for (const [i, id] of stories.entries())
	{
		finishOnBranch(id, "stage", rows[i * 2]!);
	}
}, 60_000);

afterAll(() =>
{
	rmSync(tmp, {
		recursive: true,
		force: true,
	});
});

describe("the frozen AUDIT.md never changes (law L13)", () =>
{
	it("holds exactly its pinned bytes", () =>
	{
		const bytes = readFileSync(join(ROOT, "docs/v3/AUDIT.md"));
		expect(createHash("sha256").update(bytes).digest("hex")).toBe(FROZEN_AUDIT_SHA256);
	});
});

describe("story records merge in any order (law L13)", () =>
{
	it("finishes three stories on three branches, each passing backlog:check on its own", () =>
	{
		expect(stories).toHaveLength(3);
		for (const id of stories)
		{
			git(["switch", "-q", `story/${id}`]);
			const check = backlog("check");
			expect(check.status, check.out).toBe(0);
		}
	});

	it.each(permutations([0, 1, 2]).map((order) => [order.join("")]))("merges them in order %s with no conflict, backlog:check passing after each merge", (order) =>
	{
		const ids = [...order].map((i) => stories[Number(i)]!);
		git(["switch", "-q", "-c", `merge-${order}`, "stage"]);
		for (const id of ids)
		{
			const merge = git(["merge", "--no-ff", "--no-edit", `story/${id}`], true);
			if (merge.status !== 0)
			{
				// Leave a clean tree so the other orders still report their own result.
				git(["merge", "--abort"], true);
			}
			expect(merge.status, `merging ${id} after ${ids.slice(0, ids.indexOf(id)).join(", ")}: ${merge.out}`).toBe(0);
			const check = backlog("check");
			expect(check.status, check.out).toBe(0);
		}
		// Every record of all three is there: notes done with their lines, fragments parsed by ledger.ts.
		const completed = readLedger(join(repo, "docs/v3/AUDIT.md")).filter((e) => e.kind === "completed" && ids.includes(e.story ?? "")).map((e) => e.story);
		expect(completed.sort()).toEqual([...ids].sort());
		expect(readLedger(join(repo, "docs/v3/AUDIT.md")).filter((e) => e.kind === "run")).toHaveLength(ids.length);
		for (const id of ids)
		{
			const snapshot = readRecords(join(repo, "docs/v3/audit")).filter((r) => r.kind === "snapshot" && r.id === id).at(-1)!;
			expect(snapshot.status).toBe("done");
			expect(snapshot.body).toMatch(/^\*\*Baseline:\*\* /m);
			expect(readRecords(join(repo, "docs/v3/audit")).some((r) => r.kind === "create" && r.id === `S${9000 + Number(id.slice(1))}`)).toBe(true);
			expect(existsSync(join(repo, `changelog.d/${id}.md`))).toBe(true);
			expect(readFileSync(join(repo, BASELINE_NOTE), "utf8")).toContain(`(${id} merge-safety)`);
		}
		// The frozen ledger never changes.
		expect(git(["diff", "--quiet", "stage", "HEAD", "--", "docs/v3/AUDIT.md"], true).status).toBe(0);
	});

	it("does conflict when two stories edit adjacent baseline rows (why rule 17's rows must not touch)", () =>
	{
		const rows = areaRows();
		git(["switch", "-q", "-c", "adj-a", "stage"]);
		editRow(rows[0]!, "(a)");
		git(["commit", "-q", "-am", "a"]);
		git(["switch", "-q", "-c", "adj-b", "stage"]);
		editRow(rows[1]!, "(b)");
		git(["commit", "-q", "-am", "b"]);
		const merge = git(["merge", "--no-edit", "adj-a"], true);
		expect(merge.status).not.toBe(0);
		git(["merge", "--abort"]);
	});
});
