import type { DayDigestResponse, ScheduleDay } from "@bt/domain";
import { dayDigest, digestFreshness } from "@bt/domain";
import type { IngestDeps } from "./ingest.js";
import { getOrRefreshGame, getOrRefreshSchedule } from "./ingest.js";

/**
 * "Best of <date>" (S71): reads the day's schedule, then each of its games the way the
 * game route does (stored copy, refreshed when stale), and ranks their videos with
 * `dayDigest`. A game that can't be read is left out rather than failing the whole
 * digest; a day with no videos yet has an empty digest. Returns the digest's freshness too
 * (`digestFreshness`: live while the day or any game is, last changed when the latest of them
 * did, #61), so the route caches it by the same graduated rule as the day and its games (ADR-021).
 */
export async function getDayDigest(deps: IngestDeps, date: string): Promise<{ freshness: Pick<ScheduleDay, "windowMode" | "lastChangedAt">;
	digest: DayDigestResponse; }>
{
	const day = await getOrRefreshSchedule(deps, date);
	const read = await Promise.all(day.games.map((game) => getOrRefreshGame(deps, game.gamePk).catch(() => null)));
	const games = read.filter((game) => game !== null);
	const freshness = digestFreshness(day, games);
	return {
		freshness,
		digest: {
			date,
			items: dayDigest(games),
			windowMode: freshness.windowMode,
		},
	};
}
