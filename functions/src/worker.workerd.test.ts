/**
 * S45: the API inside workerd — the runtime production uses — through the real Worker
 * entry and its composition, serving the bundled fixtures (no `node:fs`, no network).
 * S114 AC 7: deployed (no `BT_LOCAL`), the same composition refuses a `dev:` sign-in.
 * S116 AC 2: where the vars name a Logto tenant, a Logto ID token signs in through
 * `POST /api/v1/sign-in` (the tenant is a stand-in serving a locally made key).
 * S143 AC 4: with `BT_MOCK_SIGN_IN=1` (staging), the mock credential signs in as the shared test
 * account and the whole account API works behind it, deletion included.
 * S139 AC 8: the standings' season calendars are kept in the Workers Cache between requests.
 * S132 AC 3: the releases API answers the release notes bundled into the build.
 * S215 AC 4: staging's backer tier override answers only under staging's config; production's
 * answers 404 and hands out the real tier even with an override stored, and preview's answers 404.
 * S220 AC 1: a cron tick (`scheduled()`) writes one round-trip line per job, kind `cron`.
 * Run with `pnpm --filter @bt/functions test:workerd`.
 */
import {
	createExecutionContext, env, SELF, waitOnExecutionContext,
} from "cloudflare:test";
import {
	DEFAULT_SETTINGS, entitlementsForTier, MOCK_SIGN_IN_CREDENTIAL,
} from "@bt/domain";
import {
	describe, expect, it, vi,
} from "vitest";
import type { WorkersCacheLike } from "./adapters/cached-season-calendars.js";
import { seasonCalendarCacheKey } from "./adapters/cached-season-calendars.js";
import { inDatabaseScope, scopedDatabase } from "./adapters/postgres/connect.js";
import { handleApiRequest } from "./handlers/api.js";
import { RELEASES_CACHE_CONTROL } from "./handlers/cache-control.js";
import { BUNDLED_RELEASE_NOTES, getReleases } from "./services/releases.js";
import {
	createTestTenant, TEST_LOGTO_APP_ID, TEST_LOGTO_ENDPOINT,
} from "./test/logto-tokens.js";
import { createWorkerApp } from "./worker-app.js";
import type { WorkerEnv } from "./worker-app.js";
import worker from "./worker.js";

describe("the Worker on workerd (S45)", () =>
{
	it("GET /api/v1/schedule?date=2024-07-04 is 200 with the fixture day", async () =>
	{
		const res = await SELF.fetch("http://bt.test/api/v1/schedule?date=2024-07-04");
		expect(res.status).toBe(200);
		const day = await res.json() as { date: string;
			games: unknown[]; };
		expect(day.date).toBe("2024-07-04");
		expect(day.games.length).toBeGreaterThan(0);
	});

	it("S132 AC 3 worker: GET /api/v1/releases is 200 with the notes bundled into the build, read from no file system", async () =>
	{
		const res = await SELF.fetch("http://bt.test/api/v1/releases");
		expect(res.status).toBe(200);
		expect(res.headers.get("Cache-Control")).toBe(RELEASES_CACHE_CONTROL);
		expect(await res.json()).toEqual(getReleases(BUNDLED_RELEASE_NOTES));
	});

	it("GET /api/v1/games/744834 is 200 with the fixture game", async () =>
	{
		const res = await SELF.fetch("http://bt.test/api/v1/games/744834");
		expect(res.status).toBe(200);
		const game = await res.json() as { gamePk: number };
		expect(game.gamePk).toBe(744834);
	});
});

describe("the standings' calendars in the Workers Cache (S139)", () =>
{
	it("S139 AC 8: standings calendars come from the Workers Cache on the second request", async () =>
	{
		// workerd's `caches.default`, which this package's types don't declare.
		const cache = (globalThis as unknown as { caches: { default: WorkersCacheLike } }).caches.default;
		const first = await SELF.fetch("http://bt.test/api/v1/standings?date=2026-09-05");
		expect(first.status).toBe(200);
		const kept = await cache.match(seasonCalendarCacheKey(2026));
		expect(kept).toBeDefined();
		const { calendar } = await kept!.json() as { calendar: { springStartDate: string } };
		expect(calendar.springStartDate).toBe("2026-02-20");

		// Change what the cache holds: the next request's spring dates can only come from it, not from MLB's recording.
		await cache.put(seasonCalendarCacheKey(2026), new Response(JSON.stringify({
			calendar: {
				...calendar,
				springStartDate: "2026-02-01",
			},
		}), {
			headers: {
				"cache-control": "max-age=3600",
			},
		}));
		const second = await SELF.fetch("http://bt.test/api/v1/standings?date=2026-07-01&includePhases=regularSeason");
		expect(second.status).toBe(200);
		expect(((await second.json()) as { phases: { spring: { startDate: string } } }).phases.spring.startDate).toBe("2026-02-01");
	});
});

