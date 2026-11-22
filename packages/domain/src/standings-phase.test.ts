import { readFileSync } from "node:fs";
import {
	describe, expect, it,
} from "vitest";
import type { SeasonCalendar } from "./scoreboard-date.js";
import {
	blankRegularSeasonTable, playoffsTable, previousStandingsPhase, seasonSettling, standingsChampion, standingsPhase, standingsPhases,
} from "./standings-phase.js";
import type { StandingsSnapshot, StandingsTeamRecord } from "./types.js";

/** A season's calendar from the committed recording `fixtures/raw/seasons-<season>.json` (MLB's own dates). */
function recorded(season: number): SeasonCalendar
{
	const raw = JSON.parse(readFileSync(new URL(`../../../fixtures/raw/seasons-${season}.json`, import.meta.url), "utf8")) as {
		seasons: Array<Record<string, string>>;
	};
	const s = raw.seasons[0]!;
	return {
		season,
		springStartDate: s.springStartDate!,
		lastGameDate: s.postSeasonEndDate!,
		regularSeasonStartDate: s.regularSeasonStartDate!,
		regularSeasonEndDate: s.regularSeasonEndDate!,
	};
}

const S2025 = recorded(2025);
const S2026 = recorded(2026);
const S2027 = recorded(2027);
const ALL = [S2027, S2025, S2026];

describe("standingsPhase", () =>
{
	it("the recordings carry MLB's dates", () =>
	{
		expect([S2025.regularSeasonStartDate, S2025.regularSeasonEndDate]).toEqual(["2025-03-18", "2025-09-28"]);
		expect([S2026.springStartDate, S2026.regularSeasonStartDate, S2026.regularSeasonEndDate]).toEqual(["2026-02-20", "2026-03-25", "2026-09-27"]);
		expect([S2027.springStartDate, S2027.regularSeasonStartDate, S2027.regularSeasonEndDate]).toEqual(["2027-02-19", "2027-03-25", "2027-09-26"]);
	});

	it("the last regular-season day is that day's table", () =>
	{
		expect(standingsPhase("2026-09-27", ALL)).toEqual({
			phase: "regularSeason",
			season: 2026,
			date: "2026-09-27",
		});
	});

	it("the day after the regular season is the final table", () =>
	{
		expect(standingsPhase("2026-09-28", ALL)).toEqual({
			phase: "final",
			season: 2026,
			date: "2026-09-27",
		});
	});

	it("a postseason day is the final table", () =>
	{
		expect(standingsPhase("2026-10-20", ALL)).toEqual({
			phase: "final",
			season: 2026,
			date: "2026-09-27",
		});
	});

	it("a January day is the previous season's final table", () =>
	{
		expect(standingsPhase("2027-01-15", [S2026, S2027])).toEqual({
			phase: "final",
			season: 2026,
			date: "2026-09-27",
		});
	});

	it("the day before spring is still the final table", () =>
	{
		expect(standingsPhase("2027-02-18", [S2026, S2027])).toEqual({
			phase: "final",
			season: 2026,
			date: "2026-09-27",
		});
	});

	it("the first spring day is spring's table as of that day", () =>
	{
		expect(standingsPhase("2027-02-19", [S2026, S2027])).toEqual({
			phase: "spring",
			season: 2027,
			date: "2027-02-19",
		});
	});

	it("the day before the regular season is spring's table", () =>
	{
		expect(standingsPhase("2026-03-24", ALL)).toEqual({
			phase: "spring",
			season: 2026,
			date: "2026-03-24",
		});
	});

	it("the first regular-season day is that day's table", () =>
	{
		expect(standingsPhase("2026-03-25", ALL)).toEqual({
			phase: "regularSeason",
			season: 2026,
			date: "2026-03-25",
		});
	});

	it("after an early opener it is the regular season though other teams still play spring games (2025 Tokyo Series)", () =>
	{
		expect(standingsPhase("2025-03-17", [S2024Unknown(), S2025])).toMatchObject({
			phase: "spring",
		});
		expect(standingsPhase("2025-03-20", [S2025])).toEqual({
			phase: "regularSeason",
			season: 2025,
			date: "2025-03-20",
		});
	});

	it("next season unpublished: the final table is kept", () =>
	{
		expect(standingsPhase("2027-03-01", [S2026])).toEqual({
			phase: "final",
			season: 2026,
			date: "2026-09-27",
		});
	});

	it("with no calendar, before every known season, or with an incomplete calendar it is the day's regular-season table", () =>
	{
		const regular = (date: string) => ({
			phase: "regularSeason",
			season: Number(date.slice(0, 4)),
			date,
		});
		expect(standingsPhase("2026-11-08", [])).toEqual(regular("2026-11-08"));
		expect(standingsPhase("2025-01-10", [S2025, S2026])).toEqual(regular("2025-01-10"));
		expect(standingsPhase("2026-11-08", [{
			season: 2026,
			springStartDate: "2026-02-20",
			lastGameDate: "2026-10-28",
		}])).toEqual(regular("2026-11-08"));
	});
});

