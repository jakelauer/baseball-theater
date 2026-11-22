import type { SearchHighlightsResponse } from "@bt/domain";
import { mlbSearchText } from "@bt/domain";
import type { MlbStatsClient } from "@bt/ports";

/**
 * Highlight search (S5; ADR-029): MLB's free-text search, asked per query through the MLB port,
 * server-side, so the browser still reads only BT (ADR-002). Nothing is stored and the words are
 * never logged (ADR-028: a search over game data adds no store). Null when `query` holds nothing
 * to search for (blank, or only hyphens and spaces), which the route answers 400 `query_required`;
 * rejects when MLB can't answer, which the route answers 502.
 */
export async function searchHighlights(mlb: Pick<MlbStatsClient, "searchHighlights">, query: string): Promise<SearchHighlightsResponse | null>
{
	if (mlbSearchText(query) === "") return null;
	const page = await mlb.searchHighlights(query);
	return {
		query: query.trim(),
		total: page.total,
		highlights: page.highlights,
	};
}
