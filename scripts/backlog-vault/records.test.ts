/**
 * records.ts: a story that finished after S156 carries its own **Baseline:** line and changelog
 * fragment (or a recorded skip), and `pnpm backlog:check` fails without them (S156, ACs 6 and 7).
 */
import {
	describe, expect, it,
} from "vitest";
import { parseLedger } from "./ledger.ts";
import {
	baselineText, changelogSkipped, frozenCompletions, recordProblems,
} from "./records.ts";

const note = (id: string, status: string, ...lines: string[]) => ({
	id,
	status,
	body: ["", "**Gap:** g.", "", ...lines, "", `**Status:** \`${status}\``].join("\n"),
});
const BASELINE = "**Baseline:** the scoreboard row now says so.";

describe("baselineText and changelogSkipped", () =>
{
	it("reads a non-empty **Baseline:** line, and only that", () =>
	{
		expect(baselineText(note("S1", "done", BASELINE).body)).toBe("the scoreboard row now says so.");
		expect(baselineText(note("S1", "done", "**Baseline:**").body)).toBeUndefined();
		expect(baselineText(note("S1", "done", "Its **Baseline:** line is missing.").body)).toBeUndefined();
	});

	it("reads a recorded skip with its reason, never a bare one", () =>
	{
		expect(changelogSkipped(note("S1", "done", "**Changelog:** skip — a grader-script fix, nothing a fan would notice.").body)).toBe(true);
		expect(changelogSkipped(note("S1", "done", "**Changelog:** skip").body)).toBe(false);
		expect(changelogSkipped(note("S1", "done").body)).toBe(false);
	});
});

describe("recordProblems", () =>
{
	const frozen = frozenCompletions(parseLedger("## 2026-11-01 — S84 completed\n## 2026-11-02 — S9 verified (backfill)\n## 2026-11-03 — S85 re-verified\n"));
	const fragments = new Set(["S200"]);
	const has = (id: string) => fragments.has(id);

	it("takes the frozen ledger's completions and backfills as finished before S156, not its re-verifications", () =>
	{
		expect([...frozen].sort()).toEqual(["S84", "S9"]);
	});

	it("leaves stories the frozen ledger finished, and unfinished stories, alone", () =>
	{
		expect(recordProblems([note("S84", "done"), note("S9", "done"), note("S300", "doing"), note("S301", "todo")], frozen, has)).toEqual([]);
	});

	it("fails a later done story with neither record, naming both", () =>
	{
		const problems = recordProblems([note("S201", "done")], frozen, has);
		expect(problems).toHaveLength(2);
		expect(problems[0]).toMatch(/S201 .*no \*\*Baseline:\*\* line/);
		expect(problems[1]).toMatch(/S201 .*no changelog fragment, changelog\.d\/S201\.md/);
	});

	it("fails one with a fragment but no **Baseline:** line, and one with the line but no fragment", () =>
	{
		expect(recordProblems([note("S200", "done")], frozen, has)).toEqual([expect.stringMatching(/Baseline/)]);
		expect(recordProblems([note("S201", "done", BASELINE)], frozen, has)).toEqual([expect.stringMatching(/changelog/)]);
	});

	it("passes one with both, or with the line and a recorded skip", () =>
	{
		expect(recordProblems([note("S200", "done", BASELINE)], frozen, has)).toEqual([]);
		expect(recordProblems([note("S201", "done", BASELINE, "", "**Changelog:** skip — a grader fix.")], frozen, has)).toEqual([]);
	});
});
