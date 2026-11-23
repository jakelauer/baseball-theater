/**
 * Pure upstream → BT mapper for MLB's player of the game (S99). Each pick keeps MLB's person id
 * (the feed's `feedId`, a string), the team id, the line and the win probability added; the app's
 * own `playerId`, the box-score name and the Spanish line stay upstream (a view looks the player up
 * by id). A pick with no player is left out, and an answer with neither pick maps to null, so the
 * game is served without the field.
 */
import type {
	GameSnapshot, PlayerOfTheGame, PlayerOfTheGamePick, Unversioned,
} from "@bt/domain";
import type { PlayerOfTheGameResponse, PlayerOfTheGameWinner } from "@bt/mlb-api";

/** A positive whole-number id from the feed's string, or null for a missing or malformed one. */
function idOf(value: string | null | undefined): number | null
{
	if (value === null || value === undefined || !/^\d+$/.test(value)) return null;
	const id = Number(value);
	return id > 0 ? id : null;
}

/** One pick, or undefined when MLB named no player for it (the feed's every-field-null pick). */
function mapPick(winner: PlayerOfTheGameWinner | undefined): PlayerOfTheGamePick | undefined
{
	const playerId = idOf(winner?.feedId);
	if (!winner || playerId === null) return undefined;
	return {
		playerId,
		teamId: idOf(winner.teamID),
		summary: winner.summary ?? null,
		winProbabilityAdded: winner.WPA ?? null,
	};
}

/** The game's picks, or null when MLB named nobody for either. */
export function mapPlayerOfTheGame(response: PlayerOfTheGameResponse): PlayerOfTheGame | null
{
	const media = mapPick(response.mediaWinner);
	const fan = mapPick(response.fanWinner);
	if (!media && !fan) return null;
	return {
		...media && {
			media,
		},
		...fan && {
			fan,
		},
	};
}

/**
 * A fetched game with its player of the game attached, or the game unchanged when there is none
 * (the call failed, was slow, wasn't asked or named nobody), so it is served as before. Both MLB
 * adapters' `fetchGame` attach it here.
 */
export function withPlayerOfTheGame(game: Unversioned<GameSnapshot>, playerOfTheGame: PlayerOfTheGame | null): Unversioned<GameSnapshot>
{
	return playerOfTheGame
		? {
			...game,
			playerOfTheGame,
		}
		: game;
}
