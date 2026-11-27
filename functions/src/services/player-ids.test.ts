/**
 * Players' outside ids resolved lazily (S209 AC 3): ingest adds a game's players on a roster change only, the cron's
 * capped resolve step and its keyset seeding pass, each against the in-memory double and the Postgres adapter on a
 * migrated PGlite, plus the SQL the seeding pass runs.
 */
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import type { GameSnapshot } from "@bt/domain";
import { gamePersonIds } from "@bt/domain";
import type {
	PlayerIdRepository, PlayerRegister, ResolvedPlayerIds,
} from "@bt/ports";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import {
	describe, expect, it,
} from "vitest";
import { FixtureMlbStatsClient } from "../adapters/fixtures/mlb.js";
import {
	InMemoryGameProjectionRepository, InMemoryGameRepository, InMemoryPlayerIdRepository, memoryScheduleStores,
} from "../adapters/memory/repos.js";
import type { PostgresDb } from "../adapters/postgres/repos.js";
import {
	PostgresPlayerIdRepository, seedPlayerIdsPageSql, upsertGame,
} from "../adapters/postgres/repos.js";
import { ingestGame } from "./ingest.js";
import {
	RECHECK_INTERVAL_MS, RESOLVE_CAP, resolveDuePlayerIds, runPlayerIdJobs, SEED_PAGE_GAMES,
} from "./player-ids.js";

const NOW = new Date("2026-11-27T12:00:00.000Z");

/** A register that knows every even id (FanGraphs id `fg<id>`), counting its lookups and the ids each asked. */
class CountingRegister implements PlayerRegister
{
	calls: number[][] = [];

	async lookup(personIds: readonly number[]): Promise<Map<number, ResolvedPlayerIds>>
	{
		this.calls.push([...personIds]);
		return new Map(personIds.filter((id) => id % 2 === 0).map((id) => [id, {
			fangraphsId: `fg${id}`,
			bbrefId: `bb${id}`,
		}]));
	}
}

/** A stored game naming `batters` (each faced by pitcher 1) on `date`, enough for the seeding paths. */
function storedGame(gamePk: number, date: string, batters: readonly number[]): GameSnapshot
{
	return {
		gamePk,
		officialDate: date,
		version: 1,
		plays: batters.map((id) => ({
			matchup: {
				batter: {
					id,
				},
				pitcher: {
					id: 1,
				},
			},
		})),
		boxscore: {
			teams: {
				away: {
					batting: [],
					pitching: [{
						id: 2,
					}],
				},
				home: {
					batting: batters.map((id) => ({
						id,
					})),
				},
			},
			info: [],
		},
	} as unknown as GameSnapshot;
}

/** One adapter under test: a fresh repository with games stored ahead of it, and how to count its unchecked rows. */
type Subject = {
	repo: PlayerIdRepository;
	unchecked(): Promise<number>;
};

async function memorySubject(games: readonly GameSnapshot[] = []): Promise<Subject>
{
	const store = new InMemoryGameRepository();
	for (const game of games) await store.upsert(game);
	const repo = new InMemoryPlayerIdRepository(store);
	const seen = new Set<number>();
	const add = repo.addPlayers.bind(repo);
	repo.addPlayers = async (ids) =>
	{
		for (const id of ids) seen.add(id);
		return add(ids);
	};
	return {
		repo,
		unchecked: async () =>
		{
			let n = 0;
			for (const id of seen) if ((await repo.get(id))?.checkedAt === null) n++;
			return n;
		},
	};
}

const MIGRATIONS = fileURLToPath(new URL("../adapters/postgres/migrations", import.meta.url));

async function postgresSubject(games: readonly GameSnapshot[] = []): Promise<Subject & { db: PostgresDb }>
{
	const db: PostgresDb = drizzle(new PGlite());
	await migrate(db as Parameters<typeof migrate>[0], {
		migrationsFolder: MIGRATIONS,
	});
	for (const game of games) await upsertGame(db, game);
	return {
		db,
		repo: new PostgresPlayerIdRepository(db),
		unchecked: async () =>
		{
			const result = await db.execute(sql`SELECT count(*)::integer AS n FROM player_ids WHERE checked_at IS NULL`) as unknown as { rows: { n: number }[] };
			return Number(result.rows[0]?.n ?? 0);
		},
	};
}

const SUBJECTS: [string, (games?: readonly GameSnapshot[]) => Promise<Subject>][] = [
	["in memory", memorySubject],
	["Postgres (PGlite)", postgresSubject],
];

