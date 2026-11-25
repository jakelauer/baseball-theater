/**
 * Asking MLB for a game's player of the game (S99, after its pre-PR review): the game fetch never asks it (it says
 * only whether the game is due one, `FetchedGame.playerOfTheGameDue`), so each ingest path decides here, with what it
 * knows of the stored game, whether to spend the request. A game whose stored pick has both sides is never asked
 * again; one that is missing a side is, and each answer is merged side by side into the stored game when it is
 * written (`keepPlayerOfTheGame` in `storeGames`), so a failed or slow ask never clears a stored side.
 *
 * Every ask is bounded by S216's {@link PLAY_METRICS_LIMIT_MS}: an answer that hasn't come by then counts as no pick,
 * so a hanging mlb.com request can hold neither a read nor a poll.
 *
 * S101 asks the uniforms the same way, through the same bounded ask ({@link askWithinLimit}) and the same keep
 * (`keepStoredExtras`), deciding with `uniformsDue` instead.
 */
import type {
	FetchedGame, GameSnapshot, GameUniforms, PlayerOfTheGame, StoredExtras, Unversioned,
} from "@bt/domain";
import { playerOfTheGameComplete, uniformsDue } from "@bt/domain";
import type { MlbStatsClient } from "@bt/ports";
import { PLAY_METRICS_LIMIT_MS } from "../adapters/http/mlb.js";
import { withPlayerOfTheGame } from "../mappers/player-of-the-game.js";
import { withGameUniforms } from "../mappers/uniforms.js";

/**
 * One ask of an extra off the game fetch (S99, generalized for S101): its answer, or null when it fails or once
 * {@link PLAY_METRICS_LIMIT_MS} passes with none (the request is left to finish unseen), so a hanging request holds
 * neither a read nor a poll. Every extra ingest asks off the fetch goes through it (ADR-025).
 */
export async function askWithinLimit<T>(ask: () => Promise<T | null>): Promise<T | null>
{
	let timer: ReturnType<typeof setTimeout> | undefined;
	const limit = new Promise<null>((resolve) =>
	{
		timer = setTimeout(() => resolve(null), PLAY_METRICS_LIMIT_MS);
	});
	return Promise.race([Promise.resolve().then(ask).catch(() => null), limit]).finally(() => clearTimeout(timer));
}

/** `fetchPlayerOfTheGame` through {@link askWithinLimit}. */
export function askPlayerOfTheGame(mlb: Pick<MlbStatsClient, "fetchPlayerOfTheGame">, gamePk: number): Promise<PlayerOfTheGame | null>
{
	return askWithinLimit(() => mlb.fetchPlayerOfTheGame(gamePk));
}

/** `fetchGameUniforms` through {@link askWithinLimit} (S101). */
export function askGameUniforms(mlb: Pick<MlbStatsClient, "fetchGameUniforms">, gamePk: number): Promise<GameUniforms | null>
{
	return askWithinLimit(() => mlb.fetchGameUniforms(gamePk));
}

/**
 * The game with its uniforms attached (S101), when `uniformsDue` says to ask (none stored, and the game is new to the
 * store, its status changed, or it is final); otherwise the game as it is, asking nothing. `stored` is the stored game the caller
 * read (null when none). `asked`, when given, is an ask the caller started beside the fetch (a cold read of a game not
 * stored yet), used instead of a new one. An answer of none leaves the game as it is, and the write keeps a stored
 * value (`keepStoredExtras`).
 */
export async function withAskedUniforms(
	mlb: Pick<MlbStatsClient, "fetchGameUniforms">,
	game: Unversioned<GameSnapshot>,
	stored: (StoredExtras & Pick<GameSnapshot, "status">) | null | undefined,
	asked?: Promise<GameUniforms | null>,
): Promise<Unversioned<GameSnapshot>>
{
	if (game.uniforms !== undefined || !uniformsDue(stored, game.status.codedGameState)) return game;
	return withGameUniforms(game, await (asked ?? askGameUniforms(mlb, game.gamePk)));
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
