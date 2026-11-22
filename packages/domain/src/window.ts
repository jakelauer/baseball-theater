import type { GameStatusCode, ScheduleGameSummary } from "./types.js";

export type CadenceParams = {
	/** Hours before scheduled start to enter active polling. */
	leadHours: number;
	/** Hours after official end to keep active polling. */
	trailHours: number;
	/** How often the active-window ingest loop ticks, in milliseconds. */
	intervalMs: number;
	/** Hours after first pitch to keep polling a suspended game (`T`/`U`, #79). */
	suspendedHours: number;
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
 * - `suspendedHours: 6` — a suspended game is polled up to six hours after first
 *   pitch, then left until a schedule read sees it resume (owner, 2026-11-20, #79:
 *   "polling should continue for up to 6 hours"; measuring from first pitch is the
 *   agent's reading, since BT records no time a game was suspended).
 */
export const DEFAULT_CADENCE: CadenceParams = {
	leadHours: 2,
	trailHours: 3,
	intervalMs: 30_000,
	suspendedHours: 6,
};

/**
 * How BT treats a game in each status (#81).
 *
 * - `pregame`: not started. Pre-game warm-up (`P`) is here although MLB groups it
 *   "Live": the Live room stays hidden (VISUAL-DESIGN §5 room presence), and ingest
 *   polls it through the lead window. A delay before first pitch is `P` too
 *   ("Delayed Start", `PR`…`PO`), windowed by the clock only, so a start delayed past
 *   the trail drops out until a schedule read sees the game go `I`.
 * - `live`: in progress. MLB codes an in-game delay `I` (`IR` "Delayed: Rain", `IO`
 *   "Delayed"), so a delay shows Live and stays polled however long it runs (#72;
 *   owner, 2026-11-17: "Yes, a rain delay should show the live tab. I think my response
 *   was intended to be about games that were postponed due to rain."). A manager
 *   challenge (`M`) or umpire review (`N`) is a pause inside a game in progress (#74).
 * - `suspended`: MLB's `T`/`U`, a game stopped to finish later, maybe on another day.
 *   It looks live, so fans see what happened so far, but is polled only up to
 *   `suspendedHours` (owner, 2026-11-20, #79: "It should look like a live game in the UI
 *   in that the user should be able to see what happened so far in the game, but it
 *   should be clear to the user that the game is suspended and polling should continue
 *   for up to 6 hours."; the suspended marker is S157's design).
 * - `final`: final (`F`), game over (`O`), cancelled (`C`) and forfeited (`Q`/`R`, #80).
 * - `postponed`: MLB's `D` ("Postponed: Rain", …), which MLB groups "Final": the game
 *   won't be played on its day, so it stays pre-game in the UI and is never polled
 *   (#72; the owner's 2026-10-19 "Delay should not show the live tab" was about these).
 * - `unknown`: MLB's "Other" group (`X` "Unknown", `W` "Writing"), read as pre-game.
 *
 * Keyed by MLB's `codedGameState`, so it is MLB's own list (`GET /api/v1/gameStatus`,
 * recorded in `fixtures/raw/gamestatus.json`, which `window.test.ts` checks it against).
 */
type StatusKind = "pregame" | "live" | "suspended" | "final" | "postponed" | "unknown";

const STATUS_KINDS: Record<GameStatusCode, StatusKind> = {
	S: "pregame",
	P: "pregame",
	I: "live",
	M: "live",
	N: "live",
	T: "suspended",
	U: "suspended",
	F: "final",
	O: "final",
	C: "final",
	Q: "final",
	R: "final",
	D: "postponed",
	X: "unknown",
	W: "unknown",
};

/**
 * MLB's `codedGameState` as one of BT's `GameStatusCode`s: a code MLB lists passes
 * through (uppercased), anything else, or nothing, is MLB's own unknown, `X`.
 */
export function normalizeStatusCode(code: string | undefined | null): GameStatusCode
{
	if (!code) return "X";
	const c = code.toUpperCase();
	return Object.hasOwn(STATUS_KINDS, c) ? c as GameStatusCode : "X";
}

function statusKind(code: string | undefined | null): StatusKind
{
	return STATUS_KINDS[normalizeStatusCode(code)];
}

/** Whether a game looks live: in progress, or suspended (which shows what happened so far, #79). */
export function isLiveStatus(code: string): boolean
{
	const kind = statusKind(code);
	return kind === "live" || kind === "suspended";
}

/** Whether a game is over for good: final, game over, cancelled or forfeited (#80). */
export function isFinalStatus(code: string): boolean
{
	return statusKind(code) === "final";
}

/** A bare `YYYY-MM-DD`: a date with no time of day, so no first-pitch instant. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Whether a game should be in the active ingest window at `now`.
 * A game in progress (`I`, which includes MLB's delays, or a challenge/review `M`/`N`, #74) is always in it, whatever
 * the clock says: a delay can outlast the trail, and only a poll sees it resume.
 * A postponed game (`D`) never is, whatever the clock says (#72). Otherwise the window is lead hours before first pitch to trail hours after
 * (after the assumed end, for a final game; `suspendedHours` after, for a suspended one, #79).
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
	const kind = statusKind(game.status.codedGameState);
	if (kind === "live") return true;
	if (kind === "postponed") return false;

	const startedAt = [game.startTime, game.gameDate, game.gameDateTime]
		.find((value) => value && !DATE_ONLY.test(value) && !Number.isNaN(Date.parse(value)));
	const start = startedAt
		? new Date(startedAt)
		: new Date(`${game.officialDate}T17:00:00.000Z`);
	if (Number.isNaN(start.getTime())) return false;

	const leadMs = params.leadHours * 60 * 60 * 1000;
	const trailMs = (kind === "suspended" ? params.suspendedHours : params.trailHours) * 60 * 60 * 1000;

	if (kind === "final")
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
