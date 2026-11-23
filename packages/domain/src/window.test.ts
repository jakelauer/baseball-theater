import { readFileSync } from "node:fs";
import {
	describe, expect, it,
} from "vitest";
import { gamePhase, type GamePhase } from "./game-phase.js";
import {
	DEFAULT_CADENCE,
	isFinalStatus,
	isGameInActiveWindow,
	isLiveStatus,
	isSuspendedStatus,
	normalizeStatusCode,
	scheduleWindowMode,
} from "./window.js";
import type { ScheduleGameSummary } from "./types.js";

type WindowGame = Pick<ScheduleGameSummary, "officialDate" | "status"> & {
	gameDateTime?: string | null;
};

function game(codedGameState: string, gameDateTime?: string | null): WindowGame
{
	return {
		officialDate: "2024-07-04",
		status: {
			abstractGameState: "Preview",
			codedGameState,
			detailedState: "Scheduled",
		},
		gameDateTime,
	};
}

describe("isLiveStatus", () =>
{
	it("treats in-progress, a challenge or review, and a suspended game as live (#74, #79)", () =>
	{
		for (const code of ["I", "M", "N", "T", "U"]) expect(isLiveStatus(code), code).toBe(true);
	});

	it("treats pre-game warm-up and postponements (`D`, #72) as not live (no Live tab)", () =>
	{
		expect(isLiveStatus("P")).toBe(false);
		expect(isLiveStatus("D")).toBe(false);
	});

	it("rejects scheduled and final codes", () =>
	{
		expect(isLiveStatus("S")).toBe(false);
		expect(isLiveStatus("F")).toBe(false);
		expect(isLiveStatus("X")).toBe(false);
	});
});

describe("isFinalStatus", () =>
{
	it("treats final, game over, and cancelled as final", () =>
	{
		expect(isFinalStatus("F")).toBe(true);
		expect(isFinalStatus("O")).toBe(true);
		expect(isFinalStatus("C")).toBe(true);
	});

	it("rejects live and scheduled codes", () =>
	{
		expect(isFinalStatus("I")).toBe(false);
		expect(isFinalStatus("S")).toBe(false);
	});
});

describe("normalizeStatusCode", () =>
{
	it("returns MLB's unknown, 'X', for codes MLB doesn't list (#81)", () =>
	{
		expect(normalizeStatusCode("Z")).toBe("X");
		expect(normalizeStatusCode("live")).toBe("X");
	});

	it("returns 'X' for missing values", () =>
	{
		expect(normalizeStatusCode(undefined)).toBe("X");
		expect(normalizeStatusCode(null)).toBe("X");
		expect(normalizeStatusCode("")).toBe("X");
	});

	it("uppercases and passes through known codes", () =>
	{
		expect(normalizeStatusCode("i")).toBe("I");
		expect(normalizeStatusCode("F")).toBe("F");
		expect(normalizeStatusCode("s")).toBe("S");
	});
});

