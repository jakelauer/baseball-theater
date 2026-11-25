import { rankHighlightGroupsByImpact } from "./impact.js";
import type { ImpactClipGroup } from "./impact.js";
import type { HalfInning } from "./inning.js";
import type {
	GameSnapshot, MediaHighlight, ScheduleDay,
} from "./types.js";
import { atBatOfPlay } from "./video-play-links.js";

/**
 * What the digest needs from each of the day's games: its id, day, teams and videos, plus the
 * plays and play metrics that measure each video's play (#61), as the game's Videos room does.
 */
export type DigestGame = Pick<GameSnapshot, "gamePk" | "officialDate" | "teams" | "highlights" | "plays" | "playMetrics">;

/** The game a digest clip comes from, enough for the player's game pill (S173), which speaks it as `NYY @ BOS, Sep 21`. */
export type DigestClipGame = {
	gamePk: number;
	officialDate: string;
	away: string;
	home: string;
};

/**
 * The play a digest clip shows (S173): its id and the half-inning of the at-bat its pitch is in,
 * enough for the player's inning pill (`Top 6 →`), which the browser builds with `playInningLink`.
 */
export type DigestPlay = HalfInning & {
	playId: string;
};

/** One clip in the day digest: its place, whether to watch it first, the clip, its game and its play. */
export type DigestItem = {
	/** 1 for the top clip. */
	rank: number;
	/** Only the top clip (the frames' `WATCH FIRST`). */
	watchFirst: boolean;
	highlight: MediaHighlight;
	game: DigestClipGame;
	/** The clip's play (S173), or null for a clip with no play or one whose pitch isn't in its game's plays. */
	play: DigestPlay | null;
};

/**
 * How many clips the digest shows. The ratified frames draw two items on a three-game day
 * and no decision states a count; five was proposed at S71's design match and the owner
 * confirmed it (2026-11-02: "Yes").
 */
export const DIGEST_SIZE = 5;

/**
 * "Best of <date>" (S71): the day's highlights across every game, ranked by the existing
 * per-game impact rule applied across the day (owner, 2026-10-19), with each clip measured
 * against its own game's plays and metrics (`rankHighlightGroupsByImpact`, #61), so the
 * scoreboard and a game's Videos room agree on what matters: play clips by how much their
 * play swung the game, then interviews, recaps and other clips with no measured play. The
 * top `limit` are kept, numbered from 1, and the first is the one to watch first. A clip
 * that appears in two games' lists (same id) is kept once, with the first game that lists it.
 */
export function dayDigest(games: readonly DigestGame[], limit = DIGEST_SIZE): DigestItem[]
{
	const gameOf = new Map<string, DigestClipGame>();
	const playOf = new Map<string, DigestPlay | null>();
	const groups: ImpactClipGroup[] = [];
	for (const game of games)
	{
		const clips: MediaHighlight[] = [];
		for (const highlight of game.highlights)
		{
			if (gameOf.has(highlight.id)) continue;
			gameOf.set(highlight.id, {
				gamePk: game.gamePk,
				officialDate: game.officialDate,
				away: game.teams.away.abbreviation,
				home: game.teams.home.abbreviation,
			});
			playOf.set(highlight.id, digestPlay(game.plays, highlight.playId));
			clips.push(highlight);
		}
		groups.push({
			highlights: clips,
			context: {
				plays: game.plays,
				...game.playMetrics && {
					playMetrics: game.playMetrics,
				},
			},
		});
	}
	return rankHighlightGroupsByImpact(groups).slice(0, limit).map((highlight, index) => ({
		rank: index + 1,
		watchFirst: index === 0,
		highlight,
		game: gameOf.get(highlight.id)!,
		play: playOf.get(highlight.id) ?? null,
	}));
}

/**
 * A digest clip's play (S173): the at-bat its play id names in its own game's plays, through
 * `atBatOfPlay`, the one pitch → at-bat lookup `videoPlayLink` uses too, so the digest's pill and the
 * Videos room's agree. Null for a clip with no play, or one whose pitch isn't in those plays.
 */
function digestPlay(plays: DigestGame["plays"], playId: string | null): DigestPlay | null
{
	const atBat = atBatOfPlay(plays, playId);
	if (!atBat || !playId) return null;
	return {
		playId,
		halfInning: atBat.about.halfInning,
		inning: atBat.about.inning,
	};
}

/** What a day's games tell the digest about freshness: whether each is live, and when it last changed. */
export type DigestFreshnessGame = Pick<GameSnapshot, "windowMode" | "lastChangedAt">;

/**
 * How fresh a day's digest is (#61), for the same graduated rule the schedule and game routes
 * use (ADR-021: `edgeCacheControl` at the edge, `freshnessPolicy` in the browser). The digest is
 * built from the day and every one of its games, so it is live while any of them is, and it last
 * changed when the latest of them did: a video posted after a game ends changes the game, not the
 * schedule. A timestamp that doesn't parse is skipped; with none left, the day's own is kept.
 */
export function digestFreshness(day: Pick<ScheduleDay, "windowMode" | "lastChangedAt">, games: readonly DigestFreshnessGame[]): {
	windowMode: "active" | "cache";
	lastChangedAt: string;
}
{
	const all = [day, ...games];
	let lastChangedAt = day.lastChangedAt;
	let latest = Date.parse(lastChangedAt);
	for (const entity of games)
	{
		const at = Date.parse(entity.lastChangedAt);
		if (!Number.isNaN(at) && (Number.isNaN(latest) || at > latest))
		{
			latest = at;
			lastChangedAt = entity.lastChangedAt;
		}
	}
	return {
		windowMode: all.some((entity) => entity.windowMode === "active") ? "active" : "cache",
		lastChangedAt,
	};
}
