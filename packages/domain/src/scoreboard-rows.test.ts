import {
	describe, expect, it,
} from "vitest";
import {
	collapsedBarState, isFavoriteGame, scoreboardRows, sortScoreboardGames,
} from "./scoreboard-rows.js";
import type { ScheduleGameSummary } from "./types.js";

/** Only the team ids matter to the layout; the rest of a game is left out. */
const game = (pk: number, away: number, home: number) => ({
	gamePk: pk,
	teams: {
		away: {
			id: away,
		},
		home: {
			id: home,
		},
	},
}) as unknown as ScheduleGameSummary;

const DAY = [game(1, 137, 121), game(2, 112, 146), game(3, 147, 111)];

describe("scoreboardRows (S68)", () =>
{
	it("collapses every game without a favorite team and puts favorites first", () =>
	{
		const rows = scoreboardRows(DAY, [146], true);
		expect(rows.map((r) => [r.game.gamePk, r.collapsed])).toEqual([[2, false], [1, true], [3, true]]);
	});

	it("with no favorites nothing collapses and the order is kept", () =>
	{
		expect(scoreboardRows(DAY, [], true).map((r) => [r.game.gamePk, r.collapsed])).toEqual([[1, false], [2, false], [3, false]]);
	});

	it("with Collapse Non-Favorites off nothing collapses, favorites or not", () =>
	{
		expect(scoreboardRows(DAY, [146], false).every((r) => !r.collapsed)).toBe(true);
		expect(scoreboardRows(DAY, [146], false).map((r) => r.game.gamePk)).toEqual([1, 2, 3]);
	});

	it("S213 AC 3 home only: a game where only the home team is a favorite stays open, first", () =>
	{
		const rows = scoreboardRows(DAY, [121], true);
		expect(rows.map((r) => [r.game.gamePk, r.collapsed])).toEqual([[1, false], [2, true], [3, true]]);
	});
});

describe("isFavoriteGame (S213)", () =>
{
	const yankeesAtPadres = game(9, 147, 135);

	it("S213 AC 1 away: the away team a favorite", () =>
	{
		expect(isFavoriteGame(yankeesAtPadres, [147])).toBe(true);
	});

	it("S213 AC 1 home: the home team a favorite", () =>
	{
		expect(isFavoriteGame(yankeesAtPadres, [111, 135])).toBe(true);
	});

	it("S213 AC 1 both: both teams favorites", () =>
	{
		expect(isFavoriteGame(yankeesAtPadres, [135, 147])).toBe(true);
	});

	it("S213 AC 1 neither: neither team a favorite", () =>
	{
		expect(isFavoriteGame(yankeesAtPadres, [111, 146])).toBe(false);
	});

	it("S213 AC 1 empty: no favorites at all", () =>
	{
		expect(isFavoriteGame(yankeesAtPadres, [])).toBe(false);
	});
});

const status = (codedGameState: string) => ({
	abstractGameState: "",
	codedGameState,
	detailedState: "",
});
const line = (away: number | null, home: number | null, inning = 7, inningState = "Bottom") => ({
	currentInning: inning,
	inningState,
	isTopInning: false,
	outs: 1,
	balls: 0,
	strikes: 0,
	teams: {
		away: {
			runs: away,
			hits: 0,
			errors: 0,
		},
		home: {
			runs: home,
			hits: 0,
			errors: 0,
		},
	},
}) as never;

describe("collapsedBarState (S68)", () =>
{
	it("score over the inning while live, score over Final after (A2; owner, 2026-10-30)", () =>
	{
		expect(collapsedBarState({
			status: status("I"),
			linescore: line(2, 1),
		}, false)).toEqual({
			score: "2–1",
			state: "Bot 7th",
		});
		expect(collapsedBarState({
			status: status("F"),
			linescore: line(5, 3),
		}, false)).toEqual({
			score: "5–3",
			state: "Final",
		});
	});

	it("live: the count rides under the score with the inning", () =>
	{
		expect(collapsedBarState({
			status: status("I"),
			linescore: line(2, 1),
			live: {
				balls: 2,
				strikes: 2,
				outs: 2,
			} as never,
		}, false)).toEqual({
			score: "2–1",
			state: "Bot 7th · 2-2, 2 out",
		});
		expect(collapsedBarState({
			status: status("F"),
			linescore: line(5, 3),
			live: {
				balls: 2,
				strikes: 2,
				outs: 2,
			} as never,
		}, false)?.state).toBe("Final");
	});

	it("with scores hidden, the state only (A3)", () =>
	{
		expect(collapsedBarState({
			status: status("I"),
			linescore: line(2, 1),
		}, true)).toEqual({
			score: null,
			state: "Bot 7th",
		});
		expect(collapsedBarState({
			status: status("F"),
			linescore: line(5, 3),
		}, true)).toEqual({
			score: null,
			state: "Final",
		});
	});

	it("no score yet reads the state alone; before first pitch there is none", () =>
	{
		expect(collapsedBarState({
			status: status("I"),
			linescore: null,
		}, false)).toEqual({
			score: null,
			state: "Live",
		});
		expect(collapsedBarState({
			status: status("S"),
			linescore: null,
		}, false)).toBeNull();
	});
});

describe("sortScoreboardGames (B430, #430)", () =>
{
	/** A game with teams, a coded state and a start time (absent when `start` is null). */
	const timed = (pk: number, away: number, home: number, code: string, start: string | null) => ({
		...game(pk, away, home),
		status: {
			codedGameState: code,
		},
		...(start ? {
			startTime: `2026-09-05T${start}:00Z`,
		} : {}),
	}) as unknown as ScheduleGameSummary;

	const GAMES = [
		timed(1, 137, 121, "F", "17:05"),
		timed(2, 112, 146, "S", "16:10"),
		timed(3, 147, 111, "I", "19:10"),
		timed(4, 119, 135, "I", "18:40"),
		timed(5, 143, 120, "P", null),
		timed(6, 108, 133, "S", "23:10"),
	];
	const order = (favorites: number[], sort: "default" | "startTime") => sortScoreboardGames(GAMES, favorites, sort).map((g) => g.gamePk);

	it("default with no favorites: games in progress first, each part by start time, earliest first, untimed last", () =>
	{
		expect(order([], "default")).toEqual([4, 3, 2, 1, 6, 5]);
	});

	it("default: a favorite team's games come first, in progress before the rest, then early to late", () =>
	{
		expect(order([133, 121, 111], "default")).toEqual([3, 1, 6, 4, 2, 5]);
	});

	it("default: a favorite by its home team only counts (isFavoriteGame)", () =>
	{
		expect(order([146], "default")[0]).toBe(2);
	});

	it("startTime: every game by first pitch alone, favorites and live games included, untimed last", () =>
	{
		expect(order([133], "startTime")).toEqual([2, 1, 4, 3, 6, 5]);
	});

	it("ties keep the order given, and the input is not changed", () =>
	{
		const same = [timed(7, 1, 2, "S", "17:00"), timed(8, 3, 4, "S", "17:00")];
		expect(sortScoreboardGames(same, [], "default").map((g) => g.gamePk)).toEqual([7, 8]);
		expect(sortScoreboardGames([...same].reverse(), [], "startTime").map((g) => g.gamePk)).toEqual([8, 7]);
		expect(GAMES.map((g) => g.gamePk)).toEqual([1, 2, 3, 4, 5, 6]);
	});
});