describe("isGameInActiveWindow", () =>
{
	it("keeps live games in the window regardless of clock", () =>
	{
		const farFromStart = new Date("2024-07-10T09:00:00.000Z");
		expect(
			isGameInActiveWindow(game("I", "2024-07-04T23:05:00.000Z"), farFromStart),
		).toBe(true);
	});

	it("keeps polling a delayed game past the trail: MLB codes a delay `I` (#72)", () =>
	{
		const delayed = {
			...game("I", "2024-07-04T23:05:00.000Z"),
			status: {
				abstractGameState: "Live",
				codedGameState: "I",
				detailedState: "Delayed: Rain",
			},
		};
		expect(isGameInActiveWindow(delayed, new Date("2024-07-05T09:00:00.000Z"))).toBe(true);
	});

	it("keeps a game under a manager challenge (`M`) or umpire review (`N`) live and polled past the trail (#74)", () =>
	{
		for (const [code, detailedState] of [["M", "Manager challenge"], ["N", "Umpire review"]] as const)
		{
			const reviewing = {
				...game(code, "2024-07-04T23:05:00.000Z"),
				status: {
					abstractGameState: "Live",
					codedGameState: code,
					detailedState,
				},
			};
			expect(isLiveStatus(code)).toBe(true);
			expect(normalizeStatusCode(code)).toBe(code);
			expect(isGameInActiveWindow(reviewing, new Date("2024-07-05T09:00:00.000Z"))).toBe(true);
		}
	});

	it("drops a postponed game (`D`) before, during and after its scheduled time (#72)", () =>
	{
		const postponed = {
			...game("D", "2024-07-04T23:05:00.000Z"),
			status: {
				abstractGameState: "Final",
				codedGameState: "D",
				detailedState: "Postponed: Rain",
			},
		};
		expect(isGameInActiveWindow(postponed, new Date("2024-07-04T21:30:00.000Z"))).toBe(false);
		expect(isGameInActiveWindow(postponed, new Date("2024-07-04T23:30:00.000Z"))).toBe(false);
		expect(isGameInActiveWindow(postponed, new Date("2024-07-05T09:00:00.000Z"))).toBe(false);
	});

	it("keeps a final game in the window while inside the trail", () =>
	{
		// No gameDateTime -> assumed start 17:00Z, assumed end 21:00Z, trail 3h -> 00:00Z.
		const insideTrail = new Date("2024-07-04T23:00:00.000Z");
		expect(isGameInActiveWindow(game("F"), insideTrail)).toBe(true);
	});

	it("drops a final game once the trail has elapsed", () =>
	{
		const afterTrail = new Date("2024-07-05T02:00:00.000Z");
		expect(isGameInActiveWindow(game("F"), afterTrail)).toBe(false);
	});

	it("measures a final game's trail from its known end when that is later than the assumed one (S150)", () =>
	{
		// Assumed end 21:00Z; the game really ended at 03:00Z after a delay, so its trail runs to 06:00Z.
		const late = {
			...game("F"),
			endedAt: "2024-07-05T03:00:00.000Z",
		};
		expect(isGameInActiveWindow(late, new Date("2024-07-05T06:00:00.000Z"))).toBe(true);
		expect(isGameInActiveWindow(late, new Date("2024-07-05T06:00:00.001Z"))).toBe(false);
		// An end earlier than the assumed one never shortens the trail; one that doesn't parse is ignored.
		expect(isGameInActiveWindow({
			...game("F"),
			endedAt: "2024-07-04T18:00:00.000Z",
		}, new Date("2024-07-04T23:00:00.000Z"))).toBe(true);
		expect(isGameInActiveWindow({
			...game("F"),
			endedAt: "garbage",
		}, new Date("2024-07-05T02:00:00.000Z"))).toBe(false);
		// Only a final game's trail reads it.
		expect(isGameInActiveWindow({
			...game("S"),
			endedAt: "2024-07-05T03:00:00.000Z",
		}, new Date("2024-07-05T05:00:00.000Z"))).toBe(false);
	});

	it("keeps a scheduled game in the window inside the lead hours", () =>
	{
		// Start 23:05Z, lead 2h -> window opens 21:05Z.
		const insideLead = new Date("2024-07-04T22:00:00.000Z");
		expect(isGameInActiveWindow(game("S", "2024-07-04T23:05:00.000Z"), insideLead)).toBe(
			true,
		);
	});

	it("drops a scheduled game far before the lead window", () =>
	{
		const longBefore = new Date("2024-07-04T12:00:00.000Z");
		expect(isGameInActiveWindow(game("S", "2024-07-04T23:05:00.000Z"), longBefore)).toBe(
			false,
		);
	});

	it("drops a scheduled game far after the trail window", () =>
	{
		const longAfter = new Date("2024-07-05T09:00:00.000Z");
		expect(isGameInActiveWindow(game("S", "2024-07-04T23:05:00.000Z"), longAfter)).toBe(
			false,
		);
	});

	it("honors custom cadence leadHours and trailHours", () =>
	{
		const start = "2024-07-04T23:05:00.000Z";

		// leadHours: 18:00Z is outside default 2h lead, inside 8h lead.
		const beforeStart = new Date("2024-07-04T18:00:00.000Z");
		expect(isGameInActiveWindow(game("S", start), beforeStart, DEFAULT_CADENCE)).toBe(
			false,
		);
		expect(
			isGameInActiveWindow(game("S", start), beforeStart, {
				...DEFAULT_CADENCE,
				leadHours: 8,
				trailHours: 3,
			}),
		).toBe(true);

		// trailHours (scheduled path): start+trail. Default trail ends 02:05Z;
		// trailHours:1 ends 00:05Z — 01:00Z distinguishes them.
		const afterStart = new Date("2024-07-05T01:00:00.000Z");
		expect(
			isGameInActiveWindow(game("S", start), afterStart, {
				...DEFAULT_CADENCE,
				leadHours: 2,
				trailHours: 3,
			}),
		).toBe(true);
		expect(
			isGameInActiveWindow(game("S", start), afterStart, {
				...DEFAULT_CADENCE,
				leadHours: 2,
				trailHours: 1,
			}),
		).toBe(false);

		// trailHours (final path): assumedEnd = start+4h = 03:05Z; +trailHours.
		// Default trail still active at 05:00Z; trailHours:1 is not.
		const afterFinalAssumedEnd = new Date("2024-07-05T05:00:00.000Z");
		expect(
			isGameInActiveWindow(game("F", start), afterFinalAssumedEnd, {
				...DEFAULT_CADENCE,
				leadHours: 2,
				trailHours: 3,
			}),
		).toBe(true);
		expect(
			isGameInActiveWindow(game("F", start), afterFinalAssumedEnd, {
				...DEFAULT_CADENCE,
				leadHours: 2,
				trailHours: 1,
			}),
		).toBe(false);
	});

	it("falls back to the official date when no start time is known", () =>
	{
		// Assumed start 17:00Z, lead 2h -> window opens 15:00Z.
		expect(
			isGameInActiveWindow(game("S", null), new Date("2024-07-04T16:00:00.000Z")),
		).toBe(true);
		expect(isGameInActiveWindow(game("S"), new Date("2024-07-04T10:00:00.000Z"))).toBe(
			false,
		);
	});

	it("skips a start time that cannot be parsed and falls back to the official date", () =>
	{
		// Fallback 17:00Z: in at 16:00Z, out at 22:00Z.
		expect(isGameInActiveWindow(game("S", "not-a-date"), new Date("2024-07-04T16:00:00.000Z"))).toBe(true);
		expect(isGameInActiveWindow(game("S", "not-a-date"), new Date("2024-07-04T22:00:00.000Z"))).toBe(false);
	});

	it("an unparseable startTime doesn't mask a valid ISO gameDate", () =>
	{
		const placeholder = {
			officialDate: "2024-07-04",
			startTime: "TBD",
			gameDate: "2024-07-04T23:05:00Z",
			status: {
				codedGameState: "S",
			} as ScheduleGameSummary["status"],
		};
		expect(isGameInActiveWindow(placeholder, new Date("2024-07-04T21:10:00Z"))).toBe(true);
		expect(isGameInActiveWindow(placeholder, new Date("2024-07-04T20:55:00Z"))).toBe(false);
	});

	it("returns false when the official date itself cannot be parsed", () =>
	{
		expect(isGameInActiveWindow({
			...game("S"),
			officialDate: "unknown",
		}, new Date("2024-07-04T16:00:00.000Z"))).toBe(false);
	});

	it("treats an unknown status code as scheduled for windowing", () =>
	{
		const start = "2024-07-04T23:05:00.000Z";
		// Far outside lead/trail: live would still be true; scheduled/unknown must be false.
		const farAway = new Date("2024-07-10T09:00:00.000Z");
		expect(isGameInActiveWindow(game("I", start), farAway)).toBe(true);
		expect(isGameInActiveWindow(game("XX", start), farAway)).toBe(false);
		// Inside lead still active (same as scheduled).
		const insideLead = new Date("2024-07-04T22:00:00.000Z");
		expect(isGameInActiveWindow(game("XX", start), insideLead)).toBe(true);
	});
});

