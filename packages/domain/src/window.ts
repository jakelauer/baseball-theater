import type { GameStatusCode, ScheduleGameSummary } from "./types.js";

export type CadenceParams = {
	/** Hours before scheduled start to enter active polling. */
	leadHours: number;
	/** Hours after official end to keep active polling. */
	trailHours: number;
	/** How often the active-window ingest loop ticks, in milliseconds. */
	intervalMs: number;
};

/**
 * The ADR-002 cadence knobs, in one place so lead, trail and the poll interval
 * cannot drift apart.
 *
 * ADR-002 fixes the *shape* (a lead/trail active window with a backend poll)
 * and leaves the exact durations as tunable parameters. Defaults:
 *
 * - `leadHours: 2` — start polling two hours before first pitch
 * - `trailHours: 3` — keep polling three hours past the assumed end
 * - `intervalMs: 30_000` — one pull per in-window game every 30s. Egress scales
 *   with concurrent game windows, not viewers; raise it before adding games.
 */
export const DEFAULT_CADENCE: CadenceParams = {
	leadHours: 2,
	trailHours: 3,
	intervalMs: 30_000,
};

// Only a game actually in progress is live. Pre-game warm-up (`P`) is not: the
// Live room stays hidden (VISUAL-DESIGN §5 room presence), and ingest polls it
// through the lead window. MLB codes an in-game delay `I` (`IR` "Delayed: Rain",
// `IO` "Delayed", per `/api/v1/gameStatus`), so it is in progress here and stays
// polled however long it runs (#72). A delay before first pitch is `P` ("Delayed
// Start", `PR`…`PO`): not live, and windowed by the clock only, so a start delayed
// past the trail drops out until a schedule read sees the game go `I`.
//
// The owner's 2026-10-19 answer, "Delay should not show the live tab", was about
// postponed games (`D`), which stay pregame and out of the window; delays (`I`)
// show Live (owner, 2026-11-17: "Yes, a rain delay should show the live tab. I think
// my response was intended to be about games that were postponed due to rain.").
const LIVE_CODES = new Set(["I"]);

// MLB's `D` is a postponement (`DR` "Postponed: Rain", `DO` "Postponed", `DI`
// "Postponed: Inclement Weather", …), not a delay: the game won't be played on its
// day, so nothing about it is worth polling (#72).
const POSTPONED_CODE = "D";
const FINAL_CODES = new Set(["F", "O", "C"]);

export function isLiveStatus(code: string): boolean
{
	return LIVE_CODES.has(code);
}

export function isFinalStatus(code: string): boolean
{
	return FINAL_CODES.has(code);
}

export function normalizeStatusCode(code: string | undefined | null): GameStatusCode
{
	if (!code) return "U";
	const c = code.toUpperCase();
	if (["S", "P", "I", "F", "O", "C", "D"].includes(c)) return c as GameStatusCode;
	return "U";
}

/** A bare `YYYY-MM-DD`: a date with no time of day, so no first-pitch instant. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Whether a game should be in the active ingest window at `now`.
 * A game in progress (`I`, which includes MLB's delays) is always in it, whatever
 * the clock says: a delay can outlast the trail, and only a poll sees it resume.
 * A postponed game (`D`) never is, whatever the clock says (#72). Otherwise the window is lead hours before first pitch to trail hours after
 * (after the assumed end, for a final game).
 *
 * First pitch is `startTime` (the ISO instant `mapScheduleGame` and `mapLiveFeed`
 * set). Both mappers set `gameDate` to the official date alone, so `gameDate` /
 * `gameDateTime` count only when they carry a time of day: read as an instant, a
 * bare date is midnight UTC, which opened a night game's window hours early and
 * closed its trail before it went final (#71). A value that doesn't parse is skipped
 * too, so a placeholder `startTime` can't hide a real ISO `gameDate`. With no instant
 * at all (a snapshot stored before `startTime` existed), fall back to a mid-afternoon assumption on
 * the official date — a floor, not the normal path.
 */
export function isGameInActiveWindow(
	game: Pick<ScheduleGameSummary, "officialDate" | "status"> & {
		startTime?: string | null;
		gameDate?: string | null;
		gameDateTime?: string | null;
	},
	now: Date,
	params: CadenceParams = DEFAULT_CADENCE,
): boolean
{
	const code = normalizeStatusCode(game.status.codedGameState);
	if (isLiveStatus(code)) return true;
	if (code === POSTPONED_CODE) return false;

	const startedAt = [game.startTime, game.gameDate, game.gameDateTime]
		.find((value) => value && !DATE_ONLY.test(value) && !Number.isNaN(Date.parse(value)));
	const start = startedAt
		? new Date(startedAt)
		: new Date(`${game.officialDate}T17:00:00.000Z`);
	if (Number.isNaN(start.getTime())) return false;

	const leadMs = params.leadHours * 60 * 60 * 1000;
	const trailMs = params.trailHours * 60 * 60 * 1000;

	if (isFinalStatus(code))
	{
		// Without exact end time, keep trail from a late-evening assumption on game day.
		const assumedEnd = new Date(start.getTime() + 4 * 60 * 60 * 1000);
		return now.getTime() <= assumedEnd.getTime() + trailMs;
	}

	return (
		now.getTime() >= start.getTime() - leadMs &&
    now.getTime() <= start.getTime() + trailMs
	);
}

/**
 * A schedule day's window mode (S122; ADR-025: one implementation): `"active"` while any of
 * its games is in its active window at `now`, so the day is polled; `"cache"` otherwise. The
 * live ingest and the backfill store a fetched day with this, so both judge a day alike.
 */
export function scheduleWindowMode(
	games: readonly Parameters<typeof isGameInActiveWindow>[0][],
	now: Date,
	params: CadenceParams = DEFAULT_CADENCE,
): "active" | "cache"
{
	return games.some((game) => isGameInActiveWindow(game, now, params)) ? "active" : "cache";
}
