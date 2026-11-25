/**
 * S215 AC 4 (Node): staging's backer tier override routes through the handler, on the memory
 * composition. Where `tierOverrideAllowed` isn't set (production, previews, local) both routes
 * answer 404 as an unknown route does; where it is, they read and set the override and hand out a
 * new session. The real Worker runs the same cases per deployed config in `worker.workerd.test.ts`.
 */
import { entitlementsForTier } from "@bt/domain";
import {
	describe, expect, it, vi,
} from "vitest";
import {
	createDevAccountData, createDevAuth, DEV_EMAIL,
} from "../adapters/fixtures/auth.js";
import { FixtureMlbStatsClient } from "../adapters/fixtures/mlb.js";
import {
	InMemoryGameProjectionRepository, InMemoryGameRepository, InMemorySettingsRepository, memoryScheduleStores,
} from "../adapters/memory/repos.js";
import type { AuthDeps } from "../services/accounts.js";
import { signIn } from "../services/accounts.js";
import type { ApiContext } from "./api.js";
import { handleApiRequest } from "./api.js";

/** A memory composition with the override allowed or not, a signed-in tester, and calls through the handler. */
async function harness(allowed: boolean)
{
	const auth: AuthDeps = {
		...createDevAuth(),
		...allowed && {
			tierOverrideAllowed: true,
		},
	};
	const settings = new InMemorySettingsRepository();
	const ctx: ApiContext = {
		ingest: {
			mlb: new FixtureMlbStatsClient(),
			...memoryScheduleStores(),
			games: new InMemoryGameRepository(),
			projections: new InMemoryGameProjectionRepository(),
		},
		auth,
		settings,
		account: createDevAccountData({
			users: auth.users,
			settings,
		}),
	};
	const { token, session } = await signIn(auth, {
		provider: "mock",
		subject: "tester",
		email: DEV_EMAIL,
		emailVerified: true,
	});
	const call = (path: string, init: RequestInit = {}) => handleApiRequest(new Request(`http://bt.test${path}`, init), ctx);
	const bearer = (t: string) => ({
		Authorization: `Bearer ${t}`,
	});
	return {
		auth,
		uid: session.uid,
		token,
		call,
		me: async (t: string) => (await (await call("/api/v1/me", {
			headers: bearer(t),
		})).json() as { entitlements: unknown }).entitlements,
		get: (t?: string) => call("/api/v1/me/tier-override", {
			headers: t ? bearer(t) : {},
		}),
		put: (t: string | undefined, body: string) => call("/api/v1/me/tier-override", {
			method: "PUT",
			headers: t ? bearer(t) : {},
			body,
		}),
	};
}

describe("the tier override routes (S215)", () =>
{
	it("S215 AC 4: not allowed: GET and PUT answer 404 as an unknown route does, no-store, and nothing is read or written", async () =>
	{
		const h = await harness(false);
		const read = vi.spyOn(h.auth.users, "getTierOverride");
		const write = vi.spyOn(h.auth.users, "setTierOverride");
		const unknownResponse = await h.call("/api/v1/me/no-such-route");
		const unknownHeaders = [...unknownResponse.headers];
		const unknown = await unknownResponse.json();
		for (const res of [await h.get(h.token), await h.put(h.token, JSON.stringify({
			tier: "Backer",
		})), await h.get()])
		{
			expect(res.status).toBe(404);
			expect(await res.json()).toEqual(unknown);
			// The same headers too, so nothing tells the route apart from one that doesn't exist.
			expect([...res.headers]).toEqual(unknownHeaders);
			expect(res.headers.get("Cache-Control")).toBe("no-store");
		}
		expect(await h.me(h.token)).toEqual(entitlementsForTier("none"));
		expect(read).not.toHaveBeenCalled();
		expect(write).not.toHaveBeenCalled();
	});

	it("S215 AC 4: allowed: GET answers the choice and the real tier; PUT stores it, answers a new session with it, and /me reads it; null goes back", async () =>
	{
		const h = await harness(true);
		const realWrite = vi.spyOn(h.auth.users, "setEntitlements");
		expect(await (await h.get(h.token)).json()).toEqual({
			tier: null,
			realTier: "none",
		});
		const set = await h.put(h.token, JSON.stringify({
			tier: "Premium Sponsor",
		}));
		expect(set.status).toBe(200);
		expect(set.headers.get("Cache-Control")).toBe("no-store");
		const answer = await set.json() as { tier: string;
			realTier: string;
			token: string; };
		expect(answer.tier).toBe("Premium Sponsor");
		expect(answer.realTier).toBe("none");
		expect((await h.auth.sessions.verify(answer.token))?.entitlements).toEqual(entitlementsForTier("Premium Sponsor"));
		expect(await h.me(answer.token)).toEqual(entitlementsForTier("Premium Sponsor"));
		// The real tier is never written.
		expect((await h.auth.users.getByUid(h.uid))?.entitlements).toEqual(entitlementsForTier("none"));
		expect(realWrite).not.toHaveBeenCalled();

		const none = await (await h.put(h.token, JSON.stringify({
			tier: "none",
		}))).json() as { tier: string };
		expect(none.tier).toBe("none");
		const back = await (await h.put(h.token, JSON.stringify({
			tier: null,
		}))).json() as { tier: null;
			token: string; };
		expect(back.tier).toBeNull();
		expect(await h.me(back.token)).toEqual(entitlementsForTier("none"));
	});

	it("S215 AC 4: allowed: a body that isn't { tier } with a tier or null is 400 invalid_tier; signed out is 401; all no-store", async () =>
	{
		const h = await harness(true);
		for (const body of [JSON.stringify({
			tier: "Gold",
		}), JSON.stringify({}), JSON.stringify("Backer"), "not json", JSON.stringify({
			tier: 2,
		})])
		{
			const res = await h.put(h.token, body);
			expect(res.status).toBe(400);
			expect(await res.json()).toMatchObject({
				error: "invalid_tier",
			});
			expect(res.headers.get("Cache-Control")).toBe("no-store");
		}
		expect(await h.auth.users.getTierOverride(h.uid)).toBeNull();
		for (const res of [await h.get(), await h.put(undefined, JSON.stringify({
			tier: "Backer",
		})), await h.get("not-a-session")])
		{
			expect(res.status).toBe(401);
			expect(res.headers.get("Cache-Control")).toBe("no-store");
		}
	});

	it("S215 AC 1: a sign-in where the override is allowed carries the stored choice; where it isn't, the real tier with no read", async () =>
	{
		const allowed = await harness(true);
		await allowed.auth.users.setTierOverride(allowed.uid, "Pro Backer");
		const again = await signIn(allowed.auth, {
			provider: "mock",
			subject: "tester",
			email: DEV_EMAIL,
			emailVerified: true,
		});
		expect(again.session.entitlements).toEqual(entitlementsForTier("Pro Backer"));

		const refused = await harness(false);
		await refused.auth.users.setTierOverride(refused.uid, "Pro Backer");
		const read = vi.spyOn(refused.auth.users, "getTierOverride");
		const real = await signIn(refused.auth, {
			provider: "mock",
			subject: "tester",
			email: DEV_EMAIL,
			emailVerified: true,
		});
		expect(real.session.entitlements).toEqual(entitlementsForTier("none"));
		expect(await refused.me(real.token)).toEqual(entitlementsForTier("none"));
		expect(read).not.toHaveBeenCalled();
	});
});
