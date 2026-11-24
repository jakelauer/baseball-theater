import {
	describe, expect, it,
} from "vitest";
import { teamAbbreviation } from "./teams.js";

describe("teamAbbreviation", () =>
{
	it("reads a club's abbreviation from MLB_TEAMS, and nothing for an id BT doesn't know", () =>
	{
		expect(teamAbbreviation(147)).toBe("NYY");
		expect(teamAbbreviation(133)).toBe("ATH");
		expect(teamAbbreviation(1)).toBeUndefined();
	});
});
