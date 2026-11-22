/**
 * MLB's free-text highlight search answer (S5; ADR-029) → BT's search results.
 *
 * The upstream shape is modelled here, not in `packages/mlb-api`, because S5's fence holds
 * `functions/src/` but not that package: a narrow hand-written reader of only the fields BT asks
 * for (`searchHighlightsRequest`). An answer that isn't the search's shape (MLB's `errors`, no
 * `data.search`) throws, so a failed answer is an error, never "no results"; one play inside it that
 * can't be mapped is left out (its id logged), so one odd clip never costs the fan the rest. Each play's `guid` and `playInfo`
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
			/** Each checked by `mappablePlay` before it is read: MLB's plays are not all whole. */
			plays: unknown[];
		} | null;
	} | null;
	errors?: { message?: string }[];
}

function isRecord(value: unknown): value is Record<string, unknown>
{
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The search answer, checked: a `data.search` with a numeric `total` and a `plays` list. Throws
 * otherwise (MLB's `errors`, a changed shape), naming what was wrong. Each play is checked on its
 * own as it is mapped (`mappablePlay`).
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
	return payload as SearchResponse;
}

/**
 * Whether BT can map a play: a numeric `gamePk`; a `gameDate` that is a string, null or absent; a
 * `mediaPlayback` list whose first clip has a string `id` and `title`; and, in that clip's first feed,
 * `image.cuts` a list when present and every playback's `name` and `url` strings (`pickPlaybackUrl`
 * reads both). Only the fields BT reads are checked. The caller skips a play with no clips before
 * asking (MLB lists some), so only a malformed one is logged.
 */
function mappablePlay(play: Record<string, unknown>): play is Record<string, unknown> & SearchPlay
{
	if (typeof play.gamePk !== "number" || !Array.isArray(play.mediaPlayback)) return false;
	if (play.gameDate !== undefined && play.gameDate !== null && typeof play.gameDate !== "string") return false;
	const media: unknown = play.mediaPlayback[0];
	if (!isRecord(media) || typeof media.id !== "string" || typeof media.title !== "string") return false;
	const feed: unknown = Array.isArray(media.feeds) ? media.feeds[0] : undefined;
	if (!isRecord(feed)) return true;
	const cuts: unknown = isRecord(feed.image) ? feed.image.cuts : undefined;
	if (cuts !== undefined && cuts !== null && !Array.isArray(cuts)) return false;
	const playbacks: unknown = feed.playbacks;
	if (playbacks === undefined || playbacks === null) return true;
	return Array.isArray(playbacks) && playbacks.every((p: unknown) => isRecord(p) && typeof p.name === "string" && typeof p.url === "string");
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
	const cut = [...feed?.image?.cuts ?? []].filter((c) => c?.src).sort((a, b) => (a.width ?? 0) - (b.width ?? 0)).find((c) => (c.width ?? 0) >= 640);
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

/** MLB's answer as BT's results: one per play, its first clip, in MLB's order (newest first); a play BT can't map is left out. */
export function mapSearchResults(response: SearchResponse): SearchHighlightsPage
{
	const search = response.data?.search;
	const highlights: SearchHighlight[] = [];
	for (const play of search?.plays ?? [])
	{
		// A play with no clips has nothing to show: skipped, as MLB lists some, without a log line.
		if (isRecord(play) && Array.isArray(play.mediaPlayback) && play.mediaPlayback.length === 0) continue;
		if (!isRecord(play) || !mappablePlay(play))
		{
			// Only MLB's play id is logged: the fan's search words never reach a log line (ADR-028).
			console.warn("MLB search: left out a play BT can't map:", isRecord(play) && typeof play.id === "string" ? play.id : "(no id)");
			continue;
		}
		const media = play.mediaPlayback[0]!;
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
