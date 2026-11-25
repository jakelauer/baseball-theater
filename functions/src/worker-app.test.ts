/**
 * S51 AC 3: the composition `pnpm dev` runs, on Postgres — here PGlite with the committed
 * migrations — serving the API and keeping what it serves in Postgres tables, accounts and
 * settings included. The Worker builds the same composition on `scopedDatabase`, which this
 * also exercises through `inDatabaseScope`.
 */
import { readFileSync } from "node:fs";
import {
	DEFAULT_SETTINGS, entitlementsForTier, MOCK_SIGN_IN_CREDENTIAL,
} from "@bt/domain";
import { sql } from "drizzle-orm";
import {
	afterEach, describe, expect, it, vi,
} from "vitest";
import {
	inDatabaseScope, scopedDatabase, withDatabase,
} from "./adapters/postgres/connect.js";
import { migratedPglite } from "./adapters/postgres/migrate.js";
import type { PostgresDb } from "./adapters/postgres/repos.js";
import { handleApiRequest } from "./handlers/api.js";
import { getOrRefreshGame, getOrRefreshSchedule } from "./services/ingest.js";
import { readScheduleDay } from "./services/game-state.js";
import { loadDevSeed, recordDevSeed } from "./services/dev-seed.js";
import { recordedClient } from "./test/recorded-mlb.js";
import { createManagementStandIn } from "./test/logto-management.js";
import {
	createTestTenant, TEST_LOGTO_APP_ID, TEST_LOGTO_ENDPOINT,
} from "./test/logto-tokens.js";
import type { WorkerEnv } from "./worker-app.js";
import {
	createWorkerApp, devSignInAllowed, edgePurgeFor, logtoAdmin, mockSignInAllowed, tierOverrideAllowed,
} from "./worker-app.js";
import { CloudflareEdgeCachePurger, NoopEdgeCachePurger } from "./adapters/cloudflare/edge-cache-purger.js";

async function count(db: PostgresDb, table: string): Promise<number>
{
	const result = await db.execute(sql.raw(`SELECT count(*)::int AS n FROM ${table}`));
	return (result as unknown as { rows: { n: number }[] }).rows[0]!.n;
}

describe("the Worker composition on Postgres (S51)", () =>
{
	it("PGlite: serves the schedule, a game and a signed-in account, and stores them in Postgres", async () =>
	{
		const { db } = await migratedPglite();
		// Local dev's composition: `dev:` sign-in is wired only there (S114 AC 7).
		const app = createWorkerApp({
			BT_LOCAL: "1",
		}, db);
		const get = (path: string, headers: Record<string, string> = {}) => handleApiRequest(new Request(`http://bt.test${path}`, {
			headers,
		}), app.context);

		expect((await get("/api/v1/schedule?date=2024-07-04")).status).toBe(200);
		expect((await get("/api/v1/games/744834")).status).toBe(200);
		const signedIn = {
			Authorization: "Bearer dev:test-user",
		};
		expect((await get("/api/v1/me", signedIn)).status).toBe(200);
		const put = await handleApiRequest(new Request("http://bt.test/api/v1/me/settings", {
			method: "PUT",
			headers: {
				...signedIn,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				...DEFAULT_SETTINGS,
				favoriteTeamIds: [121],
				version: 1,
			}),
		}), app.context);
		expect(put.status).toBe(200);

		expect(await count(db, "schedule_days")).toBe(1);
		expect(await count(db, "games")).toBeGreaterThan(0);
		expect(await count(db, "users")).toBe(1);
		expect(await count(db, "account_settings")).toBe(1);
	});

	it("PGlite: the isolate composition reads the database of the scope it runs in, and none outside one", async () =>
	{
		const { db } = await migratedPglite();
		const app = createWorkerApp({}, scopedDatabase);
		await expect(app.ingest.schedules.getByDate("2024-07-04")).rejects.toThrow(/no database in scope/);
		await expect(inDatabaseScope(undefined, () => app.ingest.schedules.getByDate("2024-07-04"))).rejects.toThrow(/HYPERDRIVE binding is missing/);
		const response = await withDatabase(db, () => inDatabaseScope(undefined, () => handleApiRequest(new Request("http://bt.test/api/v1/schedule?date=2024-07-04"), app.context)));
		expect(response.status).toBe(200);
		expect(await count(db, "schedule_days")).toBe(1);
	});
});

