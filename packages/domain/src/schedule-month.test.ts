import {
	describe, expect, it,
} from "vitest";
import {
	dayRegularSeason, dayRegularSeasonTeamIds, distinctTeamIds, favoriteTeamsOff, latestScheduleMonth, monthGameCounts, monthGamesState, monthLastChangedAt,
	scheduleFillWindow, storedGameType, teamsInOwnSeason,
} from "./schedule-month.js";

describe("monthGameCounts (S124, S136 AC 1)", () =>
{
	it("gives each date its stored count and teams, 0 and [] for a stored day with no games, null for both with no stored day", () =>
	{
		expect(monthGameCounts(["2026-09-04", "2026-09-05", "2026-09-06"], [
			{
				date: "2026-09-05",
				gameCount: 2,
				teamIds: [108, 111, 117, 147],
				gameTypes: ["R", "S"],
				regularSeason: true,
				regularSeasonTeamIds: [108, 147],
			},
			{
				date: "2026-09-06",
				gameCount: 0,
				teamIds: [],
				gameTypes: [],
				regularSeason: false,
				regularSeasonTeamIds: [],
			},
		])).toEqual([
			{
				date: "2026-09-04",
				count: null,
				teamIds: null,
				regularSeason: null,
				regularSeasonTeamIds: null,
				inSeasonTeamIds: null,
			},
			{
				date: "2026-09-05",
				count: 2,
				teamIds: [108, 111, 117, 147],
				regularSeason: true,
				regularSeasonTeamIds: [108, 147],
				inSeasonTeamIds: null,
			},
			{
				date: "2026-09-06",
				count: 0,
				teamIds: [],
				regularSeason: false,
				regularSeasonTeamIds: [],
				inSeasonTeamIds: null,
			},
		]);
	});

	it("S167 AC 3: a stored day keeps the regularSeason its tally gives, null included (a day stored before S167); an unknown day is null", () =>
	{
		expect(monthGameCounts(["2024-07-04", "2024-07-05"], [
			{
				date: "2024-07-04",
				gameCount: 2,
				teamIds: [111, 120, 121, 147],
				gameTypes: [null, null],
				regularSeason: null,
				regularSeasonTeamIds: null,
			},
		]).map((day) => [day.date, day.count, day.regularSeason])).toEqual([
			["2024-07-04", 2, null],
			["2024-07-05", null, null],
		]);
	});
});

describe("dayRegularSeason (S167 AC 2)", () =>
{
	it("S167 AC 2 R among others: true when any game is R", () =>
	{
		expect(dayRegularSeason(["S", "R", "E"])).toBe(true);
	});

	it("S167 AC 2 only S: false for a spring-training day", () =>
	{
		expect(dayRegularSeason(["S", "S"])).toBe(false);
	});

	it("S167 AC 2 only A: false for the All-Star Game's day", () =>
	{
		expect(dayRegularSeason(["A"])).toBe(false);
	});

	it("S167 AC 2 postseason: false for a day of only F, D, L or W games", () =>
	{
		expect(dayRegularSeason(["F", "F"])).toBe(false);
		expect(dayRegularSeason(["D", "L"])).toBe(false);
		expect(dayRegularSeason(["W"])).toBe(false);
	});

	it("S167 AC 2 no games: false for a stored day with no games", () =>
	{
		expect(dayRegularSeason([])).toBe(false);
	});

	it("S167 AC 2 S and untyped: null when no game is R and one has no type (it could have been regular season)", () =>
	{
		expect(dayRegularSeason(["S", null])).toBeNull();
		expect(dayRegularSeason([undefined])).toBeNull();
		expect(dayRegularSeason(["S", 82])).toBeNull();
	});

	it("S167 AC 2 R and untyped: true, since the R game settles it", () =>
	{
		expect(dayRegularSeason([null, "R"])).toBe(true);
	});
});

describe("storedGameType (S167, ADR-025)", () =>
{
	it("keeps a string type as it is and counts anything else (missing, null, a number, an object) as no type", () =>
	{
		expect(storedGameType("R")).toBe("R");
		expect(storedGameType("A")).toBe("A");
		expect(storedGameType("")).toBe("");
		expect(storedGameType(undefined)).toBeNull();
		expect(storedGameType(null)).toBeNull();
		expect(storedGameType(82)).toBeNull();
		expect(storedGameType({})).toBeNull();
	});
});

