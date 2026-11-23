/**
 * Games per day for a month (S124) and the teams playing each day (S136), for S125's calendar
 * date picker, from BT's stored schedule days (ADR-002: clients read BT only), counted by
 * `monthGameCounts`, and the teams in their own regular season each day (S191), worked out from the
 * month's whole calendar year. A month BT needn't ask MLB about is one count read of that year; a fill adds one MLB
 * range request, a version-guarded write per day it returns (`storeSchedule`, which reads the
 * stored day first) and a second count read, of the filled range only.
 *
 * Days inside `scheduleFillWindow` (the current season through December of next year; later
 * months are refused at the route, owner 2026-11-09: "Reject past next year") that BT doesn't
 * hold yet are filled from MLB with one schedule request for their range: the shown month's and,
 * since S191, the rest of its year's (owner, 2026-11-23, asked whether the calendar should fetch
 * the rest of the year's schedule from MLB when it needs it: "Fetch the year (Recommended)"), so
 * `inSeasonTeamIds` can be told on the days fans open, up to ~365 stored days in that one
 * request. They are stored through
 * ingest's version-guarded write (ADR-022) without hydrating any game: game snapshots stay with
 * the scoreboard's own refresh and the backfill (S122), so one month read is one MLB request,
 * not hundreds. Past seasons are never asked for here; what the backfill stored is what they show.
 *
 * The month's stored days inside the window are asked for again once its ADR-021 lifetime has run
 * out (`needsRefresh`, the ladder single days use), so a future month stored empty before MLB
 * published its schedule gains its games later; since S191 so does any season month of its year
 * still stored with no games once the year holds games, in the same one request, whichever month
 * of the year is opened (`rangeToAsk`).
 */
import type {
	ScheduleDay, ScheduleDayCount, ScheduleDayTally, Unversioned,
} from "@bt/domain";
import {
	datesBetween, daysOfMonth, mlbToday, monthGameCounts, monthLastChangedAt, scheduleFillWindow,
} from "@bt/domain";
import type { IngestDeps } from "./ingest.js";
import {
	needsRefresh, runRefresh, scheduleDayWindowMode, storeSchedule,
} from "./ingest.js";

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
	 * is unknown (`count: null`), so an incomplete month is checked again soon.
	 */
	lastChangedAt: string;
}

/**
 * The months of a year that hold MLB's regular season (S191): its openers, even an overseas one in
 * mid-March, fall in March, and its last games, a tiebreaker included, by early October. The other
 * months are empty in an ordinary year, so a season month still to come stored with no games at
 * all, in a year that holds games, was most likely stored before MLB published its schedule.
 */
const SEASON_MONTHS = ["03", "04", "05", "06", "07", "08", "09", "10"];

/** The refresh key a month's fill runs under, and its stored days are judged by (ADR-021). */
function monthKey(month: string): string
{
	return `schedule-month:${month}`;
}

/**
 * Stored days as `needsRefresh` judges them, or null for none: last checked no later than their
 * oldest fetch, since every held day has been fetched since then but nothing says the oldest one
 * was fetched again after (an unchanged refresh writes nothing, ADR-022), so this is the safe lower
 * bound; a stamp that doesn't parse means "never checked". Their last change is the newest among
 * them (ADR-021's ladder over the month).
 */
function asChecked(held: readonly ScheduleDayTally[])
{
	if (held.length === 0) return null;
	const fetchedTimes = held.map((day) => Date.parse(day.fetchedAt));
	const oldestFetch = fetchedTimes.some(Number.isNaN) ? undefined : Math.min(...fetchedTimes);
	return {
		fetchedAt: oldestFetch === undefined ? undefined : new Date(oldestFetch).toISOString(),
		lastChangedAt: monthLastChangedAt(held),
		windowMode: "cache" as const,
	};
}

/**
 * What to ask MLB for, or null when nothing needs asking: one span of days and the refresh key it
 * runs under. The span runs from the first to the last of the days that need asking, so any held
 * day between them is asked again too:
 *
 * - every one of `fillable` (the shown month's in-window days) once its stored data has outlived
 *   its lifetime (`needsRefresh` under its own key, as before S191);
 * - every one of `yearFillable` (its year's in-window days, which include the month's, S191) that
 *   BT doesn't hold;
 * - every in-window day of another season month ({@link SEASON_MONTHS}) from MLB's today's month
 *   (`todayMonth`) on whose stored days all hold no games, when the year holds a game somewhere (so
 *   MLB has published it), once that month's stored data has outlived its lifetime under its own
 *   key: a month stored before MLB published. It is asked no more often than opening it would
 *   ask: a fill that only it needs runs under its key, so that key's lifetime counts from the fill;
 *   a month that MLB keeps answering empty (a lockout, a schedule published without it) is asked
 *   again as often as its own lifetime says, not on every read. A past season month stored empty
 *   was cancelled, not unpublished, and is left as it is.
 *
 * The rest of the year's held days are not judged by a lifetime: an unchanged refresh writes
 * nothing (ADR-022), so a stored row's fetch and change stamps stay equal and every such judgment
 * would land on the ladder's floor, asking for the whole year every few minutes. One span either
 * way, so a month is never more than one request (at most 366 days; `storeSchedule` writes only
 * what changed). When the span is needed for more than one empty month, or for one and the shown
 * month or missing days, it runs under the shown month's key.
 */
