/**
 * Which standings the Standings page shows on a day (S128). MLB answers a dated standings
 * request only inside the regular season, so the table follows the season instead (owner,
 * 2026-11-07: "it should always show the last standings for the prior season until spring
 * training's first game", and spring training's own table from then until the regular season):
 *
 * - **regularSeason** — from MLB's `regularSeasonStartDate` (the first regular-season game,
 *   owner: "first regular season game") through `regularSeasonEndDate`: that day's table.
 * - **final** — from the day after `regularSeasonEndDate` (postseason included) until the day
 *   before the next season's `springStartDate`, or for as long as that next season is not
 *   published: the season's final regular-season table, dated its `regularSeasonEndDate`.
 * - **spring** — from `springStartDate` through the day before `regularSeasonStartDate`: that
 *   spring's training table as of the day.
 *
 * "Not published" means MLB answered with no such season; a calendar MLB couldn't be reached
 * for is not passed as unpublished — the caller passes none instead (S128 AC 7), since leaving
 * only last year's would keep its final table on a mid-season day.
 *
 * Before every known season, or with no calendar, it is the day's regular-season table. A
 * calendar missing either regular-season date is unknown here. Dates are `YYYY-MM-DD`, which
 * compare as strings. MLB's season id is the year a date falls in, so a January day's final
 * table is the previous season's, which only the calendars can say.
 */
import { addDays } from "./calendar-date.js";
import type { SeasonCalendar, SeasonChampion } from "./scoreboard-date.js";
import type {
	StandingsPhaseName, StandingsSnapshot, StandingsTeamRecord,
} from "./types.js";

/** The table to ask MLB for: which kind, for which season, and the day it stands as of. */
export interface StandingsPick {
	phase: StandingsPhaseName;
	season: number;
	/** The day the table stands as of: the requested day, or `regularSeasonEndDate` for `final`. */
	date: string;
}

type KnownCalendar = SeasonCalendar & { regularSeasonStartDate: string;
	regularSeasonEndDate: string; };

/** The calendars that carry both regular-season dates, earliest spring first. */
function knownSeasons(seasons: readonly SeasonCalendar[]): KnownCalendar[]
{
	return seasons
		.filter((s): s is KnownCalendar => Boolean(s.regularSeasonStartDate && s.regularSeasonEndDate))
		.sort((a, b) => a.springStartDate.localeCompare(b.springStartDate));
}

function finalOf(season: KnownCalendar): StandingsPick
{
	return {
		phase: "final",
		season: season.season,
		date: season.regularSeasonEndDate,
	};
}

/** The standings to show on `day`, given the season calendars MLB has published (any order). */
export function standingsPhase(day: string, seasons: readonly SeasonCalendar[]): StandingsPick
{
	let pick: StandingsPick = {
		phase: "regularSeason",
		season: Number(day.slice(0, 4)),
		date: day,
	};
	for (const season of knownSeasons(seasons))
	{
		if (day < season.springStartDate) break;
		if (day < season.regularSeasonStartDate)
		{
			return {
				phase: "spring",
				season: season.season,
				date: day,
			};
		}
		if (day <= season.regularSeasonEndDate)
		{
			return {
				phase: "regularSeason",
				season: season.season,
				date: day,
			};
		}
		pick = finalOf(season);
	}
	return pick;
}

/**
 * The table to show instead when `pick` comes back empty (S128 AC 3). That happens on two
 * mornings only, before any game of the new phase is final: spring's first day
 * (`springStartDate`), which falls back to the previous season's final table, and opening day
 * (`regularSeasonStartDate`), which falls back to that spring's table as of the last spring day.
 * Any other day's table is the day's own answer, empty or not, so it is null there: a later
 * empty table is shown as it is, never replaced by an older phase's under a stale label. Also
 * null when there is nothing before it (a final table, the first known spring, no calendar).
 */
export function previousStandingsPhase(pick: StandingsPick, seasons: readonly SeasonCalendar[]): StandingsPick | null
{
	const known = knownSeasons(seasons);
	const season = known.find((s) => s.season === pick.season);
	if (!season) return null;
	if (pick.phase === "spring")
	{
		if (pick.date !== season.springStartDate) return null;
		const previous = known.filter((s) => s.season < pick.season).at(-1);
		return previous ? finalOf(previous) : null;
	}
	if (pick.phase === "regularSeason")
	{
		if (pick.date !== season.regularSeasonStartDate) return null;
		return {
			phase: "spring",
			season: season.season,
			date: addDays(season.regularSeasonStartDate, -1),
		};
	}
	return null;
}