describe("the dev composition on a loaded dev seed (S112)", () =>
{
	afterEach(() =>
	{
		vi.restoreAllMocks();
	});

	it("S112 AC 3: a refresh-on-read of a seeded, final game and its day finds them current in the store, asking MLB nothing", async () =>
	{
		const { db } = await migratedPglite();
		const app = createWorkerApp({}, db);
		const { seed: recorded } = await recordDevSeed(recordedClient().mlb, {
			start: "2026-09-04",
			end: "2026-09-05",
		});
		// A real seed differs from the committed fixtures: it holds days they don't (here
		// 2026-09-04 lists 2026-09-05's games) and later recordings of games they do (823823
		// with one clip fewer). A refresh through the fixtures would replace both.
		const seed = {
			...recorded,
			days: recorded.days.map((d) => d.date === "2026-09-04" ? {
				...d,
				games: recorded.days[1]!.games,
			} : d),
			games: recorded.games.map((g) => ({
				...g,
				highlights: g.highlights.slice(1),
			})),
		};
		await loadDevSeed(app.ingest, seed);
		// The served day (S150 AC 6), as the day read answers it.
		const day = await readScheduleDay(app.ingest, "2026-09-05");
		const game = await app.ingest.games.getByPk(823823);
		expect(game?.status.codedGameState).toBe("F");

		const network = vi.spyOn(globalThis, "fetch");
		const refreshedGame = await getOrRefreshGame(app.ingest, 823823, {
			force: true,
		});
		const refreshedDay = await getOrRefreshSchedule(app.ingest, "2026-09-05", {
			force: true,
		});
		const seededOnly = await getOrRefreshSchedule(app.ingest, "2026-09-04", {
			force: true,
		});
		expect(network).not.toHaveBeenCalled();
		expect(refreshedGame?.version).toBe(game?.version);
		expect(refreshedGame?.plays).toEqual(game?.plays);
		expect(refreshedDay.version).toBe(day?.version);
		expect(refreshedDay.games).toEqual(day?.games);
		expect(seededOnly.games.length).toBeGreaterThan(0);
		expect(refreshedGame?.highlights).toEqual(game?.highlights);

		// Served through the API from the store, as `pnpm dev` would.
		const served = await handleApiRequest(new Request("http://bt.test/api/v1/games/823823"), app.context);
		expect(served.status).toBe(200);
		expect(network).not.toHaveBeenCalled();
	});
});

