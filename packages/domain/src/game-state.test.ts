import {
	describe, expect, it,
} from "vitest";
import type {
	GameState, GameStateClock, GameStateRow, StoredScheduleDay,
} from "./game-state.js";
import {
	feedTimeToIso, gameStateFromGame, gameStateFromSummary, gameStateSource, isOtherDaysListing, joinScheduleDay, listingMovedAway, toStoredScheduleDay, wholeFetchedGame,
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

});

describe("the feed's own time (S150 AC 2)", () =>
{
	const fetchedAt = new Date("2026-09-05T23:34:30.000Z");

	it("S150 AC 2 feed time: MLB's YYYYMMDD_HHMMSS (UTC) becomes an ISO instant; anything else is none", () =>
	{
		expect(feedTimeToIso("20260905_233435", fetchedAt)).toBe("2026-09-05T23:34:35.000Z");
		expect(feedTimeToIso(undefined, fetchedAt)).toBeUndefined();
		expect(feedTimeToIso("", fetchedAt)).toBeUndefined();
		expect(feedTimeToIso("2026-09-05", fetchedAt)).toBeUndefined();
		expect(feedTimeToIso("2026090_233435", fetchedAt)).toBeUndefined();
	});

	it("S150 AC 2 feed time: a part out of range is none, never rolled over into another date", () =>
	{
		expect(feedTimeToIso("20261305_250000", fetchedAt)).toBeUndefined();
		expect(feedTimeToIso("20260230_120000", fetchedAt)).toBeUndefined();
		expect(feedTimeToIso("20260905_246000", fetchedAt)).toBeUndefined();
		expect(feedTimeToIso("20260905_235960", fetchedAt)).toBeUndefined();
		expect(feedTimeToIso("20260905_240000", fetchedAt)).toBeUndefined();
	});

	it("S150 AC 2 feed time: a time ahead of the fetch by more than the clock tolerance is none; within it, kept as MLB sent it", () =>
	{
		// The fetch time is read before the request, so a real feed time is often a few seconds after it.
		expect(feedTimeToIso("20260905_233507", fetchedAt)).toBe("2026-09-05T23:35:07.000Z");
		expect(feedTimeToIso("20260905_233929", fetchedAt)).toBe("2026-09-05T23:39:29.000Z");
		expect(feedTimeToIso("20260905_234031", fetchedAt)).toBeUndefined();
		expect(feedTimeToIso("20990101_000000", fetchedAt)).toBeUndefined();
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

	it("S150 AC 4 late final: a final the feed wrote after a long delay keeps its trail from when it changed, so a lagging schedule copy can't put it back to live", () =>
	{
		// First pitch 23:00Z; a rain delay, then final at 07:00Z next day (start + 8h, past start + 4h + 3h).
		const fed: GameStateClock = {
			...clock(FINAL),
			source: "feed",
			state: {
				status: FINAL,
				lastChangedAt: "2026-09-06T07:00:00.000Z",
			},
		};
		expect(gameStateSource(fed, clock(LIVE), new Date("2026-09-06T07:30:00Z"))).toBe("feed");
		expect(gameStateSource(fed, clock(LIVE), new Date("2026-09-06T10:00:00Z"))).toBe("feed");
		expect(gameStateSource(fed, clock(LIVE), new Date("2026-09-06T10:01:00Z"))).toBe("schedule");
		// The schedule's own final is judged by first pitch alone.
		expect(gameStateSource({
			...fed,
			source: "schedule",
		}, clock(LIVE), new Date("2026-09-06T07:30:00Z"))).toBe("schedule");
		// A final the feed wrote on time keeps the usual trail (the later of the two ends is the assumed one).
		expect(gameStateSource({
			...fed,
			state: {
				status: FINAL,
				lastChangedAt: "2026-09-06T01:30:00.000Z",
			},
		}, clock(LIVE), new Date("2026-09-06T05:30:00Z"))).toBe("feed");
	});

	it("S150 AC 4 late suspended: a game the feed saw suspended late keeps its 6 hours from when it changed", () =>
	{
		const SUSPENDED = {
			abstractGameState: "Live",
			codedGameState: "T",
			detailedState: "Suspended: Rain",
		};
		const fed: GameStateClock = {
			...clock(SUSPENDED),
			source: "feed",
			state: {
				status: SUSPENDED,
				lastChangedAt: "2026-09-06T05:30:00.000Z",
			},
		};
		// Start + 6.5h suspended; a schedule copy at start + 7h, past the start's 6 hours, stays the feed's.
		expect(gameStateSource(fed, clock(LIVE), new Date("2026-09-06T06:00:00Z"))).toBe("feed");
		expect(gameStateSource(fed, clock(LIVE), new Date("2026-09-06T11:31:00Z"))).toBe("schedule");
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

/** A game's stored row as the join reads it: its state, and the official date it now belongs to. */
function row(status: GameState["status"], version: number, lastChangedAt: string, home = 1, officialDate = "2026-09-05"): Pick<GameStateRow, "state" | "officialDate">
{
	return {
		state: state(status, version, lastChangedAt, home),
		officialDate,
	};
}

describe("isOtherDaysListing, which schedule listings never change a row (S150 AC 4)", () =>
{
	const SUSPENDED = {
		abstractGameState: "Live",
		codedGameState: "U",
		detailedState: "Suspended",
	};
	/** A row or a listing: its status and official date. */
	const at = (status: GameState["status"], officialDate: string) => ({
		state: {
			status,
		},
		officialDate,
	});

	it("S150 AC 4 other day's listing: only a postponed or suspended listing of another date is skipped, and against a row that is itself postponed or suspended only an earlier one", () =>
	{
		// The makeup holds the row: the original day's postponed listing is skipped.
		expect(isOtherDaysListing(at(SCHEDULED, "2026-09-06"), at(POSTPONED, "2026-09-05"))).toBe(true);
		expect(isOtherDaysListing(at(FINAL, "2026-09-06"), at(POSTPONED, "2026-09-05"))).toBe(true);
		// The makeup's own listing takes over a row the original day wrote.
		expect(isOtherDaysListing(at(POSTPONED, "2026-09-05"), at(SCHEDULED, "2026-09-06"))).toBe(false);
		// A game MLB moved, earlier or later, with no postponement: its new listing takes the row.
		expect(isOtherDaysListing(at(SCHEDULED, "2026-09-06"), at(SCHEDULED, "2026-09-05"))).toBe(false);
		expect(isOtherDaysListing(at(SCHEDULED, "2026-09-05"), at(SCHEDULED, "2026-09-06"))).toBe(false);
		// Postponed again on its makeup day: the first day's listing is skipped, the later one's taken.
		expect(isOtherDaysListing(at(POSTPONED, "2026-09-06"), at(POSTPONED, "2026-09-05"))).toBe(true);
		expect(isOtherDaysListing(at(POSTPONED, "2026-09-05"), at(POSTPONED, "2026-09-06"))).toBe(false);
		// Suspended with its own resumption date: the resumption's listing is taken, the original day's then skipped.
		expect(isOtherDaysListing(at(SUSPENDED, "2026-09-05"), at(SUSPENDED, "2026-09-06"))).toBe(false);
		expect(isOtherDaysListing(at(SUSPENDED, "2026-09-06"), at(SUSPENDED, "2026-09-05"))).toBe(true);
		// The row's own date is never another day's.
		expect(isOtherDaysListing(at(LIVE, "2026-09-05"), at(POSTPONED, "2026-09-05"))).toBe(false);
	});
});

describe("joinScheduleDay (S150 AC 6)", () =>
{
	it("S150 AC 6 join: each listed game takes its row's state, else its snapshot's, else scheduled with no score", () =>
	{
		const rows = new Map([[1, row(FINAL, 3, "2026-09-06T03:00:00.000Z", 5)]]);
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
		const rows = new Map([[1, row(FINAL, 1, "2026-09-06T03:00:00.000Z")], [2, row(FINAL, 1, "2026-09-06T03:00:00.000Z")]]);
		const day = joinScheduleDay(stored([1, 2], "active"), 0, rows, new Map(), new Date("2026-09-07T12:00:00Z"));
		expect(day.windowMode).toBe("cache");
		expect(joinScheduleDay(stored([1, 2], "cache"), 0, new Map([[1, row(LIVE, 1, "2026-09-06T00:00:00.000Z")]]), new Map(), new Date("2026-09-07T12:00:00Z")).windowMode).toBe("active");
	});

	it("S150 AC 6 rising: a state change raises the served version, and a dropped game's version in the served base keeps it from falling", () =>
	{
		const now = new Date("2026-09-08T12:00:00Z");
		const before = joinScheduleDay(stored([1, 2]), 0, new Map([[1, row(FINAL, 2, "2026-09-06T03:00:00.000Z")], [2, row(FINAL, 5, "2026-09-06T03:00:00.000Z")]]), new Map(), now);
		const changed = joinScheduleDay(stored([1, 2]), 0, new Map([[1, row(FINAL, 3, "2026-09-07T03:00:00.000Z")], [2, row(FINAL, 5, "2026-09-06T03:00:00.000Z")]]), new Map(), now);
		expect(changed.version).toBeGreaterThan(before.version);
		// Game 2 dropped: the day is rewritten (version + 1) and its served base raised by game 2's state version.
		const dropped = joinScheduleDay({
			...stored([1]),
			version: 5,
		}, 5, new Map([[1, row(FINAL, 3, "2026-09-07T03:00:00.000Z")]]), new Map(), now);
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

	it("S150 AC 5 listing: a postponed or suspended listing keeps its own status beside the game (listingStatus), no other does", () =>
	{
		const SUSPENDED = {
			abstractGameState: "Live",
			codedGameState: "U",
			detailedState: "Suspended",
		};
		const day = toStoredScheduleDay({
			date: "2026-09-05",
			games: [POSTPONED, SUSPENDED, LIVE, FINAL, SCHEDULED].map((status, i) => ({
				...storedGame(i + 1),
				status,
				linescore: linescore(1, 0),
				live: null,
			})),
		});
		expect(day.games.map((game) => game.listingStatus ?? null)).toEqual([POSTPONED, SUSPENDED, null, null, null]);
		expect(day.games.every((game) => !("status" in game) && !("linescore" in game) && !("live" in game))).toBe(true);
	});

	it("S150 AC 6 old-shape day: a day stored before S150, its games still carrying their own status, serves a postponed or suspended game that moved away as postponed or suspended", () =>
	{
		const now = new Date("2026-09-08T12:00:00Z");
		const oldShape = (status: GameState["status"]) => ({
			...stored([1]),
			games: [{
				...storedGame(1),
				status,
				linescore: linescore(0, 0),
				live: null,
			}],
		}) as unknown as StoredScheduleDay;
		const madeUp = new Map([[1, row(FINAL, 4, "2026-09-07T03:00:00.000Z", 6, "2026-09-06")]]);
		expect(joinScheduleDay(oldShape(POSTPONED), 0, madeUp, new Map(), now).games[0]).toMatchObject({
			status: POSTPONED,
			linescore: null,
		});
		// A game the old day stored in any other status takes the row's state, as before.
		expect(joinScheduleDay(oldShape(SCHEDULED), 0, madeUp, new Map(), now).games[0]?.status).toEqual(FINAL);
		// The old field is never served beside the joined one.
		expect(Object.keys(joinScheduleDay(oldShape(POSTPONED), 0, madeUp, new Map(), now).games[0]!)).not.toContain("listingStatus");
	});

	it("S150 AC 6 listing with no row: a listing that kept its own status and whose game has no row is served with that status", () =>
	{
		const day = joinScheduleDay({
			...stored([1]),
			games: [{
				...storedGame(1),
				listingStatus: POSTPONED,
			}],
		}, 0, new Map(), new Map([[1, {
			status: FINAL,
			linescore: linescore(3, 2),
			live: null,
		}]]), new Date("2026-09-08T12:00:00Z"));
		expect(day.games[0]).toMatchObject({
			status: POSTPONED,
			linescore: null,
		});
	});

	it("S150 AC 6 suspended original day: served suspended, with the row's linescore while the row is still suspended and none once it isn't", () =>
	{
		const SUSPENDED = {
			abstractGameState: "Live",
			codedGameState: "U",
			detailedState: "Suspended",
		};
		const listing: StoredScheduleDay = {
			...stored([1]),
			games: [{
				...storedGame(1),
				listingStatus: SUSPENDED,
			}],
		};
		const now = new Date("2026-09-08T12:00:00Z");
		const awaiting = joinScheduleDay(listing, 0, new Map([[1, row(SUSPENDED, 3, "2026-09-06T03:00:00.000Z", 4, "2026-09-07")]]), new Map(), now);
		expect(awaiting.games[0]).toMatchObject({
			status: SUSPENDED,
			live: null,
		});
		expect(awaiting.games[0]?.linescore?.teams.home.runs).toBe(4);
		const resumed = joinScheduleDay(listing, 0, new Map([[1, row(FINAL, 5, "2026-09-07T23:00:00.000Z", 6, "2026-09-07")]]), new Map(), now);
		expect(resumed.games[0]).toMatchObject({
			status: SUSPENDED,
			linescore: null,
		});
		expect(listingMovedAway(listing.games[0]!, {
			officialDate: "2026-09-07",
		}, listing.date)).toBe(true);
		expect(listingMovedAway(listing.games[0]!, {
			officialDate: listing.date,
		}, listing.date)).toBe(false);
		expect(listingMovedAway(storedGame(1), {
			officialDate: "2026-09-07",
		}, listing.date)).toBe(false);
		expect(listingMovedAway(listing.games[0]!, undefined, listing.date)).toBe(false);
	});

	it("S150 AC 6 makeup: a listing whose game now belongs to another day is served with its own postponed status; on the game's own day, the row's", () =>
	{
		const now = new Date("2026-09-08T12:00:00Z");
		const postponedListing: StoredScheduleDay = {
			...stored([1]),
			games: [{
				...storedGame(1),
				listingStatus: POSTPONED,
			}],
		};
		// The game was made up on 2026-09-06: its row is final there.
		const madeUp = new Map([[1, row(FINAL, 4, "2026-09-07T03:00:00.000Z", 6, "2026-09-06")]]);
		const original = joinScheduleDay(postponedListing, 0, madeUp, new Map(), now);
		expect(original.games[0]).toMatchObject({
			status: POSTPONED,
			linescore: null,
			live: null,
		});
		// The row's version still counts, so the day's version only rises.
		expect(original.version).toBe(4 + 4);
		expect(original.windowMode).toBe("cache");
		// While the game still belongs to this day (postponed, not yet made up), the row is served.
		const inPlace = joinScheduleDay(postponedListing, 0, new Map([[1, row(LIVE, 2, "2026-09-05T23:30:00.000Z", 2)]]), new Map(), now);
		expect(inPlace.games[0]?.status).toEqual(LIVE);
		expect(inPlace.games[0]?.linescore?.teams.home.runs).toBe(2);
	});
});

describe("wholeFetchedGame (S216 AC 5)", () =>
{
	const game = {
		gamePk: 1,
	} as Unversioned<GameSnapshot>;
	const late = {
		gamePk: 1,
		playMetrics: {
			atBats: [],
		},
	} as unknown as Unversioned<GameSnapshot>;

	it("a fetch whose playMetrics came in time is returned as it is", async () =>
	{
		expect(await wholeFetchedGame({
			game,
			feedTime: "2026-09-05T23:34:35.000Z",
		})).toEqual({
			game,
			feedTime: "2026-09-05T23:34:35.000Z",
		});
	});

	it("late playMetrics are waited for and their game returned, without the promise", async () =>
	{
		expect(await wholeFetchedGame({
			game,
			playMetricsLate: Promise.resolve(late),
		})).toEqual({
			game: late,
		});
	});

	it("late playMetrics that never come leave the game without them, as a failed request does", async () =>
	{
		expect(await wholeFetchedGame({
			game,
			playMetricsLate: Promise.resolve(null),
		})).toEqual({
			game,
		});
	});
});
