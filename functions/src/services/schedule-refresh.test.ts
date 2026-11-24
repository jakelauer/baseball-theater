/**
 * S194 AC 4 and AC 6: the scheduled schedule-month refresh, against a counting fake MLB and, for the
 * upstream budget, through `HttpMlbStatsClient` with a counting `fetchImpl`. Every test runs at a
 * fixed clock in November 2026, so the window is January 2026 through December 2027.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
	ScheduleDay, ScheduleMonthCheck, Unversioned,
} from "@bt/domain";
import {
	datesBetween, SCHEDULE_MONTH_FAILED_LEASE_MS, windowMonths,
} from "@bt/domain";
import type { ScheduleRepository } from "@bt/ports";
import {
	describe, expect, it,
} from "vitest";
import { FixtureMlbStatsClient } from "../adapters/fixtures/mlb.js";
import { HttpMlbStatsClient } from "../adapters/http/mlb.js";
import {
	InMemoryGameProjectionRepository, InMemoryGameRepository, memoryScheduleStores,
} from "../adapters/memory/repos.js";
import type { IngestDeps } from "./ingest.js";
import { refreshDueScheduleMonth } from "./schedule-refresh.js";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const T0 = new Date("2026-11-09T17:00:00.000Z");
const RAW = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../fixtures/raw");
const ago = (ms: number, from: Date = T0) => new Date(from.getTime() - ms).toISOString();

/** An MLB client that counts the ranges it is asked, answering every day with no games; `hold` keeps a range's answer back until released. */
class CountingClient extends FixtureMlbStatsClient
{
	readonly ranges: [string, string][] = [];
	fail = false;
	hold: Promise<void> | null = null;

	override async fetchScheduleRange(startDate: string, endDate: string): Promise<Unversioned<ScheduleDay>[]>
	{
		this.ranges.push([startDate, endDate]);
		if (this.hold) await this.hold;
		if (this.fail) throw new Error("MLB unreachable");
		return datesBetween(startDate, endDate).map((date) => ({
			date,
			games: [],
			fetchedAt: "",
			windowMode: "cache",
		}));
	}
}

/** Memory repositories and a clock the test moves, with `mlb` behind them. */
function deps(mlb: IngestDeps["mlb"] = new CountingClient(), start: Date = T0)
{
	const clock = {
		now: start,
	};
	const ingest: IngestDeps = {
		mlb,
		...memoryScheduleStores(),
		games: new InMemoryGameRepository(),
		projections: new InMemoryGameProjectionRepository(),
		now: () => clock.now,
	};
	return {
		clock,
		ingest,
	};
}

/** Records every month of the window as checked at `at`. */
async function checkAll(schedules: ScheduleRepository, at: string): Promise<void>
{
	for (const month of windowMonths("2026-11-09")) await schedules.recordScheduleMonthCheck(month, at);
}

/** The month record of `month`, or undefined when none. */
async function record(schedules: ScheduleRepository, month: string): Promise<ScheduleMonthCheck | undefined>
{
	return (await schedules.listScheduleMonthChecks(month, month))[0];
}

