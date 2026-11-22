import {
	describe, expect, it,
} from "vitest";
import {
	dayHasFavoriteTeam, dayRegularSeason, distinctTeamIds, latestScheduleMonth, monthGameCounts, monthGamesState, monthLastChangedAt, scheduleFillWindow,
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

describe("dayHasFavoriteTeam (S136 AC 3)", () =>
{
	it("S136 AC 3 match: true when the day's teams include a favorite, false when they don't", () =>
	{
		expect(dayHasFavoriteTeam([108, 147], [147])).toBe(true);
		expect(dayHasFavoriteTeam([108, 147], [111, 108])).toBe(true);
		expect(dayHasFavoriteTeam([108, 147], [111])).toBe(false);
	});

	it("S136 AC 3 null: false for a day BT holds no schedule for", () =>
	{
		expect(dayHasFavoriteTeam(null, [147])).toBe(false);
	});

	it("S136 AC 3 empty: false for a day with no games", () =>
	{
		expect(dayHasFavoriteTeam([], [147])).toBe(false);
	});

	it("S136 AC 3 no favorites: false for a fan with no favorite teams", () =>
	{
		expect(dayHasFavoriteTeam([108, 147], [])).toBe(false);
	});

	it("S136 AC 3 cached before: false for a day with no teamIds at all, as an answer cached before S136 has", () =>
	{
		const cached = {
			date: "2026-09-05",
			count: 15,
		} as { date: string;
			count: number | null;
			teamIds?: number[] | null; };
		expect(dayHasFavoriteTeam(cached.teamIds, [147])).toBe(false);
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
