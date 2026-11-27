/**
 * The Postgres adapter against the shared storage contract (S46, `storage-contract.ts`) on
 * PGlite, inside `pnpm test` (S50 AC 3): the committed migrations are applied once, and every
 * case starts from empty tables. Plus the version guard seen from the database: a stale game
 * write changes 0 rows (AC 2).
 */
import {
	cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { SCHEDULE_MONTH_CLAIM_LEASE_MS, SCHEDULE_MONTH_REFRESH_INTERVAL_MS } from "@bt/domain";
import { sql } from "drizzle-orm";
import {
	beforeAll, describe, expect, it,
} from "vitest";
import type { ScheduleRepository } from "@bt/ports";
import { FixtureMlbStatsClient } from "../fixtures/mlb.js";
import { memoryScheduleStores } from "../memory/repos.js";
import {
	describeGameRecheckContract, describeGameStateContract, describeOwedEdgePurgeContract, describeServedBaseContract,
} from "../repository-contract.js";
import { contractGame, describeStorageContract } from "../storage-contract.js";
import type { PostgresDb } from "./repos.js";
import {
	PostgresDeletionLog,
	PostgresOwedEdgePurgeRepository,
	PostgresGameProjectionRepository,
	PostgresGameRepository,
	PostgresGameStateRepository,
	PostgresReplayArtifactRepository,
	PostgresScheduleRepository,
	PostgresSettingsRepository,
	PostgresUserRepository,
	upsertGame,
} from "./repos.js";

const db: PostgresDb = drizzle(new PGlite());
const migrated = migrate(db as Parameters<typeof migrate>[0], {
	migrationsFolder: fileURLToPath(new URL("./migrations", import.meta.url)),
});

/** Every table the migrations create, emptied between cases. */
const TABLES = ["schedule_days", "game_states", "schedule_months", "game_rechecks", "owed_edge_purges", "games", "game_projections", "replay_artifacts", "identity_links", "entitlements", "users", "account_settings", "deletion_log"];

/** Empties every table, after the migrations have run. */
function emptied(): Promise<unknown>
{
	return migrated.then(() => db.execute(sql.raw(`TRUNCATE ${TABLES.join(", ")} RESTART IDENTITY CASCADE`)));
}

/** `repo` with every method held until `ready` settles. */
function gated<T extends object>(repo: T, ready: Promise<unknown>): T
{
	return new Proxy(repo, {
		get(target, key, receiver)
		{
			const value = Reflect.get(target, key, receiver) as unknown;
			if (typeof value !== "function") return value;
			return async (...args: unknown[]) =>
			{
				await ready;
				return (value as (...a: unknown[]) => unknown).apply(target, args);
			};
		},
	});
}

/**
 * The contract builds a repository synchronously, then calls it; each one built here empties
 * the tables first and holds its calls until that is done, so every case starts empty.
 */
function fresh<T extends object>(build: (database: PostgresDb) => T): () => T
{
	return () => gated(build(db), emptied());
}

/**
 * For the registry's case, which builds users and settings together in one tick: they share
 * one emptying, so the second doesn't wipe what the first has written.
 */
let shared: Promise<unknown> | null = null;
function together<T extends object>(build: (database: PostgresDb) => T): () => T
{
	return () =>
	{
		shared ??= emptied();
		const ready = shared;
		queueMicrotask(() =>
		{
			shared = null;
		});
		return gated(build(db), ready);
	};
}

describeStorageContract("Postgres", {
	schedules: fresh((d) => new PostgresScheduleRepository(d)),
	games: fresh((d) => new PostgresGameRepository(d)),
	projections: fresh((d) => new PostgresGameProjectionRepository(d)),
	replays: fresh((d) => new PostgresReplayArtifactRepository(d)),
	users: together((d) => new PostgresUserRepository(d)),
	settings: together((d) => new PostgresSettingsRepository(d)),
});

describeGameStateContract("PostgresGameStateRepository", fresh((d) => new PostgresGameStateRepository(d)));

// The schedule and game-state stores over one emptied database, as the served-base case needs both.
describeServedBaseContract("PostgresScheduleRepository", () =>
{
	const ready = emptied();
	return {
		schedules: gated(new PostgresScheduleRepository(db), ready),
		gameStates: gated(new PostgresGameStateRepository(db), ready),
	};
});

// The game and game-state stores over one emptied database, as the re-check read joins them (S212 AC 5).
describeGameRecheckContract("PostgresGameRepository", () =>
{
	const ready = emptied();
	return {
		games: gated(new PostgresGameRepository(db), ready),
		gameStates: gated(new PostgresGameStateRepository(db), ready),
	};
}, contractGame);

describeOwedEdgePurgeContract("PostgresOwedEdgePurgeRepository", () => gated(new PostgresOwedEdgePurgeRepository(db), emptied()));

describe("Postgres adapter (S50)", () =>
{
	beforeAll(async () =>
	{
		await migrated;
	});

	it("stale write: a game write whose version isn't newer changes 0 rows, and the newer one stays", async () =>
	{
		await db.execute(sql.raw("TRUNCATE games"));
		const game = {
			...(await new FixtureMlbStatsClient().fetchGame(744834)).game,
			lastChangedAt: "2024-07-05T00:00:00.000Z",
		};
		const v2 = {
			...game,
			version: 2,
		};
		expect(await upsertGame(db, v2)).toBe(1);
		expect(await upsertGame(db, {
			...game,
			version: 1,
			status: {
				...game.status,
				detailedState: "stale",
			},
		})).toBe(0);
		expect(await upsertGame(db, v2)).toBe(0);
		expect(await upsertGame(db, {
			...game,
			version: 3,
		})).toBe(1);
		expect((await new PostgresGameRepository(db).getByPk(744834))?.version).toBe(3);
	});

	it("the deletion log keeps entries in the order they were recorded", async () =>
	{
		const log = new PostgresDeletionLog(db);
		await db.execute(sql.raw("TRUNCATE deletion_log RESTART IDENTITY"));
		await log.record({
			uid: "uid-2",
			deletedAt: "2026-10-30T00:00:00.000Z",
		});
		await log.record({
			uid: "uid-1",
			deletedAt: "2026-10-31T00:00:00.000Z",
		});
		expect(await log.list()).toEqual([{
			uid: "uid-2",
			deletedAt: "2026-10-30T00:00:00.000Z",
		}, {
			uid: "uid-1",
			deletedAt: "2026-10-31T00:00:00.000Z",
		}]);
	});

	it("setEntitlements changes a stored user's entitlements and leaves an unknown uid alone", async () =>
	{
		await emptied();
		const users = new PostgresUserRepository(db);
		await users.upsert({
			uid: "uid-1",
			email: "uid-1@example.test",
			displayName: null,
			patreonUserId: null,
			role: "member",
			entitlements: {
				tier: "none",
				fasterLiveRefresh: false,
				cloudSyncedSettings: false,
				savantLinks: false,
				statsProviderChoice: false,
			},
			createdAt: "2026-10-24T00:00:00.000Z",
			updatedAt: "2026-10-24T00:00:00.000Z",
		});
		await users.setEntitlements("uid-1", {
			tier: "Backer",
			fasterLiveRefresh: true,
			cloudSyncedSettings: true,
			savantLinks: false,
			statsProviderChoice: true,
		});
		await users.setEntitlements("nobody", {
			tier: "Backer",
			fasterLiveRefresh: true,
			cloudSyncedSettings: true,
			savantLinks: false,
			statsProviderChoice: true,
		});
		const user = await users.getByUid("uid-1");
		expect(user?.entitlements.tier).toBe("Backer");
		expect(user?.updatedAt).not.toBe("2026-10-24T00:00:00.000Z");
		expect(await users.getByUid("nobody")).toBeNull();
	});
});

/**
 * S194 AC 1: the schedule month record, against both adapters: what a month never recorded reads as,
 * a check read back, a check that only moves forward, and a claim that holds for its lease.
 */
describe.each([
	["memory", async (): Promise<ScheduleRepository> => memoryScheduleStores().schedules],
	["Postgres", async (): Promise<ScheduleRepository> =>
	{
		await emptied();
		return new PostgresScheduleRepository(db);
	}],
] as const)("S194 AC 1 %s schedule month checks", (_name, make) =>
{
	const T = "2026-11-09T17:00:00.000Z";
	const later = (ms: number) => new Date(Date.parse(T) + ms).toISOString();

	it("S194 AC 1 never recorded: a month never recorded reads as none", async () =>
	{
		const repo = await make();
		expect(await repo.listScheduleMonthChecks("2026-01", "2027-12")).toEqual([]);
	});

	it("S194 AC 1 read back: a recorded check reads back, in month order, only inside the range asked", async () =>
	{
		const repo = await make();
		await repo.recordScheduleMonthCheck("2026-05", T);
		await repo.recordScheduleMonthCheck("2026-04", later(1000));
		await repo.recordScheduleMonthCheck("2025-12", T);
		expect(await repo.listScheduleMonthChecks("2026-01", "2027-12")).toEqual([
			{
				month: "2026-04",
				checkedAt: later(1000),
				claimedAt: null,
			},
			{
				month: "2026-05",
				checkedAt: T,
				claimedAt: null,
			},
		]);
	});

	it("S194 AC 1 older check: recording an older check leaves a newer checkedAt as it was, a newer one moves it", async () =>
	{
		const repo = await make();
		await repo.recordScheduleMonthCheck("2026-05", later(60_000));
		await repo.recordScheduleMonthCheck("2026-05", T);
		expect((await repo.listScheduleMonthChecks("2026-05", "2026-05"))[0]?.checkedAt).toBe(later(60_000));
		await repo.recordScheduleMonthCheck("2026-05", later(120_000));
		expect((await repo.listScheduleMonthChecks("2026-05", "2026-05"))[0]?.checkedAt).toBe(later(120_000));
	});

	it("S194 AC 1 lease: a claim inside the lease is refused to a second claimant and granted after it, keeping the month's check", async () =>
	{
		const repo = await make();
		// Checked long enough ago to be due again, so only the claim decides.
		const due = new Date(Date.parse(T) - SCHEDULE_MONTH_REFRESH_INTERVAL_MS).toISOString();
		await repo.recordScheduleMonthCheck("2026-05", due);
		expect(await repo.claimScheduleMonth("2026-05", T)).toBe(true);
		expect(await repo.claimScheduleMonth("2026-05", later(SCHEDULE_MONTH_CLAIM_LEASE_MS - 1))).toBe(false);
		expect((await repo.listScheduleMonthChecks("2026-05", "2026-05"))[0]?.claimedAt).toBe(T);
		expect(await repo.claimScheduleMonth("2026-05", later(SCHEDULE_MONTH_CLAIM_LEASE_MS))).toBe(true);
		expect(await repo.listScheduleMonthChecks("2026-05", "2026-05")).toEqual([{
			month: "2026-05",
			checkedAt: due,
			claimedAt: later(SCHEDULE_MONTH_CLAIM_LEASE_MS),
		}]);
		// A month never recorded is unclaimed: the first claim creates its record.
		expect(await repo.claimScheduleMonth("2026-06", T)).toBe(true);
		expect(await repo.claimScheduleMonth("2026-06", T)).toBe(false);
	});

	it("S194 AC 1 still due: a month checked after the tick read it is refused the claim, in the same write", async () =>
	{
		const repo = await make();
		// Another tick checked it a minute ago, after this tick's read found it due.
		await repo.recordScheduleMonthCheck("2026-07", later(-60_000));
		expect(await repo.claimScheduleMonth("2026-07", T)).toBe(false);
		expect((await repo.listScheduleMonthChecks("2026-07", "2026-07"))[0]?.claimedAt).toBeNull();
		// Checked exactly one interval ago: due, so the claim is taken.
		await repo.recordScheduleMonthCheck("2026-08", later(-SCHEDULE_MONTH_REFRESH_INTERVAL_MS));
		expect(await repo.claimScheduleMonth("2026-08", T)).toBe(true);
	});

	it("S194 AC 1 hold: holding a claim moves claimedAt forward only, keeping the month from a claim until then plus the lease", async () =>
	{
		const repo = await make();
		expect(await repo.claimScheduleMonth("2026-09", T)).toBe(true);
		await repo.holdScheduleMonth("2026-09", later(25 * 60_000));
		await repo.holdScheduleMonth("2026-09", later(60_000));
		expect((await repo.listScheduleMonthChecks("2026-09", "2026-09"))[0]?.claimedAt).toBe(later(25 * 60_000));
		expect(await repo.claimScheduleMonth("2026-09", later(30 * 60_000 - 1))).toBe(false);
		expect(await repo.claimScheduleMonth("2026-09", later(30 * 60_000))).toBe(true);
	});
});

describe("S194 AC 1 Postgres schedule_months", () =>
{
	it("S194 AC 1 month format: the table refuses a month that isn't YYYY-MM", async () =>
	{
		await emptied();
		const repo = new PostgresScheduleRepository(db);
		for (const month of ["2026-13", "2026-00", "2026-1", "26-01", "2026-01-01"])
		{
			await expect(repo.recordScheduleMonthCheck(month, "2026-11-09T17:00:00.000Z"), month).rejects.toThrow();
		}
		await repo.recordScheduleMonthCheck("2026-12", "2026-11-09T17:00:00.000Z");
		expect(await repo.listScheduleMonthChecks("2026-01", "2026-12")).toHaveLength(1);
	});
});

/**
 * S209 AC 8 and AC 9 against rows stored before S209's migration: a database migrated up to the migration before it,
 * rows written there, then the committed migrations applied. Settings gain `stats_provider` (reading "mlb"), and the
 * entitlements read `statsProviderChoice` from the stored tier, with no column of their own.
 */
describe("rows stored before S209 (PGlite)", () =>
{
	async function beforeS209(): Promise<PostgresDb>
	{
		const committed = fileURLToPath(new URL("./migrations", import.meta.url));
		const folder = mkdtempSync(join(tmpdir(), "bt-before-s209-"));
		cpSync(committed, folder, {
			recursive: true,
		});
		const journalPath = join(folder, "meta", "_journal.json");
		const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: { tag: string }[] };
		const at = journal.entries.findIndex((entry) => entry.tag === "0008_player_ids");
		expect(at).toBeGreaterThan(0);
		writeFileSync(journalPath, JSON.stringify({
			...journal,
			entries: journal.entries.slice(0, at),
		}));
		const old: PostgresDb = drizzle(new PGlite());
		await migrate(old as Parameters<typeof migrate>[0], {
			migrationsFolder: folder,
		});
		rmSync(folder, {
			recursive: true,
			force: true,
		});
		await old.execute(sql`INSERT INTO account_settings (uid, favorite_team_ids, opens_first, game_row_slot, collapse_non_favorites, hide_scores, video_player, version)
			VALUES ('old-fan', '{147}', 'live', 'status', false, false, 'dialog', 4)`);
		for (const [uid, tier] of [["old-backer", "Backer"], ["old-member", "none"], ["old-pro", "Pro Backer"]] as const)
		{
			await old.execute(sql`INSERT INTO users (uid, email, role, created_at, updated_at) VALUES (${uid}, ${`${uid}@example.test`}, 'member', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`);
			await old.execute(sql`INSERT INTO entitlements (uid, tier, faster_live_refresh, cloud_synced_settings, savant_links) VALUES (${uid}, ${tier}, false, false, false)`);
		}
		await migrate(old as Parameters<typeof migrate>[0], {
			migrationsFolder: committed,
		});
		return old;
	}

	it("S209 AC 8: a settings row written before the migration reads MLB.com, and the repository writes and reads the choice", async () =>
	{
		const old = await beforeS209();
		const settings = new PostgresSettingsRepository(old);
		expect(await settings.get("old-fan")).toMatchObject({
			statsProvider: "mlb",
			version: 4,
		});
		const current = await settings.get("old-fan");
		await settings.upsert("old-fan", {
			...current!,
			statsProvider: "savant",
			version: 5,
		});
		expect((await settings.get("old-fan"))?.statsProvider).toBe("savant");
	});

	it("S209 AC 9: a qualifying tier stored before S209 reads statsProviderChoice true, a lower tier false, with no column added", async () =>
	{
		const old = await beforeS209();
		const users = new PostgresUserRepository(old);
		expect((await users.getByUid("old-backer"))?.entitlements.statsProviderChoice).toBe(true);
		expect((await users.getByUid("old-pro"))?.entitlements.statsProviderChoice).toBe(true);
		expect((await users.getByUid("old-member"))?.entitlements.statsProviderChoice).toBe(false);
		const columns = await old.execute(sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'entitlements'`) as unknown as { rows: { column_name: string }[] };
		expect(columns.rows.map((row) => row.column_name)).not.toContain("stats_provider_choice");
	});
});
