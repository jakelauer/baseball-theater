/**
 * Asking the edge to drop its copy of a past, finished day or game (S212 AC 4; ADR-021's 2026-11-24 amendment). The
 * writers call {@link purgeDayEdge} and {@link purgeGameEdge} (from `storeSchedule` and `storeGame` in `ingest.ts`, so
 * every path that writes a change reaches them); the URLs are built from the app's origin exactly as the web client
 * asks for them. A purge that fails is logged and never fails the write.
 */
import type { EdgeCachePurger } from "@bt/ports";

/** The purger and the origin its URLs are built from (`BT_APP_ORIGIN`). Absent (tests, the Node server, the backfill): nothing is purged. */
export type EdgePurge = {
	purger: EdgeCachePurger;
	origin: string;
};

/** The day's two edge URLs, as the web client asks for them: its scoreboard and its digest. */
export function dayEdgePaths(date: string): string[]
{
	return [`/api/v1/schedule?date=${date}`, `/api/v1/digest?date=${date}`];
}

/** The game's edge URL. */
export function gameEdgePath(gamePk: number): string
{
	return `/api/v1/games/${gamePk}`;
}

async function purgePaths(edge: EdgePurge | undefined, paths: readonly string[]): Promise<void>
{
	if (!edge) return;
	const origin = edge.origin.replace(/\/+$/, "");
	try
	{
		await edge.purger.purge(paths.map((path) => `${origin}${path}`));
	}
	catch (error)
	{
		// The write already happened; a correction then waits out the edge lifetime.
		console.warn(`edge purge failed for ${paths.join(", ")}`, error);
	}
}

/** Purges a changed (or newly stored) past, finished day's schedule and digest URLs. */
export function purgeDayEdge(edge: EdgePurge | undefined, date: string): Promise<void>
{
	return purgePaths(edge, dayEdgePaths(date));
}

/** Purges a changed (or newly stored) past, finished game's URL and its day's schedule and digest URLs. */
export function purgeGameEdge(edge: EdgePurge | undefined, gamePk: number, officialDate: string): Promise<void>
{
	return purgePaths(edge, [gameEdgePath(gamePk), ...dayEdgePaths(officialDate)]);
}
