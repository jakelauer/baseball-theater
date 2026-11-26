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
 * S101 asks the uniforms the same way, and S100 the rule settings beside them, through the same bounded ask
 * ({@link askWithinLimit}) and the same keep (`keepStoredExtras`), deciding each with `askedExtraDue` instead
 * ({@link withAskedExtras}).
 */
import type {
	AskedExtra, FetchedGame, GameRuleSetting, GameSnapshot, GameUniforms, PlayerOfTheGame, StoredExtras, Unversioned,
} from "@bt/domain";
import { askedExtraDue, playerOfTheGameComplete } from "@bt/domain";
import type { MlbStatsClient } from "@bt/ports";
import { PLAY_METRICS_LIMIT_MS } from "../adapters/http/mlb.js";
import { withPlayerOfTheGame } from "../mappers/player-of-the-game.js";

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

/** `fetchGameRuleSettings` through {@link askWithinLimit} (S100). */
export function askGameRuleSettings(mlb: Pick<MlbStatsClient, "fetchGameRuleSettings">, gamePk: number): Promise<GameRuleSetting[] | null>
{
	return askWithinLimit(() => mlb.fetchGameRuleSettings(gamePk));
}

/** The client methods the extras kept whole are asked through. */
export type ExtraAsker = Pick<MlbStatsClient, "fetchGameUniforms" | "fetchGameRuleSettings">;

/** The extras kept whole, as an ingest path holds them: each one's answer, present only when MLB gave one. */
export type AskedExtras = Partial<Pick<GameSnapshot, AskedExtra>>;

/** Asks started before the game fetch (a cold read of a game not stored yet), one per extra kept whole. */
export type EarlyExtraAsks = { [K in AskedExtra]: Promise<NonNullable<GameSnapshot[K]> | null> };

/** Starts every extra's ask at once, for a caller that knows they are due before the fetch answers (a game not stored yet). */
export function startExtraAsks(mlb: ExtraAsker, gamePk: number): EarlyExtraAsks
{
	return {
		uniforms: askGameUniforms(mlb, gamePk),
		ruleSettings: askGameRuleSettings(mlb, gamePk),
	};
}

/**
 * The extras kept whole the game is due (S101's uniforms, S100's rule settings), asked at once, so a write waits one
 * bounded limit at most, never one per extra: each only when the game lacks it and `askedExtraDue` says to ask (none
 * stored, and the game is new to the store, its status changed, or it is final); a game due none asks nothing. `stored`
 * is the stored game the caller read (null when none). `early`, when given, holds asks the caller started beside the
 * fetch ({@link startExtraAsks}), used instead of new ones. Only the answers MLB gave are returned, so an answer of none
 * leaves the game as it is and the write keeps a stored value (`keepStoredExtras`).
 */
export async function askDueExtras(
	mlb: ExtraAsker,
	game: Unversioned<GameSnapshot>,
	stored: (StoredExtras & Pick<GameSnapshot, "status">) | null | undefined,
	early?: EarlyExtraAsks,
): Promise<AskedExtras>
{
	const due = (extra: AskedExtra) => game[extra] === undefined && askedExtraDue(extra, stored, game.status.codedGameState);
	const [uniforms, ruleSettings] = await Promise.all([
		due("uniforms") ? early?.uniforms ?? askGameUniforms(mlb, game.gamePk) : null,
		due("ruleSettings") ? early?.ruleSettings ?? askGameRuleSettings(mlb, game.gamePk) : null,
	]);
	return {
		...uniforms && {
			uniforms,
		},
		...ruleSettings && {
			ruleSettings,
		},
	};
}

/** The game with every extra it is due attached ({@link askDueExtras}); the game as it is when it is due none. */
export async function withAskedExtras(
	mlb: ExtraAsker,
	game: Unversioned<GameSnapshot>,
	stored: (StoredExtras & Pick<GameSnapshot, "status">) | null | undefined,
	early?: EarlyExtraAsks,
): Promise<Unversioned<GameSnapshot>>
{
	const asked = await askDueExtras(mlb, game, stored, early);
	return Object.keys(asked).length > 0
		? {
			...game,
			...asked,
		}
		: game;
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
