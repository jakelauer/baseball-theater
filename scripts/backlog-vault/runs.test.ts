/**
 * runs.ts (S158 ACs 2, 3, 5 and 7): summarizeRun against hand-built journals, what counts and what is
 * clean, the next run's concurrency from the run entries, and the turn-cap hits still due.
 */

import { spawnSync } from "node:child_process";
import {
	mkdirSync, mkdtempSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	describe, expect, it,
} from "vitest";
import type { RunEvent, RunJournal } from "./claims.ts";
import type { LedgerEntry } from "./ledger.ts";
import type { RunRecord } from "./runs.ts";
import {
	concurrencyFromRuns, endReviewProblems, formatReviewState, prePrFindingsByPr, renderRunEntry, REVIEW_CEILING_ITEMS, reviewBase, reviewState, summarizeRun, unlistedTurnCaps,
} from "./runs.ts";

const T0 = Date.parse("2026-11-21T00:00:00.000Z");
const MIN = 60_000;
/** An event `m` minutes into the run. */
const ev = (kind: string, m: number, extra: Partial<RunEvent> = {}): RunEvent => ({
	kind,
	...extra,
	at: new Date(T0 + m * MIN).toISOString(),
});
const item = (kind: string, id: string, m: number, extra: Partial<RunEvent> = {}) => ev(kind, m, {
	id,
	...extra,
});
const journal = (events: RunEvent[], c = 2): RunJournal => ({
	id: "R20261121T000000Z",
	n: 10,
	c,
	startedAt: new Date(T0).toISOString(),
	events,
});
/**
 * Summarize; every pull request the events open counts 0 findings unless `findings` names it (a null there is
 * unknown), so a test about something else isn't judged on unknown findings.
 */
const sum = (events: RunEvent[], opts: { c?: number;
	findings?: Record<number, number | null>;
	earlier?: RunRecord[];
	abandoned?: boolean } = {}) => summarizeRun(journal(events, opts.c ?? 2), {
	...Object.fromEntries(events.filter((e) => e.kind === "pr-open" && e.pr !== undefined).map((e) => [e.pr!, 0])),
	...opts.findings,
}, opts.earlier ?? [], {
	abandoned: opts.abandoned ?? false,
});
/** One item's whole life: start, its pull request, ready, merged. */
const life = (id: string, pr: number, start: number, ready: number, merged: number) => [
	item("item-start", id, start), item("pr-open", id, ready, {
		pr,
	}), item("ready", id, ready), item("merged", id, merged),
];
/** A counted run at C = 2: four items, two at a time, all merged within the hour. */
const countedRun = (extra: RunEvent[] = []) => [...life("S1", 1, 0, 20, 30), ...life("S2", 2, 5, 25, 35), ...life("S3", 3, 31, 40, 50), ...life("S4", 4, 36, 45, 55), ...extra]
	.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

describe("prePrFindingsByPr (owner, 2026-11-26: \"Count pre-PR findings (Recommended)\")", () =>
{
	it("sums each item's findings events onto its pull request; a pull request whose item logged none is unknown (null), never 0", () =>
	{
		const events = [
			...countedRun(),
			item("findings", "S1", 15, {
				count: 2,
			}),
			item("findings", "S1", 18, {
				count: 1,
			}),
			item("findings", "S3", 38, {
				count: 0,
			}),
		];
		expect(prePrFindingsByPr(journal(events))).toEqual({
			1: 3,
			2: null,
			3: 0,
			4: null,
		});
		// Only the two known pull requests are averaged: (3 + 0) / 2.
		const s = sum(events, {
			findings: prePrFindingsByPr(journal(events)),
		});
		expect(s.findingsPerPr).toBe(1.5);
		expect(s.unknownFindingsPrs).toBe(2);
	});

	it("an item's findings go to its first pull request once (a later one of the same item is unknown), a pr-open logged twice is one pull request, and an item with no pull request in the run adds nothing", () =>
	{
		const events = [
			item("pr-open", "S1", 1, {
				pr: 7,
			}),
			item("findings", "S1", 2, {
				count: 4,
			}),
			item("pr-open", "S1", 3, {
				pr: 7,
			}),
			item("pr-open", "S1", 4, {
				pr: 9,
			}),
			item("findings", "S5", 5, {
				count: 6,
			}),
		];
		expect(prePrFindingsByPr(journal(events))).toEqual({
			7: 4,
			9: null,
		});
	});

	it("a pull request opened for an item an earlier run started (joined in step 0) is unknown: its findings events are in that run's journal", () =>
	{
		const events = [...countedRun(), item("findings", "S1", 15, {
			count: 1,
		}), item("pr-open", "S90", 56, {
			pr: 90,
		})];
		expect(prePrFindingsByPr(journal(events))[90]).toBeNull();
		expect(sum(events, {
			findings: prePrFindingsByPr(journal(events)),
		})).toMatchObject({
			findingsPerPr: 1,
			unknownFindingsPrs: 4,
		});
	});

	it("a run whose findings are all unknown has no findings figure, sets no bar and is not clean, even with no bar yet; its entry says unknown", () =>
	{
		const s = sum(countedRun(), {
			findings: prePrFindingsByPr(journal(countedRun())),
		});
		expect(s).toMatchObject({
			counted: true,
			findingsPerPr: null,
			unknownFindingsPrs: 4,
			clean: false,
		});
		const text = renderRunEntry(s, {
			date: "2026-11-21",
			stamp: "20261121T000000Z",
			head: "x",
		});
		expect(text).toContain("| Findings per pull request | unknown |");
		expect(text).toContain("| Pull requests with unknown findings | 4 |");
	});
});

