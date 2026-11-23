import {
	describe, expect, it,
} from "vitest";
import { copyrightYear } from "./copyright-year.js";

describe("copyrightYear", () =>
{
	it("S142 AC 1 copyrightYear: follows MLB's day, so New Year's Day turns over at Eastern midnight", () =>
	{
		// 03:00 UTC is 22:00 on Dec 31 in New York: still 2026.
		expect(copyrightYear(new Date("2027-01-01T03:00:00Z"))).toBe(2026);
		// 05:00 UTC is 00:00 on Jan 1 in New York: 2027.
		expect(copyrightYear(new Date("2027-01-01T05:00:00Z"))).toBe(2027);
		expect(copyrightYear(new Date("2026-09-21T18:00:00Z"))).toBe(2026);
	});
});