describe("isGameInActiveWindow reads the schedule's own start time", () =>
{
	// Regression: the helper used to read only `gameDateTime`, which no
	// production type carries — every real ScheduleGameSummary fell back to the
	// 17:00Z assumption, so a late game left the window before it ended.
	const lateGame = {
		officialDate: "2024-07-04",
		gameDate: "2024-07-04T22:30:00.000Z",
		status: {
			codedGameState: "S",
		} as ScheduleGameSummary["status"],
	};

	it("keeps a late start in the window when the 17:00Z fallback would not", () =>
	{
		const during = new Date("2024-07-04T23:00:00.000Z");
		expect(isGameInActiveWindow(lateGame, during)).toBe(true);
		// Same instant, without a start time: the fallback has already trailed off.
		const { gameDate: _drop, ...noStart } = lateGame;
		expect(isGameInActiveWindow(noStart, during)).toBe(false);
	});

	it("reads startTime first and ignores a date-only gameDate (#71)", () =>
	{
		// The mappers' shape: `gameDate` is the official date alone, first pitch is `startTime`.
		const night = {
			officialDate: "2024-07-04",
			gameDate: "2024-07-04",
			startTime: "2024-07-04T23:05:00Z",
			status: {
				codedGameState: "S",
			} as ScheduleGameSummary["status"],
		};
		expect(isGameInActiveWindow(night, new Date("2024-07-04T21:10:00Z"))).toBe(true);
		expect(isGameInActiveWindow(night, new Date("2024-07-04T20:55:00Z"))).toBe(false);
		// Without startTime the bare date is not midnight: the 17:00Z assumption applies.
		const { startTime: _drop, ...dateOnly } = night;
		expect(isGameInActiveWindow(dateOnly, new Date("2024-07-04T16:00:00Z"))).toBe(true);
		expect(isGameInActiveWindow(dateOnly, new Date("2024-07-03T23:00:00Z"))).toBe(false);
	});
});