/** A 2024 calendar with no regular-season dates: unknown for standings, so it changes nothing. */
function S2024Unknown(): SeasonCalendar
{
	return {
		season: 2024,
		springStartDate: "2024-02-22",
		lastGameDate: "2024-10-30",
	};
}

describe("previousStandingsPhase", () =>
{
	it("spring's previous table is the season before's final table (empty first spring morning)", () =>
	{
		expect(previousStandingsPhase(standingsPhase("2027-02-19", [S2026, S2027]), [S2026, S2027])).toEqual({
			phase: "final",
			season: 2026,
			date: "2026-09-27",
		});
	});

	it("the regular season's previous table is spring's as of the last spring day (empty opening-day morning)", () =>
	{
		expect(previousStandingsPhase(standingsPhase("2026-03-25", ALL), ALL)).toEqual({
			phase: "spring",
			season: 2026,
			date: "2026-03-24",
		});
	});

	it("a mid-season day has no previous table: only opening day falls back (AC 3)", () =>
	{
		expect(previousStandingsPhase(standingsPhase("2026-03-26", ALL), ALL)).toBeNull();
		expect(previousStandingsPhase(standingsPhase("2026-07-01", ALL), ALL)).toBeNull();
		expect(previousStandingsPhase(standingsPhase("2026-09-27", ALL), ALL)).toBeNull();
	});

	it("a mid-spring day has no previous table: only spring's first day falls back (AC 3)", () =>
	{
		expect(previousStandingsPhase(standingsPhase("2027-02-20", ALL), ALL)).toBeNull();
		expect(previousStandingsPhase(standingsPhase("2027-03-24", ALL), ALL)).toBeNull();
	});

	it("nothing comes before a final table, a first known spring, or a day with no calendar", () =>
	{
		expect(previousStandingsPhase(standingsPhase("2026-10-01", ALL), ALL)).toBeNull();
		expect(previousStandingsPhase(standingsPhase("2025-03-01", [S2025]), [S2025])).toBeNull();
		expect(previousStandingsPhase(standingsPhase("2026-07-01", []), [])).toBeNull();
	});
});

/** A pick, written short. */
const p = (phase: "spring" | "regularSeason" | "final", season: number, date: string) => ({
	phase,
	season,
	date,
});

