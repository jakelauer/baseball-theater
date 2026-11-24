/** S125 AC 1: the calendar's one strict date parser (shell-scoreboard A8, "One strict `dateParser`"). */
import {
	describe, expect, it,
} from "vitest";
import {
	NOT_A_DATE, parseTypedDate, TOO_EARLY,
} from "./dateParser.js";

describe("parseTypedDate (S125 AC 1)", () =>
{
	it.each([
		["Sep 21, 2026", "2026-09-21"],
		["sep 21 2026", "2026-09-21"],
		["September 21, 2026", "2026-09-21"],
		["Sept. 21, 2026", "2026-09-21"],
		["  9/21/2026 ", "2026-09-21"],
		["2026-09-21", "2026-09-21"],
		["2026-9-1", "2026-09-01"],
		["Feb 29, 2028", "2028-02-29"],
		["Apr 18, 1901", "1901-04-18"],
		["Jul 4, 2099", "2099-07-04"],
	])("S125 AC 1: %s reads as %s", (text, date) =>
	{
		expect(parseTypedDate(text)).toEqual({
			date,
		});
	});

	it.each(["Feb 30, 2026", "Feb 29, 2026", "13/1/2026", "9/2", "9/21/26", "Sepx 21, 2026", "Foo 1, 2026", "", "2026-02-30", "yesterday"])("S125 AC 1: %j is not a date", (text) =>
	{
		expect(parseTypedDate(text)).toEqual({
			error: NOT_A_DATE,
		});
	});

	it.each(["Apr 17, 1901", "1/1/1900", "1850-01-01"])("S125 AC 1: %s is before the first game BT keeps", (text) =>
	{
		expect(parseTypedDate(text)).toEqual({
			error: TOO_EARLY,
		});
		expect(TOO_EARLY).toBe("No data before Apr 18, 1901.");
		expect(NOT_A_DATE).toBe("Not a date.");
	});
});
