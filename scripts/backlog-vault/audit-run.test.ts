/**
 * `scripts/audit.sh run` and `review --debt-json` (S158 ACs 4 and 7): the run journal becomes a run entry,
 * the journal moves to `.run/ended/`, and a backlog review lists the turn-cap hits it read. Runs the real
 * audit.sh in a throwaway repository with a stubbed `gh`, as audit-edit.test.ts does.
 */
import { spawnSync } from "node:child_process";
import {
	chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	afterEach, beforeEach, describe, expect, it,
} from "vitest";
import { readLedger } from "./ledger.ts";

const VAULT = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = join(VAULT, "..");
const MARKER = "<!-- entries below; newest last; appended by scripts/audit.sh -->";
const A = "2026-11-21T10:00:00.000Z";
const B = "2026-11-21T11:00:00.000Z";
const RUN = "R20261121T090000Z";

let tmp = "";
let repo = "";
beforeEach(() =>
{
	tmp = mkdtempSync(join(tmpdir(), "s158-audit-run-"));
	repo = join(tmp, "main");
	mkdirSync(repo);
});
afterEach(() => rmSync(tmp, {
	recursive: true,
	force: true,
}));

function git(cwd: string, ...args: string[]): string
{
	const r = spawnSync("git", ["-c", "user.name=T", "-c", "user.email=t@e", "-c", "core.hooksPath=/dev/null", ...args], {
		cwd,
		encoding: "utf8",
	});
	if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
	return r.stdout.trim();
}

/** A repository with audit.sh and the vault scripts, and a `gh` that fails and records being called. */
function setup(): string
{
	git(repo, "init", "-q", "-b", "stage");
	for (const f of ["audit.sh", "lib/reverify.sh", "lib/checks.sh", ...readdirSync(VAULT).filter((n) => n.endsWith(".ts") && !n.endsWith(".test.ts")).map((n) => `backlog-vault/${n}`)])
	{
		mkdirSync(dirname(join(repo, "scripts", f)), {
			recursive: true,
		});
		copyFileSync(join(SCRIPTS, f), join(repo, "scripts", f));
	}
	spawnSync("ln", ["-s", join(SCRIPTS, "../node_modules"), join(repo, "node_modules")]);
	mkdirSync(join(repo, "docs/v3"), {
		recursive: true,
	});
	writeFileSync(join(repo, "docs/v3/AUDIT.md"), `# Ledger\n\n${MARKER}\n`);
	endReviews(repo);
	writeFileSync(join(repo, ".gitignore"), "node_modules\n.run/\n");
	git(repo, "add", "-A");
	git(repo, "commit", "-q", "-m", "base");
	const bin = join(tmp, "bin");
	mkdirSync(bin);
	// Findings per pull request come from the journal's `findings` events (the pre-PR review's real findings), never
	// GitHub: this `gh` leaves a mark and fails, so any call shows (owner, 2026-11-26: "Count pre-PR findings (Recommended)").
	writeFileSync(join(bin, "gh"), ["#!/bin/sh", `echo "$*" >> "${join(tmp, "gh-called")}"`, "exit 1", ""].join("\n"));
	chmodSync(join(bin, "gh"), 0o755);
	return bin;
}

type Ev = { kind: string;
	id?: string;
	pr?: number;
	count?: number;
	review?: string;
	base?: string;
	at: string };

/** Both end-of-run reviews started after the journal's last story merge (11:30), as run-backlog step 6 asks. */
const END_STARTS: Ev[] = ["backlog", "parity"].map((review) => ({
	kind: "review-start",
	review,
	base: "abc1234",
	at: "2026-11-21T11:45:00.000Z",
}));