describe("Logto accounts in the Worker composition (S116)", () =>
{
	/** Signs in with a Logto ID token (`claims` over the stand-in's defaults), then deletes the account; answers the deletion's status and the user rows left. */
	async function signInAndDelete(env: WorkerEnv, claims: Record<string, unknown> = {})
	{
		const { db } = await migratedPglite();
		const tenant = await createTestTenant();
		const management = createManagementStandIn("tenant1");
		management.users.set("logto-user-1", {
			id: "logto-user-1",
			primaryEmail: "fan@example.test",
			isSuspended: false,
		});
		const app = createWorkerApp(env, db, {
			fetch: (input, init) => (input.startsWith(TEST_LOGTO_ENDPOINT) ? tenant.fetch(input) : management.fetch(input, init)),
		});
		const call = (path: string, init: RequestInit) => handleApiRequest(new Request(`http://bt.test${path}`, init), app.context);
		const signedIn = await call("/api/v1/sign-in", {
			method: "POST",
			body: JSON.stringify({
				idToken: await tenant.sign(claims),
			}),
		});
		const { token } = await signedIn.json() as { token: string };
		expect(signedIn.status).toBe(200);
		const deleted = await call("/api/v1/me/delete", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
			},
			body: JSON.stringify({
				phrase: "delete my account",
			}),
		});
		return {
			status: deleted.status,
			users: await count(db, "users"),
			links: await count(db, "identity_links"),
			management,
		};
	}

	const logtoVars: WorkerEnv = {
		LOGTO_ENDPOINT: TEST_LOGTO_ENDPOINT,
		LOGTO_APP_ID: TEST_LOGTO_APP_ID,
	};

	it("S116 AC 4: with production's machine-to-machine secret, deleting an account deletes its Logto account too", async () =>
	{
		const result = await signInAndDelete({
			...logtoVars,
			LOGTO_TENANT_ID: "tenant1",
			LOGTO_S2S_APP_ID: "m2m-app",
			LOGTO_S2S_SECRET: "m2m-secret",
		});
		expect(result.status).toBe(200);
		expect(result.users).toBe(0);
		expect(result.links).toBe(0);
		expect(result.management.users.has("logto-user-1")).toBe(false);
	});

	it("S116 AC 4: without the secret (staging) no Logto admin is composed, and deletion still removes every BT row", async () =>
	{
		expect(logtoAdmin(logtoVars)).toBeUndefined();
		expect(logtoAdmin({
			...logtoVars,
			LOGTO_TENANT_ID: "tenant1",
			LOGTO_S2S_APP_ID: "m2m-app",
		})).toBeUndefined();
		const result = await signInAndDelete(logtoVars);
		expect(result.status).toBe(200);
		expect(result.users).toBe(0);
		expect(result.links).toBe(0);
		// The test account in staging's own tenant is left alone; nothing called the Management API.
		expect(result.management.calls).toEqual([]);
	});

	it("S120 AC 1: re-trading a still-valid ID token whose sign-in is 11 minutes old, or one without auth_time, gets a session deletion refuses", async () =>
	{
		const elevenMinutesAgo = Math.floor(Date.now() / 1000) - 11 * 60;
		for (const claims of [{
			auth_time: elevenMinutesAgo,
			iat: elevenMinutesAgo,
		}, {
			auth_time: undefined,
		}])
		{
			const result = await signInAndDelete(logtoVars, claims);
			expect(result.status).toBe(403);
			expect(result.users).toBe(1);
			expect(result.links).toBe(1);
		}
		// A sign-in from just now (the stand-in's default auth_time) deletes, as S116 AC 4 shows.
		expect((await signInAndDelete(logtoVars)).status).toBe(200);
	});
});

describe("POST /api/v1/sign-in failures (S120)", () =>
{
	const logtoVars: WorkerEnv = {
		LOGTO_ENDPOINT: TEST_LOGTO_ENDPOINT,
		LOGTO_APP_ID: TEST_LOGTO_APP_ID,
	};

	afterEach(() =>
	{
		vi.restoreAllMocks();
	});

	it("S120 AC 4: answers 401 only for a refused credential, and 503 sign_in_failed when BT itself fails", async () =>
	{
		const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const tenant = await createTestTenant();
		const other = await createTestTenant();
		const { db, pglite } = await migratedPglite();
		let jwks: "up" | "error" | "unreachable" = "up";
		const app = createWorkerApp(logtoVars, db, {
			fetch: async (input) =>
			{
				if (jwks === "unreachable") throw new TypeError("fetch failed");
				return jwks === "error" ? new Response("unavailable", {
					status: 503,
				}) : tenant.fetch(input);
			},
		});
		const signIn = async (idToken: string) =>
		{
			const response = await handleApiRequest(new Request("http://bt.test/api/v1/sign-in", {
				method: "POST",
				body: JSON.stringify({
					idToken,
				}),
			}), app.context);
			return {
				status: response.status,
				body: await response.json() as unknown,
			};
		};
		const refused = {
			status: 401,
			body: {
				error: "sign_in_refused",
			},
		};
		const failed = {
			status: 503,
			body: {
				error: "sign_in_failed",
			},
		};

		// The tenant's keys can't be fetched: BT's failure, not the fan's.
		jwks = "error";
		expect(await signIn(await tenant.sign())).toEqual(failed);
		jwks = "unreachable";
		expect(await signIn(await tenant.sign())).toEqual(failed);

		// The credential itself: a forged signature, no email, malformed parts.
		jwks = "up";
		expect(await signIn(await other.sign())).toEqual(refused);
		expect(await signIn(await tenant.sign({
			email: undefined,
		}))).toEqual(refused);
		expect(await signIn("not-a-jwt")).toEqual(refused);
		expect(await signIn("%%%.%%%.%%%")).toEqual(refused);
		expect(await signIn("eyJhbGciOiJFUzM4NCJ9.e30.!!")).toEqual(refused);
		expect((await signIn(await tenant.sign())).status).toBe(200);

		// The database fails: 503 too.
		await pglite.close();
		expect(await signIn(await tenant.sign())).toEqual(failed);
		// Logged by error name only (ADR-028: no token, no account subject).
		expect(logged.mock.calls.every((call) => call.join(" ").startsWith("sign-in failed:"))).toBe(true);
		expect(logged).toHaveBeenCalledTimes(3);
	});
});

