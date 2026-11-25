import type { Entitlements, PatronTier } from "./types.js";

const TIER_RANK: Record<PatronTier, number> = {
	none: 0,
	Backer: 1,
	"Pro Backer": 2,
	"Star Backer": 3,
	"Premium Sponsor": 4,
};

/**
 * Every tier BT knows, lowest first: what the staging tier override (S215) offers and the only
 * values its route accepts. One list beside the ranks so a new tier can't be left out of either.
 */
export const PATRON_TIERS = Object.keys(TIER_RANK) as readonly PatronTier[];

/** Whether `value` is one of {@link PATRON_TIERS} exactly (a request body's tier, S215). */
export function isPatronTier(value: unknown): value is PatronTier
{
	return typeof value === "string" && Object.prototype.hasOwnProperty.call(TIER_RANK, value);
}

export function entitlementsForTier(tier: PatronTier): Entitlements
{
	const rank = TIER_RANK[tier];
	return {
		tier,
		fasterLiveRefresh: rank >= TIER_RANK.Backer,
		cloudSyncedSettings: rank >= TIER_RANK.Backer,
		savantLinks: rank >= TIER_RANK["Pro Backer"],
	};
}

export function parsePatronTier(title: string | null | undefined): PatronTier
{
	if (!title) return "none";
	const t = title.trim();
	if (t in TIER_RANK) return t as PatronTier;
	// Patreon reward titles sometimes vary slightly
	const lower = t.toLowerCase();
	if (lower.includes("premium")) return "Premium Sponsor";
	if (lower.includes("star")) return "Star Backer";
	if (lower.includes("pro")) return "Pro Backer";
	if (lower.includes("backer")) return "Backer";
	return "none";
}

export function hasMinimumTier(current: PatronTier, required: PatronTier): boolean
{
	return TIER_RANK[current] >= TIER_RANK[required];
}

/**
 * The entitlements a session and `GET /api/v1/me` hand out (S215; ADR-025: the one rule for it):
 * the tier a tester chose with staging's backer tier override when `overrideAllowed` is true and
 * one is chosen, else `real`, the account's stored tier. The override exists for staging tests
 * only: `overrideAllowed` comes from the server's deploy-time config (`tierOverrideAllowed`), and
 * production's config makes it false, so production refuses an override on the server rather than
 * hiding it. It never changes `real`, the stored `entitlements` row a future Patreon link writes,
 * and never touches Patreon.
 */
export function effectiveEntitlements(real: Entitlements, override: PatronTier | null, overrideAllowed: boolean): Entitlements
{
	return overrideAllowed && override !== null ? entitlementsForTier(override) : real;
}