describe("dev sign-in on deployed Workers (S114)", () =>
{
	// Each app is the Worker's own composition on its own env: the shared `workerApp` is built once
	// per isolate from the test pool's env, which sets BT_LOCAL like `pnpm dev`.
	const meAs = async (workerEnv: WorkerEnv) =>
	{
		const app = createWorkerApp(workerEnv, scopedDatabase);
		const res = await inDatabaseScope(workerEnv.HYPERDRIVE, () => handleApiRequest(new Request("http://bt.test/api/v1/me", {
			headers: {
				Authorization: "Bearer dev:test-user",
			},
		}), app.context));
		return res.status;
	};

	it("S114 AC 7: Bearer dev:test-user is refused without BT_LOCAL and accepted with it", async () =>
	{
		const { BT_LOCAL: _local, ...deployed } = env as unknown as WorkerEnv;
		expect(await meAs(deployed)).toBe(401);
		expect(await meAs({
			...deployed,
			BT_LOCAL: "1",
		})).toBe(200);
	});
});

describe("Logto sign-in on deployed Workers (S116)", () =>
{
	it("S116 AC 2: a Logto ID token signs in through POST /api/v1/sign-in for BT's own session, and a dev: token is refused", async () =>
	{
		const tenant = await createTestTenant();
		const { BT_LOCAL: _local, ...deployed } = env as unknown as WorkerEnv;
		const workerEnv: WorkerEnv = {
			...deployed,
			LOGTO_ENDPOINT: TEST_LOGTO_ENDPOINT,
			LOGTO_APP_ID: TEST_LOGTO_APP_ID,
		};
		const app = createWorkerApp(workerEnv, scopedDatabase, {
			fetch: tenant.fetch,
		});
		const call = (path: string, init: RequestInit = {}) => inDatabaseScope(workerEnv.HYPERDRIVE, () => handleApiRequest(new Request(`http://bt.test${path}`, init), app.context));
		const signIn = (idToken: string) => call("/api/v1/sign-in", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				idToken,
			}),
		});

		// The web app reads the tenant and app from the Worker, not a copy of its own.
		expect(await (await call("/api/v1/sign-in")).json()).toEqual({
			logto: {
				endpoint: TEST_LOGTO_ENDPOINT,
				appId: TEST_LOGTO_APP_ID,
			},
			mock: false,
		});

		const subject = `logto-${crypto.randomUUID()}`;
		const res = await signIn(await tenant.sign({
			sub: subject,
		}));
		expect(res.status).toBe(200);
		const { token } = await res.json() as { token: string };
		expect(token.startsWith("dev:")).toBe(false);
		const me = await call("/api/v1/me", {
			headers: {
				Authorization: `Bearer ${token}`,
			},
		});
		expect(me.status).toBe(200);
		expect(await me.json()).toMatchObject({
			email: "fan@example.test",
		});

		// A dev: token is neither a Logto ID token nor, deployed, a session.
		expect((await signIn("dev:test-user")).status).toBe(401);
		expect((await call("/api/v1/me", {
			headers: {
				Authorization: "Bearer dev:test-user",
			},
		})).status).toBe(401);
		expect((await signIn(await tenant.sign({
			aud: "another-app",
		}))).status).toBe(401);
		expect((await call("/api/v1/sign-in", {
			method: "POST",
			body: "{}",
		})).status).toBe(400);
	});

	it("S116 AC 2: without Logto vars there is no Logto sign-in (local dev, previews)", async () =>
	{
		const workerEnv = env as unknown as WorkerEnv;
		const app = createWorkerApp(workerEnv, scopedDatabase);
		const call = (path: string, init: RequestInit = {}) => inDatabaseScope(workerEnv.HYPERDRIVE, () => handleApiRequest(new Request(`http://bt.test${path}`, init), app.context));
		expect(await (await call("/api/v1/sign-in")).json()).toEqual({
			logto: null,
			mock: false,
		});
		expect((await call("/api/v1/sign-in", {
			method: "POST",
			body: JSON.stringify({
				idToken: "dev:test-user",
			}),
		})).status).toBe(404);
	});
});

