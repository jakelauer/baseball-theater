const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

/**
 * Shortest cache lifetime: what a game or schedule that just changed gets.
 * Equals the fixed 5-minute TTL the refresh path used before ADR-021.
 */
export const CACHE_LIFETIME_FLOOR_MS = 5 * MINUTE;

/** Longest cache lifetime — the staleness guarantee for late MLB scoring corrections (ADR-021). */
export const CACHE_LIFETIME_CAP_MS = 48 * HOUR;

/** One rung: once data has gone unchanged for `unchangedForMs`, cache it for `lifetimeMs`. */
export type CacheLifetimeStep = {
	unchangedForMs: number;
	lifetimeMs: number;
};

/**
 * The ADR-021 ladder, ascending. Below the first rung the floor applies; the
 * last rung is the cap. Tunable — change the numbers here, never at a call site.
 */
export const CACHE_LIFETIME_LADDER: readonly CacheLifetimeStep[] = [
	{
		unchangedForMs: 10 * MINUTE,
		lifetimeMs: 15 * MINUTE,
	},
	{
		unchangedForMs: 15 * MINUTE,
		lifetimeMs: 30 * MINUTE,
	},
	{
		unchangedForMs: 30 * MINUTE,
		lifetimeMs: 2 * HOUR,
	},
	{
		unchangedForMs: 2 * HOUR,
		lifetimeMs: 10 * HOUR,
	},
	{
		unchangedForMs: 10 * HOUR,
		lifetimeMs: 24 * HOUR,
	},
	{
		unchangedForMs: 24 * HOUR,
		lifetimeMs: CACHE_LIFETIME_CAP_MS,
	},
];

/** Standings' longest cache lifetime (S139; ADR-021 amended 2026-11-13): 30 days instead of 48 hours. */
export const STANDINGS_CACHE_LIFETIME_CAP_MS = 30 * 24 * HOUR;

/**
 * The standings' ladder (S139; owner, 2026-11-13: "They should still use the graduated thing, but
 * make it an exception for the 48h cap. Increase the cap to 30 days."): ADR-021's ladder carried
 * on past 48 hours — unchanged for 48 hours → 7 days, unchanged for 7 days → 30 days (the
 * agent's proposed steps). A past day's table changes only by a late MLB correction.
 */
export const STANDINGS_CACHE_LIFETIME_LADDER: readonly CacheLifetimeStep[] = [
	...CACHE_LIFETIME_LADDER,
	{
		unchangedForMs: CACHE_LIFETIME_CAP_MS,
		lifetimeMs: 7 * 24 * HOUR,
	},
	{
		unchangedForMs: 7 * 24 * HOUR,
		lifetimeMs: STANDINGS_CACHE_LIFETIME_CAP_MS,
	},
];

/**
 * How long data may be cached, given how long it has gone unchanged
 * (`now − lastChangedAt`). The one implementation of ADR-021: the edge
 * `s-maxage` and the MLB refresh-on-read both call it. `ladder` defaults to
 * ADR-021's; only the standings pass their own (`STANDINGS_CACHE_LIFETIME_LADDER`).
 *
 * A detected change resets `lastChangedAt`, so the input drops to ~0 and the
 * lifetime falls back to the floor. A negative or non-finite input (clock skew,
 * missing timestamp) also gets the floor: the safe answer is "check again soon".
 */
export function cacheLifetimeMs(msSinceLastChange: number, ladder: readonly CacheLifetimeStep[] = CACHE_LIFETIME_LADDER): number
{
	let lifetime = CACHE_LIFETIME_FLOOR_MS;
	if (!Number.isFinite(msSinceLastChange)) return lifetime;
	for (const step of ladder)
	{
		if (msSinceLastChange < step.unchangedForMs) break;
		lifetime = step.lifetimeMs;
	}
	return lifetime;
}