describe("distinctTeamIds (S136 AC 1)", () =>
{
	it("lists each team once, in ascending numeric order (not string order)", () =>
	{
		expect(distinctTeamIds([147, 111, 9, 147, 111, 108])).toEqual([9, 108, 111, 147]);
		expect(distinctTeamIds([])).toEqual([]);
	});

	it("drops whatever isn't an integer team ID (null, a string, NaN, a fraction), so a bad stored ID adds no team", () =>
	{
		expect(distinctTeamIds([147, null, "111", Number.NaN, 1.5, undefined, 108])).toEqual([108, 147]);
	});
});

describe("favoriteTeamsOff (S159 AC 1)", () =>
{
	// MLB team IDs: Yankees 147, Mets 121, Red Sox 111, Dodgers 119, Angels 108, Rays 139, and the
	// All-Star Game's two league teams, AL 159 and NL 160.
	const YANKEES = 147;
	const METS = 121;
	const RAYS = 139;
	// A regular-season month in which every favorite these cases use plays at least once.
	const month = [
		{
			teamIds: [111, 121, 147, 119],
			regularSeason: true,
		},
		{
			teamIds: [108, 119],
			regularSeason: true,
		},
	];
	const regular = (teamIds: number[]) => ({
		teamIds,
		regularSeason: true,
	});

	it("S159 AC 1 no favorites: a fan with no favorites gets no mark", () =>
	{
		expect(favoriteTeamsOff(regular([108, 119]), [], month)).toBeNull();
	});

	it("S159 AC 1 teamIds null: a day BT holds no schedule for gets no mark", () =>
	{
		expect(favoriteTeamsOff({
			teamIds: null,
			regularSeason: true,
		}, [YANKEES], month)).toBeNull();
	});

	it("S159 AC 1 teamIds missing: a day cached before S136 (no teamIds at all) gets no mark", () =>
	{
		expect(favoriteTeamsOff({
			regularSeason: true,
		}, [YANKEES], month)).toBeNull();
	});

	it("S159 AC 1 no games: a day with no games ([]) gets no mark, since A8 dims it already", () =>
	{
		expect(favoriteTeamsOff(regular([]), [YANKEES], month)).toBeNull();
	});

	it("S159 AC 1 one off: one favorite that doesn't play is red", () =>
	{
		expect(favoriteTeamsOff(regular([108, 119]), [YANKEES], month)).toEqual({
			mark: "red",
			off: [YANKEES],
		});
	});

	it("S159 AC 1 two off: two favorites both off are red, in the fan's order, not teamIds' or numeric order", () =>
	{
		expect(favoriteTeamsOff(regular([108, 119]), [YANKEES, METS], month)).toEqual({
			mark: "red",
			off: [YANKEES, METS],
		});
		expect(favoriteTeamsOff(regular([108, 119]), [METS, YANKEES], month)).toEqual({
			mark: "red",
			off: [METS, YANKEES],
		});
	});

	it("S159 AC 1 one plays: two favorites with one playing are yellow, naming the other", () =>
	{
		expect(favoriteTeamsOff(regular([121, 119]), [YANKEES, METS], month)).toEqual({
			mark: "yellow",
			off: [YANKEES],
		});
	});

	it("S159 AC 1 all play: every favorite playing gets no mark", () =>
	{
		expect(favoriteTeamsOff(regular([111, 121, 147, 119]), [YANKEES, METS], month)).toBeNull();
	});

	it("S159 AC 1 listed twice: a favorite listed twice is named once", () =>
	{
		expect(favoriteTeamsOff(regular([108, 119]), [YANKEES, YANKEES], month)).toEqual({
			mark: "red",
			off: [YANKEES],
		});
		expect(favoriteTeamsOff(regular([121, 119]), [YANKEES, METS, YANKEES], month)).toEqual({
			mark: "yellow",
			off: [YANKEES],
		});
	});

	it("S159 AC 1 empty month: no days in the month means no favorite has a game in it", () =>
	{
		expect(favoriteTeamsOff(regular([108, 119]), [YANKEES], [])).toBeNull();
	});

	it("S159 AC 1 month unstored: a month whose days all have teamIds null puts no favorite in it", () =>
	{
		const unknown = [{
			teamIds: null,
			regularSeason: null,
		}, {
			teamIds: null,
			regularSeason: null,
		}];
		expect(favoriteTeamsOff(regular([108, 119]), [YANKEES], unknown)).toBeNull();
	});

	it("S159 AC 1 regularSeason false: a day without a regular-season game gets no mark", () =>
	{
		expect(favoriteTeamsOff({
			teamIds: [108, 119],
			regularSeason: false,
		}, [YANKEES], month)).toBeNull();
	});

	it("S159 AC 1 regularSeason null: a day stored before S167 gets no mark", () =>
	{
		expect(favoriteTeamsOff({
			teamIds: [108, 119],
			regularSeason: null,
		}, [YANKEES], month)).toBeNull();
	});

	it("S159 AC 1 regularSeason missing: a day cached before S167 (no regularSeason at all) gets no mark", () =>
	{
		expect(favoriteTeamsOff({
			teamIds: [108, 119],
		}, [YANKEES], month)).toBeNull();
	});

	it("S159 AC 1 october 2023: a Yankees-only fan gets no mark on October 1 (they played) or on a postseason day", () =>
	{
		// October 1, 2023 was the regular season's last day (Yankees at Royals); the later days hold
		// only other teams' postseason games.
		const october1 = {
			teamIds: [118, 147, 110, 140],
			regularSeason: true,
		};
		const postseason = {
			teamIds: [110, 117, 140, 146],
			regularSeason: false,
		};
		const october = [october1, postseason, {
			teamIds: [119, 109],
			regularSeason: false,
		}];
		expect(favoriteTeamsOff(october1, [YANKEES], october)).toBeNull();
		expect(favoriteTeamsOff(postseason, [YANKEES], october)).toBeNull();
	});

	it("S159 AC 1 yankees off: a regular-season day the Yankees don't play, while others do, is red", () =>
	{
		const season = [regular([147, 111]), regular([108, 119, 111, 110])];
		expect(favoriteTeamsOff(season[1]!, [YANKEES], season)).toEqual({
			mark: "red",
			off: [YANKEES],
		});
	});

	it("S159 AC 1 before 1998: Rays and Yankees in a month before the Rays existed never mark a day for the Rays", () =>
	{
		const yankeesDay = regular([147, 111]);
		const otherDay = regular([108, 119, 111, 110]);
		const month1997 = [yankeesDay, otherDay];
		expect(favoriteTeamsOff(yankeesDay, [RAYS, YANKEES], month1997)).toBeNull();
		expect(favoriteTeamsOff(otherDay, [RAYS, YANKEES], month1997)).toEqual({
			mark: "red",
			off: [YANKEES],
		});
	});

	it("S159 AC 1 july all-star: an off day is red, the All-Star Game's day and an empty break day carry no mark", () =>
	{
		const offDay = regular([108, 119, 111, 110]);
		const allStar = {
			teamIds: [159, 160],
			regularSeason: false,
		};
		const breakDay = {
			teamIds: [],
			regularSeason: false,
		};
		const july = [regular([147, 111]), offDay, breakDay, allStar];
		expect(favoriteTeamsOff(offDay, [YANKEES], july)).toEqual({
			mark: "red",
			off: [YANKEES],
		});
		expect(favoriteTeamsOff(allStar, [YANKEES], july)).toBeNull();
		expect(favoriteTeamsOff(breakDay, [YANKEES], july)).toBeNull();
	});

	it("S159 AC 1 unstored favorite: a favorite whose only games fall on unstored days is never named", () =>
	{
		// The Mets' only games that month are on a day whose teamIds is null (unstored).
		const unstored = {
			teamIds: null,
			regularSeason: null,
		};
		const yankeesDay = regular([147, 111]);
		const otherDay = regular([108, 119]);
		const days = [unstored, yankeesDay, otherDay];
		for (const day of days) expect(favoriteTeamsOff(day, [METS], days)).toBeNull();
		expect(favoriteTeamsOff(otherDay, [METS, YANKEES], days)).toEqual({
			mark: "red",
			off: [YANKEES],
		});
		expect(favoriteTeamsOff(yankeesDay, [METS, YANKEES], days)).toBeNull();
	});

	it("S159 AC 1 postseason-only favorite: a favorite whose only game that month isn't regular season still counts", () =>
	{
		// The Mets' only day that month is a postseason one (regularSeason false); "regular season" is per day, not per team.
		const metsDay = {
			teamIds: [121, 111],
			regularSeason: false,
		};
		const otherDay = regular([108, 119]);
		const days = [metsDay, otherDay];
		expect(favoriteTeamsOff(metsDay, [METS], days)).toBeNull();
		expect(favoriteTeamsOff(otherDay, [METS], days)).toEqual({
			mark: "red",
			off: [121],
		});
	});

	it("S159 AC 1 ScheduleDayCount fits: a month answer's days are accepted as they are", () =>
	{
		const days = monthGameCounts(["2026-07-01", "2026-07-02"], [
			{
				date: "2026-07-01",
				gameCount: 1,
				teamIds: [147, 111],
				gameTypes: ["R"],
				regularSeason: true,
				regularSeasonTeamIds: [111, 147],
			},
			{
				date: "2026-07-02",
				gameCount: 1,
				teamIds: [108, 119],
				gameTypes: ["R"],
				regularSeason: true,
				regularSeasonTeamIds: [108, 119],
			},
		]);
		expect(favoriteTeamsOff(days[1]!, [YANKEES], days)).toEqual({
			mark: "red",
			off: [YANKEES],
		});
	});
});