describe("standingsPhases (S139)", () =>
{
	const spring2026 = {
		startDate: "2026-02-20",
		endDate: "2026-03-24",
	};
	const regular2026 = {
		startDate: "2026-03-25",
		endDate: "2026-09-27",
	};
	const playoffs2026 = {
		startDate: "2026-09-28",
		endDate: "2026-10-31",
	};

	it("standingsPhases 2027-02-18, the off-season's last day: season 2026, spring as of its last day, the final table, 2026's playoffs", () =>
	{
		expect(standingsPhases("2027-02-18", ALL)).toEqual({
			season: 2026,
			spring: {
				...spring2026,
				pick: p("spring", 2026, "2026-03-24"),
			},
			regularSeason: {
				...regular2026,
				pick: p("final", 2026, "2026-09-27"),
			},
			playoffs: {
				...playoffs2026,
				pick: p("final", 2026, "2026-09-27"),
			},
			newSeasonTeams: null,
		});
	});

	it("standingsPhases 2027-02-19, the first spring day: season 2027, the day's spring table, no regular-season table of its own", () =>
	{
		expect(standingsPhases("2027-02-19", ALL)).toEqual({
			season: 2027,
			spring: {
				startDate: "2027-02-19",
				endDate: "2027-03-24",
				pick: p("spring", 2027, "2027-02-19"),
			},
			regularSeason: {
				startDate: "2027-03-25",
				endDate: "2027-09-26",
				pick: null,
			},
			playoffs: {
				startDate: "2027-09-27",
				endDate: "2027-10-31",
				pick: null,
			},
			newSeasonTeams: p("final", 2027, "2027-09-26"),
		});
	});

	it("standingsPhases 2027-03-24, the last spring day: still no regular-season table", () =>
	{
		const plan = standingsPhases("2027-03-24", ALL);
		expect(plan.spring?.pick).toEqual(p("spring", 2027, "2027-03-24"));
		expect(plan.regularSeason.pick).toBeNull();
	});

	it("standingsPhases 2027-03-25, opening day: the day's regular-season table, spring as of its last day", () =>
	{
		const plan = standingsPhases("2027-03-25", ALL);
		expect(plan.spring?.pick).toEqual(p("spring", 2027, "2027-03-24"));
		expect(plan.regularSeason.pick).toEqual(p("regularSeason", 2027, "2027-03-25"));
		expect(plan.playoffs?.pick).toEqual(p("regularSeason", 2027, "2027-03-25"));
	});

	it("standingsPhases 2026-09-05, mid-season: every phase's dates, the day's table for the regular season and the playoffs", () =>
	{
		expect(standingsPhases("2026-09-05", ALL)).toEqual({
			season: 2026,
			spring: {
				...spring2026,
				pick: p("spring", 2026, "2026-03-24"),
			},
			regularSeason: {
				...regular2026,
				pick: p("regularSeason", 2026, "2026-09-05"),
			},
			playoffs: {
				...playoffs2026,
				pick: p("regularSeason", 2026, "2026-09-05"),
			},
			newSeasonTeams: null,
		});
	});

	it("standingsPhases 2026-09-27, the last regular-season day, is still the day's table", () =>
	{
		expect(standingsPhases("2026-09-27", ALL).regularSeason.pick).toEqual(p("regularSeason", 2026, "2026-09-27"));
	});

	it("standingsPhases 2026-09-28, the playoffs' first day: the final table", () =>
	{
		const plan = standingsPhases("2026-09-28", ALL);
		expect(plan.regularSeason.pick).toEqual(p("final", 2026, "2026-09-27"));
		expect(plan.playoffs).toEqual({
			...playoffs2026,
			pick: p("final", 2026, "2026-09-27"),
		});
	});

	it("standingsPhases after lastGameDate (2026-11-01) keeps the season, its dates and the final table", () =>
	{
		const plan = standingsPhases("2026-11-01", ALL);
		expect(plan.season).toBe(2026);
		expect(plan.playoffs).toEqual({
			...playoffs2026,
			pick: p("final", 2026, "2026-09-27"),
		});
	});

	it("standingsPhases before every known season: the day's regular-season table with no dates, no spring or playoffs", () =>
	{
		expect(standingsPhases("2025-01-10", ALL)).toEqual({
			season: 2025,
			spring: null,
			regularSeason: {
				startDate: null,
				endDate: null,
				pick: p("regularSeason", 2025, "2025-01-10"),
			},
			playoffs: null,
			newSeasonTeams: null,
		});
	});

	it("standingsPhases no calendar: the day's regular-season table with no dates", () =>
	{
		expect(standingsPhases("2026-09-05", [])).toEqual({
			season: 2026,
			spring: null,
			regularSeason: {
				startDate: null,
				endDate: null,
				pick: p("regularSeason", 2026, "2026-09-05"),
			},
			playoffs: null,
			newSeasonTeams: null,
		});
	});

	it("standingsPhases missing regularSeasonEndDate: such a calendar counts as no calendar", () =>
	{
		const { regularSeasonEndDate: _, ...partial } = S2026;
		expect(standingsPhases("2026-09-05", [partial])).toEqual({
			season: 2026,
			spring: null,
			regularSeason: {
				startDate: null,
				endDate: null,
				pick: p("regularSeason", 2026, "2026-09-05"),
			},
			playoffs: null,
			newSeasonTeams: null,
		});
	});

	it("standingsPhases no postseason day (lastGameDate is regularSeasonEndDate): playoffs is null; one day later it is a one-day phase", () =>
	{
		const short = {
			...S2026,
			lastGameDate: "2026-09-27", // 2026's regularSeasonEndDate
		};
		const plan = standingsPhases("2026-09-05", [short]);
		expect(plan.playoffs).toBeNull();
		expect(plan.regularSeason.pick).toEqual(p("regularSeason", 2026, "2026-09-05"));

		const oneDay = standingsPhases("2026-09-05", [{
			...S2026,
			lastGameDate: "2026-09-28", // regularSeasonEndDate + 1: a postseason of one day
		}]);
		expect(oneDay.playoffs).toEqual({
			startDate: "2026-09-28",
			endDate: "2026-09-28",
			pick: p("regularSeason", 2026, "2026-09-05"),
		});
	});

	it("standingsPhases newSeasonTeams: the new season's team list only from spring's first day through opening day", () =>
	{
		const teams2027 = p("final", 2027, "2027-09-26");
		expect(standingsPhases("2027-02-19", ALL).newSeasonTeams).toEqual(teams2027);
		expect(standingsPhases("2027-03-24", ALL).newSeasonTeams).toEqual(teams2027);
		expect(standingsPhases("2027-03-25", ALL).newSeasonTeams).toEqual(teams2027); // opening day's morning may still be empty
		expect(standingsPhases("2027-03-26", ALL).newSeasonTeams).toBeNull();
		expect(standingsPhases("2026-09-05", ALL).newSeasonTeams).toBeNull();
		expect(standingsPhases("2027-02-18", ALL).newSeasonTeams).toBeNull();
		expect(standingsPhases("2026-09-05", []).newSeasonTeams).toBeNull();
	});
});

