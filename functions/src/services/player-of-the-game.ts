/**
 * Asking MLB for a game's player of the game (S99, after its pre-PR review): the game fetch never asks it (it says
 * only whether the game is due one, `FetchedGame.playerOfTheGameDue`), so each ingest path decides here, with what it
 * knows of the stored game, whether to spend the request. A game whose stored pick has both sides is never asked
 * again; one that is missing a side is, and each answer is merged side by side into the stored game when it is
 * written (`keepPlayerOfTheGame` in `storeGames`), so a failed or slow ask never clears a stored side.
 *
 * Every ask is bounded by S216's {@link PLAY_METRICS_LIMIT_MS}: an answer that hasn't come by then counts as no pick,
 * so a hanging mlb.com request can hold neither a read nor a poll. B577: an ask made after a digest's response, which
 * nothing waits on but the background work, is given {@link LATE_ASK_LIMIT_MS} instead ({@link AskLimit}): it may queue
 * behind a day's other asks for one of the Worker's six connections, which 750 ms counted from its start wouldn't cover.
 *
 * S101 asks the uniforms the same way, and S100 the rule settings beside them, through the same bounded ask
 * ({@link askWithinLimit}) and the same keep (`keepStoredExtras`), deciding each with `askedExtraDue` instead
 * ({@link withAskedExtras}).
 */
import type {
	AskedExtra, FetchedGame, GamePlayMetrics, GameRuleSetting, GameSnapshot, GameUniforms, PlayerOfTheGame, StoredExtras, Unversioned,
} from "@bt/domain";
import { askedExtraDue, playerOfTheGameComplete } from "@bt/domain";
import type { MlbStatsClient } from "@bt/ports";
import { PLAY_METRICS_LIMIT_MS } from "../adapters/http/mlb.js";
import { withPlayerOfTheGame } from "../mappers/player-of-the-game.js";

/**
 * How long an ask made after a digest's response may take (B577): 15 s, counted from when it is made, so it includes the
 * time it waits in the Worker's queue for one of its six connections (the queue is the runtime's; nothing in the code
 * sees when a request leaves it). A cold day's four after-answer asks a game (playMetrics ~0.9 s, uniforms ~0.07 s, rule
 * settings ~0.15 s, player of the game ~0.21 s, as measured for issue #577) take ~3.6 s for a 16-game day through six
 * connections, so this is about four times that. The budget it sits in: a Worker's `waitUntil` allows 30 s after the
 * response, and the after-write steps run in order (`runAfterWrites`): the projection write, the edge purge and the day
 * hub calls (well under 2 s), then the late answers (at most this limit, plus their writes), then the venue drawings of
 * games stored for the first time (S105). That is typically ~20 s; but the venue step asks one venue after another at
 * up to 3 s each (`keepVenueFields`), so on a slow day it can be cut at 30 s. That costs only venue drawings: a venue
 * cut before its answer is stored has nothing kept, so it is asked again when the next game there is first stored. The
 * venue step stays after the late asks rather than beside them, where its 3 s would run while it queued behind them.
 */
export const LATE_ASK_LIMIT_MS = 15_000;

/**
 * A limit an ask is given in place of {@link PLAY_METRICS_LIMIT_MS} (B577's {@link LATE_ASK_LIMIT_MS}), and the name its
 * log line gives the asking path when an ask runs out of it, so a dropped answer is seen rather than silently absent.
 */
export type AskLimit = { ms: number;
	name: string; };

/**
 * One ask of an extra off the game fetch (S99, generalized for S101): its answer, or null when it fails or once
 * `limitMs` ({@link PLAY_METRICS_LIMIT_MS} unless given) passes with none (the request is left to finish unseen), so a
 * hanging request holds neither a read nor a poll; `onLimit` is told when the limit is what ended it (B577). Every extra
 * ingest asks off the fetch goes through it (ADR-025); Savant's pull (S103) too, with its own longer `limitMs`, since
 * its answer is megabytes and it is asked after the poll's write, never before it.
 */
export async function askWithinLimit<T>(ask: () => Promise<T | null>, limitMs: number = PLAY_METRICS_LIMIT_MS, onLimit?: () => void): Promise<T | null>
{
	let timer: ReturnType<typeof setTimeout> | undefined;
	const limit = new Promise<null>((resolve) =>
	{
		timer = setTimeout(() =>
		{
			onLimit?.();
			resolve(null);
		}, limitMs);
	});
	return Promise.race([Promise.resolve().then(ask).catch(() => null), limit]).finally(() => clearTimeout(timer));
}

