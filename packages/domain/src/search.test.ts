import {
	describe, expect, it,
} from "vitest";
import {
	SEARCH_QUERY_MAX_LENGTH, hasSearchFilters, isSearchTag, mlbSearchQuery, mlbSearchText, parseSearchFilters, searchTagLabel, searchableQuery, searchableWith,
} from "./search.js";

describe("mlbSearchText", () =>
{
	it("sends hyphens as spaces, which MLB's free-text search matches", () =>
	{
		expect(mlbSearchText("walk-off")).toBe("walk off");
		expect(mlbSearchText("Judge  homers")).toBe("Judge homers");
	});

	it("trims, and leaves nothing to search for in blank or dash-only text", () =>
	{
		expect(mlbSearchText("  grand slam \n")).toBe("grand slam");
		expect(mlbSearchText("   ")).toBe("");
		expect(mlbSearchText("--")).toBe("");
	});
});

describe("searchableQuery", () =>
{
	it("takes words up to the limit, counted after trimming, and refuses blank, hyphen-only or longer ones", () =>
	{
		expect(searchableQuery("walk-off")).toBe(true);
		expect(searchableQuery(` ${"a".repeat(SEARCH_QUERY_MAX_LENGTH)} `)).toBe(true);
		expect(searchableQuery("a".repeat(SEARCH_QUERY_MAX_LENGTH + 1))).toBe(false);
		expect(searchableQuery(" - ")).toBe(false);
		expect(searchableQuery("")).toBe(false);
	});
});

describe("S72 search filters", () =>
{
	it("sends words alone as S5's free-text search", () =>
	{
		expect(mlbSearchQuery("walk-off")).toEqual({
			queryType: "FREETEXT",
			query: "walk off",
		});
		expect(mlbSearchQuery("walk-off", {})).toEqual({
			queryType: "FREETEXT",
			query: "walk off",
		});
	});

	it("sends any filter as MLB's filter language, words as a Description clause, newest first", () =>
	{
		expect(mlbSearchQuery("", {
			teamId: 147,
			tag: "home-run",
		})).toEqual({
			queryType: "STRUCTURED",
			query: "TeamId = [147] AND ContentTags = [\"home-run\"] Order By Timestamp DESC",
		});
		expect(mlbSearchQuery("Judge", {
			date: "2026-09-14",
		}).query).toBe("Description ~ [\"Judge\"] AND Date = [\"2026-09-14\"] Order By Timestamp DESC");
	});

	it("drops quotes, backslashes and brackets from the words so they can't end the clause", () =>
	{
		expect(mlbSearchQuery("a\"] OR [\"b\\", {
			teamId: 1,
		}).query).toBe("Description ~ [\"a OR b\"] AND TeamId = [1] Order By Timestamp DESC");
		expect(mlbSearchQuery("\"\"", {
			teamId: 1,
		}).query).toBe("TeamId = [1] Order By Timestamp DESC");
	});

	it("accepts only taxonomy slugs as tags", () =>
	{
		expect(isSearchTag("home-run")).toBe(true);
		expect(isSearchTag("walk-off2")).toBe(true);
		for (const bad of ["", "Home-Run", "home run", "home--run", "-x", "x-", "a\"]", "a".repeat(65)]) expect(isSearchTag(bad)).toBe(false);
	});

	it("labels tags as the frames write them, else by their words", () =>
	{
		expect(searchTagLabel("home-run")).toBe("Home Runs");
		expect(searchTagLabel("grand-slam")).toBe("Grand Slam");
	});

	it("searches a filter alone, and words only within the limit", () =>
	{
		expect(hasSearchFilters({})).toBe(false);
		expect(hasSearchFilters({
			date: "2026-09-14",
		})).toBe(true);
		expect(searchableWith("", {
			teamId: 147,
		})).toBe(true);
		expect(searchableWith(" - ", {})).toBe(false);
		expect(searchableWith("walk-off", {})).toBe(true);
		expect(searchableWith("a".repeat(SEARCH_QUERY_MAX_LENGTH + 1), {
			tag: "home-run",
		})).toBe(false);
	});
});

describe("S72 parseSearchFilters", () =>
{
	const from = (query: string) =>
	{
		const params = new URLSearchParams(query);
		return parseSearchFilters((name) => params.get(name));
	};

	it("reads date, team and tag, and nothing when none is given", () =>
	{
		expect(from("")).toEqual({});
		expect(from("q=x&date=2026-09-14&team=147&tag=home-run")).toEqual({
			date: "2026-09-14",
			teamId: 147,
			tag: "home-run",
		});
	});

	it("calls any malformed filter invalid", () =>
	{
		for (const bad of ["date=2026-02-30", "date=", "team=NYY", "team=0", "team=1234567", "tag=Home", "tag="]) expect(from(bad), bad).toBe("invalid");
	});
});
