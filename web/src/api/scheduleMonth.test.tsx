/**
 * S125 AC 2 and AC 8: the one month hook, and which months it may ask for; and its freshness (#399):
 * a month whose days are known is kept for five minutes, but one whose days BT couldn't say (a fill
 * that failed) is asked again on the next read, so the calendar doesn't hold a month with no game
 * labels for five minutes.
 */
import {
	describe, expect, it, vi,
} from "vitest";
import { createQueryClient } from "./queryClient.js";
import type { ScheduleMonthPayload } from "./scheduleMonth.js";
import {
	scheduleMonthAnswerable, scheduleMonthKey, scheduleMonthQueryOptions,
} from "./scheduleMonth.js";

describe("scheduleMonth (S125)", () =>
{
	const now = new Date("2026-09-21T16:00:00Z");

	it.each([
		["1901-04", true],
		["2026-09", true],
		["2027-12", true],
		["1901-03", false],
		["1850-01", false],
		["2028-01", false],
		["2099-07", false],
		["2026-13", false],
	])("S125 AC 8: %s answerable: %s", (month, answerable) =>
	{
		expect(scheduleMonthAnswerable(month, now)).toBe(answerable);
	});

	it("S125 AC 2: one key per month, and a month S124 can't answer is never fetched", () =>
	{
		expect(scheduleMonthKey("2026-09")).toEqual(["schedule-month", "2026-09"]);
		expect(scheduleMonthQueryOptions("2026-09").enabled).toBe(true);
		expect(scheduleMonthQueryOptions("1850-01").enabled).toBe(false);
	});
});

/** A June 2026 answer whose every day has `count` (and teams and season flag to match). */
function june(count: number | null): ScheduleMonthPayload
{
	return {
		month: "2026-06",
		days: Array.from({
			length: 30,
		}, (_, i) => ({
			date: `2026-06-${String(i + 1).padStart(2, "0")}`,
			count,
			teamIds: count === null ? null : [],
			regularSeason: count === null ? null : false,
		})),
	};
}

/** How many requests two reads make, `apart` ms apart, when every request answers `payload`. */
async function requestsForTwoReads(payload: ScheduleMonthPayload, apart: number): Promise<number>
{
	vi.useFakeTimers({
		toFake: ["Date"],
	});
	try
	{
		const client = createQueryClient();
		const queryFn = vi.fn(async () => payload);
		const options = {
			...scheduleMonthQueryOptions("2026-06"),
			queryFn,
		};
		await client.fetchQuery(options);
		vi.setSystemTime(Date.now() + apart);
		await client.fetchQuery(options);
		return queryFn.mock.calls.length;
	}
	finally
	{
		vi.useRealTimers();
	}
}

/** June 2026 with its 3rd stored (three games) and every other day unknown: a fill that failed around one held day. */
function partlyKnown(): ScheduleMonthPayload
{
	const month = june(null);
	month.days[2] = {
		...month.days[2]!,
		count: 3,
		teamIds: [],
		regularSeason: true,
	};
	return month;
}

const SECOND = 1000;

describe("schedule month freshness (#399)", () =>
{
	it("a month with unknown days is asked again a minute later, not held as a month with no game labels for five (#399)", async () =>
	{
		expect(await requestsForTwoReads(june(null), 61 * SECOND)).toBe(2);
	});

	it("a month only partly known is asked again a minute later too (#399)", async () =>
	{
		expect(await requestsForTwoReads(partlyKnown(), 61 * SECOND)).toBe(2);
	});

	it("a month with unknown days is not asked again within the minute, so focus and remounts don't hammer the API (#399)", async () =>
	{
		expect(await requestsForTwoReads(june(null), 30 * SECOND)).toBe(1);
	});

	it("a month whose days are known is read from the cache for five minutes", async () =>
	{
		expect(await requestsForTwoReads(june(0), 61 * SECOND)).toBe(1);
		expect(await requestsForTwoReads(june(3), 61 * SECOND)).toBe(1);
	});
});
