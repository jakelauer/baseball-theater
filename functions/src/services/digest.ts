import type { DayDigestResponse, ScheduleDay } from "@bt/domain";
import {
	dayDigest, digestFreshness, isPastFinishedGame,
} from "@bt/domain";
import type { IngestDeps } from "./ingest.js";
import { readDayAndGames } from "./ingest.js";

/**
 * Which edge lifetime a digest gets (S212 AC 3): `past` when its day is past and finished and so is every one of its
 * games, each read successfully (`isPastFinishedDay` / `isPastFinishedGame`); `partialPast` when its day is past and
 * finished but a game couldn't be read; `ladder` otherwise (ADR-021's graduated rule, by `freshness`). The schedule
 * and game routes pick their header with the same values (`past` or `ladder`, through `withReadCacheControl`).
 */
export type DigestEdgeLifetime = "past" | "partialPast" | "ladder";

/**
 * "Best of <date>" (S71): reads the day's schedule, then each of its games the way the
 * game route does (stored copy, refreshed when stale), and ranks their videos with
 * `dayDigest`. A game that can't be read is left out rather than failing the whole
 * digest; a day with no videos yet has an empty digest. Returns the digest's freshness too
 * (`digestFreshness`: live while the day or any game is, last changed when the latest of them
 * did, #61), so the route caches it by the same graduated rule as the day and its games (ADR-021).
 *
 * S212: the day and game reads serve stored past, finished data with no MLB request, so a past, finished day whose
 * games are all stored costs no MLB request at all; a game never stored is still fetched on its first read (#516).
 * Also returns which edge lifetime the digest gets ({@link DigestEdgeLifetime}).
 *
 * S216: the day and its games are read together (`readDayAndGames`): every game's snapshot in one read and its state
 * row from the day's, the cold ones fetched and stored in one batch and answered from what was formed (no read-back),
 * the projections and the one edge purge after the response. A cold 15-game digest makes at most 7 database round
 * trips before it answers, 9 in all.
 */
export async function getDayDigest(deps: IngestDeps, date: string): Promise<{ freshness: Pick<ScheduleDay, "windowMode" | "lastChangedAt">;
	digest: DayDigestResponse;
	edgeLifetime: DigestEdgeLifetime; }>
{
	const {
		day, pastFinished, games: read,
	} = await readDayAndGames(deps, date);
	const games = read.filter((game) => game !== null);
	const freshness = digestFreshness(day, games);
	const now = deps.now?.() ?? new Date();
	const edgeLifetime: DigestEdgeLifetime = !pastFinished
		? "ladder"
		: games.length < read.length ? "partialPast" : games.every((game) => isPastFinishedGame(game, now)) ? "past" : "ladder";
	return {
		freshness,
		digest: {
			date,
			items: dayDigest(games),
			windowMode: freshness.windowMode,
		},
		edgeLifetime,
	};
}
