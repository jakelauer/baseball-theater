/**
 * `GET` / `PUT /api/v1/me/settings` over a real HTTP server (S6, ADR-027):
 * settings live on the account, writes apply only if newer (ADR-022), and a
 * deleted user's still-valid session can't read or write them (ADR-028).
 */
import { createServer } from "node:http";
import type { AccountSettings } from "@bt/domain";
import {
	ACCOUNT_DELETION_PHRASE, DEFAULT_SETTINGS, entitlementsForTier,
} from "@bt/domain";
import type { Entitlements, PatronTier } from "@bt/domain";
import {
	describe, expect, it,
} from "vitest";
import {
	createDevAccountData, createDevAuth, DEV_EMAIL,
} from "../adapters/fixtures/auth.js";
import { FixtureMlbStatsClient } from "../adapters/fixtures/mlb.js";
import {
	InMemoryGameProjectionRepository, InMemoryGameRepository, InMemorySettingsRepository, memoryScheduleStores,
} from "../adapters/memory/repos.js";
import { toNodeListener } from "../adapters/node/http.js";
import { signIn } from "../services/accounts.js";
import { handleApiRequest, type ApiContext } from "./api.js";

const DEV = "Bearer dev:test-user";

async function withServer(run: (base: string, ctx: ApiContext) => Promise<void>): Promise<void>
{
	const auth = createDevAuth();
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
	const server = createServer(toNodeListener((request) => handleApiRequest(request, ctx)));
	// On 127.0.0.1, where the requests go, so another process listening on this port elsewhere can't answer them (#116).
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const addr = server.address();
	if (!addr || typeof addr === "string") throw new Error("no port");
	try
	{
		await run(`http://127.0.0.1:${addr.port}`, ctx);
	}
	finally
	{
		await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
	}
}

function put(base: string, body: unknown, authorization = DEV): Promise<Response>
{
	return fetch(`${base}/api/v1/me/settings`, {
		method: "PUT",
		headers: {
			Authorization: authorization,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(body),
	});
}

function get(base: string, authorization = DEV): Promise<Response>
{
	return fetch(`${base}/api/v1/me/settings`, {
		headers: {
			Authorization: authorization,
		},
	});
}

const saved: AccountSettings = {
	favoriteTeamIds: [147, 111],
	opensFirst: "live",
	gameRowSlot: "status",
	collapseNonFavorites: false,
	hideScores: false,
	videoPlayer: "dialog",
	statsProvider: "mlb",
	version: 2,
};

describe("/api/v1/me/settings", () =>
{
	it("is 401 signed out on GET and PUT", async () =>
	{
		await withServer(async (base) =>
		{
			expect((await fetch(`${base}/api/v1/me/settings`)).status).toBe(401);
			expect((await put(base, saved, "")).status).toBe(401);
		});
	});

	it("round-trips a PUT then GET for dev:test-user, starting from the house defaults", async () =>
	{
		await withServer(async (base) =>
		{
			expect(await (await get(base)).json()).toEqual(DEFAULT_SETTINGS);
			const res = await put(base, saved);
			expect(res.status).toBe(200);
			expect(await res.json()).toEqual(saved);
			expect(await (await get(base)).json()).toEqual(saved);
		});
	});

	it("ignores a PUT with an older version (apply-if-newer) and answers with what is stored", async () =>
	{
		await withServer(async (base) =>
		{
			await put(base, saved);
			const stale = await put(base, {
				favoriteTeamIds: [],
				opensFirst: "box",
				version: 1,
			});
			expect(await stale.json()).toEqual(saved);
			expect(await (await get(base)).json()).toEqual(saved);
		});
	});

	it("rejects a body that isn't a settings document (400)", async () =>
	{
		await withServer(async (base) =>
		{
			const res = await put(base, {
				...saved,
				opensFirst: "plays",
			});
			expect(res.status).toBe(400);
		});
	});

	it("is 401 on both for a validly signed session whose account was deleted, and writes nothing back", async () =>
	{
		await withServer(async (base, ctx) =>
		{
			const { token } = await signIn(ctx.auth, {
				provider: "dev",
				subject: "fan-1",
				email: DEV_EMAIL,
				emailVerified: true,
				authTime: Math.floor(Date.now() / 1000),
			}, () => "fan-1");
			const bearer = `Bearer ${token}`;
			await put(base, saved, bearer);
			const deleted = await fetch(`${base}/api/v1/me/delete`, {
				method: "POST",
				headers: {
					Authorization: bearer,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					phrase: ACCOUNT_DELETION_PHRASE,
				}),
			});
			expect(deleted.status).toBe(200);

			expect((await get(base, bearer)).status).toBe(401);
			expect((await put(base, {
				...saved,
				version: 3,
			}, bearer)).status).toBe(401);
			expect(await ctx.settings.get("fan-1")).toBeNull();
		});
	});
});

