import {
	describe, expect, it,
} from "vitest";
import type {
	GameState, GameStateClock, StoredScheduleDay,
} from "./game-state.js";
import {
	feedTimeToIso, gameStateFromGame, gameStateFromSummary, gameStateSource, joinScheduleDay, toStoredScheduleDay,
} from "./game-state.js";
import type { AtBat } from "./plays.js";
import type { GameSnapshot, ScheduleGameSummary } from "./types.js";
import type { Unversioned } from "./versioning.js";

const LIVE = {
	abstractGameState: "Live",
	codedGameState: "I",
	detailedState: "In Progress",
};
const FINAL = {
	abstractGameState: "Final",
	codedGameState: "F",
	detailedState: "Final",
};
const SCHEDULED = {
	abstractGameState: "Preview",
	codedGameState: "S",
	detailedState: "Scheduled",
};
const POSTPONED = {
	abstractGameState: "Final",
	codedGameState: "D",
	detailedState: "Postponed",
};

/** A linescore at `home`–`away`, with a count. */
function linescore(home: number, away: number): NonNullable<GameSnapshot["linescore"]>
{
	return {
		currentInning: 5,
		inningState: "Top",
		isTopInning: true,
		outs: 1,
		balls: 2,
		strikes: 1,
		teams: {
			home: {
				runs: home,
				hits: 4,
				errors: 0,
			},
			away: {
				runs: away,
				hits: 3,
				errors: 1,
			},
		},
	};
}

/** An at-bat whose matchup is `batter` against `pitcher`. */
function atBat(batter: [number, string], pitcher: [number, string]): AtBat
{
	return {
		matchup: {
			batter: {
				id: batter[0],
				fullName: batter[1],
			},
			pitcher: {
				id: pitcher[0],
				fullName: pitcher[1],
			},
		},
	} as AtBat;
}

describe("game state builders (S150 AC 1)", () =>
{
	it("S150 AC 1 schedule: a scoreboard row's state is its status, linescore and live moment", () =>
	{
		const row = {
			status: LIVE,
			linescore: linescore(2, 1),
			live: {
				runners: {
					first: 7,
					second: null,
					third: null,
				},
				batterId: 1,
				pitcherId: 2,
				batterName: "A Batter",
				pitcherName: "A Pitcher",
				balls: 2,
				strikes: 1,
				outs: 1,
			},
		};
		expect(gameStateFromSummary(row)).toEqual(row);
		expect(gameStateFromSummary({
			status: FINAL,
			linescore: null,
		}).live).toBeNull();
	});

	it("S150 AC 1 feed: a game's state takes runners and players from its live, names from its at-bats, the count from its linescore", () =>
	{
		const game = {
			status: LIVE,
			linescore: linescore(3, 0),
			live: {
				runners: {
					first: null,
					second: 9,
					third: null,
				},
				batterId: 1,
				pitcherId: 2,
			},
			plays: [atBat([5, "Earlier Batter"], [2, "A Pitcher"]), atBat([1, "A Batter"], [6, "Earlier Pitcher"])],
		};
		expect(gameStateFromGame(game)).toEqual({
			status: LIVE,
			linescore: linescore(3, 0),
			live: {
				runners: {
					first: null,
					second: 9,
					third: null,
				},
				batterId: 1,
				pitcherId: 2,
				batterName: "A Batter",
				pitcherName: "A Pitcher",
				balls: 2,
				strikes: 1,
				outs: 1,
			},
		});
		// No at-bat names a player: his name is unknown, not borrowed from someone else.
		expect(gameStateFromGame({
			...game,
			plays: [],
		}).live?.batterName).toBeNull();
		// Not live: no moment, whatever the snapshot carries.
		expect(gameStateFromGame({
			...game,
			status: FINAL,
		}).live).toBeNull();
	});

	it("S150 AC 1 feed time: MLB's YYYYMMDD_HHMMSS (UTC) becomes an ISO instant; anything else is none", () =>
	{
		expect(feedTimeToIso("20260905_233435")).toBe("2026-09-05T23:34:35.000Z");
		expect(feedTimeToIso(undefined)).toBeUndefined();
		expect(feedTimeToIso("2026-09-05")).toBeUndefined();
	});
});

/** The clock of a row or write: status, first pitch 7pm ET on 2026-09-05 (23:00Z), official date. */
function clock(status: GameState["status"], startTime: string | null = "2026-09-05T23:00:00.000Z"): GameStateClock
{
	return {
		state: {
			status,
		},
		officialDate: "2026-09-05",
		startTime,
	};
}

describe("gameStateSource, the switch (S150 AC 4)", () =>
{
	it("S150 AC 4 window: the schedule before the window, the feed in it (a delay past the expected end and a final's trail included), the schedule after", () =>
	{
		expect(gameStateSource(clock(SCHEDULED), clock(SCHEDULED), new Date("2026-09-05T12:00:00Z"))).toBe("schedule");
		expect(gameStateSource(clock(SCHEDULED), clock(SCHEDULED), new Date("2026-09-05T22:00:00Z"))).toBe("feed");
		expect(gameStateSource(clock(LIVE), clock(FINAL), new Date("2026-09-07T12:00:00Z"))).toBe("feed");
		expect(gameStateSource(clock(FINAL), clock(FINAL), new Date("2026-09-06T05:00:00Z"))).toBe("feed");
		expect(gameStateSource(clock(FINAL), clock(LIVE), new Date("2026-09-06T12:00:00Z"))).toBe("schedule");
	});

	it("S150 AC 4 no row: the incoming state's clock decides", () =>
	{
		expect(gameStateSource(null, clock(SCHEDULED), new Date("2026-09-05T12:00:00Z"))).toBe("schedule");
		expect(gameStateSource(null, clock(LIVE), new Date("2026-09-05T23:30:00Z"))).toBe("feed");
	});

	it("S150 AC 4 postponed: a game postponed at 9am before a 7pm start is the schedule's whatever the clock", () =>
	{
		const row = clock(POSTPONED);
		expect(gameStateSource(row, clock(SCHEDULED), new Date("2026-09-05T13:00:00Z"))).toBe("schedule");
		expect(gameStateSource(row, clock(SCHEDULED), new Date("2026-09-05T23:30:00Z"))).toBe("schedule");
	});
});

