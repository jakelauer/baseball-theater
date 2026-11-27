/**
 * A player's stats-site pages (S209): one key, one descriptor and one hook, so every name link to
 * the same player shares one cache entry. Asked only for a site whose own id BT must look up
 * (FanGraphs, Baseball-Reference); MLB.com and Savant need only the MLB id the name already has.
 */
import { queryOptions, useQuery } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";
import { fetchPlayerProfiles } from "./client.js";
import type { components } from "./generated/bt-api.v1.js";

export type PlayerProfilesPayload = components["schemas"]["PlayerProfilesResponse"];

/** The cache key for one player's pages. Only this module builds it. */
export function playerProfilesKey(personId: number)
{
	return ["player-profiles", personId] as const;
}

/**
 * The route answers a checked player for a day and one not yet checked for minutes, so the answer
 * counts as fresh for an hour: long enough that a box score's names ask once, short enough that a
 * player the cron resolves meanwhile links to their page within the hour.
 */
export function playerProfilesQueryOptions(personId: number)
{
	return queryOptions({
		queryKey: playerProfilesKey(personId),
		queryFn: (): Promise<PlayerProfilesPayload | null> => fetchPlayerProfiles(personId),
		staleTime: 60 * 60 * 1000,
		retry: false,
	});
}

/** One player's pages and ids, or null when BT has no row for them; not asked while `enabled` is false. */
export function usePlayerProfiles(personId: number, enabled: boolean): UseQueryResult<PlayerProfilesPayload | null, Error>
{
	return useQuery({
		...playerProfilesQueryOptions(personId),
		enabled,
	});
}
