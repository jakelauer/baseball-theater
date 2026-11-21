/**
 * `pnpm db:migrate` (S113) without a hosted database: `migrateDatabaseAt` reaches an empty
 * PGlite through a connection string, over the Postgres wire protocol (`pglite-socket`), the
 * way it reaches Neon. Migrating twice leaves the tables and Drizzle's record of applied
 * migrations as they were, and the tables it creates are exactly the ones the data
 * classification manifest labels (ADR-028). A database whose migrations differ from the code's
 * fails, before any DDL where it can, except one only ahead of the code with `mayBeAhead` (#48).
 */
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import {
	afterEach, describe, expect, it, vi,
} from "vitest";
import { DATA_CLASSIFICATION } from "../../services/data-classification.js";
import { FIRST_WHEN, migrationsWith } from "../../test/migrations-folder.js";
import {
	MAY_BE_AHEAD_ENV, mayBeAheadFrom, migrateDatabaseAt, migrationDrift,
} from "./migrate.js";

let stop: (() => Promise<void>) | undefined;
afterEach(async () =>
{
	await stop?.();
	stop = undefined;
});

/** An empty PGlite served on a local port, and a connection string for it. */
async function emptyDatabase(): Promise<{ pglite: PGlite;
	url: string; }>
{
	const pglite = new PGlite();
	// A port of its own, so this file can't collide with the workerd tests' server.
	const port = 55000 + Math.floor(Math.random() * 4000);
	const server = new PGLiteSocketServer({
		db: pglite,
		host: "127.0.0.1",
		port,
	});
	await server.start();
	stop = async () =>
	{
		await server.stop();
		await pglite.close();
	};
	return {
		pglite,
		url: `postgres://postgres:postgres@127.0.0.1:${port}/postgres`,
	};
}

async function tables(pglite: PGlite): Promise<string[]>
{
	const result = await pglite.query<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name");
	return result.rows.map((row) => row.table_name);
}

async function applied(pglite: PGlite): Promise<string[]>
{
	const result = await pglite.query<{ hash: string }>("SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id");
	return result.rows.map((row) => row.hash);
}

