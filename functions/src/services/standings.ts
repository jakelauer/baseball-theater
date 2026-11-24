import type {
	SeasonPhaseName, StandingsPhaseAnswer, StandingsPhasesPlan, StandingsPick, StandingsResponse, StandingsSnapshot,
} from "@bt/domain";
import {
	blankRegularSeasonTable, mlbToday, playoffsTable, previousStandingsPhase, SEASON_PHASES, standingsChampion, standingsHasNoTeams, standingsPhase, standingsPhases,
} from "@bt/domain";
import type { IngestDeps } from "./ingest.js";
import { standingsCalendars } from "./scoreboard-date.js";

/** What the standings read: MLB, the clock, and where the season calendars come from (cached, S139 AC 8). */
export type StandingsDeps = Pick<IngestDeps, "mlb" | "now" | "seasonCalendars">;

/** One picked table from MLB, labelled with what it is: its phase, season and the day it stands as of. */
async function fetchPick(mlb: IngestDeps["mlb"], pick: StandingsPick): Promise<StandingsSnapshot>
{
	const table = pick.phase === "final"
		? await mlb.fetchFinalStandings(pick.season)
		: pick.phase === "spring"
			? await mlb.fetchSpringStandings(pick.season, pick.date)
			: await mlb.fetchStandings(pick.date);
	return {
		...table,
		phase: pick.phase,
		season: pick.season,
		date: pick.date,
	};
}

/** Asks MLB for each distinct pick once per standings request, so S128's table and a phase that share one share the request. */
function onceEach(mlb: IngestDeps["mlb"]): (pick: StandingsPick) => Promise<StandingsSnapshot>
{
	const asked = new Map<string, Promise<StandingsSnapshot>>();
	return (pick) =>
	{
		const key = `${pick.phase}|${pick.season}|${pick.date}`;
		let table = asked.get(key);
		if (!table)
		{
			table = fetchPick(mlb, pick);
			asked.set(key, table);
		}
		return table;
	};
}

/**
 * The regular season phase's table: MLB's for the day (or the final), except before its first game
 * — a spring day, or opening day's morning while its table is still empty, the days
 * `plan.newSeasonTeams` is set — when it is the new season's teams at 0-0 (AC 4). Their teams come
 * from that spring's table, or, on the first spring morning before any spring game is final, from
 * `plan.newSeasonTeams` (MLB's season table with no date), never last season's final.
 */
async function regularSeasonTable(plan: StandingsPhasesPlan, day: string, fetchOnce: (pick: StandingsPick) => Promise<StandingsSnapshot>): Promise<StandingsSnapshot>
{
	const { pick } = plan.regularSeason;
	const table = pick ? await fetchOnce(pick) : null;
	if (table && (!plan.newSeasonTeams || !standingsHasNoTeams(table))) return table;
	// Before the first game: `standingsPhases` sets `newSeasonTeams` on every day whose regular season has no pick (a
	// spring day) and on opening day, so it is set here.
	const springTable = plan.spring?.pick ? await fetchOnce(plan.spring.pick) : null;
	const source = springTable && !standingsHasNoTeams(springTable) ? springTable : await fetchOnce(plan.newSeasonTeams!);
	return blankRegularSeasonTable(source, plan.season, day);
}

/** A standings answer and whether every season calendar it was judged against was reachable (S139 AC 8). */
export interface StandingsRead
{
	answer: StandingsResponse;
	/** False when MLB couldn't give a calendar (`standingsCalendars`): the answer must not be cached past the floor. */
	calendarsComplete: boolean;
}

/**
 * The standings for `day`, or MLB's today when absent (S128, S139).
 *
 * At the top, S128's table, unchanged for clients that don't know phases: `standingsPhase` picks
 * it from the day's year's and the year before's calendars, and when it is empty — the morning of
 * the first spring day or of opening day — the previous phase's table is returned instead, labelled
 * as what it is. An MLB error on a table is thrown, never turned into an empty one. An unreachable
 * calendar for the day's year means no calendar (`standingsCalendars`), and the read says so
 * (`calendarsComplete`), so the route keeps it only briefly.
 *
 * Beside it, `phases` (S139): every season phase's dates from `standingsPhases`, and the tables of
 * the phases in `include` (every phase by default). MLB requests, verified against MLB on
 * 2026-11-18 (one request naming `springTraining,regularSeason` answers only the table that day
 * has, so spring and the regular season stay two requests): the two calendars, plus each distinct
 * table once — at most two outside the first spring morning (spring's as of the day or its last
 * day, and the day's regular-season or final table) and three on it (the empty spring table, last
 * season's final for S128's table, and the new season's team list). A phase left out asks nothing
 * beyond what S128's table or an included phase needs.
 *
 * And `champion` (S140): the World Series winner `standingsChampion` names for the day, read from the
 * same calendars (the winner comes with the World Series schedule the calendar already asks for), so
 * it asks MLB nothing more and is the same whatever `include` names.
 */
export async function getStandings(deps: StandingsDeps, day?: string, include: readonly SeasonPhaseName[] = SEASON_PHASES): Promise<StandingsRead>
{
	const date = day ?? mlbToday(deps.now?.() ?? new Date());
	const { seasons, complete } = await standingsCalendars(deps.seasonCalendars ?? deps.mlb, date);
	const fetchOnce = onceEach(deps.mlb);
	const plan = standingsPhases(date, seasons);
	const wanted = new Set(include);
	let regular: Promise<StandingsSnapshot> | undefined;
	const regularOnce = () => regular ??= regularSeasonTable(plan, date, fetchOnce);

	const topTable = async () =>
	{
		const pick = standingsPhase(date, seasons);
		const table = await fetchOnce(pick);
		if (!standingsHasNoTeams(table)) return table;
		const previous = previousStandingsPhase(pick, seasons);
		return previous ? await fetchOnce(previous) : table;
	};
	const phase = async (name: SeasonPhaseName, dates: { startDate: string | null;
		endDate: string | null; } | null, table: () => Promise<StandingsSnapshot>): Promise<StandingsPhaseAnswer | null> =>
	{
		if (!dates) return null;
		return {
			startDate: dates.startDate,
			endDate: dates.endDate,
			...wanted.has(name) && {
				table: await table(),
			},
		};
	};

	const [top, spring, regularSeason, playoffs] = await Promise.all([
		topTable(),
		phase("spring", plan.spring, () => fetchOnce(plan.spring!.pick!)),
		phase("regularSeason", plan.regularSeason, regularOnce),
		// The playoffs' pick is the regular season's (`SeasonPhasePlan`): read that phase's table, once.
		phase("playoffs", plan.playoffs, async () => playoffsTable(await regularOnce())),
	]);
	return {
		answer: {
			...top,
			phases: {
				spring,
				regularSeason,
				playoffs,
			},
			champion: standingsChampion(date, seasons),
		},
		calendarsComplete: complete,
	};
}

/**
 * True when the answer holds "nothing yet" (S139 AC 8): S128's table or an included spring or
 * regular-season table has no team, so it must not be cached past the floor (an MLB hiccup
 * answering `records: []` for a past day is never kept 30 days). Empty on purpose doesn't count:
 * spring's table on its first morning, before any spring game is final, and a playoffs table with
 * no division because no team has clinched.
 */
export function standingsNothingYet(answer: StandingsResponse, day: string): boolean
{
	const firstSpringMorning = answer.phases.spring?.startDate === day;
	const tables = [answer, answer.phases.spring?.table, answer.phases.regularSeason?.table];
	return tables.some((table) => table !== undefined && standingsHasNoTeams(table) && !(firstSpringMorning && table.phase === "spring"));
}