describe("summarizeRun", () =>
{
	it("summary: a counted run's figures", () =>
	{
		const s = sum(countedRun(), {
			findings: {
				1: 1,
				3: 1,
			},
		});
		expect(s).toMatchObject({
			itemsStarted: 4,
			peak: 2,
			merged: 4,
			prs: [1, 2, 3, 4],
			findingsPerPr: 0.5,
			drain: 35 * MIN,
			counted: true,
			clean: true,
		});
		expect(s.items.find((i) => i.id === "S1")).toMatchObject({
			build: 20 * MIN,
			mergeWait: 10 * MIN,
			ownerWait: 0,
		});
	});

	it("summary: a resumed item is in flight again, and its owner wait runs park → resume", () =>
	{
		const s = sum([item("item-start", "S1", 0), item("park", "S1", 10), item("item-start", "S2", 12), item("resume", "S1", 40), item("ready", "S1", 50), item("merged", "S1", 60)]);
		expect(s.items.find((i) => i.id === "S1")).toMatchObject({
			build: 50 * MIN,
			ownerWait: 30 * MIN,
			stillParked: false,
		});
		expect(s.peak).toBe(2);
	});

	it("summary: a resume with no item-start is never in flight", () =>
	{
		expect(sum([item("resume", "S7", 0)]).peak).toBe(0);
	});

	it("summary: an interrupted-then-resumed run leaves the stopped span out of every duration", () =>
	{
		const s = sum([item("item-start", "S1", 0), ev("gate-open", 5), ev("interrupted", 10), ev("run-resume", 110), ev("gate-close", 115), item("ready", "S1", 120), item("merged", "S1", 130)]);
		expect(s.items[0]).toMatchObject({
			build: 20 * MIN,
			mergeWait: 10 * MIN,
		});
		expect(s.gate).toBe(10 * MIN);
	});

	it("summary: a barrier is started but never in the non-barrier peak", () =>
	{
		const s = sum([item("item-start", "S1", 0, {
			barrier: true,
		}), item("item-start", "S2", 1)]);
		expect(s.itemsStarted).toBe(2);
		expect(s.peak).toBe(1);
		expect(s.items.find((i) => i.id === "S1")?.barrier).toBe(true);
	});

	it("summary: an item parked to the end waits on the owner until the run's end, listed as still parked", () =>
	{
		const s = sum([item("item-start", "S1", 0), item("park", "S1", 10), item("item-start", "S2", 11), item("ready", "S2", 70), item("merged", "S2", 90)]);
		expect(s.items.find((i) => i.id === "S1")).toMatchObject({
			ownerWait: 80 * MIN,
			stillParked: true,
			build: null,
		});
	});

	it("summary: a run with no pull request has no findings figure and no drain", () =>
	{
		const s = sum([item("item-start", "S1", 0), item("held", "S1", 5)]);
		expect(s.findingsPerPr).toBeNull();
		expect(s.drain).toBeNull();
		expect(s.prs).toEqual([]);
	});

	it("summary: turn-cap hits in event order", () =>
	{
		const s = sum([item("item-start", "S1", 0), item("item-start", "S2", 1), item("turn-cap", "S1", 5), item("turn-cap", "S2", 6), item("turn-cap", "S1", 9)]);
		expect(s.turnCaps).toEqual([{
			id: "S1",
			at: new Date(T0 + 5 * MIN).toISOString(),
		}, {
			id: "S2",
			at: new Date(T0 + 6 * MIN).toISOString(),
		}, {
			id: "S1",
			at: new Date(T0 + 9 * MIN).toISOString(),
		}]);
	});
});