describe("staging's mock sign-in on deployed Workers (S143)", () =>
{
	/** The Worker's own composition on `workerEnv` (deployed: no BT_LOCAL), and calls through it. */
	function deployedApp(workerEnv: WorkerEnv)
	{
		const app = createWorkerApp(workerEnv, scopedDatabase);
		const call = (path: string, init: RequestInit = {}) => inDatabaseScope(workerEnv.HYPERDRIVE, () => handleApiRequest(new Request(`http://bt.test${path}`, init), app.context));
		const auth = (token: string) => ({
			Authorization: `Bearer ${token}`,
		});
		return {
			signIn: (idToken: string) => call("/api/v1/sign-in", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					idToken,
				}),
			}),
			token: async (res: Response) =>
			{
				expect(res.status).toBe(200);
				return (await res.json() as { token: string }).token;
			},
			me: (token: string) => call("/api/v1/me", {
				headers: auth(token),
			}),
			settings: async (token: string) => await (await call("/api/v1/me/settings", {
				headers: auth(token),
			})).json() as unknown,
			putSettings: (token: string, body: unknown) => call("/api/v1/me/settings", {
				method: "PUT",
				headers: {
					...auth(token),
					"Content-Type": "application/json",
				},
				body: JSON.stringify(body),
			}),
			deleteAccount: (token: string) => call("/api/v1/me/delete", {
				method: "POST",
				headers: auth(token),
				body: JSON.stringify({
					phrase: "delete my account",
				}),
			}),
		};
	}

	const { BT_LOCAL: _local, ...deployed } = env as unknown as WorkerEnv;

	it("S143 AC 4: with BT_MOCK_SIGN_IN=1 the mock signs in, and /me, settings, a second sign-in and deletion all work behind it", async () =>
	{
		const app = deployedApp({
			...deployed,
			BT_MOCK_SIGN_IN: "1",
		});
		const token = await app.token(await app.signIn(MOCK_SIGN_IN_CREDENTIAL));
		const me = await app.me(token);
		expect(me.status).toBe(200);
		const account = await me.json() as { uid: string;
			email: string; };
		expect(account.email).toBe("tester@stage.baseball.theater");

		const saved = {
			...DEFAULT_SETTINGS,
			favoriteTeamIds: [121],
			hideScores: true,
			version: 1,
		};
		expect((await app.putSettings(token, saved)).status).toBe(200);
		expect(await app.settings(token)).toEqual(saved);

		// A second sign-in is the same account, with its saved settings.
		const again = await app.token(await app.signIn(MOCK_SIGN_IN_CREDENTIAL));
		expect(await (await app.me(again)).json()).toMatchObject({
			uid: account.uid,
		});
		expect(await app.settings(again)).toEqual(saved);

		// No Logto admin is wired, and deletion doesn't need one (S116 AC 4).
		expect((await app.deleteAccount(again)).status).toBe(200);
		expect((await app.me(again)).status).toBe(401);

		// The next sign-in makes a new account, with the house defaults.
		const fresh = await app.token(await app.signIn(MOCK_SIGN_IN_CREDENTIAL));
		const next = await (await app.me(fresh)).json() as { uid: string };
		expect(next.uid).not.toBe(account.uid);
		expect(await app.settings(fresh)).toEqual(DEFAULT_SETTINGS);

		// The mock never makes dev: sign-in work on a deployed Worker (S114 AC 7).
		expect((await app.me("dev:test-user")).status).toBe(401);
		expect((await app.signIn("dev:test-user")).status).toBe(401);
	});

	it("S143 AC 4: without BT_MOCK_SIGN_IN the mock credential is refused, and dev:test-user with it", async () =>
	{
		const app = deployedApp(deployed);
		expect((await app.signIn(MOCK_SIGN_IN_CREDENTIAL)).status).toBe(404);
		expect((await app.me("dev:test-user")).status).toBe(401);
	});
});