describe("the stats site is a patron's choice (S209 AC 9)", () =>
{
	/** Signs `uid` in, gives the account `tier`, and answers a bearer for a session carrying `entitlements` (default: the tier's). */
	async function account(ctx: ApiContext, uid: string, tier: PatronTier, entitlements?: Entitlements): Promise<string>
	{
		await signIn(ctx.auth, {
			provider: "dev",
			subject: uid,
			email: `${uid}@example.test`,
			emailVerified: true,
			authTime: Math.floor(Date.now() / 1000),
		}, () => uid);
		await ctx.auth.users.setEntitlements(uid, entitlementsForTier(tier));
		const token = await ctx.auth.sessions.issue({
			uid,
			role: "member",
			entitlements: entitlements ?? entitlementsForTier(tier),
		});
		return `Bearer ${token}`;
	}

	it("S209 AC 9: a member choosing FanGraphs is refused with the settings route's error, and nothing is stored", async () =>
	{
		await withServer(async (base, ctx) =>
		{
			const bearer = await account(ctx, "member-1", "none");
			const refused = await put(base, {
				...DEFAULT_SETTINGS,
				statsProvider: "fangraphs",
				version: 1,
			}, bearer);
			expect(refused.status).toBe(400);
			expect(await refused.json()).toMatchObject({
				error: "invalid_settings",
			});
			expect(await ctx.settings.get("member-1")).toBeNull();
			// MLB.com stays open to everyone.
			expect((await put(base, {
				...DEFAULT_SETTINGS,
				hideScores: true,
				version: 1,
			}, bearer)).status).toBe(200);
		});
	});

	it("S209 AC 9: a token signed with pre-S209 entitlements for a Backer choosing FanGraphs is answered 200", async () =>
	{
		await withServer(async (base, ctx) =>
		{
			const { statsProviderChoice: _new, ...before } = entitlementsForTier("Backer");
			const bearer = await account(ctx, "backer-1", "Backer", before as Entitlements);
			const saved = await put(base, {
				...DEFAULT_SETTINGS,
				statsProvider: "fangraphs",
				version: 1,
			}, bearer);
			expect(saved.status).toBe(200);
			expect((await saved.json() as AccountSettings).statsProvider).toBe("fangraphs");
		});
	});

	it("S209 AC 9: a lapsed patron whose stored value is FanGraphs saves a Hide Scores change and keeps FanGraphs", async () =>
	{
		await withServer(async (base, ctx) =>
		{
			const bearer = await account(ctx, "lapsed-1", "Backer");
			expect((await put(base, {
				...DEFAULT_SETTINGS,
				statsProvider: "fangraphs",
				version: 1,
			}, bearer)).status).toBe(200);
			await ctx.auth.users.setEntitlements("lapsed-1", entitlementsForTier("none"));
			const saved = await put(base, {
				...DEFAULT_SETTINGS,
				statsProvider: "fangraphs",
				hideScores: true,
				version: 2,
			}, bearer);
			expect(saved.status).toBe(200);
			expect(await ctx.settings.get("lapsed-1")).toMatchObject({
				statsProvider: "fangraphs",
				hideScores: true,
			});
			// Changing it to another patron site is a change, and refused.
			expect((await put(base, {
				...DEFAULT_SETTINGS,
				statsProvider: "bbref",
				version: 3,
			}, bearer)).status).toBe(400);
		});
	});
});
