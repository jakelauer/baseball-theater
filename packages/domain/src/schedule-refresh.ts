/**
 * The scheduled schedule-month refresh's rules (S194; owner, 2026-11-23: "What I'd recommend is a
 * CRON refresh for the remainder of the season every 6 hours or so that busts the cache"): which
 * months it keeps fresh, how often, which one it takes next, and the version that names a month
 * answer's exact content, so the edge may keep that answer for a long time (ADR-021's 2026-11-23
 * amendment). Pure: the record itself is stored through `ScheduleRepository` (`@bt/ports`), and
 * the refresh that reads it lives in `functions/src/services/schedule-refresh.ts`.
 */
import type { ScheduleMonthResponse } from "./api-routes.js";
import { contentHash } from "./content-hash.js";
import type { ScheduleDayCount } from "./schedule-month.js";
import { scheduleFillWindow } from "./schedule-month.js";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

/**
 * How often the scheduled refresh checks each month of its window against MLB: the owner's "every
 * 6 hours or so". A month checked less than this long ago is never due.
 */
export const SCHEDULE_MONTH_REFRESH_INTERVAL_MS = 6 * HOUR;

/**
 * How much later than {@link SCHEDULE_MONTH_REFRESH_INTERVAL_MS} a fan's read may find a month's
 * last check before the read asks MLB itself ({@link scheduleMonthCheckStale}): the refresh takes
 * one month a minute, so a whole window's cycle runs about 24 minutes past the interval, and a read
 * inside this margin leaves the month to the refresh rather than racing it.
 */
export const SCHEDULE_MONTH_CHECK_MARGIN_MS = 30 * MINUTE;

/**
 * How long a refresh's claim on a month holds (AC 1): a second refresh may take the month only once
 * the claim is this old. Long enough for one month's fill (at most five MLB requests and a month of
 * writes), short enough that a refresh that died mid-fill holds its month only minutes.
 */
export const SCHEDULE_MONTH_CLAIM_LEASE_MS = 5 * MINUTE;

/**
 * How long a month whose fill MLB didn't answer is held from the refresh (S194 review): 30 minutes,
 * not the 5-minute lease, so during an MLB outage each month is asked at most twice an hour rather
 * than every few minutes. The refresh holds its claim to `at + FAILED_LEASE − LEASE`, which a claim
 * then refuses until `at + FAILED_LEASE`.
 */
export const SCHEDULE_MONTH_FAILED_LEASE_MS = 30 * MINUTE;

/**
 * BT's durable record of one schedule month (S194): when BT last checked it against MLB, and when a
 * refresh last claimed it. Both ISO instants, `null` when never. Kept per month, not per day, because
 * an unchanged check writes no day (ADR-022), so the days' `fetchedAt` can't say a month was checked.
 */
export interface ScheduleMonthCheck
{
	/** The month, `YYYY-MM`. */
	month: string;
	/** When BT last checked the whole month against MLB (a fill of its whole fillable range that stored every day). */
	checkedAt: string | null;
	/**
	 * When a refresh last claimed the month, or the time a failed fill holds it until
	 * (`holdScheduleMonth`); a claim holds until `claimedAt` plus {@link SCHEDULE_MONTH_CLAIM_LEASE_MS}.
	 */
	claimedAt: string | null;
}

/** An ISO instant as epoch ms, or `undefined` for none or one that doesn't parse (which counts as never). */
function instantMs(at: string | null | undefined): number | undefined
{
	if (!at) return undefined;
	const ms = Date.parse(at);
	return Number.isNaN(ms) ? undefined : ms;
}

/**
 * Every month (`YYYY-MM`) of `scheduleFillWindow(today)`, first to last: January of MLB's today's
 * year through December of next year, the 24 months the scheduled refresh keeps fresh.
 */
export function windowMonths(today: string): string[]
{
	const { first, last } = scheduleFillWindow(today);
	const months: string[] = [];
	let year = Number(first.slice(0, 4));
	let month = 1;
	const end = last.slice(0, 7);
	for (;;)
	{
		const key = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
		months.push(key);
		if (key >= end) return months;
		month++;
		if (month > 12)
		{
			month = 1;
			year++;
		}
	}
}

/**
 * Whether a fan's read of a fully stored in-window month should ask MLB itself (S194 AC 3): only when
 * the month has no `checkedAt` (or one that doesn't parse), or its `checkedAt` is older than the
 * refresh interval plus its margin, which means the scheduled refresh has fallen behind. Freshness
 * is otherwise the refresh's job, so how recently a day changed no longer matters here.
 */
export function scheduleMonthCheckStale(check: Pick<ScheduleMonthCheck, "checkedAt"> | null | undefined, now: Date): boolean
{
	const checked = instantMs(check?.checkedAt);
	if (checked === undefined) return true;
	return now.getTime() - checked > SCHEDULE_MONTH_REFRESH_INTERVAL_MS + SCHEDULE_MONTH_CHECK_MARGIN_MS;
}

/**
 * The months of `months` the scheduled refresh may take now, in the order it tries them (S194
 * AC 4). A month is due when it has no `checkedAt` or one at least
 * {@link SCHEDULE_MONTH_REFRESH_INTERVAL_MS} old, and no claim younger than
 * {@link SCHEDULE_MONTH_CLAIM_LEASE_MS}. Order: never-checked months first, then the oldest
 * `checkedAt`; on a tie, the earliest month. A month with no record in `checks` is never checked
 * and unclaimed.
 */
export function scheduleMonthsDue(months: readonly string[], checks: readonly ScheduleMonthCheck[], now: Date): string[]
{
	const byMonth = new Map(checks.map((check) => [check.month, check]));
	const at = now.getTime();
	const due = months.map((month) =>
	{
		const check = byMonth.get(month);
		return {
			month,
			checked: instantMs(check?.checkedAt),
			claimed: instantMs(check?.claimedAt),
		};
	}).filter(({ checked, claimed }) => (checked === undefined || at - checked >= SCHEDULE_MONTH_REFRESH_INTERVAL_MS)
		&& (claimed === undefined || at - claimed >= SCHEDULE_MONTH_CLAIM_LEASE_MS));
	due.sort((a, b) =>
	{
		const aChecked = a.checked ?? -Infinity;
		const bChecked = b.checked ?? -Infinity;
		if (aChecked !== bChecked) return aChecked < bChecked ? -1 : 1;
		return a.month.localeCompare(b.month);
	});
	return due.map(({ month }) => month);
}

/**
 * The month route's answer for `month` (`YYYY-MM`) with its `days`, exactly as the route sends it
 * (ADR-025): the route's body and the versions route's input are both built here, so the version
 * below always hashes what a fan receives.
 */
export function scheduleMonthAnswer(month: string, days: ScheduleDayCount[]): ScheduleMonthResponse
{
	return {
		month,
		days,
	};
}

/**
 * The version of a month answer (S194 AC 7): `contentHash` of the whole answer exactly as the month
 * route sends it ({@link scheduleMonthAnswer}), so any change to what it says (a refresh, a backfill
 * re-storing a day, a field a later story adds at any level) gives a new version, and a change the
 * answer doesn't carry (a live game's state) gives none. The month route and the versions route both
 * call it (ADR-025), so a `?v=` the versions route named matches the answer the month route is about
 * to send exactly when their contents are equal. Only the body is hashed, never headers: a
 * deprecation or sunset header added later can't reach a past year's versioned URL the edge already
 * holds for its long lifetime, which only a new version (or the cache's own eviction) replaces.
 */
export function scheduleMonthVersion(answer: ScheduleMonthResponse): string
{
	return contentHash(answer);
}
