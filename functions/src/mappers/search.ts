/**
 * MLB's free-text highlight search answer (S5; ADR-029) → BT's search results.
 *
 * The upstream shape is modelled here, not in `packages/mlb-api`, because S5's fence holds
 * `functions/src/` but not that package: a narrow hand-written reader of only the fields BT asks
 * for (`searchHighlightsRequest`), which throws on an answer that isn't the search's shape so a
 * changed or failed answer is an error, never "no results". Each play's `guid` and `playInfo`
 * inning fields are asked for (S153 will draw the inning pill from them) but not read here.
 */
import type {
	MediaHighlight, SearchClipGame, SearchHighlight, SearchHighlightsPage,
} from "@bt/domain";
import { MLB_TEAMS } from "@bt/domain";
import { pickPlaybackUrl, pickRenditions } from "./content.js";

/** One club as MLB's search names it (`playInfo.teams.away`); `id: -1` when the clip has no game. */
export interface SearchTeamInfo {
	id: number;
	triCode?: string | null;
}

/** The play a clip shows: its game's two clubs (and, unread here, its inning). */
export interface SearchPlayInfo {
	teams?: {
		away?: SearchTeamInfo | null;
		home?: SearchTeamInfo | null;
	} | null;
}

/** One encoding of a clip (`mp4Avc`, `hlsCloud`, `highBit`, `trickplay`). */
export interface SearchPlayback {
	name: string;
	url: string;
}

/** One feed of a clip: its length, its still and its encodings. */
export interface SearchFeed {
	duration?: string | null;
	image?: {
		cuts?: { width?: number | null;
			src?: string | null; }[] | null;
	} | null;
	playbacks?: SearchPlayback[] | null;
}

/** The clip itself, as MLB's `MediaPlayback`. */
export interface SearchMediaPlayback {
	id: string;
	title: string;
	blurb?: string | null;
	description?: string | null;
	/** When MLB published it, `YYYY-MM-DD`. */
	date?: string | null;
	playInfo?: SearchPlayInfo | null;
	feeds?: SearchFeed[] | null;
}

/** One search hit: its game (`gamePk: -1`, `gameDate: null` for a clip tied to none) and its clips. */
export interface SearchPlay {
	id: string;
	gamePk: number;
	gameDate?: string | null;
	mediaPlayback: SearchMediaPlayback[];
}

/** The GraphQL answer: `data.search`, or `errors` when MLB refused the query. */
export interface SearchResponse {
	data?: {
		search?: {
			total: number;
			plays: SearchPlay[];
		} | null;
	} | null;
	errors?: { message?: string }[];
}

function isRecord(value: unknown): value is Record<string, unknown>
{
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The search answer, checked: a `data.search` with a numeric `total` and a `plays` list whose every
 * play has a numeric `gamePk` and a `mediaPlayback` list of clips with string `id` and `title`.
 * Throws otherwise (MLB's `errors`, a changed shape), naming what was wrong.
 */
export function parseSearchResponse(payload: unknown): SearchResponse
{
	if (!isRecord(payload)) throw new Error("MLB search: answer is not an object");
	const errors = payload.errors;
	if (Array.isArray(errors) && errors.length > 0)
	{
		const first: unknown = errors[0];
		throw new Error(`MLB search: ${isRecord(first) && typeof first.message === "string" ? first.message : "query refused"}`);
	}
	const search = isRecord(payload.data) ? payload.data.search : undefined;
	if (!isRecord(search) || typeof search.total !== "number" || !Array.isArray(search.plays)) throw new Error("MLB search: no data.search");
	for (const play of search.plays as unknown[])
	{
		if (!isRecord(play) || typeof play.gamePk !== "number" || !Array.isArray(play.mediaPlayback)) throw new Error("MLB search: a play has no gamePk or mediaPlayback");
		for (const media of play.mediaPlayback as unknown[])
		{
			if (!isRecord(media) || typeof media.id !== "string" || typeof media.title !== "string") throw new Error("MLB search: a clip has no id or title");
		}
	}
	return payload as SearchResponse;
}

/**
 * The clip as BT plays it. Its default URL and its encodings are chosen by the content mapper's own
 * `pickPlaybackUrl` and `pickRenditions` (ADR-025: one rule for game videos and search results),
 * handed the feed's encodings as a content item carries them.
 */
function highlightOf(media: SearchMediaPlayback): MediaHighlight
{
	const feed = media.feeds?.[0];
	const item = {
		title: media.title,
		blurb: media.blurb ?? "",
		playbacks: feed?.playbacks ?? [],
	};
	const cut = [...feed?.image?.cuts ?? []].filter((c) => c.src).sort((a, b) => (a.width ?? 0) - (b.width ?? 0)).find((c) => (c.width ?? 0) >= 640);
	return {
		id: media.id,
		// The play link is S153's: S5 asks for `guid` so the recording carries it, and reads it later.
		playId: null,
		title: media.title,
		blurb: media.blurb || media.description || null,
		duration: feed?.duration ?? null,
		// The player's poster only: Search's rows are typographic (VISUAL-DESIGN §5), so no row draws it.
		imageUrl: cut?.src ?? null,
		playbackUrl: pickPlaybackUrl(item),
		renditions: pickRenditions(item),
		// Search is highlights-only (owner, 2026-10-19; S56): every row reads `Highlight · <date>`.
		kind: "highlight",
		date: media.date ?? null,
	};
}

/** A club's id as BT knows it: MLB's id when it is one of the 30 clubs, else by its tri-code; null for neither. */
function teamOf(team: SearchTeamInfo | null | undefined): { id: number;
	abbreviation: string; } | null
{
	if (!team) return null;
	const club = MLB_TEAMS.find((t) => t.id === team.id) ?? MLB_TEAMS.find((t) => !!team.triCode && t.abbreviation === team.triCode);
	return club ? {
		id: club.id,
		abbreviation: club.abbreviation,
	} : null;
}

/** The clip's game, or null when MLB ties it to none (`gamePk: -1`), names no date, or names a club BT doesn't know. */
function gameOf(play: SearchPlay, media: SearchMediaPlayback): SearchClipGame | null
{
	if (play.gamePk <= 0 || !play.gameDate) return null;
	const away = teamOf(media.playInfo?.teams?.away);
	const home = teamOf(media.playInfo?.teams?.home);
	if (!away || !home) return null;
	return {
		gamePk: play.gamePk,
		officialDate: play.gameDate.slice(0, 10),
		away: away.abbreviation,
		home: home.abbreviation,
		awayId: away.id,
		homeId: home.id,
	};
}

/** MLB's answer as BT's results: one per play, its first clip, in MLB's order (newest first). */
export function mapSearchResults(response: SearchResponse): SearchHighlightsPage
{
	const search = response.data?.search;
	const highlights: SearchHighlight[] = [];
	for (const play of search?.plays ?? [])
	{
		const media = play.mediaPlayback[0];
		if (!media) continue;
		highlights.push({
			highlight: highlightOf(media),
			game: gameOf(play, media),
		});
	}
	return {
		total: search?.total ?? 0,
		highlights,
	};
}
