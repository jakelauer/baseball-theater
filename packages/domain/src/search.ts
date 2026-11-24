import type { DigestClipGame } from "./digest.js";
import type { MediaHighlight } from "./types.js";
import { isCalendarDate } from "./calendar-date.js";

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

/**
 * The filters a highlight search may narrow to (S72; standings-search-settings `search-*` "ACTIVE
 * FILTERS" chips): a game date (`YYYY-MM-DD`, MLB's `Date`), a club (MLB's team id, its `TeamId`) and a
 * kind of play (one of MLB's content taxonomy slugs, `home-run`, its `ContentTags`). Each is MLB's own
 * filter, so MLB's `total` counts every match, not one page (S72's 2026-11-07 note: "prefer MLB's
 * filter where one exists"). Absent means not narrowed.
 */
export type SearchFilters = {
	date?: string;
	teamId?: number;
	tag?: string;
};

/**
 * Whether `tag` is a content tag BT will send MLB (S72): a lower-case taxonomy slug of letters, digits
 * and single hyphens (`home-run`, `walk-off`), at most 64 characters. The bound keeps anything that
 * could break out of MLB's filter language (quotes, brackets, `AND`) from ever reaching it.
 */
export function isSearchTag(tag: string): boolean
{
	return tag.length <= 64 && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(tag);
}

/** Whether any filter is set (S72): then the search asks MLB's filter language, even with no words. */
export function hasSearchFilters(filters: SearchFilters): boolean
{
	return filters.date !== undefined || filters.teamId !== undefined || filters.tag !== undefined;
}

/**
 * How BT asks MLB's `Search` for `query` narrowed by `filters` (S5, S72; ADR-029). With no filter it is
 * S5's free-text search (`FREETEXT`, the words as `mlbSearchText` sends them). MLB's free-text search
 * ignores filters written into it (asked 2026-11-23: "walk off TeamId = [147]" counts the same 3,341 as
 * "walk off"), so with any filter it is MLB's filter language (`STRUCTURED`, as the prior site asked its
 * date + tag links): `Date`, `TeamId` and `ContentTags` clauses joined by `AND`, newest first, and the
 * words, when there are any, as `Description ~ ["…"]`, MLB's contains match on the clip's description
 * (asked the same day: it matches any of the words, looser than the free-text search, which is why
 * words alone stay `FREETEXT`). Quotes, backslashes and brackets are dropped from the words so they
 * can't end the clause.
 */
export function mlbSearchQuery(query: string, filters: SearchFilters = {}): { queryType: "FREETEXT" | "STRUCTURED";
	query: string; }
{
	const words = mlbSearchText(query);
	if (!hasSearchFilters(filters))
	{
		return {
			queryType: "FREETEXT",
			query: words,
		};
	}
	const clauses: string[] = [];
	const safeWords = words.replace(/["\\[\]]/g, "").replace(/\s+/g, " ").trim();
	if (safeWords) clauses.push(`Description ~ ["${safeWords}"]`);
	if (filters.date !== undefined) clauses.push(`Date = ["${filters.date}"]`);
	if (filters.teamId !== undefined) clauses.push(`TeamId = [${filters.teamId}]`);
	if (filters.tag !== undefined) clauses.push(`ContentTags = ["${filters.tag}"]`);
	return {
		queryType: "STRUCTURED",
		query: `${clauses.join(" AND ")} Order By Timestamp DESC`,
	};
}

/** The few kinds of play whose chip label isn't simply the slug's words (S72; the frames' "Home Runs"). */
const SEARCH_TAG_LABELS: Readonly<Record<string, string>> = {
	"home-run": "Home Runs",
	"walk-off": "Walk-offs",
	"strikeout": "Strikeouts",
	"double-play": "Double Plays",
	"stolen-base": "Stolen Bases",
};

/**
 * A content tag's chip label (S72): a known kind of play reads as the frames write it ("Home Runs");
 * any other slug reads as its words, each capitalized (`grand-slam` → "Grand Slam").
 */
export function searchTagLabel(tag: string): string
{
	return SEARCH_TAG_LABELS[tag] ?? tag.split("-").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

/**
 * Whether the route would search `query` narrowed by `filters` rather than refuse it (S72; S5's
 * {@link searchableQuery} when nothing is filtered): the words are within {@link SEARCH_QUERY_MAX_LENGTH},
 * and there are words to send MLB or at least one filter, since a filter alone is a search ("every home
 * run by the Yankees"). The web app asks only for what passes, as with S5.
 */
export function searchableWith(query: string, filters: SearchFilters): boolean
{
	return hasSearchFilters(filters) ? query.trim().length <= SEARCH_QUERY_MAX_LENGTH : searchableQuery(query);
}

/**
 * A search's filters as the route's and the web app's URLs carry them (S72): `date` (`YYYY-MM-DD`),
 * `team` (an MLB team id) and `tag` (an {@link isSearchTag} slug), each read by `read` (a URL's
 * `searchParams.get`). The one parser for both (ADR-025): the route answers `"invalid"` with 400
 * `invalid_filter` rather than search without the filter a fan asked for, and the web app shows what an
 * unsearchable URL shows.
 */
export function parseSearchFilters(read: (name: "date" | "team" | "tag") => string | null): SearchFilters | "invalid"
{
	const filters: SearchFilters = {};
	const date = read("date");
	const team = read("team");
	const tag = read("tag");
	if (date !== null)
	{
		if (!isCalendarDate(date)) return "invalid";
		filters.date = date;
	}
	if (team !== null)
	{
		if (!/^[1-9][0-9]{0,5}$/.test(team)) return "invalid";
		filters.teamId = Number(team);
	}
	if (tag !== null)
	{
		if (!isSearchTag(tag)) return "invalid";
		filters.tag = tag;
	}
	return filters;
}
