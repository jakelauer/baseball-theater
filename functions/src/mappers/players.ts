/**
 * Pure upstream → BT mapper for players.
 *
 * `/people?hydrate=stats(...)` returns each season line under
 * `stats[].splits[]` — one row per team the player logged the season with —
 * rather than the single `stats` line the live feed hydrates. Only the season
 * splits are mapped; BT shows a season bag, not a career table.
 *
 * `/people?hydrate=xrefId` (S209) returns each person's ids on other sites under `xrefIds[]`;
 * `mapPeopleXrefs` reads the two BT links to.
 */
import type { PlayerProfile, PlayerSeasonLine } from "@bt/domain";
import type { ResolvedPlayerIds } from "@bt/ports";
import type {
	PeopleResponse,
	Person,
	PersonSeasonSplit,
	PersonStatSplit,
} from "@bt/mlb-api";

function mapSeasonLine(group: string, split: PersonSeasonSplit): PlayerSeasonLine
{
	const stat = split.stat ?? {};
	return {
		season: split.season ?? "",
		group,
		teamId: split.team?.id ?? null,
		gamesPlayed: stat.gamesPlayed ?? null,
		avg: stat.avg ?? null,
		obp: stat.obp ?? null,
		slg: stat.slg ?? null,
		ops: stat.ops ?? null,
		homeRuns: stat.homeRuns ?? null,
		rbi: stat.rbi ?? null,
		era: stat.era ?? null,
		wins: stat.wins ?? null,
		losses: stat.losses ?? null,
		strikeOuts: stat.strikeOuts ?? null,
		inningsPitched: stat.inningsPitched ?? null,
	};
}

export function mapPlayerSeasons(
	splits: PersonStatSplit[] | undefined,
): PlayerSeasonLine[]
{
	return (splits ?? []).flatMap((entry) =>
	{
		const group = entry.group?.displayName ?? "";
		return (entry.splits ?? []).map((split) => mapSeasonLine(group, split));
	});
}

export function mapPlayer(person: Person): PlayerProfile
{
	return {
		playerId: person.id,
		fullName: person.fullName ?? "",
		boxscoreName: person.boxscoreName ?? null,
		primaryNumber: person.primaryNumber ?? null,
		position: person.primaryPosition?.abbreviation ?? null,
		batSide: person.batSide?.code ?? null,
		pitchHand: person.pitchHand?.code ?? null,
		birthDate: person.birthDate ?? null,
		currentAge: person.currentAge ?? null,
		active: person.active ?? false,
		seasons: mapPlayerSeasons(person.stats),
	};
}

export function mapPeople(response: PeopleResponse): PlayerProfile[]
{
	return (response.people ?? []).map(mapPlayer);
}

/**
 * Each person's FanGraphs and Baseball-Reference ids from MLB's cross-references (S209 AC 1): FanGraphs from the
 * `fangraphs` cross-reference, Baseball-Reference from `lahman`, the Lahman database's id, which is
 * Baseball-Reference's in every recorded case (28 of 28 for 823823's players); MLB keeps no Baseball-Reference id
 * of its own. A person with neither is left out; the first of a type wins if MLB lists two.
 */
export function mapPeopleXrefs(response: PeopleResponse): Map<number, ResolvedPlayerIds>
{
	const found = new Map<number, ResolvedPlayerIds>();
	for (const person of response.people ?? [])
	{
		const xref = (type: string) => person.xrefIds?.find((entry) => entry.xrefType === type && entry.xrefId)?.xrefId ?? null;
		const ids = {
			fangraphsId: xref("fangraphs"),
			bbrefId: xref("lahman"),
		};
		if (person.id !== undefined && (ids.fangraphsId !== null || ids.bbrefId !== null)) found.set(person.id, ids);
	}
	return found;
}
