/**
 * ledger.ts: the one reader of AUDIT.md's entry headings — every shape audit.sh writes, the
 * review counter (only a review resets it; owner, 2026-11-03), the debt checks' base commit,
 * and the generated audit.jsonl index; since S156, the ledger fragments that follow the frozen
 * AUDIT.md (one file per entry), read in stamp order, and `shipping_commit` finding a story by
 * the commit that added its fragment.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	afterEach, describe, expect, it,
} from "vitest";
import {
	fragmentFiles, fragmentsDirFor, LEDGER_MARKER, LedgerParseError, ledgerBase, parseFragment, parseLedger, readLedger, renderLedgerIndex,
	reviewBlocked, storiesDoneSince,
} from "./ledger.ts";

const ledger = (...headings: string[]) => ["# Ledger", "## 2026-01-01 — preamble example, not an entry", LEDGER_MARKER, ...headings, ""].join("\n");
const completed = (...ids: string[]) => ids.map((id) => `## 2026-11-01 — ${id} completed`);

describe("parseLedger", () =>
{
	it("reads every heading shape audit.sh writes, after the marker only", () =>
	{
		const entries = parseLedger(ledger(
			"## 2026-09-08 — S1 verified (backfill, no grader)",
			"## 2026-09-08 — S11 verified (backfill)",
			"## 2026-10-01 — S5 completed",
			"## 2026-10-02 — S5 re-verified",
			"## 2026-10-03 — S5 re-verified at `74a93e0`",
			"## 2026-10-04 — S60 design match",
			"## 2026-10-05 — backlog review (`amended`)",
			"## 2026-10-06 — doc parity review (`continue`)",
			"## 2026-10-07 — backlog review answers (2026-10-05)",
			"## 2026-10-08 — doc parity review answers (2026-10-06)",
			"## 2026-10-09 — backlog review skipped",
			"## 2026-10-10 — doc parity review skipped",
		));
		expect(entries.map(({
			line, heading, ...rest
		}) => rest)).toEqual([
			{
				date: "2026-09-08",
				kind: "backfill",
				story: "S1",
			},
			{
				date: "2026-09-08",
				kind: "backfill",
				story: "S11",
			},
			{
				date: "2026-10-01",
				kind: "completed",
				story: "S5",
			},
			{
				date: "2026-10-02",
				kind: "re-verified",
				story: "S5",
			},
			{
				date: "2026-10-03",
				kind: "re-verified",
				story: "S5",
				at: "74a93e0",
			},
			{
				date: "2026-10-04",
				kind: "design-match",
				story: "S60",
			},
			{
				date: "2026-10-05",
				kind: "review",
				review: "backlog",
				verdict: "amended",
			},
			{
				date: "2026-10-06",
				kind: "review",
				review: "parity",
				verdict: "continue",
			},
			{
				date: "2026-10-07",
				kind: "answers",
				review: "backlog",
				answers: "2026-10-05",
			},
			{
				date: "2026-10-08",
				kind: "answers",
				review: "parity",
				answers: "2026-10-06",
			},
			{
				date: "2026-10-09",
				kind: "skip",
				review: "backlog",
			},
			{
				date: "2026-10-10",
				kind: "skip",
				review: "parity",
			},
		]);
		expect(entries[0]).toMatchObject({
			line: 4,
			heading: "## 2026-09-08 — S1 verified (backfill, no grader)",
		});
	});

	it("skips a review's own `## ` sub-headings, and reads a ledger without the marker from the top", () =>
	{
		expect(parseLedger(ledger("## 2026-10-05 — backlog review (`continue`)", "## Check 1 — coverage", "## Questions for the owner", "## x — note"))).toHaveLength(1);
		expect(parseLedger("## 2026-09-01 — S1 completed\n")).toHaveLength(1);
	});

	it("refuses a dated entry heading audit.sh never writes (a hand-written entry)", () =>
	{
		expect(() => parseLedger(ledger("## 2026-10-05 — backlog review (`amended`)", "## 2026-10-06 — S5 done by hand"))).toThrow(LedgerParseError);
		expect(() => parseLedger(ledger("## 2026-10-06 — S5 done by hand"))).toThrow(/line 4: "## 2026-10-06 — S5 done by hand"/);
	});

	it("reads the real docs/v3/AUDIT.md: every dated heading after the marker is an entry", () =>
	{
		const audit = readFileSync(fileURLToPath(new URL("../../docs/v3/AUDIT.md", import.meta.url)), "utf8");
		const after = audit.slice(audit.indexOf(LEDGER_MARKER));
		expect(parseLedger(audit)).toHaveLength(after.match(/^## \d{4}-\d{2}-\d{2} — /gm)?.length ?? -1);
	});
});

describe("storiesDoneSince (the review counter)", () =>
{
	it("counts each story completed since the newest review of the kind, once, in ledger order", () =>
	{
		const entries = parseLedger(ledger(...completed("S1"), "## 2026-11-02 — backlog review (`continue`)", ...completed("S2", "S3", "S2"), "## 2026-11-03 — S4 re-verified"));
		expect(storiesDoneSince(entries, "backlog")).toMatchObject({
			review: {
				date: "2026-11-02",
				verdict: "continue",
			},
			stories: ["S2", "S3"],
		});
		expect(storiesDoneSince(entries, "parity")).toEqual({
			review: undefined,
			stories: ["S1", "S2", "S3"],
		});
	});

	it("runs on through answers and skip entries: only a review resets it", () =>
	{
		const entries = parseLedger(ledger(
			"## 2026-11-02 — backlog review (`amended`)",
			...completed("S1", "S2"),
			"## 2026-11-03 — backlog review answers (2026-11-02)",
			...completed("S3"),
			"## 2026-11-03 — backlog review skipped",
			...completed("S4"),
		));
		expect(storiesDoneSince(entries, "backlog").stories).toEqual(["S1", "S2", "S3", "S4"]);
	});

	it("leaves a count already at the backstop as it is when the owner skips (owner, 2026-11-03)", () =>
	{
		const entries = parseLedger(ledger("## 2026-11-02 — backlog review (`amended`)", ...completed("S1", "S2", "S3", "S4", "S5", "S6"), "## 2026-11-03 — backlog review skipped"));
		expect(storiesDoneSince(entries, "backlog").stories).toHaveLength(6);
	});

	it("resets on a review of its own kind only", () =>
	{
		const entries = parseLedger(ledger("## 2026-11-02 — backlog review (`amended`)", ...completed("S1"), "## 2026-11-03 — doc parity review (`continue`)", ...completed("S2")));
		expect(storiesDoneSince(entries, "backlog").stories).toEqual(["S1", "S2"]);
		expect(storiesDoneSince(entries, "parity").stories).toEqual(["S2"]);
	});
});

describe("reviewBlocked (the review gate waits for the owner)", () =>
{
	const blocked = "## 2026-11-02 — backlog review (`blocked`)";

	it("is blocked while the kind's newest review or answers entry is a blocked review", () =>
	{
		expect(reviewBlocked(parseLedger(ledger(blocked, ...completed("S1"))), "backlog")).toBe(true);
		expect(reviewBlocked(parseLedger(ledger(blocked)), "parity")).toBe(false);
		expect(reviewBlocked(parseLedger(ledger("## 2026-11-02 — backlog review (`continue`)")), "backlog")).toBe(false);
	});

	it("is unblocked by the owner's answers, but not by a skip, which answers nothing", () =>
	{
		expect(reviewBlocked(parseLedger(ledger(blocked, "## 2026-11-03 — backlog review answers (2026-11-02)")), "backlog")).toBe(false);
		expect(reviewBlocked(parseLedger(ledger(blocked, "## 2026-11-03 — backlog review skipped")), "backlog")).toBe(true);
	});
});

describe("renderLedgerIndex (docs/v3/audit.jsonl)", () =>
{
	it("writes one JSON object per entry, oldest first, leaving out fields an entry lacks", () =>
	{
		const index = renderLedgerIndex(parseLedger(ledger("## 2026-11-02 — backlog review (`amended`)", ...completed("S1"))));
		expect(index.endsWith("\n")).toBe(true);
		expect(index.trim().split("\n").map((l) => JSON.parse(l) as unknown)).toEqual([
			{
				line: 4,
				date: "2026-11-02",
				kind: "review",
				review: "backlog",
				verdict: "amended",
				heading: "## 2026-11-02 — backlog review (`amended`)",
			},
			{
				line: 5,
				date: "2026-11-01",
				kind: "completed",
				story: "S1",
				heading: "## 2026-11-01 — S1 completed",
			},
		]);
		expect(renderLedgerIndex([])).toBe("");
	});
});

describe("ledgerBase (where the debt checks measure drift from)", () =>
{
	let repo = "";
	const git = (...args: string[]) => execFileSync("git", args, {
		cwd: repo,
		encoding: "utf8",
	});
	/** Commit `headings` as the whole ledger; returns the commit's short sha. */
	const commit = (message: string, ...headings: string[]) =>
	{
		writeFileSync(join(repo, "AUDIT.md"), ledger(...headings));
		git("add", "AUDIT.md");
		git("commit", "-qm", message);
		return git("rev-parse", "--short", "HEAD").trim();
	};

	afterEach(() => rmSync(repo, {
		recursive: true,
		force: true,
	}));

	it("is the newest commit that added a review, answers or skip entry of the kind; completions and corrections don't move it", () =>
	{
		repo = mkdtempSync(join(tmpdir(), "ledger-base-"));
		git("init", "-q");
		git("config", "user.email", "test@example.com");
		git("config", "user.name", "Test");
		git("config", "core.hooksPath", "/dev/null");

		expect(ledgerBase(repo, "AUDIT.md", "backlog")).toBeUndefined();

		const review = "## 2026-11-02 — backlog review (`amended`)";
		const parity = "## 2026-11-02 — doc parity review (`continue`)";
		const reviewed = commit("review", review, parity);
		commit("S1 done", review, parity, ...completed("S1"));
		expect(ledgerBase(repo, "AUDIT.md", "backlog")).toBe(reviewed);

		const answers = "## 2026-11-03 — backlog review answers (2026-11-02)";
		const answered = commit("answers", review, parity, ...completed("S1"), answers);
		writeFileSync(join(repo, "AUDIT.md"), `${ledger(review, parity, ...completed("S1"), answers)}A correction to the answer's text.\n`);
		git("commit", "-qam", "correction");
		expect(ledgerBase(repo, "AUDIT.md", "backlog")).toBe(answered);

		const skipped = commit("skip", review, parity, ...completed("S1"), answers, "## 2026-11-03 — backlog review skipped");
		expect(ledgerBase(repo, "AUDIT.md", "backlog")).toBe(skipped);
		expect(ledgerBase(repo, "AUDIT.md", "parity")).toBe(reviewed);
		expect(ledgerBase(repo, "missing.md", "backlog")).toBeUndefined();
	});

	/**
	 * Two same-day `continue` reviews share one heading, so the commit that added the first
	 * copy already "holds" the heading. Unless the copies are counted, the base stays on the
	 * first review and the drift the second review saw counts again (#40's class of wrong base).
	 */
	it("counts copies of a repeated heading, so a second same-day review moves the base", () =>
	{
		repo = mkdtempSync(join(tmpdir(), "ledger-base-"));
		git("init", "-q");
		git("config", "user.email", "test@example.com");
		git("config", "user.name", "Test");
		git("config", "core.hooksPath", "/dev/null");

		const review = "## 2026-11-02 — backlog review (`continue`)";
		commit("first", review);
		const second = commit("second", review, review);
		expect(ledgerBase(repo, "AUDIT.md", "backlog")).toBe(second);
	});

	/**
	 * #40: `git log -- AUDIT.md` lists a merge before both its parents, by date, so when the
	 * side without the review touched the ledger later than the review did, the merge was
	 * taken as the base and `git diff <merge> HEAD` hid drift the review never saw. Each
	 * commit gets a fixed date so the order is the one that broke it.
	 */
	describe("across a merge (#40)", () =>
	{
		const old = "## 2026-11-01 — backlog review (`continue`)";
		const fresh = "## 2026-11-05 — backlog review (`amended`)";
		/** Commit with a fixed author/committer date (seconds since 2026-11-01). */
		const dated = (at: number, message: string, write: () => void) =>
		{
			write();
			git("add", "-A");
			const date = `${1793491200 + at} +0000`;
			execFileSync("git", ["commit", "-qm", message], {
				cwd: repo,
				env: {
					...process.env,
					GIT_AUTHOR_DATE: date,
					GIT_COMMITTER_DATE: date,
				},
			});
			return git("rev-parse", "--short", "HEAD").trim();
		};
		const setup = () =>
		{
			repo = mkdtempSync(join(tmpdir(), "ledger-base-merge-"));
			git("init", "-q", "-b", "stage");
			git("config", "user.email", "test@example.com");
			git("config", "user.name", "Test");
			git("config", "core.hooksPath", "/dev/null");
			dated(0, "old review", () => writeFileSync(join(repo, "AUDIT.md"), ledger(old)));
		};
		/** Merge `branch` into the current branch, resolving the ledger to `headings`. */
		const merge = (at: number, branch: string, ...headings: string[]) =>
		{
			try
			{
				git("merge", "-q", "--no-ff", "--no-commit", branch);
			}
			catch
			{
				// The ledger conflicts; it is resolved below, as the run-backlog merge rule says.
			}
			return dated(at, `merge ${branch}`, () => writeFileSync(join(repo, "AUDIT.md"), ledger(...headings)));
		};

		it("is the review commit when a story branch rewrites an AC and then merges a stage carrying a newer review (#40)", () =>
		{
			setup();
			git("switch", "-qc", "story");
			dated(10, "rewrite an AC", () => writeFileSync(join(repo, "S9.md"), "rewritten AC\n"));
			git("switch", "-q", "stage");
			const reviewed = dated(20, "review", () => writeFileSync(join(repo, "AUDIT.md"), ledger(old, fresh)));
			git("switch", "-q", "story");
			dated(30, "S9 done", () => writeFileSync(join(repo, "AUDIT.md"), ledger(old, ...completed("S9"))));
			merge(40, "stage", old, ...completed("S9"), fresh);

			const base = ledgerBase(repo, "AUDIT.md", "backlog");
			expect(base).toBe(reviewed);
			expect(git("diff", "--name-only", base ?? "", "HEAD")).toContain("S9.md");
		});

		it("is the review commit when stage, with drift and a newer ledger commit, is merged into a branch holding the review (#40)", () =>
		{
			setup();
			git("switch", "-qc", "story");
			const reviewed = dated(20, "review", () => writeFileSync(join(repo, "AUDIT.md"), ledger(old, fresh)));
			git("switch", "-q", "stage");
			dated(10, "rewrite an AC", () => writeFileSync(join(repo, "S8.md"), "rewritten AC\n"));
			dated(30, "S8 done", () => writeFileSync(join(repo, "AUDIT.md"), ledger(old, ...completed("S8"))));
			git("switch", "-q", "story");
			merge(40, "stage", old, ...completed("S8"), fresh);

			const base = ledgerBase(repo, "AUDIT.md", "backlog");
			expect(base).toBe(reviewed);
			expect(git("diff", "--name-only", base ?? "", "HEAD")).toContain("S8.md");
		});
	});
});

