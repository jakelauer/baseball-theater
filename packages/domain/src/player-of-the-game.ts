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
