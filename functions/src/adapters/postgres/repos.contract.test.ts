/**
 * The Postgres adapter against the shared storage contract (S46, `storage-contract.ts`) on
 * PGlite, inside `pnpm test` (S50 AC 3): the committed migrations are applied once, and every
 * case starts from empty tables. Plus the version guard seen from the database: a stale game
 * write changes 0 rows (AC 2).
 */
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { SCHEDULE_MONTH_CLAIM_LEASE_MS } from "@bt/domain";
import { sql } from "drizzle-orm";
import {
	beforeAll, describe, expect, it,
} from "vitest";
import type { ScheduleRepository } from "@bt/ports";
import { FixtureMlbStatsClient } from "../fixtures/mlb.js";
import { InMemoryScheduleRepository } from "../memory/repos.js";
import { describeStorageContract } from "../storage-contract.js";
import type { PostgresDb } from "./repos.js";
import {
	PostgresDeletionLog,
	PostgresGameProjectionRepository,
	PostgresGameRepository,
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
const TABLES = ["schedule_days", "schedule_months", "games", "game_projections", "replay_artifacts", "identity_links", "entitlements", "users", "account_settings", "deletion_log"];

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
			...await new FixtureMlbStatsClient().fetchGame(744834),
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
			},
			createdAt: "2026-10-24T00:00:00.000Z",
			updatedAt: "2026-10-24T00:00:00.000Z",
		});
		await users.setEntitlements("uid-1", {
			tier: "Backer",
			fasterLiveRefresh: true,
			cloudSyncedSettings: true,
			savantLinks: false,
		});
		await users.setEntitlements("nobody", {
			tier: "Backer",
			fasterLiveRefresh: true,
			cloudSyncedSettings: true,
			savantLinks: false,
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
	["memory", async (): Promise<ScheduleRepository> => new InMemoryScheduleRepository()],
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
		await repo.recordScheduleMonthCheck("2026-05", T);
		expect(await repo.claimScheduleMonth("2026-05", T)).toBe(true);
		expect(await repo.claimScheduleMonth("2026-05", later(SCHEDULE_MONTH_CLAIM_LEASE_MS - 1))).toBe(false);
		expect((await repo.listScheduleMonthChecks("2026-05", "2026-05"))[0]?.claimedAt).toBe(T);
		expect(await repo.claimScheduleMonth("2026-05", later(SCHEDULE_MONTH_CLAIM_LEASE_MS))).toBe(true);
		expect(await repo.listScheduleMonthChecks("2026-05", "2026-05")).toEqual([{
			month: "2026-05",
			checkedAt: T,
			claimedAt: later(SCHEDULE_MONTH_CLAIM_LEASE_MS),
		}]);
		// A month never recorded is unclaimed: the first claim creates its record.
		expect(await repo.claimScheduleMonth("2026-06", T)).toBe(true);
		expect(await repo.claimScheduleMonth("2026-06", T)).toBe(false);
	});
});
