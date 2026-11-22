import {
	describe, expect, it,
} from "vitest";
import {
	SEARCH_QUERY_MAX_LENGTH, mlbSearchText, searchableQuery,
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
