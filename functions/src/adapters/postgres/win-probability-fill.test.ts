/**
 * S161 AC 4 on PGlite: the fill step gives a game stored before S161 (play metrics, no line) its line, leaves a game
 * with no play metrics without one, writes nothing on a second run, and a run stopped after its first batch is finished
 * by the next.
 */
import type { GameSnapshot, Unversioned } from "@bt/domain";
import { scoreboardWinProbability } from "@bt/domain";
import { sql } from "drizzle-orm";
import {
	describe, expect, it,
} from "vitest";
import { FixtureMlbStatsClient } from "../fixtures/mlb.js";
import { ingestGame } from "../../services/ingest.js";
import { migratedPglite } from "./migrate.js";
import type { PostgresDb } from "./repos.js";
import {
	PostgresGameProjectionRepository, PostgresGameRepository, PostgresGameStateRepository, PostgresScheduleRepository,
} from "./repos.js";
import { fillWinProbability } from "./win-probability-fill.js";

const PK = 823823;
const AT = "2026-11-20T12:00:00.000Z";

async function game823823(gamePk = PK, withMetrics = true, officialDate?: string): Promise<Unversioned<GameSnapshot>>
{
	const { game } = await new FixtureMlbStatsClient().fetchGame(PK);
	const { playMetrics, ...rest } = game;
	return {
		...rest,
		gamePk,
		fetchedAt: AT,
		...officialDate && {
			officialDate,
		},
		...withMetrics && playMetrics && {
			playMetrics,
		},
	};
}

/** A database holding `games` as they were stored before S161: their snapshots and rows, every row without a line. */
async function storedBeforeS161(games: Unversioned<GameSnapshot>[]): Promise<{ db: PostgresDb;
	states: PostgresGameStateRepository; }>
{
	const { db } = await migratedPglite();
	const deps = {
		schedules: new PostgresScheduleRepository(db),
		games: new PostgresGameRepository(db),
		projections: new PostgresGameProjectionRepository(db),
		gameStates: new PostgresGameStateRepository(db),
	};
	for (const game of games) await ingestGame(deps, game);
	await db.execute(sql`UPDATE game_states SET win_probability = NULL`);
	return {
		db,
		states: deps.gameStates,
	};
}

describe("the win-probability fill (S161 AC 4)", () =>
{
	it("S161 AC 4 second run reads no checked row: rows with and without a line are each read once", async () =>
	{
		const { db, states } = await storedBeforeS161([await game823823(), await game823823(900002, false)]);
		expect(await fillWinProbability(db)).toMatchObject({
			checked: 2,
			filled: 1,
		});
		expect(await fillWinProbability(db)).toMatchObject({
			checked: 0,
			filled: 0,
		});
		// The checked mark reads as no line, and a later write without one keeps it checked.
		const unlined = await states.getByPk(900002);
		expect(unlined).not.toHaveProperty("winProbability");
		await states.write([{
			...unlined!,
			state: {
				...unlined!.state,
				version: unlined!.state.version + 1,
			},
		}]);
		expect((await fillWinProbability(db)).checked).toBe(0);
	});

	it("S161 AC 4 owes recent edge paths: only filled games inside the past-day edge lifetime owe their purges, as paths", async () =>
	{
		// 823823 (2026-09-05) is 15 days before the fill; 900021's official date is far older than the 30-day lifetime.
		const { db } = await storedBeforeS161([await game823823(), await game823823(900021, true, "2026-06-01")]);
		const result = await fillWinProbability(db, {
			now: new Date("2026-09-20T12:00:00Z"),
		});
		expect(result.filled).toBe(2);
		const owed = ((await db.execute(sql`SELECT url FROM owed_edge_purges ORDER BY url`)) as unknown as { rows: { url: string }[] }).rows.map((row) => row.url);
		expect(owed).toContain("/api/v1/games/823823");
		expect(owed).toContain("/api/v1/schedule?date=2026-09-05");
		expect(owed).toContain("/api/v1/digest?date=2026-09-05");
		expect(owed.some((url) => url.includes("900021") || url.includes("2026-06-01"))).toBe(false);
		expect(result.owed).toBe(owed.length);
	});

	it("S161 AC 4 fills a stored game: a game stored without its line has it after the step, as a new state version", async () =>
	{
		const game = await game823823();
		const { db, states } = await storedBeforeS161([game]);
		const before = await states.getByPk(PK);
		expect(before?.winProbability).toBeUndefined();
		const result = await fillWinProbability(db, {
			now: new Date("2026-11-21T00:00:00Z"),
		});
		expect(result.filled).toBe(1);
		const after = await states.getByPk(PK);
		expect(after?.winProbability).toEqual(scoreboardWinProbability(game));
		expect(after?.state.version).toBe(before!.state.version + 1);
		expect(after?.state.lastChangedAt).toBe("2026-11-21T00:00:00.000Z");
		expect(after?.state.status).toEqual(before?.state.status);
	});

	it("S161 AC 4 no play metrics stays null: a game stored with none keeps no line", async () =>
	{
		const { db, states } = await storedBeforeS161([await game823823(900001, false)]);
		expect((await fillWinProbability(db)).filled).toBe(0);
		expect((await states.getByPk(900001))?.winProbability).toBeUndefined();
	});

	it("S161 AC 4 second run writes nothing: the fill is idempotent", async () =>
	{
		const { db, states } = await storedBeforeS161([await game823823()]);
		expect((await fillWinProbability(db)).filled).toBe(1);
		const once = await states.getByPk(PK);
		expect((await fillWinProbability(db)).filled).toBe(0);
		expect(await states.getByPk(PK)).toEqual(once);
	});

	it("S161 AC 4 resumes after a stop: a run stopped after its first batch, then run again, fills the rest", async () =>
	{
		const pks = [900011, 900012, 900013, 900014, 900015];
		const { db, states } = await storedBeforeS161(await Promise.all(pks.map((pk) => game823823(pk))));
		const stopped = await fillWinProbability(db, {
			batchRows: 2,
			maxBatches: 1,
		});
		expect(stopped).toMatchObject({
			checked: 2,
			filled: 2,
			batches: 1,
		});
		const lined = async () => (await states.getMany(pks)).filter((row) => row.winProbability).map((row) => row.gamePk).sort();
		expect(await lined()).toEqual([900011, 900012]);
		const rest = await fillWinProbability(db, {
			batchRows: 2,
		});
		expect(rest.filled).toBe(3);
		expect(await lined()).toEqual(pks);
	});
});