describe("staging's backer tier override on deployed Workers (S215)", () =>
{
	const { BT_LOCAL: _local, ...deployed } = env as unknown as WorkerEnv;

	/** The Worker's own composition on `workerEnv`, and calls through it. */
	function overrideApp(workerEnv: WorkerEnv, fetcher?: (input: string, init?: RequestInit) => Promise<Response>)
	{
		const app = createWorkerApp(workerEnv, scopedDatabase, fetcher ? {
			fetch: fetcher,
		} : {});
		const call = (path: string, init: RequestInit = {}) => inDatabaseScope(workerEnv.HYPERDRIVE, () => handleApiRequest(new Request(`http://bt.test${path}`, init), app.context));
		const auth = (token: string) => ({
			Authorization: `Bearer ${token}`,
		});
		return {
			app,
			inScope: <T>(run: () => Promise<T>) => inDatabaseScope(workerEnv.HYPERDRIVE, run),
			signIn: async (idToken: string) => (await (await call("/api/v1/sign-in", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					idToken,
				}),
			})).json() as { token: string }).token,
			me: async (token: string) => await (await call("/api/v1/me", {
				headers: auth(token),
			})).json() as { uid: string;
				entitlements: unknown; },
			get: (token?: string) => call("/api/v1/me/tier-override", {
				headers: token ? auth(token) : {},
			}),
			put: (token: string | undefined, body: unknown) => call("/api/v1/me/tier-override", {
				method: "PUT",
				headers: {
					...token ? auth(token) : {},
					"Content-Type": "application/json",
				},
				body: JSON.stringify(body),
			}),
			unknown: () => call("/api/v1/me/no-such-route"),
		};
	}

	it("S215 AC 4: production's config: GET and PUT answer 404 as an unknown route does, no-store, and a stored override is never handed out", async () =>
	{
		const tenant = await createTestTenant();
		const route = overrideApp({
			...deployed,
			LOGTO_ENDPOINT: TEST_LOGTO_ENDPOINT,
			LOGTO_APP_ID: TEST_LOGTO_APP_ID,
			BT_TIER_OVERRIDE: "1",
		}, tenant.fetch);
		const sub = `logto-${crypto.randomUUID()}`;
		const token = await route.signIn(await tenant.sign({
			sub,
		}));
		const unknown = await route.unknown();
		const unknownHeaders = [...unknown.headers];
		const unknownBody = await unknown.json();
		for (const res of [await route.get(token), await route.put(token, {
			tier: "Star Backer",
		}), await route.get()])
		{
			expect(res.status).toBe(404);
			expect(await res.json()).toEqual(unknownBody);
			expect([...res.headers]).toEqual(unknownHeaders);
			expect(res.headers.get("Cache-Control")).toBe("no-store");
		}
		// The mock sign-in var copied beside production's Logto tenant still offers no override.
		expect(overrideApp({
			...deployed,
			LOGTO_ENDPOINT: TEST_LOGTO_ENDPOINT,
			LOGTO_APP_ID: TEST_LOGTO_APP_ID,
			BT_MOCK_SIGN_IN: "1",
			BT_TIER_OVERRIDE: "1",
		}).app.context.auth.tierOverrideAllowed).toBeUndefined();
		// An override row seeded straight into the repository changes nothing there.
		const { uid } = await route.me(token);
		await route.inScope(() => route.app.context.auth.users.setTierOverride(uid, "Premium Sponsor"));
		expect((await route.me(token)).entitlements).toEqual(entitlementsForTier("none"));
		const fresh = await route.signIn(await tenant.sign({
			sub,
		}));
		expect((await route.app.context.auth.sessions.verify(fresh))?.entitlements).toEqual(entitlementsForTier("none"));
		expect((await route.me(fresh)).entitlements).toEqual(entitlementsForTier("none"));
	});

	it("S215 AC 4: staging's config: PUT a tier, /me and the new session carry it, null goes back, a non-tier is 400, signed out is 401, all no-store", async () =>
	{
		const route = overrideApp({
			...deployed,
			BT_MOCK_SIGN_IN: "1",
			BT_TIER_OVERRIDE: "1",
		});
		const token = await route.signIn(MOCK_SIGN_IN_CREDENTIAL);
		const real = (await route.me(token)).entitlements as { tier: string };

		const initial = await route.get(token);
		expect(initial.status).toBe(200);
		expect(initial.headers.get("Cache-Control")).toBe("no-store");
		expect(await initial.json()).toEqual({
			tier: null,
			realTier: real.tier,
		});

		const set = await route.put(token, {
			tier: "Star Backer",
		});
		expect(set.status).toBe(200);
		expect(set.headers.get("Cache-Control")).toBe("no-store");
		const answer = await set.json() as { tier: string;
			realTier: string;
			token: string; };
		expect(answer).toMatchObject({
			tier: "Star Backer",
			realTier: real.tier,
		});
		expect((await route.me(token)).entitlements).toEqual(entitlementsForTier("Star Backer"));
		expect((await route.app.context.auth.sessions.verify(answer.token))?.entitlements).toEqual(entitlementsForTier("Star Backer"));
		// A fresh sign-in carries it too.
		const again = await route.signIn(MOCK_SIGN_IN_CREDENTIAL);
		expect((await route.app.context.auth.sessions.verify(again))?.entitlements).toEqual(entitlementsForTier("Star Backer"));

		const back = await route.put(token, {
			tier: null,
		});
		expect(back.status).toBe(200);
		const backAnswer = await back.json() as { tier: null;
			token: string; };
		expect(backAnswer.tier).toBeNull();
		expect((await route.me(token)).entitlements).toEqual(real);
		expect((await route.app.context.auth.sessions.verify(backAnswer.token))?.entitlements).toEqual(real);

		for (const body of [{
			tier: "Gold",
		}, {}, "Backer"])
		{
			const bad = await route.put(token, body);
			expect(bad.status).toBe(400);
			expect(await bad.json()).toMatchObject({
				error: "invalid_tier",
			});
			expect(bad.headers.get("Cache-Control")).toBe("no-store");
		}
		for (const res of [await route.get(), await route.put(undefined, {
			tier: "Backer",
		})])
		{
			expect(res.status).toBe(401);
			expect(res.headers.get("Cache-Control")).toBe("no-store");
		}
	});

	it("S215 AC 4: preview's config: GET and PUT answer 404, no-store", async () =>
	{
		const route = overrideApp({
			...deployed,
			BT_TIER_OVERRIDE: "1",
		});
		for (const res of [await route.get("any"), await route.put("any", {
			tier: "Backer",
		})])
		{
			expect(res.status).toBe(404);
			expect(res.headers.get("Cache-Control")).toBe("no-store");
		}
	});
});

