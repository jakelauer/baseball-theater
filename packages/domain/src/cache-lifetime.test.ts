import {
	describe, expect, it,
} from "vitest";
import {
	CACHE_LIFETIME_CAP_MS, CACHE_LIFETIME_FLOOR_MS, CACHE_LIFETIME_LADDER, cacheLifetimeMs, STANDINGS_CACHE_LIFETIME_CAP_MS, STANDINGS_CACHE_LIFETIME_LADDER,
} from "./cache-lifetime.js";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

describe("cacheLifetimeMs", () =>
{
	it("gives the 5-minute floor to data that just changed", () =>
	{
		expect(CACHE_LIFETIME_FLOOR_MS).toBe(5 * MINUTE);
		expect(cacheLifetimeMs(0)).toBe(5 * MINUTE);
	});

	// [unchanged for, expected lifetime] — just below and at every boundary.
	const cases: [number, number][] = [
		[10 * MINUTE - 1, 5 * MINUTE],
		[10 * MINUTE, 15 * MINUTE],
		[15 * MINUTE - 1, 15 * MINUTE],
		[15 * MINUTE, 30 * MINUTE],
		[30 * MINUTE - 1, 30 * MINUTE],
		[30 * MINUTE, 2 * HOUR],
		[2 * HOUR - 1, 2 * HOUR],
		[2 * HOUR, 10 * HOUR],
		[10 * HOUR - 1, 10 * HOUR],
		[10 * HOUR, 24 * HOUR],
		[24 * HOUR - 1, 24 * HOUR],
		[24 * HOUR, 48 * HOUR],
		[48 * HOUR, 48 * HOUR],
	];

	it.each(cases)("unchanged for %i ms → %i ms", (unchanged, lifetime) =>
	{
		expect(cacheLifetimeMs(unchanged)).toBe(lifetime);
	});

	it("caps at 48h for a value far beyond 48h", () =>
	{
		expect(CACHE_LIFETIME_CAP_MS).toBe(48 * HOUR);
		expect(cacheLifetimeMs(365 * 24 * HOUR)).toBe(CACHE_LIFETIME_CAP_MS);
	});

	it("falls back to the floor after a change resets lastChangedAt", () =>
	{
		expect(cacheLifetimeMs(30 * HOUR)).toBe(48 * HOUR);
		expect(cacheLifetimeMs(0)).toBe(CACHE_LIFETIME_FLOOR_MS);
	});

	it("gives the floor to negative or non-finite input", () =>
	{
		expect(cacheLifetimeMs(-1)).toBe(CACHE_LIFETIME_FLOOR_MS);
		expect(cacheLifetimeMs(Number.NaN)).toBe(CACHE_LIFETIME_FLOOR_MS);
	});

	it("keeps the ladder ascending and never shortening", () =>
	{
		for (let i = 1; i < CACHE_LIFETIME_LADDER.length; i++)
		{
			expect(CACHE_LIFETIME_LADDER[i]!.unchangedForMs).toBeGreaterThan(CACHE_LIFETIME_LADDER[i - 1]!.unchangedForMs);
			expect(CACHE_LIFETIME_LADDER[i]!.lifetimeMs).toBeGreaterThanOrEqual(CACHE_LIFETIME_LADDER[i - 1]!.lifetimeMs);
		}
	});
});

describe("cacheLifetimeMs with STANDINGS_CACHE_LIFETIME_LADDER (S139)", () =>
{
	const HOUR_MS = 60 * 60 * 1000;
	const DAY_MS = 24 * HOUR_MS;

	it("follows ADR-021's ladder up to 48 hours: just under 48h unchanged is still 48h", () =>
	{
		expect(cacheLifetimeMs(48 * HOUR_MS - 1, STANDINGS_CACHE_LIFETIME_LADDER)).toBe(48 * HOUR_MS);
		expect(cacheLifetimeMs(10 * HOUR_MS, STANDINGS_CACHE_LIFETIME_LADDER)).toBe(cacheLifetimeMs(10 * HOUR_MS));
	});

	it("unchanged for 48 hours gives 7 days; just under 7 days is still 7 days", () =>
	{
		expect(cacheLifetimeMs(48 * HOUR_MS, STANDINGS_CACHE_LIFETIME_LADDER)).toBe(7 * DAY_MS);
		expect(cacheLifetimeMs(7 * DAY_MS - 1, STANDINGS_CACHE_LIFETIME_LADDER)).toBe(7 * DAY_MS);
	});

	it("unchanged for 7 days and past it gives the 30-day cap", () =>
	{
		expect(cacheLifetimeMs(7 * DAY_MS, STANDINGS_CACHE_LIFETIME_LADDER)).toBe(STANDINGS_CACHE_LIFETIME_CAP_MS);
		expect(cacheLifetimeMs(400 * DAY_MS, STANDINGS_CACHE_LIFETIME_LADDER)).toBe(30 * DAY_MS);
	});

	it("with no ladder given, past 7 days is still ADR-021's 48-hour cap (games and schedules)", () =>
	{
		expect(cacheLifetimeMs(8 * DAY_MS)).toBe(CACHE_LIFETIME_CAP_MS);
	});
});