/** A review fragment in the tree: a verdict (`review`) or a `skip`, stamped `stamp`. */
function reviewEntry(root: string, review: "backlog" | "parity", stamp: string, kind: "review" | "skip" = "review"): void
{
	const name = review === "backlog" ? "backlog review" : "doc parity review";
	mkdirSync(join(root, "docs/v3/audit/2026-11-21"), {
		recursive: true,
	});
	writeFileSync(join(root, `docs/v3/audit/2026-11-21/${stamp}-${review}-${kind}.md`), `## 2026-11-21 — ${name} ${kind === "review" ? "(`continue`)" : "skipped"}\n\n| | |\n|---|---|\n`);
}

/** Both end-of-run reviews' verdicts, stamped after END_STARTS. */
function endReviews(root: string): void
{
	reviewEntry(root, "backlog", "20261121T120000Z");
	reviewEntry(root, "parity", "20261121T120000Z");
}

/** The default journal ends with its end-of-run reviews started; `ends = false` leaves them out. */
function journal(root: string, id = RUN, extra: Ev[] = [], path = ".run/run.json", ends = true): void
{
	mkdirSync(join(root, ".run"), {
		recursive: true,
	});
	mkdirSync(dirname(join(root, path)), {
		recursive: true,
	});
	writeFileSync(join(root, path), JSON.stringify({
		id,
		n: 4,
		c: 2,
		startedAt: "2026-11-21T09:00:00.000Z",
		events: [{
			kind: "item-start",
			id: "S9",
			at: "2026-11-21T09:01:00.000Z",
		}, {
			// S9's pre-PR review: two rounds, 2 and 1 real findings; S10's found none (#7: 3, #8: 0).
			kind: "findings",
			id: "S9",
			count: 2,
			at: "2026-11-21T09:20:00.000Z",
		}, {
			kind: "findings",
			id: "S9",
			count: 1,
			at: "2026-11-21T09:25:00.000Z",
		}, {
			kind: "findings",
			id: "S10",
			count: 0,
			at: "2026-11-21T09:35:00.000Z",
		}, {
			kind: "pr-open",
			id: "S9",
			pr: 7,
			at: "2026-11-21T09:30:00.000Z",
		}, {
			kind: "pr-open",
			id: "S10",
			pr: 8,
			at: "2026-11-21T09:40:00.000Z",
		}, {
			kind: "turn-cap",
			id: "S9",
			at: A,
		}, {
			kind: "turn-cap",
			id: "S10",
			at: B,
		}, {
			kind: "merged",
			id: "S9",
			at: "2026-11-21T11:30:00.000Z",
		}, ...extra, ...(ends ? END_STARTS : [])],
	}));
}

function audit(bin: string, cwd: string, args: string[]): ReturnType<typeof spawnSync>
{
	const env: Record<string, string | undefined> = {
		...process.env,
		PATH: `${bin}:${process.env.PATH}`,
	};
	delete env.BT_AUDIT_LEDGER;
	return spawnSync("bash", [join(cwd, "scripts/audit.sh"), ...args], {
		cwd,
		encoding: "utf8",
		env,
	});
}

const runEntries = (root: string) => readLedger(join(root, "docs/v3/AUDIT.md")).filter((e) => e.kind === "run");

