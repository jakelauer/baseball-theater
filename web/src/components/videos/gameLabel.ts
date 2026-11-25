import { formatMonthDay } from "../../format/datetime.js";

/**
 * A clip's game as the player's game pill speaks it: `NYY @ BOS, Sep 21` (S173's `gameVideosLink`),
 * away then home, then MLB's game date as month and day. The one label (ADR-025): the floating
 * player names the game of a clip from the day digest (S71) or Search (S5) with it.
 */
export function gameLabel(game: { away: string;
	home: string;
	officialDate: string; }): string
{
	return `${game.away} @ ${game.home}, ${formatMonthDay(game.officialDate)}`;
}
