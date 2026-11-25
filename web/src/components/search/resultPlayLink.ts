import type { SearchHighlightsPayload } from "../../api/search.js";
import { playInningLink } from "../videos/playLink.js";
import type { PlayLink } from "../videos/playLink.js";

/**
 * A result's link to its play (S153; game-shell A6): `playInningLink` from the route's play id,
 * half-inning and inning and the game's pk. Null unless all four are there: a clip with no play, or
 * one MLB ties to no game (`gamePk: -1`, so `game` is null), has no pill, and BT never loads the game
 * to find what MLB left out (owner, 2026-11-19: "Show no pill (Recommended)"). The one place a
 * result's play link is built: its card's pill and its player's, both in `SearchPage` (S173).
 */
export function resultPlayLink({
	highlight, game, halfInning, inning,
}: SearchHighlightsPayload["highlights"][number]): PlayLink | null
{
	if (!game || !highlight.playId || !halfInning || inning === null) return null;
	return playInningLink({
		gamePk: game.gamePk,
		playId: highlight.playId,
		halfInning,
		inning,
	});
}
