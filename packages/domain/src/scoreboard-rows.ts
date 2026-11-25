/**
 * How the scoreboard lays out a day (S68; shell-scoreboard `scoreboard-collapsed-*`):
 * with Collapse Non-Favorites on, games featuring a favorite team stay full modules and
 * come first; the rest fold into slim bars. One answer for the page (ADR-025).
 */
import { gamePhase } from "./game-phase.js";
import { inningLabel } from "./inning.js";
import { countShorthand } from "./slot-occupant.js";
import type { ScheduleGameSummary } from "./types.js";

export type ScoreboardRow = {
	game: ScheduleGameSummary;
	collapsed: boolean;
};

/**
 * Whether a game is a favorite team's: its away or its home team is among
 * `favoriteTeamIds` (false for an empty list). The one rule for it (S213, ADR-025), so
 * the scoreboard's Collapse Non-Favorites (`scoreboardRows`), the open-time prefetch
 * (`prefetchOnOpen`, web) and the favorites-first order (B430) can't disagree.
 */
export function isFavoriteGame(game: Pick<ScheduleGameSummary, "teams">, favoriteTeamIds: readonly number[]): boolean
{
	return favoriteTeamIds.includes(game.teams.away.id) || favoriteTeamIds.includes(game.teams.home.id);
}

/**
 * The scoreboard's sort choices (B430, #430): `default`, the owner's order (`sortScoreboardGames`),
 * or `startTime`, every game by first pitch alone.
 */
export type ScoreboardSort = "default" | "startTime";

/**
 * The day's games in `sort` order (B430, #430; owner, 2026-11-23: "We sort them by start time, so the
 * earliest ones first, but we always sort games that are in progress before games that are not in
 * progress … but the rule that overrides them all is that favorite teams are always first, and then you
 * sort the same the favorite team's games early to late"). `default`: favorites' games
 * (`isFavoriteGame`) first; within each part, games in progress (`gamePhase` `live`) before the rest;
 * then by `startTime`, earliest first. `startTime`: by start time only. Games with no start time go
 * after the timed ones of their part, and ties keep the order given.
 */
export function sortScoreboardGames(games: readonly ScheduleGameSummary[], favoriteTeamIds: readonly number[], sort: ScoreboardSort): ScheduleGameSummary[]
{
	const time = (game: ScheduleGameSummary) => (game.startTime ? Date.parse(game.startTime) : Number.NaN);
	const rank = (game: ScheduleGameSummary) => (sort === "default"
		? (isFavoriteGame(game, favoriteTeamIds) ? 0 : 2) + (gamePhase(game.status.codedGameState) === "live" ? 0 : 1)
		: 0);
	return games.map((game, index) => ({
		game,
		index,
	})).sort((a, b) =>
	{
		const byRank = rank(a.game) - rank(b.game);
		if (byRank !== 0) return byRank;
		const ta = time(a.game);
		const tb = time(b.game);
		if (Number.isNaN(ta) !== Number.isNaN(tb)) return Number.isNaN(ta) ? 1 : -1;
		if (Number.isNaN(ta) || ta === tb) return a.index - b.index;
		return ta - tb;
	}).map(({ game }) => game);
}

/**
 * The day's games as rows. With Collapse Non-Favorites off — or no favorites to keep
 * open — every game is a full module in the order given. On, favorites' games
 * (`isFavoriteGame`) come first (in their given order), then every other game collapsed.
 */
export function scoreboardRows(games: readonly ScheduleGameSummary[], favoriteTeamIds: readonly number[], collapseNonFavorites: boolean): ScoreboardRow[]
{
	if (!collapseNonFavorites || favoriteTeamIds.length === 0)
	{
		return games.map((game) => ({
			game,
			collapsed: false,
		}));
	}
	return [
		...games.filter((game) => isFavoriteGame(game, favoriteTeamIds)).map((game) => ({
			game,
			collapsed: false,
		})),
		...games.filter((game) => !isFavoriteGame(game, favoriteTeamIds)).map((game) => ({
			game,
			collapsed: true,
		})),
	];
}

export type CollapsedBarState = {
	/** `5–2`, centered between the teams; `null` with scores hidden or no runs yet (the bar shows `@`). */
	score: string | null;
	/** The muted line under it: `Final`, or the inning and count while live (`Bot 7th · 2-2, 2 out`). */
	state: string;
};

/**
 * What a collapsed bar says (S56 A2, S57 A3; owner, 2026-10-30: "the collapsed ones should
 * show the score (when it's not hidden) by centering the score with the teams on either
 * side, like: NYY  5 - 2  BOS, with the BSO subtly under it"). Live: the score, then the
 * inning and the count (`countShorthand`) under it; final: the score over `Final`. With
 * scores hidden the score is left out and the state stays — the count too, as on the
 * module (A3). Before first pitch there is no score or inning, so `null`: the bar shows
 * its start time.
 */
export function collapsedBarState(game: Pick<ScheduleGameSummary, "status" | "linescore" | "live">, scoresHidden: boolean): CollapsedBarState | null
{
	const phase = gamePhase(game.status.codedGameState);
	if (phase === "pregame") return null;
	const count = phase === "live" && game.live ? countShorthand(game.live) : null;
	const inning = phase === "final" ? "Final" : inningLabel(game.linescore) ?? "Live";
	const away = game.linescore?.teams.away.runs;
	const home = game.linescore?.teams.home.runs;
	return {
		score: scoresHidden || away == null || home == null ? null : `${away}–${home}`,
		state: count ? `${inning} · ${count}` : inning,
	};
}
