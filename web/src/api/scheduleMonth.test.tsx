/** S125 AC 2 and AC 8: the one month hook, and which months it may ask for. */
import {
	describe, expect, it,
} from "vitest";
import {
	scheduleMonthAnswerable, scheduleMonthKey, scheduleMonthQueryOptions,
} from "./scheduleMonth.js";

describe("scheduleMonth (S125)", () =>
{
	const now = new Date("2026-09-21T16:00:00Z");

	it.each([
		["1901-04", true],
		["2026-09", true],
		["2027-12", true],
		["1901-03", false],
		["1850-01", false],
		["2028-01", false],
		["2099-07", false],
		["2026-13", false],
	])("S125 AC 8: %s answerable: %s", (month, answerable) =>
	{
		expect(scheduleMonthAnswerable(month, now)).toBe(answerable);
	});

	it("S125 AC 2: one key per month, and a month S124 can't answer is never fetched", () =>
	{
		expect(scheduleMonthKey("2026-09")).toEqual(["schedule-month", "2026-09"]);
		expect(scheduleMonthQueryOptions("2026-09").enabled).toBe(true);
		expect(scheduleMonthQueryOptions("1850-01").enabled).toBe(false);
	});
});
