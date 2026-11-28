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

/**
 * The entitlement flags every fan has, whatever their tier (S250; ADR-025: the one rule for it).
 * Both are built on MLB's data or video, and every Stats API answer points to MLB's notice that only
 * "individual, non-commercial, non-bulk use" is permitted, so selling them would be evidence that BT's
 * use is commercial. A legal research note suggested making them free, and the owner chose to (2026-11-28):
 * "I want to do all your suggestions except redrawing the fields (which I'll do but not yet)."
 * {@link entitlementsForTier} and {@link effectiveEntitlements} both apply it, so neither a tier nor a
 * stored row can take them away.
 */
export const FREE_FOR_EVERY_FAN = {
	/**
	 * Faster live refresh. It gates nothing and is kept only for compatibility (the field stays in
	 * sessions, `GET /api/v1/me` and the spec, ADR-015): live games already push every update to every
	 * fan over the live connection (S149, ADR-020), and that push is the faster refresh (owner,
	 * 2026-11-28, asked what it should mean now, chose "Retire it (Recommended)": "FEATURES says the
	 * live push is the faster refresh, and S250's flag stays only for compatibility.").
	 */
	fasterLiveRefresh: true,
	/** Savant's play and pitch video links: MLB's video, so free for every fan. */
	savantLinks: true,
} as const satisfies Partial<Omit<Entitlements, "tier">>;

/**
 * The entitlements a tier grants: {@link FREE_FOR_EVERY_FAN}'s flags (`fasterLiveRefresh`,
 * `savantLinks`) for every tier, `"none"` included, since they are built on MLB's data or video and BT
 * doesn't sell those (S250); the rest from the tier's rank, Backer and up.
 */
export function entitlementsForTier(tier: PatronTier): Entitlements
{
	const rank = TIER_RANK[tier];
	return {
		tier,
		cloudSyncedSettings: rank >= TIER_RANK.Backer,
		// S209 AC 9: any active pledge unlocks every other stats site, Savant included (not held to `savantLinks`).
		statsProviderChoice: rank >= TIER_RANK.Backer,
		...FREE_FOR_EVERY_FAN,
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
 *
 * Either way {@link FREE_FOR_EVERY_FAN} is applied last, so this read wins over the stored row (S250):
 * a row written before S250 holds `false` for `fasterLiveRefresh` or `savantLinks` below the old tiers,
 * and is handed `true` without a migration, since what BT hands out, not what it once stored, is what
 * it says a fan has.
 */
export function effectiveEntitlements(real: Entitlements, override: PatronTier | null, overrideAllowed: boolean): Entitlements
{
	return {
		...(overrideAllowed && override !== null ? entitlementsForTier(override) : real),
		...FREE_FOR_EVERY_FAN,
	};
}
