/**
 * S45: the Worker entry and its composition, exercised in Node (coverage lives here;
 * `worker.workerd.test.ts` runs the same Worker inside workerd). The fixture client is
 * the default and the live one opt-in; the cron ensures per-game ingest objects (S48)
 * deployed, and in local dev only behind BT_INGEST_TICK.
 */
import {
	beforeAll, describe, expect, it, vi,
} from "vitest";
import { FixtureClient } from "./adapters/fixtures/fixture-client.js";
import { CHADWICK_REGISTER_BASE_URL, ChadwickPlayerRegister } from "./adapters/http/chadwick-register.js";
import { HttpMlbStatsClient } from "./adapters/http/mlb.js";
import * as gameIngest from "./services/game-ingest.js";
import * as edgePurge from "./services/edge-purge.js";
import * as gameRecheck from "./services/game-recheck.js";
import * as scheduleRefresh from "./services/schedule-refresh.js";
import { useNodeDatabase } from "./test/node-database.js";
import { handleApiRequest } from "./handlers/api.js";
import worker from "./worker.js";
import * as workerAppModule from "./worker-app.js";
import {
	createMlbClient, createWorkerApp, tickAllowed, workerApp,
} from "./worker-app.js";

describe("the Worker composition (S45)", () =>
{
	it("the bundled fixture client by default; live statsapi only with BT_USE_LIVE_MLB=1", () =>
	{
		expect(createMlbClient({})).toBeInstanceOf(FixtureClient);
		expect(createMlbClient({
			BT_USE_LIVE_MLB: "0",
		})).toBeInstanceOf(FixtureClient);
		expect(createMlbClient({
			BT_USE_LIVE_MLB: "1",
		})).toBeInstanceOf(HttpMlbStatsClient);
	});

	it("reads through to the fixtures into Postgres, with a given session key and app origin", async () =>
	{
		const app = createWorkerApp({
			BT_SESSION_KEY: "k",
			BT_APP_ORIGIN: "https://bt.test",
		}, await useNodeDatabase());
		expect(await app.ingest.schedules.getByDate("2026-09-05")).toBeNull();
		const response = await handleApiRequest(new Request("http://bt.test/api/v1/schedule?date=2026-09-05"), app.context);
		expect(response.status).toBe(200);
		expect((await app.ingest.schedules.getByDate("2026-09-05"))?.games.length).toBe(15);
	});

	it("S209 AC 3: with live MLB data the player-id job gets the register and the same MLB client as its cross-references; otherwise neither", async () =>
	{
		const db = await useNodeDatabase();
		const live = createWorkerApp({
			BT_USE_LIVE_MLB: "1",
		}, db);
		expect(live.ingest.mlb).toBeInstanceOf(HttpMlbStatsClient);
		expect(live.ingest.playerXrefs).toBe(live.ingest.mlb);
		expect(live.ingest.playerRegister).toBeInstanceOf(ChadwickPlayerRegister);
		expect(live.ingest.playerIds).toBeDefined();
		const fixtures = createWorkerApp({}, db);
		expect(fixtures.ingest.playerRegister).toBeUndefined();
		expect(fixtures.ingest.playerXrefs).toBeUndefined();
		expect(fixtures.ingest.playerIds).toBeDefined();
	});

	it("one app per isolate", () =>
	{
		expect(workerApp({})).toBe(workerApp({
			BT_USE_LIVE_MLB: "1",
		}));
	});

	it("the cron tick runs deployed, and in local dev only with BT_INGEST_TICK=1", () =>
	{
		expect(tickAllowed({})).toBe(true);
		expect(tickAllowed({
			BT_LOCAL: "1",
		})).toBe(false);
		expect(tickAllowed({
			BT_LOCAL: "1",
			BT_INGEST_TICK: "1",
		})).toBe(true);
	});
});

