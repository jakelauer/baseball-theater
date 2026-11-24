/**
 * The scheduled schedule-month refresh (S194; owner, 2026-11-23: "What I'd recommend is a CRON
 * refresh for the remainder of the season every 6 hours or so that busts the cache", and "The cron
 * should include the whole schedule (past and future) for the current calendar year"). The Worker's
 * existing per-minute cron (`worker.ts` `scheduled`) calls {@link refreshDueScheduleMonth} on every
 * tick, so every month of the fill window is checked against MLB about every six hours, one month a
 * tick, through the month route's own fill (`fillScheduleMonth`, ADR-025), and the durable record
 * that fill writes is what lets a fan's read trust a stored month (`scheduleMonthCheckStale`).
 */
import {
	daysOfMonth, mlbToday, SCHEDULE_MONTH_CLAIM_LEASE_MS, SCHEDULE_MONTH_FAILED_LEASE_MS, scheduleMonthsDue, windowMonths,
} from "@bt/domain";
import type { IngestDeps } from "./ingest.js";
import { fillScheduleMonth } from "./schedule-month.js";

/**
 * Refreshes at most one due month of the fill window (S194 AC 4) and returns it, or null when none
 * was due. The window is every month of `scheduleFillWindow` by MLB's today (`windowMonths`: January
 * of the current year through December of next year, 24 months), each asked whole, past days
 * included. A month is due when it was never checked or was checked at least the refresh interval
 * ago, and no other refresh holds its claim (`scheduleMonthsDue`: never-checked months first, then
 * the oldest check, the earliest month on a tie). It claims the first due month it can
 * (`claimScheduleMonth`, one conditional write that also re-checks the month is still due, so two
 * ticks racing never both take one), then fills it. An MLB failure records no check and holds the
 * claim (`holdScheduleMonth`) so the month isn't asked again for `SCHEDULE_MONTH_FAILED_LEASE_MS`
 * (30 minutes); a store failure is BT's own and rejects.
 *
 * Upstream budget (ADR-002: "bound upstream load to game activity", not to viewers): one month per
 * tick, at most 5 requests (a month's week-long requests, `fetchScheduleRange`). This bound holds
 * while fills succeed: a full 6 h cycle is the window's 24 months: 59 week-long requests for a common year (60 for a leap
 * year) per year of the window, so at most 120 requests every 6 h (480 a day). That count is fixed by
 * the calendar, not by how many fans visit. While MLB fails, each failed month is held for
 * `SCHEDULE_MONTH_FAILED_LEASE_MS`, so the refresh sends at most 5 requests a minute until every month
 * is held, then each of the 24 months at most once every 30 minutes: at most 24 × 5 requests every
 * 30 minutes (5,760 a day) for as long as the outage lasts. With the route trusting this record (S194
 * AC 3), fans' reads no longer refetch a whole month every few minutes, as #403 measured. A tick with
 * no due month sends no request and does one database read (`listScheduleMonthChecks`).
 */
export async function refreshDueScheduleMonth(deps: IngestDeps): Promise<string | null>
{
	const now = deps.now?.() ?? new Date();
	// MLB's today, not UTC's: 03:00 UTC on January 1 is still December 31, so last year's window stands.
	const months = windowMonths(mlbToday(now));
	const checks = await deps.schedules.listScheduleMonthChecks(months[0]!, months.at(-1)!);
	for (const month of scheduleMonthsDue(months, checks, now))
	{
		// Another tick may have claimed it since the read: try the next due month.
		if (!await deps.schedules.claimScheduleMonth(month, now.toISOString())) continue;
		const days = daysOfMonth(month);
		const filled = await fillScheduleMonth(deps, month, [days[0]!, days.at(-1)!], now);
		// MLB didn't answer: keep the month from the next claims for the failed lease, not the 5-minute one.
		if (filled === null) await deps.schedules.holdScheduleMonth(month, new Date(now.getTime() + SCHEDULE_MONTH_FAILED_LEASE_MS - SCHEDULE_MONTH_CLAIM_LEASE_MS).toISOString());
		return month;
	}
	return null;
}
