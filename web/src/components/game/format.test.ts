import {
	describe, expect, it,
} from "vitest";
import {
	batterLabel, gameInfoLines, infoValue, isRunsBearingLine, probableLabel, probableSpoken, roomLabel, shortPlayerName,
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

describe("gameInfoLines (S2; every line since S207)", () =>
{
	it("keeps every line in MLB's order, without MLB's closing period, the date line as its label alone", () =>
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
			{
				label: "September 5, 2026",
				value: "",
			},
		])).toEqual([
			{
				label: "Attendance",
				value: "26,141",
			},
			{
				label: "Umpires",
				value: "HP: Someone",
			},
			{
				label: "Venue",
				value: "loanDepot park",
			},
			{
				label: "September 5, 2026",
				value: "",
			},
		]);
	});

	it("writes MLB's T and Att out as Time and Attendance (#433)", () =>
	{
		expect(gameInfoLines([
			{
				label: "T",
				value: "2:41.",
			},
			{
				label: "Att",
				value: "26,141.",
			},
		]).map((l) => l.label)).toEqual(["Time", "Attendance"]);
	});
});

describe("infoValue (S207)", () =>
{
	it("drops only MLB's one closing period", () =>
	{
		expect(infoValue("Hoerner (4, 3rd base by Gusto/Mack).")).toBe("Hoerner (4, 3rd base by Gusto/Mack)");
		expect(infoValue("Duran, J.")).toBe("Duran, J");
		expect(infoValue("3B: Brennan Miller. ")).toBe("3B: Brennan Miller");
		// A closing Jr. or Sr. is the name's own abbreviation (776854's GIDP line).
		expect(infoValue("Guerrero Jr.")).toBe("Guerrero Jr.");
		expect(infoValue("Bichette; Guerrero Sr.")).toBe("Bichette; Guerrero Sr.");
		expect(infoValue("4-for-18")).toBe("4-for-18");
		expect(infoValue("")).toBe("");
	});
});

describe("isRunsBearingLine (S207 AC 5)", () =>
{
	it("names the lines that carry runs, and only those", () =>
	{
		for (const label of ["RBI", "2-out RBI", "Team RISP", "Inherited runners-scored"]) expect(isRunsBearingLine(label)).toBe(true);
		for (const label of ["2B", "HR", "Team LOB", "SB", "E", "Venue", "Pitches-strikes"]) expect(isRunsBearingLine(label)).toBe(false);
	});
});

describe("batterLabel (S207)", () =>
{
	it("prints MLB's last name and every position, as the live site does", () =>
	{
		expect(batterLabel({
			fullName: "Matt Shaw",
			position: "DH",
			lastName: "Shaw",
			positions: ["PH", "DH"],
		})).toBe("Shaw (PH-DH)");
	});

	it("falls back to the short name and the one position for a game stored before S207", () =>
	{
		expect(batterLabel({
			fullName: "Pete Crow-Armstrong",
			position: "CF",
		})).toBe("P. Crow-Armstrong (CF)");
		expect(batterLabel({
			fullName: "Pete Crow-Armstrong",
			position: "CF",
			positions: [],
		})).toBe("P. Crow-Armstrong (CF)");
		expect(batterLabel({
			fullName: "Ichiro",
			position: "",
		})).toBe("Ichiro");
	});
});
