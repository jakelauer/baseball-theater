/**
 * S149 AC 5: the scoreboard's live route inside workerd, through the real Worker (`SELF`) and its `DAY_HUB` and
 * `GAME_INGEST` bindings from `wrangler.jsonc`, on the test PGlite: a socket to an in-window day (the bundled
 * 2024-07-04 fixture, whose game 745001 is in progress) receives the day again after the game's ingest object writes,
 * and a day out of its window (2024-07-05, no games) is refused with no upgrade. Run with
 * `pnpm --filter @bt/functions test:workerd`.
 */
import type { GameStateRow } from "@bt/domain";
import {
	env, runDurableObjectAlarm, runInDurableObject, SELF,
} from "cloudflare:test";
import {
	describe, expect, it,
} from "vitest";

type Socket = { accept(): void;
	close(): void;
	addEventListener(type: "message", listener: (event: { data: string }) => void): void; };
type Day = { date: string;
	version: number; };

const upgrade = {
	Upgrade: "websocket",
};

/** Waits until `ready()` holds, or gives up after about two seconds. */
async function until(ready: () => boolean): Promise<void>
{
	for (let attempt = 0; attempt < 100 && !ready(); attempt++) await new Promise((resolve) => setTimeout(resolve, 20));
}

/**
 * Runs `call` until the runtime stops answering that an object it reached was made by an earlier load of the Worker:
 * storage is shared across test files (`isolatedStorage: false`), and an object another file woke (the day hub a
 * schedule write there called, or this game's ingest object) is invalidated when this file loads the Worker again
 * ("worker.ts changed … retry"), as the runtime asks. A stub that met that answer keeps it, so `call` takes a new one.
 */
async function retried<T>(call: () => Promise<T>): Promise<T>
{
	for (let attempt = 0; ; attempt++)
	{
		try
		{
			return await call();
		}
		catch (error)
		{
			if (attempt >= 4 || !String(error).includes("invalidating this Durable Object")) throw error;
		}
	}
}

describe("the scoreboard's day hub on workerd (S149)", () =>
{
	it("S149 AC 5 workerd: a socket to an in-window day receives the day, and receives it again after a game's ingest writes", async () =>
	{
		const ingestStub = () => env.GAME_INGEST.get(env.GAME_INGEST.idFromName("game-ingest:745001"));
		const dayHubStub = () => env.DAY_HUB.get(env.DAY_HUB.idFromName("day-hub:2024-07-04"));
		// Harmless calls first (an unknown hub let go; a day hub with no viewers told of a change), so each object this
		// test reaches is one of this load of the Worker.
		await retried(() => ingestStub().fetch("https://game-ingest/hubs/unregister?hub=warm", {
			method: "POST",
		}));
		await retried(() => dayHubStub().fetch("https://day-hub/publish", {
			method: "POST",
		}));
		const ingest = ingestStub();
		const dayHub = dayHubStub();
		const res = await retried(() => SELF.fetch("http://bt.test/api/v1/schedule/live?date=2024-07-04", {
			headers: upgrade,
		}));
		expect(res.status).toBe(101);
		const socket = (res as Response & { webSocket: Socket }).webSocket;
		const got: Day[] = [];
		socket.addEventListener("message", (event) => void got.push(JSON.parse(event.data) as Day));
		socket.accept();
		await until(() => got.length > 0);
		expect(got[0]?.date).toBe("2024-07-04");
		const first = got[0]!.version;

		// Another writer moves 745001's row on (a newer version with another out count), so the next poll of the fixture
		// feed is a write (a mend) whatever an earlier test stored; the ingest object then publishes to its leased hubs,
		// the day hub among them. Written from inside the day hub, on its own composition and database scope, so this
		// test loads none of the Worker's modules itself.
		await runInDurableObject(dayHub, async (instance) =>
		{
			const hub = instance as unknown as { scoped<T>(work: () => Promise<T>, job: "fetch" | "publish" | "alarm"): Promise<T>;
				deps: { gameStates: { getByPk(pk: number): Promise<GameStateRow | null>;
					write(rows: GameStateRow[]): Promise<number[]>; }; }; };
			await hub.scoped(async () =>
			{
				const row = (await hub.deps.gameStates.getByPk(745001))!;
				await hub.deps.gameStates.write([{
					...row,
					state: {
						...row.state,
						version: row.state.version + 1,
						lastChangedAt: new Date().toISOString(),
						linescore: row.state.linescore && {
							...row.state.linescore,
							outs: ((row.state.linescore.outs ?? 0) + 1) % 3,
						},
					},
				}]);
			}, "alarm");
		});
		await ingest.fetch("https://game-ingest/ensure?gamePk=745001", {
			method: "POST",
		});
		await runDurableObjectAlarm(ingest);
		await until(() => got.length > 1);
		expect(got.length).toBeGreaterThan(1);
		expect(got.at(-1)!.date).toBe("2024-07-04");
		expect(got.at(-1)!.version).toBeGreaterThan(first);
		socket.close();
		// Leave game-ingest:745001 as found (storage is shared across files): S48's test arms it from nothing.
		await runInDurableObject(ingest, async (_instance, state) =>
		{
			const storage = state.storage as unknown as { deleteAlarm(): Promise<void>;
				deleteAll(): Promise<void>; };
			await storage.deleteAlarm();
			await storage.deleteAll();
		});
	});

	it("S149 AC 5 workerd: a day out of its window (no games) doesn't upgrade; it is refused, no-store, pointing at the cached day", async () =>
	{
		const res = await SELF.fetch("http://bt.test/api/v1/schedule/live?date=2024-07-05", {
			headers: upgrade,
		});
		expect(res.status).toBe(409);
		expect((res as Response & { webSocket?: unknown }).webSocket ?? null).toBeNull();
		expect(res.headers.get("Cache-Control")).toBe("no-store");
		expect(await res.json()).toEqual({
			error: "not_live",
			hint: "/api/v1/schedule?date=2024-07-05",
		});
	});
});
