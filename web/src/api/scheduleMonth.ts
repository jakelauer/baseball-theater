/**
 * The schedule-month resource (S124's `GET /api/v1/schedule/month/:month`; ADR-014, ADR-024): one
 * descriptor, one hook, which the scoreboard's date control calls for the shown day's month before
 * the calendar opens and the open calendar calls for the month it shows (S125), so both share one
 * cache entry and the calendar opens already filled (owner, 2026-11-10: "It should already be
 * loaded."). Since S194 the hook first reads its year's month versions (one shared query per year,
 * `GET /api/v1/schedule/month-versions/:year`) and asks for the month with `?v=<version>`, a URL
 * whose content never changes, so the edge may keep it for a long time.
 */
import { queryOptions, useQuery } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";
import {
	CACHE_LIFETIME_FLOOR_MS, isCalendarMonth, latestScheduleMonth, mlbToday, monthComplete,
} from "@bt/domain";
import { fetchScheduleMonth, fetchScheduleMonthVersions } from "./client.js";
import type { components } from "./generated/bt-api.v1.js";

export type ScheduleMonthPayload = components["schemas"]["ScheduleMonthResponse"];
export type ScheduleMonthVersionsPayload = components["schemas"]["ScheduleMonthVersionsResponse"];

/**
 * The cache key for one month (`YYYY-MM`), and its answer's version when it is asked for with one
 * (S194): without a version it stays `["schedule-month", month]`, as before. Only this module builds it.
 */
export function scheduleMonthKey(month: string, version?: string)
{
	return version === undefined ? ["schedule-month", month] as const : ["schedule-month", month, version] as const;
}

/** The cache key for one year's month versions (`YYYY`, S194). Only this module builds it. */
export function scheduleMonthVersionsKey(year: string)
{
	return ["schedule-month-versions", year] as const;
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

/**
 * One year's month versions (S194), shared by every month of the year. Kept for
 * `CACHE_LIFETIME_FLOOR_MS`, as long as the API's edge keeps the answer, so a month the scheduled
 * refresh changed gets its new version, and so its new URL, within about one floor.
 */
export function scheduleMonthVersionsQueryOptions(year: string, enabled = true)
{
	return queryOptions({
		queryKey: scheduleMonthVersionsKey(year),
		queryFn: (): Promise<ScheduleMonthVersionsPayload> => fetchScheduleMonthVersions(year),
		staleTime: CACHE_LIFETIME_FLOOR_MS,
		enabled,
	});
}

/**
 * One month's answer, asked for with `version` as `?v=` when there is one (S194), else as the plain
 * month URL.
 */
export function scheduleMonthQueryOptions(month: string, version?: string)
{
	return queryOptions({
		queryKey: scheduleMonthKey(month, version),
		queryFn: (): Promise<ScheduleMonthPayload> => fetchScheduleMonth(month, version),
		// A versioned answer never changes (its URL names its content), so it never goes stale here: a
		// new version arrives through the versions query, under a new key. An unversioned month's counts
		// move only as games are scheduled or postponed, and the API caches it by how long it has gone
		// unchanged, so five minutes here costs nothing a fan would notice. A month with any day BT
		// couldn't say (`monthComplete`; a fill that failed, which never has a version) is kept one
		// minute, as long as the API's edge keeps it and the fill's cooldown lasts, so the calendar asks
		// again soon rather than holding a month with no game labels for five minutes, without asking on
		// every focus (#399).
		staleTime: (query: { state: { data?: ScheduleMonthPayload } }) =>
		{
			if (version !== undefined) return Infinity;
			// `?.days`: a stand-in answer in a page's tests may carry no days; that is not an unknown month.
			const days = query.state.data?.days;
			return days && !monthComplete(days) ? 60 * 1000 : 5 * 60 * 1000;
		},
		enabled: scheduleMonthAnswerable(month),
	});
}

/**
 * One month's game counts, teams and regular-season flags. Disabled (idle, no request) for a month
 * S124 doesn't answer for; the caller tells that apart from loading with `scheduleMonthAnswerable`.
 *
 * It waits for its year's versions (S194) and asks with the month's version, or without one when the
 * versions leave the month out (incomplete, or not stored yet) or their request fails. When a new
 * version arrives the month is asked again under its new key, and the previous answer for the same
 * month stays on screen meanwhile rather than a loading state.
 */
export function useScheduleMonth(month: string): UseQueryResult<ScheduleMonthPayload, Error>
{
	const answerable = scheduleMonthAnswerable(month);
	const versions = useQuery(scheduleMonthVersionsQueryOptions(month.slice(0, 4), answerable));
	// `?.versions`: a page's tests may stub every request with one stand-in answer that has no
	// `versions`; that is a year with no versions, so the month is asked without one.
	const version = (versions.data?.versions as ScheduleMonthVersionsPayload["versions"] | undefined)?.[month];
	return useQuery({
		...scheduleMonthQueryOptions(month, version),
		enabled: answerable && (versions.isSuccess || versions.isError),
		placeholderData: (previous, previousQuery) => (previousQuery?.queryKey[1] === month ? previous : undefined),
	});
}
