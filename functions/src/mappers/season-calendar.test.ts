import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ScheduleResponse } from "@bt/mlb-api";
import { parseScheduleResponse, parseSeasonsResponse } from "@bt/mlb-api";
import {
	describe, expect, it,
} from "vitest";
import { mapSeasonCalendar, worldSeriesChampion } from "./season-calendar.js";

function raw(name: string): unknown
{
	return JSON.parse(readFileSync(fileURLToPath(new URL(`../../../fixtures/raw/${name}`, import.meta.url)), "utf8"));
}

const seasons2026 = parseSeasonsResponse(raw("seasons-2026.json"));
const worldSeries2026 = parseScheduleResponse(raw("worldseries-2026.json"));
const noSeries: ScheduleResponse = {
	dates: [],
} as unknown as ScheduleResponse;

describe("mapSeasonCalendar", () =>
{
	it("takes the final from the World Series, not MLB's scheduled postseason end", () =>
	{
		// The recorded calendar still says 2026-10-31; the Series ended in five on 10-28.
		expect(seasons2026.seasons[0]?.postSeasonEndDate).toBe("2026-10-31");
		expect(mapSeasonCalendar(seasons2026, worldSeries2026)).toEqual({
			season: 2026,
			springStartDate: "2026-02-20",
			lastGameDate: "2026-10-28",
			regularSeasonStartDate: "2026-03-25",
			regularSeasonEndDate: "2026-09-27",
			champion: {
				teamId: 158,
				name: "Milwaukee Brewers",
				wonOn: "2026-10-28",
			},
		});
	});

	it("carries the regular season's first and last days when MLB lists them (S128), and leaves them out when it doesn't", () =>
	{
		const s2027 = mapSeasonCalendar(parseSeasonsResponse(raw("seasons-2027.json")), parseScheduleResponse(raw("worldseries-2027.json")));
		expect(s2027).toMatchObject({
			season: 2027,
			springStartDate: "2027-02-19",
			regularSeasonStartDate: "2027-03-25",
			regularSeasonEndDate: "2027-09-26",
		});
		const bare = parseSeasonsResponse({
			seasons: [{
				seasonId: "2028",
				springStartDate: "2028-02-20",
				postSeasonEndDate: "2028-10-31",
			}],
		});
		const calendar = mapSeasonCalendar(bare, noSeries);
		expect(calendar).not.toHaveProperty("regularSeasonStartDate");
		expect(calendar).not.toHaveProperty("regularSeasonEndDate");
	});

	it("before the Series is scheduled, the calendar's postseason end stands in", () =>
	{
		expect(mapSeasonCalendar(seasons2026, noSeries)?.lastGameDate).toBe("2026-10-31");
	});

	it("skips a cancelled Series day", () =>
	{
		const cancelledLast = structuredClone(worldSeries2026);
		const last = cancelledLast.dates.at(-1)!;
		last.games = last.games.map((game) => ({
			...game,
			status: {
				...game.status,
				detailedState: "Cancelled",
			},
		}));
		expect(mapSeasonCalendar(seasons2026, cancelledLast)?.lastGameDate).toBe("2026-10-27");
	});

	it("S140 AC 1: a calendar with no decided Series carries no champion", () =>
	{
		expect(mapSeasonCalendar(seasons2026, noSeries)).not.toHaveProperty("champion");
		expect(mapSeasonCalendar(parseSeasonsResponse(raw("seasons-2027.json")), parseScheduleResponse(raw("worldseries-2027.json")))).not.toHaveProperty("champion");
	});

	it("S155 AC 3: 1950, with no springStartDate, starts on its first regular-season day and keeps its last one", () =>
	{
		const s1950 = parseSeasonsResponse(raw("seasons-1950.json"));
		expect(s1950.seasons[0]?.springStartDate).toBeUndefined();
		expect(mapSeasonCalendar(s1950, parseScheduleResponse(raw("worldseries-1950.json")))).toMatchObject({
			season: 1950,
			springStartDate: "1950-04-18",
			regularSeasonStartDate: "1950-04-18",
			regularSeasonEndDate: "1950-10-01",
			lastGameDate: "1950-10-07",
		});
	});

	it("S155 AC 3: a season with neither a springStartDate nor a last regular-season day is still null", () =>
	{
		expect(mapSeasonCalendar(parseSeasonsResponse({
			seasons: [{
				seasonId: "1950",
				regularSeasonStartDate: "1950-04-18",
				postSeasonEndDate: "1950-10-07",
			}],
		}), noSeries)).toBeNull();
	});

	it("an unpublished season is null", () =>
	{
		expect(mapSeasonCalendar({
			seasons: [],
		}, noSeries)).toBeNull();
	});
});