describe("monthGamesState (S136 AC 4)", () =>
{
	it("S136 AC 4 every day 0: a month with days and no games is none", () =>
	{
		expect(monthGamesState([{
			count: 0,
		}, {
			count: 0,
		}])).toBe("none");
	});

	it("S136 AC 4 every day null: a month BT holds nothing for is unknown", () =>
	{
		expect(monthGamesState([{
			count: null,
		}, {
			count: null,
		}])).toBe("unknown");
	});

	it("S136 AC 4 0 and null: a month with an unknown day and no games can't be called empty", () =>
	{
		expect(monthGamesState([{
			count: 0,
		}, {
			count: null,
		}, {
			count: 0,
		}])).toBe("unknown");
	});

	it("S136 AC 4 one above 0: one day with games among unknown days is games", () =>
	{
		expect(monthGamesState([{
			count: null,
		}, {
			count: 3,
		}, {
			count: null,
		}])).toBe("games");
		expect(monthGamesState([{
			count: 0,
		}, {
			count: 1,
		}])).toBe("games");
	});

	it("S136 AC 4 no days: an empty list (loading, or a failed request) is unknown", () =>
	{
		expect(monthGamesState([])).toBe("unknown");
	});
});

describe("monthLastChangedAt (S124)", () =>
{
	it("is the latest change among the stored days, undefined with none", () =>
	{
		expect(monthLastChangedAt([])).toBeUndefined();
		expect(monthLastChangedAt([
			{
				lastChangedAt: "2026-09-05T10:00:00.000Z",
			},
			{
				lastChangedAt: "2026-10-01T00:00:00.000Z",
			},
			{
				lastChangedAt: "2026-09-30T00:00:00.000Z",
			},
		])).toBe("2026-10-01T00:00:00.000Z");
	});

	it("skips a stamp that doesn't parse, wherever it is", () =>
	{
		expect(monthLastChangedAt([
			{
				lastChangedAt: null as unknown as string,
			},
			{
				lastChangedAt: "2026-09-05T10:00:00.000Z",
			},
			{
				lastChangedAt: "not a time",
			},
		])).toBe("2026-09-05T10:00:00.000Z");
	});
});

