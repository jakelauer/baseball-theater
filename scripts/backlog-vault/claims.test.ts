/**
 * claims.ts (S156 ACs 12–14): comparing a worker's claim with the in-flight claims, the barrier check,
 * the commit-time diff against the claim, a review's edit to an in-flight note, and the overseer's
 * findings merge and question order. Pure functions get fixtures; the CLI runs in a temp root with an
 * environment built from scratch, so the real repository's `.run/` and `.pending/` are never read.
 */
import { spawnSync } from "node:child_process";
import {
	existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	afterEach, beforeEach, describe, expect, it,
} from "vitest";
import type { Claim } from "./claims.ts";
import {
	compareClaim, isBarrierPath, makeClaim, mergeFindings, orderQuestions, outsideClaim, parseFindings, parseQuestions, readClaims,
	reviewEditsToInFlight, reviewerFlags, writeClaim,
} from "./claims.ts";

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
			"docs/v3/backlog/stories/done/S7.md", "scripts/verify-S7.sh", "changelog.d/S7.md", "docs/v3/audit/2026-11-20/1200-S7-story.md",
			"docs/v3/backlog/stories/todo/S8.md",
		];
		expect(outsideClaim(c, touched)).toEqual(["packages/domain/src/inning.ts", "docs/v3/backlog/stories/todo/S8.md"]);
	});
});

describe("reviewEditsToInFlight", () =>
{
	it("a review's edit to an in-flight item's note is reported; other notes are free", () =>
	{
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

	beforeEach(() =>
	{
		root = mkdtempSync(join(tmpdir(), "claims-"));
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
		},
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
		expect(cli(["release", "S1"]).status).toBe(0);
		expect(readFileSync(join(root, ".run/findings.md"), "utf8")).toContain("S1");
	});
});
