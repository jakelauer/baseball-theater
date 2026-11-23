/**
 * MLB's player of the game (`www.mlb.com/apps/player-of-the-game/game/json/winners/{gamePk}.json`; S99):
 * an mlb.com app feed, not the documented Stats API, so it may change without notice; BT treats it as
 * optional. mlb.com's Gameday config says it exists from 2024 on and only for regular-season and
 * postseason games.
 *
 * Split by purpose: one pick (who, his team, his line and the win probability he added) and the
 * response that holds the two picks. A pick nobody made yet comes back with every field null.
 */

/**
 * One pick: the media's or the fans'. `feedId` is the player's MLB person id as a string and `teamID`
 * his team's id as a string; `playerId` is the app's own id, not MLB's. `WPA` is the win probability
 * he added, in percentage points. `summary` is his line (`1.2 IP, 0 ER, K, BB`), `summaryES` the same in Spanish.
 */
export interface PlayerOfTheGameWinner {
	playerId?: number | null;
	feedId?: string | null;
	boxscoreName?: string | null;
	WPA?: number | null;
	teamID?: string | null;
	summary?: string | null;
	summaryES?: string | null;
}

/** The feed's answer for one game: its `gamePK` (a string) and both picks. */
export interface PlayerOfTheGameResponse {
	gamePK?: string;
	fanWinner?: PlayerOfTheGameWinner;
	mediaWinner?: PlayerOfTheGameWinner;
}
