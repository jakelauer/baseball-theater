/**
 * The calendar's one strict date parser (S125; shell-scoreboard A8, "One strict `dateParser`"):
 * the text a fan types into the calendar's date field becomes a `YYYY-MM-DD` day, "Not a date.",
 * or "No data before Apr 18, 1901.". A typed date counts only if it is a day the calendar has
 * (`isCalendarDate` from `@bt/domain`), so `Feb 30, 2026` is not quietly read as March 2.
 */
import { BACKFILL_EARLIEST_DATE, isCalendarDate } from "@bt/domain";

/** What the field shows under a typed date that isn't one (A8's `invalid` frames). */
export const NOT_A_DATE = "Not a date.";

/** What the field shows under a date before the first game BT keeps (A8's `tooearly` frames). */
export const TOO_EARLY = "No data before Apr 18, 1901.";

/** A parsed date, or why the text isn't one the calendar can go to. */
export type TypedDate = { date: string } | { error: typeof NOT_A_DATE | typeof TOO_EARLY };

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * The month (1–12) a typed month name names: its first three letters in English, as the field's
 * own `Sep 21, 2026` writes it, or the whole name (`September`, `Sept`). Undefined for anything else.
 */
function monthNumber(name: string): number | undefined
{
	const lower = name.toLowerCase();
	const index = MONTHS.indexOf(lower.slice(0, 3));
	if (index < 0) return undefined;
	// Only a prefix of the month's own name: `Sepx` is not September.
	const full = new Intl.DateTimeFormat("en-US", {
		month: "long",
		timeZone: "UTC",
	}).format(new Date(Date.UTC(2000, index, 1))).toLowerCase();
	return full.startsWith(lower) ? index + 1 : undefined;
}

/** `YYYY-MM-DD` from numbers, or undefined when the year isn't four digits. */
function isoDay(year: string, month: number, day: number): string | undefined
{
	if (!/^\d{4}$/.test(year)) return undefined;
	return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Reads `text` as one of the forms A8 names: `Sep 21, 2026` (the field's own format; the comma is
 * optional, the month may be written in full), `9/21/2026` and `2026-09-21`. The day must exist
 * (`isCalendarDate`) and be on or after `BACKFILL_EARLIEST_DATE` (1901-04-18). There is no upper
 * bound: future dates are allowed (owner, 2026-11-07: "allow future").
 */
export function parseTypedDate(text: string): TypedDate
{
	const trimmed = text.trim();
	let date: string | undefined;
	const named = /^([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d+)$/.exec(trimmed);
	const slashed = /^(\d{1,2})\/(\d{1,2})\/(\d+)$/.exec(trimmed);
	const iso = /^(\d+)-(\d{1,2})-(\d{1,2})$/.exec(trimmed);
	if (named)
	{
		const month = monthNumber(named[1]!);
		date = month === undefined ? undefined : isoDay(named[3]!, month, Number(named[2]));
	}
	else if (slashed)
	{
		date = isoDay(slashed[3]!, Number(slashed[1]), Number(slashed[2]));
	}
	else if (iso)
	{
		date = isoDay(iso[1]!, Number(iso[2]), Number(iso[3]));
	}
	if (date === undefined || !isCalendarDate(date)) return {
		error: NOT_A_DATE,
	};
	return date < BACKFILL_EARLIEST_DATE ? {
		error: TOO_EARLY,
	} : {
		date,
	};
}
