import {
	describe, expect, it,
} from "vitest";
import {
	SCHEDULE_MONTH_CHECK_MARGIN_MS, SCHEDULE_MONTH_CLAIM_LEASE_MS, SCHEDULE_MONTH_FAILED_LEASE_MS, SCHEDULE_MONTH_REFRESH_INTERVAL_MS, scheduleMonthAnswer, scheduleMonthCheckStale,
	scheduleMonthsDue, scheduleMonthVersion,
	windowMonths,
} from "./schedule-refresh.js";

const NOW = new Date("2026-11-09T17:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

describe("the schedule-month refresh's rules (S194)", () =>
{
	it("names its interval, margin and lease", () =>
	{
		expect(SCHEDULE_MONTH_REFRESH_INTERVAL_MS).toBe(6 * HOUR);
		expect(SCHEDULE_MONTH_CHECK_MARGIN_MS).toBe(30 * MINUTE);
		expect(SCHEDULE_MONTH_CLAIM_LEASE_MS).toBe(5 * MINUTE);
	});

	it("windowMonths: January of the year through December of next year, 24 months", () =>
	{
		const months = windowMonths("2026-11-09");
		expect(months).toHaveLength(24);
		expect(months[0]).toBe("2026-01");
		expect(months[11]).toBe("2026-12");
		expect(months[12]).toBe("2027-01");
		expect(months.at(-1)).toBe("2027-12");
	});

	it("scheduleMonthCheckStale: never checked, or older than the interval plus the margin", () =>
	{
		expect(scheduleMonthCheckStale(null, NOW)).toBe(true);
		expect(scheduleMonthCheckStale(undefined, NOW)).toBe(true);
		expect(scheduleMonthCheckStale({
			checkedAt: null,
		}, NOW)).toBe(true);
		expect(scheduleMonthCheckStale({
			checkedAt: "not a time",
		}, NOW)).toBe(true);
		expect(scheduleMonthCheckStale({
			checkedAt: ago(HOUR),
		}, NOW)).toBe(false);
		expect(scheduleMonthCheckStale({
			checkedAt: ago(6 * HOUR + 30 * MINUTE),
		}, NOW)).toBe(false);
		expect(scheduleMonthCheckStale({
			checkedAt: ago(6 * HOUR + 31 * MINUTE),
		}, NOW)).toBe(true);
	});

	it("scheduleMonthsDue: never checked first, then the oldest check, the earliest month on a tie; recent checks and live claims left out", () =>
	{
		const months = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07"];
		expect(scheduleMonthsDue(months, [
			{
				month: "2026-01",
				checkedAt: ago(7 * HOUR),
				claimedAt: null,
			},
			{
				month: "2026-02",
				checkedAt: ago(9 * HOUR),
				claimedAt: ago(9 * HOUR),
			},
			{
				month: "2026-03",
				checkedAt: ago(HOUR),
				claimedAt: null,
			},
			{
				month: "2026-04",
				checkedAt: null,
				claimedAt: ago(MINUTE),
			},
			{
				month: "2026-05",
				checkedAt: ago(7 * HOUR),
				claimedAt: ago(5 * MINUTE),
			},
			{
				month: "2026-06",
				checkedAt: "garbage",
				claimedAt: "garbage",
			},
		], NOW)).toEqual(["2026-06", "2026-07", "2026-02", "2026-01", "2026-05"]);
	});

	it("scheduleMonthVersion: the content hash of the whole answer, unchanged by key order, changed by any count or another month", () =>
	{
		const days = [{
			date: "2026-04-01",
			count: 3,
			teamIds: [1, 2],
			regularSeason: true,
			regularSeasonTeamIds: [1, 2],
			inSeasonTeamIds: [1, 2],
		}];
		const same = [{
			inSeasonTeamIds: [1, 2],
			regularSeasonTeamIds: [1, 2],
			regularSeason: true,
			teamIds: [1, 2],
			count: 3,
			date: "2026-04-01",
		}];
		expect(scheduleMonthVersion(scheduleMonthAnswer("2026-04", days))).toBe(scheduleMonthVersion(scheduleMonthAnswer("2026-04", same)));
		expect(scheduleMonthVersion(scheduleMonthAnswer("2026-04", days))).not.toBe(scheduleMonthVersion(scheduleMonthAnswer("2026-04", [{
			...days[0]!,
			count: 4,
		}])));
		expect(scheduleMonthVersion(scheduleMonthAnswer("2026-04", days))).not.toBe(scheduleMonthVersion(scheduleMonthAnswer("2026-05", days)));
		expect(SCHEDULE_MONTH_FAILED_LEASE_MS).toBe(30 * MINUTE);
	});
});
