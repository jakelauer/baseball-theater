/**
 * How the app writes a moment the server sends (ISO 8601), in the reader's own
 * time zone. Formatting only — every date BT shows is computed server-side or in
 * `packages/domain` (ADR-025); nothing here adds times, and the one comparison is
 * {@link formatMomentSince}'s "is it the reader's today", a choice of what to write. Shared by
 * every screen that shows a date (S79 first; the game top bar and the scoreboard's
 * date control since S66, which merged the game top bar's own formatter into it).
 */

const DATE = new Intl.DateTimeFormat("en-US", {
	month: "short",
	day: "numeric",
	year: "numeric",
});

/** A calendar date names a day, not a moment: it is written in UTC so no zone moves it. */
const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

const CALENDAR = new Intl.DateTimeFormat("en-US", {
	month: "short",
	day: "numeric",
	year: "numeric",
	timeZone: "UTC",
});

const LONG_CALENDAR = new Intl.DateTimeFormat("en-US", {
	month: "long",
	day: "numeric",
	year: "numeric",
	timeZone: "UTC",
});

const MONTH_DAY = new Intl.DateTimeFormat("en-US", {
	month: "short",
	day: "numeric",
	timeZone: "UTC",
});

const TIME = new Intl.DateTimeFormat("en-US", {
	hour: "numeric",
	minute: "2-digit",
});

/**
 * "Nov 11, 2026" (standings-search-settings A4; the game top bar and the scoreboard's
 * date control). An instant is written in the reader's zone; a calendar date
 * (`2026-09-05`, a game's `officialDate` or the scoreboard URL's day) is written as
 * that same day wherever the reader is. Anything that is not a date comes back as it is.
 */
export function formatDate(value: string): string
{
	const calendar = CALENDAR_DATE.test(value);
	const date = new Date(calendar ? `${value}T00:00:00Z` : value);
	if (Number.isNaN(date.getTime()) || (calendar && date.toISOString().slice(0, 10) !== value)) return value;
	return (calendar ? CALENDAR : DATE).format(date);
}

/**
 * "March 2, 2027", a calendar date (`2027-03-02`) with its month in full, as standings-search-settings
 * A9 writes the Standings "as of" day and the World Series box's "Won the World Series on" line (S130
 * AC 3), which `formatDate`'s "Mar 2, 2027" does not. Written as that same day wherever the reader is;
 * anything that is not a calendar date comes back as it is.
 */
export function formatLongDate(value: string): string
{
	const date = new Date(`${value}T00:00:00Z`);
	if (!CALENDAR_DATE.test(value) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return value;
	return LONG_CALENDAR.format(date);
}

/**
 * "Sep 21", a calendar date (`2026-09-21`) without its year, written as that same day
 * wherever the reader is (S71: the digest's "Best of Sep 21" and the player's game link).
 * Anything that is not a calendar date comes back as it is.
 */
export function formatMonthDay(value: string): string
{
	const date = new Date(`${value}T00:00:00Z`);
	if (!CALENDAR_DATE.test(value) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return value;
	return MONTH_DAY.format(date);
}

/** "3:15 PM" (A4's download refusal). */
export function formatTime(iso: string): string
{
	return TIME.format(new Date(iso));
}

/** The reader's calendar day of a moment, as a comparable string ("11/24/2026"), in their zone. */
const READER_DAY = new Intl.DateTimeFormat("en-US", {
	year: "numeric",
	month: "2-digit",
	day: "2-digit",
});

const MONTH_DAY_TIME = new Intl.DateTimeFormat("en-US", {
	month: "short",
	day: "numeric",
	hour: "numeric",
	minute: "2-digit",
});

/**
 * A moment as the offline marker writes it (S74, shell-scoreboard A1, game-rooms A1): "7:42 PM"
 * when it falls on the reader's today (`now`, in their zone), as the ratified frames draw a
 * same-day copy, and "Oct 3, 7:42 PM" when it doesn't (owner, 2026-11-24, asked whether a copy
 * more than a day old should name its date: "Add the date when not today (Recommended)", the
 * option reading "A copy from another day shows its date before the time; a same-day copy reads
 * exactly as drawn").
 */
export function formatMomentSince(iso: string, now: Date): string
{
	const at = new Date(iso);
	return READER_DAY.format(at) === READER_DAY.format(now) ? TIME.format(at) : MONTH_DAY_TIME.format(at);
}

/**
 * The reader's own IANA time zone (`America/New_York`), for formatters that take one,
 * like a game's start time (`formatGameTime`; owner, 2026-10-19: start times in the
 * viewer's zone, labeled).
 */
export function viewerTimeZone(): string
{
	return TIME.resolvedOptions().timeZone;
}
