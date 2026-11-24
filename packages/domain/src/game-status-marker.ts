import { isSuspendedStatus, normalizeStatusCode } from "./window.js";

/**
 * Which game status marker a game shows (game-shell A7, S157; built by S170): the green
 * blinking `live` dot of a game being played, or a steady gold one saying play has stopped
 * (`delayed`), hasn't started on time (`delayedStart`) or is to be finished later (`suspended`).
 */
export type GameStatusMarkerKind = "live" | "delayed" | "delayedStart" | "suspended";

/** A marker and MLB's reason for it (`Rain`); `reason` is absent when MLB gives none, and always on `live`. */
export interface GameStatusMarker
{
	kind: GameStatusMarkerKind;
	reason?: string;
}

/** MLB's reason: the text after the colon of its detailed state (`Delayed: Rain` → `Rain`), or none. */
function reasonOf(detailedState: string): string | undefined
{
	const colon = detailedState.indexOf(":");
	if (colon < 0) return undefined;
	const reason = detailedState.slice(colon + 1).trim();
	return reason || undefined;
}

/**
 * The marker a game's status gets, or `null` for none, as A7's Codes decision sorts it — the one
 * answer for the game top bar and the scoreboard row (ADR-025). The letter comes through B81's
 * `normalizeStatusCode` (`window.ts`), so there is no second code table; the detailed state then
 * tells apart what one letter can't: MLB codes a rain delay `I` like play in progress, and a
 * delayed start `P` like warm-up, so a delay is an `I` whose detailed state starts "Delayed" and a
 * delayed start a `P` whose detailed state starts "Delayed Start". `M` (a manager challenge), `N`
 * (an umpire review) and any other `I` (`IH` "Instant Replay" among them) are a game in progress,
 * `live`, which never carries a reason; every `T` and `U` is `suspended` (`T9` reads "Scheduled:
 * COVID-19" and is still suspended). Anything else (scheduled, warm-up, final, postponed, unknown)
 * gets none. Assumes MLB's detailed states keep the "<state>: <reason>" form of
 * `fixtures/raw/gamestatus.json`.
 */
export function gameStatusMarker(status: { codedGameState: string;
	detailedState: string; }): GameStatusMarker | null
{
	const detailed = status.detailedState ?? "";
	const marker = (kind: GameStatusMarkerKind): GameStatusMarker =>
	{
		const reason = reasonOf(detailed);
		return reason ? {
			kind,
			reason,
		} : {
			kind,
		};
	};
	// B81's table sorts every `T` and `U` as suspended; ask it rather than list them again.
	if (isSuspendedStatus(status.codedGameState ?? "")) return marker("suspended");
	switch (normalizeStatusCode(status.codedGameState))
	{
		case "I":
			return detailed.startsWith("Delayed") ? marker("delayed") : {
				kind: "live",
			};
		case "M":
		case "N":
			return {
				kind: "live",
			};
		case "P":
			return detailed.startsWith("Delayed Start") ? marker("delayedStart") : null;
		default:
			return null;
	}
}
