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
