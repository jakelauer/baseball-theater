/**
 * "Past and finished" (S212; ADR-021's 2026-11-24 amendment): the one rule for which stored schedule days and games
 * no longer change on their own, so BT serves them from its own copy with no MLB call on read, the edge keeps them for
 * weeks, and only the cron's writes (which purge the edge copy on a real change) keep them fresh. The read paths, the
 * cache headers, the purge and the recent-game re-check all call these two predicates and nothing else (ADR-025).
 */
import { addDays } from "./calendar-date.js";
import { isScheduleDaySettled, isSettledGame } from "./backfill.js";
import { SCHEDULE_MONTH_REFRESH_INTERVAL_MS } from "./schedule-refresh.js";
import { mlbToday } from "./scoreboard-date.js";
import type { GameSnapshot, ScheduleDay } from "./types.js";
import { isFinalStatus, normalizeStatusCode } from "./window.js";

/**
 * Whether a served schedule day is past and finished (S212 AC 1): its date is before MLB's today (`mlbToday` of
 * `now`, the US Eastern date, so at 03:00 UTC the previous date is still today), its served `windowMode` is `cache`
 * (a day still `active`, a late game in its trail, is not), and it is settled (`isScheduleDaySettled`: every game final,
 * postponed or cancelled, or in `moved`, the games whose listing has moved to another day, `listingMovedAway`, which the
 * joined day already knows).
 */
export function isPastFinishedDay(day: Pick<ScheduleDay, "date" | "games" | "windowMode">, now: Date, moved: ReadonlySet<number>): boolean
{
	const today = mlbToday(now);
	return day.date < today && day.windowMode === "cache" && isScheduleDaySettled(day, today, moved);
}

/**
 * Whether a served game is past and finished (S212 AC 1): its served state is settled (`isSettledGame`: final,
 * postponed or cancelled), its `windowMode` is `cache`, and its official date is before MLB's today (`mlbToday`).
 */
export function isPastFinishedGame(game: Pick<GameSnapshot, "windowMode" | "officialDate"> & { status: Pick<GameSnapshot["status"], "codedGameState" | "detailedState"> }, now: Date): boolean
{
	return isSettledGame(game.status) && game.windowMode === "cache" && game.officialDate < mlbToday(now);
}

/**
 * How many dates before MLB's today the cron re-checks a finished game's full detail (S212 AC 5; owner, 2026-11-24:
 * "Cron re-checks recent games (Recommended)", "e.g. the last 7 days, when corrections actually happen"). A correction
 * MLB makes to a game later than this is never picked up.
 */
export const RECENT_GAME_RECHECK_DAYS = 7;

/**
 * How long a re-check's claim on a game holds (S212 AC 5): long enough for one game's `fetchGame` and store, short
 * enough that an isolate that died mid-check holds its game only minutes. S194's month lease, for the same reason.
 */
export const GAME_RECHECK_CLAIM_LEASE_MS = 5 * 60 * 1000;

/**
 * How long a game whose re-check MLB didn't answer is held from the re-check (S212 review): S194's refresh interval,
 * 6 h, the same as after a re-check that worked, so a game whose feed fails for good is asked at most four times a day
 * rather than after every 5-minute lease (about 288 times), and never crowds out the other recent games. The re-check
 * holds its claim to `at + FAILED_HOLD − LEASE` (`holdGameRecheck`), which a claim then refuses until `at + FAILED_HOLD`.
 */
export const GAME_RECHECK_FAILED_HOLD_MS = SCHEDULE_MONTH_REFRESH_INTERVAL_MS;

/** One stored game as the recent-game re-check judges it (S212 AC 5): its served state's fields and its re-check record. */
export interface GameRecheckCandidate
{
	gamePk: number;
	officialDate: string;
	windowMode: GameSnapshot["windowMode"];
	/** The served status (the game's state row's, else its snapshot's). */
	status: Pick<GameSnapshot["status"], "codedGameState" | "detailedState">;
	/** When the cron last re-checked the game against MLB, an ISO instant, or null when never. */
	checkedAt: string | null;
	/** When a re-check last claimed the game, an ISO instant, or null when never. */
	claimedAt: string | null;
}

/** The dates the recent-game re-check covers at `now`: the {@link RECENT_GAME_RECHECK_DAYS} dates before MLB's today, oldest first. */
export function recentRecheckDates(now: Date): { from: string;
	to: string; }
{
	const today = mlbToday(now);
	return {
		from: addDays(today, -RECENT_GAME_RECHECK_DAYS),
		to: addDays(today, -1),
	};
}

/**
 * The games due a re-check at `now`, in the order the cron takes them (S212 AC 5): past and finished
 * ({@link isPastFinishedGame}) and played to the end (final, never postponed or cancelled, which has no clips or
 * corrections to pick up), of the recent dates ({@link recentRecheckDates}), never re-checked or last re-checked
 * at least S194's refresh interval (`SCHEDULE_MONTH_REFRESH_INTERVAL_MS`, 6 h) ago, and not held by another re-check's
 * claim (`claimedAt` within `leaseMs`). Never-checked games first, then the oldest check, then the earliest gamePk.
 */
export function gamesDueForRecheck(candidates: readonly GameRecheckCandidate[], now: Date, leaseMs: number): GameRecheckCandidate[]
{
	const { from, to } = recentRecheckDates(now);
	const at = now.getTime();
	return candidates
		.filter((game) => game.officialDate >= from && game.officialDate <= to && isPastFinishedGame(game, now))
		.filter((game) => isFinalStatus(normalizeStatusCode(game.status.codedGameState)))
		.filter((game) => game.checkedAt === null || at - Date.parse(game.checkedAt) >= SCHEDULE_MONTH_REFRESH_INTERVAL_MS)
		.filter((game) => game.claimedAt === null || at - Date.parse(game.claimedAt) >= leaseMs)
		.sort((a, b) =>
		{
			const checkA = a.checkedAt === null ? Number.NEGATIVE_INFINITY : Date.parse(a.checkedAt);
			const checkB = b.checkedAt === null ? Number.NEGATIVE_INFINITY : Date.parse(b.checkedAt);
			return checkA === checkB ? a.gamePk - b.gamePk : checkA - checkB;
		});
}
