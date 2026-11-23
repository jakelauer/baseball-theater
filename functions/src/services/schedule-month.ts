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
 * Stored days inside the window are asked for again once the month's ADR-021 lifetime has run
 * out (`needsRefresh`, the ladder single days use), so a future month stored empty before MLB
 * published its schedule gains its games later.
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
 * The span of days to ask MLB for, or null when none needs asking: every one of `fillable` (the
 * month's in-window days) when the month's stored data has outlived its lifetime, and every one of
 * `yearFillable` (its year's in-window days, which include the month's, S191) that BT doesn't hold;
 * the one range runs from the first of those to the last. One range either way, so a month is
 * never more than one request. Other months' stored days are refreshed when they are shown, not
 * here, so a year's fill stays the days it lacks.
 */
function rangeToAsk(deps: IngestDeps, key: string, fillable: string[], yearFillable: string[], stored: ScheduleDayTally[], now: Date): [string, string] | null
{
	const heldDates = new Set(stored.map((day) => day.date));
	const missing = yearFillable.filter((date) => !heldDates.has(date));
	if (fillable.length === 0) return missing.length === 0 ? null : [missing[0]!, missing.at(-1)!];
	const wanted = new Set(fillable);
	const held = stored.filter((day) => wanted.has(day.date));
	// The month was last checked no later than its oldest fetch: every held day has been fetched
	// since then, but nothing says the oldest one was fetched again after (an unchanged refresh
	// writes nothing, ADR-022), so this is the safe lower bound; a stamp that doesn't parse means
	// "never checked". Its last change is the newest among its days (ADR-021's ladder over the month).
	const fetchedTimes = held.map((day) => Date.parse(day.fetchedAt));
	const oldestFetch = fetchedTimes.some(Number.isNaN) ? undefined : Math.min(...fetchedTimes);
	const month = held.length === 0 ? null : {
		fetchedAt: oldestFetch === undefined ? undefined : new Date(oldestFetch).toISOString(),
		lastChangedAt: monthLastChangedAt(held),
		windowMode: "cache" as const,
	};
	const ends = month && needsRefresh(deps, key, month, now, false) ? [fillable[0]!, fillable.at(-1)!] : [];
	ends.push(...missing.slice(0, 1), ...missing.slice(-1));
	if (ends.length === 0) return null;
	ends.sort();
	return [ends[0]!, ends.at(-1)!];
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
	const key = `schedule-month:${month}`;
	const inWindow = (date: string) => date >= window.first && date <= window.last;
	const range = rangeToAsk(deps, key, dates.filter(inWindow), datesBetween(yearFirst, yearLast).filter(inWindow), stored, now);
	if (range)
	{
		const filled = await runRefresh(deps, key, async () =>
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
			// Only the filled range is read again and spliced into the year (S191): half the cost of a
			// second year read, and never the same query text as the first (a query cache such as
			// Hyperdrive's could otherwise answer it with the year as it was before the fill).
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
