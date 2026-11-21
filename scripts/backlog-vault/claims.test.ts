/**
 * claims.ts (S156 ACs 12–14): comparing a worker's claim with the in-flight claims, the barrier check,
 * the commit-time diff against the claim, a review's edit to an in-flight note, and the overseer's
 * findings merge and question order. Pure functions get fixtures; the CLI runs in a temp root with an
 * environment built from scratch, so the real repository's `.run/` and `.pending/` are never read.
 */
import { spawn, spawnSync } from "node:child_process";
import {
	copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	afterEach, beforeEach, describe, expect, it,
} from "vitest";
import type { Claim } from "./claims.ts";
import {
	branchesNaming, ClaimsError, compareClaim, isBarrierPath, lockDir, makeClaim, mergeFindings, orderQuestions, outsideClaim, parseFindings, parseQuestions,
	readClaims, reviewEditsToInFlight, reviewerFlags, uncoveredBlocked, withClaimsLock, writeClaim,
} from "./claims.ts";
import type { CachedIssue } from "./github.ts";
import { writeCache } from "./github.ts";
import { inFlightIds, invalidInFlight } from "./in-flight.ts";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "claims.ts");

/** A claim with no reviewer paths (the barrier flag comes from the rule files alone). */
function claim(id: string, input: { files?: string[];
	symbols?: string[];
	docLines?: string[] }): Claim
{
	return makeClaim(id, input, (input.files ?? []).map(() => false));
}

describe("compareClaim", () =>
{
	it("a shared new symbol is a conflict", () =>
	{
		const report = compareClaim(claim("S2", {
			files: ["web/src/a.tsx"],
			symbols: ["useInningPitches"],
		}), [claim("S1", {
			files: ["web/src/b.tsx"],
			symbols: ["useInningPitches"],
		})]);
		expect(report.ok).toBe(false);
		expect(report.conflicts).toEqual(["symbol useInningPitches: also added by S1"]);
	});

	it("a shared doc line is a conflict, whitespace aside", () =>
	{
		const report = compareClaim(claim("S2", {
			docLines: ["CLAUDE.md:  Push as part of finishing"],
		}), [claim("S1", {
			docLines: ["CLAUDE.md: Push as part of\tfinishing"],
		})]);
		expect(report.ok).toBe(false);
		expect(report.conflicts).toHaveLength(1);
	});

	it("a shared hot file is recorded and orders the merge, but admits", () =>
	{
		const report = compareClaim(claim("S2", {
			files: ["functions/src/handlers/api.ts", "web/src/x.ts"],
		}), [claim("S1", {
			files: ["functions/src/handlers/"],
		})]);
		expect(report.ok).toBe(true);
		expect(report.hot).toEqual([{
			file: "functions/src/handlers/api.ts",
			with: "S1",
		}]);
		expect(report.mergeAfter).toEqual(["S1"]);
	});

	it("vitest.config.ts is hot per package, not across packages", () =>
	{
		const same = compareClaim(claim("S2", {
			files: ["web/vitest.config.ts"],
		}), [claim("S1", {
			files: ["web/vitest.config.ts"],
		})]);
		const other = compareClaim(claim("S2", {
			files: ["web/vitest.config.ts"],
		}), [claim("S1", {
			files: ["functions/vitest.config.ts"],
		})]);
		expect(same.mergeAfter).toEqual(["S1"]);
		expect(other.mergeAfter).toEqual([]);
	});

	it("an ordinary shared file is reported, not a conflict", () =>
	{
		const report = compareClaim(claim("S2", {
			files: ["web/src/a.tsx"],
		}), [claim("S1", {
			files: ["web/src/a.tsx"],
		})]);
		expect(report.ok).toBe(true);
		expect(report.shared).toEqual([{
			file: "web/src/a.tsx",
			with: "S1",
		}]);
		expect(report.mergeAfter).toEqual([]);
	});

	it("a barrier item runs alone: held while anything is in flight, and holds everything while it is", () =>
	{
		const barrier = claim("S9", {
			files: ["docs/v3/LOOP.md"],
		});
		expect(barrier.barrier).toBe(true);
		expect(compareClaim(barrier, [claim("S1", {
			files: ["web/src/a.tsx"],
		})]).ok).toBe(false);
		expect(compareClaim(barrier, []).ok).toBe(true);
		expect(compareClaim(claim("S2", {
			files: ["web/src/b.tsx"],
		}), [barrier]).barrier).toHaveLength(1);
	});

	it("re-claiming an in-flight item compares against the others only", () =>
	{
		const first = claim("S1", {
			symbols: ["thing"],
		});
		expect(compareClaim(claim("S1", {
			symbols: ["thing"],
		}), [first]).ok).toBe(true);
	});
});