describe("seasonSettling (S139)", () =>
{
	const settling = (today: string) => seasonSettling("2026-09-27", "2026-10-28", today);

	it("a season is ongoing before regularSeasonEndDate, in its postseason through the day after lastGameDate, then settled", () =>
	{
		expect(settling("2026-03-01")).toBe("ongoing");
		expect(settling("2026-09-26")).toBe("ongoing");
		expect(settling("2026-09-27")).toBe("postseason");
		expect(settling("2026-10-28")).toBe("postseason");
		expect(settling("2026-10-29")).toBe("postseason");
		expect(settling("2026-10-30")).toBe("settled");
		expect(settling("2027-01-15")).toBe("settled");
	});

	it("a season with no regularSeasonEndDate (no calendar for it) is never settled", () =>
	{
		expect(seasonSettling(undefined, undefined, "2030-01-01")).toBe("ongoing");
		expect(seasonSettling(null, "2026-10-28", "2030-01-01")).toBe("ongoing");
	});

	it("with no lastGameDate the window is regularSeasonEndDate and the day after", () =>
	{
		expect(seasonSettling("2026-09-27", null, "2026-09-28")).toBe("postseason");
		expect(seasonSettling("2026-09-27", null, "2026-09-29")).toBe("settled");
	});
});

/** A team record with the figures a real table has, for the table helpers' tests. */
function team(teamId: number, name: string, clinched: boolean): StandingsTeamRecord
{
	return {
		teamId,
		name,
		abbreviation: name.slice(0, 3).toUpperCase(),
		wins: 90,
		losses: 72,
		pct: ".556",
		gamesBack: "-",
		divisionRank: 1,
		streak: "W3",
		runsScored: 800,
		runsAllowed: 700,
		runDifferential: 100,
		divisionLeader: true,
		clinched,
		eliminationNumber: "-",
	};
}

const TABLE: StandingsSnapshot = {
	date: "2026-09-12",
	phase: "regularSeason",
	season: 2026,
	fetchedAt: "2026-09-12T15:00:00.000Z",
	windowMode: "cache",
	divisions: [
		{
			divisionId: 201,
			name: "AL East",
			leagueId: 103,
			teams: [team(139, "Tampa Bay Rays", true), team(147, "New York Yankees", false), team(111, "Boston Red Sox", true)],
		},
		{
			divisionId: 202,
			name: "AL Central",
			leagueId: 103,
			teams: [team(114, "Cleveland Guardians", false)],
		},
	],
};

