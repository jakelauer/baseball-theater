/**
 * records.ts: a story that finished after S156 carries its own **Baseline:** line and changelog
 * fragment (or a recorded skip), and `pnpm backlog:check` fails without them (S156, ACs 6 and 7).
 */
import {
	describe, expect, it,
} from "vitest";
import { parseLedger } from "./ledger.ts";
import type { ChangelogState } from "./records.ts";
import {
	baselineText, frozenCompletions, recordProblems,
} from "./records.ts";

const note = (id: string, status: string, ...lines: string[]) => ({
	id,
	status,
	body: ["", "**Gap:** g.", "", ...lines, "", `**Status:** \`${status}\``].join("\n"),
});
const BASELINE = "**Baseline:** the scoreboard row now says so.";

describe("baselineText", () =>
{
	it("reads a non-empty **Baseline:** line, and only that", () =>
	{
		expect(baselineText(note("S1", "done", BASELINE).body)).toBe("the scoreboard row now says so.");
		expect(baselineText(note("S1", "done", "**Baseline:**").body)).toBeUndefined();
		expect(baselineText(note("S1", "done", "Its **Baseline:** line is missing.").body)).toBeUndefined();
	});
});

describe("recordProblems", () =>
{
	const frozen = frozenCompletions(parseLedger("## 2026-11-01 — S84 completed\n## 2026-11-02 — S9 verified (backfill)\n## 2026-11-03 — S85 re-verified\n"));
	const has = (id: string): ChangelogState => (id === "S200" ? "present" : id === "S202" ? {
		malformed: "changelog.d/S202.md: no effort",
	} : "missing");

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

	it("passes one with both (a skip fragment counts as present), and names a malformed fragment as a changelog problem", () =>
	{
		expect(recordProblems([note("S200", "done", BASELINE)], frozen, has)).toEqual([]);
		expect(recordProblems([note("S202", "done", BASELINE)], frozen, has)).toEqual(["S202's changelog fragment is malformed: changelog.d/S202.md: no effort"]);
	});
});