describe("scheduleWindowMode (S122)", () =>
{
	it("a day is active while any game is in its window, cache otherwise; params pass through", () =>
	{
		const now = new Date("2024-07-04T18:00:00Z");
		expect(scheduleWindowMode([], now)).toBe("cache");
		expect(scheduleWindowMode([game("F", "2024-07-01T17:00:00Z"), game("I", "2024-07-04T17:00:00Z")], now)).toBe("active");
		expect(scheduleWindowMode([game("F", "2024-07-01T17:00:00Z")], now)).toBe("cache");
		const later = game("S", "2024-07-04T23:00:00Z");
		expect(scheduleWindowMode([later], now, {
			...DEFAULT_CADENCE,
			leadHours: 1,
		})).toBe("cache");
		expect(scheduleWindowMode([later], now, {
			...DEFAULT_CADENCE,
			leadHours: 6,
		})).toBe("active");
	});
});

/**
 * BT's status table against MLB's full `GET /api/v1/gameStatus` list (#81), recorded in
 * `fixtures/raw/gamestatus.json`. Every `codedGameState` MLB lists must be one BT models
 * (normalizing to itself, so BT's own "unknown" never borrows a real MLB letter, as `U`
 * suspended once did), and every listing's phase must match its `abstractGameCode` group,
 * except where BT departs on purpose: warm-up (`PW`, MLB "Live") shows no Live room, a
 * postponed `D` (MLB "Final") stays pre-game (#72), and MLB's "Other" codes read as pre-game.
 * MLB's `T9` reads "Scheduled: COVID-19" but sits in its "Live" group under the suspended `T`,
 * so BT reads it as suspended, and so live.
 */
describe("MLB's full gameStatus list (#81)", () =>
{
	type MlbStatus = { abstractGameCode: string;
		codedGameState: string;
		statusCode: string;
		detailedState: string };
	const MLB_STATUSES: MlbStatus[] = JSON.parse(readFileSync(new URL("../../../fixtures/raw/gamestatus.json", import.meta.url), "utf8"));
	const BY_GROUP: Record<string, GamePhase> = {
		P: "pregame",
		L: "live",
		F: "final",
		O: "pregame",
	};
	/** BT's departures from MLB's group, by `statusCode` (one listing) or `codedGameState` (every listing of the code). */
	const ON_PURPOSE: Record<string, GamePhase> = {
		PW: "pregame",
		D: "pregame",
	};

	it.each(MLB_STATUSES.map((status) => [status.statusCode, status.detailedState, status] as const))("%s (%s) maps as MLB groups it", (_statusCode, _state, status) =>
	{
		const coded = status.codedGameState;
		const expected = ON_PURPOSE[status.statusCode] ?? ON_PURPOSE[coded] ?? BY_GROUP[status.abstractGameCode];
		expect(normalizeStatusCode(coded), `${status.detailedState} is modeled`).toBe(coded);
		for (const code of [coded, coded.toLowerCase()])
		{
			expect(gamePhase(code), `${status.detailedState} (${code})`).toBe(expected);
			expect(isLiveStatus(code)).toBe(expected === "live");
			expect(isFinalStatus(code)).toBe(expected === "final");
		}
	});

	it("reads a missing or unlisted code as MLB's own unknown (`X`), never as suspended `U`", () =>
	{
		expect(normalizeStatusCode(undefined)).toBe("X");
		expect(normalizeStatusCode("Z")).toBe("X");
		expect(gamePhase("Z")).toBe("pregame");
	});
});