describe("in flight", () =>
{
	it("summary: park ends flight", () =>
	{
		expect(sum([item("item-start", "S1", 0), item("park", "S1", 10), item("item-start", "S2", 11)]).peak).toBe(1);
	});

	it("summary: held ends flight", () =>
	{
		expect(sum([item("item-start", "S1", 0), item("held", "S1", 10), item("item-start", "S2", 11)]).peak).toBe(1);
	});

	it("summary: items that finish after the run stops starting keep their real build and merge wait", () =>
	{
		// Stopping starts logs nothing (run-backlog step 6), so the last items' late finishes are active time.
		const s = sum(countedRun().map((e) => (e.id === "S4" && e.kind !== "item-start" ? {
			...e,
			at: new Date(Date.parse(e.at) + 60 * MIN).toISOString(),
		} : e)));
		expect(s.items.find((i) => i.id === "S4")).toMatchObject({
			build: 69 * MIN,
			mergeWait: 10 * MIN,
		});
	});
});

describe("what counts, and what is clean", () =>
{
	it("uncounted: a leftover's ready and merged never count toward this run", () =>
	{
		// Four items start, two at a time, and all park; S99, a previous run's pull request (step 0), merges.
		const s = sum([item("item-start", "S1", 0), item("item-start", "S2", 1), item("park", "S1", 5), item("park", "S2", 6),
			item("item-start", "S3", 7), item("item-start", "S4", 8), item("park", "S3", 9), item("park", "S4", 10),
			item("ready", "S99", 11), item("merged", "S99", 12)]);
		expect(s.peak).toBe(2);
		expect(s.merged).toBe(0);
		expect(s.drain).toBeNull();
		expect(s.counted).toBe(false);
	});

	it("uncounted: at C=2, an item that overlaps only a parked one", () =>
	{
		const s = sum([item("item-start", "S1", 0), item("park", "S1", 5), ...life("S2", 2, 6, 10, 15), ...life("S3", 3, 16, 20, 25), ...life("S4", 4, 26, 30, 35)]);
		expect(s.peak).toBe(1);
		expect(s.counted).toBe(false);
	});

	it("clean: 1 finding over 3 pull requests against a stored 1/3 bar", () =>
	{
		// The bar as a run entry stores it, rounded to 3 places (runs.ts roundFindings).
		const threePrs = countedRun().filter((e) => !(e.kind === "pr-open" && e.id === "S4"));
		const s = sum(threePrs, {
			findings: {
				1: 1,
			},
			earlier: [{
				c: 2,
				counted: true,
				clean: true,
				findingsPerPr: 0.333,
			}],
		});
		expect(s.findingsPerPr).toBe(0.333);
		expect(s.clean).toBe(true);
	});

	it("clean: an earlier counted run at 3 never sets the bar", () =>
	{
		expect(sum(countedRun(), {
			findings: {
				1: 1,
			},
			earlier: [{
				c: 3,
				counted: true,
				clean: true,
				findingsPerPr: 0,
			}],
		}).clean).toBe(true);
	});

	it("uncounted: 3 items started", () =>
	{
		const three = [...life("S1", 1, 0, 20, 30), ...life("S2", 2, 5, 25, 35), ...life("S3", 3, 31, 40, 50)].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
		expect(sum(three).counted).toBe(false);
	});

	it("uncounted: a non-barrier peak below C", () =>
	{
		const oneAtATime = [...life("S1", 1, 0, 10, 15), ...life("S2", 2, 16, 20, 25), ...life("S3", 3, 26, 30, 35), ...life("S4", 4, 36, 40, 45)];
		expect(sum(oneAtATime).peak).toBe(1);
		expect(sum(oneAtATime).counted).toBe(false);
	});

	it("uncounted: no pull request merged", () =>
	{
		expect(sum(countedRun().filter((e) => e.kind !== "merged")).counted).toBe(false);
	});

	it("uncounted: an abandoned run", () =>
	{
		const s = sum(countedRun(), {
			abandoned: true,
		});
		expect(s.counted).toBe(false);
		expect(s.clean).toBe(false);
	});

	it("clean: the first counted run at 2, with findings", () =>
	{
		expect(sum(countedRun(), {
			findings: {
				1: 3,
			},
		}).clean).toBe(true);
	});

	it("not clean: more findings per pull request than the lowest earlier counted run at 2", () =>
	{
		const earlier: RunRecord[] = [{
			c: 2,
			counted: true,
			clean: true,
			findingsPerPr: 0.25,
		}, {
			c: 2,
			counted: true,
			clean: true,
			findingsPerPr: 1,
		}, {
			c: 2,
			counted: false,
			clean: false,
			findingsPerPr: 0,
		}];
		expect(sum(countedRun(), {
			findings: {
				1: 1,
			},
			earlier,
		}).clean).toBe(true);
		expect(sum(countedRun(), {
			findings: {
				1: 2,
			},
			earlier,
		}).clean).toBe(false);
		// The bar only falls: after a counted run with 0, a later run is clean on this point only with 0.
		expect(sum(countedRun(), {
			findings: {
				1: 1,
			},
			earlier: [...earlier, {
				c: 2,
				counted: true,
				clean: true,
				findingsPerPr: 0,
			}],
		}).clean).toBe(false);
	});

	it("not clean: a record conflict", () =>
	{
		expect(sum(countedRun([item("conflict", "S2", 34, {
			path: "docs/v3/backlog/frame/01 Current baseline.md",
		})])).clean).toBe(false);
	});

	it("not clean: a duplicate implementation", () =>
	{
		expect(sum(countedRun([item("duplicate", "S3", 44)])).clean).toBe(false);
	});

	it("not clean: a 3-hour active drain", () =>
	{
		const slow = countedRun().map((e) => (e.kind === "merged" && e.id === "S4" ? item("merged", "S4", 20 + 180) : e));
		const s = sum(slow);
		expect(s.drain).toBe(180 * MIN);
		expect(s.counted).toBe(true);
		expect(s.clean).toBe(false);
	});

	it("clean: an interrupted gap over 3 hours, with an active drain under", () =>
	{
		const s = sum(countedRun([ev("interrupted", 26), ev("run-resume", 26 + 240)]).map((e) =>
		{
			const m = (Date.parse(e.at) - T0) / MIN;
			return m > 26 && !["interrupted", "run-resume"].includes(e.kind) ? {
				...e,
				at: new Date(T0 + (m + 240) * MIN).toISOString(),
			} : e;
		}));
		expect(s.drain).toBe(35 * MIN);
		expect(s.clean).toBe(true);
	});

	it("clean: a claim-refused event is the admission check working, never a duplicate", () =>
	{
		const s = sum(countedRun([item("claim-refused", "S3", 6)]));
		expect(s.duplicates).toBe(0);
		expect(s.clean).toBe(true);
	});
});

