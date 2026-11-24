/**
 * Games per day for a month (S124) and the teams playing each day (S136), for S125's calendar
 * date picker, from BT's stored schedule days (ADR-002: clients read BT only), counted by
 * `monthGameCounts`, and the teams in their own regular season each day (S191), worked out from the
 * month's whole calendar year. A month BT needn't ask MLB about is one count read of that year plus,
 * inside the fill window, one read of its month record; a fill adds one MLB range read (week-long
 * requests sent together, #399) and a version-guarded write per day it returns (`storeSchedule`,
 * which reads the stored day first), and answers from what it stored rather than a second count read
 * (#410). Those per-day reads and writes are most of a cold month's time through Hyperdrive: since
 * S150 a day with games is at least four database round trips (its games' `game_states` read, the
 * stored day's read, and the served day's read with its games' states, `readScheduleDay`), plus a
 * write for the states when they changed and one for the day when it changed, and, for today and
 * yesterday, a game read per suspended game in each window judgement; a state switch that races
 * another writer adds one more read and write per game.
 *
 * Days inside `scheduleFillWindow` (the current season through December of next year; later
 * months are refused at the route, owner 2026-11-09: "Reject past next year") that BT doesn't
 * hold yet are filled from MLB with one range read (`fetchScheduleRange`) of the shown month's
 * days, never more (owner, 2026-11-23, asked whether S191 should still fetch the whole year when a
 * month is first opened: "It should never fetch more than the one month. The year should be fetched
 * server-side with a cron job"), stored through
 * ingest's version-guarded write (ADR-022) without hydrating any game: game snapshots stay with
 * the scoreboard's own refresh and the backfill (S122), so one month read is one MLB range read
 * (at most five week-long requests), not hundreds. Past seasons are never asked for here; what
 * the backfill stored is what they show.
 *
 * Keeping stored in-window months fresh is the scheduled refresh's job (S194,
 * `schedule-refresh.ts`), which checks each month against MLB every six hours through the same fill
 * ({@link fillScheduleMonth}, ADR-025) and records the check durably (`recordScheduleMonthCheck`).
 * A read asks MLB for a fully stored month only when that record says the refresh hasn't checked it
 * (`scheduleMonthCheckStale`: never, or longer ago than the interval plus a margin), not by how
 * recently a day changed (ADR-021's 2026-11-23 amendment: refresh-on-read follows the record, not
 * the ladder, for in-window months), so a new Worker isolate no longer refetches every month.
 * That refresh is also what stores the rest of the year S191's `inSeasonTeamIds` reads: every month
 * of the window, this year's and next, so a read finds the year held once the refresh has been
 * round, and until then a day whose season the stored days can't tell answers `null`.
 */
import type {
	ScheduleDay, ScheduleDayCount, ScheduleDayTally, Unversioned,
} from "@bt/domain";
import {
	daysOfMonth, mlbToday, monthComplete, monthGameCounts, monthLastChangedAt, scheduleDayTally, scheduleFillWindow, scheduleMonthAnswer, scheduleMonthCheckStale,
	scheduleMonthVersion,
} from "@bt/domain";
import { scheduleDayWindowMode } from "./game-state.js";
import type { IngestDeps } from "./ingest.js";
import { runRefresh, storeSchedule } from "./ingest.js";

/**
 * A month's counts and teams per day, and when its data last changed, which sets its cache
 * lifetime (ADR-021).
 */
export interface ScheduleMonth
{
	/** The month, `YYYY-MM`. */
	month: string;
	/** Every day of the month, first to last. */
	days: ScheduleDayCount[];
	/**
	 * When the month's stored data last changed: the latest change among its calendar year's days
	 * (whose regular seasons its `inSeasonTeamIds` reads, S191), or `now` while any day of the month
	 * is unknown (`count: null`), so an incomplete month is checked again soon (the route caches an
	 * incomplete month only for the fill's cooldown, {@link ScheduleMonth.complete}).
	 */
	lastChangedAt: string;
	/**
	 * Whether every day is known (`monthComplete`: none `count: null`). The route keeps an incomplete month at the
	 * edge only for the fill's cooldown (#399): a fill MLB didn't answer would otherwise be served
	 * for minutes as a month with no games.
	 */
	complete: boolean;
}