describe("worldSeriesChampion (S140 AC 1)", () =>
{
	/** The 2026 recording with only its first `n` game days. */
	const firstDays = (n: number): ScheduleResponse => ({
		...worldSeries2026,
		dates: worldSeries2026.dates.slice(0, n),
	});

	it("S140 AC 1: 2025 is the Dodgers, in seven games (4 of 7, won on 2025-11-01)", () =>
	{
		expect(worldSeriesChampion(parseScheduleResponse(raw("worldseries-2025.json")))).toEqual({
			teamId: 119,
			name: "Los Angeles Dodgers",
			wonOn: "2025-11-01",
		});
	});

	it("S140 AC 1: 2026 is the Brewers, in five games", () =>
	{
		expect(worldSeriesChampion(worldSeries2026)).toEqual({
			teamId: 158,
			name: "Milwaukee Brewers",
			wonOn: "2026-10-28",
		});
	});

	it("S140 AC 1: none for 2027's empty schedule and for a season with no Series", () =>
	{
		expect(worldSeriesChampion(parseScheduleResponse(raw("worldseries-2027.json")))).toBeNull();
		expect(worldSeriesChampion(noSeries)).toBeNull();
	});

	it("S140 AC 1: none while the Series is under way (2026 cut to its first four games: the Brewers on 3 wins)", () =>
	{
		expect(worldSeriesChampion(firstDays(4))).toBeNull();
	});

	it("S140 AC 1: none when the last final game lacks gamesInSeries, the series records, or both", () =>
	{
		const strip = (drop: (game: ScheduleResponse["dates"][number]["games"][number]) => void): ScheduleResponse =>
		{
			const copy = structuredClone(worldSeries2026);
			for (const day of copy.dates) for (const game of day.games) drop(game);
			return copy;
		};
		expect(worldSeriesChampion(strip((game) => delete game.gamesInSeries))).toBeNull();
		expect(worldSeriesChampion(strip((game) =>
		{
			delete game.teams.away.leagueRecord;
			delete game.teams.home.leagueRecord;
		}))).toBeNull();
		expect(worldSeriesChampion(strip((game) =>
		{
			delete game.gamesInSeries;
			delete game.teams.away.leagueRecord;
			delete game.teams.home.leagueRecord;
		}))).toBeNull();
		// Only the loser's record missing (the Rays, home in the deciding game): still no guess.
		const loserMissing = structuredClone(worldSeries2026);
		delete loserMissing.dates.at(-1)!.games[0]!.teams.home.leagueRecord;
		expect(worldSeriesChampion(loserMissing)).toBeNull();
	});

	it("S140 AC 1: the games are read in date order, whatever order MLB lists the days in", () =>
	{
		expect(worldSeriesChampion({
			...worldSeries2026,
			dates: [...worldSeries2026.dates].reverse(),
		})).toEqual({
			teamId: 158,
			name: "Milwaukee Brewers",
			wonOn: "2026-10-28",
		});
	});

	it("S140 AC 1: the deciding game is the last final one: a cancelled or postponed later game, or one still being played, is skipped", () =>
	{
		const later = (detailedState: string, abstractGameState: string): ScheduleResponse =>
		{
			const copy = structuredClone(worldSeries2026);
			const game = structuredClone(copy.dates.at(-1)!.games[0]!);
			game.status = {
				...game.status,
				detailedState,
				abstractGameState,
			};
			copy.dates.push({
				date: "2026-10-30",
				games: [game],
			});
			return copy;
		};
		for (const [detailed, abstract] of [["Cancelled", "Final"], ["Postponed", "Final"], ["In Progress", "Live"]] as const)
		{
			expect(worldSeriesChampion(later(detailed, abstract))?.wonOn).toBe("2026-10-28");
		}
		// The 2026 Series cut after game 3 (3-0), with game 4 still live: under way, no winner.
		const live = firstDays(4);
		live.dates[3]!.games[0]!.status = {
			...live.dates[3]!.games[0]!.status,
			abstractGameState: "Live",
			detailedState: "In Progress",
		};
		expect(worldSeriesChampion(live)).toBeNull();
	});

	it("S140 AC 1: a best-of-nine series needs five wins, not four", () =>
	{
		const nine = structuredClone(worldSeries2026);
		for (const day of nine.dates) for (const game of day.games) game.gamesInSeries = 9;
		expect(worldSeriesChampion(nine)).toBeNull();
		const won = structuredClone(nine);
		const last = won.dates.at(-1)!.games[0]!;
		last.teams.away.leagueRecord = {
			...last.teams.away.leagueRecord!,
			wins: 5,
		};
		expect(worldSeriesChampion(won)?.teamId).toBe(158);
	});
});
