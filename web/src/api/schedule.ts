/**
 * The schedule-day resource (ADR-014): one descriptor, one hook, one named cache
 * writer. Payload type generated from the published spec, like `game.ts`.
 */
import {
	queryOptions, useQuery, useQueryClient,
} from "@tanstack/react-query";
import type { QueryClient, UseQueryResult } from "@tanstack/react-query";
import type { StoredCopy } from "./client.js";
import { fetchSchedule } from "./client.js";
import { freshnessPolicy, whileVisible } from "./freshness.js";
import type { components } from "./generated/bt-api.v1.js";

export type ScheduleDayPayload = components["schemas"]["ScheduleDayResponse"];

/** The cache key for one day. Only this module builds it. */
export function scheduleKey(date: string)
{
	return ["schedule", date] as const;
}

/**
 * `streaming` (S149): the day's live stream keeps it fresh (its socket, or its own polling fallback) while the day has
 * a game in its window, so the query doesn't re-ask it in the background as well, as `gameQueryOptions` does for a game.
 */
export function scheduleQueryOptions(date: string, streaming = false)
{
	return queryOptions({
		queryKey: scheduleKey(date),
		// A copy the worker served from storage carries its time (S74, `StoredCopy`); other answers don't.
		queryFn: (): Promise<ScheduleDayPayload & StoredCopy> => fetchSchedule(date),
		staleTime: (query) => freshnessPolicy(query.state.data?.windowMode).staleTime,
		// Re-ask an in-window day on the live cadence while visible (S20); paused when hidden, and off while it streams.
		refetchInterval: (query) => streaming ? false : whileVisible(freshnessPolicy(query.state.data?.windowMode).refetchInterval),
	});
}

export function useScheduleDay(date: string, streaming = false): UseQueryResult<ScheduleDayPayload & StoredCopy, Error>
{
	return useQuery(scheduleQueryOptions(date, streaming));
}

/** The day as the cache holds it now, without subscribing (S149 decides from it whether to stream, as `useCachedGame`). */
export function useCachedScheduleDay(date: string): ScheduleDayPayload | undefined
{
	return useQueryClient().getQueryData(scheduleKey(date));
}

/** Write a day into the cache in place (a day fetched elsewhere, e.g. by a test or a prefetch). */
export function writeScheduleDay(client: QueryClient, day: ScheduleDayPayload): void
{
	// The descriptor's key carries the payload type, so a wrong-typed write is a type error.
	client.setQueryData(scheduleQueryOptions(day.date).queryKey, day);
}

/**
 * A game as a day already in the cache lists it, or undefined (S74). Offline, a game never opened
 * has no game payload, but the scoreboard that led to it does list it: its teams, day and state are
 * enough for the game page's top bar and room tabs over the empty room (game-rooms A1).
 */
export function findScheduledGame(client: QueryClient, gamePk: number): ScheduleDayPayload["games"][number] | undefined
{
	for (const [, day] of client.getQueriesData<ScheduleDayPayload>({
		queryKey: ["schedule"],
	}))
	{
		const game = day?.games.find((g) => g.gamePk === gamePk);
		if (game) return game;
	}
	return undefined;
}

/** The same writer bound to the mounted client. */
export function useWriteScheduleDay(): (day: ScheduleDayPayload) => void
{
	const client = useQueryClient();
	return (day) => writeScheduleDay(client, day);
}