function rangeToAsk(
	deps: IngestDeps,
	month: string,
	todayMonth: string,
	fillable: string[],
	yearFillable: string[],
	stored: ScheduleDayTally[],
	now: Date,
): { range: [string, string];
	key: string; } | null
{
	const heldDates = new Set(stored.map((day) => day.date));
	const ends = yearFillable.filter((date) => !heldDates.has(date));
	ends.splice(1, Math.max(0, ends.length - 2));
	const inMonth = new Set(fillable);
	const shown = asChecked(stored.filter((day) => inMonth.has(day.date)));
	if (shown && needsRefresh(deps, monthKey(month), shown, now, false)) ends.push(fillable[0]!, fillable.at(-1)!);
	const emptyMonths: string[] = [];
	if (stored.some((day) => day.gameCount > 0))
	{
		for (const season of SEASON_MONTHS)
		{
			const other = `${month.slice(0, 4)}-${season}`;
			if (other === month || other < todayMonth) continue;
			const days = yearFillable.filter((date) => date.startsWith(other));
			const held = stored.filter((day) => day.date.startsWith(other));
			if (days.length === 0 || held.length === 0 || held.some((day) => day.gameCount > 0)) continue;
			if (!needsRefresh(deps, monthKey(other), asChecked(held), now, false)) continue;
			emptyMonths.push(other);
			ends.push(days[0]!, days.at(-1)!);
		}
	}
	if (ends.length === 0) return null;
	// Only one empty month asked for, and nothing else: its own key, so the fill counts as its check.
	const onlyEmpty = emptyMonths.length === 1 && ends.length === 2;
	ends.sort();
	return {
		range: [ends[0]!, ends.at(-1)!],
		key: onlyEmpty ? monthKey(emptyMonths[0]!) : monthKey(month),
	};
}

/**
 * The number of games on each day of `month` (`YYYY-MM`, already checked by `isCalendarMonth`
 * and `latestScheduleMonth` at the route) and the teams playing it (S136), from BT's stored
 * schedule days, filling or refreshing the days inside `scheduleFillWindow` first as the module
 * doc says. A failed MLB request leaves those days as they were; a failed store write is BT's own
 * failure and rejects.
 */
export async function getScheduleMonth(deps: IngestDeps, month: string): Promise<ScheduleMonth>
{
	const now = deps.now?.() ?? new Date();
	const dates = daysOfMonth(month);
	// One read of the month's whole calendar year (S191): each day's `inSeasonTeamIds` follows every
	// team's own regular season, whose first or last game can fall in another month
	// (`teamsInOwnSeason`). One repository query either way, never one per day.
	const yearFirst = `${month.slice(0, 4)}-01-01`;
	const yearLast = `${month.slice(0, 4)}-12-31`;
	let stored = await deps.schedules.listGameCounts(yearFirst, yearLast);

	// MLB's today, not UTC's: 03:00 UTC on January 1 is still December 31 for MLB.
	const window = scheduleFillWindow(mlbToday(now));
	const inWindow = (date: string) => date >= window.first && date <= window.last;
	const ask = rangeToAsk(deps, month, mlbToday(now).slice(0, 7), dates.filter(inWindow), datesBetween(yearFirst, yearLast).filter(inWindow), stored, now);
	if (ask)
	{
		const { range } = ask;
		const filled = await runRefresh(deps, ask.key, async () =>
		{
			const fetchedAt = now.toISOString();
			let days: Unversioned<ScheduleDay>[];
			try
			{
				days = await deps.mlb.fetchScheduleRange(range[0], range[1]);
			}
			catch
			{
				// MLB unreachable, or an answer that doesn't parse: the days stay as stored, and
				// unknown ones say so (`count: null`). Not a check of the month, so it is asked
				// again once the cooldown allows rather than after a lifetime it never earned.
				return false;
			}
			// A store write that fails is BT's (the database), not MLB's: it rejects, and the read fails.
			for (const day of days)
			{
				await storeSchedule(deps, {
					...day,
					fetchedAt,
					windowMode: await scheduleDayWindowMode(deps, day, now),
				});
			}
			return true;
		}, (ok) => ok);
		if (filled)
		{
			// Only the filled range is read again and spliced into the year (S191), which costs less than
			// a second year read when the range is shorter. When the range is the whole year, the re-read
			// is the same query as the first. A query cache in front of the database (Hyperdrive caches
			// read queries for up to 60 seconds by default) could then answer it with the rows as they
			// were before the fill; this answer would show the year's days as they were, and the next
			// read after the cache entry expires shows the filled ones.
			const [from, to] = range;
			const fresh = await deps.schedules.listGameCounts(from, to);
			stored = [...stored.filter((day) => day.date < from || day.date > to), ...fresh].sort((a, b) => a.date.localeCompare(b.date));
		}
	}

	const days = monthGameCounts(dates, stored);
	const complete = days.every((day) => day.count !== null);
	return {
		month,
		days,
		// The year's latest change, not only the month's: `inSeasonTeamIds` reads the whole year, so a
		// day stored or corrected in another month can change this answer too. `complete` looks at the
		// month's days only, so a past-season answer whose `inSeasonTeamIds` is `null` because other
		// months of its year aren't stored can still be cached up to the cap; a later backfill of them
		// moves the year's latest change, which drops the answer back to the ladder's floor.
		lastChangedAt: (complete ? monthLastChangedAt(stored) : undefined) ?? now.toISOString(),
	};
}
