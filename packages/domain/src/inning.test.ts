import {
	describe, expect, it,
} from "vitest";
import {
	halfInningLabel, halfInningName, inningLabel, ordinal,
} from "./inning.js";

const at = (currentInning: number | null, inningState: string | null, isTopInning: boolean | null = null) => ({
	currentInning,
	inningState,
	isTopInning,
});

describe("inningLabel (S3)", () =>
{
	it("inningLabel: top of an inning", () =>
	{
		expect(inningLabel(at(6, "Top", true))).toBe("Top 6th");
	});

	it("inningLabel: bottom of an inning, in the frames' short form", () =>
	{
		expect(inningLabel(at(7, "Bottom", false))).toBe("Bot 7th");
	});

	it("inningLabel: middle of an inning", () =>
	{
		expect(inningLabel(at(3, "Middle", true))).toBe("Mid 3rd");
	});

	it("inningLabel: end of an inning", () =>
	{
		expect(inningLabel(at(9, "End", false))).toBe("End 9th");
	});

	it("inningLabel: no state falls back to isTopInning; no inning is no label", () =>
	{
		expect(inningLabel(at(2, null, false))).toBe("Bot 2nd");
		expect(inningLabel(at(1, "Something new", true))).toBe("Top 1st");
		expect(inningLabel(at(null, "Top", true))).toBeNull();
		expect(inningLabel(null)).toBeNull();
	});
});

describe("ordinal (S3)", () =>
{
	it("uses st / nd / rd / th, with the teens all th", () =>
	{
		expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 111].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "111th"]);
	});
});

describe("the inning pill's words (S145 AC 5)", () =>
{
	it("S145 AC 5: halfInningLabel is Top / Bot and the number, no ordinal (moved from S97's atBatInningLabel)", () =>
	{
		expect(halfInningLabel({
			halfInning: "top",
			inning: 6,
		})).toBe("Top 6");
		expect(halfInningLabel({
			halfInning: "bottom",
			inning: 3,
		})).toBe("Bot 3");
		expect(halfInningLabel({
			halfInning: "top",
			inning: 10,
		})).toBe("Top 10");
	});

	it.each([
		["top", 6, "Top of 6th inning"],
		["bottom", 3, "Bottom of 3rd inning"],
		["top", 1, "Top of 1st inning"],
		["bottom", 2, "Bottom of 2nd inning"],
		["top", 11, "Top of 11th inning"],
		["top", 12, "Top of 12th inning"],
	] as const)("S145 AC 5: halfInningName %s %i is %s", (halfInning, inning, want) =>
	{
		expect(halfInningName({
			halfInning,
			inning,
		})).toBe(want);
	});
});