describe("scheduleFillWindow and latestScheduleMonth (S124)", () =>
{
	it("runs from the current season's first day through December 31 of next year", () =>
	{
		expect(scheduleFillWindow("2026-11-09")).toEqual({
			first: "2026-01-01",
			last: "2027-12-31",
		});
		expect(scheduleFillWindow("2026-12-31")).toEqual({
			first: "2026-01-01",
			last: "2027-12-31",
		});
		expect(scheduleFillWindow("2027-01-01")).toEqual({
			first: "2027-01-01",
			last: "2028-12-31",
		});
	});

	it("latestScheduleMonth is December of next year", () =>
	{
		expect(latestScheduleMonth("2026-11-09")).toBe("2027-12");
		expect(latestScheduleMonth("2027-01-01")).toBe("2028-12");
	});
});

describe("dayRegularSeasonTeamIds (S191 AC 1)", () =>
{
	const game = (gameType: unknown, away: unknown, home: unknown) => ({
		gameType,
		teamIds: [away, home],
	});

	it("S191 AC 1 regular only: every game R gives every team, each once, ascending", () =>
	{
		expect(dayRegularSeasonTeamIds([game("R", 147, 111), game("R", 119, 108), game("R", 111, 147)])).toEqual([108, 111, 119, 147]);
	});

	it("S191 AC 1 mixed: a spring-and-regular day (the 2024-03-20 Seoul opener) gives only the R game's teams", () =>
	{
		expect(dayRegularSeasonTeamIds([game("S", 147, 111), game("R", 119, 135), game("S", 108, 136)])).toEqual([119, 135]);
	});

	it("S191 AC 1 none regular: a typed day without an R game, and a day with no games, give []", () =>
	{
		expect(dayRegularSeasonTeamIds([game("S", 147, 111), game("A", 159, 160)])).toEqual([]);
		expect(dayRegularSeasonTeamIds([])).toEqual([]);
	});

	it("S191 AC 1 untyped: null exactly when dayRegularSeason is null; an R day with an untyped game keeps only the R game's teams", () =>
	{
		expect(dayRegularSeasonTeamIds([game(undefined, 147, 111)])).toBeNull();
		expect(dayRegularSeasonTeamIds([game("S", 147, 111), game(null, 119, 108)])).toBeNull();
		expect(dayRegularSeasonTeamIds([game("R", 147, 111), game(82, 119, 108)])).toEqual([111, 147]);
	});

	it("S191 AC 1 stored values: a null or string team ID adds no team", () =>
	{
		expect(dayRegularSeasonTeamIds([game("R", null, "111"), game("R", 147, 147)])).toEqual([147]);
	});
});

