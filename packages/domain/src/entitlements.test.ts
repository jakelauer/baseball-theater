import {
	describe, expect, it,
} from "vitest";
import {
	effectiveEntitlements, entitlementsForTier, FREE_FOR_EVERY_FAN, hasMinimumTier, isPatronTier, parsePatronTier, PATRON_TIERS,
} from "./entitlements.js";
import type { Entitlements } from "./types.js";

describe("entitlements", () =>
{
	it("parses tier titles", () =>
	{
		expect(parsePatronTier("Pro Backer")).toBe("Pro Backer");
		expect(parsePatronTier("pro backer plus")).toBe("Pro Backer");
		expect(parsePatronTier(null)).toBe("none");
	});

	it("S250 AC 1: every tier, none included, has both MLB-built flags; the others still come from the tier", () =>
	{
		expect(PATRON_TIERS.map((tier) => entitlementsForTier(tier))).toEqual([
			{
				tier: "none",
				fasterLiveRefresh: true,
				cloudSyncedSettings: false,
				savantLinks: true,
				statsProviderChoice: false,
			},
			{
				tier: "Backer",
				fasterLiveRefresh: true,
				cloudSyncedSettings: true,
				savantLinks: true,
				statsProviderChoice: true,
			},
			{
				tier: "Pro Backer",
				fasterLiveRefresh: true,
				cloudSyncedSettings: true,
				savantLinks: true,
				statsProviderChoice: true,
			},
			{
				tier: "Star Backer",
				fasterLiveRefresh: true,
				cloudSyncedSettings: true,
				savantLinks: true,
				statsProviderChoice: true,
			},
			{
				tier: "Premium Sponsor",
				fasterLiveRefresh: true,
				cloudSyncedSettings: true,
				savantLinks: true,
				statsProviderChoice: true,
			},
		]);
		expect(FREE_FOR_EVERY_FAN).toEqual({
			fasterLiveRefresh: true,
			savantLinks: true,
		});
	});

	it("compares minimum tiers", () =>
	{
		expect(hasMinimumTier("Star Backer", "Pro Backer")).toBe(true);
		expect(hasMinimumTier("Backer", "Pro Backer")).toBe(false);
	});
});

describe("effectiveEntitlements (S215)", () =>
{
	const real = entitlementsForTier("Backer");

	it("S215 AC 1: each of the five tiers as an override, when allowed, gives exactly entitlementsForTier of it", () =>
	{
		expect(PATRON_TIERS).toEqual(["none", "Backer", "Pro Backer", "Star Backer", "Premium Sponsor"]);
		for (const tier of PATRON_TIERS)
		{
			expect(effectiveEntitlements(real, tier, true)).toEqual(entitlementsForTier(tier));
		}
	});

	it("S215 AC 1: a null override gives the real tier", () =>
	{
		expect(effectiveEntitlements(real, null, true)).toEqual(real);
		expect(effectiveEntitlements(real, null, false)).toEqual(real);
	});

	it("S215 AC 1: any override when not allowed gives the real tier", () =>
	{
		for (const tier of PATRON_TIERS)
		{
			expect(effectiveEntitlements(real, tier, false)).toEqual(real);
		}
	});

	it("S250 AC 2: a stored row of false for both flags is handed true, override allowed or not, and is left as stored", () =>
	{
		const stored: Entitlements = {
			tier: "Pro Backer",
			fasterLiveRefresh: false,
			cloudSyncedSettings: true,
			savantLinks: false,
			statsProviderChoice: true,
		};
		const handed = {
			...stored,
			fasterLiveRefresh: true,
			savantLinks: true,
		};
		expect(effectiveEntitlements(stored, null, false)).toEqual(handed);
		expect(effectiveEntitlements(stored, "none", false)).toEqual(handed);
		expect(effectiveEntitlements(stored, null, true)).toEqual(handed);
		expect(effectiveEntitlements(stored, "none", true)).toEqual(entitlementsForTier("none"));
		expect(stored.fasterLiveRefresh).toBe(false);
		expect(stored.savantLinks).toBe(false);
	});

	it("S215 AC 4: isPatronTier accepts the five tiers exactly", () =>
	{
		for (const tier of PATRON_TIERS) expect(isPatronTier(tier)).toBe(true);
		for (const other of ["Gold", "backer", "", null, 3, "toString"]) expect(isPatronTier(other)).toBe(false);
	});

	it("S209 AC 9: statsProviderChoice from Backer up, for every tier", () =>
	{
		expect(PATRON_TIERS.map((tier) => [tier, entitlementsForTier(tier).statsProviderChoice])).toEqual([
			["none", false],
			["Backer", true],
			["Pro Backer", true],
			["Star Backer", true],
			["Premium Sponsor", true],
		]);
	});
});
