import { isFinalStatus, isLiveStatus } from "./window.js";

/**
 * Which rooms a game offers, by phase (S32 / S40): pre-game Videos · Plays · Box;
 * in progress adds Live; final adds Recap — never Live and Recap together. Recap
 * only when MLB has published one (VISUAL-DESIGN §5 "when available"; S10).
 */
export const ROOMS = ["videos", "live", "plays", "box", "recap"] as const;
export type Room = (typeof ROOMS)[number];

export type GamePhase = "pregame" | "live" | "final";

export const DEFAULT_ROOM: Room = "videos";

/**
 * MLB's `codedGameState` mapped to a BT phase — the one answer to "is this game
 * live?" (ADR-025). Built on the same status table the ingest window uses
 * (`isLiveStatus` / `isFinalStatus`), so the room tabs and the poller agree on every
 * status but one: a suspended game reads live for as long as it stays suspended, while
 * the poller lets it go `suspendedHours` after the suspension, or after first pitch
 * when BT didn't see it turn suspended (#79, #323). An
 * in-progress game (`I`) is live, and MLB codes a delay `I` too, so a delayed game
 * shows Live; so does one paused for a manager challenge
 * (`M`) or umpire review (`N`, #74), and a suspended one (`T`/`U`, #79), so fans
 * see what happened so far. Warm-up (`P`) and a postponed game (`D`, #72) show no
 * Live room, and a cancelled (`C`) or forfeited (`Q`/`R`, #80) game counts as
 * final. Unknown codes are pre-game; `window.ts`'s status table says why each is
 * where it is (#81). The owner's 2026-10-19 "Delay should not show the live tab"
 * was about postponed games (`D`), which stay pregame and out of the window; delays
 * (`I`) show Live (owner, 2026-11-17: "Yes, a rain delay should show the live tab.
 * I think my response was intended to be about games that were postponed due to rain.").
 */
export function gamePhase(codedGameState: string): GamePhase
{
	if (isLiveStatus(codedGameState)) return "live";
	if (isFinalStatus(codedGameState)) return "final";
	return "pregame";
}

/** The rooms to show as tabs. `hasRecap`: whether the game carries a recap (S10). */
export function roomsForPhase(phase: GamePhase, hasRecap: boolean): readonly Room[]
{
	switch (phase)
	{
		case "live":
			return ["videos", "live", "plays", "box"];
		case "final":
			return hasRecap ? ["videos", "plays", "box", "recap"] : ["videos", "plays", "box"];
		case "pregame":
			return ["videos", "plays", "box"];
	}
}

/** The room to show for a URL segment: the requested one if this phase offers it, else the default. */
export function resolveRoom(requested: string | undefined, phase: GamePhase, hasRecap: boolean): Room
{
	const rooms = roomsForPhase(phase, hasRecap);
	return rooms.find((room) => room === requested) ?? DEFAULT_ROOM;
}

/**
 * The room a game opens on. A room in the URL wins (as {@link resolveRoom}); with
 * none, the user's Opens First setting when this game offers it (Live on a
 * final game doesn't exist, nor Recap without a recap), else the default room. Signed out, callers pass
 * the house default.
 */
export function openingRoom(requested: string | undefined, opensFirst: Room, phase: GamePhase, hasRecap: boolean): Room
{
	if (requested !== undefined) return resolveRoom(requested, phase, hasRecap);
	return resolveRoom(opensFirst, phase, hasRecap);
}