/**
 * A calendar year of stored days for {@link teamsInOwnSeason}: every day stored with no
 * regular-season game except those `regular` lists (one `R` game type each); `untyped` days are
 * stored without types (`null`), `untypedBesideR` days get an untyped game beside their `R` ones,
 * and `unstored` days are left out.
 */
function storedYear(year: number, regular: Record<string, number[]>, options: { untyped?: string[];
	untypedBesideR?: string[];
	unstored?: string[]; } = {})
{
	const days: { date: string;
		gameTypes: (string | null)[];
		regularSeasonTeamIds: number[] | null; }[] = [];
	for (let date = new Date(Date.UTC(year, 0, 1)); date.getUTCFullYear() === year; date.setUTCDate(date.getUTCDate() + 1))
	{
		const iso = date.toISOString().slice(0, 10);
		if (options.unstored?.includes(iso)) continue;
		const untyped = options.untyped?.includes(iso) ?? false;
		days.push({
			date: iso,
			gameTypes: untyped ? [null] : [...(regular[iso] ? ["R"] : []), ...(options.untypedBesideR?.includes(iso) ? [null] : [])],
			regularSeasonTeamIds: untyped ? null : regular[iso] ?? [],
		});
	}
	return days;
}

// MLB team IDs these cases use.
const DODGERS = 119;
const PADRES = 135;
const YANKEES_ID = 147;
const RED_SOX = 111;
const MARINERS = 136;
const ATHLETICS = 133;
const CUBS = 112;
const BREWERS = 158;
const ROCKIES = 115;
const CARDINALS = 138;

/** 2024, modelled: the Seoul series (Dodgers–Padres, March 20–21), then everyone from March 28 through September 29. */
function season2024()
{
	const regular: Record<string, number[]> = {
		"2024-03-20": [DODGERS, PADRES],
		"2024-03-21": [DODGERS, PADRES],
		"2024-03-28": [DODGERS, PADRES, YANKEES_ID, RED_SOX],
		"2024-06-15": [DODGERS, YANKEES_ID],
		"2024-06-16": [PADRES, RED_SOX],
		"2024-09-29": [DODGERS, PADRES, YANKEES_ID, RED_SOX],
	};
	return regular;
}

