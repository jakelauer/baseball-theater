/**
 * The standings resource (ADR-014; S4): one descriptor and one hook. The payload says
 * `cache` (standings move once a game ends), so it takes the cached freshness policy.
 */
import { queryOptions, useQuery } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";
import type { SeasonPhaseName } from "@bt/domain";
import { SEASON_PHASES } from "@bt/domain";
import { fetchStandings } from "./client.js";
import { freshnessPolicy } from "./freshness.js";
import type { components } from "./generated/bt-api.v1.js";

export type StandingsPayload = components["schemas"]["StandingsResponse"];

/**
 * The cache key for the standings as of `date` (`"today"` when the server picks the day) and the
 * phases asked for (S139), written in the season's order (`SEASON_PHASES`) with each once, so
 * `["playoffs", "spring"]` and `["spring", "playoffs"]` share one entry; with none or an empty list
 * it reads as every phase, which is what the server answers then (`fetchStandings`; unlike the
 * service's `getStandings(…, [])`, on purpose). Only this module builds it.
 */
export function standingsKey(date: string | undefined, phases?: readonly SeasonPhaseName[])
{
	const asked = phases?.length ? SEASON_PHASES.filter((phase) => phases.includes(phase)) : SEASON_PHASES;
	return ["standings", date ?? "today", asked.join(",")] as const;
}

/**
 * While a new set of phases for the same day loads, the hook keeps the answer it last had for that
 * day (`isPlaceholderData` true), so Standings keeps its table on screen as the fan switches views
 * (S130 AC 1); an answer for another day is never kept, since its views and tables are that day's.
 */
export function standingsQueryOptions(date: string | undefined, phases?: readonly SeasonPhaseName[])
{
	const queryKey = standingsKey(date, phases);
	return queryOptions({
		queryKey,
		queryFn: (): Promise<StandingsPayload> => fetchStandings(date, phases),
		staleTime: (query) => freshnessPolicy(query.state.data?.windowMode).staleTime,
		placeholderData: (previous: StandingsPayload | undefined, previousQuery) => (previousQuery?.queryKey[1] === queryKey[1] ? previous : undefined),
	});
}

/** The standings as of `date`, with the tables of `phases` (S139; every phase when absent). */
export function useStandings(date?: string, phases?: readonly SeasonPhaseName[]): UseQueryResult<StandingsPayload, Error>
{
	return useQuery(standingsQueryOptions(date, phases));
}