/**
 * One season phase's plan for a day (S139): the days the phase runs in the answer's season, and
 * the table to ask MLB for, or null when the phase has no MLB table of its own that day (the
 * regular season on a spring day, which the service answers with the new season's teams at 0-0).
 * For `playoffs` the pick is the regular season's (AC 2 has every phase name its table): its teams
 * are the regular season phase's table's clinched ones, so the service reads that phase's table
 * (the 0-0 list before the first game included) rather than fetching this pick on its own.
 */
export interface SeasonPhasePlan {
	startDate: string | null;
	endDate: string | null;
	pick: StandingsPick | null;
}

/** What each season phase holds on a day (S139): the season the answer is for and each phase's plan, or null. */
export interface StandingsPhasesPlan {
	season: number;
	spring: SeasonPhasePlan | null;
	regularSeason: SeasonPhasePlan;
	playoffs: SeasonPhasePlan | null;
	/**
	 * From spring's first day through opening day, when the regular season may not have played a
	 * game yet (S139 AC 4): the table that lists the new season's teams if spring's has none yet —
	 * MLB's season table with no date (`fetchFinalStandings`), which before the season's first game
	 * lists every team at 0-0 (recorded 2026-11-18 for 2027). The regular season is the 0-0 list on
	 * these days only, when its own table is missing (a spring day) or empty (opening day's
	 * morning). Null on every other day and with no calendar.
	 */
	newSeasonTeams: StandingsPick | null;
}

/**
 * What the spring, regular season and playoffs hold on `day`, from the season calendars only, never
 * the clock (owner, 2026-11-10, of a past date: "Same rules as if that date were today."). The
 * season is the one `standingsPhase` picks the day's table from: a season runs from its
 * `springStartDate` to the day before the next known season's.
 *
 * - **spring:** `springStartDate` through the day before `regularSeasonStartDate`; that spring's
 *   table as of the day, or as of its last day once the day is past it.
 * - **regularSeason:** `regularSeasonStartDate` through `regularSeasonEndDate`; the day's table
 *   inside those dates, the season's `final` after them, and no MLB table on a spring day (MLB has
 *   none before opening day).
 * - **playoffs:** the day after `regularSeasonEndDate` through `lastGameDate`; the regular season's
 *   table, whose clinched teams the service keeps. Null for a season with no postseason day
 *   (`lastGameDate` on or before `regularSeasonEndDate`), never a phase that ends before it starts.
 *
 * With no calendar for the day's season (none given, one missing a regular-season date, or a day
 * before every known season) spring and playoffs are null and the regular season is the day's
 * table with no dates, as `standingsPhase` answers there.
 */
export function standingsPhases(day: string, seasons: readonly SeasonCalendar[]): StandingsPhasesPlan
{
	const pick = standingsPhase(day, seasons);
	const calendar = knownSeasons(seasons).find((s) => s.season === pick.season && s.springStartDate <= day);
	if (!calendar)
	{
		return {
			season: pick.season,
			spring: null,
			regularSeason: {
				startDate: null,
				endDate: null,
				pick,
			},
			playoffs: null,
			newSeasonTeams: null,
		};
	}
	const springEnd = addDays(calendar.regularSeasonStartDate, -1);
	const regularPick: StandingsPick | null = day < calendar.regularSeasonStartDate
		? null
		: day <= calendar.regularSeasonEndDate
			? {
				phase: "regularSeason",
				season: calendar.season,
				date: day,
			}
			: finalOf(calendar);
	const playoffsStart = addDays(calendar.regularSeasonEndDate, 1);
	return {
		season: calendar.season,
		spring: {
			startDate: calendar.springStartDate,
			endDate: springEnd,
			pick: {
				phase: "spring",
				season: calendar.season,
				date: day < springEnd ? day : springEnd,
			},
		},
		regularSeason: {
			startDate: calendar.regularSeasonStartDate,
			endDate: calendar.regularSeasonEndDate,
			pick: regularPick,
		},
		playoffs: calendar.lastGameDate < playoffsStart
			? null
			: {
				startDate: playoffsStart,
				endDate: calendar.lastGameDate,
				pick: regularPick,
			},
		newSeasonTeams: day <= calendar.regularSeasonStartDate ? finalOf(calendar) : null,
	};
}