describe("reviewState: the review tracker and its ceiling inside a run (run-backlog step 2)", () =>
{
	const score = (m: number, review: "backlog" | "parity", value: number, threshold: number, id?: string) => ev("review-score", m, {
		review,
		score: value,
		threshold,
		due: value >= threshold,
		reason: `focus at ${m}`,
		...(id ? {
			id,
		} : {}),
	});
	const merges = (n: number, from: number, prefix = "S") => Array.from({
		length: n,
	}, (_, k) => item("merged", `${prefix}${100 + k}`, from + k));

	it("not due with nothing scored, nothing merged and nothing changed", () =>
	{
		const s = reviewState(journal([]), "backlog", []);
		expect(s.due).toBe(false);
		expect(s.latest).toBeUndefined();
		expect(s.ceiling).toEqual([]);
	});

	it("the newest score for that review decides: due once it crosses its threshold, not due once a later score falls back", () =>
	{
		expect(reviewState(journal([score(1, "backlog", 8, 7, "S1")]), "backlog", []).due).toBe(true);
		expect(reviewState(journal([score(1, "backlog", 8, 7), score(2, "backlog", 3, 7)]), "backlog", []).due).toBe(false);
		// The other review's score is not this one's.
		expect(reviewState(journal([score(1, "parity", 9, 5)]), "backlog", []).due).toBe(false);
		expect(reviewState(journal([score(1, "parity", 9, 5)]), "parity", []).latest?.score).toBe(9);
	});

	it("a review-start clears the scores and merges before it, for that review only", () =>
	{
		const events = [score(1, "backlog", 9, 5), score(1, "parity", 9, 5), ...merges(REVIEW_CEILING_ITEMS, 2), ev("review-start", 20, {
			review: "backlog",
		})];
		const backlog = reviewState(journal(events), "backlog", []);
		expect(backlog.due).toBe(false);
		expect(backlog.merged).toEqual([]);
		const parity = reviewState(journal(events), "parity", []);
		expect(parity.due).toBe(true);
		expect(parity.ceiling[0]).toContain(`${REVIEW_CEILING_ITEMS} stories merged`);
	});

	it(`the ceiling forces the review at ${REVIEW_CEILING_ITEMS} merged items whatever the score, one short is not due; bugs never count`, () =>
	{
		expect(reviewState(journal([...merges(REVIEW_CEILING_ITEMS - 1, 1), score(30, "backlog", 0, 9)]), "backlog", []).due).toBe(false);
		expect(reviewState(journal([...merges(REVIEW_CEILING_ITEMS, 1), score(30, "backlog", 0, 9)]), "backlog", []).due).toBe(true);
		expect(reviewState(journal([...merges(REVIEW_CEILING_ITEMS - 1, 1), ...merges(5, 20, "B")]), "backlog", []).due).toBe(false);
		// Only stories count (owner, 2026-11-24: "Keep bugs out (Recommended)"); a fix item is tooling, which the rule ceiling covers.
		expect(reviewState(journal([...merges(REVIEW_CEILING_ITEMS - 1, 1), ...merges(3, 20, "F")]), "backlog", []).due).toBe(false);
		// One item merged twice (a follow-up) is one item.
		expect(reviewState(journal([...merges(REVIEW_CEILING_ITEMS - 1, 1), item("merged", "S100", 30)]), "backlog", []).merged).toHaveLength(REVIEW_CEILING_ITEMS - 1);
	});

	it("any rule, ADR or gate change the caller passes forces it, whatever the score", () =>
	{
		const s = reviewState(journal([score(1, "backlog", 1, 9)]), "backlog", ["CLAUDE.md"]);
		expect(s.due).toBe(true);
		expect(s.ceiling).toEqual(["CLAUDE.md changed"]);
	});

	it("formatReviewState says due or not, the newest score with its reason, and the ceiling's state", () =>
	{
		const text = formatReviewState("R1", reviewState(journal([item("merged", "S5", 1), score(2, "backlog", 4, 7, "S5")]), "backlog", ["docs/v3/LOOP.md"]));
		expect(text).toContain("inside run R1, the backlog review is due");
		expect(text).toContain("newest score is 4/10 against its threshold 7, after S5");
		expect(text).toContain("focus at 2");
		expect(text).toContain(`1 of ${REVIEW_CEILING_ITEMS} stories merged since it last ran in this run (S5)`);
		expect(text).toContain("ceiling reached: docs/v3/LOOP.md changed");
		expect(formatReviewState("R1", reviewState(journal([]), "parity", []))).toContain("doc parity review is not due");
	});
});