describe("barrier paths", () =>
{
	it("CLAUDE.md, docs/v3/LOOP.md, .claude/ and reviewer paths are barriers; a directory reaching one is too", () =>
	{
		expect(isBarrierPath("CLAUDE.md", false)).toBe(true);
		expect(isBarrierPath(".claude/skills/run-backlog/SKILL.md", false)).toBe(true);
		expect(isBarrierPath("docs/v3/", false)).toBe(true);
		expect(isBarrierPath("scripts/lib/checks.sh", true)).toBe(true);
		expect(isBarrierPath("web/src/routes.tsx", false)).toBe(false);
	});

	it("asks plan-review.py's is_reviewer_path, not a copy of its lists", () =>
	{
		expect(reviewerFlags(["scripts/lib/checks.sh", ".github/workflows/ci.yml", "web/src/routes.tsx", "web/package.json"])).toEqual([true, true, false, true]);
		expect(reviewerFlags([])).toEqual([]);
	});
});

describe("outsideClaim (commit time)", () =>
{
	it("reports a touched file outside the claim, and not the item's own records", () =>
	{
		const c = claim("S7", {
			files: ["web/src/", "packages/domain/src/pitch.ts"],
		});
		const touched = [
			"web/src/a.tsx", "packages/domain/src/pitch.ts", "packages/domain/src/inning.ts",
			"scripts/verify-S7.sh", "changelog.d/S7.md", "docs/v3/audit/2026-11-20/1200-S7-story.md", "docs/v3/audit/2026-11-20/1201-S7-edit.md",
			"docs/v3/audit/2026-11-20/1200-S8-edit.md",
			// Since S164 retired the notes, a note path is no longer the item's own record.
			"docs/v3/backlog/stories/done/S7.md",
		];
		expect(outsideClaim(c, touched)).toEqual(["packages/domain/src/inning.ts", "docs/v3/audit/2026-11-20/1200-S8-edit.md", "docs/v3/backlog/stories/done/S7.md"]);
	});
});

describe("reviewEditsToInFlight", () =>
{
	it("a review's edit to an in-flight item's note is reported; other notes are free", () =>
	{
		expect(reviewEditsToInFlight(["docs/v3/audit/2026-11-21/20261121T000000Z-S9-edit.md", "docs/v3/audit/2026-11-21/20261121T000000Z-S8-edit.md"], ["S9"]))
			.toEqual(["docs/v3/audit/2026-11-21/20261121T000000Z-S9-edit.md"]);
		const changed = ["docs/v3/backlog/stories/doing/S5.md", "docs/v3/backlog/stories/todo/S6.md", "docs/v3/backlog/bugs/todo/B87.md", "docs/v3/audit/x.md"];
		expect(reviewEditsToInFlight(changed, ["S5", "B87"])).toEqual(["docs/v3/backlog/stories/doing/S5.md", "docs/v3/backlog/bugs/todo/B87.md"]);
	});
});

describe("findings and questions", () =>
{
	it("merges two items' findings of one class and file into one shared fix", () =>
	{
		const text = [
			"# Findings",
			"- S1 | 8 | scripts/lib/checks.sh:40 | sourcing runs a guard",
			"- S2 | 8 | scripts/lib/checks.sh:52 | same guard on import",
			"- S2 | 3 | web/src/a.tsx | empty list shows zero",
			"not a finding line",
		].join("\n");
		const groups = mergeFindings(parseFindings(text));
		expect(groups).toHaveLength(2);
		expect(groups[0]).toMatchObject({
			checklistClass: "8",
			file: "scripts/lib/checks.sh",
			items: ["S1", "S2"],
			shared: true,
		});
		expect(groups[0]?.findings.map((f) => f.line)).toEqual([40, 52]);
		expect(groups[1]).toMatchObject({
			file: "web/src/a.tsx",
			items: ["S2"],
			shared: false,
		});
	});

	it("names every blocked item no question's Blocks: line holds (owner, 2026-11-20)", () =>
	{
		const questions = parseQuestions("## A: q?\nBlocks: S133, B81\n\n## B: q?\n");
		expect(uncoveredBlocked(["S133", "S129", "S107", "B81", "S129"], questions)).toEqual(["S107", "S129"]);
		expect(uncoveredBlocked([], questions)).toEqual([]);
	});

	it("finds a blocked item's branches by its whole ID", () =>
	{
		const branches = ["stage", "story/S133-redraw", "story/S1330", "story/S133", "bug/B81", "work/xS133"];
		expect(branchesNaming(branches, "S133")).toEqual(["story/S133-redraw", "story/S133"]);
		expect(branchesNaming(branches, "B81")).toEqual(["bug/B81"]);
	});

	it("orders owner questions by how many items their Blocks: line holds", () =>
	{
		const text = [
			"# Needs your input",
			"",
			"## One: blocks one?",
			"Blocks: S1",
			"",
			"## None: blocks nothing?",
			"",
			"## Three: blocks three?",
			"Blocks: S1, S2, B87",
			"",
		].join("\n");
		expect(orderQuestions(parseQuestions(text)).map((q) => [q.heading, q.blocks.length])).toEqual([["Three: blocks three?", 3], ["One: blocks one?", 1], ["None: blocks nothing?", 0]]);
	});
});

