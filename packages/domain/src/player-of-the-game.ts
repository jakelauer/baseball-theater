import type {
	GamePlayMetrics, GameSnapshot, PlayerOfTheGame,
} from "./types.js";
import { isFinalStatus } from "./window.js";

/**
 * The first season MLB names a player of the game (S99): mlb.com's Gameday config,
 * `playerOfTheGameMinYear: 2024` (owner, 2026-10-30, "Ok, agreed"). BT does not ingest the config.
 */
export const PLAYER_OF_THE_GAME_MIN_SEASON = 2024;

/**
 * The game types MLB names a player of the game for (S99): regular season and the four postseason
 * rounds, mlb.com's Gameday config `playerOfTheGameGameTypes: ["R","F","D","L","W"]`.
 */
export const PLAYER_OF_THE_GAME_GAME_TYPES: readonly string[] = ["R", "F", "D", "L", "W"];

/**
 * Whether ingest should ask MLB for a game's player of the game (S99): only a game that is over
 * (`isFinalStatus`, since MLB picks once the game ends, so a live poll never asks), of a type and
 * season MLB picks for. A game whose type or season the feed doesn't say is not asked for: the
 * feed is optional, and asking a game it never covers is a request for nothing.
 */
export function playerOfTheGameExpected(game: { gameType: string | undefined;
	season: string | undefined;
	codedGameState: string; }): boolean
{
	const season = Number(game.season);
	return isFinalStatus(game.codedGameState)
		&& game.gameType !== undefined && PLAYER_OF_THE_GAME_GAME_TYPES.includes(game.gameType)
		&& Number.isInteger(season) && season >= PLAYER_OF_THE_GAME_MIN_SEASON;
}

/** Whether both picks, the media's and the fans', are named (S99 review): until then ingest still asks for the other. */
export function playerOfTheGameComplete(pick: PlayerOfTheGame | null | undefined): boolean
{
	return pick?.media !== undefined && pick.fan !== undefined;
}

/**
 * The incoming game with each pick the stored game has and the incoming one lacks kept (S99 review), side by side:
 * MLB names the media pick first and the fans' later, and an answer can lack a side because its request failed, ran
 * past its limit or wasn't made, so only a side the new answer names replaces the stored one; a side is never cleared.
 * Every game write calls it before stamping the version (`storeGames`, the late answers' write), so a refresh that
 * missed the pick neither drops it nor makes a new version for its absence. The incoming game unchanged when neither
 * has a pick.
 */
export function keepPlayerOfTheGame<T extends { playerOfTheGame?: PlayerOfTheGame }>(stored: { playerOfTheGame?: PlayerOfTheGame } | null | undefined, incoming: T): T
{
	const media = incoming.playerOfTheGame?.media ?? stored?.playerOfTheGame?.media;
	const fan = incoming.playerOfTheGame?.fan ?? stored?.playerOfTheGame?.fan;
	if (!media && !fan) return incoming;
	return {
		...incoming,
		playerOfTheGame: {
			...media && {
				media,
			},
			...fan && {
				fan,
			},
		},
	};
}

/**
 * The extras ingest asks off the game fetch and keeps across refreshes (S99, generalized for S101 and S100): the player
 * of the game, the uniforms and the rule settings, and Savant's figures (S103), which the game's ingest object pulls on
 * its own cadence. A fetched game carries one only when its write asked for it, so every game write keeps the stored
 * value its incoming game lacks ({@link keepStoredExtras}).
 */
export type StoredExtras = Pick<GameSnapshot, "playerOfTheGame" | "uniforms" | "ruleSettings" | "savant">;

/**
 * The extras kept whole (S101, S100): a stored value stays until an incoming game names a new one. A new extra asked off
 * the fetch path joins this list rather than getting its own keep (ADR-025). The player of the game is kept side by side
 * instead ({@link keepPlayerOfTheGame}), since MLB names its two picks at different times.
 */
const KEPT_WHOLE = ["uniforms", "ruleSettings"] as const satisfies readonly (keyof StoredExtras)[];

/** An extra kept whole ({@link KEPT_WHOLE}), asked while none is stored ({@link askedExtraDue}). */
export type AskedExtra = (typeof KEPT_WHOLE)[number];

/**
 * The incoming game with every extra the stored game has and the incoming one lacks kept (S99, S101, S100, S103): the one
 * keep every game write calls before stamping the version (`storeGames`, the late answers' write), so a refresh that
 * didn't ask, or whose ask failed or ran past its limit, neither drops a stored extra nor makes a new version for its
 * absence. Savant's figures are kept whole too: only the Savant write carries them, already merged with the stored ones
 * (`mergeSavantPitches`), and every other write lacks them.
 */
export function keepStoredExtras<T extends StoredExtras>(stored: StoredExtras | null | undefined, incoming: T): T
{
	let kept = keepPlayerOfTheGame(stored, incoming);
	for (const key of [...KEPT_WHOLE, "savant"] as const)
	{
		if (kept[key] === undefined && stored?.[key] !== undefined) kept = {
			...kept,
			[key]: stored[key],
		};
	}
	return kept;
}

/**
 * Whether ingest should ask MLB for a game's `extra` (S101's uniforms, S100's rule settings): only while none is stored,
 * and then when it first stores the game, sees its status change (scheduled, warming up, live, final), or writes a game
 * that is over (`isFinalStatus`, as S99 asks a final game still missing its pick, #621's review). So a live poll whose
 * status stays the same never asks again; a final game stored without it (before its story, or whose ask found nothing)
 * is asked once per write that refreshes it: its ingest object's final-trail polls, a cold read, a re-check. Both are
 * settled before first pitch.
 */
export function askedExtraDue(extra: AskedExtra, stored: (Partial<Pick<GameSnapshot, AskedExtra>> & {
	status: { codedGameState: string };
}) | null | undefined, codedGameState: string): boolean
{
	if (stored?.[extra] !== undefined) return false;
	return stored?.status.codedGameState !== codedGameState || isFinalStatus(codedGameState);
}

/**
 * The last at-bat a game's play metrics reach (its highest `atBatIndex`; -1 for none), read off the last entry since
 * the mapper sorts them by at-bat (`mapPlayMetrics`). How a late write over another writer's snapshot (B577 review,
 * `lateAdditions` in ingest) tells a fuller set from one carried over an older feed: only a set reaching a later at-bat
 * replaces the stored one.
 */
export function lastMeasuredAtBat(metrics: GamePlayMetrics): number
{
	return metrics.atBats.at(-1)?.atBatIndex ?? -1;
}
