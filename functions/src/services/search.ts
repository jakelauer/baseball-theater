import type { SearchFilters, SearchHighlightsResponse } from "@bt/domain";
import { hasSearchFilters, mlbSearchText } from "@bt/domain";
import type { MlbStatsClient } from "@bt/ports";

/**
 * Highlight search (S5; ADR-029): MLB's free-text search, asked per query through the MLB port,
 * server-side, so the browser still reads only BT (ADR-002), narrowed by MLB's own date, team and
 * content-tag filters when `filters` holds any (S72). Nothing is stored and the words are never logged
 * (ADR-028: a search over game data adds no store). Null when there is nothing to search for (no
 * filter, and `query` blank or only hyphens and spaces), which the route answers 400 `query_required`;
 * rejects when MLB can't answer, which the route answers 502.
 */
export async function searchHighlights(mlb: Pick<MlbStatsClient, "searchHighlights">, query: string, filters: SearchFilters = {}): Promise<SearchHighlightsResponse | null>
{
	const filtered = hasSearchFilters(filters);
	if (!filtered && mlbSearchText(query) === "") return null;
	const page = filtered ? await mlb.searchHighlights(query, filters) : await mlb.searchHighlights(query);
	return {
		query: query.trim(),
		total: page.total,
		highlights: page.highlights,
	};
}
