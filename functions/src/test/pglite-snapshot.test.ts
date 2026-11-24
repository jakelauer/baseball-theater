/**
 * The migrated-PGlite snapshot the functions tests copy per file (pglite-snapshot.ts): each copy is
 * isolated and fully migrated, a stale snapshot still ends migrated, and the key changes with the
 * migrations.
 */
import {
	mkdtempSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import {
	afterAll, afterEach, beforeAll, describe, expect, inject, it, vi,
} from "vitest";
import {
	appliedMigrations, committedMigrations, migratedPglite, PGLITE_SNAPSHOT_ENV,
} from "../adapters/postgres/migrate.js";
import type { PostgresDb } from "../adapters/postgres/repos.js";
import { FIRST_WHEN, migrationsWith } from "./migrations-folder.js";
import setup, { snapshotKey, writeSnapshot } from "./pglite-snapshot.js";

let dir = "";
const runSnapshot = process.env[PGLITE_SNAPSHOT_ENV];

/** The migrations `db` has recorded, as `appliedMigrations` reads them. */
async function applied(db: PostgresDb)
{
	return appliedMigrations(async <T extends Record<string, unknown>>(query: SQL) => (await db.execute(query) as unknown as { rows: T[] }).rows);
}

const committed = committedMigrations().map(({ createdAt, hash }) => ({
	createdAt,
	hash,
}));

beforeAll(() =>
{
	dir = mkdtempSync(join(tmpdir(), "bt-pglite-snapshot-"));
});

afterEach(() =>
{
	if (runSnapshot === undefined) delete process.env[PGLITE_SNAPSHOT_ENV];
	else process.env[PGLITE_SNAPSHOT_ENV] = runSnapshot;
});

afterAll(() =>
{
	rmSync(dir, {
		recursive: true,
		force: true,
	});
});

describe("the migrated PGlite snapshot", () =>
{
	it("is what this worker's migratedPglite loads (use-pglite-snapshot.ts)", () =>
	{
		expect(runSnapshot).toBe(inject("pgliteSnapshot"));
		expect(runSnapshot).toContain(`bt-pglite-${snapshotKey()}`);
	});

	it("gives every load its own fully migrated database", async () =>
	{
		const path = join(dir, "snapshot.tar");
		await writeSnapshot(path);
		process.env[PGLITE_SNAPSHOT_ENV] = path;
		const a = await migratedPglite();
		const b = await migratedPglite();
		expect(await applied(a.db)).toEqual(committed);
		expect(await applied(b.db)).toEqual(committed);
		await a.db.execute(sql`CREATE TABLE only_in_a (x int)`);
		const [row] = (await b.db.execute(sql`SELECT to_regclass('only_in_a') IS NULL AS absent`) as unknown as { rows: { absent: boolean }[] }).rows;
		expect(row?.absent).toBe(true);
		await a.pglite.close();
		await b.pglite.close();
	});

	it("loads the snapshot, and still ends fully migrated from a stale one", async () =>
	{
		// An initialised database with no migrations, only a marker table: dumpDataDir never settles before
		// the database is ready.
		const empty = new PGlite();
		await empty.waitReady;
		await empty.exec("CREATE TABLE snapshot_marker (x int)");
		const path = join(dir, "empty.tar");
		writeFileSync(path, Buffer.from(await (await empty.dumpDataDir("none")).arrayBuffer()));
		await empty.close();
		process.env[PGLITE_SNAPSHOT_ENV] = path;
		const stale = await migratedPglite();
		const [marker] = (await stale.db.execute(sql`SELECT to_regclass('snapshot_marker') IS NOT NULL AS present`) as unknown as { rows: { present: boolean }[] }).rows;
		expect(marker?.present).toBe(true);
		expect(await applied(stale.db)).toEqual(committed);
		await stale.pglite.close();
	});

	it("migrates a fresh database when no snapshot is set", async () =>
	{
		delete process.env[PGLITE_SNAPSHOT_ENV];
		const fresh = await migratedPglite();
		expect(await applied(fresh.db)).toEqual(committed);
		await fresh.pglite.close();
	});

	it("names the snapshot file when it can't be loaded", async () =>
	{
		const path = join(dir, "corrupt.tar");
		writeFileSync(path, "not a data directory");
		process.env[PGLITE_SNAPSHOT_ENV] = path;
		await expect(migratedPglite()).rejects.toThrow(path);
	});

	it("is keyed by the migrations, so a changed folder builds a new one", () =>
	{
		const folder = migrationsWith([{
			tag: "9999_extra",
			sql: "CREATE TABLE extra (x int);",
			when: FIRST_WHEN + 1,
		}]);
		expect(snapshotKey(folder)).not.toBe(snapshotKey());
		expect(snapshotKey()).toBe(snapshotKey());
		rmSync(folder, {
			recursive: true,
			force: true,
		});
	});

	it("hands the existing snapshot's path to the workers without rebuilding it", async () =>
	{
		const provide = vi.fn();
		await setup({
			provide,
		} as unknown as Parameters<typeof setup>[0]);
		expect(provide).toHaveBeenCalledWith("pgliteSnapshot", runSnapshot);
	});
});