describe("reviewBase and endReviewProblems: the ceiling's baseline and the end-of-run reviews", () =>
{
	const entry = (review: "backlog" | "parity", stamp: string, kind: LedgerEntry["kind"] = "review"): LedgerEntry => ({
		file: `audit/2026-11-21/${stamp}-${review}-${kind === "review" ? "review" : "skip"}.md`,
		date: "2026-11-21",
		kind,
		review,
	} as LedgerEntry);
	const start = (m: number, review: "backlog" | "parity", base?: string) => ev("review-start", m, {
		review,
		...(base ? {
			base,
		} : {}),
	});
	// Minute 60 is 01:00Z: stamps 20261121T010000Z.
	const merged = (id: string, m: number) => item("merged", id, m);

	it("reviewBase: nothing before the first start (or a start with no base); else the newest start's base, logged once a verdict is stamped after it", () =>
	{
		expect(reviewBase(journal([]), "backlog", [])).toBeUndefined();
		expect(reviewBase(journal([start(10, "backlog")]), "backlog", [])).toBeUndefined();
		const j = journal([start(10, "backlog", "aaa1111"), start(60, "backlog", "bbb2222"), start(70, "parity", "ccc3333")]);
		expect(reviewBase(j, "backlog", [])).toEqual({
			base: "bbb2222",
			logged: false,
		});
		// A verdict stamped before the start, a skip after it, or the other review's verdict: not logged.
		expect(reviewBase(j, "backlog", [entry("backlog", "20261121T005900Z"), entry("backlog", "20261121T020000Z", "skip"), entry("parity", "20261121T020000Z")])!.logged).toBe(false);
		expect(reviewBase(j, "backlog", [entry("backlog", "20261121T020000Z")])!.logged).toBe(true);
	});

	it("endReviewProblems: nothing to ask when no story merged (bugs only), else both reviews must start after the last story merge and log a verdict", () =>
	{
		expect(endReviewProblems(journal([merged("B5", 10)]), [])).toEqual([]);
		const j = journal([merged("S5", 10), merged("B6", 50), start(20, "backlog", "aaa1111"), start(20, "parity", "aaa1111")]);
		expect(endReviewProblems(j, [entry("backlog", "20261121T003000Z"), entry("parity", "20261121T003000Z")])).toEqual([]);
	});

	it("endReviewProblems: a review started before the last story merged doesn't count", () =>
	{
		const j = journal([start(5, "backlog", "aaa1111"), start(20, "parity", "aaa1111"), merged("S5", 10)]);
		const problems = endReviewProblems(j, [entry("backlog", "20261121T003000Z"), entry("parity", "20261121T003000Z")]);
		expect(problems).toHaveLength(1);
		expect(problems[0]).toContain("end-of-run backlog review has not started since S5 merged");
	});

	it("endReviewProblems: a skip entry, or a verdict stamped before the start, is no verdict", () =>
	{
		const j = journal([merged("S5", 10), start(20, "backlog", "aaa1111"), start(20, "parity", "aaa1111")]);
		const problems = endReviewProblems(j, [entry("backlog", "20261121T003000Z", "skip"), entry("parity", "20261121T001500Z")]);
		expect(problems).toHaveLength(2);
		expect(problems.join("\n")).toContain("backlog review started");
		expect(problems.join("\n")).toContain("doc parity review started");
	});
});

