/**
 * The highlight search resource (S5; ADR-014): one descriptor and one hook. The words are part of
 * the key, so each search is its own cache entry (in memory only, never `web/src/storage/`: the
 * words are the fan's, ADR-028); a search already made answers again at once. MLB's answer to the
 * same words changes only as new clips are cut, so it stays fresh for five minutes, as the route's
 * edge cache keeps it.
 */
import { queryOptions, useQuery } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";
import { fetchSearchHighlights } from "./client.js";
import type { components } from "./generated/bt-api.v1.js";

export type SearchHighlightsPayload = components["schemas"]["SearchHighlightsResponse"];

/** The cache key for one search. Only this module builds it. */
export function searchKey(q: string)
{
	return ["search", "highlights", q] as const;
}

export function searchQueryOptions(q: string)
{
	return queryOptions({
		queryKey: searchKey(q),
		queryFn: (): Promise<SearchHighlightsPayload> => fetchSearchHighlights(q),
		staleTime: 5 * 60_000,
	});
}

/** The search for `q`; idle (no request) until there are words to search for. */
export function useHighlightSearch(q: string): UseQueryResult<SearchHighlightsPayload, Error>
{
	return useQuery({
		...searchQueryOptions(q),
		enabled: q.trim() !== "",
	});
}