describe("CLI in a temp root", () =>
{
	let root: string;

	/** The issue cache the claims read GitHub state from (S164): S1–S9 open `status:todo` stories unless `over` says otherwise. */
	const stubCache = (over: Record<string, Partial<CachedIssue>> = {}) =>
	{
		const issues: CachedIssue[] = Array.from({
			length: 9,
		}, (_, k): CachedIssue => ({
			number: k + 1,
			title: `S${k + 1}: story`,
			state: "open",
			state_reason: null,
			labels: [{
				name: "story",
			}, {
				name: "status:todo",
			}],
			user: {
				login: "o",
			},
			body: "### Backlog fields\n\n```yaml\npriority: 1\n```\n",
			...over[`S${k + 1}`],
		}));
		for (const [id, issue] of Object.entries(over).filter(([id]) => id.startsWith("B")))
		{
			issues.push({
				number: Number(id.slice(1)),
				title: "a bug",
				state: "open",
				labels: [{
					name: "bug",
				}],
				user: {
					login: "stranger",
				},
				body: "",
				...issue,
			});
		}
		writeCache(join(root, "cache"), {
			repo: "o/r",
			trusted: ["o"],
			syncedAt: "x",
			issues,
		});
	};

	beforeEach(() =>
	{
		root = mkdtempSync(join(tmpdir(), "claims-"));
		stubCache();
	});

	afterEach(() =>
	{
		rmSync(root, {
			recursive: true,
			force: true,
		});
	});

	const cli = (args: string[], input = "") => spawnSync(process.execPath, [CLI, "--root", root, ...args], {
		encoding: "utf8",
		input,
		env: {
			PATH: process.env["PATH"] ?? "/usr/bin:/bin",
			BT_BACKLOG_CACHE: join(root, "cache"),
			// No text records: the stub cache's bodies are the items' text, never the repository's records.
			BT_AUDIT_LEDGER: join(root, "AUDIT.md"),
		},
	});

	// The run journal (S158 AC 1).
	const journal = () => JSON.parse(readFileSync(join(root, ".run", "run.json"), "utf8")) as { id: string;
		n: number;
		c: number;
		events: { kind: string;
			id?: string;
			pr?: number;
			path?: string;
			barrier?: boolean;
			at: string }[] };
	const started = () => expect(cli(["run", "start", "--n", "5", "--c", "2"]).status).toBe(0);

	it("run start writes run.json", () =>
	{
		started();
		const j = journal();
		expect(j).toMatchObject({
			n: 5,
			c: 2,
			events: [],
		});
		expect(j.id).toMatch(/^R\d{8}T\d{6}Z$/);
	});

	it("run start refuses a missing --n or --c", () =>
	{
		expect(cli(["run", "start", "--n", "5"]).status).toBe(1);
		expect(cli(["run", "start", "--c", "2"]).status).toBe(1);
		expect(existsSync(join(root, ".run", "run.json"))).toBe(false);
	});

	it("run start refuses a second run, naming the open one", () =>
	{
		started();
		const { id } = journal();
		const again = cli(["run", "start", "--n", "3", "--c", "3"]);
		expect(again.status).toBe(1);
		expect(again.stderr).toContain(id);
		expect(journal().n).toBe(5);
	});

	it("run start --resume keeps the journal and appends run-resume", () =>
	{
		started();
		expect(cli(["run", "event", "item-start", "S1"]).status).toBe(0);
		expect(cli(["run", "start", "--resume", "--c", "3"]).status).toBe(1);
		expect(cli(["run", "start", "--resume"]).status).toBe(0);
		const j = journal();
		expect(j.c).toBe(2);
		expect(j.events.map((e) => e.kind)).toEqual(["item-start", "run-resume"]);
	});

	const itemKinds = ["item-start", "needs-lead", "park", "resume", "held", "pr-open", "ready", "merged", "conflict", "duplicate", "turn-cap"];
	it.each([...itemKinds, "gate-open", "gate-close", "interrupted"])("run event %s is appended", (kind) =>
	{
		started();
		const item = itemKinds.includes(kind);
		const args = ["run", "event", kind, ...(item ? ["S3"] : []), ...(kind === "pr-open" ? ["--pr", "42"] : []), ...(kind === "conflict" ? ["--path", "docs/x.md"] : []),
			...(kind === "item-start" ? ["--barrier"] : [])];
		expect(cli(args).status).toBe(0);
		const [event] = journal().events;
		expect(event).toMatchObject({
			kind,
			...(item ? {
				id: "S3",
			} : {}),
			...(kind === "pr-open" ? {
				pr: 42,
			} : {}),
			...(kind === "conflict" ? {
				path: "docs/x.md",
			} : {}),
			...(kind === "item-start" ? {
				barrier: true,
			} : {}),
		});
		expect(Number.isNaN(Date.parse(event!.at))).toBe(false);
	});

	it("run event refuses an unknown kind", () =>
	{
		started();
		expect(cli(["run", "event", "lunch", "S1"]).status).toBe(1);
		expect(cli(["run", "event", "claim", "S1"]).status).toBe(1);
		expect(journal().events).toEqual([]);
	});

	it("run event refuses an item kind without an ID", () =>
	{
		started();
		expect(cli(["run", "event", "park"]).status).toBe(1);
	});

	it("run event refuses an ID that fails ITEM_ID", () =>
	{
		started();
		expect(cli(["run", "event", "park", "s1"]).status).toBe(1);
		expect(cli(["run", "event", "park", "../x"]).status).toBe(1);
	});

	it("run event refuses pr-open without --pr", () =>
	{
		started();
		expect(cli(["run", "event", "pr-open", "S1"]).status).toBe(1);
		expect(cli(["run", "event", "pr-open", "S1", "--pr", "x"]).status).toBe(1);
	});

	it("run event refuses conflict without --path", () =>
	{
		started();
		expect(cli(["run", "event", "conflict", "S1"]).status).toBe(1);
	});

	it("run event refuses an ID on a run kind, and any event with no run open", () =>
	{
		expect(cli(["run", "event", "gate-open"]).status).toBe(1);
		started();
		expect(cli(["run", "event", "gate-open", "S1"]).status).toBe(1);
		expect(journal().events).toEqual([]);
	});

	it("claim appends claim to the journal", () =>
	{
		started();
		expect(cli(["claim", "S1", "--file", "a.ts"]).status).toBe(0);
		expect(journal().events).toMatchObject([{
			kind: "claim",
			id: "S1",
		}]);
	});

	it("claim appends claim-refused on exit 1", () =>
	{
		started();
		expect(cli(["claim", "S1", "--file", "a.ts", "--symbol", "useX"]).status).toBe(0);
		expect(cli(["claim", "S2", "--file", "b.ts", "--symbol", "useX"]).status).toBe(1);
		expect(journal().events.map((e) => `${e.kind} ${e.id}`)).toEqual(["claim S1", "claim-refused S2"]);
	});

	it("claim without a journal writes no event", () =>
	{
		expect(cli(["claim", "S1", "--file", "a.ts"]).status).toBe(0);
		expect(existsSync(join(root, ".run", "run.json"))).toBe(false);
	});

	it("claim --dry-run writes no event", () =>
	{
		started();
		expect(cli(["claim", "S1", "--file", "a.ts", "--dry-run"]).status).toBe(0);
		expect(journal().events).toEqual([]);
	});

	it("two appends at once keep both events", async () =>
	{
		started();
		const env = {
			PATH: process.env["PATH"] ?? "/usr/bin:/bin",
		};
		const once = (id: string) => new Promise<number | null>((done) =>
		{
			spawn(process.execPath, [CLI, "--root", root, "run", "event", "item-start", id], {
				env,
			}).on("close", done);
		});
		const codes = await Promise.all(["S1", "S2", "S3", "S4"].map(once));
		expect(codes).toEqual([0, 0, 0, 0]);
		expect(journal().events.map((e) => e.id).sort()).toEqual(["S1", "S2", "S3", "S4"]);
	});

	it("claim refuses a skipped ID, quoting its problem (a story whose fields block doesn't parse)", () =>
	{
		stubCache({
			S5: {
				body: "**Gap:** no fields block",
			},
		});
		const refused = cli(["claim", "S5", "--file", "a.ts"]);
		expect(refused.status).toBe(1);
		expect(refused.stderr).toContain("S5 is skipped by the backlog");
		expect(refused.stderr).toContain("no ### Backlog fields section");
		expect(cli(["claim", "S6", "--file", "b.ts"]).status).toBe(0);
	});

	it("claim B<N> resolves the bug from GitHub state: an open status:todo issue is admitted and recorded with its issue, a closed or blocked one is refused", () =>
	{
		stubCache({
			B74: {
				labels: [{
					name: "bug",
				}, {
					name: "status:todo",
				}],
			},
			B75: {
				state: "closed",
				state_reason: "completed",
				labels: [{
					name: "bug",
				}],
			},
			B76: {
				labels: [{
					name: "bug",
				}, {
					name: "status:blocked",
				}],
			},
		});
		expect(cli(["claim", "B74", "--file", "a.ts"]).status).toBe(0);
		expect(JSON.parse(readFileSync(join(root, ".run/claims/B74.json"), "utf8")).issue).toBe(74);
		const closed = cli(["claim", "B75", "--file", "b.ts"]);
		expect(closed.status).toBe(1);
		expect(closed.stderr).toContain("closed");
		expect(cli(["claim", "B76", "--file", "c.ts"]).stderr).toContain("status:blocked");
		expect(cli(["claim", "B77", "--file", "d.ts"]).stderr).toContain("no trusted issue carries B77");
	});

	it("claim refuses a closed story and, with no cache, exits 2 saying to run pnpm backlog:sync", () =>
	{
		stubCache({
			S3: {
				state: "closed",
				state_reason: "completed",
			},
		});
		expect(cli(["claim", "S3", "--file", "a.ts"]).status).toBe(1);
		rmSync(join(root, "cache"), {
			recursive: true,
		});
		const none = cli(["claim", "S1", "--file", "a.ts"]);
		expect(none.status).toBe(2);
		expect(none.stderr).toContain("run pnpm backlog:sync");
	});

	it("writes one .run/claims/<ID>.json per admitted item and holds a conflicting one", () =>
	{
		expect(cli(["claim", "S1", "--file", "web/src/routes.tsx", "--symbol", "useThing"]).status).toBe(0);
		const held = cli(["claim", "S2", "--file", "web/src/other.tsx", "--symbol", "useThing"]);
		expect(held.status).toBe(1);
		expect(held.stdout).toContain("conflict: symbol useThing");
		expect(existsSync(join(root, ".run/claims/S2.json"))).toBe(false);
		const hot = cli(["claim", "S3", "--file", "web/src/routes.tsx"]);
		expect(hot.status).toBe(0);
		expect(readClaims(root).map((c) => [c.id, c.mergeAfter])).toEqual([["S1", []], ["S3", ["S1"]]]);
	});

	it("a claim reaching a reviewer path is a barrier", () =>
	{
		writeClaim(root, claim("S1", {
			files: ["web/src/a.tsx"],
		}));
		const r = cli(["claim", "S2", "--file", "scripts/lib/checks.sh"]);
		expect(r.status).toBe(1);
		expect(r.stdout).toContain("barrier");
	});

	it("touched and review-edits read stdin and exit 1 on a hit", () =>
	{
		writeClaim(root, claim("S1", {
			files: ["web/src/"],
		}));
		expect(cli(["touched", "S1"], "web/src/a.tsx\n").status).toBe(0);
		const out = cli(["touched", "S1"], "web/src/a.tsx\nfunctions/src/x.ts\n");
		expect(out.status).toBe(1);
		expect(out.stdout).toContain("outside the claim: functions/src/x.ts");
		expect(cli(["review-edits"], "docs/v3/backlog/stories/doing/S1.md\n").status).toBe(1);
		expect(cli(["review-edits"], "docs/v3/backlog/stories/todo/S2.md\n").status).toBe(0);
	});

	it("findings and questions read .run/findings.md and .pending/needs-input.md under the root", () =>
	{
		mkdirSync(join(root, ".run"));
		mkdirSync(join(root, ".pending"));
		writeFileSync(join(root, ".run/findings.md"), "- S1 | 8 | a.ts | x\n- S2 | 8 | a.ts:3 | y\n");
		writeFileSync(join(root, ".pending/needs-input.md"), "## A: q?\nBlocks: S1\n\n## B: q?\nBlocks: S1, S2\n");
		expect(cli(["findings"]).stdout).toContain("shared fix [8] a.ts: S1, S2");
		expect(cli(["questions"]).stdout.split("\n")[0]).toBe("2 blocked (S1, S2): B: q?");
		// Blocked items are the open issues labelled status:blocked (S164: GitHub owns state).
		const blocked = {
			labels: [{
				name: "story",
			}, {
				name: "status:blocked",
			}],
		};
		stubCache({
			S1: blocked,
			S9: blocked,
			B4: {
				labels: [{
					name: "bug",
				}, {
					name: "status:blocked",
				}],
			},
		});
		const lines = cli(["questions"]).stdout.trim().split("\n");
		expect(lines.slice(2)).toEqual(["no question: B4 is blocked", "no question: S9 is blocked"]);
		expect(cli(["release", "S1"]).status).toBe(0);
		expect(readFileSync(join(root, ".run/findings.md"), "utf8")).toContain("S1");
	});

	/** Make the temp root a git repository tracking `files` (path → text), for directory claims. */
	const repoWith = (files: Record<string, string>) =>
	{
		for (const [path, text] of Object.entries(files))
		{
			mkdirSync(dirname(join(root, path)), {
				recursive: true,
			});
			writeFileSync(join(root, path), text);
		}
		for (const args of [["init", "-q"], ["add", "-A"]])
		{
			spawnSync("git", ["-C", root, ...args]);
		}
	};

	it("a directory entry is a barrier when git tracks a reviewer path under it, with or without its trailing slash", () =>
	{
		repoWith({
			"web/vite.config.ts": "x",
			"web/src/a.ts": "x",
			"functions/src/x/drizzle.config.ts": "x",
			"functions/src/y.ts": "x",
			"docs/notes/a.md": "x",
		});
		for (const entry of ["web/", "web", "functions/src/"])
		{
			const r = cli(["claim", "S1", "--file", entry, "--dry-run"]);
			expect(r.stdout, entry).toContain("(barrier item: runs alone)");
		}
		expect(cli(["claim", "S1", "--file", "docs/notes/", "--dry-run"]).stdout).not.toContain("barrier");
		// Stored with its slash, so it covers what is under it.
		cli(["claim", "S2", "--file", "docs/notes"]);
		expect(readClaims(root)[0]?.files).toEqual(["docs/notes/"]);
	});

	it("touched flags a reviewer path under a directory claim that isn't a barrier (made after the claim)", () =>
	{
		repoWith({
			"web/src/a.ts": "x",
		});
		expect(cli(["claim", "S1", "--file", "web/"]).stdout).not.toContain("barrier");
		const r = cli(["touched", "S1"], "web/src/a.ts\nweb/vite.config.ts\n");
		expect(r.status).toBe(1);
		expect(r.stdout).toContain("reviewer path under a non-barrier claim: web/vite.config.ts");
		expect(r.stdout).not.toContain("web/src/a.ts");
	});

	it("checks the ID before touching any file: release ../../package deletes nothing", () =>
	{
		writeFileSync(join(root, "package.json"), "{}\n");
		mkdirSync(join(root, ".run/claims"), {
			recursive: true,
		});
		for (const args of [["release", "../../package"], ["release", "../package"], ["touched", "../x"], ["claim", "s1"], ["release"]])
		{
			const r = cli(args);
			expect(r.status, args.join(" ")).toBe(2);
			expect(r.stderr).toContain("not an item ID");
		}
		expect(existsSync(join(root, "package.json"))).toBe(true);
		expect(() => writeClaim(root, {
			...claim("S1", {}),
			id: "../x",
		})).toThrow(ClaimsError);
	});

	it("an unreadable claim stops every command with exit 2 and its name, never a stack trace or a skip", () =>
	{
		mkdirSync(join(root, ".run/claims"), {
			recursive: true,
		});
		writeFileSync(join(root, ".run/claims/S1.json"), "{\"id\":");
		for (const args of [["list"], ["claim", "S2", "--file", "a.ts"]])
		{
			const r = cli(args);
			expect(r.status, args.join(" ")).toBe(2);
			expect(r.stderr).toContain(".run/claims/S1.json is not a valid claim");
			expect(r.stderr).not.toContain("    at ");
		}
		// Releasing it doesn't read it, so the overseer can still clear it.
		expect(cli(["release", "S1"]).status).toBe(0);
		expect(existsSync(join(root, ".run/claims/S1.json"))).toBe(false);
	});

	it("writes a claim whole, by rename, leaving no temp file", () =>
	{
		expect(cli(["claim", "S1", "--file", "a.ts"]).status).toBe(0);
		expect(readFileSync(join(root, ".run/claims/S1.json"), "utf8")).toMatch(/^\{[\s\S]*\}\n$/);
		expect(spawnSync("ls", ["-a", join(root, ".run/claims")], {
			encoding: "utf8",
		}).stdout.split("\n").filter((n) => n.endsWith(".tmp"))).toEqual([]);
	});

	it("waits for the claims lock, then compares with what the holder wrote: two claims at once can't both be admitted", async () =>
	{
		mkdirSync(lockDir(root), {
			recursive: true,
		});
		writeFileSync(join(lockDir(root), "pid"), `${process.pid}\n`);
		const child = spawn(process.execPath, [CLI, "--root", root, "claim", "S2", "--file", "b.ts", "--symbol", "useThing"], {
			env: {
				PATH: process.env["PATH"] ?? "/usr/bin:/bin",
				BT_BACKLOG_CACHE: join(root, "cache"),
				// No text records: hermetic, never the repository's.
				BT_AUDIT_LEDGER: join(root, "AUDIT.md"),
			},
		});
		let out = "";
		child.stdout.on("data", (d: Buffer) => out += d.toString());
		const exited = new Promise<number | null>((done) => child.on("exit", (code) => done(code)));
		// The holder admits S1 with the same symbol while S2 waits, then lets go.
		await new Promise((r) => setTimeout(r, 1500));
		expect(child.exitCode).toBeNull();
		writeClaim(root, claim("S1", {
			files: ["a.ts"],
			symbols: ["useThing"],
		}));
		rmSync(lockDir(root), {
			recursive: true,
		});
		expect(await exited).toBe(1);
		expect(out).toContain("conflict: symbol useThing");
		expect(existsSync(join(root, ".run/claims/S2.json"))).toBe(false);
	}, 20_000);

	it("gives up after the wait, naming the holder's pid and whether it is alive, and never breaks the lock", () =>
	{
		mkdirSync(lockDir(root), {
			recursive: true,
		});
		const dead = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], {
			encoding: "utf8",
		}).stdout;
		writeFileSync(join(lockDir(root), "pid"), `${dead}\n`);
		expect(() => withClaimsLock(root, () => 0, 300)).toThrow(`held by pid ${dead}, which is no longer running`);
		writeFileSync(join(lockDir(root), "pid"), `${process.pid}\n`);
		expect(() => withClaimsLock(root, () => 0, 300)).toThrow(`held by pid ${process.pid}, which is still running`);
		expect(existsSync(lockDir(root))).toBe(true);
	});

	// S165 AC 5: the in-flight guards and the design gate.
	it("review-edits flags a claimed item's create and edit fragments, and only those", () =>
	{
		expect(cli(["claim", "S5", "--file", "a.ts"]).status).toBe(0);
		const changed = ["docs/v3/audit/2026-11-21/20261121T000000Z-S5-create.md", "docs/v3/audit/2026-11-21/20261121T000001Z-S5-edit.md",
			"docs/v3/audit/2026-11-21/20261121T000002Z-S6-edit.md", "docs/v3/audit/2026-11-21/20261121T000003Z-S5-review.md"].join("\n");
		const r = cli(["review-edits"], changed);
		expect(r.status).toBe(1);
		expect(r.stdout.trim().split("\n")).toEqual([
			"review edited an in-flight item's note: docs/v3/audit/2026-11-21/20261121T000000Z-S5-create.md",
			"review edited an in-flight item's note: docs/v3/audit/2026-11-21/20261121T000001Z-S5-edit.md",
		]);
		expect(cli(["review-edits"], "docs/v3/audit/2026-11-21/20261121T000002Z-S6-edit.md").status).toBe(0);
	});

	it("audit.sh edit --review refuses a claimed item (exit 1), and lets an unclaimed one through", () =>
	{
		const scripts = join(dirname(fileURLToPath(import.meta.url)), "..");
		for (const f of ["audit.sh", "lib/reverify.sh"])
		{
			mkdirSync(dirname(join(root, "scripts", f)), {
				recursive: true,
			});
			copyFileSync(join(scripts, f), join(root, "scripts", f));
		}
		mkdirSync(join(root, "docs/v3"), {
			recursive: true,
		});
		writeFileSync(join(root, "docs/v3/AUDIT.md"), "# Ledger\n\n<!-- entries below; newest last; appended by scripts/audit.sh -->\n");
		writeFileSync(join(root, "body.md"), "x\n");
		spawnSync("git", ["init", "-q"], {
			cwd: root,
		});
		expect(cli(["claim", "S5", "--file", "a.ts"]).status).toBe(0);
		const audit = (id: string) => spawnSync("bash", [join(root, "scripts/audit.sh"), "edit", id, "--review", "--body-file", "body.md", "--reason", "a review's finding"], {
			cwd: root,
			encoding: "utf8",
			env: {
				...process.env,
				BT_BACKLOG_CACHE: join(root, "cache"),
			},
		});
		const held = audit("S5");
		expect(held.status).toBe(1);
		expect(held.stderr).toContain("S5 is in flight");
		const free = audit("S6");
		expect(free.stderr).not.toContain("in flight");
	});

	it("claim refuses a UI story whose design story is open, naming it, and admits it once the design story is done", () =>
	{
		const ui = "**Gap:** a screen\n\n### Backlog fields\n\n```yaml\npriority: 1\ndesign:\n  - \"S1\"\n```\n";
		stubCache({
			S2: {
				body: ui,
			},
		});
		const held = cli(["claim", "S2", "--file", "web/x.tsx"]);
		expect(held.status).toBe(1);
		expect(held.stderr).toContain("its design story S1 (#1) is not closed completed with status:done");
		stubCache({
			S1: {
				state: "closed",
				state_reason: "completed",
				labels: [{
					name: "story",
				}, {
					name: "status:done",
				}],
			},
			S2: {
				body: ui,
			},
		});
		expect(cli(["claim", "S2", "--file", "web/x.tsx"]).status).toBe(0);
	});

	it("claim refuses a UI story whose design story is closed not_planned or has no status:done", () =>
	{
		const ui = "**Gap:** a screen\n\n### Backlog fields\n\n```yaml\npriority: 1\ndesign:\n  - \"S1\"\n```\n";
		for (const design of [{
			state: "closed",
			state_reason: "not_planned",
			labels: [{
				name: "story",
			}, {
				name: "status:done",
			}],
		}, {
			state: "closed",
			state_reason: "completed",
			labels: [{
				name: "story",
			}],
		}])
		{
			stubCache({
				S1: design,
				S2: {
					body: ui,
				},
			});
			const held = cli(["claim", "S2", "--file", "web/x.tsx"]);
			expect(held.status).toBe(1);
			expect(held.stderr).toContain("its design story S1 (#1) is not closed completed with status:done");
		}
	});
});

