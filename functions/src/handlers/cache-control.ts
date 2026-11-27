import type { CacheLifetimeStep } from "@bt/domain";
import {
	CACHE_LIFETIME_CAP_MS, CACHE_LIFETIME_FLOOR_MS, cacheLifetimeMs,
} from "@bt/domain";

/**
 * How long the edge may serve a stale copy while it fetches a fresh one (ADR-021:
 * "`stale-while-revalidate` so viewers never wait on a refresh"). One floor's worth, so
 * the cap's staleness guarantee for late scoring corrections stretches by minutes, not
 * by another lifetime.
 */
export const STALE_WHILE_REVALIDATE_S = CACHE_LIFETIME_FLOOR_MS / 1000;

/**
 * The `Cache-Control` a schedule, schedule month (S124), game or day digest (#61) response carries (S47, ADR-021). Workers Cache
 * (`wrangler.jsonc`) stores the response at Cloudflare's edge, tiered, and answers later
 * requests before the Worker runs, for as long as this header allows.
 *
 * Outside the live window (`windowMode: "cache"`) the edge keeps it for
 * `cacheLifetimeMs(now − lastChangedAt)`, ADR-021's ladder, so a game unchanged for hours is
 * served for hours without reaching the Worker. Inside the window (or without the timestamps to
 * judge) nothing is stored: live data moves pitch by pitch, and the in-window path is ingest's
 * (ADR-002), so the edge never holds it past the floor.
 *
 * A schedule month asked for without a version (`?v=`) is judged here too; one asked for with its
 * version is not, since a versioned URL names its exact content and so may be kept far longer
 * ({@link versionedMonthCacheControl}, S194).
 *
 * S212: past, finished data (`isPastFinishedDay` / `isPastFinishedGame`; for the digest, its day and every one of its
 * games) is not judged here either: it gets {@link PAST_CACHE_CONTROL}, a past digest missing a game it couldn't read
 * {@link PARTIAL_PAST_DIGEST_CACHE_CONTROL}, and a forced read of either `no-store` (`withReadCacheControl` in
 * `api.ts`). Of the schedule day, game and digest routes this header now covers only today's and future days,
 * unfinished days and games, and their digests, as before; the unversioned month route and the standings (with their
 * own ladder) still use it as before.
 */
export function edgeCacheControl(entity: { windowMode?: "active" | "cache";
	lastChangedAt?: string; }, now: Date, ladder?: readonly CacheLifetimeStep[]): string
{
	const changedAt = entity.lastChangedAt ? Date.parse(entity.lastChangedAt) : Number.NaN;
	if (entity.windowMode !== "cache" || Number.isNaN(changedAt)) return "no-store";
	// `ladder` is the standings' own (S139); everything else keeps ADR-021's default.
	const lifetimeS = cacheLifetimeMs(now.getTime() - changedAt, ladder) / 1000;
	return `public, s-maxage=${lifetimeS}, stale-while-revalidate=${STALE_WHILE_REVALIDATE_S}`;
}

/**
 * The releases API's `Cache-Control` (S132 AC 4): a release's notes should show within five minutes
 * of its deploy, so the whole budget, fresh plus stale, is at most 300s: 240s fresh, browser and edge
 * alike, then 60s served stale while the edge refetches. The 300s total assumes the edge cache sends
 * `Age` with a hit, as Cloudflare's does, so a browser counts its `max-age` from when the edge
 * fetched the answer, not from when it received it; without `Age` the two lifetimes would add up.
 * Neither {@link edgeCacheControl} (a lifetime
 * of at least the floor plus a floor's stale window) nor {@link STALE_WHILE_REVALIDATE_S} (300s by
 * itself) fits that budget.
 */
export const RELEASES_CACHE_CONTROL = "public, max-age=240, s-maxage=240, stale-while-revalidate=60";

/**
 * The edge lifetime of a past calendar year's schedule month asked for by its exact version (S194
 * AC 7; ADR-021's 2026-11-23 exception): 2147483647 seconds, about 68 years. The owner asked for "as
 * long as possible, like 100 years", but 100 years (3,155,760,000 s) is over 2^31−1, and RFC 9111
 * §1.2.2 tells a cache that can't represent a delta-seconds value to treat it as 2^31; Workers Cache
 * follows RFC 9111, and Cloudflare documents no maximum edge TTL. So this is the largest value every
 * 32-bit signed parser accepts. A rarely opened month may still be evicted, which costs one database
 * read, never an MLB request.
 */
export const PAST_YEAR_MONTH_EDGE_TTL_S = 2147483647;

