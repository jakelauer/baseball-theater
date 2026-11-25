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
 * fixture's. The three stories are its own (S8001–S8003, created in the copy with no design and no dependencies,
 * #626): picking real open stories counted a shipped one twice (#618), then ran out of picks once S100 shipped, so no
 * real story shipping changes the result. Child processes get an environment built
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
	parseFields, readRecords, renderFields, renderRecord,
} from "./text-records.ts";
import { renderRunEntry, summarizeRun } from "./runs.ts";
import { featureNames } from "./source.ts";

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

/** The test's own stories: IDs far above any real story's, so none has a text record, snapshot or ledger entry already. */
const SEEDED = ["S8001", "S8002", "S8003"];

/**
 * Write a `create` record for each of {@link SEEDED} into the copy at `root` and return their IDs: open stories with
 * no design and no dependencies (no gate stops them going `done`), whose **Source:** cites FEATURES.md's first live
 * feature (rule 19). Before #626 the test picked real open stories instead, and failed once too few were left.
 */
function seedStories(root = repo): string[]
{
	const feature = [...featureNames(readFileSync(join(ROOT, "docs/v3/FEATURES.md"), "utf8")).live][0]!;
	const day = join(root, "docs/v3/audit/2000-01-01");
	mkdirSync(day, {
		recursive: true,
	});
	for (const [i, id] of SEEDED.entries())
	{
		const stamp = `2000-01-01T00:00:0${i}Z`;
		writeFileSync(join(day, `20000101T00000${i}Z-${id}-create.md`), renderRecord({
			kind: "create",
			id,
			date: "2000-01-01",
			stamp,
			head: "test",
			title: `merge-safety story ${id}`,
			reason: "merge-safety test data (#626)",
			body: `**Gap:** g\n\n**Impact:** Before ${id}, nothing. After it, the merge-safety test has a story to finish.\n\n**Source:** Feature: ${feature}\n\n${renderFields({
				priority: 500,
			})}`,
		}));
	}
	return [...SEEDED];
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
		"scripts/backlog-vault/text-records.ts", "scripts/backlog-vault/ledger.ts", "scripts/backlog-vault/run-directly.ts"])
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
	stories = seedStories();
	git(["init", "-q", "-b", "stage"]);
	git(["add", "-A"]);
	git(["commit", "-q", "-m", "base"]);
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
	it("finishes only stories the real backlog has never recorded, so none can have shipped already (#618)", () =>
	{
		// Finishing a story that already shipped counted it twice and failed the merges on a correct tree (#618).
		const real = new Set([
			...readRecords(join(ROOT, "docs/v3/audit")).map((r) => r.id),
			...readLedger(join(ROOT, "docs/v3/AUDIT.md")).flatMap((e) => (e.story ? [e.story] : [])),
		]);
		for (const id of [...SEEDED, ...SEEDED.map((s) => `S${9000 + Number(s.slice(1))}`)])
		{
			expect(real.has(id), id).toBe(false);
		}
	});

	it("still has three stories to finish once every real story has shipped (#626)", () =>
	{
		// A copy of the backlog in which every real story has a done snapshot, as the backlog moves
		// towards: S100 recording done left only two real picks and failed six of these cases.
		const allShipped = join(tmp, "all-shipped");
		cpSync(join(ROOT, "docs/v3/audit"), join(allShipped, "docs/v3/audit"), {
			recursive: true,
		});
		cpSync(join(ROOT, "docs/v3/AUDIT.md"), join(allShipped, "docs/v3/AUDIT.md"));
		const day = join(allShipped, "docs/v3/audit/2099-01-02");
		mkdirSync(day);
		const records = readRecords(join(allShipped, "docs/v3/audit"));
		for (const id of new Set(records.filter((r) => r.id.startsWith("S")).map((r) => r.id)))
		{
			const newest = records.filter((r) => r.id === id).at(-1)!;
			writeFileSync(join(day, `20990102T000000Z-${id}-snapshot.md`), renderRecord({
				kind: "snapshot",
				id,
				date: "2099-01-02",
				stamp: "2099-01-02T00:00:00Z",
				head: "test",
				record: newest.file,
				body: newest.body,
				status: "done",
			}));
		}
		const seeded = seedStories(allShipped);
		expect(seeded).toHaveLength(3);
		const after = readRecords(join(allShipped, "docs/v3/audit"));
		for (const id of seeded)
		{
			expect(after.some((r) => r.id === id && r.kind === "snapshot"), id).toBe(false);
			const fields = parseFields(after.filter((r) => r.id === id).at(-1)!.body, id);
			expect([fields.design, fields.depends_on]).toEqual([[], []]);
		}
	});

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
		// The copy starts with the real repository's own run entries (docs/v3/audit is copied whole), so count only
		// the three this test adds: a real run recorded the same day once made this fail on a correct tree.
		const realRuns = readLedger(join(ROOT, "docs/v3/AUDIT.md")).filter((e) => e.kind === "run").length;
		expect(readLedger(join(repo, "docs/v3/AUDIT.md")).filter((e) => e.kind === "run")).toHaveLength(realRuns + ids.length);
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