/** The repository root (this file is scripts/backlog-vault/ledger.test.ts). */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * What the base commit's parser (S156's base, `8051c3b4`, before fragments) gives for the frozen
 * AUDIT.md: the SHA-256 of `JSON.stringify(parseLedger(AUDIT.md))`, computed once with that parser
 * on the frozen file. Pinned rather than read with `git show`, which fails in CI's depth-1 checkout.
 * Today's parser must give exactly the same entries (S156 AC 5); S156's grader recomputes the pin
 * with the base parser, from history, so it can't drift from it.
 */
const BASE_PARSER_SHA256 = "8b53568ec81d4bcef6865845bbe0b03b99be8c3df82baa12330a3e483aa1eab4";

describe("parseLedger reads the frozen AUDIT.md exactly as the base commit's parser did (S156)", () =>
{
	it("gives the entries the base parser gave", () =>
	{
		const now = parseLedger(readFileSync(join(REPO_ROOT, "docs/v3/AUDIT.md"), "utf8"));
		expect(now.length).toBeGreaterThan(100);
		expect(createHash("sha256").update(JSON.stringify(now)).digest("hex")).toBe(BASE_PARSER_SHA256);
	});
});

/** A fragment as audit.sh writes one: the entry's heading and table, nothing above it. */
const fragment = (heading: string, ...rows: string[]) => [heading, "", "| | |", "|---|---|", ...rows, ""].join("\n");

