/**
 * MLB's highlight search answer (S5; ADR-029) → BT's search results.
 *
 * MLB's shape and its zod parser are `@bt/mlb-api`'s (`parseSearchResponse`, `parseSearchPlay`; S153,
 * enhancement #347): this file only maps a parsed play to BT's `SearchHighlight`. A play inside the
 * answer that can't be mapped is left out (its id logged), so one odd clip never costs the fan the rest.
 * Each clip's `guid` is its play id and `playInfo`'s inning fields its half-inning (S153), which Search's
 * rows draw as the inning pill.
 */
import type {
	MediaHighlight, SearchClipGame, SearchHighlight, SearchHighlightsPage,
} from "@bt/domain";
import { MLB_TEAMS } from "@bt/domain";
import type {
	MlbSearchMediaPlayback, MlbSearchPlay, MlbSearchPlayInfo, MlbSearchResponse, MlbSearchTeamInfo,
} from "@bt/mlb-api";
import { parseSearchPlay } from "@bt/mlb-api";
import { pickPlaybackUrl, pickRenditions } from "./content.js";

function isRecord(value: unknown): value is Record<string, unknown>
{
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The clip as BT plays it. Its default URL and its encodings are chosen by the content mapper's own
 * `pickPlaybackUrl` and `pickRenditions` (ADR-025: one rule for game videos and search results),
 * handed the feed's encodings as a content item carries them.
 */
function highlightOf(media: MlbSearchMediaPlayback): MediaHighlight
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
		// MLB's `guid` is the play's id, as the content feed reads it (S153): the inning pill's `?play=`.
		playId: media.guid || null,
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
function teamOf(team: MlbSearchTeamInfo | null | undefined): { id: number;
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
function gameOf(play: MlbSearchPlay, media: MlbSearchMediaPlayback): SearchClipGame | null
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

/**
 * The play's half-inning as BT names it (S153): MLB's `inningHalf` `"Top"` / `"Bottom"` → `top` /
 * `bottom`, anything else null; an inning that isn't a whole number from 1 up null, since MLB writes
 * `inning: 0` with no half for a clip with no play (`fixtures/search-walk-off.json`). Each is null on
 * its own; the row shows the pill only when both and the play id are set.
 */
function inningOf(playInfo: MlbSearchPlayInfo | null | undefined): Pick<SearchHighlight, "halfInning" | "inning">
{
	const half = playInfo?.inningHalf;
	const inning = playInfo?.inning;
	return {
		halfInning: half === "Top" ? "top" : half === "Bottom" ? "bottom" : null,
		inning: typeof inning === "number" && Number.isInteger(inning) && inning >= 1 ? inning : null,
	};
}

/** MLB's answer as BT's results: one per play, its first clip, in MLB's order (newest first); a play BT can't map is left out. */
export function mapSearchResults(response: MlbSearchResponse): SearchHighlightsPage
{
	const search = response.data.search;
	const highlights: SearchHighlight[] = [];
	for (const raw of search.plays)
	{
		// A play with no clips has nothing to show: skipped, as MLB lists some, without a log line.
		if (isRecord(raw) && Array.isArray(raw.mediaPlayback) && raw.mediaPlayback.length === 0) continue;
		const play = parseSearchPlay(raw);
		const media = play?.mediaPlayback[0];
		if (!play || !media)
		{
			// Only MLB's play id is logged: the fan's search words never reach a log line (ADR-028).
			console.warn("MLB search: left out a play BT can't map:", isRecord(raw) && typeof raw.id === "string" ? raw.id : "(no id)");
			continue;
		}
		highlights.push({
			highlight: highlightOf(media),
			game: gameOf(play, media),
			...inningOf(media.playInfo),
		});
	}
	return {
		total: search.total,
		highlights,
	};
}
