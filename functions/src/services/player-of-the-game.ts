/**
 * Asking MLB for a game's player of the game (S99, after its pre-PR review): the game fetch never asks it (it says
 * only whether the game is due one, `FetchedGame.playerOfTheGameDue`), so each ingest path decides here, with what it
 * knows of the stored game, whether to spend the request. A game whose stored pick has both sides is never asked
 * again; one that is missing a side is, and each answer is merged side by side into the stored game when it is
 * written (`keepPlayerOfTheGame` in `storeGames`), so a failed or slow ask never clears a stored side.
 *
 * Every ask is bounded by S216's {@link PLAY_METRICS_LIMIT_MS}: an answer that hasn't come by then counts as no pick,
 * so a hanging mlb.com request can hold neither a read nor a poll.
 */
import type { FetchedGame, PlayerOfTheGame } from "@bt/domain";
import { playerOfTheGameComplete } from "@bt/domain";
import type { MlbStatsClient } from "@bt/ports";
import { PLAY_METRICS_LIMIT_MS } from "../adapters/http/mlb.js";
import { withPlayerOfTheGame } from "../mappers/player-of-the-game.js";

/** `fetchPlayerOfTheGame`, null once {@link PLAY_METRICS_LIMIT_MS} passes with no answer (the request is left to finish unseen). */
export async function askPlayerOfTheGame(mlb: Pick<MlbStatsClient, "fetchPlayerOfTheGame">, gamePk: number): Promise<PlayerOfTheGame | null>
{
	let timer: ReturnType<typeof setTimeout> | undefined;
	const limit = new Promise<null>((resolve) =>
	{
		timer = setTimeout(() => resolve(null), PLAY_METRICS_LIMIT_MS);
	});
	return Promise.race([mlb.fetchPlayerOfTheGame(gamePk).catch(() => null), limit]).finally(() => clearTimeout(timer));
}

/**
 * The fetched game with its player of the game attached, when the game is due one and `stored` (the stored game's
 * pick, if the caller knows it) lacks a side; otherwise the fetched game as it is, asking nothing. `asked`, when given,
 * is an ask the caller started beside the fetch (the cold read, so the two run at once), used instead of a new one.
 * Only the game is given the pick: a late playMetrics game (`playMetricsLate`) is built without it, and its write
 * keeps the stored pick (`keepPlayerOfTheGame`).
 */
export async function withAskedPlayerOfTheGame(
	mlb: Pick<MlbStatsClient, "fetchPlayerOfTheGame">,
	fetched: FetchedGame,
	stored: PlayerOfTheGame | undefined,
	asked?: Promise<PlayerOfTheGame | null>,
): Promise<FetchedGame>
{
	if (!fetched.playerOfTheGameDue || playerOfTheGameComplete(stored)) return fetched;
	const pick = await (asked ?? askPlayerOfTheGame(mlb, fetched.game.gamePk));
	return pick
		? {
			...fetched,
			game: withPlayerOfTheGame(fetched.game, pick),
		}
		: fetched;
}