describe("staging's mock sign-in (S143)", () =>
{
	it("S143 AC 2: mockSignInAllowed is on with BT_MOCK_SIGN_IN \"1\" alone, and off without it, with any other value, or beside LOGTO_ENDPOINT or LOGTO_APP_ID (either one)", () =>
	{
		expect(mockSignInAllowed({
			BT_MOCK_SIGN_IN: "1",
		})).toBe(true);
		expect(mockSignInAllowed({})).toBe(false);
		for (const value of ["0", "true", "yes", "", " 1"])
		{
			expect(mockSignInAllowed({
				BT_MOCK_SIGN_IN: value,
			})).toBe(false);
		}
		// A whole tenant, or half of one: never the shared test account.
		expect(mockSignInAllowed({
			BT_MOCK_SIGN_IN: "1",
			LOGTO_ENDPOINT: TEST_LOGTO_ENDPOINT,
			LOGTO_APP_ID: TEST_LOGTO_APP_ID,
		})).toBe(false);
		expect(mockSignInAllowed({
			BT_MOCK_SIGN_IN: "1",
			LOGTO_ENDPOINT: TEST_LOGTO_ENDPOINT,
		})).toBe(false);
		expect(mockSignInAllowed({
			BT_MOCK_SIGN_IN: "1",
			LOGTO_APP_ID: TEST_LOGTO_APP_ID,
		})).toBe(false);
		// dev: sign-in stays local only, whatever the mock does (S114 AC 7).
		expect(devSignInAllowed({
			BT_MOCK_SIGN_IN: "1",
		})).toBe(false);
		expect(devSignInAllowed({
			BT_LOCAL: "1",
		})).toBe(true);
	});

	it("S143 AC 2: wrangler.jsonc sets BT_MOCK_SIGN_IN in env.staging's vars only, and env.staging names no Logto var", () =>
	{
		// Line comments only (the file has no block comments); a `//` inside a string isn't at a line's start.
		const wrangler = JSON.parse(readFileSync(new URL("../../wrangler.jsonc", import.meta.url), "utf8").replace(/^\s*\/\/.*$/gm, "")) as {
			vars?: Record<string, string>;
			env: Record<string, { vars?: Record<string, string> }>;
		};
		expect(wrangler.vars?.BT_MOCK_SIGN_IN).toBeUndefined();
		const staging = wrangler.env.staging?.vars ?? {};
		expect(staging.BT_MOCK_SIGN_IN).toBe("1");
		expect(Object.keys(staging).filter((k) => k.startsWith("LOGTO_"))).toEqual([]);
		expect(mockSignInAllowed(staging)).toBe(true);
		for (const [name, block] of Object.entries(wrangler.env))
		{
			if (name === "staging") continue;
			expect(JSON.stringify(block), `env.${name}`).not.toContain("BT_MOCK_SIGN_IN");
			expect(mockSignInAllowed(block.vars ?? {}), `env.${name}`).toBe(false);
		}
	});

	/** A composition on its own PGlite, and the sign-in route's answers. */
	async function signInRoute(env: WorkerEnv)
	{
		const { db } = await migratedPglite();
		const tenant = await createTestTenant();
		const app = createWorkerApp(env, db, {
			fetch: tenant.fetch,
		});
		const call = (path: string, init: RequestInit = {}) => handleApiRequest(new Request(`http://bt.test${path}`, init), app.context);
		return {
			db,
			config: async () => await (await call("/api/v1/sign-in")).json() as unknown,
			signIn: async (idToken: string) =>
			{
				const response = await call("/api/v1/sign-in", {
					method: "POST",
					body: JSON.stringify({
						idToken,
					}),
				});
				return {
					status: response.status,
					body: await response.json() as Record<string, unknown>,
				};
			},
			me: async (token: string) => await (await call("/api/v1/me", {
				headers: {
					Authorization: `Bearer ${token}`,
				},
			})).json() as { uid: string;
				email: string; },
		};
	}

	it("S143 AC 3: where the mock is wired, GET answers mock true and the credential signs in through signIn, creating the account once", async () =>
	{
		const route = await signInRoute({
			BT_MOCK_SIGN_IN: "1",
		});
		expect(await route.config()).toEqual({
			logto: null,
			mock: true,
		});
		const first = await route.signIn(MOCK_SIGN_IN_CREDENTIAL);
		expect(first.status).toBe(200);
		const token = first.body.token as string;
		expect(typeof token).toBe("string");
		const account = await route.me(token);
		expect(account.email).toBe("tester@stage.baseball.theater");
		expect(await count(route.db, "users")).toBe(1);
		expect(await count(route.db, "identity_links")).toBe(1);
		// The next sign-in finds the account the first one linked.
		const second = await route.signIn(MOCK_SIGN_IN_CREDENTIAL);
		expect(second.status).toBe(200);
		expect((await route.me(second.body.token as string)).uid).toBe(account.uid);
		expect(await count(route.db, "users")).toBe(1);
		// Any other credential is refused.
		expect(await route.signIn("dev:test-user")).toEqual({
			status: 401,
			body: {
				error: "sign_in_refused",
			},
		});
	});

	it("S143 AC 3: where the mock isn't wired, GET answers mock false, and the credential is refused (Logto) or unavailable (no provider)", async () =>
	{
		const logto = await signInRoute({
			BT_MOCK_SIGN_IN: "1",
			LOGTO_ENDPOINT: TEST_LOGTO_ENDPOINT,
			LOGTO_APP_ID: TEST_LOGTO_APP_ID,
		});
		expect(await logto.config()).toEqual({
			logto: {
				endpoint: TEST_LOGTO_ENDPOINT,
				appId: TEST_LOGTO_APP_ID,
			},
			mock: false,
		});
		expect(await logto.signIn(MOCK_SIGN_IN_CREDENTIAL)).toEqual({
			status: 401,
			body: {
				error: "sign_in_refused",
			},
		});
		for (const env of [{}, {
			BT_LOCAL: "1",
		}])
		{
			const none = await signInRoute(env);
			expect(await none.config()).toEqual({
				logto: null,
				mock: false,
			});
			expect(await none.signIn(MOCK_SIGN_IN_CREDENTIAL)).toEqual({
				status: 404,
				body: {
					error: "sign_in_unavailable",
				},
			});
		}
	});
});

