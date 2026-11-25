/**
 * S220 AC 1: `inDatabaseScope`'s round-trip count, against a migrated PGlite as the process's database (the Worker
 * opens one connection per scope; the counting wrapper is the same). Each labelled scope writes one structured line.
 */
import { sql } from "drizzle-orm";
import {
	afterEach, beforeAll, describe, expect, it, vi,
} from "vitest";
import { useNodeDatabase } from "../../test/node-database.js";
import type { RoundTripLine } from "./connect.js";
import { inDatabaseScope, scopedDatabase } from "./connect.js";

beforeAll(async () =>
{
	await useNodeDatabase();
});

afterEach(() =>
{
	vi.restoreAllMocks();
});

/** The round-trip lines written while `run` runs. */
async function linesOf(run: () => Promise<unknown>): Promise<RoundTripLine[]>
{
	const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
	await run();
	return log.mock.calls.map(([line]) => line as RoundTripLine).filter((line) => line?.event === "db-round-trips");
}

const select = () => scopedDatabase.execute(sql`select 1`);

describe("inDatabaseScope round trips (S220 AC 1)", () =>
{
	it("S220 AC 1 a labelled scope making three queries logs one line with three round trips and their times", async () =>
	{
		const lines = await linesOf(() => inDatabaseScope(undefined, async () =>
		{
			await select();
			await select();
			await select();
		}, undefined, undefined, {
			kind: "cron",
			job: "month-refresh",
		}));
		expect(lines).toHaveLength(1);
		expect(lines[0]).toMatchObject({
			event: "db-round-trips",
			kind: "cron",
			job: "month-refresh",
			roundTrips: 3,
		});
		expect(lines[0]!.totalMs).toBeGreaterThanOrEqual(0);
		expect(lines[0]!.maxMs).toBeLessThanOrEqual(lines[0]!.totalMs + 1);
	});

	it("S220 AC 1 a labelled scope making no query logs zero", async () =>
	{
		const lines = await linesOf(() => inDatabaseScope(undefined, async () => "nothing", undefined, undefined, {
			kind: "hub",
			job: "fetch",
		}));
		expect(lines).toEqual([{
			event: "db-round-trips",
			kind: "hub",
			job: "fetch",
			roundTrips: 0,
			totalMs: 0,
			maxMs: 0,
		}]);
	});

	it("S220 AC 1 a scope with no kind (a request) logs nothing, however many queries it makes", async () =>
	{
		expect(await linesOf(() => inDatabaseScope(undefined, async () =>
		{
			await select();
		}))).toEqual([]);
	});

	it("S220 AC 1 a scope that throws still logs, counting the queries before the throw, and `after` counts too", async () =>
	{
		const failing = await linesOf(() => inDatabaseScope(undefined, async () =>
		{
			await select();
			throw new Error("boom");
		}, undefined, undefined, {
			kind: "ingest",
			job: "alarm",
		}).catch(() => undefined));
		expect(failing.map((line) => line.roundTrips)).toEqual([1]);
		const withAfter = await linesOf(() => inDatabaseScope(undefined, select, undefined, async () =>
		{
			await select();
		}, {
			kind: "day-hub",
			job: "alarm",
		}));
		expect(withAfter.map((line) => line.roundTrips)).toEqual([2]);
	});

	it("S220 AC 1 queries inside a transaction are counted; a nested labelled scope counts into its own line and its parent's", async () =>
	{
		const lines = await linesOf(() => inDatabaseScope(undefined, async () =>
		{
			await scopedDatabase.transaction(async (tx) =>
			{
				await tx.execute(sql`select 1`);
				await tx.execute(sql`select 2`);
			});
			await inDatabaseScope(undefined, select, undefined, undefined, {
				kind: "ingest",
				job: "fetch",
			});
		}, undefined, undefined, {
			kind: "cron",
			job: "ingest-start",
		}));
		expect(lines.map((line) => [line.kind, line.roundTrips])).toEqual([["ingest", 1], ["cron", 3]]);
	});
});