/**
 * A suspended game (`T`/`U`, #79) is polled for `suspendedHours` from when BT saw it turn
 * suspended (owner, 2026-11-22: "From when it was suspended (Recommended)"), or, with no such
 * time, from first pitch; the first-pitch window (with its lead) holds either way.
 */
describe("a suspended game's window (#79, #323)", () =>
{
	const HOUR = 60 * 60 * 1000;
	function suspended(code: string, suspendedAt?: string | null, startTime = "2026-07-04T23:05:00Z")
	{
		return {
			officialDate: "2026-07-04",
			startTime,
			suspendedAt,
			status: {
				abstractGameState: "Live",
				codedGameState: code,
				detailedState: "Suspended: Rain",
			},
		};
	}

	it("late suspension: suspended at 05:10Z after a 23:05Z first pitch, it stays polled until 11:10:00.000Z and not a millisecond longer", () =>
	{
		for (const code of ["T", "U"])
		{
			const game = suspended(code, "2026-07-05T05:10:00.000Z");
			expect(isGameInActiveWindow(game, new Date("2026-07-05T05:10:30Z")), code).toBe(true);
			expect(isGameInActiveWindow(game, new Date("2026-07-05T11:10:00.000Z")), code).toBe(true);
			expect(isGameInActiveWindow(game, new Date("2026-07-05T11:10:00.001Z")), code).toBe(false);
		}
	});

	it("no time known (none, or one that doesn't parse): 6 hours from first pitch, inclusive", () =>
	{
		for (const at of [undefined, null, "garbage"])
		{
			const game = suspended("U", at);
			expect(isGameInActiveWindow(game, new Date("2026-07-05T05:05:00.000Z")), String(at)).toBe(true);
			expect(isGameInActiveWindow(game, new Date("2026-07-05T05:05:00.001Z")), String(at)).toBe(false);
		}
	});

	it("a game resumed on a later day, listed suspended with the resume time as its start, is in its lead window", () =>
	{
		const resuming = suspended("U", "2026-07-05T05:10:00.000Z", "2026-07-05T20:00:00Z");
		expect(isGameInActiveWindow(resuming, new Date("2026-07-05T18:30:00Z"))).toBe(true);
		expect(isGameInActiveWindow(resuming, new Date("2026-07-05T17:30:00Z"))).toBe(false);
	});

	it("a suspension time keeps the window open even when no first pitch can be read", () =>
	{
		const game = {
			...suspended("U", "2026-07-05T05:10:00.000Z"),
			officialDate: "unknown",
			startTime: undefined,
		};
		expect(isGameInActiveWindow(game, new Date("2026-07-05T11:00:00Z"))).toBe(true);
		expect(isGameInActiveWindow(game, new Date("2026-07-05T11:10:00.001Z"))).toBe(false);
	});

	it("makes the schedule day active while the suspended game is (scheduleWindowMode)", () =>
	{
		const now = new Date("2026-07-05T07:00:00Z");
		expect(scheduleWindowMode([suspended("U", "2026-07-05T06:00:00.000Z")], now)).toBe("active");
		expect(scheduleWindowMode([suspended("U")], now)).toBe("cache");
	});

	it("isSuspendedStatus: `T` and `U` in either case, nothing else", () =>
	{
		for (const code of ["T", "U", "t", "u"]) expect(isSuspendedStatus(code), code).toBe(true);
		for (const code of ["I", "F", "X", "Z", ""]) expect(isSuspendedStatus(code), code).toBe(false);
		expect(DEFAULT_CADENCE.suspendedHours * HOUR).toBe(6 * HOUR);
	});
});