describe("S194 AC 4 the scheduled refresh", () =>
{
	it("S194 AC 4 order: never checked first, then the oldest check, the earliest month on a tie; one month per call", async () =>
	{
		const mlb = new CountingClient();
		const { ingest } = deps(mlb);
		// Every month checked an hour ago but these; 2026-03 never checked.
		const older: Record<string, string> = {
			"2026-01": ago(7 * HOUR),
			"2026-02": ago(8 * HOUR),
			"2026-04": ago(9 * HOUR),
			"2026-06": ago(9 * HOUR),
		};
		for (const month of windowMonths("2026-11-09").filter((m) => m !== "2026-03")) await ingest.schedules.recordScheduleMonthCheck(month, older[month] ?? ago(HOUR));
		const picked: (string | null)[] = [];
		for (let i = 0; i < 6; i++) picked.push(await refreshDueScheduleMonth(ingest));
		expect(picked).toEqual(["2026-03", "2026-04", "2026-06", "2026-02", "2026-01", null]);
		expect(mlb.ranges).toEqual([
			["2026-03-01", "2026-03-31"],
			["2026-04-01", "2026-04-30"],
			["2026-06-01", "2026-06-30"],
			["2026-02-01", "2026-02-28"],
			["2026-01-01", "2026-01-31"],
		]);
		expect((await record(ingest.schedules, "2026-03"))?.checkedAt).toBe(T0.toISOString());
	});

	it("S194 AC 4 January 1: at 03:00 UTC on January 1 it still picks from the previous year's window (MLB's today is December 31)", async () =>
	{
		const mlb = new CountingClient();
		const { ingest } = deps(mlb, new Date("2027-01-01T03:00:00.000Z"));
		expect(await refreshDueScheduleMonth(ingest)).toBe("2026-01");
		expect(mlb.ranges).toEqual([["2026-01-01", "2026-01-31"]]);
	});

	it("S194 AC 4 recent: a month checked less than 6 h ago is never picked; one checked 6 h ago is", async () =>
	{
		const mlb = new CountingClient();
		const { ingest } = deps(mlb);
		await checkAll(ingest.schedules, ago(6 * HOUR - 1));
		expect(await refreshDueScheduleMonth(ingest)).toBeNull();
		expect(mlb.ranges).toEqual([]);
		const { ingest: other } = deps(mlb);
		for (const month of windowMonths("2026-11-09")) await other.schedules.recordScheduleMonthCheck(month, month === "2027-05" ? ago(6 * HOUR) : ago(6 * HOUR - 1));
		expect(await refreshDueScheduleMonth(other)).toBe("2027-05");
	});

	it("S194 AC 4 claimed: a month claimed by a first, unfinished call is skipped by a second call", async () =>
	{
		const mlb = new CountingClient();
		const { ingest } = deps(mlb);
		let release: () => void = () => undefined;
		mlb.hold = new Promise<void>((resolve) =>
		{
			release = resolve;
		});
		const first = refreshDueScheduleMonth(ingest);
		while (mlb.ranges.length === 0) await new Promise((resolve) => setTimeout(resolve, 0));
		const second = refreshDueScheduleMonth(ingest);
		while (mlb.ranges.length < 2) await new Promise((resolve) => setTimeout(resolve, 0));
		release();
		expect(await first).toBe("2026-01");
		expect(await second).toBe("2026-02");
		expect(mlb.ranges).toEqual([["2026-01-01", "2026-01-31"], ["2026-02-01", "2026-02-28"]]);
	});

	it("S194 AC 4 lost claim: a due month another tick claimed between the read and the claim is passed over for the next due one", async () =>
	{
		const mlb = new CountingClient();
		const { ingest } = deps(mlb);
		const base = ingest.schedules;
		// The read still lists 2026-01 as due, but its conditional claim is refused, as when another tick won it.
		ingest.schedules = {
			getByDate: (date) => base.getByDate(date),
			getWithServedBase: (date) => base.getWithServedBase(date),
			listGameCounts: (from, to) => base.listGameCounts(from, to),
			listScheduleMonthChecks: (from, to) => base.listScheduleMonthChecks(from, to),
			recordScheduleMonthCheck: (month, at) => base.recordScheduleMonthCheck(month, at),
			claimScheduleMonth: async (month, at) => month === "2026-01" ? false : base.claimScheduleMonth(month, at),
			holdScheduleMonth: (month, at) => base.holdScheduleMonth(month, at),
			upsert: (day) => base.upsert(day),
		};
		expect(await refreshDueScheduleMonth(ingest)).toBe("2026-02");
		expect(mlb.ranges).toEqual([["2026-02-01", "2026-02-28"]]);
		expect((await record(base, "2026-02"))?.checkedAt).toBe(T0.toISOString());
		expect(await record(base, "2026-01")).toBeUndefined();
	});

	it("S194 AC 4 MLB fails: no check is recorded, and the same month isn't asked again inside the lease", async () =>
	{
		const mlb = new CountingClient();
		mlb.fail = true;
		const { ingest, clock } = deps(mlb);
		expect(await refreshDueScheduleMonth(ingest)).toBe("2026-01");
		expect((await record(ingest.schedules, "2026-01"))?.checkedAt).toBeNull();
		clock.now = new Date(T0.getTime() + 4 * MINUTE);
		expect(await refreshDueScheduleMonth(ingest)).toBe("2026-02");
		clock.now = new Date(T0.getTime() + SCHEDULE_MONTH_FAILED_LEASE_MS);
		mlb.fail = false;
		expect(await refreshDueScheduleMonth(ingest)).toBe("2026-01");
		// 2026-02 failed at +4 min, so its hold runs to +34 min: 2026-01 (held to +30) comes back first.
		expect(mlb.ranges.map(([start]) => start)).toEqual(["2026-01-01", "2026-02-01", "2026-01-01"]);
		expect((await record(ingest.schedules, "2026-01"))?.checkedAt).toBe(clock.now.toISOString());
	});

	it("S194 AC 4 back-off: a month whose fill MLB failed isn't asked again for SCHEDULE_MONTH_FAILED_LEASE_MS", async () =>
	{
		const mlb = new CountingClient();
		mlb.fail = true;
		const { ingest, clock } = deps(mlb);
		// Every other month checked an hour ago, so 2026-01 is the only one due.
		for (const month of windowMonths("2026-11-09").filter((m) => m !== "2026-01")) await ingest.schedules.recordScheduleMonthCheck(month, ago(HOUR));
		expect(await refreshDueScheduleMonth(ingest)).toBe("2026-01");
		for (const minutes of [5, 10, 29])
		{
			clock.now = new Date(T0.getTime() + minutes * MINUTE);
			expect(await refreshDueScheduleMonth(ingest), `+${minutes} min`).toBeNull();
		}
		clock.now = new Date(T0.getTime() + SCHEDULE_MONTH_FAILED_LEASE_MS);
		expect(await refreshDueScheduleMonth(ingest)).toBe("2026-01");
		expect(mlb.ranges).toHaveLength(2);
	});

	it("S194 AC 4 store fails: a schedule write that fails rejects", async () =>
	{
		const { ingest } = deps();
		const base = ingest.schedules;
		ingest.schedules = {
			getByDate: (date) => base.getByDate(date),
			getWithServedBase: (date) => base.getWithServedBase(date),
			listGameCounts: (from, to) => base.listGameCounts(from, to),
			listScheduleMonthChecks: (from, to) => base.listScheduleMonthChecks(from, to),
			recordScheduleMonthCheck: (month, at) => base.recordScheduleMonthCheck(month, at),
			claimScheduleMonth: (month, at) => base.claimScheduleMonth(month, at),
			holdScheduleMonth: (month, at) => base.holdScheduleMonth(month, at),
			upsert: async () =>
			{
				throw new Error("database down");
			},
		};
		await expect(refreshDueScheduleMonth(ingest)).rejects.toThrow("database down");
		expect((await record(base, "2026-01"))?.checkedAt).toBeNull();
	});

	it("S194 AC 4 six hours: with no records, one call at each minute 0 through 359, every call succeeding, asks for each of the window's 24 months exactly once", async () =>
	{
		const mlb = new CountingClient();
		const { ingest, clock } = deps(mlb);
		for (let minute = 0; minute < 360; minute++)
		{
			clock.now = new Date(T0.getTime() + minute * MINUTE);
			await refreshDueScheduleMonth(ingest);
		}
		const asked = mlb.ranges.map(([start]) => start.slice(0, 7));
		expect(asked).toEqual(windowMonths("2026-11-09"));
		expect(asked).toHaveLength(24);
	});
});