/** {@link askWithinLimit} with `limit` when given (warning, by `what` and `gamePk`, when an ask runs out of it), else its default. */
function askWithin<T>(ask: () => Promise<T | null>, what: string, gamePk: number, limit: AskLimit | undefined): Promise<T | null>
{
	if (!limit) return askWithinLimit(ask);
	return askWithinLimit(ask, limit.ms, () => console.warn(`${limit.name}: ${what} of game ${gamePk} had no answer within ${limit.ms} ms; left out`));
}

/** `fetchPlayerOfTheGame` through {@link askWithinLimit}; `limit` in place of its default (B577). */
export function askPlayerOfTheGame(mlb: Pick<MlbStatsClient, "fetchPlayerOfTheGame">, gamePk: number, limit?: AskLimit): Promise<PlayerOfTheGame | null>
{
	return askWithin(() => mlb.fetchPlayerOfTheGame(gamePk), "player of the game", gamePk, limit);
}

/** `fetchGameUniforms` through {@link askWithinLimit} (S101); `limit` in place of its default (B577). */
export function askGameUniforms(mlb: Pick<MlbStatsClient, "fetchGameUniforms">, gamePk: number, limit?: AskLimit): Promise<GameUniforms | null>
{
	return askWithin(() => mlb.fetchGameUniforms(gamePk), "uniforms", gamePk, limit);
}

/** `fetchGameRuleSettings` through {@link askWithinLimit} (S100); `limit` in place of its default (B577). */
export function askGameRuleSettings(mlb: Pick<MlbStatsClient, "fetchGameRuleSettings">, gamePk: number, limit?: AskLimit): Promise<GameRuleSetting[] | null>
{
	return askWithin(() => mlb.fetchGameRuleSettings(gamePk), "rule settings", gamePk, limit);
}

/** `fetchPlayMetrics` through {@link askWithinLimit} with `limit` (B577: a digest's batch asks them after its answer). */
export function askPlayMetrics(mlb: Pick<MlbStatsClient, "fetchPlayMetrics">, gamePk: number, limit: AskLimit): Promise<GamePlayMetrics | null>
{
	return askWithin(() => mlb.fetchPlayMetrics(gamePk), "playMetrics", gamePk, limit);
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
 * fetch ({@link startExtraAsks}), used instead of new ones; `limit` is each new ask's limit (B577), else the default.
 * Only the answers MLB gave are returned, so an answer of none leaves the game as it is and the write keeps a stored
 * value (`keepStoredExtras`).
 */
export async function askDueExtras(
	mlb: ExtraAsker,
	game: Unversioned<GameSnapshot>,
	stored: (StoredExtras & Pick<GameSnapshot, "status">) | null | undefined,
	early?: EarlyExtraAsks,
	limit?: AskLimit,
): Promise<AskedExtras>
{
	const due = (extra: AskedExtra) => game[extra] === undefined && askedExtraDue(extra, stored, game.status.codedGameState);
	const [uniforms, ruleSettings] = await Promise.all([
		due("uniforms") ? early?.uniforms ?? askGameUniforms(mlb, game.gamePk, limit) : null,
		due("ruleSettings") ? early?.ruleSettings ?? askGameRuleSettings(mlb, game.gamePk, limit) : null,
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
 * is an ask the caller started beside the fetch (the cold read, so the two run at once), used instead of a new one;
 * `limit` is a new ask's limit (B577), else the default. Only the game is given the pick: S216's late playMetrics game
 * (`playMetricsLate`) is built without it, and its write keeps the stored pick (`keepPlayerOfTheGame`); a digest's late
 * answers (B577) are built over the game given it.
 */
export async function withAskedPlayerOfTheGame(
	mlb: Pick<MlbStatsClient, "fetchPlayerOfTheGame">,
	fetched: FetchedGame,
	stored: PlayerOfTheGame | undefined,
	asked?: Promise<PlayerOfTheGame | null>,
	limit?: AskLimit,
): Promise<FetchedGame>
{
	if (!fetched.playerOfTheGameDue || playerOfTheGameComplete(stored)) return fetched;
	const pick = await (asked ?? askPlayerOfTheGame(mlb, fetched.game.gamePk, limit));
	return pick
		? {
			...fetched,
			game: withPlayerOfTheGame(fetched.game, pick),
		}
		: fetched;
}