describe("one item ID pattern (in-flight.ts ITEM_ID)", () =>
{
	it("takes stories, bugs, shared fixes and vault stages, and nothing else", () =>
	{
		expect(inFlightIds("/nonexistent", "F1,S2,X3,B4,V5")).toEqual(["F1", "S2", "B4", "V5"]);
		expect(makeClaim("F1", {}, []).id).toBe("F1");
		expect(() => makeClaim("X1", {}, [])).toThrow(ClaimsError);
		expect(parseFindings("- F2 | 8 | a.ts | x\n- X2 | 8 | a.ts | y\n").map((f) => f.item)).toEqual(["F2"]);
	});

	it("check is strict: comma-separated IDs exactly, or empty for none", () =>
	{
		expect(invalidInFlight("")).toEqual([]);
		expect(invalidInFlight("S9,F1,B2")).toEqual([]);
		expect(invalidInFlight("s9")).toEqual(["s9"]);
		expect(invalidInFlight("S9, B2")).toEqual([" B2"]);
		expect(invalidInFlight("S9,,B2")).toEqual([""]);
		const check = (value: string) => spawnSync(process.execPath, [join(dirname(CLI), "in-flight.ts"), "check", value], {
			encoding: "utf8",
		});
		expect(check("S9,F1").status).toBe(0);
		expect(check("").status).toBe(0);
		expect(check("S9, B2").status).toBe(2);
		expect(check("S9, B2").stderr).toContain("' B2'");
	});
});
