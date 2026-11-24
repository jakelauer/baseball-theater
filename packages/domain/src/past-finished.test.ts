import {
	describe, expect, it,
} from "vitest";
import type { GameRecheckCandidate } from "./past-finished.js";
import {
	gamesDueForRecheck, isPastFinishedDay, isPastFinishedGame, RECENT_GAME_RECHECK_DAYS, recentRecheckDates,
} from "./past-finished.js";
import { SCHEDULE_MONTH_REFRESH_INTERVAL_MS } from "./schedule-refresh.js";
import type { ScheduleDay } from "./types.js";

const FINAL = {
	abstractGameState: "Final",
	codedGameState: "F",
	detailedState: "Final",
};
const SUSPENDED = {
	abstractGameState: "Live",
	codedGameState: "U",
	detailedState: "Suspended: Rain",
};

// 2026-07-05 16:00 UTC is midday on 2026-07-05 for MLB.
const NOON = new Date("2026-07-05T16:00:00Z");

function day(date: string, statuses: (typeof FINAL)[], windowMode: ScheduleDay["windowMode"] = "cache"): Pick<ScheduleDay, "date" | "games" | "windowMode">
{
	return {
		date,
		windowMode,
		games: statuses.map((status, i) => ({
			gamePk: 100 + i,
			status,
		})) as unknown as ScheduleDay["games"],
	};
}

describe("isPastFinishedDay (S212 AC 1)", () =>
{
	it("S212 AC 1 yesterday final: an all-final day before MLB's today is past and finished", () =>
	{
		expect(isPastFinishedDay(day("2026-07-04", [FINAL, FINAL]), NOON, new Set())).toBe(true);
	});

	it("S212 AC 1 today final: an all-final day that is MLB's today is not", () =>
	{
		expect(isPastFinishedDay(day("2026-07-05", [FINAL]), NOON, new Set())).toBe(false);
		expect(isPastFinishedDay(day("2026-07-06", [FINAL]), NOON, new Set())).toBe(false);
	});

	it("S212 AC 1 suspended not moved: a past day holding a suspended game that hasn't moved is not", () =>
	{
		expect(isPastFinishedDay(day("2026-07-04", [FINAL, SUSPENDED]), NOON, new Set())).toBe(false);
	});

	it("S212 AC 1 suspended moved away: a past day whose suspended game resumed and finished on a later day is", () =>
	{
		expect(isPastFinishedDay(day("2026-07-04", [FINAL, SUSPENDED]), NOON, new Set([101]))).toBe(true);
	});

	it("S212 AC 1 stored active: a past day still active (a late game in its trail) is not", () =>
	{
		expect(isPastFinishedDay(day("2026-07-04", [FINAL], "active"), NOON, new Set())).toBe(false);
	});

	it("S212 AC 1 03:00 UTC: MLB's today is still the previous date, so that date's final day is not yet past", () =>
	{
		const lateNight = new Date("2026-07-05T03:00:00Z");
		expect(isPastFinishedDay(day("2026-07-04", [FINAL]), lateNight, new Set())).toBe(false);
		expect(isPastFinishedDay(day("2026-07-03", [FINAL]), lateNight, new Set())).toBe(true);
	});

	it("an empty past day is past and finished; an empty today is not", () =>
	{
		expect(isPastFinishedDay(day("2026-07-04", []), NOON, new Set())).toBe(true);
		expect(isPastFinishedDay(day("2026-07-05", []), NOON, new Set())).toBe(false);
	});
});

describe("isPastFinishedGame (S212 AC 1)", () =>
{
	const game = (officialDate: string, status: typeof FINAL, windowMode: "active" | "cache" = "cache") => ({
		officialDate,
		status,
		windowMode,
	});

	it("S212 AC 1 game: settled, cache and before MLB's today; any one missing is not", () =>
	{
		expect(isPastFinishedGame(game("2026-07-04", FINAL), NOON)).toBe(true);
		expect(isPastFinishedGame(game("2026-07-05", FINAL), NOON)).toBe(false);
		expect(isPastFinishedGame(game("2026-07-04", FINAL, "active"), NOON)).toBe(false);
		expect(isPastFinishedGame(game("2026-07-04", SUSPENDED), NOON)).toBe(false);
		expect(isPastFinishedGame(game("2026-07-04", {
			abstractGameState: "Final",
			codedGameState: "D",
			detailedState: "Postponed: Rain",
		}), NOON)).toBe(true);
		expect(isPastFinishedGame(game("2026-07-04", FINAL), new Date("2026-07-05T03:00:00Z"))).toBe(false);
	});
});

describe("gamesDueForRecheck (S212 AC 5)", () =>
{
	const LEASE = 5 * 60 * 1000;
	const candidate = (gamePk: number, officialDate: string, extra: Partial<GameRecheckCandidate> = {}): GameRecheckCandidate => ({
		gamePk,
		officialDate,
		windowMode: "cache",
		status: FINAL,
		checkedAt: null,
		claimedAt: null,
		...extra,
	});

	it("covers the RECENT_GAME_RECHECK_DAYS dates before MLB's today", () =>
	{
		expect(RECENT_GAME_RECHECK_DAYS).toBe(7);
		expect(recentRecheckDates(NOON)).toEqual({
			from: "2026-06-28",
			to: "2026-07-04",
		});
	});

	it("picks never-checked first, then the oldest check, then the earliest gamePk; drops the rest", () =>
	{
		const due = gamesDueForRecheck([
			candidate(5, "2026-07-02", {
				checkedAt: "2026-07-04T00:00:00Z",
			}),
			candidate(4, "2026-07-03"),
			candidate(3, "2026-07-03"),
			candidate(6, "2026-07-02", {
				checkedAt: "2026-07-03T00:00:00Z",
			}),
			candidate(7, "2026-06-27"),
			candidate(8, "2026-07-05"),
			candidate(9, "2026-07-02", {
				checkedAt: "2026-07-05T12:00:00Z",
			}),
			candidate(10, "2026-07-02", {
				claimedAt: "2026-07-05T15:58:00Z",
			}),
			candidate(11, "2026-07-02", {
				status: SUSPENDED,
			}),
			candidate(12, "2026-07-02", {
				status: {
					codedGameState: "D",
					detailedState: "Postponed: Rain",
				},
			}),
		], NOON, LEASE);
		expect(due.map((game) => game.gamePk)).toEqual([3, 4, 6, 5]);
	});

	it("S212 review bounds: the date exactly 7 back and yesterday are picked, 8 back and today aren't; a claim or check exactly its span old is due, a millisecond younger isn't", () =>
	{
		const at = (ms: number) => new Date(NOON.getTime() - ms).toISOString();
		const due = gamesDueForRecheck([
			candidate(1, "2026-06-28"),
			candidate(2, "2026-07-04"),
			candidate(3, "2026-06-27"),
			candidate(4, "2026-07-05"),
			candidate(5, "2026-07-01", {
				claimedAt: at(LEASE),
			}),
			candidate(6, "2026-07-01", {
				claimedAt: at(LEASE - 1),
			}),
			candidate(7, "2026-07-01", {
				checkedAt: at(SCHEDULE_MONTH_REFRESH_INTERVAL_MS),
			}),
			candidate(8, "2026-07-01", {
				checkedAt: at(SCHEDULE_MONTH_REFRESH_INTERVAL_MS - 1),
			}),
		], NOON, LEASE);
		expect(due.map((game) => game.gamePk)).toEqual([1, 2, 5, 7]);
	});
});