describe("audit.sh run (S158 AC 4)", () =>
{
	it("audit.sh run writes the entry and moves the journal to .run/ended/", () =>
	{
		const bin = setup();
		journal(repo);
		const r = audit(bin, repo, ["run"]);
		expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
		expect(existsSync(join(repo, ".run/run.json"))).toBe(false);
		const ended = JSON.parse(readFileSync(join(repo, `.run/ended/${RUN}.json`), "utf8")) as { events: unknown[] };
		expect(ended.events).toHaveLength(9 + END_STARTS.length);
		expect(existsSync(join(tmp, "gh-called")), "audit.sh run asked GitHub for findings").toBe(false);
		const [entry] = runEntries(repo);
		expect(entry).toMatchObject({
			run: RUN,
			runC: 2,
			counted: false,
			findingsPerPr: 1.5,
			turnCaps: [{
				id: "S9",
				at: A,
			}, {
				id: "S10",
				at: B,
			}],
		});
		expect(entry!.file).toMatch(new RegExp(`-${RUN}-run\\.md$`));
		const text = readFileSync(join(repo, "docs/v3", entry!.file!), "utf8");
		expect(text).toContain(`S9 @ ${A}`);
		expect(text).toContain(`S10 @ ${B}`);
		expect(text).toContain("| Abandoned | no |");
	});

	it("audit.sh run --abandoned records a run that never counts, and moves its journal", () =>
	{
		const bin = setup();
		journal(repo);
		const r = audit(bin, repo, ["run", "--abandoned"]);
		expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
		expect(existsSync(join(repo, ".run/run.json"))).toBe(false);
		expect(existsSync(join(repo, `.run/ended/${RUN}.json`))).toBe(true);
		const [entry] = runEntries(repo);
		expect(entry).toMatchObject({
			counted: false,
			clean: false,
		});
		expect(entry!.turnCaps).toHaveLength(2);
		expect(readFileSync(join(repo, "docs/v3", entry!.file!), "utf8")).toContain("| Abandoned | yes |");
	});

	it("audit.sh run with no journal exits 2 and writes nothing", () =>
	{
		const bin = setup();
		expect(audit(bin, repo, ["run"]).status).toBe(2);
		expect(runEntries(repo)).toEqual([]);
	});

	it("audit.sh run from a linked worktree reads and moves the main checkout's journal, never the worktree's", () =>
	{
		const bin = setup();
		const wt = join(tmp, "wt");
		git(repo, "worktree", "add", "-q", "-b", "story/S9", wt);
		spawnSync("ln", ["-s", join(SCRIPTS, "../node_modules"), join(wt, "node_modules")]);
		journal(repo);
		journal(wt, "R20261121T080000Z");
		const r = audit(bin, wt, ["run"]);
		expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
		expect(existsSync(join(repo, ".run/run.json"))).toBe(false);
		expect(existsSync(join(repo, `.run/ended/${RUN}.json`))).toBe(true);
		expect(existsSync(join(wt, ".run/run.json"))).toBe(true);
		expect(runEntries(wt).map((e) => e.run)).toEqual([RUN]);
	});
});

