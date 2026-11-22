/**
 * The standings' calendar cache (S139 AC 8) in memory, on the committed recordings through a
 * counting client (`recordedClient`): kept a day, the floor in the postseason window, and a
 * rejection never kept.
 */
import type { SeasonCalendar } from "@bt/domain";
import { CACHE_LIFETIME_FLOOR_MS } from "@bt/domain";
import {
	describe, expect, it,
} from "vitest";
import { getStandings } from "../services/standings.js";
import { recordedClient } from "../test/recorded-mlb.js";
import type { WorkersCacheLike } from "./cached-season-calendars.js";
import {
	cachedSeasonCalendars, calendarKeepMs, MemoryCalendarStore, seasonCalendarCacheKey, WorkersCacheCalendarStore,
} from "./cached-season-calendars.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/** A clock a test moves by hand. */
function clock(start: string): { now: () => Date;
	advance: (ms: number) => void; }
{
	let at = Date.parse(start);
	return {
		now: () => new Date(at),
		advance: (ms) =>
		{
			at += ms;
		},
	};
}

/** The standings over the recordings with the calendar cache on `now`, and how many calendar reads reached MLB. */
function cachedStandings(now: () => Date, override?: Parameters<typeof recordedClient>[0])
{
	const { mlb, asked } = recordedClient(override);
	const seasonCalendars = cachedSeasonCalendars(mlb, new MemoryCalendarStore(now), now);
	return {
		read: (day: string) => getStandings({
			mlb,
			now,
			seasonCalendars,
		}, day, []).then((read) => read.answer),
		calendarsAsked: () => asked.filter((u) => u.includes("/api/v1/seasons/")).length,
	};
}

const S2026: SeasonCalendar = {
	season: 2026,
	springStartDate: "2026-02-20",
	regularSeasonStartDate: "2026-03-25",
	regularSeasonEndDate: "2026-09-27",
	lastGameDate: "2026-10-28",
};

describe("calendar cache (S139)", () =>
{
	it("calendar cache: keeps a calendar 24 hours, the floor from regularSeasonEndDate through the day after lastGameDate", () =>
	{
		const at = (iso: string) => calendarKeepMs(S2026, new Date(iso));
		expect(at("2026-09-05T15:00:00Z")).toBe(DAY_MS);
		expect(at("2026-09-27T15:00:00Z")).toBe(CACHE_LIFETIME_FLOOR_MS);
		expect(at("2026-10-28T15:00:00Z")).toBe(CACHE_LIFETIME_FLOOR_MS);
		expect(at("2026-10-29T15:00:00Z")).toBe(CACHE_LIFETIME_FLOOR_MS);
		expect(at("2026-10-30T15:00:00Z")).toBe(DAY_MS);
		expect(calendarKeepMs(null, new Date("2026-10-28T15:00:00Z"))).toBe(DAY_MS);
	});

	it("calendar cache: two standings requests the same day ask MLB for the calendars once between them; 24 hours later, again", async () =>
	{
		const time = clock("2026-09-05T15:00:00Z");
		const standings = cachedStandings(time.now);
		await standings.read("2026-09-05");
		const first = standings.calendarsAsked();
		expect(first).toBe(2); // 2025's and 2026's seasons requests (each calendar also reads its World Series schedule)
		await standings.read("2026-09-05");
		expect(standings.calendarsAsked()).toBe(first);
		time.advance(DAY_MS);
		await standings.read("2026-09-05");
		expect(standings.calendarsAsked()).toBe(first * 2);
	});

	it("calendar cache: a calendar kept on 2026-10-28, inside the postseason window, is asked again once the floor has passed", async () =>
	{
		const time = clock("2026-10-28T15:00:00Z");
		const standings = cachedStandings(time.now);
		await standings.read("2026-10-28");
		const first = standings.calendarsAsked();
		time.advance(CACHE_LIFETIME_FLOOR_MS - 1000);
		await standings.read("2026-10-28");
		expect(standings.calendarsAsked()).toBe(first);
		time.advance(2000);
		await standings.read("2026-10-28");
		// 2026's (in its window) is asked again; 2025's, kept a day, is not.
		expect(standings.calendarsAsked()).toBe(first + 1);
	});

	it("calendar cache: a rejected calendar is never kept, so the next request asks again", async () =>
	{
		const time = clock("2026-09-05T15:00:00Z");
		let down = true;
		const standings = cachedStandings(time.now, (url) => down && url.pathname === "/api/v1/seasons/2026" ? new Response("{}", {
			status: 500,
		}) : undefined);
		const failed = await standings.read("2026-09-05");
		expect(failed.phases.spring).toBeNull(); // no calendar: S128 AC 7
		const first = standings.calendarsAsked();
		down = false;
		const answered = await standings.read("2026-09-05");
		expect(standings.calendarsAsked()).toBeGreaterThan(first);
		expect(answered.phases.spring?.startDate).toBe("2026-02-20");
	});

	it("calendar cache: the Workers Cache keeps each calendar for its keep time, in seconds (max-age)", async () =>
	{
		const stored = new Map<string, Response>();
		const cache: WorkersCacheLike = {
			match: async (key) => stored.get(key)?.clone(),
			put: async (key, response) =>
			{
				stored.set(key, response);
			},
		};
		const store = new WorkersCacheCalendarStore(cache);
		await store.put(2026, {
			calendar: S2026,
		}, DAY_MS);
		expect(stored.get(seasonCalendarCacheKey(2026))?.headers.get("cache-control")).toBe("max-age=86400");
		expect(await store.get(2026)).toEqual({
			calendar: S2026,
		});
		await store.put(2027, {
			calendar: null,
		}, CACHE_LIFETIME_FLOOR_MS);
		expect(stored.get(seasonCalendarCacheKey(2027))?.headers.get("cache-control")).toBe("max-age=300");
		expect(await store.get(2027)).toEqual({
			calendar: null,
		});
		expect(await store.get(2025)).toBeUndefined();
	});

	it("calendar cache: the Workers Cache key carries the calendar's shape version, so a calendar kept by older code isn't read as complete (S140), and v3 since S155 gave a season with no spring dates a calendar where it had none", () =>
	{
		expect(seasonCalendarCacheKey(2026)).toBe("https://season-calendars.bt.internal/v3/2026");
	});
});
