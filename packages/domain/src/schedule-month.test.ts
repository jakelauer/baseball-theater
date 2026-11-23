import {
	describe, expect, it,
} from "vitest";
import {
	dayRegularSeason, distinctTeamIds, favoriteTeamsOff, latestScheduleMonth, monthComplete, monthGameCounts, monthGamesState, monthLastChangedAt,
	scheduleFillWindow, storedGameType,
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
				regularSeason: true,
			},
			{
				date: "2026-09-06",
				gameCount: 0,
				teamIds: [],
				regularSeason: false,
			},
		])).toEqual([
			{
				date: "2026-09-04",
				count: null,
				teamIds: null,
				regularSeason: null,
			},
			{
				date: "2026-09-05",
				count: 2,
				teamIds: [108, 111, 117, 147],
				regularSeason: true,
			},
			{
				date: "2026-09-06",
				count: 0,
				teamIds: [],
				regularSeason: false,
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
				regularSeason: null,
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
				regularSeason: true,
			},
			{
				date: "2026-07-02",
				gameCount: 1,
				teamIds: [108, 119],
				regularSeason: true,
			},
		]);
		expect(favoriteTeamsOff(days[1]!, [YANKEES], days)).toEqual({
			mark: "red",
			off: [YANKEES],
		});
	});
});

describe("monthComplete (#399)", () =>
{
	it("every day known, with games or none, is complete", () =>
	{
		expect(monthComplete([{
			count: 0,
		}, {
			count: 3,
		}])).toBe(true);
	});

	it("one unknown day among known ones is incomplete, even beside a day with games (#399)", () =>
	{
		expect(monthComplete([{
			count: 3,
		}, {
			count: null,
		}, {
			count: 0,
		}])).toBe(false);
	});

	it("a month of unknown days is incomplete; no days at all is vacuously complete", () =>
	{
		expect(monthComplete([{
			count: null,
		}])).toBe(false);
		expect(monthComplete([])).toBe(true);
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