describe("teamsInOwnSeason (S191 AC 2)", () =>
{
	it("S191 AC 2 seoul: on the Seoul opener only the Dodgers and Padres are in season; both stay in season through the days between; all are in season from March 28", () =>
	{
		const year = storedYear(2024, season2024());
		expect(teamsInOwnSeason(year, ["2024-03-20", "2024-03-25", "2024-03-28", "2024-06-16", "2024-09-29", "2024-09-30"])).toEqual([
			[DODGERS, PADRES],
			[DODGERS, PADRES],
			[RED_SOX, DODGERS, PADRES, YANKEES_ID],
			[RED_SOX, DODGERS, PADRES, YANKEES_ID],
			[RED_SOX, DODGERS, PADRES, YANKEES_ID],
			[],
		]);
	});

	it("S191 AC 2 first game in the month before: a month's dates read the year, so a team whose first game was in March is in season on April 1", () =>
	{
		// The Mariners and Athletics open in Tokyo on 2019-03-20 and play next on April 2.
		const year = storedYear(2019, {
			"2019-03-20": [ATHLETICS, MARINERS],
			"2019-04-02": [ATHLETICS, MARINERS, YANKEES_ID, RED_SOX],
			"2019-09-29": [ATHLETICS, MARINERS, YANKEES_ID, RED_SOX],
		});
		expect(teamsInOwnSeason(year, ["2019-04-01", "2019-04-02"])).toEqual([
			[ATHLETICS, MARINERS],
			[RED_SOX, ATHLETICS, MARINERS, YANKEES_ID],
		]);
	});

	it("S191 AC 2 untyped day: an untyped day before a date that a not-yet-started team needs is unknown, so the date is null", () =>
	{
		const year = storedYear(2024, season2024(), {
			untyped: ["2024-03-15"],
		});
		expect(teamsInOwnSeason(year, ["2024-03-20"])).toEqual([null]);
		// Mid-season, every team is proven in by games on both sides; the untyped March day doesn't matter.
		expect(teamsInOwnSeason(year, ["2024-06-16"])).toEqual([[RED_SOX, DODGERS, PADRES, YANKEES_ID]]);
	});

	it("S191 AC 2 unstored day: an unstored day after a date whose ended teams need it is unknown, so the date is null", () =>
	{
		// 2018: everyone through September 30; the Brewers, Cubs, Dodgers and Rockies again on October 1.
		const regular = {
			"2018-03-29": [BREWERS, CUBS, DODGERS, ROCKIES, YANKEES_ID, CARDINALS],
			"2018-09-30": [BREWERS, CUBS, DODGERS, ROCKIES, YANKEES_ID, CARDINALS],
			"2018-10-01": [BREWERS, CUBS, DODGERS, ROCKIES],
		};
		expect(teamsInOwnSeason(storedYear(2018, regular), ["2018-10-01"])).toEqual([[CUBS, ROCKIES, DODGERS, BREWERS].sort((a, b) => a - b)]);
		expect(teamsInOwnSeason(storedYear(2018, regular, {
			unstored: ["2018-10-05"],
		}), ["2018-10-01"])).toEqual([null]);
	});

	it("S191 AC 2 boundary: a year fully stored except the date itself can't tell that date (2018-10-01, 2024-03-20)", () =>
	{
		const regular = {
			"2018-03-29": [BREWERS, CUBS, DODGERS, ROCKIES, YANKEES_ID, CARDINALS],
			"2018-09-30": [BREWERS, CUBS, DODGERS, ROCKIES, YANKEES_ID, CARDINALS],
			"2018-10-01": [BREWERS, CUBS, DODGERS, ROCKIES],
		};
		expect(teamsInOwnSeason(storedYear(2018, regular, {
			unstored: ["2018-10-01"],
		}), ["2018-10-01"])).toEqual([null]);
		expect(teamsInOwnSeason(storedYear(2018, regular, {
			untyped: ["2018-10-01"],
		}), ["2018-10-01"])).toEqual([null]);
		// The other edge: 2024 fully stored except the Seoul opener itself can't tell March 20.
		expect(teamsInOwnSeason(storedYear(2024, season2024(), {
			unstored: ["2024-03-20"],
		}), ["2024-03-20"])).toEqual([null]);
	});

	it("S191 AC 2 untyped beside R: a day with an untyped game beside its R games is unknown, though its R teams still count as having played", () =>
	{
		// The Seoul opener with an untyped game beside it: a team in that game could have opened too.
		const year = storedYear(2024, season2024(), {
			untypedBesideR: ["2024-03-20"],
		});
		expect(teamsInOwnSeason(year, ["2024-03-20"])).toEqual([null]);
		// Later dates: every team is proven in by games on both sides, the Dodgers and Padres by March 20's R game included.
		expect(teamsInOwnSeason(year, ["2024-06-16"])).toEqual([[RED_SOX, DODGERS, PADRES, YANKEES_ID]]);
		// March 21 needs January 1 through the 21st known for the Yankees, which aren't in season yet: it can't tell.
		expect(teamsInOwnSeason(year, ["2024-03-21"])).toEqual([null]);
	});

	it("S191 AC 2 off-season: a fully stored year has no team in season in January or December; a year with nothing stored can't tell", () =>
	{
		const year = storedYear(2024, season2024());
		expect(teamsInOwnSeason(year, ["2024-01-15", "2024-12-01"])).toEqual([[], []]);
		expect(teamsInOwnSeason([], ["2024-07-01"])).toEqual([null]);
		// A date in another year than the stored one reads its own year, which holds nothing.
		expect(teamsInOwnSeason(year, ["2025-07-01"])).toEqual([null]);
	});

	it("S191 AC 2 month answer: monthGameCounts carries each date's inSeasonTeamIds and regularSeasonTeamIds from the year", () =>
	{
		const year = storedYear(2024, season2024()).map((day) => ({
			...day,
			gameCount: day.regularSeasonTeamIds?.length ? 1 : 0,
			teamIds: day.regularSeasonTeamIds ?? [],
			regularSeason: day.regularSeasonTeamIds === null ? null : day.regularSeasonTeamIds.length > 0,
		}));
		const march = monthGameCounts(["2024-03-20", "2024-03-21"], year);
		expect(march.map((day) => [day.regularSeasonTeamIds, day.inSeasonTeamIds])).toEqual([
			[[DODGERS, PADRES], [DODGERS, PADRES]],
			[[DODGERS, PADRES], [DODGERS, PADRES]],
		]);
	});
});