/** The days of `month` inside `scheduleFillWindow` by MLB's today at `now`: all of them, or none. */
function fillableDays(month: string, now: Date): string[]
{
	// MLB's today, not UTC's: 03:00 UTC on January 1 is still December 31 for MLB.
	const window = scheduleFillWindow(mlbToday(now));
	return daysOfMonth(month).filter((date) => date >= window.first && date <= window.last);
}

/**
 * The span of `fillable` days to ask MLB for, or null when none needs asking: all of them when the
 * month's record says it is due a check (`scheduleMonthCheckStale`, S194 AC 3), else from the first
 * to the last day BT doesn't hold. One range either way, so a month is never more than one range
 * read (at most five week-long requests, #399). The record is read only for a month that has
 * fillable days.
 */
async function rangeToAsk(deps: IngestDeps, month: string, fillable: string[], stored: ScheduleDayTally[], now: Date): Promise<[string, string] | null>
{
	if (fillable.length === 0) return null;
	const [check] = await deps.schedules.listScheduleMonthChecks(month, month);
	if (scheduleMonthCheckStale(check, now)) return [fillable[0]!, fillable.at(-1)!];
	const heldDates = new Set(stored.map((day) => day.date));
	const missing = fillable.filter((date) => !heldDates.has(date));
	return missing.length === 0 ? null : [missing[0]!, missing.at(-1)!];
}

/**
 * The one month fill (S194 AC 2; ADR-025), which the month route and the scheduled refresh both
 * call: asks MLB for `span` of `month` (`fetchScheduleRange`) and stores each returned day through
 * `storeSchedule`, stamped `fetchedAt` = `now` with the `windowMode` `scheduleDayWindowMode` gives.
 * It records a check of the month (`recordScheduleMonthCheck`, at `now`) only when `span` was the
 * month's whole fillable range, MLB answered and every day of it was stored; a fill that found
 * nothing changed records one too, since that is the point of the record. Returns the days as
 * stored, or null when MLB couldn't be asked or its answer didn't parse (no check is recorded). A
 * store write that fails is BT's own failure (the database), not MLB's, and rejects.
 */
export async function fillScheduleMonth(deps: IngestDeps, month: string, span: [string, string], now: Date): Promise<ScheduleDay[] | null>
{
	const fetchedAt = now.toISOString();
	let days: Unversioned<ScheduleDay>[];
	try
	{
		days = await deps.mlb.fetchScheduleRange(span[0], span[1]);
	}
	catch
	{
		// MLB unreachable, or an answer that doesn't parse: the days stay as stored, and unknown
		// ones say so (`count: null`). Not a check of the month.
		return null;
	}
	const written: ScheduleDay[] = [];
	for (const day of days)
	{
		written.push(await storeSchedule(deps, {
			...day,
			fetchedAt,
			windowMode: await scheduleDayWindowMode(deps, day, now),
		}));
	}
	const fillable = fillableDays(month, now);
	const storedDates = new Set(written.map((day) => day.date));
	const whole = fillable.length > 0 && span[0] === fillable[0] && span[1] === fillable.at(-1);
	if (whole && fillable.every((date) => storedDates.has(date))) await deps.schedules.recordScheduleMonthCheck(month, fetchedAt);
	return written;
}

/**
 * `stored` with each of `fresh` in place of the stored day of its date, or added when none was
 * stored (#410), in date order as `listGameCounts` gives them.
 */
