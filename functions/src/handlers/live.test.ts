/**
 * S18: `GET /api/v1/games/:gamePk/live` — a WebSocket only for a game in its window
 * (745001, in progress); a finished one (744834) is pointed at the cached GET.
 */
import {
	describe, expect, it, vi,
} from "vitest";
import { FixtureMlbStatsClient } from "../adapters/fixtures/mlb.js";
import { migratedPglite } from "../adapters/postgres/migrate.js";
import { ingestScheduleDay } from "../services/ingest.js";
import { createWorkerApp, liveForwarder } from "../worker-app.js";
import { handleApiRequest } from "./api.js";

const upgrade = {
	Upgrade: "websocket",
};

async function api(live?: (gamePk: number, request: Request) => Promise<Response>)
{
	const app = createWorkerApp({}, (await migratedPglite()).db);
	await ingestScheduleDay(app.ingest, "2024-07-04");
	return (path: string, headers: Record<string, string> = upgrade) => handleApiRequest(new Request(`http://bt.test${path}`, {
		headers,
	}), {
		...app.context,
		live,
	});
}

describe("GET /api/v1/games/:gamePk/live", () =>
{
	it("in-window: a game in progress is handed to its hub", async () =>
	{
		const live = vi.fn(async () => new Response("to the hub"));
		const get = await api(live);
		const res = await get("/api/v1/games/745001/live?since=3");
		expect(await res.text()).toBe("to the hub");
		expect(live).toHaveBeenCalledWith(745001, expect.any(Request));
	});

	it("out of window: a finished game gets a 4xx pointing at the cached GET, and never reaches a hub", async () =>
	{
		const live = vi.fn(async () => new Response("to the hub"));
		const get = await api(live);
		const res = await get("/api/v1/games/744834/live");
		expect(res.status).toBe(409);
		expect(await res.json()).toEqual({
			error: "not_live",
			hint: "/api/v1/games/744834",
		});
		expect(live).not.toHaveBeenCalled();
	});

	it("refuses a plain GET (426), an unknown game (404) and a server without hubs (501), each pointing at the cached GET", async () =>
	{
		// One app (no hubs) answers all three: building a migrated database per request
		// tripled the setup and timed this test out on CI's slower runners.
		const get = await api();
		expect((await get("/api/v1/games/745001/live", {})).status).toBe(426);
		expect((await get("/api/v1/games/1/live")).status).toBe(404);
		const res = await get("/api/v1/games/745001/live");
		expect(res.status).toBe(501);
		expect(await res.json()).toMatchObject({
			hint: "/api/v1/games/745001",
		});
	});
});

describe("GET /api/v1/games/:gamePk/live for a suspended game (#79, #323)", () =>
{
	it("a game suspended at 06:00Z after a 23:05Z first pitch still gets its socket at 07:00Z, past first pitch + 6h, through its stored suspension time", async () =>
	{
		const app = createWorkerApp({}, (await migratedPglite()).db);
		await app.ingest.games.upsert({
			...(await new FixtureMlbStatsClient().fetchGame(745001)).game,
			officialDate: "2026-07-04",
			startTime: "2026-07-04T23:05:00Z",
			status: {
				abstractGameState: "Live",
				codedGameState: "U",
				detailedState: "Suspended: Rain",
			},
			suspendedAt: "2026-07-05T06:00:00.000Z",
			windowMode: "active",
			version: 1,
			lastChangedAt: "2026-07-05T06:00:00.000Z",
		});
		const live = vi.fn(async () => new Response("to the hub"));
		const res = await handleApiRequest(new Request("http://bt.test/api/v1/games/745001/live", {
			headers: upgrade,
		}), {
			...app.context,
			ingest: {
				...app.ingest,
				now: () => new Date("2026-07-05T07:00:00Z"),
			},
			live,
		});
		expect(await res.text()).toBe("to the hub");
		expect(live).toHaveBeenCalledWith(745001, expect.any(Request));
	});
});

describe("liveForwarder", () =>
{
	it("forwards the upgrade to game-hub:<gamePk> as /connect, keeping since", async () =>
	{
		const seen: string[] = [];
		const namespace = {
			idFromName: (name: string) => name,
			get: (id: never) => ({
				fetch: async (input: string, init?: RequestInit) =>
				{
					seen.push(`${String(id)} ${input} ${new Headers(init?.headers).get("Upgrade")}`);
					return new Response(null);
				},
			}),
		};
		const forward = liveForwarder(namespace);
		await forward(745001, new Request("http://bt.test/api/v1/games/745001/live?since=2", {
			headers: upgrade,
		}));
		await forward(745001, new Request("http://bt.test/api/v1/games/745001/live", {
			headers: upgrade,
		}));
		expect(seen).toEqual([
			"game-hub:745001 https://game-hub/connect?gamePk=745001&since=2 websocket",
			"game-hub:745001 https://game-hub/connect?gamePk=745001 websocket",
		]);
		expect(createWorkerApp({
			GAME_HUB: namespace,
		}, (await migratedPglite()).db).context.live).toBeTypeOf("function");
	});
});