describe("audit.sh run refuses what it can't record truly", () =>
{
	it("refuses, writing nothing, until both end-of-run reviews started after the last story merged and logged a verdict (run-backlog step 6)", () =>
	{
		const bin = setup();
		journal(repo, RUN, [], ".run/run.json", false);
		let r = audit(bin, repo, ["run"]);
		expect(r.status, `${r.stdout}${r.stderr}`).toBe(1);
		expect(r.stderr).toContain("end-of-run backlog review has not started since S9 merged");
		expect(r.stderr).toContain("end-of-run doc parity review has not started");
		expect(existsSync(join(repo, ".run/run.json"))).toBe(true);
		expect(runEntries(repo)).toEqual([]);
		// Started before the last story merged: still refused.
		journal(repo, RUN, [{
			kind: "merged",
			id: "S10",
			at: "2026-11-21T11:50:00.000Z",
		}]);
		r = audit(bin, repo, ["run"]);
		expect(r.status, `${r.stdout}${r.stderr}`).toBe(1);
		expect(r.stderr).toContain("has not started since S10 merged");
		expect(runEntries(repo)).toEqual([]);
	});

	it("a skip entry is no verdict: refused", () =>
	{
		const bin = setup();
		rmSync(join(repo, "docs/v3/audit"), {
			recursive: true,
			force: true,
		});
		reviewEntry(repo, "backlog", "20261121T120000Z", "skip");
		reviewEntry(repo, "parity", "20261121T120000Z");
		journal(repo);
		const r = audit(bin, repo, ["run"]);
		expect(r.status, `${r.stdout}${r.stderr}`).toBe(1);
		expect(r.stderr).toContain("end-of-run backlog review started");
		expect(r.stderr).not.toContain("doc parity review");
		expect(runEntries(repo)).toEqual([]);
	});

	it("a run whose merges were all bugs, or one recorded --abandoned, ends without the end-of-run reviews", () =>
	{
		const bin = setup();
		rmSync(join(repo, "docs/v3/audit"), {
			recursive: true,
			force: true,
		});
		journal(repo, RUN, [], ".run/run.json", false);
		expect(audit(bin, repo, ["run", "--abandoned"]).status).toBe(0);
		const BUGS = "R20261122T090000Z";
		writeFileSync(join(repo, ".run/run.json"), JSON.stringify({
			id: BUGS,
			n: 2,
			c: 2,
			startedAt: "2026-11-22T09:00:00.000Z",
			events: [{
				kind: "item-start",
				id: "B5",
				at: "2026-11-22T09:01:00.000Z",
			}, {
				kind: "merged",
				id: "B5",
				at: "2026-11-22T10:00:00.000Z",
			}],
		}));
		const r = audit(bin, repo, ["run"]);
		expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
	});

	const OLD = "R20261120T090000Z";
	const fragments = () => runEntries(repo).map((e) => e.run);

	it("audit.sh run counts a pull request with no findings event as 0, without asking GitHub", () =>
	{
		const bin = setup();
		journal(repo, RUN, [{
			kind: "pr-open",
			id: "S11",
			pr: 9,
			at: "2026-11-21T11:40:00.000Z",
		}]);
		const r = audit(bin, repo, ["run"]);
		expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
		expect(existsSync(join(tmp, "gh-called"))).toBe(false);
		expect(runEntries(repo)[0]).toMatchObject({
			findingsPerPr: 1,
		});
	});

	it("audit.sh run refuses while an ended run has no entry in the tree, naming --journal", () =>
	{
		const bin = setup();
		journal(repo, OLD, [], `.run/ended/${OLD}.json`);
		journal(repo);
		const r = audit(bin, repo, ["run"]);
		expect(r.status, `${r.stdout}${r.stderr}`).toBe(1);
		expect(r.stderr).toContain(OLD);
		expect(r.stderr).toContain("--journal");
		expect(existsSync(join(repo, ".run/run.json"))).toBe(true);
		expect(fragments()).toEqual([]);
	});

	it("audit.sh run --journal re-records an ended run from its journal, after which the new run may end", () =>
	{
		const bin = setup();
		journal(repo, OLD, [], `.run/ended/${OLD}.json`);
		journal(repo);
		const again = audit(bin, repo, ["run", "--journal", join(repo, `.run/ended/${OLD}.json`)]);
		expect(again.status, `${again.stdout}${again.stderr}`).toBe(0);
		expect(existsSync(join(repo, `.run/ended/${OLD}.json`))).toBe(true);
		expect(existsSync(join(repo, ".run/run.json"))).toBe(true);
		expect(fragments()).toEqual([OLD]);
		const r = audit(bin, repo, ["run"]);
		expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
		expect(fragments()).toEqual([OLD, RUN]);
	});

	it("audit.sh run --journal refuses while an earlier ended run has no entry, naming it", () =>
	{
		const bin = setup();
		const OLDER = "R20261119T090000Z";
		journal(repo, OLDER, [], `.run/ended/${OLDER}.json`);
		journal(repo, OLD, [], `.run/ended/${OLD}.json`);
		const later = audit(bin, repo, ["run", "--journal", join(repo, `.run/ended/${OLD}.json`)]);
		expect(later.status, `${later.stdout}${later.stderr}`).toBe(1);
		expect(later.stderr).toContain(OLDER);
		expect(fragments()).toEqual([]);
		// The earlier one re-records first (a later ended run never holds it back), then the later one may.
		expect(audit(bin, repo, ["run", "--journal", join(repo, `.run/ended/${OLDER}.json`)]).status).toBe(0);
		expect(audit(bin, repo, ["run", "--journal", join(repo, `.run/ended/${OLD}.json`)]).status).toBe(0);
		expect(fragments()).toEqual([OLDER, OLD]);
	});

	it("audit.sh run --abandoned marks the ended journal, so re-recording it without the flag stays abandoned", () =>
	{
		const bin = setup();
		journal(repo);
		expect(audit(bin, repo, ["run", "--abandoned"]).status).toBe(0);
		const ended = join(repo, `.run/ended/${RUN}.json`);
		expect(JSON.parse(readFileSync(ended, "utf8"))).toMatchObject({
			abandoned: true,
		});
		// Its entry pull request was closed unmerged: the entry is gone from the tree, the journal re-recorded.
		rmSync(join(repo, "docs/v3/audit"), {
			recursive: true,
			force: true,
		});
		const r = audit(bin, repo, ["run", "--journal", ended]);
		expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
		const [entry] = runEntries(repo);
		expect(entry).toMatchObject({
			counted: false,
		});
		expect(readFileSync(join(repo, "docs/v3", entry!.file!), "utf8")).toContain("| Abandoned | yes |");
	});

	it("audit.sh run --abandoned names --abandoned in the run end it couldn't finish", () =>
	{
		const bin = setup();
		journal(repo);
		// Another command holds the claims lock, so run end gives up after its wait.
		mkdirSync(join(repo, ".run/claims.lock"), {
			recursive: true,
		});
		writeFileSync(join(repo, ".run/claims.lock/pid"), `${process.pid}\n`);
		const r = audit(bin, repo, ["run", "--abandoned"]);
		expect(r.status, `${r.stdout}${r.stderr}`).toBe(2);
		expect(r.stderr).toMatch(new RegExp(`claims\\.ts run end ${RUN} --root \\S+ --abandoned`));
	}, 30_000);

	it("audit.sh run refuses an abandoned run already recorded, naming run end --abandoned", () =>
	{
		const bin = setup();
		journal(repo);
		expect(audit(bin, repo, ["run", "--abandoned"]).status).toBe(0);
		// Stopped before the move: the journal is still open, its abandoned mark with it.
		copyFileSync(join(repo, `.run/ended/${RUN}.json`), join(repo, ".run/run.json"));
		for (const args of [["run", "--abandoned"], ["run"]])
		{
			const r = audit(bin, repo, args);
			expect(r.status, `${r.stdout}${r.stderr}`).toBe(1);
			expect(r.stderr).toContain(`claims.ts run end ${RUN} --root <main checkout> --abandoned`);
		}
	});

	it("audit.sh run --journal reads a journal's abandoned mark: an item in flight doesn't refuse it", () =>
	{
		const bin = setup();
		journal(repo, OLD, [{
			kind: "item-start",
			id: "S11",
			at: "2026-11-21T11:45:00.000Z",
		}], `.run/ended/${OLD}.json`);
		const ended = join(repo, `.run/ended/${OLD}.json`);
		writeFileSync(ended, JSON.stringify({
			...JSON.parse(readFileSync(ended, "utf8")),
			abandoned: true,
		}));
		const r = audit(bin, repo, ["run", "--journal", ended]);
		expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
		expect(runEntries(repo)[0]).toMatchObject({
			counted: false,
		});
	});

	it("audit.sh run exits 2, not 1, when the ledger can't be read", () =>
	{
		const bin = setup();
		journal(repo);
		mkdirSync(join(repo, "docs/v3/audit/2026-11-20"), {
			recursive: true,
		});
		writeFileSync(join(repo, "docs/v3/audit/2026-11-20/20261120T090000Z-R20261120T090000Z-run.md"), "## 2026-11-20 — run R20261120T090001Z\n");
		const r = audit(bin, repo, ["run"]);
		expect(r.status, `${r.stdout}${r.stderr}`).toBe(2);
		expect(existsSync(join(repo, ".run/run.json"))).toBe(true);
	});

	it("audit.sh run --abandoned ends past an ended run with no entry (an abandoned entry never counts)", () =>
	{
		const bin = setup();
		journal(repo, OLD, [], `.run/ended/${OLD}.json`);
		journal(repo);
		const r = audit(bin, repo, ["run", "--abandoned"]);
		expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
		expect(fragments()).toEqual([RUN]);
	});

	it("audit.sh run refuses a run already recorded, naming claims.ts run end", () =>
	{
		const bin = setup();
		journal(repo);
		expect(audit(bin, repo, ["run"]).status).toBe(0);
		// Stopped between writing the entry and moving the journal: the journal is still open.
		copyFileSync(join(repo, `.run/ended/${RUN}.json`), join(repo, ".run/run.json"));
		const r = audit(bin, repo, ["run"]);
		expect(r.status, `${r.stdout}${r.stderr}`).toBe(1);
		expect(r.stderr).toContain(`claims.ts run end ${RUN}`);
		expect(fragments()).toEqual([RUN]);
	});

	it("audit.sh run refuses a run with an item in flight, naming it", () =>
	{
		const bin = setup();
		journal(repo, RUN, [{
			kind: "item-start",
			id: "S11",
			at: "2026-11-21T11:45:00.000Z",
		}]);
		const r = audit(bin, repo, ["run"]);
		expect(r.status, `${r.stdout}${r.stderr}`).toBe(1);
		expect(r.stderr).toContain("S11");
		expect(existsSync(join(repo, ".run/run.json"))).toBe(true);
		expect(fragments()).toEqual([]);
	});

	it("audit.sh run --abandoned records a run with an item in flight", () =>
	{
		const bin = setup();
		journal(repo, RUN, [{
			kind: "item-start",
			id: "S11",
			at: "2026-11-21T11:45:00.000Z",
		}]);
		const r = audit(bin, repo, ["run", "--abandoned"]);
		expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
		expect(fragments()).toEqual([RUN]);
	});

	it("audit.sh run: a held item is not in flight (a bug whose issue closed mid-run)", () =>
	{
		const bin = setup();
		journal(repo, RUN, [{
			kind: "item-start",
			id: "B300",
			at: "2026-11-21T11:45:00.000Z",
		}, {
			kind: "held",
			id: "B300",
			at: "2026-11-21T11:50:00.000Z",
		}]);
		const r = audit(bin, repo, ["run"]);
		expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
		expect(fragments()).toEqual([RUN]);
	});
});

