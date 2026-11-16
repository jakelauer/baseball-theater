/**
 * The day digest resource (ADR-014; S71): one descriptor and one hook. Like the schedule, it
 * follows the `windowMode` the server declares (#61): while the day or any of its games is live
 * it is re-asked on the live cadence, so new videos and a changing order appear without a reload;
 * once all are out of the window it takes the cached policy.
 */
import { queryOptions, useQuery } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";
import { fetchDigest } from "./client.js";
import { freshnessPolicy, whileVisible } from "./freshness.js";
import type { components } from "./generated/bt-api.v1.js";

export type DayDigestPayload = components["schemas"]["DayDigestResponse"];

/** The cache key for one day's digest. Only this module builds it. */
export function digestKey(date: string)
{
	return ["digest", date] as const;
}

export function digestQueryOptions(date: string)
{
	return queryOptions({
		queryKey: digestKey(date),
		queryFn: (): Promise<DayDigestPayload> => fetchDigest(date),
		staleTime: (query) => freshnessPolicy(query.state.data?.windowMode).staleTime,
		// Re-ask a live day on the live cadence while visible, as the schedule does (S20); paused when hidden.
		refetchInterval: (query) => whileVisible(freshnessPolicy(query.state.data?.windowMode).refetchInterval),
	});
}

export function useDayDigest(date: string): UseQueryResult<DayDigestPayload, Error>
{
	return useQuery(digestQueryOptions(date));
}
