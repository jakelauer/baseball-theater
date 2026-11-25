/**
 * S161 AC 4 on PGlite: the fill step gives a game stored before S161 (play metrics, no line) its line, leaves a game
 * with no play metrics without one, writes nothing on a second run, and a run stopped after its first batch is finished
 * by the next.
 */
import type { GameSnapshot, Unversioned } from "@bt/domain";
import { scoreboardWinProbability } from "@bt/domain";
import type { OwedEdgePurge } from "@bt/ports";
import { PGlite } from "@electric-sql/pglite";
import { asc, sql } from "drizzle-orm";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import {
	cpSync, mkdtempSync, readFileSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	describe, expect, it,
} from "vitest";
import { FixtureMlbStatsClient } from "../fixtures/mlb.js";
import { MemoryEdgeCachePurger } from "../memory/edge-cache-purger.js";
import { ingestGame } from "../../services/ingest.js";
import { OWED_PURGE_GIVE_UP_MS, retryOwedEdgePurges } from "../../services/edge-purge.js";
import { MIGRATIONS_FOLDER, migratedPglite } from "./migrate.js";
import type { PostgresDb } from "./repos.js";
import {
	PostgresGameProjectionRepository, PostgresGameRepository, PostgresGameStateRepository, PostgresOwedEdgePurgeRepository, PostgresScheduleRepository,
} from "./repos.js";
import { owedEdgePurges } from "./schema.js";
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

	it("S161 AC 4 owe failure retried: if owing the edge paths fails, no line is written, and the next run owes them and fills", async () =>
	{
		const { db, states } = await storedBeforeS161([await game823823()]);
		const now = new Date("2026-09-20T12:00:00Z");
		await expect(fillWinProbability(db, {
			now,
			owe: () => Promise.reject(new Error("owe broke")),
		})).rejects.toThrow("owe broke");
		expect((await states.getByPk(PK))?.winProbability).toBeUndefined();
		const second = await fillWinProbability(db, {
			now,
		});
		expect(second.filled).toBe(1);
		const owed = ((await db.execute(sql`SELECT url FROM owed_edge_purges`)) as unknown as { rows: { url: string }[] }).rows.map((row) => row.url);
		expect(owed).toContain("/api/v1/games/823823");
		expect(owed).toContain("/api/v1/schedule?date=2026-09-05");
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

/**
 * The owed-purge listing an older Worker runs (S219): `PostgresOwedEdgePurgeRepository.listDue` exactly as the last
 * commit before S161 had it (`git show f152a44d:functions/src/adapters/postgres/repos.ts`, S161's parent; unchanged
 * since S212 added it). A Worker from before S161 sends every URL it lists as it is, so a path-only owe it lists is a
 * URL Cloudflare refuses, and the refusal defers the full URLs listed beside it.
 */
function preS161ListDue(db: PostgresDb, at: string, limit = 30): Promise<OwedEdgePurge[]>
{
	return db.select({
		url: owedEdgePurges.url,
		owedAt: owedEdgePurges.owedAt,
		version: owedEdgePurges.version,
		failures: owedEdgePurges.failures,
	}).from(owedEdgePurges)
		.where(sql`${owedEdgePurges.retryAt} IS NULL OR ${owedEdgePurges.retryAt}::timestamptz <= ${at}::timestamptz`)
		.orderBy(sql`${owedEdgePurges.owedAt}::timestamptz`, asc(owedEdgePurges.url))
		.limit(limit);
}

const ORIGIN = "https://baseball.theater";
const FULL = `${ORIGIN}/api/v1/games/777001`;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The instants an older Worker could list at, from `from`: then, a day later, and 29 days later (before the give-up). */
function olderWorkerTicks(from: Date): string[]
{
	return [0, DAY_MS, 29 * DAY_MS].map((offset) => new Date(from.getTime() + offset).toISOString());
}

async function owedUrls(db: PostgresDb): Promise<string[]>
{
	return ((await db.execute(sql`SELECT url FROM owed_edge_purges ORDER BY url`)) as unknown as { rows: { url: string }[] }).rows.map((row) => row.url);
}

/** A purger that refuses a batch holding any URL that is not absolute, as Cloudflare would, and records what it purged. */
class AbsoluteOnlyPurger extends MemoryEdgeCachePurger
{
	readonly refused: string[][] = [];

	override async purge(urls: readonly string[]): Promise<void>
	{
		if (urls.some((url) => !url.startsWith("https://")))
		{
			this.refused.push([...urls]);
			throw new Error("refused: not an absolute URL");
		}
		await super.purge(urls);
	}
}

/** A database the fill has run on (15 days after 823823's date, so it owes that game's paths), with a full-URL owe beside them. */
async function filledWithFullOwe(): Promise<{ db: PostgresDb;
	now: Date;
	owed: PostgresOwedEdgePurgeRepository; }>
{
	const { db } = await storedBeforeS161([await game823823()]);
	const owed = new PostgresOwedEdgePurgeRepository(db);
	const now = new Date("2026-09-20T12:00:00Z");
	// Owed before the fill, so the oldest-first listing puts it beside (or ahead of) the fill's paths.
	await owed.owe([FULL], new Date(now.getTime() - 60_000).toISOString());
	const result = await fillWinProbability(db, {
		now,
	});
	expect(result.owed).toBeGreaterThan(0);
	return {
		db,
		now,
		owed,
	};
}

describe("owed edge purges an older Worker sees (S219)", () =>
{
	it("S219 AC 1 older Worker never lists a path-only owe: after the fill, now, a day and 29 days later, even after a failed retry", async () =>
	{
		const {
			db, now, owed,
		} = await filledWithFullOwe();
		expect((await owedUrls(db)).some((url) => url.startsWith("/"))).toBe(true);
		for (const at of olderWorkerTicks(now))
		{
			const listed = (await preS161ListDue(db, at)).map((row) => row.url);
			expect(listed.filter((url) => url.startsWith("/")), at).toEqual([]);
			expect(listed, at).toContain(FULL);
		}
		// A retry the current Worker fails defers the paths; an older Worker still never reaches them, while the full
		// URL deferred with them comes back to it once its retry time passes.
		const failing = {
			purger: {
				purge: () => Promise.reject(new Error("Cloudflare down")),
			},
			origin: ORIGIN,
			owed,
		};
		await retryOwedEdgePurges({
			edgePurge: failing,
			now: () => now,
		});
		const later = new Date(now.getTime() + 60 * 60 * 1000);
		for (const at of olderWorkerTicks(later))
		{
			const listed = (await preS161ListDue(db, at)).map((row) => row.url);
			expect(listed.filter((url) => url.startsWith("/")), at).toEqual([]);
			expect(listed, at).toContain(FULL);
		}
		// A later fill owes a deferred path again before its deferral ends (the re-owe path of `owe`): still hidden from an
		// older Worker, and due at once for this one, its deferral (`path_retry_at`, a minute after `now`) cleared.
		const reowed = "/api/v1/games/823823";
		const reowedAt = new Date(now.getTime() + 30_000);
		await owed.owe([reowed], reowedAt.toISOString());
		for (const at of olderWorkerTicks(reowedAt))
		{
			expect((await preS161ListDue(db, at)).map((row) => row.url), at).not.toContain(reowed);
		}
		expect((await owed.listDue(reowedAt.toISOString(), 30)).map((row) => row.url)).toContain(reowed);
	});

	it("S219 AC 1 rows already owed: path-only owes recorded before S219's migration are hidden from an older Worker after it", async () =>
	{
		// A database migrated as far as S161 left it (through 0006), holding the owes the fill and a failed retry wrote then.
		const journal = JSON.parse(readFileSync(join(MIGRATIONS_FOLDER, "meta", "_journal.json"), "utf8")) as { entries: { tag: string }[] };
		const upTo = journal.entries.findIndex((entry) => entry.tag === "0006_game_states_win_probability");
		expect(upTo).toBeGreaterThanOrEqual(0);
		const folder = mkdtempSync(join(tmpdir(), "bt-migrations-s161-"));
		cpSync(MIGRATIONS_FOLDER, folder, {
			recursive: true,
		});
		writeFileSync(join(folder, "meta", "_journal.json"), JSON.stringify({
			...journal,
			entries: journal.entries.slice(0, upTo + 1),
		}));
		const db = drizzlePglite(new PGlite()) as unknown as PostgresDb;
		await migratePglite(db as Parameters<typeof migratePglite>[0], {
			migrationsFolder: folder,
		});
		const now = new Date("2026-09-20T12:00:00Z");
		const at = now.toISOString();
		const retry = new Date(now.getTime() + 2 * 60_000).toISOString();
		await db.execute(sql`INSERT INTO owed_edge_purges (url, owed_at, failures, retry_at) VALUES
			('/api/v1/games/823823', ${at}, 0, NULL),
			('/api/v1/schedule?date=2026-09-05', ${at}, 1, ${retry}),
			(${FULL}, ${at}, 0, NULL)`);
		await migratePglite(db as Parameters<typeof migratePglite>[0], {
			migrationsFolder: MIGRATIONS_FOLDER,
		});
		for (const tick of olderWorkerTicks(now))
		{
			expect((await preS161ListDue(db, tick)).map((row) => row.url), tick).toEqual([FULL]);
		}
		// The current Worker still lists them, each at its own retry time.
		const owed = new PostgresOwedEdgePurgeRepository(db);
		expect((await owed.listDue(at, 30)).map((row) => row.url).sort()).toEqual(["/api/v1/games/823823", FULL].sort());
		expect((await owed.listDue(retry, 30)).map((row) => row.url)).toContain("/api/v1/schedule?date=2026-09-05");
	});

	it("S219 AC 2 the current Worker clears the fill's owes under its origin, every URL absolute, and settles them", async () =>
	{
		const {
			db, now, owed,
		} = await filledWithFullOwe();
		const paths = (await owedUrls(db)).filter((url) => url.startsWith("/"));
		const purger = new AbsoluteOnlyPurger();
		// A first retry that fails (an outage) defers them; the next allowed tick clears them, long before the give-up.
		const failed = await retryOwedEdgePurges({
			edgePurge: {
				purger: {
					purge: () => Promise.reject(new Error("Cloudflare down")),
				},
				origin: ORIGIN,
				owed,
			},
			now: () => now,
		});
		expect(failed).toBe(0);
		const early = await retryOwedEdgePurges({
			edgePurge: {
				purger,
				origin: `${ORIGIN}/`,
				owed,
			},
			now: () => new Date(now.getTime() + 30_000),
		});
		expect(early).toBe(0);
		const next = new Date(now.getTime() + 60_000);
		expect(next.getTime() - now.getTime()).toBeLessThan(OWED_PURGE_GIVE_UP_MS);
		const purged = await retryOwedEdgePurges({
			edgePurge: {
				purger,
				origin: `${ORIGIN}/`,
				owed,
			},
			now: () => next,
		});
		expect(purger.refused).toEqual([]);
		expect(purger.purged.every((url) => url.startsWith(`${ORIGIN}/api/v1/`))).toBe(true);
		expect(purger.purged).toEqual(expect.arrayContaining([...paths.map((path) => `${ORIGIN}${path}`), FULL]));
		expect(purged).toBe(paths.length + 1);
		expect(await owedUrls(db)).toEqual([]);
	});

	it("S219 AC 3 a refused URL doesn't hold up the rest: a full-URL owe listed with the fill's owes is purged that tick", async () =>
	{
		const {
			db, now, owed,
		} = await filledWithFullOwe();
		const purger = new AbsoluteOnlyPurger();
		const due = (await owed.listDue(now.toISOString(), 30)).map((row) => row.url);
		expect(due).toContain(FULL);
		expect(due.some((url) => url.startsWith("/"))).toBe(true);
		await retryOwedEdgePurges({
			edgePurge: {
				purger,
				origin: ORIGIN,
				owed,
			},
			now: () => now,
		});
		expect(purger.refused).toEqual([]);
		expect(purger.purged).toContain(FULL);
		expect(await owedUrls(db)).not.toContain(FULL);
	});
});