describe.each(SUBJECTS)("the resolve step, %s (S209 AC 3)", (_name, make) =>
{
	it("S209 AC 3: with more waiting than the cap, run 1 resolves the cap in one register call and run 2 the rest", async () =>
	{
		const { repo, unchecked } = await make();
		const waiting = RESOLVE_CAP + 7;
		await repo.addPlayers(Array.from({
			length: waiting,
		}, (_, i) => 1000 + i));
		const register = new CountingRegister();
		const deps = {
			playerIds: repo,
			register,
			now: () => NOW,
		};
		expect(await resolveDuePlayerIds(deps)).toBe(RESOLVE_CAP);
		expect(await unchecked()).toBe(waiting - RESOLVE_CAP);
		// The register is read once a run: at most ⌈cap / batch⌉ calls with the whole cap as one batch.
		expect(register.calls).toHaveLength(1);
		expect(register.calls[0]).toHaveLength(RESOLVE_CAP);
		expect(await resolveDuePlayerIds(deps)).toBe(7);
		expect(await unchecked()).toBe(0);
		expect(register.calls).toHaveLength(2);
		expect(await repo.get(1000)).toEqual({
			personId: 1000,
			checkedAt: NOW.toISOString(),
			fangraphsId: "fg1000",
			bbrefId: "bb1000",
		});
	});

	it("S209 AC 3: a run with nothing waiting makes no register call", async () =>
	{
		const { repo } = await make();
		const register = new CountingRegister();
		expect(await resolveDuePlayerIds({
			playerIds: repo,
			register,
			now: () => NOW,
		})).toBe(0);
		expect(register.calls).toEqual([]);
	});

	it("S209 AC 3: a player with no cross-reference is selected again only after the interval", async () =>
	{
		const { repo } = await make();
		await repo.addPlayers([7, 8]);
		const register = new CountingRegister();
		const at = (ms: number) => ({
			playerIds: repo,
			register,
			now: () => new Date(NOW.getTime() + ms),
		});
		await resolveDuePlayerIds(at(0));
		expect((await repo.get(7))?.fangraphsId).toBeNull();
		expect(await resolveDuePlayerIds(at(RECHECK_INTERVAL_MS - 60_000))).toBe(0);
		expect(await resolveDuePlayerIds(at(RECHECK_INTERVAL_MS + 60_000))).toBe(1);
		// Only the one the register didn't know (7) came back; 8, found, is never asked again.
		expect(register.calls.at(-1)).toEqual([7]);
		expect(RECHECK_INTERVAL_MS).toBeGreaterThanOrEqual(7 * 24 * 60 * 60 * 1000);
	});

	it("S209 AC 3: two seeding runs over more stored games than the page seed every player once, and a run after does nothing", async () =>
	{
		const games = Array.from({
			length: SEED_PAGE_GAMES + 3,
		}, (_, i) => storedGame(5000 + i, `2026-0${1 + (i % 9)}-15`, [100 + i, 100 + i + 1]));
		const { repo } = await make(games);
		const expected = new Set(games.flatMap((game) => gamePersonIds(game)));
		const first = await runPlayerIdJobs({
			playerIds: repo,
		});
		const second = await runPlayerIdJobs({
			playerIds: repo,
		});
		expect(first.seededGames).toBe(SEED_PAGE_GAMES);
		expect(second.seededGames).toBe(3);
		for (const id of expected) expect((await repo.get(id))?.personId).toBe(id);
		expect(await repo.addPlayers([...expected])).toBe(0);
		const third = await runPlayerIdJobs({
			playerIds: repo,
		});
		expect(third).toEqual({
			resolved: 0,
			seededGames: 0,
		});
	});
});

describe("the seeding pass's SQL (S209 AC 3)", () =>
{
	it("S209 AC 3: selects no document column into the Worker: its result is counts only", async () =>
	{
		const text = new PgDialect().sqlToQuery(seedPlayerIdsPageSql(SEED_PAGE_GAMES)).sql;
		const outer = text.slice(text.lastIndexOf("\n\tSELECT"));
		expect(outer).toMatch(/AS games, .* AS added, .* AS moved$/);
		expect(outer).not.toMatch(/document/);
		expect(text).toMatch(/jsonb_path_query\(page\.document, '\$\.plays\[\*\]\.matchup\.batter\.id'\)/);
		expect(text).toMatch(/\(g\.official_date, g\.game_pk\) > \(c\.official_date, c\.game_pk\)/);
		const { db } = await postgresSubject([storedGame(1, "2026-04-01", [10, 11])]);
		const result = await db.execute(seedPlayerIdsPageSql(SEED_PAGE_GAMES)) as unknown as { rows: Record<string, unknown>[] };
		expect(Object.keys(result.rows[0] ?? {}).sort()).toEqual(["added", "games", "moved"]);
	});
});

describe("ingest adds a game's players (S209 AC 3)", () =>
{
	it("S209 AC 3: a game's first write inserts its players once, and a later snapshot with the same roster inserts nothing", async () =>
	{
		const playerIds = new InMemoryPlayerIdRepository();
		const adds: number[][] = [];
		const add = playerIds.addPlayers.bind(playerIds);
		playerIds.addPlayers = async (ids) =>
		{
			adds.push([...ids]);
			return add(ids);
		};
		const deps = {
			...memoryScheduleStores(),
			games: new InMemoryGameRepository(),
			projections: new InMemoryGameProjectionRepository(),
			playerIds,
		};
		const { game } = await new FixtureMlbStatsClient().fetchGame(823823);
		const fetched = {
			...game,
			fetchedAt: NOW.toISOString(),
			windowMode: "cache" as const,
		};
		await ingestGame(deps, fetched);
		expect(adds).toHaveLength(1);
		expect(adds[0]!.sort((a, b) => a - b)).toEqual(gamePersonIds(fetched));
		// A new snapshot (the status text changed) with the same players adds nothing.
		const changed = await ingestGame(deps, {
			...fetched,
			status: {
				...fetched.status,
				detailedState: "Final (corrected)",
			},
			fetchedAt: new Date(NOW.getTime() + 60_000).toISOString(),
		});
		expect(changed.changed).toBe(true);
		expect(adds).toHaveLength(1);
		// One that brings in a new batter adds the roster again (inserted ON CONFLICT DO NOTHING).
		const [first] = fetched.plays;
		await ingestGame(deps, {
			...fetched,
			plays: [...fetched.plays, {
				...first!,
				matchup: {
					...first!.matchup,
					batter: {
						...first!.matchup.batter,
						id: 1,
					},
				},
			}],
			fetchedAt: new Date(NOW.getTime() + 120_000).toISOString(),
		});
		expect(adds).toHaveLength(2);
		expect(await playerIds.get(1)).toMatchObject({
			checkedAt: null,
		});
	});
});
