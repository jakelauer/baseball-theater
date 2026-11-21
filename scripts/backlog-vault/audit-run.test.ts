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

/** A repository with audit.sh and the vault scripts, and a `gh` answering two pull requests' Claude reviews. */
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
	writeFileSync(join(repo, ".gitignore"), "node_modules\n.run/\n");
	git(repo, "add", "-A");
	git(repo, "commit", "-q", "-m", "base");
	const bin = join(tmp, "bin");
	mkdirSync(bin);
	// #7 has two Claude reviews (2 and 1 inline comments) and another review; #8 has none.
	writeFileSync(join(bin, "gh"), [
		"#!/bin/sh",
		"case \"$2\" in",
		"  */pulls/7/reviews) echo 101; echo 102 ;;",
		"  */reviews/101/comments) echo c1; echo c2 ;;",
		"  */reviews/102/comments) echo c3 ;;",
		"  */pulls/8/reviews) ;;",
		"  *) exit 1 ;;",
		"esac",
		"",
	].join("\n"));
	chmodSync(join(bin, "gh"), 0o755);
	return bin;
}

function journal(root: string, id = RUN): void
{
	mkdirSync(join(root, ".run"), {
		recursive: true,
	});
	writeFileSync(join(root, ".run/run.json"), JSON.stringify({
		id,
		n: 4,
		c: 2,
		startedAt: "2026-11-21T09:00:00.000Z",
		events: [{
			kind: "item-start",
			id: "S9",
			at: "2026-11-21T09:01:00.000Z",
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
		}],
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
		expect(ended.events).toHaveLength(5);
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