describe("playoffsTable (S139)", () =>
{
	it("keeps only the clinched teams, in their order, leaves out a division with none, and keeps the table's labels", () =>
	{
		expect(playoffsTable(TABLE)).toEqual({
			...TABLE,
			divisions: [{
				...TABLE.divisions[0],
				teams: [team(139, "Tampa Bay Rays", true), team(111, "Boston Red Sox", true)],
			}],
		});
	});
});

describe("blankRegularSeasonTable (S139)", () =>
{
	it("lists the source's teams by name in their divisions at 0-0, every other figure blank, labelled the new season's regular season", () =>
	{
		const blank = blankRegularSeasonTable(TABLE, 2027, "2027-02-19");
		expect(blank).toMatchObject({
			date: "2027-02-19",
			phase: "regularSeason",
			season: 2027,
			fetchedAt: TABLE.fetchedAt,
			windowMode: "cache",
		});
		expect(blank.divisions.map((d) => [d.divisionId, d.name, d.leagueId])).toEqual([[201, "AL East", 103], [202, "AL Central", 103]]);
		const blankTeam = (teamId: number, name: string, abbreviation: string) => ({
			teamId,
			name,
			abbreviation,
			wins: 0,
			losses: 0,
			pct: null,
			gamesBack: null,
			divisionRank: null,
			streak: null,
			runsScored: null,
			runsAllowed: null,
			runDifferential: null,
			divisionLeader: false,
			clinched: false,
			clinchIndicator: null,
			eliminationNumber: null,
		});
		expect(blank.divisions[0]!.teams).toEqual([blankTeam(111, "Boston Red Sox", "BOS"), blankTeam(147, "New York Yankees", "NEW"), blankTeam(139, "Tampa Bay Rays", "TAM")]);
		expect(blank.divisions[1]!.teams).toEqual([blankTeam(114, "Cleveland Guardians", "CLE")]);
		expect(TABLE.divisions[0]!.teams[0]!.wins).toBe(90); // the source is left as it was
	});
});

describe("standingsChampion (S140 AC 2)", () =>
{
	const brewers = {
		teamId: 158,
		name: "Milwaukee Brewers",
		wonOn: "2026-10-28",
	};
	const dodgers = {
		teamId: 119,
		name: "Los Angeles Dodgers",
		wonOn: "2025-11-01",
	};
	const won = [{
		...S2025,
		champion: dodgers,
	}, {
		...S2026,
		champion: brewers,
	}, S2027];

	it("S140 AC 2: names the off-season's season's winner from the day it was won, through the day before the next spring", () =>
	{
		expect(standingsChampion("2026-10-28", won)).toEqual({
			season: 2026,
			...brewers,
		});
		expect(standingsChampion("2026-11-10", won)).toEqual({
			season: 2026,
			...brewers,
		});
		// January and February are last season's off-season, until the next spring's first game.
		expect(standingsChampion("2027-02-18", won)?.season).toBe(2026);
		expect(standingsChampion("2027-02-19", won)).toBeNull();
		expect(standingsChampion("2025-11-15", won)).toEqual({
			season: 2025,
			...dodgers,
		});
	});

	it("S140 AC 2: null on off-season days before the Series was won, in the season and in the spring", () =>
	{
		for (const day of ["2026-10-27", "2026-10-01", "2026-09-28", "2026-09-27", "2026-09-05", "2026-03-01", "2026-02-20"])
		{
			expect(standingsChampion(day, won)).toBeNull();
		}
	});

	it("S140 AC 2: null for a season with no winner, and with no calendar", () =>
	{
		expect(standingsChampion("2026-11-10", ALL)).toBeNull();
		expect(standingsChampion("2026-11-10", [])).toBeNull();
		// A winner on a calendar with no regular-season dates: the day's pick isn't `final`, so no winner is named.
		expect(standingsChampion("2026-11-10", [{
			season: 2026,
			springStartDate: "2026-02-20",
			lastGameDate: "2026-10-28",
			champion: brewers,
		}])).toBeNull();
	});
});