describe("S194 AC 6 upstream budget", () =>
{
	/** `HttpMlbStatsClient` over a fake `fetchImpl` that records each URL and answers a recorded schedule. */
	function httpClient()
	{
		const urls: URL[] = [];
		const mlb = new HttpMlbStatsClient({
			now: () => T0,
			fetchImpl: async (input) =>
			{
				urls.push(new URL(String(input)));
				return new Response(readFileSync(path.join(RAW, "schedule-2026-09-05.json")));
			},
		});
		return {
			mlb,
			urls,
		};
	}

	it("S194 AC 6 one month: one call sends ceil(days in month / 7) requests, each sportId=1 over at most 7 days", async () =>
	{
		const { mlb, urls } = httpClient();
		const { ingest } = deps(mlb);
		// January (31 days) first, then February (28) while January's claim holds.
		expect(await refreshDueScheduleMonth(ingest)).toBe("2026-01");
		expect(urls).toHaveLength(Math.ceil(31 / 7));
		expect(await refreshDueScheduleMonth(ingest)).toBe("2026-02");
		expect(urls).toHaveLength(Math.ceil(31 / 7) + Math.ceil(28 / 7));
		for (const url of urls)
		{
			expect(url.searchParams.get("sportId")).toBe("1");
			const start = Date.parse(url.searchParams.get("startDate")!);
			const end = Date.parse(url.searchParams.get("endDate")!);
			expect((end - start) / (24 * HOUR)).toBeLessThanOrEqual(6);
		}
	});

	it("S194 AC 6 none due: a call with no due month sends no request and does one database read", async () =>
	{
		const { mlb, urls } = httpClient();
		const { ingest } = deps(mlb);
		await checkAll(ingest.schedules, ago(HOUR));
		const base = ingest.schedules;
		let reads = 0;
		const counted = <A extends unknown[], R>(call: (...args: A) => Promise<R>) => (...args: A) =>
		{
			reads++;
			return call(...args);
		};
		ingest.schedules = {
			getByDate: counted((date: string) => base.getByDate(date)),
			getWithServedBase: counted((date: string) => base.getWithServedBase(date)),
			listGameCounts: counted((from: string, to: string) => base.listGameCounts(from, to)),
			listScheduleMonthChecks: counted((from: string, to: string) => base.listScheduleMonthChecks(from, to)),
			recordScheduleMonthCheck: counted((month: string, at: string) => base.recordScheduleMonthCheck(month, at)),
			claimScheduleMonth: counted((month: string, at: string) => base.claimScheduleMonth(month, at)),
			holdScheduleMonth: counted((month: string, at: string) => base.holdScheduleMonth(month, at)),
			upsert: counted((day: ScheduleDay) => base.upsert(day)),
		};
		expect(await refreshDueScheduleMonth(ingest)).toBeNull();
		expect(urls).toHaveLength(0);
		expect(reads).toBe(1);
	});
});
