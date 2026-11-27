import {
	describe, expect, it,
} from "vitest";
import {
	effectiveEntitlements, entitlementsForTier, hasMinimumTier, isPatronTier, parsePatronTier, PATRON_TIERS,
} from "./entitlements.js";

describe("entitlements", () =>
{
	it("parses tier titles", () =>
	{
		expect(parsePatronTier("Pro Backer")).toBe("Pro Backer");
		expect(parsePatronTier("pro backer plus")).toBe("Pro Backer");
		expect(parsePatronTier(null)).toBe("none");
	});

	it("maps tier to capabilities", () =>
	{
		expect(entitlementsForTier("none").savantLinks).toBe(false);
		expect(entitlementsForTier("Backer").fasterLiveRefresh).toBe(true);
		expect(entitlementsForTier("Backer").savantLinks).toBe(false);
		expect(entitlementsForTier("Pro Backer").savantLinks).toBe(true);
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
		expect(effectiveEntitlements(real, null, true)).toBe(real);
		expect(effectiveEntitlements(real, null, false)).toBe(real);
	});

	it("S215 AC 1: any override when not allowed gives the real tier", () =>
	{
		for (const tier of PATRON_TIERS)
		{
			expect(effectiveEntitlements(real, tier, false)).toBe(real);
		}
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
