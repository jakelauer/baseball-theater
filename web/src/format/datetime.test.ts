import {
	describe, expect, it, vi,
} from "vitest";
import {
	formatDate, formatLongDate, formatMonthDay, formatTime,
} from "./datetime.js";

describe("datetime formatting (S79)", () =>
{
	it("writes a date as A4 does", () =>
	{
		expect(formatDate("2026-11-11T12:00:00.000Z")).toMatch(/^Nov 1[01], 2026$/);
	});

	it("writes a calendar date as that day in any zone, Sep 5, 2026 (S66, merged from the game top bar)", () =>
	{
		expect(formatDate("2026-09-05")).toBe("Sep 5, 2026");
		expect(formatDate("2024-07-04")).toBe("Jul 4, 2024");
		expect(formatDate("2026-12-31")).toBe("Dec 31, 2026");
	});

	it("passes through anything that is not a date", () =>
	{
		expect(formatDate("TBD")).toBe("TBD");
		expect(formatDate("2024-13-01")).toBe("2024-13-01");
		expect(formatDate("2026-02-30")).toBe("2026-02-30");
	});

	it("writes a time with hours and minutes, AM/PM", () =>
	{
		expect(formatTime("2026-10-28T15:15:00.000Z")).toMatch(/^\d{1,2}:15\s?[AP]M$/);
	});

	it("writes a calendar date without its year, as that day anywhere (S71); anything else as it is", () =>
	{
		expect(formatMonthDay("2026-09-21")).toBe("Sep 21");
		expect(formatMonthDay("2024-07-04")).toBe("Jul 4");
		expect(formatMonthDay("2026-02-30")).toBe("2026-02-30");
		expect(formatMonthDay("not a date")).toBe("not a date");
	});
});

describe("formatLongDate (S130 AC 3)", () =>
{
	it("S130 AC 3: writes a calendar date with its month in full, as A9 draws it", () =>
	{
		expect(formatLongDate("2027-03-02")).toBe("March 2, 2027");
		expect(formatLongDate("2026-12-01")).toBe("December 1, 2026");
		expect(formatLongDate("2026-10-28")).toBe("October 28, 2026");
	});

	it("S130 AC 3: a reader in a zone behind UTC still reads the same day", async () =>
	{
		const zone = process.env.TZ;
		process.env.TZ = "America/Los_Angeles";
		try
		{
			vi.resetModules();
			const fresh = await import("./datetime.js");
			expect(new Date("2027-03-02T00:00:00Z").getDate()).toBe(1);
			expect(fresh.formatLongDate("2027-03-02")).toBe("March 2, 2027");
		}
		finally
		{
			process.env.TZ = zone;
			vi.resetModules();
		}
	});

	it("S130 AC 3: anything that is not a calendar date comes back as it is", () =>
	{
		expect(formatLongDate("not a date")).toBe("not a date");
		expect(formatLongDate("2026-02-30")).toBe("2026-02-30");
		expect(formatLongDate("2026-11-11T12:00:00.000Z")).toBe("2026-11-11T12:00:00.000Z");
	});
});
