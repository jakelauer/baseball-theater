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

/**
 * The most a highlight search's words may be (S5): 200 UTF-16 code units (JavaScript's `length`),
 * counted after `trim()`. A bound on what a fan can make BT send MLB and key the edge cache on; typed
 * words are far shorter. The route answers 400 `query_too_long` past it, and the web app's box stops
 * at it (ADR-025: one constant for both).
 */
export const SEARCH_QUERY_MAX_LENGTH = 200;

/**
 * Whether the route would search `query` rather than refuse it (S5): it has words to send MLB
 * (`mlbSearchText` isn't empty) and is no longer than {@link SEARCH_QUERY_MAX_LENGTH} once trimmed.
 * The web app asks only for words that pass, so a URL holding only hyphens or too many characters
 * shows an empty page, never an error whose Retry can't help.
 */
export function searchableQuery(query: string): boolean
{
	return mlbSearchText(query) !== "" && query.trim().length <= SEARCH_QUERY_MAX_LENGTH;
}

/**
 * One page of MLB's answer to a highlight search (S5). `total` is MLB's count of every clip it
 * matched; `highlights` is the first page of them, so it may hold fewer (MLB counts thousands for
 * "walk off", BT asks for one page).
 */
export type SearchHighlightsPage = {
	total: number;
	highlights: SearchHighlight[];
};
