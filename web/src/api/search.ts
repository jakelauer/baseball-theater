/**
 * The highlight search resource (S5; ADR-014): one descriptor and one hook. The words and S72's filters
 * are part of the key, so each search is its own cache entry (in memory only, never `web/src/storage/`:
 * the words are the fan's, ADR-028); a search already made answers again at once, so removing a filter
 * chip and putting it back costs nothing. MLB's answer to the same search changes only as new clips are
 * cut, so it stays fresh for five minutes, as the route's edge cache keeps it.
 */
import { queryOptions, useQuery } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";
import type { SearchFilters } from "@bt/domain";
import { searchableWith } from "@bt/domain";
import { fetchSearchHighlights } from "./client.js";
import type { components } from "./generated/bt-api.v1.js";

export type SearchHighlightsPayload = components["schemas"]["SearchHighlightsResponse"];

/** The cache key for one search. Only this module builds it. */
export function searchKey(q: string, filters: SearchFilters = {})
{
	return ["search", "highlights", q, filters.date ?? null, filters.teamId ?? null, filters.tag ?? null] as const;
}

export function searchQueryOptions(q: string, filters: SearchFilters = {})
{
	return queryOptions({
		queryKey: searchKey(q, filters),
		queryFn: (): Promise<SearchHighlightsPayload> => fetchSearchHighlights(q, filters),
		staleTime: 5 * 60_000,
	});
}

/**
 * The search for `q` narrowed by `filters`; idle (no request) unless the route would search it
 * (`searchableWith`, the server's own rule), so words holding only hyphens or spaces with no filter, or
 * longer than the limit, never ask and never meet the route's 400 `query_required` or `query_too_long`.
 */
export function useHighlightSearch(q: string, filters: SearchFilters = {}): UseQueryResult<SearchHighlightsPayload, Error>
{
	return useQuery({
		...searchQueryOptions(q, filters),
		enabled: searchableWith(q, filters),
	});
}
