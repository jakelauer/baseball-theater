import type { DigestClipGame } from "./digest.js";
import type { MediaHighlight } from "./types.js";

/**
 * The game a search result belongs to (S5): what the player's game link names (`NYY @ BOS, Sep 21`,
 * as the digest's `DigestClipGame`) plus each club's id, which the row's `MatchupAbbr` draws its
 * swatches from. `officialDate` is MLB's game date, `YYYY-MM-DD`.
 */
export type SearchClipGame = DigestClipGame & {
	awayId: number;
	homeId: number;
};

/**
 * One highlight search result (S5): the clip, playable as any other BT video, and its game, or null
 * for a clip MLB ties to no game (a season montage, a winter-league hit: MLB's `gamePk: -1`), which
 * then shows no matchup and no game link.
 */
export type SearchHighlight = {
	highlight: MediaHighlight;
	game: SearchClipGame | null;
};

/**
 * The words BT sends to MLB's free-text search for what a fan typed (S5; ADR-029). MLB matches
 * nothing for a hyphenated word (asked 2026-11-03: "walk-off" 0 results, "walk off" 3,338), so each
 * hyphen becomes a space; runs of whitespace become one space and the ends are trimmed. An empty
 * answer means there is nothing to search for (the route answers 400 `query_required`).
 */
export function mlbSearchText(query: string): string
{
	return query.replace(/-/g, " ").replace(/\s+/g, " ").trim();
}

/** One page of MLB's answer to a highlight search (S5): every clip it matched (`total`) and the first of them. */
export type SearchHighlightsPage = {
	total: number;
	highlights: SearchHighlight[];
};