describe("ledger fragments (S156)", () =>
{
	let dir = "";
	afterEach(() => rmSync(dir, {
		recursive: true,
		force: true,
	}));
	/** Write `files` (path relative to the fragment folder → text) beside a frozen AUDIT.md of `headings`. */
	const world = (files: Record<string, string>, ...headings: string[]) =>
	{
		dir = mkdtempSync(join(tmpdir(), "ledger-fragments-"));
		writeFileSync(join(dir, "AUDIT.md"), ledger(...headings));
		for (const [path, text] of Object.entries(files))
		{
			mkdirSync(dirname(join(dir, "audit", path)), {
				recursive: true,
			});
			writeFileSync(join(dir, "audit", path), text);
		}
		return join(dir, "AUDIT.md");
	};

	it("live in the lower-case folder named for their ledger", () =>
	{
		expect(fragmentsDirFor("docs/v3/AUDIT.md")).toBe("docs/v3/audit");
		expect(fragmentsDirFor("docs/v3/VAULT-MIGRATION-AUDIT.md")).toBe("docs/v3/vault-migration-audit");
	});

	it("follow AUDIT.md's entries in stamp order, whatever their folders' or IDs' order", () =>
	{
		const audit = world({
			"2026-11-22/20261122T000000Z-S2-completed.md": fragment("## 2026-11-21 — S2 completed"),
			"2026-11-21/20261121T235959Z-backlog-review.md": fragment("## 2026-11-21 — backlog review (`continue`)", "| In flight | S7, B9 |"),
			"2026-11-21/20261121T100000Z-S10-completed.md": fragment("## 2026-11-21 — S10 completed", "## Check 1 — a sub-heading, skipped"),
		}, ...completed("S1"));
		const entries = readLedger(audit);
		expect(entries.map((e) => [e.heading, e.file, e.line])).toEqual([
			["## 2026-11-01 — S1 completed", undefined, 4],
			["## 2026-11-21 — S10 completed", "audit/2026-11-21/20261121T100000Z-S10-completed.md", 1],
			["## 2026-11-21 — backlog review (`continue`)", "audit/2026-11-21/20261121T235959Z-backlog-review.md", 1],
			// The heading has the local date, the folder the stamp's UTC date: they may differ.
			["## 2026-11-21 — S2 completed", "audit/2026-11-22/20261122T000000Z-S2-completed.md", 1],
		]);
		expect(entries[2]!.inFlight).toEqual(["S7", "B9"]);
		// The counters read fragments like any entry: the review resets, S2 counts after it.
		expect(storiesDoneSince(entries, "backlog").stories).toEqual(["S2"]);
		const index = renderLedgerIndex(entries).trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
		expect(index[0]).not.toHaveProperty("file");
		expect(index[2]).toMatchObject({
			file: "audit/2026-11-21/20261121T235959Z-backlog-review.md",
			kind: "review",
			inFlight: ["S7", "B9"],
		});
	});

	it("are just the frozen ledger when there are none", () =>
	{
		const audit = world({}, ...completed("S1"));
		expect(fragmentFiles(join(dir, "audit"))).toEqual([]);
		expect(readLedger(audit)).toEqual(parseLedger(ledger(...completed("S1"))));
	});

	it("records no in-flight items when the row says none", () =>
	{
		expect(parseFragment(fragment("## 2026-11-21 — doc parity review (`amended`)", "| In flight | none |"), "a/20261121T000000Z-parity-review.md").inFlight).toBeUndefined();
	});

	it("name every entry kind audit.sh writes by its file-name kind", () =>
	{
		const cases: [string, string][] = [
			["S5-reverified", "## 2026-11-21 — S5 re-verified at `74a93e0`"],
			["S5-backfill", "## 2026-11-21 — S5 verified (backfill)"],
			["S60-design", "## 2026-11-21 — S60 design match"],
			["backlog-answers", "## 2026-11-21 — backlog review answers (2026-11-20)"],
			["parity-skip", "## 2026-11-21 — doc parity review skipped"],
		];
		for (const [name, heading] of cases)
		{
			expect(parseFragment(fragment(heading), `d/20261121T000000Z-${name}.md`).heading).toBe(heading);
		}
	});

	it("throw on a fragment audit.sh couldn't have written", () =>
	{
		const bad: [string, string][] = [
			["d/S1-completed.md", fragment("## 2026-11-21 — S1 completed")], // no stamp
			["d/20261121T000000Z-S1-completed.md", fragment("## 2026-11-21 — S2 completed")], // name and entry disagree
			["d/20261121T000000Z-S1-reverified.md", fragment("## 2026-11-21 — S1 completed")], // kind disagrees
			["d/20261121T000000Z-S1-completed.md", "no heading\n"], // no entry
			["d/20261121T000000Z-S1-completed.md", `${fragment("## 2026-11-21 — S1 completed")}${fragment("## 2026-11-21 — S1 completed")}`], // two
			["d/20261121T000000Z-S1-completed.md", fragment("## 2026-11-21 — S1 finished by hand")], // unknown shape
		];
		for (const [file, text] of bad)
		{
			expect(() => parseFragment(text, file), file).toThrow(LedgerParseError);
		}
		world({
			"stray.md": "not in a date folder\n",
		});
		expect(() => fragmentFiles(join(dir, "audit"))).toThrow(LedgerParseError);
	});

	it("skip names starting with a dot at both levels (.DS_Store, an editor's swap file, audit.sh's .tmp)", () =>
	{
		const audit = world({
			".DS_Store": "binary junk",
			"2026-11-21/.DS_Store": "binary junk",
			"2026-11-21/.20261121T000001Z-S2-completed.md.tmp": "",
			"2026-11-21/20261121T000000Z-S1-completed.md": fragment("## 2026-11-21 — S1 completed"),
		});
		expect(fragmentFiles(join(dir, "audit"))).toEqual(["2026-11-21/20261121T000000Z-S1-completed.md"]);
		expect(readLedger(audit).map((e) => e.story)).toEqual(["S1"]);
	});

	it("keep a story the review listed as in flight counted across that review (its completion stamped before it)", () =>
	{
		const audit = world({
			"2026-11-21/20261121T100000Z-S9-completed.md": fragment("## 2026-11-21 — S9 completed"),
			"2026-11-21/20261121T100001Z-S8-completed.md": fragment("## 2026-11-21 — S8 completed"),
			"2026-11-21/20261121T110000Z-backlog-review.md": fragment("## 2026-11-21 — backlog review (`continue`)", "| In flight | S9 |"),
			"2026-11-21/20261121T120000Z-S10-completed.md": fragment("## 2026-11-21 — S10 completed"),
		});
		const entries = readLedger(audit);
		// S9 was being built beside the review, so the review didn't cover it; S8 it did.
		expect(storiesDoneSince(entries, "backlog").stories).toEqual(["S9", "S10"]);
		// A parity review's in-flight list doesn't touch the backlog count, nor the reverse.
		expect(storiesDoneSince(entries, "parity").stories).toEqual(["S9", "S8", "S10"]);
		// A later review that doesn't list S9 has reviewed it: the count resets as usual.
		writeFileSync(join(dir, "audit", "2026-11-21", "20261121T130000Z-backlog-review.md"), fragment("## 2026-11-21 — backlog review (`continue`)", "| In flight | none |"));
		expect(storiesDoneSince(readLedger(audit), "backlog").stories).toEqual([]);
	});
});