describe("audit.sh review --debt-json (S158 AC 7)", () =>
{
	it("audit.sh review --debt-json lists the hits the review read, and ledger.ts reads them back", () =>
	{
		const bin = setup();
		const debt = join(tmp, "debt.json");
		writeFileSync(debt, JSON.stringify({
			due: true,
			base: "abc",
			done: [],
			inFlight: [],
			events: [{
				kind: "turn-cap",
				id: "S9",
				hits: [A, B],
			}, {
				kind: "inserted",
				id: "S20",
			}],
		}));
		const r = audit(bin, repo, ["review", "--verdict", "continue", "--trigger", "turn cap hit: S9", "--findings", "query: seed backlog", "--debt-json", debt]);
		expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
		const reviews = readLedger(join(repo, "docs/v3/AUDIT.md")).filter((e) => e.kind === "review");
		expect(reviews.at(-1)!.turnCaps).toEqual([{
			id: "S9",
			at: A,
		}, {
			id: "S9",
			at: B,
		}]);
		const plain = audit(bin, repo, ["review", "--verdict", "continue", "--trigger", "intake", "--findings", "query: seed intake"]);
		expect(plain.status).toBe(0);
		expect(readLedger(join(repo, "docs/v3/AUDIT.md")).filter((e) => e.kind === "review").at(-1)!.turnCaps).toEqual([]);
	});
});