describe("pnpm db:migrate (S113)", () =>
{
	it("S113 AC 1: applies the committed migrations to the database a connection string names, and twice changes nothing", async () =>
	{
		const { pglite, url } = await emptyDatabase();
		expect(await tables(pglite)).toEqual([]);

		await migrateDatabaseAt(url);
		const first = {
			tables: await tables(pglite),
			applied: await applied(pglite),
		};
		expect(first.tables.length).toBeGreaterThan(0);
		expect(first.applied.length).toBeGreaterThan(0);

		await migrateDatabaseAt(url);
		expect({
			tables: await tables(pglite),
			applied: await applied(pglite),
		}).toEqual(first);
	});

	it("S113 AC 5: the tables a migration creates are exactly the manifest's labeled Postgres tables", async () =>
	{
		const { pglite, url } = await emptyDatabase();
		await migrateDatabaseAt(url);
		expect(await tables(pglite)).toEqual(Object.keys(DATA_CLASSIFICATION.postgresTables).sort());
	});

	// Drizzle applies only migrations newer than the newest a database has run, so a database can
	// hold one the code doesn't have (left by a pull request's preview) or have skipped one the code
	// has, and migrating "succeeds" either way. The deploy's migrate step must fail instead.
	it("fails when the database ran a migration the code doesn't have (#48)", async () =>
	{
		const { pglite, url } = await emptyDatabase();
		await migrateDatabaseAt(url);
		await pglite.query("INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('from-a-preview', 99999999999999)");

		await expect(migrateDatabaseAt(url)).rejects.toThrow(/has run migration created_at 99999999999999 \(hash from-a-preview\), newer than any migration the code has/);
	});

	it("fails when the code has a migration the database never ran, and counts an edited file both ways (#48)", async () =>
	{
		const { pglite, url } = await emptyDatabase();
		await migrateDatabaseAt(url);
		// The committed migration's record now names other SQL: the database never ran the code's file.
		await pglite.query("UPDATE drizzle.__drizzle_migrations SET hash = 'edited-elsewhere'");

		const failure = migrateDatabaseAt(url);
		await expect(failure).rejects.toThrow(/the database never ran migration 0000_initial/);
		await expect(failure).rejects.toThrow(new RegExp(`has run migration created_at ${FIRST_WHEN} \\(hash edited-elsewhere\\), which the code doesn't have`));
		// The recovery never tells anyone to reset or edit production (CLAUDE.md), never to reset staging from
		// production (fans' data), and never to delete a row alone (its DDL stays).
		await expect(failure).rejects.toThrow(/Production: stop and ask the owner; never reset or edit it by hand/);
		await expect(failure).rejects.toThrow(/never reset it from production/);
		await expect(failure).rejects.toThrow(/never the row alone/);
		// Neither recovery loops: newer migrations no commit on stage has are treated as unknown, and a preview fixes a
		// drifted staging first.
		await expect(failure).rejects.toThrow(/otherwise they came from no commit on stage \(a preview before #42, a reverted migration\): treat them as a migration/);
		await expect(failure).rejects.toThrow(/A preview: if staging's own deploy fails the same way, fix staging first \(above\), then push again/);
	});

	it("checks against the folder it migrates from, and a forward migration on a migrated database passes (#48)", async () =>
	{
		const { pglite, url } = await emptyDatabase();
		await migrateDatabaseAt(url);

		await migrateDatabaseAt(url, {
			migrationsFolder: migrationsWith([{
				tag: "0001_extra",
				sql: "CREATE TABLE b48_extra (id int);",
				when: FIRST_WHEN + 1000,
			}]),
		});
		expect(await tables(pglite)).toContain("b48_extra");
	});

	it("fails a database that skipped an older migration before running any newer one (#48)", async () =>
	{
		const { pglite, url } = await emptyDatabase();
		const c = {
			tag: "0003_c",
			sql: "CREATE TABLE b48_c (id int);",
			when: FIRST_WHEN + 2000,
		};
		await migrateDatabaseAt(url, {
			migrationsFolder: migrationsWith([c]),
		});

		const folder = migrationsWith([{
			tag: "0002_b",
			sql: "CREATE TABLE b48_b (id int);",
			when: FIRST_WHEN + 1000,
		}, c, {
			tag: "0004_d",
			sql: "CREATE TABLE b48_d (id int);",
			when: FIRST_WHEN + 3000,
		}]);
		await expect(migrateDatabaseAt(url, {
			migrationsFolder: folder,
		})).rejects.toThrow(/the database never ran migration 0002_b/);
		// The check ran before migrating: D, newer than anything the database ran, was never applied.
		expect(await tables(pglite)).not.toContain("b48_d");
	});

	it("with mayBeAhead, passes a database ahead of the code (a rollback) with a warning; without it, fails (#48)", async () =>
	{
		const { pglite, url } = await emptyDatabase();
		await migrateDatabaseAt(url);
		await pglite.query("INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('from-a-newer-release', 99999999999999)");
		const warn = vi.fn();

		await migrateDatabaseAt(url, {
			mayBeAhead: true,
			warn,
		});
		expect(warn).toHaveBeenCalledTimes(1);
		expect(warn.mock.calls[0]?.[0]).toMatch(/created_at 99999999999999 \(hash from-a-newer-release\)[^]*re-running an older release's deploy[^]*tell the owner/);
		await expect(migrateDatabaseAt(url)).rejects.toThrow(/newer than any migration the code has/);
	});

	it("mayBeAhead allows only a database ahead of the code, never drift (#48)", async () =>
	{
		const { pglite, url } = await emptyDatabase();
		await migrateDatabaseAt(url);
		await pglite.query("UPDATE drizzle.__drizzle_migrations SET hash = 'edited-elsewhere'");
		const warn = vi.fn();

		await expect(migrateDatabaseAt(url, {
			mayBeAhead: true,
			warn,
		})).rejects.toThrow(new RegExp(`has run migration created_at ${FIRST_WHEN} \\(hash edited-elsewhere\\)`));
	});

	it("mayBeAhead still fails a migration the code has that the database never ran, older than its newest (#48)", async () =>
	{
		const { pglite, url } = await emptyDatabase();
		await migrateDatabaseAt(url);
		await pglite.query(`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('from-a-newer-release', ${FIRST_WHEN + 5000})`);

		await expect(migrateDatabaseAt(url, {
			migrationsFolder: migrationsWith([{
				tag: "0001_older",
				sql: "CREATE TABLE b48_older (id int);",
				when: FIRST_WHEN + 1000,
			}]),
			mayBeAhead: true,
			warn: vi.fn(),
		})).rejects.toThrow(/the database never ran migration 0001_older/);
	});
});

describe("migrationDrift (#48)", () =>
{
	const a = {
		createdAt: 1000,
		hash: "a",
		name: "0000_a",
		sql: "",
	};
	const b = {
		createdAt: 2000,
		hash: "b",
		name: "0001_b",
		sql: "",
	};
	const record = (file: { createdAt: number;
		hash: string; }) => ({
		createdAt: file.createdAt,
		hash: file.hash,
	});

	it("is empty when the database ran exactly the code's migrations", () =>
	{
		expect(migrationDrift([a, b], [record(a), record(b)])).toEqual([]);
	});

	it("reports every committed file as missing for an empty database", () =>
	{
		expect(migrationDrift([a, b], [])).toEqual([{
			kind: "missing",
			file: a,
		}, {
			kind: "missing",
			file: b,
		}]);
	});

	it("matches on created_at and hash both: the same hash at another created_at is drift both ways", () =>
	{
		expect(migrationDrift([a], [{
			createdAt: 500,
			hash: "a",
		}])).toEqual([{
			kind: "unknown",
			record: {
				createdAt: 500,
				hash: "a",
			},
		}, {
			kind: "missing",
			file: a,
		}]);
		expect(migrationDrift([a, b], [record(a), {
			createdAt: 1500,
			hash: "b",
		}])).toEqual([{
			kind: "unknown",
			record: {
				createdAt: 1500,
				hash: "b",
			},
		}, {
			kind: "missing",
			file: b,
		}]);
	});

	it("reports only the older file when only the newer one ran (drizzle skipped it)", () =>
	{
		expect(migrationDrift([a, b], [record(b)])).toEqual([{
			kind: "missing",
			file: a,
		}]);
	});

	it("calls a record newer than every committed file ahead, and an older one unknown", () =>
	{
		const newer = {
			createdAt: 3000,
			hash: "c",
		};
		const between = {
			createdAt: 1500,
			hash: "x",
		};
		expect(migrationDrift([a, b], [record(a), record(b), newer])).toEqual([{
			kind: "ahead",
			record: newer,
		}]);
		expect(migrationDrift([a, b], [record(a), between, record(b)])).toEqual([{
			kind: "unknown",
			record: between,
		}]);
	});
});

describe("mayBeAheadFrom (#48)", () =>
{
	it("is true only for exactly \"1\"", () =>
	{
		expect(mayBeAheadFrom({
			[MAY_BE_AHEAD_ENV]: "1",
		})).toBe(true);
		for (const value of ["true", "", "0", undefined]) expect(mayBeAheadFrom({
			[MAY_BE_AHEAD_ENV]: value,
		}), String(value)).toBe(false);
		expect(mayBeAheadFrom({})).toBe(false);
	});
});