describe("concurrencyFromRuns (newest first)", () =>
{
	const run = (c: number, clean: boolean, counted = true): RunRecord => ({
		c,
		counted,
		clean,
		findingsPerPr: 0,
	});
	it("concurrency: no entries", () => expect(concurrencyFromRuns([])).toBe(2));
	it("concurrency: one clean at 2", () => expect(concurrencyFromRuns([run(2, true)])).toBe(2));
	it("concurrency: two clean at 2", () => expect(concurrencyFromRuns([run(2, true), run(2, true)])).toBe(3));
	it("concurrency: clean then unclean at 2", () => expect(concurrencyFromRuns([run(2, false), run(2, true)])).toBe(2));
	it("concurrency: two clean at 2 with an uncounted run between", () => expect(concurrencyFromRuns([run(2, true), run(3, false, false), run(2, true)])).toBe(3));
	it("concurrency: clean at 3", () => expect(concurrencyFromRuns([run(3, true), run(2, true), run(2, true)])).toBe(3));
	it("concurrency: unclean at 3", () => expect(concurrencyFromRuns([run(3, false), run(2, true), run(2, true)])).toBe(2));
	it("concurrency: unclean at 3 then one clean at 2", () => expect(concurrencyFromRuns([run(2, true), run(3, false), run(2, true)])).toBe(2));
	it("concurrency: unclean at 3 then two clean at 2", () => expect(concurrencyFromRuns([run(2, true), run(2, true), run(3, false)])).toBe(3));
});

describe("unlistedTurnCaps", () =>
{
	const hit = (id: string, at: string) => ({
		id,
		at,
	});
	const review = (hits: { id: string;
		at: string }[], kind: LedgerEntry["kind"] = "review"): LedgerEntry => ({
		line: 1,
		date: "2026-11-21",
		kind,
		review: "backlog",
		turnCaps: hits,
		heading: "",
	});

	it("drops listed hits, merges repeats, groups by item", () =>
	{
		const due = unlistedTurnCaps([hit("S1", "a"), hit("S1", "a"), hit("S2", "b"), hit("S1", "c")], [review([hit("S2", "b")])]);
		expect([...due]).toEqual([["S1", ["a", "c"]]]);
	});

	it("ignores a hit on a bug: a bug's turn cap is never drift", () =>
	{
		expect([...unlistedTurnCaps([hit("B300", "a"), hit("S1", "b")], [])]).toEqual([["S1", ["b"]]]);
	});

	it("never clears a hit through a skip or answers entry", () =>
	{
		expect([...unlistedTurnCaps([hit("S1", "a")], [review([hit("S1", "a")], "skip"), review([hit("S1", "a")], "answers")])]).toEqual([["S1", ["a"]]]);
	});
});

