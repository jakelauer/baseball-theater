/**
 * S45: the API inside workerd — the runtime production uses — through the real Worker
 * entry and its composition, serving the bundled fixtures (no `node:fs`, no network).
 * S114 AC 7: deployed (no `BT_LOCAL`), the same composition refuses a `dev:` sign-in.
 * S116 AC 2: where the vars name a Logto tenant, a Logto ID token signs in through
 * `POST /api/v1/sign-in` (the tenant is a stand-in serving a locally made key).
 * S143 AC 4: with `BT_MOCK_SIGN_IN=1` (staging), the mock credential signs in as the shared test
 * account and the whole account API works behind it, deletion included.
 * Run with `pnpm --filter @bt/functions test:workerd`.
 */
import { env, SELF } from "cloudflare:test";
import { DEFAULT_SETTINGS, MOCK_SIGN_IN_CREDENTIAL } from "@bt/domain";
import {
	describe, expect, it,
} from "vitest";
import { inDatabaseScope, scopedDatabase } from "./adapters/postgres/connect.js";
import { handleApiRequest } from "./handlers/api.js";
import {
	createTestTenant, TEST_LOGTO_APP_ID, TEST_LOGTO_ENDPOINT,
} from "./test/logto-tokens.js";
import { createWorkerApp } from "./worker-app.js";
import type { WorkerEnv } from "./worker-app.js";

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

	it("GET /api/v1/games/744834 is 200 with the fixture game", async () =>
	{
		const res = await SELF.fetch("http://bt.test/api/v1/games/744834");
		expect(res.status).toBe(200);
		const game = await res.json() as { gamePk: number };
		expect(game.gamePk).toBe(744834);
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