describe("ledgerBase and shipping_commit with fragments (S156)", () =>
{
	let repo = "";
	const git = (...args: string[]) => execFileSync("git", args, {
		cwd: repo,
		encoding: "utf8",
	});
	const write = (path: string, text: string) =>
	{
		mkdirSync(dirname(join(repo, path)), {
			recursive: true,
		});
		writeFileSync(join(repo, path), text);
	};
	const commit = (message: string) =>
	{
		git("add", "-A");
		git("commit", "-qm", message);
		return git("rev-parse", "--short", "HEAD").trim();
	};
	const shippingCommit = (id: string) => execFileSync("bash", ["-c", `source "${join(REPO_ROOT, "scripts/lib/reverify.sh")}" && shipping_commit docs/v3/AUDIT.md ${id}`], {
		cwd: repo,
		encoding: "utf8",
	}).trim();

	afterEach(() => rmSync(repo, {
		recursive: true,
		force: true,
	}));

	it("measure from the commit that added a fragment, and fall back to the frozen ledger without one", () =>
	{
		repo = mkdtempSync(join(tmpdir(), "ledger-fragment-base-"));
		git("init", "-q", "-b", "stage");
		git("config", "user.email", "test@example.com");
		git("config", "user.name", "Test");
		git("config", "core.hooksPath", "/dev/null");

		const stamp = "2026-01-02T03:04:05Z";
		write("docs/v3/AUDIT.md", ledger("## 2026-11-02 — backlog review (`amended`)", "## 2026-11-03 — S1 completed", `| Captured (UTC) | \`${stamp}\` |`));
		const frozen = commit("frozen ledger");
		expect(ledgerBase(repo, "docs/v3/AUDIT.md", "backlog")).toBe(frozen);
		expect(shippingCommit("S1")).toBe(frozen);

		// A story branch adds its completion fragment; a merge brings it to stage.
		git("switch", "-qc", "story/S2");
		write("docs/v3/audit/2026-11-21/20261121T100000Z-S2-completed.md", fragment("## 2026-11-21 — S2 completed", "| Shipped in | the commit that adds this entry |"));
		const shipped = commit("S2 done");
		git("switch", "-q", "stage");
		git("merge", "-q", "--no-ff", "-m", "merge S2", "story/S2");
		expect(shippingCommit("S2")).toBe(shipped);
		expect(shippingCommit("S1")).toBe(frozen);
		expect(shippingCommit("S3")).toBe("");
		// A completion fragment is no review: the base stays where it was.
		expect(ledgerBase(repo, "docs/v3/AUDIT.md", "backlog")).toBe(frozen);

		// A backfill fragment names its shipping commit.
		write("docs/v3/audit/2026-11-21/20261121T110000Z-S1-backfill.md", fragment("## 2026-11-21 — S1 verified (backfill)", `| Shipped in | \`${shipped}\` — S2 done |`));
		commit("S1 backfill");
		expect(shippingCommit("S1")).toBe(shipped);

		// A skip fragment moves the backlog base, not the parity one (it has none).
		write("docs/v3/audit/2026-11-21/20261121T120000Z-backlog-skip.md", fragment("## 2026-11-21 — backlog review skipped"));
		const skipped = commit("skip");
		expect(ledgerBase(repo, "docs/v3/AUDIT.md", "backlog")).toBe(skipped);
		expect(ledgerBase(repo, "docs/v3/AUDIT.md", "parity")).toBeUndefined();

		// Only committed fragments count for the base.
		write("docs/v3/audit/2026-11-21/20261121T130000Z-backlog-review.md", fragment("## 2026-11-21 — backlog review (`continue`)"));
		expect(ledgerBase(repo, "docs/v3/AUDIT.md", "backlog")).toBe(skipped);
	});
});