describe("favoriteTeamsOff follows each team's own season (S191 AC 3)", () =>
{
	// Spring-training teams playing beside the Seoul and Tokyo openers.
	const SPRING = [108, 110, 114, 116];

	it("S191 AC 3 seoul yankees with spring: a Yankees-only fan gets no mark on 2024-03-20 though the Yankees had a spring game that month", () =>
	{
		const seoul = {
			teamIds: [DODGERS, PADRES, ...SPRING],
			regularSeason: true,
			inSeasonTeamIds: [DODGERS, PADRES],
		};
		const yankeesSpring = {
			teamIds: [YANKEES_ID, RED_SOX],
			regularSeason: false,
			inSeasonTeamIds: [DODGERS, PADRES],
		};
		const march = [yankeesSpring, seoul];
		expect(favoriteTeamsOff(seoul, [YANKEES_ID], march)).toBeNull();
		// S159's per-day rule alone marked it red.
		expect(favoriteTeamsOff({
			teamIds: seoul.teamIds,
			regularSeason: true,
		}, [YANKEES_ID], march)).toEqual({
			mark: "red",
			off: [YANKEES_ID],
		});
	});

	it("S191 AC 3 seoul yankees without spring: over a modelled 2024 year, a Yankees-only fan gets no mark on 2024-03-20 when their only March game is the 28th", () =>
	{
		const year = storedYear(2024, season2024()).map((day) => ({
			...day,
			gameCount: day.regularSeasonTeamIds?.length ? 1 : 0,
			teamIds: day.regularSeasonTeamIds ?? [],
			regularSeason: day.regularSeasonTeamIds === null ? null : day.regularSeasonTeamIds.length > 0,
		}));
		const march = monthGameCounts(Array.from({
			length: 31,
		}, (_, i) => `2024-03-${String(i + 1).padStart(2, "0")}`), year);
		const seoul = march.find((day) => day.date === "2024-03-20")!;
		expect(favoriteTeamsOff(seoul, [YANKEES_ID], march)).toBeNull();
		expect(favoriteTeamsOff(march.find((day) => day.date === "2024-03-21")!, [YANKEES_ID], march)).toBeNull();
	});

	it("S191 AC 3 seoul dodgers: a Dodgers fan gets no mark, they play", () =>
	{
		const seoul = {
			teamIds: [DODGERS, PADRES, ...SPRING],
			regularSeason: true,
			inSeasonTeamIds: [DODGERS, PADRES],
		};
		expect(favoriteTeamsOff(seoul, [DODGERS], [seoul])).toBeNull();
	});

	it("S191 AC 3 seoul padres and yankees: a Padres-and-Yankees fan gets no mark (the Padres play; the Yankees aren't in season)", () =>
	{
		const seoul = {
			teamIds: [DODGERS, PADRES, ...SPRING],
			regularSeason: true,
			inSeasonTeamIds: [DODGERS, PADRES],
		};
		const later = {
			teamIds: [YANKEES_ID, RED_SOX],
			regularSeason: true,
			inSeasonTeamIds: [DODGERS, PADRES, YANKEES_ID, RED_SOX],
		};
		expect(favoriteTeamsOff(seoul, [PADRES, YANKEES_ID], [seoul, later])).toBeNull();
	});

	it("S191 AC 3 tokyo 2019: a Yankees-only fan gets no mark on March 20 or 21 (Mariners–Athletics)", () =>
	{
		const tokyo = {
			teamIds: [ATHLETICS, MARINERS, YANKEES_ID, ...SPRING],
			regularSeason: true,
			inSeasonTeamIds: [ATHLETICS, MARINERS],
		};
		const tokyo2 = {
			teamIds: [ATHLETICS, MARINERS, ...SPRING],
			regularSeason: true,
			inSeasonTeamIds: [ATHLETICS, MARINERS],
		};
		const march = [tokyo, tokyo2, {
			teamIds: [YANKEES_ID, RED_SOX],
			regularSeason: true,
			inSeasonTeamIds: [RED_SOX, ATHLETICS, MARINERS, YANKEES_ID],
		}];
		expect(favoriteTeamsOff(tokyo, [YANKEES_ID], march)).toBeNull();
		expect(favoriteTeamsOff(tokyo2, [YANKEES_ID], march)).toBeNull();
	});

	it("S191 AC 3 tokyo 2025: a Yankees-only fan gets no mark on March 18 or 19 (Cubs–Dodgers)", () =>
	{
		const tokyo = {
			teamIds: [CUBS, DODGERS, ...SPRING],
			regularSeason: true,
			inSeasonTeamIds: [CUBS, DODGERS],
		};
		const march = [tokyo, {
			teamIds: [YANKEES_ID, RED_SOX],
			regularSeason: false,
			inSeasonTeamIds: [CUBS, DODGERS],
		}];
		// March 18 and 19 are alike: the same two teams in season, the rest in spring training.
		for (const day of [tokyo, {
			...tokyo,
			teamIds: [CUBS, DODGERS, 109, 140],
		}]) expect(favoriteTeamsOff(day, [YANKEES_ID], march)).toBeNull();
	});

	it("S191 AC 3 tokyo 2019-03-22 mariners: a Mariners fan gets no mark on a day of only spring games", () =>
	{
		const springOnly = {
			teamIds: [MARINERS, ...SPRING],
			regularSeason: false,
			inSeasonTeamIds: [ATHLETICS, MARINERS],
		};
		const tokyo = {
			teamIds: [ATHLETICS, MARINERS],
			regularSeason: true,
			inSeasonTeamIds: [ATHLETICS, MARINERS],
		};
		expect(favoriteTeamsOff(springOnly, [MARINERS], [tokyo, springOnly])).toBeNull();
	});

	// 2018-10-01: two tiebreakers (Brewers–Cubs, Dodgers–Rockies), regular season; everyone else's season ended September 30.
	const tiebreakers = {
		teamIds: [CUBS, ROCKIES, DODGERS, BREWERS],
		regularSeason: true,
		inSeasonTeamIds: [CUBS, ROCKIES, DODGERS, BREWERS],
	};
	// The Yankees' wild-card game (October 3) and a Cardinals day put both teams in the shown month.
	const october2018 = [tiebreakers, {
		teamIds: [YANKEES_ID, 133],
		regularSeason: false,
		inSeasonTeamIds: [],
	}, {
		teamIds: [CARDINALS, 158],
		regularSeason: false,
		inSeasonTeamIds: [],
	}];

	it("S191 AC 3 tiebreaker yankees: a Yankees-only fan gets no mark on 2018-10-01 (their season ended September 30)", () =>
	{
		expect(favoriteTeamsOff(tiebreakers, [YANKEES_ID], october2018)).toBeNull();
	});

	it("S191 AC 3 tiebreaker cubs and yankees: a Cubs-and-Yankees fan gets no mark (the Cubs play)", () =>
	{
		expect(favoriteTeamsOff(tiebreakers, [CUBS, YANKEES_ID], october2018)).toBeNull();
	});

	it("S191 AC 3 tiebreaker cardinals: a Cardinals fan gets no mark", () =>
	{
		expect(favoriteTeamsOff(tiebreakers, [CARDINALS], october2018)).toBeNull();
	});

	const allTeams = Array.from({
		length: 40,
	}, (_, i) => 108 + i).concat([158]);

	it("S191 AC 3 mid-season: an ordinary day the Yankees don't play is still red, off [147]", () =>
	{
		const day = {
			teamIds: [108, 119],
			regularSeason: true,
			inSeasonTeamIds: allTeams,
		};
		const month = [day, {
			teamIds: [YANKEES_ID, RED_SOX],
			regularSeason: true,
			inSeasonTeamIds: allTeams,
		}];
		expect(favoriteTeamsOff(day, [YANKEES_ID], month)).toEqual({
			mark: "red",
			off: [147],
		});
		// A favorite out of season beside one in season: only the in-season one is counted.
		expect(favoriteTeamsOff({
			...day,
			inSeasonTeamIds: [108, 119, YANKEES_ID],
		}, [RED_SOX, YANKEES_ID], month)).toEqual({
			mark: "red",
			off: [YANKEES_ID],
		});
	});

	it("S191 AC 3 missing: a day without inSeasonTeamIds (an answer cached before S191) keeps S159's rule", () =>
	{
		const month = [{
			teamIds: [YANKEES_ID, RED_SOX],
			regularSeason: true,
		}];
		expect(favoriteTeamsOff({
			teamIds: [108, 119],
			regularSeason: true,
		}, [YANKEES_ID], month)).toEqual({
			mark: "red",
			off: [YANKEES_ID],
		});
		expect(favoriteTeamsOff({
			teamIds: [DODGERS, PADRES],
			regularSeason: true,
		}, [YANKEES_ID], month)).toEqual({
			mark: "red",
			off: [YANKEES_ID],
		});
	});

	it("S191 AC 3 null: a day whose inSeasonTeamIds is null (the year can't tell) keeps S159's rule", () =>
	{
		const month = [{
			teamIds: [YANKEES_ID, RED_SOX],
			regularSeason: true,
			inSeasonTeamIds: null,
		}];
		expect(favoriteTeamsOff({
			teamIds: [108, 119],
			regularSeason: true,
			inSeasonTeamIds: null,
		}, [YANKEES_ID, RED_SOX], month)).toEqual({
			mark: "red",
			off: [YANKEES_ID, RED_SOX],
		});
	});
});