/**
 * The month-versions answer's `Cache-Control` (S194 AC 7): the floor, with ADR-021's stale window,
 * for every year, so a version the refresh changes names its new URL within about ten minutes.
 */
export const SCHEDULE_MONTH_VERSIONS_CACHE_CONTROL = `public, s-maxage=${CACHE_LIFETIME_FLOOR_MS / 1000}, stale-while-revalidate=${STALE_WHILE_REVALIDATE_S}`;

/**
 * The `Cache-Control` of a complete schedule month asked for with `?v=` (S194 AC 7). When the version
 * matches the answer about to be sent, that URL's content can never change: a month of MLB's today's
 * year or the next is kept 48 hours (ADR-021's cap, which the six-hourly refresh keeps well inside),
 * and a month of an earlier year {@link PAST_YEAR_MONTH_EDGE_TTL_S}, at the edge only (no `max-age`,
 * as ADR-021's standings amendment has it). A version that doesn't match (an old one, or one this
 * isolate can't see yet) gets the versions answer's header: fresh for the floor, then served stale
 * for `STALE_WHILE_REVALIDATE_S` while it is revalidated, about ten minutes in all, so a wrong
 * version never holds data long.
 * `today` is MLB's today (`mlbToday`), so at 03:00 UTC on January 1 last year's months still count
 * as the current year.
 */
export function versionedMonthCacheControl(month: string, matches: boolean, today: string): string
{
	if (!matches) return SCHEDULE_MONTH_VERSIONS_CACHE_CONTROL;
	const lifetimeS = month.slice(0, 4) < today.slice(0, 4) ? PAST_YEAR_MONTH_EDGE_TTL_S : CACHE_LIFETIME_CAP_MS / 1000;
	return `public, s-maxage=${lifetimeS}, stale-while-revalidate=${STALE_WHILE_REVALIDATE_S}`;
}

/**
 * How long the edge keeps a past, finished schedule day, game or digest (S212 AC 3): 2592000 seconds, 30 days,
 * ADR-021's hard cap. Its 2026-11-24 amendment gives the reason it may be that long: the cron re-checks each day of the
 * current year about every six hours and each recently finished game's full detail for a week, and purges the edge copy
 * by URL when one really changes (`purgeGameEdge`; a failed purge is owed and retried by the cron), so
 * the lifetime only bounds a correction nothing purged (one written by the backfill or the baseball-data copy,
 * `baseball-copy.ts`, neither of which purges, or one while the purge credentials are missing).
 */
export const PAST_EDGE_TTL_S = 2592000;

/**
 * How long the edge may serve a past, finished response stale while it refetches it (S212 AC 3): 86400 seconds, one
 * day, since the data almost never changes and a refetch is one Postgres read, never an MLB request.
 */
export const PAST_STALE_S = 86400;

/**
 * How long a browser keeps a past, finished response (S212 AC 3): 3600 seconds, one hour. A browser's copy can't be
 * purged, so it stays short, as ADR-021's standings amendment requires: a purged correction reaches a browser that
 * already holds the day or game within an hour (accepted).
 */
export const PAST_BROWSER_MAX_AGE_S = 3600;

/** The `Cache-Control` of a past, finished schedule day, game or digest (S212 AC 3), from the three constants above. */
export const PAST_CACHE_CONTROL = `public, max-age=${PAST_BROWSER_MAX_AGE_S}, s-maxage=${PAST_EDGE_TTL_S}, stale-while-revalidate=${PAST_STALE_S}`;

/**
 * A past, finished day's digest missing a game it couldn't read (S212 AC 3): the floor, with ADR-021's stale window,
 * never the long lifetime, so the next read after about ten minutes tries that game again rather than waiting on a purge.
 */
export const PARTIAL_PAST_DIGEST_CACHE_CONTROL = `public, s-maxage=${CACHE_LIFETIME_FLOOR_MS / 1000}, stale-while-revalidate=${STALE_WHILE_REVALIDATE_S}`;

/**
 * A checked player's profile links (S209, `GET /api/v1/players/:personId/profiles`): the ids change rarely, so the
 * edge and the browser may keep the answer for a day.
 */
export const PLAYER_PROFILES_CHECKED_CACHE_CONTROL = "public, max-age=86400, s-maxage=86400";

/**
 * A player not yet checked, or one BT has no row for (a 404): kept only minutes, so the links fill in soon after the
 * cron's resolve step looks the player up.
 */
export const PLAYER_PROFILES_PENDING_CACHE_CONTROL = "public, max-age=300, s-maxage=300";
