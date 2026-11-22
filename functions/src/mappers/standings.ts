/**
 * Pure upstream → BT mapper for standings.
 *
 * MLB reports every games-back and elimination figure as a string and uses
 * `"-"` for "not applicable" rather than `0` or `null`. Normalizing that here
 * keeps the sentinel out of the UI entirely.
 */
import type {
	StandingsDivision,
	StandingsSnapshot,
	StandingsTeamRecord,
} from "@bt/domain";
import { leagueName } from "@bt/domain";
import type {
	StandingsRecordEntry,
	StandingsRecordGroup,
	StandingsResponse,
} from "@bt/mlb-api";

/** MLB's "not applicable" dash, normalized to `null`. */
export function normalizeDash(value: string | undefined): string | null
{
	if (value === undefined || value === "-") return null;
	return value;
}

function toRank(value: string | undefined): number | null
{
	if (value === undefined) return null;
	const parsed = Number.parseInt(value, 10);
	return Number.isNaN(parsed) ? null : parsed;
}

/**
 * MLB's clinch letter (S160) as it sends it (case kept, surrounding whitespace trimmed), only on a
 * clinched team: a letter on a row that isn't `clinched`, or an empty or whitespace-only one, is no
 * letter (`null`), so the letter never says more than `clinched` does.
 */
function clinchLetter(entry: StandingsRecordEntry): string | null
{
	if (entry.clinched !== true) return null;
	const letter = entry.clinchIndicator?.trim();
	return letter ? letter : null;
}

export function mapStandingsTeam(entry: StandingsRecordEntry): StandingsTeamRecord
{
	return {
		teamId: entry.team?.id ?? 0,
		name: entry.team?.name ?? "",
		abbreviation: entry.team?.abbreviation ?? null,
		wins: entry.wins ?? entry.leagueRecord?.wins ?? 0,
		losses: entry.losses ?? entry.leagueRecord?.losses ?? 0,
		pct: entry.winningPercentage ?? entry.leagueRecord?.pct ?? null,
		gamesBack: normalizeDash(entry.gamesBack),
		divisionRank: toRank(entry.divisionRank),
		streak: entry.streak?.streakCode ?? null,
		runsScored: entry.runsScored ?? null,
		runsAllowed: entry.runsAllowed ?? null,
		runDifferential: entry.runDifferential ?? null,
		divisionLeader: entry.divisionLeader ?? false,
		clinched: entry.clinched ?? false,
		clinchIndicator: clinchLetter(entry),
		eliminationNumber: normalizeDash(entry.eliminationNumber),
	};
}

/**
 * A rank sort's comparator: lower ranks first, rows with no rank after every ranked row, and two
 * unranked rows equal, so the stable sort keeps them in the order MLB sent them. Explicit rather than
 * `Infinity - Infinity`, which is NaN and only happens to sort as equal.
 */
function byRank(a: number | null, b: number | null): number
{
	if (a === null) return b === null ? 0 : 1;
	if (b === null) return -1;
	return a - b;
}

/**
 * One record group as a table. A group with a division is that division's, its teams by division
 * rank. A group with no division is a whole league's (S155: before 1969 the leagues had none, and
 * MLB sends each as one group, fixtures/raw/standings-1950-07-04.json): it is named for its league
 * (`leagueName`), never from a row's hydrated division, which is the team's current one, and its
 * teams keep the order they stood in, MLB's `leagueRank`. Its games-back is already the league's.
 */
export function mapStandingsDivision(group: StandingsRecordGroup): StandingsDivision
{
	const rows = group.teamRecords ?? [];
	const leagueId = group.league?.id ?? null;
	if (!group.division)
	{
		const ranked = rows.map((row) => ({
			rank: toRank(row.leagueRank),
			team: mapStandingsTeam(row),
		}));
		ranked.sort((a, b) => byRank(a.rank, b.rank));
		return {
			divisionId: null,
			name: leagueId === null ? null : leagueName(leagueId) ?? null,
			leagueId,
			teams: ranked.map((row) => row.team),
		};
	}
	const teams = rows.map(mapStandingsTeam);
	teams.sort((a, b) => byRank(a.divisionRank, b.divisionRank));
	// The group's own division ref is unnamed; the readable name is on each row.
	const named = rows.find((row) => row.team?.division?.name);
	return {
		divisionId: group.division.id ?? null,
		name: named?.team?.division?.name ?? null,
		leagueId,
		teams,
	};
}

/**
 * The order every table lists its divisions in (S128): the regular season's, AL East, Central,
 * West, then NL East, Central, West. MLB's spring table comes West first, and the ids are not in
 * this order (West is 200, East 201, Central 202), so it is a fixed list, not a sort by id.
 */
const DIVISION_ORDER: readonly number[] = [201, 202, 200, 204, 205, 203];

/** The leagues' order (S155): the American League's table before the National League's. */
const LEAGUE_ORDER: readonly number[] = [103, 104];

/**
 * A table's place: a division's in `DIVISION_ORDER`, then a whole league's in `LEAGUE_ORDER` (only
 * before 1969, so never beside divisions in practice); any other keeps its place after them.
 */
function divisionPlace(division: StandingsDivision): number
{
	if (division.divisionId === null)
	{
		const league = division.leagueId === null ? -1 : LEAGUE_ORDER.indexOf(division.leagueId);
		return DIVISION_ORDER.length + (league === -1 ? LEAGUE_ORDER.length : league);
	}
	const place = DIVISION_ORDER.indexOf(division.divisionId);
	return place === -1 ? DIVISION_ORDER.length + LEAGUE_ORDER.length : place;
}

export function mapStandings(
	response: StandingsResponse,
	date: string,
	fetchedAt = new Date().toISOString(),
): StandingsSnapshot
{
	const divisions = (response.records ?? []).map(mapStandingsDivision);
	// A stable sort, so divisions outside the list keep MLB's order among themselves.
	divisions.sort((a, b) => divisionPlace(a) - divisionPlace(b));
	return {
		date,
		divisions,
		fetchedAt,
		windowMode: "cache",
	};
}