/** `wrangler.jsonc`'s deployed envs' vars (line comments stripped, as S143's test reads it). */
function deployedVars(): { top: Record<string, string>;
	envs: Record<string, Record<string, string>> }
{
	const wrangler = JSON.parse(readFileSync(new URL("../../wrangler.jsonc", import.meta.url), "utf8").replace(/^\s*\/\/.*$/gm, "")) as {
		vars?: Record<string, string>;
		env: Record<string, { vars?: Record<string, string> }>;
	};
	return {
		top: wrangler.vars ?? {},
		envs: Object.fromEntries(Object.entries(wrangler.env).map(([name, block]) => [name, block.vars ?? {}])),
	};
}

describe("staging's backer tier override (S215)", () =>
{
	it("S215 AC 2: tierOverrideAllowed is true for staging's vars, false for production's (even with BT_TIER_OVERRIDE added), preview's, and staging's without the var", () =>
	{
		const { top, envs } = deployedVars();
		const {
			staging = {}, production = {}, preview = {},
		} = envs;
		expect(tierOverrideAllowed(staging)).toBe(true);
		expect(production.LOGTO_ENDPOINT).toBeTruthy();
		expect(tierOverrideAllowed({
			...production,
			BT_TIER_OVERRIDE: "1",
		})).toBe(false);
		expect(tierOverrideAllowed(preview)).toBe(false);
		const { BT_TIER_OVERRIDE: _var, ...withoutVar } = staging;
		expect(tierOverrideAllowed(withoutVar)).toBe(false);
		// Any value but "1" is off; and the local server's env, which sets neither var, is off.
		for (const value of ["0", "true", "", " 1"])
		{
			expect(tierOverrideAllowed({
				...staging,
				BT_TIER_OVERRIDE: value,
			})).toBe(false);
		}
		expect(tierOverrideAllowed({
			BT_LOCAL: "1",
		})).toBe(false);
		// Set in env.staging only.
		expect(top.BT_TIER_OVERRIDE).toBeUndefined();
		for (const [name, vars] of Object.entries(envs))
		{
			if (name !== "staging") expect(vars.BT_TIER_OVERRIDE, `env.${name}`).toBeUndefined();
		}
	});

	it("S215 AC 2: the composition wires the override only where tierOverrideAllowed says", async () =>
	{
		const { db } = await migratedPglite();
		const {
			envs: {
				staging = {}, production = {}, preview = {},
			},
		} = deployedVars();
		expect(createWorkerApp(staging, db).context.auth.tierOverrideAllowed).toBe(true);
		for (const vars of [production, preview, {
			BT_LOCAL: "1",
		}])
		{
			expect(createWorkerApp({
				...vars,
				BT_TIER_OVERRIDE: "1",
			}, db).context.auth.tierOverrideAllowed).toBeUndefined();
		}
	});

	it("S215 AC 1: under production's config, sign-in and GET /api/v1/me never ask for the stored override, and hand out the real tier", async () =>
	{
		const { db } = await migratedPglite();
		const tenant = await createTestTenant();
		const { envs: { production = {} } } = deployedVars();
		const app = createWorkerApp({
			...production,
			BT_TIER_OVERRIDE: "1",
			LOGTO_ENDPOINT: TEST_LOGTO_ENDPOINT,
			LOGTO_APP_ID: TEST_LOGTO_APP_ID,
		}, db, {
			fetch: tenant.fetch,
		});
		const users = app.context.auth.users;
		const spy = vi.spyOn(users, "getTierOverride");
		const call = (path: string, init: RequestInit = {}) => handleApiRequest(new Request(`http://bt.test${path}`, init), app.context);
		const signIn = async () => (await (await call("/api/v1/sign-in", {
			method: "POST",
			body: JSON.stringify({
				idToken: await tenant.sign({
					sub: "prod-fan",
				}),
			}),
		})).json() as { token: string }).token;
		const token = await signIn();
		const me = await (await call("/api/v1/me", {
			headers: {
				Authorization: `Bearer ${token}`,
			},
		})).json() as { uid: string;
			entitlements: unknown; };
		// Even a stored override row (seeded straight into the repository) is never read there.
		await users.setTierOverride(me.uid, "Premium Sponsor");
		const again = await signIn();
		const meAgain = await (await call("/api/v1/me", {
			headers: {
				Authorization: `Bearer ${again}`,
			},
		})).json() as { entitlements: unknown };
		expect(meAgain.entitlements).toEqual(entitlementsForTier("none"));
		expect((await app.context.auth.sessions.verify(again))?.entitlements).toEqual(entitlementsForTier("none"));
		// setTierOverride above is the test's own seeding; nothing on the read path asked for it.
		expect(spy).not.toHaveBeenCalled();
	});
});

describe("the edge purge in the Worker composition (S212 AC 4)", () =>
{
	const ALL = {
		BT_CF_PURGE_TOKEN: "token",
		BT_CF_ZONE_ID: "zone",
		BT_APP_ORIGIN: "https://stage.baseball.theater",
	};

	it("S212 AC 4 no-op: with either secret or BT_APP_ORIGIN missing the Worker purges nothing; with all three, by URL through Cloudflare", () =>
	{
		for (const missing of ["BT_CF_PURGE_TOKEN", "BT_CF_ZONE_ID", "BT_APP_ORIGIN"] as const)
		{
			const env: WorkerEnv = {
				...ALL,
			};
			delete env[missing];
			expect(edgePurgeFor(env).purger, missing).toBeInstanceOf(NoopEdgeCachePurger);
		}
		const edge = edgePurgeFor(ALL);
		expect(edge.purger).toBeInstanceOf(CloudflareEdgeCachePurger);
		expect(edge.origin).toBe("https://stage.baseball.theater");
	});
});
