import {
	describe, expect, it,
} from "vitest";
import { mlbSearchText } from "./search.js";

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
