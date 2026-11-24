/**
 * Asking the edge to drop its copy of a past, finished day or game (S212 AC 4; ADR-021's 2026-11-24 amendment). The
 * writers call {@link purgeDayEdge} and {@link purgeGameEdge} (from `storeSchedule` and `storeGame` in `ingest.ts`, so
 * every path that writes a change reaches them); the URLs are built from the app's origin exactly as the web client
 * asks for them. A purge that fails never fails the write: its URLs are recorded as owed and the cron retries them
 * ({@link retryOwedEdgePurges}, S212 review), so a Cloudflare outage delays a correction rather than pinning it at the
 * edge for its 30 days.
 */
import type {
	EdgeCachePurger, OwedEdgePurgeRepository, ScheduleRepository,
} from "@bt/ports";

/**
 * The purger, the origin its URLs are built from (`BT_APP_ORIGIN`), and where a failed purge's URLs are owed (absent:
 * only logged). The Worker and the Node server always have one (`edgePurgeFor`: Cloudflare's purger with the
 * credentials, else a no-op that logs once); absent (most tests, the backfill, the baseball-data copy), nothing is
 * purged.
 */
export type EdgePurge = {
	purger: EdgeCachePurger;
	origin: string;
	owed?: OwedEdgePurgeRepository;
};

