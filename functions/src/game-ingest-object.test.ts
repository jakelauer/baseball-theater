/**
 * S48: the `game-ingest:<gamePk>` Durable Object shell in Node, over fake storage (the
 * workerd test runs the real one): its routes reach `GameIngest`, and its alarm polls.
 */
import {
	afterEach, beforeAll, describe, expect, it, vi,
} from "vitest";
import { ingestLease } from "./game-hub-object.js";
import type { GameIngestNamespace } from "./game-ingest-object.js";
import {
	ensureGameIngest, GameIngestObject, stubHubPublisher,
} from "./game-ingest-object.js";
import { FakeDurableStorage } from "./services/fake-durable-storage.js";
import { useNodeDatabase } from "./test/node-database.js";

beforeAll(async () =>
{
	await useNodeDatabase();
});

function object()
{
	const storage = new FakeDurableStorage();
	return {
		storage,
		object: new GameIngestObject({
			storage,
		}, {}),
	};
}

const post = (path: string) => new Request(`https://game-ingest${path}`, {
	method: "POST",
});

describe("GameIngestObject", () =>
{
	it("POST /ensure arms one alarm however often it is called, and rejects a missing gamePk", async () =>
	{
		const { object: o, storage } = object();
		expect(await (await o.fetch(post("/ensure?gamePk=745001"))).json()).toEqual({
			armed: true,
		});
		expect(await (await o.fetch(post("/ensure?gamePk=745001"))).json()).toEqual({
			armed: false,
		});
		expect(storage.armed).toHaveLength(1);
		expect((await o.fetch(post("/ensure"))).status).toBe(400);
	});

	it("hub routes register, renew and unregister a lease; anything else is 404", async () =>
	{
		const { object: o } = object();
		expect((await o.fetch(post("/hubs/register?hub=hub-a"))).status).toBe(204);
		expect((await o.fetch(post("/hubs/renew?hub=hub-a"))).status).toBe(204);
		expect((await o.fetch(post("/hubs/unregister?hub=hub-a"))).status).toBe(204);
		expect((await o.fetch(post("/hubs/renew?hub=hub-a"))).status).toBe(410);
		expect((await o.fetch(post("/hubs/register"))).status).toBe(404);
		expect((await o.fetch(post("/elsewhere"))).status).toBe(404);
	});

	it("its alarm polls the game and arms the next one; the stub publisher accepts anything", async () =>
	{
		const { object: o, storage } = object();
		await o.fetch(post("/hubs/register?hub=hub-a"));
		await o.fetch(post("/ensure?gamePk=745001"));
		await o.alarm();
		expect(storage.armed).toHaveLength(2);
		await expect(stubHubPublisher("hub-a", {} as never)).resolves.toBeUndefined();
	});
});

describe("ensureGameIngest", () =>
{
	it("posts /ensure to the object named for the game, and throws on a failed answer", async () =>
	{
		const calls: string[] = [];
		const namespace = (status: number) => ({
			idFromName: (name: string) => name,
			get: (id: never) => ({
				fetch: async (input: string) =>
				{
					calls.push(`${String(id)} ${input}`);
					return new Response(null, {
						status,
					});
				},
			}),
		});
		await ensureGameIngest(namespace(200), 745001);
		expect(calls).toEqual(["game-ingest:745001 https://game-ingest/ensure?gamePk=745001"]);
		await expect(ensureGameIngest(namespace(500), 745001)).rejects.toThrow("game-ingest 745001: 500");
	});
});

describe("S220 AC 2: one getter for the ingest objects, with the location hint", () =>
{
	/** A namespace that records each `get`'s arguments as given (a missing options argument stays missing). */
	function recordingNamespace()
	{
		const gets: unknown[][] = [];
		const namespace: GameIngestNamespace = {
			idFromName: (name: string) => name,
			get: (...args: [never, { locationHint?: string }?]) =>
			{
				gets.push(args);
				return {
					fetch: async () => new Response(null, {
						status: 204,
					}),
				};
			},
		};
		return {
			gets,
			namespace,
		};
	}

	it("S220 AC 2 the cron's ensureGameIngest passes the hint when set and no options when not", async () =>
	{
		const hinted = recordingNamespace();
		await ensureGameIngest(hinted.namespace, 745001, "enam");
		expect(hinted.gets).toEqual([["game-ingest:745001", {
			locationHint: "enam",
		}]]);
		const plain = recordingNamespace();
		await ensureGameIngest(plain.namespace, 745001, undefined);
		expect(plain.gets).toEqual([["game-ingest:745001"]]);
	});

	it("S220 AC 2 the hubs' ingestLease passes the hint when set and no options when not", async () =>
	{
		const hinted = recordingNamespace();
		await ingestLease(hinted.namespace, "enam")("register", 745001, "game-hub:745001");
		expect(hinted.gets).toEqual([["game-ingest:745001", {
			locationHint: "enam",
		}]]);
		const plain = recordingNamespace();
		await ingestLease(plain.namespace, undefined)("renew", 745001, "game-hub:745001");
		expect(plain.gets).toEqual([["game-ingest:745001"]]);
	});
});

describe("S220 AC 1: the ingest object logs its round trips", () =>
{
	afterEach(() =>
	{
		vi.restoreAllMocks();
	});

	it("S220 AC 1 an alarm and a call each log one line, kind ingest, with the round trips they made", async () =>
	{
		const { object: o } = object();
		await o.fetch(post("/ensure?gamePk=745001"));
		const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
		await o.fetch(post("/hubs/register?hub=hub-a"));
		await o.alarm();
		const lines = log.mock.calls.map(([line]) => line as Record<string, unknown>).filter((line) => line?.event === "db-round-trips");
		expect(lines.map((line) => [line.kind, line.job])).toEqual([["ingest", "fetch"], ["ingest", "alarm"]]);
		// The alarm reads and writes the game in Postgres (S51), so it made round trips.
		expect(lines[1]!.roundTrips).toBeGreaterThan(0);
		expect(lines[1]!.totalMs).toBeGreaterThanOrEqual(0);
	});
});