describe("the Worker entry (S45)", () =>
{
	// Node has no Hyperdrive: the Worker's scoped database falls back to PGlite (S51).
	beforeAll(async () =>
	{
		await useNodeDatabase();
	});

	it("fetch answers the API through handleApiRequest", async () =>
	{
		const res = await worker.fetch(new Request("http://bt.test/api/v1/games/744834"), {}, {
			waitUntil: () => undefined,
		});
		expect(res.status).toBe(200);
		expect((await res.json() as { gamePk: number }).gamePk).toBe(744834);
	});

	it("scheduled ensures a game-ingest object for each in-window game when allowed and bound, and nothing in local dev without the gate", async () =>
	{
		const ensure = vi.spyOn(gameIngest, "ensureIngestRunning");
		// The schedule refresh (S194) runs beside it on every allowed tick; its own tests are below.
		const refresh = vi.spyOn(scheduleRefresh, "refreshDueScheduleMonth").mockResolvedValue(null);
		const fetches: string[] = [];
		const namespace = {
			idFromName: (name: string) => name,
			get: (id: never) => ({
				fetch: async (input: string) =>
				{
					fetches.push(`${String(id)} ${input}`);
					return Response.json({
						armed: true,
					});
				},
			}),
		};
		const waits: Promise<unknown>[] = [];
		const ctx = {
			waitUntil: (p: Promise<unknown>) => void waits.push(p),
		};
		await worker.scheduled(undefined, {
			BT_LOCAL: "1",
			GAME_INGEST: namespace,
		}, ctx);
		await worker.scheduled(undefined, {}, ctx);
		expect(ensure).not.toHaveBeenCalled();
		await worker.scheduled(undefined, {
			GAME_INGEST: namespace,
		}, ctx);
		expect(ensure).toHaveBeenCalledTimes(1);
		const ensured = await ensure.mock.results[0]!.value as number[];
		expect(fetches).toEqual(ensured.map((pk) => `game-ingest:${pk} https://game-ingest/ensure?gamePk=${pk}`));
		// Allowed twice (with and without the binding), refused once in local dev.
		expect(refresh).toHaveBeenCalledTimes(2);
		await Promise.allSettled(waits);
		ensure.mockRestore();
		refresh.mockRestore();
	});

	/** A context whose `waitUntil` keeps every promise for the test to settle. */
	function collecting()
	{
		const waits: Promise<unknown>[] = [];
		return {
			waits,
			ctx: {
				waitUntil: (p: Promise<unknown>) => void waits.push(p),
			},
		};
	}

	/** A game-ingest namespace whose objects record each ensure. */
	function namespaceRecording(ensured: string[])
	{
		return {
			idFromName: (name: string) => name,
			get: (id: never) => ({
				fetch: async () =>
				{
					ensured.push(String(id));
					return Response.json({
						armed: true,
					});
				},
			}),
		};
	}

	it("S194 AC 5 refresh rejects: a refresh that rejects leaves ensureIngestRunning's objects ensured", async () =>
	{
		const refresh = vi.spyOn(scheduleRefresh, "refreshDueScheduleMonth").mockRejectedValue(new Error("database down"));
		const ingest = vi.spyOn(gameIngest, "ensureIngestRunning").mockImplementation(async (_deps, ensure) =>
		{
			await ensure(1);
			await ensure(2);
			return [1, 2];
		});
		const ensured: string[] = [];
		const { waits, ctx } = collecting();
		await worker.scheduled(undefined, {
			GAME_INGEST: namespaceRecording(ensured),
		}, ctx);
		const settled = await Promise.allSettled(waits);
		// The third is S212's re-check, which has no due game here, and the fourth its owed-purge retry, which has none.
		expect(settled.map((s) => s.status).sort()).toEqual(["fulfilled", "fulfilled", "fulfilled", "rejected"]);
		expect(ensured).toEqual(["game-ingest:1", "game-ingest:2"]);
		refresh.mockRestore();
		ingest.mockRestore();
	});

	it("S194 AC 5 ingest rejects: an ingest that rejects still refreshes a due month", async () =>
	{
		const ingest = vi.spyOn(gameIngest, "ensureIngestRunning").mockRejectedValue(new Error("MLB down"));
		const refresh = vi.spyOn(scheduleRefresh, "refreshDueScheduleMonth");
		const { waits, ctx } = collecting();
		await worker.scheduled(undefined, {
			GAME_INGEST: namespaceRecording([]),
		}, ctx);
		const settled = await Promise.allSettled(waits);
		// The third is S212's re-check, which has no due game here, and the fourth its owed-purge retry, which has none.
		expect(settled.map((s) => s.status).sort()).toEqual(["fulfilled", "fulfilled", "fulfilled", "rejected"]);
		expect(refresh).toHaveBeenCalledTimes(1);
		const month = await refresh.mock.results[0]!.value as string | null;
		expect(month).toMatch(/^\d{4}-\d{2}$/);
		const [check] = await workerApp({}).ingest.schedules.listScheduleMonthChecks(month!, month!);
		expect(check?.claimedAt).not.toBeNull();
		refresh.mockRestore();
		ingest.mockRestore();
	});

	it("S194 AC 5 no binding: with no GAME_INGEST binding the refresh still runs, and in local dev only with BT_INGEST_TICK=1", async () =>
	{
		const refresh = vi.spyOn(scheduleRefresh, "refreshDueScheduleMonth").mockResolvedValue(null);
		const ingest = vi.spyOn(gameIngest, "ensureIngestRunning");
		const { waits, ctx } = collecting();
		await worker.scheduled(undefined, {}, ctx);
		expect(refresh).toHaveBeenCalledTimes(1);
		expect(ingest).not.toHaveBeenCalled();
		await worker.scheduled(undefined, {
			BT_LOCAL: "1",
		}, ctx);
		expect(refresh).toHaveBeenCalledTimes(1);
		await worker.scheduled(undefined, {
			BT_LOCAL: "1",
			BT_INGEST_TICK: "1",
		}, ctx);
		expect(refresh).toHaveBeenCalledTimes(2);
		await Promise.allSettled(waits);
		refresh.mockRestore();
		ingest.mockRestore();
	});

	it("S212 AC 5 recheck rejects: a re-check that rejects leaves the month refresh and the ingest running, each in its own waitUntil", async () =>
	{
		const recheck = vi.spyOn(gameRecheck, "recheckDueGame").mockRejectedValue(new Error("database down"));
		const refresh = vi.spyOn(scheduleRefresh, "refreshDueScheduleMonth").mockResolvedValue("2026-11");
		const ingest = vi.spyOn(gameIngest, "ensureIngestRunning").mockResolvedValue([]);
		const { waits, ctx } = collecting();
		await worker.scheduled(undefined, {
			GAME_INGEST: namespaceRecording([]),
		}, ctx);
		const settled = await Promise.allSettled(waits);
		expect(settled.map((s) => s.status)).toEqual(["fulfilled", "fulfilled", "rejected", "fulfilled"]);
		expect(recheck).toHaveBeenCalledTimes(1);
		expect(refresh).toHaveBeenCalledTimes(1);
		expect(ingest).toHaveBeenCalledTimes(1);
		await worker.scheduled(undefined, {
			BT_LOCAL: "1",
		}, ctx);
		// In local dev without BT_INGEST_TICK the tick runs nothing, the re-check included (`tickAllowed`).
		expect(recheck).toHaveBeenCalledTimes(1);
		recheck.mockRestore();
		refresh.mockRestore();
		ingest.mockRestore();
	});

	it("S212 review retry rejects: an owed-purge retry that rejects leaves the ingest, the month refresh and the re-check running, in its own waitUntil", async () =>
	{
		const retry = vi.spyOn(edgePurge, "retryOwedEdgePurges").mockRejectedValue(new Error("database down"));
		const recheck = vi.spyOn(gameRecheck, "recheckDueGame").mockResolvedValue(null);
		const refresh = vi.spyOn(scheduleRefresh, "refreshDueScheduleMonth").mockResolvedValue("2026-11");
		const ingest = vi.spyOn(gameIngest, "ensureIngestRunning").mockResolvedValue([]);
		const { waits, ctx } = collecting();
		await worker.scheduled(undefined, {
			GAME_INGEST: namespaceRecording([]),
		}, ctx);
		const settled = await Promise.allSettled(waits);
		expect(settled.map((s) => s.status)).toEqual(["fulfilled", "fulfilled", "fulfilled", "rejected"]);
		expect([retry, recheck, refresh, ingest].map((spy) => spy.mock.calls.length)).toEqual([1, 1, 1, 1]);
		await worker.scheduled(undefined, {
			BT_LOCAL: "1",
		}, ctx);
		expect(retry).toHaveBeenCalledTimes(1);
		for (const spy of [retry, recheck, refresh, ingest]) spy.mockRestore();
	});

	it("S209 AC 3: with live MLB data a tick syncs one register file in its own waitUntil, logged as the player-ids job", async () =>
	{
		// The Worker builds its app once per isolate, already on fixtures here, so the tick is handed a live-data app
		// whose register is served by the composition's test fetch: one file, one player with both ids (no MLB call).
		const db = await useNodeDatabase();
		const registerAsks: { url: string;
			ifNoneMatch: string | null; }[] = [];
		const live = createWorkerApp({
			BT_USE_LIVE_MLB: "1",
		}, db, {
			fetch: async (url, init) =>
			{
				if (!url.startsWith(CHADWICK_REGISTER_BASE_URL)) throw new Error(`unexpected fetch ${url}`);
				registerAsks.push({
					url,
					ifNoneMatch: new Headers(init?.headers).get("If-None-Match"),
				});
				return new Response("key_person,key_mlbam,key_fangraphs,key_bbref,mlb_played_first\nabc0,665871,21741,assadja01,2021\n", {
					headers: {
						ETag: "\"w1\"",
					},
				});
			},
		});
		const app = vi.spyOn(workerAppModule, "workerApp").mockReturnValue(live);
		const others = [
			vi.spyOn(scheduleRefresh, "refreshDueScheduleMonth").mockResolvedValue(null),
			vi.spyOn(gameRecheck, "recheckDueGame").mockResolvedValue(null),
			vi.spyOn(edgePurge, "retryOwedEdgePurges").mockResolvedValue(0),
		];
		const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
		try
		{
			const { waits, ctx } = collecting();
			await worker.scheduled(undefined, {}, ctx);
			const settled = await Promise.allSettled(waits);
			const synced = settled.flatMap((s) => s.status === "fulfilled" && (s.value as { changed?: boolean } | undefined)?.changed !== undefined ? [s.value] : []);
			expect(synced).toEqual([expect.objectContaining({
				file: "people-0.csv",
				changed: true,
				inserted: 1,
			})]);
			expect(registerAsks).toEqual([{
				url: `${CHADWICK_REGISTER_BASE_URL}/people-0.csv`,
				ifNoneMatch: null,
			}]);
			expect(await live.ingest.playerIds!.getMany([665871])).toEqual([{
				personId: 665871,
				fangraphsId: "21741",
				bbrefId: "assadja01",
			}]);
			const lines = log.mock.calls.map(([line]) => line as Record<string, unknown>).filter((line) => line?.event === "db-round-trips" && line.kind === "cron");
			expect(lines.filter((line) => line.job === "player-ids")).toHaveLength(1);
		}
		finally
		{
			log.mockRestore();
			for (const spy of [app, ...others]) spy.mockRestore();
		}
	});
});
