import { formatMonthDay } from "../../format/datetime.js";

/**
 * The player's game link label for a clip's game: `NYY @ BOS, Sep 21` (S70's "Go to game: …"), away
 * then home, then MLB's game date as month and day. The one label (ADR-025): the day digest (S71)
 * and Search (S5) both name their clips' games with it.
 */
export function gameLabel(game: { away: string;
	home: string;
	officialDate: string; }): string
{
	return `${game.away} @ ${game.home}, ${formatMonthDay(game.officialDate)}`;
}
