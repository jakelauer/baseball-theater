/**
 * `pnpm db:migrate` (S113) without a hosted database: `migrateDatabaseAt` reaches an empty
 * PGlite through a connection string, over the Postgres wire protocol (`pglite-socket`), the
 * way it reaches Neon. Migrating twice leaves the tables and Drizzle's record of applied
 * migrations as they were, and the tables it creates are exactly the ones the data
 * classification manifest labels (ADR-028). A database whose migrations differ from the code's
 * fails, before any DDL where it can, except one only ahead of the code with `mayBeAhead` (#48).
 */
import {
	cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { sql } from "drizzle-orm";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import {
	afterEach, describe, expect, it, vi,
} from "vitest";
import { DATA_CLASSIFICATION } from "../../services/data-classification.js";
import { FIRST_WHEN, migrationsWith } from "../../test/migrations-folder.js";
import {
	MAY_BE_AHEAD_ENV, MIGRATIONS_FOLDER, mayBeAheadFrom, migrateDatabaseAt, migrationDrift,
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

describe("the game_states migration (S150 AC 3)", () =>
{
	/** The committed folder as it was before S150: the first migration alone. */
	function folderBeforeGameStates(): string
	{
		const folder = mkdtempSync(join(tmpdir(), "bt-migrations-"));
		cpSync(MIGRATIONS_FOLDER, folder, {
			recursive: true,
		});
		const journalPath = join(folder, "meta", "_journal.json");
		const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: { tag: string }[] };
		for (const entry of journal.entries.slice(1)) rmSync(join(folder, `${entry.tag}.sql`));
		writeFileSync(journalPath, JSON.stringify({
			...journal,
			entries: journal.entries.slice(0, 1),
		}));
		return folder;
	}

	/** MLB's status for a code the tests use: its abstract group and its detailed state. */
	const STATUSES: Record<string, [string, string]> = {
		S: ["Preview", "Scheduled"],
		I: ["Live", "In Progress"],
		F: ["Final", "Final"],
		D: ["Final", "Postponed"],
	};

	function status(code: string)
	{
		const [abstractGameState, detailedState] = STATUSES[code]!;
		return {
			abstractGameState,
			codedGameState: code,
			detailedState,
		};
	}

	function linescore(homeRuns: number | null)
	{
		return homeRuns === null ? null : {
			teams: {
				home: {
					runs: homeRuns,
				},
				away: {
					runs: 1,
				},
			},
		};
	}

	/** A scoreboard game as a day stored it before S150, with its status and linescore. */
	function listed(gamePk: number, code: string, homeRuns: number | null)
	{
		return {
			gamePk,
			officialDate: "2026-09-04",
			startTime: "2026-09-04T23:05:00Z",
			status: status(code),
			linescore: linescore(homeRuns),
			live: null,
		};
	}

	/** A stored game snapshot as the `games` table holds it. */
	function snapshot(gamePk: number, code: string, homeRuns: number, lastChangedAt: string)
	{
		return JSON.stringify({
			gamePk,
			officialDate: "2026-09-03",
			startTime: "2026-09-03T17:05:00Z",
			status: status(code),
			linescore: linescore(homeRuns),
			live: null,
			version: 3,
			lastChangedAt,
		});
	}

	/** A PGlite database migrated to just before S150, holding `days` and `games`, then migrated to the code's. */
	async function migratedWith(days: [string, unknown[], string][], snapshots: [number, string][])
	{
		const pglite = new PGlite();
		const db = drizzlePglite(pglite);
		await migratePglite(db, {
			migrationsFolder: folderBeforeGameStates(),
		});
		for (const [date, games, lastChangedAt] of days)
		{
			await db.execute(sql`INSERT INTO schedule_days (date, version, document) VALUES (${date}, 1, ${JSON.stringify({
				date,
				games,
				fetchedAt: lastChangedAt,
				windowMode: "cache",
				version: 1,
				lastChangedAt,
			})})`);
		}
		for (const [gamePk, document] of snapshots)
		{
			await db.execute(sql`INSERT INTO games (game_pk, official_date, version, document) VALUES (${gamePk}, '2026-09-03', 3, ${document})`);
		}
		await migratePglite(db, {
			migrationsFolder: MIGRATIONS_FOLDER,
		});
		return {
			pglite,
			db,
		};
	}

	it("S150 AC 3 migration: fills one row per game from the stored days (the copy changed last) and the stored games no day lists", async () =>
	{
		// Game 10 is listed on two days (suspended, resumed); the earlier date's copy is the one changed last, so the
		// copy is chosen by when it changed, never by its date.
		const { pglite, db } = await migratedWith([
			["2026-09-04", [listed(10, "F", 5)], "2026-09-06T04:00:00.000Z"],
			["2026-09-05", [listed(10, "S", null)], "2026-09-05T20:00:00.000Z"],
		], [[20, snapshot(20, "F", 4, "2026-09-04T01:00:00.000Z")]]);
		const rows = (await db.execute(sql`SELECT game_pk, version, source, feed_time, official_date, start_time,
			document->'status'->>'codedGameState' AS code, document->'linescore'->'teams'->'home'->>'runs' AS home, document->>'lastChangedAt' AS changed
			FROM game_states ORDER BY game_pk`)).rows;
		expect(rows).toEqual([
			{
				game_pk: 10,
				version: 1,
				source: "schedule",
				feed_time: null,
				official_date: "2026-09-04",
				start_time: "2026-09-04T23:05:00Z",
				code: "F",
				home: "5",
				changed: "2026-09-06T04:00:00.000Z",
			},
			{
				game_pk: 20,
				version: 1,
				source: "feed",
				feed_time: null,
				official_date: "2026-09-03",
				start_time: "2026-09-03T17:05:00Z",
				code: "F",
				home: "4",
				changed: "2026-09-04T01:00:00.000Z",
			},
		]);
		expect((await db.execute(sql`SELECT served_base FROM schedule_days ORDER BY date`)).rows).toEqual([{
			served_base: 0,
		}, {
			served_base: 0,
		}]);
		await pglite.close();
	});

	it("S150 AC 3 migration: a day's copy that isn't over loses to a snapshot that changed later; a finished day copy is kept", async () =>
	{
		const { pglite, db } = await migratedWith([
			["2026-09-05", [listed(30, "I", 2), listed(40, "F", 7), listed(50, "D", null), listed(60, "I", 1)], "2026-09-05T20:00:00.000Z"],
		], [
			// Stored mid-game on the day, final in its snapshot later: the snapshot's final.
			[30, snapshot(30, "F", 4, "2026-09-06T03:00:00.000Z")],
			// Final on the day: kept, and its snapshot is never read.
			[40, snapshot(40, "F", 8, "2026-09-06T03:00:00.000Z")],
			// Postponed on the day (MLB groups it "Final"), played later under the same gamePk: the snapshot's final.
			[50, snapshot(50, "F", 3, "2026-09-07T03:00:00.000Z")],
			// A snapshot older than the day's copy: the day's.
			[60, snapshot(60, "S", 0, "2026-09-05T12:00:00.000Z")],
		]);
		const rows = (await db.execute(sql`SELECT game_pk, source, document->'status'->>'codedGameState' AS code,
			document->'linescore'->'teams'->'home'->>'runs' AS home FROM game_states ORDER BY game_pk`)).rows;
		expect(rows).toEqual([
			{
				game_pk: 30,
				source: "feed",
				code: "F",
				home: "4",
			},
			{
				game_pk: 40,
				source: "schedule",
				code: "F",
				home: "7",
			},
			{
				game_pk: 50,
				source: "feed",
				code: "F",
				home: "3",
			},
			{
				game_pk: 60,
				source: "schedule",
				code: "I",
				home: "1",
			},
		]);
		// A source other than the two is refused (S150: the column's CHECK).
		await expect(db.execute(sql`INSERT INTO game_states (game_pk, version, source, official_date, document) VALUES (70, 1, 'cron', '2026-09-05', '{}')`)).rejects.toThrow();
		await pglite.close();
	});

	it("S150 AC 3 migration locks: the lock timeout is set first, and schedule_days is altered only after every read of the stored data", () =>
	{
		const migration = readFileSync(join(MIGRATIONS_FOLDER, "0001_game_states.sql"), "utf8");
		const statements = migration.split("--> statement-breakpoint")
			.map((statement) => statement.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n").trim())
			.filter((statement) => statement !== "");
		expect(statements[0]).toMatch(/^SET LOCAL lock_timeout = '5s';$/);
		const alter = statements.findIndex((statement) => /^ALTER TABLE "schedule_days"/.test(statement));
		const lastRead = statements.map((statement) => /^(INSERT|UPDATE)\b/.test(statement)).lastIndexOf(true);
		expect(alter).toBeGreaterThan(lastRead);
		expect(alter).toBe(statements.length - 1);
	});
});
