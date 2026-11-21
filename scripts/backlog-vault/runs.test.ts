/**
 * runs.ts (S158 ACs 2, 3, 5 and 7): summarizeRun against hand-built journals, what counts and what is
 * clean, the next run's concurrency from the run entries, and the turn-cap hits still due.
 */

import {
	describe, expect, it,
} from "vitest";
import type { RunEvent, RunJournal } from "./claims.ts";
import type { LedgerEntry } from "./ledger.ts";
import type { RunRecord } from "./runs.ts";
import {
	concurrencyFromRuns, summarizeRun, unlistedTurnCaps,
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
const sum = (events: RunEvent[], opts: { c?: number;
	findings?: Record<number, number>;
	earlier?: RunRecord[];
	abandoned?: boolean } = {}) => summarizeRun(journal(events, opts.c ?? 2), opts.findings ?? {}, opts.earlier ?? [], {
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

describe("what counts, and what is clean", () =>
{
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

	it("never clears a hit through a skip or answers entry", () =>
	{
		expect([...unlistedTurnCaps([hit("S1", "a")], [review([hit("S1", "a")], "skip"), review([hit("S1", "a")], "answers")])]).toEqual([["S1", ["a"]]]);
	});
});
