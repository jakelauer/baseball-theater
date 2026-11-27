/**
 * Baseball Savant's game feed → the figures BT keeps for each pitch (S103 AC 4). Only what MLB's own feeds lack is
 * projected: expected average, barrel, spray position in feet, the home-run ballpark count, bat speed, swords, Savant's
 * in-zone call, times through the order, the challenged pitch and the front-of-plate crossing. Savant's copies of the
 * live feed (the flight, the strike zone, the count) and of the box score are never read here, so each value keeps one
 * source (ADR-025). A row Savant leaves a figure off keeps it absent, never zero: it may arrive in a later pull.
 */
import type { SavantPitch } from "@bt/domain";
import type { SavantFeedPitch, SavantGameFeedResponse } from "@bt/mlb-api";

/** Savant's expected average as a number: ".780" is 0.78; anything that isn't a number is absent. */
function expectedAverage(text: string | undefined): number | undefined
{
	if (text === undefined || text.trim() === "") return undefined;
	const value = Number(text);
	return Number.isFinite(value) ? value : undefined;
}

/** Savant's barrel flag (1 or 0) as a boolean; absent on a pitch nobody put in play. */
function barrel(flag: number | undefined): boolean | undefined
{
	return flag === undefined ? undefined : flag === 1;
}

/** The pitch with its absent figures left out, so a stored pitch never holds a key with no value. */
function present(pitch: SavantPitch): SavantPitch
{
	return Object.fromEntries(Object.entries(pitch).filter(([, value]) => value !== undefined)) as SavantPitch;
}

/** One pitch row → the figures BT keeps, stamped with the pull's `version`. */
function mapPitch(row: SavantFeedPitch, version: number): SavantPitch
{
	return present({
		playId: row.play_id,
		atBatIndex: row.ab_number - 1,
		version,
		xba: expectedAverage(row.xba),
		isBarrel: barrel(row.is_barrel),
		x: row.hc_x_ft,
		y: row.hc_y_ft,
		homeRunBallparks: row.contextMetrics?.homeRunBallparks,
		batSpeed: row.batSpeed,
		isSword: row.isSword,
		savantInZone: row.savantIsInZone,
		timesThroughOrder: row.pitcher_time_thru_order,
		isAbsChallenge: row.is_abs_challenge,
		plateXPoly: row.plateXPoly,
		plateZPoly: row.plateZPoly,
	});
}

/**
 * Every pitch of the feed (both teams'), in the order the game threw them (by at-bat, then Savant's running count), each
 * stamped with the pull's `version` (the time it was fetched, `mergeSavantPitches`); null when the feed lists no pitch.
 */
export function mapSavantGameFeed(response: SavantGameFeedResponse, version: number): SavantPitch[] | null
{
	const rows = [...response.team_home ?? [], ...response.team_away ?? []]
		.sort((a, b) => a.ab_number - b.ab_number || (a.game_total_pitches ?? 0) - (b.game_total_pitches ?? 0));
	return rows.length === 0 ? null : rows.map((row) => mapPitch(row, version));
}