describe("the cron's round-trip lines (S220)", () =>
{
	it("S220 AC 1 a scheduled() tick writes one line per job, kind cron, each naming its job", async () =>
	{
		const ctx = createExecutionContext();
		const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
		try
		{
			// BT_LOCAL is set as in `pnpm dev`, so the tick runs only with BT_INGEST_TICK (`tickAllowed`). The tick runs
			// inside one unlabelled scope, so its four jobs share one connection: the test PGlite's socket server
			// multiplexes connections onto one database and can't interleave four at once. Each job's scope still
			// measures and logs itself, as when it opens its own connection on Cloudflare.
			const workerEnv = env as unknown as WorkerEnv;
			await inDatabaseScope(workerEnv.HYPERDRIVE, async () =>
			{
				await worker.scheduled(undefined, {
					...workerEnv,
					BT_INGEST_TICK: "1",
				}, ctx);
				await waitOnExecutionContext(ctx);
			});
			const lines = log.mock.calls.map(([line]) => line as Record<string, unknown>).filter((line) => line?.event === "db-round-trips" && line.kind === "cron");
			expect(lines.map((line) => line.job).sort()).toEqual(["edge-purge-retry", "game-recheck", "ingest-start", "month-refresh"]);
			for (const line of lines)
			{
				expect(line.roundTrips).toEqual(expect.any(Number));
				expect(line.totalMs).toBeGreaterThanOrEqual(0);
			}
			// Starting ingest reads the in-window games from Postgres.
			expect(lines.find((line) => line.job === "ingest-start")!.roundTrips).toBeGreaterThan(0);
		}
		finally
		{
			log.mockRestore();
		}
	});
});
