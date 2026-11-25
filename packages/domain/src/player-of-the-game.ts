import type { GameSnapshot, PlayerOfTheGame } from "./types.js";
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
 * Every game write calls it before stamping the version (`storeGames`, the late playMetrics write), so a refresh that
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
 * The extras ingest asks off the game fetch and keeps across refreshes (S99, generalized for S101): the player of the
 * game and the uniforms. A fetched game carries one only when its write asked for it, so every game write keeps the
 * stored value its incoming game lacks ({@link keepStoredExtras}).
 */
export type StoredExtras = Pick<GameSnapshot, "playerOfTheGame" | "uniforms">;

/**
 * The extras kept whole (S101): a stored value stays until an incoming game names a new one. A new extra asked off the
 * fetch path joins this list rather than getting its own keep (ADR-025). The player of the game is kept side by side
 * instead ({@link keepPlayerOfTheGame}), since MLB names its two picks at different times.
 */
const KEPT_WHOLE = ["uniforms"] as const satisfies readonly (keyof StoredExtras)[];

/**
 * The incoming game with every extra the stored game has and the incoming one lacks kept (S99, S101): the one keep every
 * game write calls before stamping the version (`storeGames`, the late playMetrics write), so a refresh that didn't ask,
 * or whose ask failed or ran past its limit, neither drops a stored extra nor makes a new version for its absence.
 */
export function keepStoredExtras<T extends StoredExtras>(stored: StoredExtras | null | undefined, incoming: T): T
{
	let kept = keepPlayerOfTheGame(stored, incoming);
	for (const key of KEPT_WHOLE)
	{
		if (kept[key] === undefined && stored?.[key] !== undefined) kept = {
			...kept,
			[key]: stored[key],
		};
	}
	return kept;
}

/**
 * Whether ingest should ask MLB for a game's uniforms (S101): only while none is stored, and only when it first stores
 * the game or sees its status change (scheduled, warming up, live, final), so a live poll whose status stays the same
 * never asks again, and a game MLB lists nothing for is asked a few times at most. Clubs set them before first pitch.
 */
export function uniformsDue(stored: { uniforms?: GameSnapshot["uniforms"];
	status: { codedGameState: string }; } | null | undefined, codedGameState: string): boolean
{
	return stored?.uniforms === undefined && stored?.status.codedGameState !== codedGameState;
}
