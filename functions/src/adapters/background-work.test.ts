import {
	afterEach, describe, expect, it, vi,
} from "vitest";
import {
	DeferredWorkQueue, NodeBackgroundWork, RecordedBackgroundWork, ScopedBackgroundWork, withDeferredWork,
} from "./background-work.js";
import { inDatabaseScope, setNodeDatabase } from "./postgres/connect.js";
import type { PostgresDb } from "./postgres/repos.js";

afterEach(() =>
{
	setNodeDatabase(undefined);
	vi.restoreAllMocks();
});

describe("BackgroundWork adapters (S216 AC 3)", () =>
{
	it("S216 AC 3 Worker adapter: work deferred in a request runs after the handler returns, inside the database scope, before the close, through waitUntil", async () =>
	{
		// Under Node the scope is the process's one database; the Worker opens one per request the same way.
		setNodeDatabase({} as PostgresDb);
		const order: string[] = [];
		const background = new ScopedBackgroundWork();
		const queue = new DeferredWorkQueue();
		const handed: Promise<unknown>[] = [];
		const response = await inDatabaseScope(undefined, () => withDeferredWork(queue, async () =>
		{
			background.defer("projection", async () =>
			{
				order.push("deferred write");
			});
			order.push("answer");
			return "response";
		}), (promise) => handed.push(promise), () => queue.drain());
		expect(response).toBe("response");
		expect(handed).toHaveLength(1);
		await Promise.all(handed);
		expect(order).toEqual(["answer", "deferred write"]);
	});

	it("S216 AC 3 Worker adapter outside a request: the work runs at once rather than being dropped", async () =>
	{
		const ran = vi.fn(async () => undefined);
		new ScopedBackgroundWork().defer("cron", ran);
		await Promise.resolve();
		expect(ran).toHaveBeenCalledTimes(1);
	});

	it("S216 AC 3 Node adapter: runs the work at once and logs a failure without throwing", async () =>
	{
		const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const ran = vi.fn(async () => undefined);
		const background = new NodeBackgroundWork();
		background.defer("ok", ran);
		expect(() => background.defer("broken", async () =>
		{
			throw new Error("database down");
		})).not.toThrow();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(ran).toHaveBeenCalledTimes(1);
		expect(error.mock.calls.some((args) => String(args[0]).includes("broken failed"))).toBe(true);
	});

	it("S216 AC 3 test double: records the work unrun until flushed, in order, a failure logged", async () =>
	{
		const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const order: string[] = [];
		const background = new RecordedBackgroundWork();
		background.defer("first", async () =>
		{
			order.push("first");
			background.defer("queued while flushing", async () =>
			{
				order.push("third");
			});
		});
		background.defer("second", async () =>
		{
			order.push("second");
			throw new Error("refused");
		});
		expect(order).toEqual([]);
		expect(background.pending).toHaveLength(2);
		await background.flush();
		expect(order).toEqual(["first", "second", "third"]);
		expect(error).toHaveBeenCalledTimes(1);
	});
});