describe("runs.ts concurrency (the CLI)", () =>
{
	const CLI = join(dirname(fileURLToPath(import.meta.url)), "runs.ts");
	/** A ledger holding one run entry per `[run ID, stamp, C, clean]`, written as `audit.sh run` writes them. */
	const concurrency = (runs: [string, string, number, boolean][], ended: string[] = []) =>
	{
		const dir = mkdtempSync(join(tmpdir(), "s158-runs-"));
		try
		{
			mkdirSync(join(dir, ".run", "ended"), {
				recursive: true,
			});
			for (const id of ended)
			{
				writeFileSync(join(dir, ".run", "ended", `${id}.json`), JSON.stringify(journal([])));
			}
			writeFileSync(join(dir, "AUDIT.md"), "# Ledger\n\n<!-- entries below; newest last; appended by scripts/audit.sh -->\n");
			for (const [id, stamp, c, clean] of runs)
			{
				const date = `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}`;
				mkdirSync(join(dir, "audit", date), {
					recursive: true,
				});
				const s = {
					...sum(countedRun(), {
						c,
					}),
					id,
					counted: true,
					clean,
				};
				writeFileSync(join(dir, "audit", date, `${stamp}-${id}-run.md`), renderRunEntry(s, {
					date,
					stamp,
					head: "x",
				}));
			}
			const r = spawnSync(process.execPath, [CLI, "concurrency", "--audit", join(dir, "AUDIT.md"), "--run-dir", join(dir, ".run")], {
				encoding: "utf8",
			});
			expect(r.status, r.stderr).toBe(0);
			return `${r.stdout.trim()}${r.stderr ? ` | ${r.stderr.trim()}` : ""}`;
		}
		finally
		{
			rmSync(dir, {
				recursive: true,
				force: true,
			});
		}
	};

	it("concurrency CLI reads the run entries newest first", () =>
	{
		expect(concurrency([["R20261101T000000Z", "20261101T010000Z", 2, true], ["R20261102T000000Z", "20261102T010000Z", 2, true], ["R20261103T000000Z", "20261103T010000Z", 3, false]])).toBe("2");
		expect(concurrency([["R20261101T000000Z", "20261101T010000Z", 3, false], ["R20261102T000000Z", "20261102T010000Z", 2, true], ["R20261103T000000Z", "20261103T010000Z", 2, true]])).toBe("3");
	});

	it("concurrency CLI prints 2 while an ended run has no entry in the tree, naming it", () =>
	{
		const twoClean: [string, string, number, boolean][] = [["R20261101T000000Z", "20261101T010000Z", 2, true], ["R20261102T000000Z", "20261102T010000Z", 2, true]];
		expect(concurrency(twoClean, ["R20261101T000000Z", "R20261102T000000Z"])).toBe("3");
		const out = concurrency(twoClean, ["R20261101T000000Z", "R20261102T000000Z", "R20261103T000000Z"]);
		expect(out.startsWith("2 | ")).toBe(true);
		expect(out).toContain("R20261103T000000Z");
	});

	it("concurrency CLI orders runs by when they started, so a run re-recorded later is still the oldest", () =>
	{
		// R…01's entry was re-recorded from its ended journal (audit.sh run --journal) after the two newer runs.
		expect(concurrency([["R20261102T000000Z", "20261102T010000Z", 2, true], ["R20261103T000000Z", "20261103T010000Z", 2, true], ["R20261101T000000Z", "20261104T010000Z", 3, false]])).toBe("3");
	});

	it("concurrency CLI reads a run recorded twice once, its newest entry standing", () =>
	{
		expect(concurrency([["R20261101T000000Z", "20261101T010000Z", 2, true], ["R20261102T000000Z", "20261102T010000Z", 2, false], ["R20261102T000000Z", "20261102T020000Z", 2, true]])).toBe("3");
	});
});