/** A stored scoreboard game, with no state of its own. */
function storedGame(gamePk: number): StoredScheduleDay["games"][number]
{
	return {
		gamePk,
		gameDate: "2026-09-05",
		officialDate: "2026-09-05",
		startTime: "2026-09-05T23:00:00.000Z",
		teams: {
			home: {
				id: 1,
				abbreviation: "HOM",
				name: "Home",
				teamName: "Home",
			},
			away: {
				id: 2,
				abbreviation: "AWY",
				name: "Away",
				teamName: "Away",
			},
		},
		venue: null,
	};
}

function stored(games: number[], windowMode: "active" | "cache" = "cache"): StoredScheduleDay
{
	return {
		date: "2026-09-05",
		games: games.map(storedGame),
		fetchedAt: "2026-09-05T12:00:00.000Z",
		windowMode,
		version: 4,
		lastChangedAt: "2026-09-05T12:00:00.000Z",
	};
}

function state(status: GameState["status"], version: number, lastChangedAt: string, home = 1): GameState
{
	return {
		status,
		linescore: linescore(home, 0),
		live: null,
		version,
		lastChangedAt,
	};
}

describe("joinScheduleDay (S150 AC 6)", () =>
{
	it("S150 AC 6 join: each listed game takes its row's state, else its snapshot's, else scheduled with no score", () =>
	{
		const rows = new Map([[1, state(FINAL, 3, "2026-09-06T03:00:00.000Z", 5)]]);
		const fallbacks = new Map<number, Unversioned<GameState>>([[2, {
			status: FINAL,
			linescore: linescore(7, 2),
			live: null,
		}]]);
		const day = joinScheduleDay(stored([1, 2, 3]), 2, rows, fallbacks, new Date("2026-09-08T12:00:00Z"));
		expect(day.games.map((g) => [g.gamePk, g.status.codedGameState, g.linescore?.teams.home.runs ?? null])).toEqual([[1, "F", 5], [2, "F", 7], [3, "S", null]]);
		// The stored day's version plus its served base plus the rows' versions; the latest change of the day and its rows.
		expect(day.version).toBe(4 + 2 + 3);
		expect(day.lastChangedAt).toBe("2026-09-06T03:00:00.000Z");
	});

	it("S150 AC 6 window: a day stored active whose joined games are all final past their trails is served cache", () =>
	{
		const rows = new Map([[1, state(FINAL, 1, "2026-09-06T03:00:00.000Z")], [2, state(FINAL, 1, "2026-09-06T03:00:00.000Z")]]);
		const day = joinScheduleDay(stored([1, 2], "active"), 0, rows, new Map(), new Date("2026-09-07T12:00:00Z"));
		expect(day.windowMode).toBe("cache");
		expect(joinScheduleDay(stored([1, 2], "cache"), 0, new Map([[1, state(LIVE, 1, "2026-09-06T00:00:00.000Z")]]), new Map(), new Date("2026-09-07T12:00:00Z")).windowMode).toBe("active");
	});

	it("S150 AC 6 rising: a state change raises the served version, and a dropped game's version in the served base keeps it from falling", () =>
	{
		const now = new Date("2026-09-08T12:00:00Z");
		const before = joinScheduleDay(stored([1, 2]), 0, new Map([[1, state(FINAL, 2, "2026-09-06T03:00:00.000Z")], [2, state(FINAL, 5, "2026-09-06T03:00:00.000Z")]]), new Map(), now);
		const changed = joinScheduleDay(stored([1, 2]), 0, new Map([[1, state(FINAL, 3, "2026-09-07T03:00:00.000Z")], [2, state(FINAL, 5, "2026-09-06T03:00:00.000Z")]]), new Map(), now);
		expect(changed.version).toBeGreaterThan(before.version);
		// Game 2 dropped: the day is rewritten (version + 1) and its served base raised by game 2's state version.
		const dropped = joinScheduleDay({
			...stored([1]),
			version: 5,
		}, 5, new Map([[1, state(FINAL, 3, "2026-09-07T03:00:00.000Z")]]), new Map(), now);
		expect(dropped.version).toBeGreaterThan(changed.version);
	});

	it("S150 AC 6 stored day: a fetched day is stored without its games' status, linescore and live moment", () =>
	{
		const game: ScheduleGameSummary = {
			...storedGame(1),
			status: LIVE,
			linescore: linescore(1, 0),
			live: null,
		};
		const day = toStoredScheduleDay({
			date: "2026-09-05",
			games: [game],
		});
		expect(day.games[0]).toEqual(storedGame(1));
		expect(day.games[0]).not.toHaveProperty("status");
	});
});