/** What a purge needs: the purge itself, and the schedule store for the days that list a game (`purgeGameEdge`). */
export type EdgePurgeDeps = {
	edgePurge?: EdgePurge;
	schedules: Pick<ScheduleRepository, "listGameListings">;
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

/** Purges `paths` (de-duplicated, in order) in one request; a failure is logged and its URLs owed, never thrown. */
async function purgePaths(edge: EdgePurge | undefined, paths: readonly string[], at: Date): Promise<void>
{
	if (!edge || paths.length === 0) return;
	const origin = edge.origin.replace(/\/+$/, "");
	const urls = [...new Set(paths)].map((path) => `${origin}${path}`);
	try
	{
		await edge.purger.purge(urls);
	}
	catch (error)
	{
		// The write already happened; the cron retries the purge (`retryOwedEdgePurges`).
		console.warn(`edge purge failed for ${urls.join(", ")}; owed for the cron to retry`, error);
		try
		{
			await edge.owed?.owe(urls, at.toISOString());
		}
		catch (oweError)
		{
			// Neither purged nor owed: the correction waits out the edge lifetime.
			console.warn(`edge purge: could not record ${urls.join(", ")} as owed`, oweError);
		}
	}
}

/** Purges a changed (or newly stored) past, finished day's schedule and digest URLs. `at` is the write's time. */
export function purgeDayEdge(deps: Pick<EdgePurgeDeps, "edgePurge">, date: string, at: Date): Promise<void>
{
	return purgePaths(deps.edgePurge, dayEdgePaths(date), at);
}

/**
 * Purges each changed (or newly stored) past, finished game's URL and the schedule and digest URLs of every day that
 * shows it (S212 review): its official date, and every stored day of its official date's calendar year that lists it
 * (`listGameListings`, one read for all the games, over the years they span; a game postponed or suspended on one day
 * and played on another is listed by both, and each day's digest shows its clips; MLB plays a game within its own
 * season, so the year bounds the read). `dates` adds whole days the caller changed itself, so a write sends one request.
 * Reads nothing when there is no purge or no game.
 */
export async function purgeGameEdge(deps: EdgePurgeDeps, games: readonly { gamePk: number;
	officialDate: string; }[], at: Date, dates: readonly string[] = []): Promise<void>
{
	if (!deps.edgePurge) return;
	const years = games.map((game) => game.officialDate.slice(0, 4)).sort();
	const listings = games.length === 0
		? []
		: await deps.schedules.listGameListings(games.map((game) => game.gamePk), `${years[0]}-01-01`, `${years.at(-1)}-12-31`);
	const paths: string[] = [];
	for (const game of games)
	{
		const year = game.officialDate.slice(0, 4);
		const listed = listings.filter((listing) => listing.gamePk === game.gamePk && listing.date.startsWith(year)).map((listing) => listing.date);
		paths.push(gameEdgePath(game.gamePk), ...[game.officialDate, ...listed].flatMap(dayEdgePaths));
	}
	await purgePaths(deps.edgePurge, [...paths, ...dates.flatMap(dayEdgePaths)], at);
}

/** How many owed URLs one retry sends: Cloudflare's per-request cap (`PURGE_URLS_PER_REQUEST`), so one request a tick. */
export const OWED_PURGES_PER_TICK = 30;

/**
 * How long an owed purge is kept: the edge lifetime of past, finished data (`PAST_EDGE_TTL_S`, 30 days). The edge copy
 * the purge was for was stored before the purge was owed, so it has expired by then and the purge is moot.
 */
export const OWED_PURGE_GIVE_UP_MS = 30 * 24 * 60 * 60 * 1000;

/** The first wait after a failed retry: one minute (one tick), doubled after each further failure. */
export const OWED_PURGE_FIRST_RETRY_MS = 60 * 1000;

/**
 * The longest wait between retries: six hours. With a token Cloudflare refuses for good (401/403) or a long outage,
 * the waits double from a minute to six hours, so a stuck purge costs about a dozen Cloudflare requests its first day
 * and four a day after, until it is given up ({@link OWED_PURGE_GIVE_UP_MS}).
 */
export const OWED_PURGE_MAX_RETRY_MS = 6 * 60 * 60 * 1000;

/** The wait before the next retry of a batch whose retry has now failed `failures` times (1 or more). */
export function owedPurgeRetryDelayMs(failures: number): number
{
	return Math.min(OWED_PURGE_FIRST_RETRY_MS * 2 ** Math.max(0, failures - 1), OWED_PURGE_MAX_RETRY_MS);
}

/**
 * Retries the purges BT still owes the edge (S212 review), from `scheduled()` on every allowed tick in its own
 * `waitUntil`: at most {@link OWED_PURGES_PER_TICK} due URLs, oldest owed first, in one request. Owed purges older than
 * {@link OWED_PURGE_GIVE_UP_MS} are dropped unsent (logged). A purge that works settles the URLs it sent (only those
 * not owed again since the listing); one that fails defers them by {@link owedPurgeRetryDelayMs}. Budget: one database
 * read a tick, and at most one Cloudflare request a tick, only while purges are owed. Returns how many URLs it purged.
 */
export async function retryOwedEdgePurges(deps: { edgePurge?: EdgePurge;
	now?: () => Date; }): Promise<number>
{
	const edge = deps.edgePurge;
	if (!edge?.owed) return 0;
	const now = deps.now?.() ?? new Date();
	const due = await edge.owed.listDue(now.toISOString(), OWED_PURGES_PER_TICK);
	if (due.length === 0) return 0;
	const expired = due.filter((owed) => now.getTime() - Date.parse(owed.owedAt) >= OWED_PURGE_GIVE_UP_MS);
	const live = due.filter((owed) => !expired.includes(owed));
	if (expired.length > 0)
	{
		console.warn(`edge purge: gave up ${expired.map((owed) => owed.url).join(", ")}; owed past the edge lifetime`);
		await edge.owed.settle(expired);
	}
	if (live.length === 0) return 0;
	try
	{
		await edge.purger.purge(live.map((owed) => owed.url));
	}
	catch (error)
	{
		const failures = Math.max(...live.map((owed) => owed.failures)) + 1;
		console.warn(`edge purge retry failed for ${live.length} owed URL(s) (failure ${failures})`, error);
		await edge.owed.defer(live, new Date(now.getTime() + owedPurgeRetryDelayMs(failures)).toISOString());
		return 0;
	}
	await edge.owed.settle(live);
	return live.length;
}
