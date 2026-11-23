import {
	describe, expect, it,
} from "vitest";
import {
	gameInfoLines, probableLabel, probableSpoken, roomLabel, shortPlayerName,
} from "./format.js";

describe("roomLabel", () =>
{
	it("capitalizes the room for its tab", () =>
	{
		expect(roomLabel("videos")).toBe("Videos");
		expect(roomLabel("recap")).toBe("Recap");
	});
});

describe("shortPlayerName (S2)", () =>
{
	it("shortens the first name to an initial and keeps the rest", () =>
	{
		expect(shortPlayerName("Pete Crow-Armstrong")).toBe("P. Crow-Armstrong");
		expect(shortPlayerName("Ronald Acuña Jr.")).toBe("R. Acuña Jr.");
	});

	it("leaves a one-word name as it is", () =>
	{
		expect(shortPlayerName("Ichiro")).toBe("Ichiro");
	});
});

describe("probableLabel (S171)", () =>
{
	it("S171 AC 3 left: a left-hander reads J. Steele (L)", () =>
	{
		expect(probableLabel({
			fullName: "Justin Steele",
			pitchHand: "L",
		})).toBe("J. Steele (L)");
	});

	it("S171 AC 3 right: a right-hander reads F. Peralta (R)", () =>
	{
		expect(probableLabel({
			fullName: "Freddy Peralta",
			pitchHand: "R",
		})).toBe("F. Peralta (R)");
	});

	it("S171 AC 3 null: no hand from MLB adds no suffix", () =>
	{
		expect(probableLabel({
			fullName: "Justin Steele",
			pitchHand: null,
		})).toBe("J. Steele");
	});

	it("S171 AC 3 undefined: a stored row without the field adds no suffix and doesn't throw", () =>
	{
		expect(() => probableLabel({
			fullName: "Justin Steele",
		})).not.toThrow();
		expect(probableLabel({
			fullName: "Justin Steele",
		})).toBe("J. Steele");
	});
});

describe("probableSpoken (S171)", () =>
{
	it("says the hand in words; no hand, or an unknown code, leaves just the name", () =>
	{
		expect(probableSpoken({
			fullName: "Martín Pérez",
			pitchHand: "L",
		})).toBe("M. Pérez, left-handed");
		expect(probableSpoken({
			fullName: "Zack Wheeler",
			pitchHand: "R",
		})).toBe("Z. Wheeler, right-handed");
		expect(probableSpoken({
			fullName: "Zack Wheeler",
			pitchHand: null,
		})).toBe("Z. Wheeler");
		expect(probableSpoken({
			fullName: "Zack Wheeler",
			pitchHand: "S",
		})).toBe("Z. Wheeler");
		expect(probableSpoken({
			fullName: "Zack Wheeler",
		})).toBe("Z. Wheeler");
	});
});

describe("gameInfoLines (S2)", () =>
{
	it("keeps the drawn labels in the drawn order, without MLB's closing period", () =>
	{
		expect(gameInfoLines([
			{
				label: "Att",
				value: "26,141.",
			},
			{
				label: "Umpires",
				value: "HP: Someone.",
			},
			{
				label: "Venue",
				value: "loanDepot park.",
			},
		])).toEqual([
			{
				label: "Venue",
				value: "loanDepot park",
			},
			{
				label: "Att",
				value: "26,141",
			},
		]);
	});
});
