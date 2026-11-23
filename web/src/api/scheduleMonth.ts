/**
 * The schedule-month resource (S124's `GET /api/v1/schedule/month/:month`; ADR-014, ADR-024): one
 * descriptor, one hook, which the scoreboard's date control calls for the shown day's month before
 * the calendar opens and the open calendar calls for the month it shows (S125), so both share one
 * cache entry and the calendar opens already filled (owner, 2026-11-10: "It should already be
 * loaded.").
 */
import { queryOptions, useQuery } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";
import {
	isCalendarMonth, latestScheduleMonth, mlbToday,
} from "@bt/domain";
import { fetchScheduleMonth } from "./client.js";
import type { components } from "./generated/bt-api.v1.js";

export type ScheduleMonthPayload = components["schemas"]["ScheduleMonthResponse"];

/** The cache key for one month (`YYYY-MM`). Only this module builds it. */
export function scheduleMonthKey(month: string)
{
	return ["schedule-month", month] as const;
}

/**
 * Whether S124 answers for `month`: April 1901 (`isCalendarMonth`) through `latestScheduleMonth`
 * of MLB's today (December of next year). Any other month can only answer 400, so it is never
 * asked for, on a page's load or on a return to the window (S125 AC 8), and the calendar draws it
 * with numbers only (A8, "A month after December of next year").
 */
export function scheduleMonthAnswerable(month: string, now: Date = new Date()): boolean
{
	return isCalendarMonth(month) && month <= latestScheduleMonth(mlbToday(now));
}

export function scheduleMonthQueryOptions(month: string)
{
	return queryOptions({
		queryKey: scheduleMonthKey(month),
		queryFn: (): Promise<ScheduleMonthPayload> => fetchScheduleMonth(month),
		// A month's counts move only as games are scheduled or postponed; the API caches the answer
		// on ADR-021's ladder, so five minutes here costs nothing a fan would notice.
		staleTime: 5 * 60 * 1000,
		enabled: scheduleMonthAnswerable(month),
	});
}

/**
 * One month's game counts, teams and regular-season flags. Disabled (idle, no request) for a month
 * S124 doesn't answer for; the caller tells that apart from loading with `scheduleMonthAnswerable`.
 */
export function useScheduleMonth(month: string): UseQueryResult<ScheduleMonthPayload, Error>
{
	return useQuery(scheduleMonthQueryOptions(month));
}
