/**
 * The season calendars the standings read, kept for a day (S139 AC 8; owner, 2026-11-13: "yeah,
 * cache, don't store."). Every standings request reads two calendars (four MLB requests); they
 * change a few times a year, so this keeps each season's answer for 24 hours — except from its
 * `regularSeasonEndDate` through the day after its `lastGameDate`, while the postseason can still
 * move `lastGameDate`, when it is kept for the floor only. A calendar MLB couldn't be reached for
 * (a rejection) is never kept, so the next request asks again and S128 AC 7 still holds; a season
 * MLB hasn't published (`null`) is kept like any answer, so it shows up within a day of publishing.
 *
 * An adapter around the MLB client's `fetchSeasonCalendar` (ADR-012): the port is unchanged. In
 * the Worker the answers live in the Workers Cache (`WorkersCacheCalendarStore`), shared by the
 * isolates of a colo; in the Node server, in memory (`MemoryCalendarStore`).
 */
import type { SeasonCalendar } from "@bt/domain";
import {
	CACHE_LIFETIME_FLOOR_MS, mlbToday, seasonSettling,
} from "@bt/domain";
import type { SeasonCalendarSource } from "../services/ingest.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/** A kept calendar answer: the calendar, or null for a season MLB hasn't published. */
export type KeptCalendar = { calendar: SeasonCalendar | null };

/** Where kept calendars live; `put` keeps one for `keepMs`, after which `get` no longer finds it. */
export interface CalendarStore
{
	get(season: number): Promise<KeptCalendar | undefined>;
	put(season: number, kept: KeptCalendar, keepMs: number): Promise<void>;
}

/**
 * How long a calendar answer is kept at `now`: the floor from its `regularSeasonEndDate` through
 * the day after its `lastGameDate` (MLB's today), when the postseason can change the last game's day
 * and the World Series winner; 24 hours otherwise, an unpublished season included.
 */
export function calendarKeepMs(calendar: SeasonCalendar | null, now: Date): number
{
	// The postseason window is `seasonSettling`'s, the one the standings' edge cache judges a season by too.
	return seasonSettling(calendar?.regularSeasonEndDate, calendar?.lastGameDate, mlbToday(now)) === "postseason" ? CACHE_LIFETIME_FLOOR_MS : DAY_MS;
}

/** `source`'s `fetchSeasonCalendar`, answered from `store` when it holds the season, and kept there after MLB answers. */
export function cachedSeasonCalendars(source: SeasonCalendarSource, store: CalendarStore, now: () => Date = () => new Date()): SeasonCalendarSource
{
	return {
		async fetchSeasonCalendar(season)
		{
			const kept = await store.get(season);
			if (kept) return kept.calendar;
			// A rejection propagates before anything is kept: an unreachable calendar is asked again next time.
			const calendar = await source.fetchSeasonCalendar(season);
			await store.put(season, {
				calendar,
			}, calendarKeepMs(calendar, now()));
			return calendar;
		},
	};
}

/** Kept calendars in this process's memory (the Node server), each until its keep time passes on `now`. */
export class MemoryCalendarStore implements CalendarStore
{
	private readonly kept = new Map<number, { kept: KeptCalendar;
		until: number; }>();

	constructor(private readonly now: () => Date = () => new Date()) {}

	async get(season: number): Promise<KeptCalendar | undefined>
	{
		const entry = this.kept.get(season);
		if (!entry || entry.until <= this.now().getTime()) return undefined;
		return entry.kept;
	}

	async put(season: number, kept: KeptCalendar, keepMs: number): Promise<void>
	{
		this.kept.set(season, {
			kept,
			until: this.now().getTime() + keepMs,
		});
	}
}

/** The slice of the Workers Cache API (`caches.default`) the store uses. */
export interface WorkersCacheLike
{
	match(key: string): Promise<Response | undefined>;
	put(key: string, response: Response): Promise<void>;
}

/**
 * The version of the `SeasonCalendar` shape the Workers Cache keeps (S140). Bump it whenever
 * `SeasonCalendar` gains a field: a calendar kept by older code lacks it, and would otherwise be read
 * as complete for up to a day after a deploy (S139's calendars, kept without S140's `champion`, would
 * name no winner and leave a past date's null in the standings' month-long edge cache).
 */
const CALENDAR_SHAPE_VERSION = "v2";

/**
 * The Workers Cache key a season's calendar is kept under: an internal address no request reaches,
 * versioned by the calendar's shape. Staging and production share the zone's cache and so these
 * keys; they read the same MLB calendars, so that is harmless while both run the same shape, and a
 * shape change bumps the version.
 */
export function seasonCalendarCacheKey(season: number): string
{
	return `https://season-calendars.bt.internal/${CALENDAR_SHAPE_VERSION}/${season}`;
}

/** Kept calendars in the Workers Cache (the Worker): the cache drops each once its `max-age` passes. */
export class WorkersCacheCalendarStore implements CalendarStore
{
	constructor(private readonly cache: WorkersCacheLike) {}

	async get(season: number): Promise<KeptCalendar | undefined>
	{
		const response = await this.cache.match(seasonCalendarCacheKey(season));
		return response ? await response.json() as KeptCalendar : undefined;
	}

	async put(season: number, kept: KeptCalendar, keepMs: number): Promise<void>
	{
		await this.cache.put(seasonCalendarCacheKey(season), new Response(JSON.stringify(kept), {
			headers: {
				"content-type": "application/json",
				"cache-control": `max-age=${Math.round(keepMs / 1000)}`,
			},
		}));
	}
}

/** The store for where this code runs: the Workers Cache when there is one (`caches.default`), memory otherwise. */
export function defaultCalendarStore(): CalendarStore
{
	const cache = (globalThis as { caches?: { default?: WorkersCacheLike } }).caches?.default;
	return cache ? new WorkersCacheCalendarStore(cache) : new MemoryCalendarStore();
}

// S152 AC 7 timing run: a throwaway change touching only functions/ (closed unmerged).