function overlayDays(stored: ScheduleDayTally[], fresh: ScheduleDayTally[]): ScheduleDayTally[]
{
	const byDate = new Map(stored.map((day) => [day.date, day]));
	for (const day of fresh) byDate.set(day.date, day);
	return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * The number of games on each day of `month` (`YYYY-MM`, already checked by `isCalendarMonth`
 * and `latestScheduleMonth` at the route) and the teams playing it (S136), from BT's stored
 * schedule days, filling the days inside `scheduleFillWindow` first as the module doc says. A
 * failed MLB request leaves those days as they were; a failed store write is BT's own failure and
 * rejects.
 */
export async function getScheduleMonth(deps: IngestDeps, month: string): Promise<ScheduleMonth>
{
	const now = deps.now?.() ?? new Date();
	const dates = daysOfMonth(month);
	// One read of the month's whole calendar year (S191): each day's `inSeasonTeamIds` follows every
	// team's own regular season, whose first or last game can fall in another month
	// (`teamsInOwnSeason`). One repository query either way, never one per day. Only the month is ever
	// asked of MLB here; the rest of the year is the scheduled refresh's to store (S194).
	const year = month.slice(0, 4);
	let stored = await deps.schedules.listGameCounts(`${year}-01-01`, `${year}-12-31`);

	const range = await rangeToAsk(deps, month, fillableDays(month, now), stored, now);
	if (range)
	{
		// Single-flighted and cooldown-gated per month like the day and game reads (`RefreshCoordinator`); a
		// fill MLB didn't answer doesn't count as a check there either.
		const filled = await runRefresh(deps, `schedule-month:${month}`, () => fillScheduleMonth(deps, month, range, now), (written) => written !== null);
		// The answer is the stored tallies with what the fill just stored laid over them, not a second
		// month read (#410): with Hyperdrive's query cache on (#408), that read is the same query as the
		// first and came back as the pre-fill answer, every filled day unknown. `storeSchedule` returns
		// each day as this fill computed it (the stored day itself when unchanged), which is what a fresh
		// read gives unless a newer write lands between its read and its write (the version guard, ADR-022,
		// then keeps that newer day); such a write shows on the next read.
		// A reader that joined another's fill in flight gets the same days (the coordinator shares it).
		if (filled) stored = overlayDays(stored, filled.map(scheduleDayTally));
	}

	const days = monthGameCounts(dates, stored);
	const complete = monthComplete(days);
	return {
		month,
		days,
		// The year's latest change, not only the month's: `inSeasonTeamIds` reads the whole year, so a
		// day stored or corrected in another month can change this answer too. `complete` looks at the
		// month's days only, so a past-season answer whose `inSeasonTeamIds` is `null` because other
		// months of its year aren't stored can still be cached up to the cap; a later backfill of them
		// moves the year's latest change, which drops the answer back to the ladder's floor.
		lastChangedAt: (complete ? monthLastChangedAt(stored) : undefined) ?? now.toISOString(),
		complete,
	};
}

/**
 * The version of each month of `year` whose stored answer is complete (`monthComplete`), keyed by
 * month (`YYYY-MM`), for the versions route (S194 AC 7): one `listGameCounts` read of the whole year
 * and no MLB request, each month's days counted exactly as {@link getScheduleMonth} counts them
 * (`monthGameCounts`), built into the answer the month route sends (`scheduleMonthAnswer`) and
 * versioned by `scheduleMonthVersion`, as the month route does too (ADR-025). An incomplete month, or one nothing has stored, is left out, so the web asks for
 * it without a version.
 */
export async function getScheduleMonthVersions(deps: Pick<IngestDeps, "schedules">, year: number): Promise<Record<string, string>>
{
	const prefix = String(year).padStart(4, "0");
	const stored = await deps.schedules.listGameCounts(`${prefix}-01-01`, `${prefix}-12-31`);
	const versions: Record<string, string> = {};
	for (let m = 1; m <= 12; m++)
	{
		const month = `${prefix}-${String(m).padStart(2, "0")}`;
		// The whole year's stored days, as the month route passes them, so each month's `inSeasonTeamIds`
		// (S191) and so its version match what the route sends for it.
		const days = monthGameCounts(daysOfMonth(month), stored);
		if (monthComplete(days)) versions[month] = scheduleMonthVersion(scheduleMonthAnswer(month, days));
	}
	return versions;
}