/**
 * Where a season stands on `today` (MLB's day), for anything cached from its calendar (S139 AC 8):
 * `ongoing` before its `regularSeasonEndDate`, or when that date isn't known (a season with no
 * calendar is never settled); `postseason` from `regularSeasonEndDate` through the day after
 * `lastGameDate`, while the postseason can still move the last game's day and S140's winner;
 * `settled` after that, when nothing in its calendar changes any more. With no `lastGameDate` the
 * last game is taken to be `regularSeasonEndDate`. The calendar cache and the standings' edge
 * cache both judge a season by this one rule (ADR-025).
 */
export function seasonSettling(regularSeasonEndDate: string | null | undefined, lastGameDate: string | null | undefined, today: string): "ongoing" | "postseason" | "settled"
{
	if (!regularSeasonEndDate || today < regularSeasonEndDate) return "ongoing";
	return today <= addDays(lastGameDate ?? regularSeasonEndDate, 1) ? "postseason" : "settled";
}

/**
 * The playoffs phase's table (S139 AC 2): the regular season's table keeping only the teams that
 * have clinched, in the same division order, a division with none left out, with the table's own
 * labels (owner, 2026-11-10: "it'll just be a list of teams with no with no numbers"). MLB's
 * `clinched` is the source: its own playoff type (`wildCard`, recorded 2026-11-18) only ranks the
 * non-leaders and marks a subset of the same teams, so it costs no request of its own.
 */
export function playoffsTable(regularSeason: StandingsSnapshot): StandingsSnapshot
{
	return {
		...regularSeason,
		divisions: regularSeason.divisions
			.map((division) => ({
				...division,
				teams: division.teams.filter((team) => team.clinched),
			}))
			.filter((division) => division.teams.length > 0),
	};
}

/** A team before its season's first game (S139 AC 4): its name and division, 0-0, every other figure blank. */
function blankRecord(team: StandingsTeamRecord): StandingsTeamRecord
{
	return {
		teamId: team.teamId,
		name: team.name,
		abbreviation: team.abbreviation,
		wins: 0,
		losses: 0,
		pct: null,
		gamesBack: null,
		divisionRank: null,
		streak: null,
		runsScored: null,
		runsAllowed: null,
		runDifferential: null,
		divisionLeader: false,
		clinched: false,
		eliminationNumber: null,
	};
}

/**
 * The regular season before its first game (S139 AC 4; owner: "even though like in spring
 * training, it's going to be all, you know, blank for the regular season, we should still show
 * it"): `source`'s teams in their divisions, in name order, with blank records, labelled as
 * `season`'s regular season on `day`. `source` is spring's table, or the new season's team list
 * (`StandingsPhasesPlan.newSeasonTeams`) while spring has no team yet; it is left unchanged.
 */
export function blankRegularSeasonTable(source: StandingsSnapshot, season: number, day: string): StandingsSnapshot
{
	return {
		...source,
		date: day,
		phase: "regularSeason",
		season,
		divisions: source.divisions.map((division) => ({
			...division,
			teams: [...division.teams].sort((a, b) => a.name.localeCompare(b.name)).map(blankRecord),
		})),
	};
}

/** A season's World Series winner as the standings answer names it (S140): the champion and its season. */
export interface StandingsChampion extends SeasonChampion {
	season: number;
}

/**
 * The World Series winner the standings name on `day` (S140 AC 2), from the season calendars only,
 * never the clock, so a past date gets the answer it would have had that day. It is the winner of
 * the season whose `final` table `standingsPhase` picks (the off-season: the day after
 * `regularSeasonEndDate` until the next season's spring), from the day the Series was won
 * (`wonOn`) on; null on every other day, before the Series is decided (the playoffs are part of the
 * off-season), and for a season with no winner.
 */
export function standingsChampion(day: string, seasons: readonly SeasonCalendar[]): StandingsChampion | null
{
	const pick = standingsPhase(day, seasons);
	if (pick.phase !== "final") return null;
	const champion = seasons.find((s) => s.season === pick.season)?.champion;
	if (!champion || day < champion.wonOn) return null;
	return {
		season: pick.season,
		...champion,
	};
}
