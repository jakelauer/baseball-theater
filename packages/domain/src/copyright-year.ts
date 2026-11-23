import { mlbToday } from "./scoreboard-date.js";

/**
 * The year the site footer's copyright line names, "© {year} Baseball Theater" (S142;
 * shell-scoreboard A14 Copyright): the year of MLB's day for `instant` (`mlbToday`), so the
 * footer turns over at the same midnight the scoreboard does. 03:00 UTC on New Year's Day is
 * still the old year in `America/New_York`. One function for every caller (ADR-025): the
 * footer and its tests agree because both ask here.
 */
export function copyrightYear(instant: Date): number
{
	return Number(mlbToday(instant).slice(0, 4));
}
