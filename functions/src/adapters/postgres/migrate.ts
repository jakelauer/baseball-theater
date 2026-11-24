/**
 * Applying the committed migrations from Node (S51): `pnpm db:seed` against compose.yaml's
 * Postgres, PGlite in tests and `local-server.ts`, and `pnpm db:migrate` against whatever
 * database `BT_DATABASE_URL` names, production included (S113, run by the owner). Drizzle
 * records what it applied, so running it again changes nothing. The Worker never migrates.
 *
 * Drizzle applies only migrations newer than the newest one a database has run, so a database can
 * differ from the code without migrating failing (#48): one a pull request's preview left behind, or
 * an older one skipped because a newer one already ran. `migrateDatabaseAt`, which every deploy runs,
 * therefore checks the database's record against the committed migrations before migrating (so a
 * drifted database fails before any DDL) and after, and fails on any difference (`migrationDrift`)
 * except a database `ahead` of the code, newer migrations only, which production's and previews'
 * deploys allow with a warning (`MAY_BE_AHEAD_ENV`): re-running an older release's deploy is
 * production's rollback, and a preview's database is reset from staging, which is ahead of a pull
 * request built before `stage` gained a newer migration (a re-run, or no push since). Staging stays
 * strict.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { migrate as migrateNodePostgres } from "drizzle-orm/node-postgres/migrator";
import { openPostgres } from "./connect.js";
import type { PostgresDb } from "./repos.js";

/** The committed SQL migrations beside the schema (`drizzle-kit generate`, S50). */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL("./migrations", import.meta.url));

/**
 * Migrates a database opened by `openPostgres` (node-postgres) from `migrationsFolder`, the committed
 * migrations unless a caller (the baseball-data copy, which compares against the same folder) names one.
 */
export async function migratePostgres(db: PostgresDb, migrationsFolder: string = MIGRATIONS_FOLDER): Promise<void>
{
	await migrateNodePostgres(db as Parameters<typeof migrateNodePostgres>[0], {
		migrationsFolder,
	});
}

/** One applied migration, as drizzle records it: the journal's `when`, and the sha256 of its SQL file. */
export type AppliedMigration = { createdAt: number;
	hash: string; };

/** A committed migration: its record as drizzle would write it, its journal tag (`name`) and its SQL. */
export type CommittedMigration = AppliedMigration & { name: string;
	sql: string; };

/**
 * The migrations in `folder`, read the way drizzle's migrator reads them (`readMigrationFiles`: `folderMillis` and the
 * hash of the SQL), so a record matches one exactly when the migrator would call it that file. `name` is the journal's
 * tag, or `created_at <when>` when the journal has none.
 */
export function committedMigrations(folder: string = MIGRATIONS_FOLDER): CommittedMigration[]
{
	const journal = JSON.parse(readFileSync(join(folder, "meta", "_journal.json"), "utf8")) as { entries: { when: number;
		tag: string; }[]; };
	return readMigrationFiles({
		migrationsFolder: folder,
	}).map((file) => ({
		createdAt: file.folderMillis,
		hash: file.hash,
		sql: file.sql.join("\n"),
		name: journal.entries.find((entry) => entry.when === file.folderMillis)?.tag ?? `created_at ${file.folderMillis}`,
	}));
}

/** The migrations `read` (a database) has applied, oldest first; none when it has no drizzle record. Read only. */
export async function appliedMigrations(read: <T extends Record<string, unknown>>(query: SQL) => Promise<T[]>): Promise<AppliedMigration[]>
{
	const [record] = await read<{ present: boolean }>(sql`SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS present`);
	if (!record?.present) return [];
	const found = await read<{ created_at: string;
		hash: string; }>(sql`SELECT created_at::text AS created_at, hash FROM drizzle.__drizzle_migrations ORDER BY created_at`);
	return found.map((row) => ({
		createdAt: Number(row.created_at),
		hash: row.hash,
	}));
}

/**
 * A record the database has that no committed file matches (`unknown`, or `ahead` when it is newer than every committed
 * file, as after a rollback), or a committed file no record matches (`missing`). See `migrationDrift`.
 */
export type MigrationDifference =
	| { kind: "unknown";
		record: AppliedMigration; }
	| { kind: "ahead";
		record: AppliedMigration; }
	| { kind: "missing";
		file: CommittedMigration; };

/**
 * Every way `applied` (a database's record) differs from `committed` (the code's migrations): a migration the database
 * ran that the code doesn't have, then one the code has that the database never ran. A record matches a file only on
 * both `createdAt` and `hash`, so an edited file counts as both. A record the code doesn't have is `ahead` only when it
 * is newer than every committed file, which is what re-running an older release's deploy over a newer database looks
 * like; anything older is `unknown`, a migration from other code. Empty when they agree.
 */
export function migrationDrift(committed: readonly CommittedMigration[], applied: readonly AppliedMigration[]): MigrationDifference[]
{
	const same = (a: AppliedMigration, b: AppliedMigration) => a.createdAt === b.createdAt && a.hash === b.hash;
	const newestCommitted = Math.max(-Infinity, ...committed.map((file) => file.createdAt));
	return [
		...applied.filter((record) => !committed.some((file) => same(file, record)))
			.map((record): MigrationDifference => ({
				kind: record.createdAt > newestCommitted ? "ahead" : "unknown",
				record,
			})),
		...committed.filter((file) => !applied.some((record) => same(file, record)))
			.map((file): MigrationDifference => ({
				kind: "missing",
				file,
			})),
	];
}

/** One line for a difference, as `migrateDatabaseAt` reports it. */
export function describeMigrationDifference(difference: MigrationDifference): string
{
	switch (difference.kind)
	{
		case "unknown":
			return `the database has run migration created_at ${difference.record.createdAt} (hash ${difference.record.hash}), which the code doesn't have`;
		case "ahead":
			return `the database has run migration created_at ${difference.record.createdAt} (hash ${difference.record.hash}), newer than any migration the code has`;
		case "missing":
			return `the database never ran migration ${difference.file.name}, which the code has (drizzle skips a migration older than the newest one a database ran)`;
	}
}

/**
 * The environment variable that lets `pnpm db:migrate` pass a database that is `ahead` of the code (set to "1"). The
 * production deploy sets it because re-running an older release's deploy is the documented rollback, and production
 * never receives a preview's migrations. Each preview's deploy sets it because its database is reset from staging
 * (#42), which is ahead of a pull request built before `stage` gained a newer migration (a re-run, or no push
 * since); a pull request's own migration older than staging's newest still fails, as `missing`. Staging stays
 * strict, so a migration a preview once left there still fails (#48).
 */
export const MAY_BE_AHEAD_ENV = "BT_MIGRATIONS_MAY_BE_AHEAD";

/** Whether `env` (the process environment) allows an `ahead` database: `MAY_BE_AHEAD_ENV` is exactly "1". */
export function mayBeAheadFrom(env: Readonly<Record<string, string | undefined>>): boolean
{
	return env[MAY_BE_AHEAD_ENV] === "1";
}

/**
 * How to recover, per environment and kind of difference. Production is never reset or edited by hand (CLAUDE.md).
 * Staging is never reset from production (that copies fans' data; `deploy:bootstrap` recreates it schema-only), and a
 * record is never deleted alone: the migration's tables stay, and running it again later fails "already exists".
 */
const RECOVERY = [
	"To fix.",
	"Production: stop and ask the owner; never reset or edit it by hand.",
	"Staging, newer migrations only: if stage's newest code commit has them (a newer deploy migrated it, then failed or was cancelled), re-run its "
	+ "Deploy run; otherwise they came from no commit on stage (a preview before #42, a reverted migration): treat them as a migration the code "
	+ "doesn't have, below.",
	"Staging, a migration the code doesn't have: tear down the previews' branches, delete the staging branch and deploy again (bootstrap recreates "
	+ "it schema-only; never reset it from production), or undo that migration's changes by hand and then delete its row (never the row alone).",
	"Staging, one it never ran: apply that file's SQL and its row by hand, or recreate the branch as above.",
	"A preview: if staging's own deploy fails the same way, fix staging first (above), then push again; else if its own migration is older than "
	+ "staging's newest, merge stage into the pull request and regenerate the migration so it is newer; otherwise push again (a re-run reuses "
	+ "the same merge).",
].join(" ");

/** Options for `migrateDatabaseAt`; the defaults are the committed migrations, strict, and `console.warn`. */
export type MigrateOptions = {
	/** The migrations to apply and to check against (tests name a copy with extra migrations). */
	migrationsFolder?: string;
	/** Pass an `ahead` database with a warning instead of failing (production's and previews' deploys, via `MAY_BE_AHEAD_ENV`). */
	mayBeAhead?: boolean;
	warn?: (line: string) => void;
};

/**
 * Opens `connectionString`, applies every migration in the folder it hasn't had, and closes it (`pnpm db:migrate`,
 * S113, run by every deploy). The connection string comes from the caller's environment; none for a hosted database
 * is ever committed.
 *
 * It checks the database's record against the folder before migrating and again after (#48), and throws naming each
 * difference. Before, a committed file the database never ran is expected when it is newer than the newest record
 * (drizzle is about to apply it), so the check fails a drifted database before any DDL runs; after, every file must
 * be recorded. `ahead` records pass only with `mayBeAhead`, with one warning after migrating.
 */
export async function migrateDatabaseAt(connectionString: string, options: MigrateOptions = {}): Promise<void>
{
	const folder = options.migrationsFolder ?? MIGRATIONS_FOLDER;
	const warn = options.warn ?? console.warn;
	const committed = committedMigrations(folder);
	const { db, close } = await openPostgres(connectionString);
	const check = async (beforeMigrating: boolean) =>
	{
		const applied = await appliedMigrations(async <T extends Record<string, unknown>>(query: SQL) => (await db.execute(query) as unknown as { rows: T[] }).rows);
		const newestApplied = applied.at(-1)?.createdAt ?? -Infinity;
		const differences = migrationDrift(committed, applied)
			.filter((difference) => !(beforeMigrating && difference.kind === "missing" && difference.file.createdAt > newestApplied));
		const failing = differences.filter((difference) => difference.kind !== "ahead" || !options.mayBeAhead);
		if (failing.length) throw new Error(`the database's migrations don't match the code's: ${failing.map(describeMigrationDifference).join("; ")}. ${RECOVERY}`);
		const ahead = differences.filter((difference) => difference.kind === "ahead");
		if (!beforeMigrating && ahead.length)
		{
			warn(`the database is ahead of the code: ${ahead.map(describeMigrationDifference).join("; ")}. This is expected on a preview whose pull request `
				+ "was built before stage gained a newer migration, and on production only when re-running an older release's deploy (a rollback); on a forward production release it "
				+ "means something is wrong, so tell the owner.");
		}
	};
	try
	{
		await check(true);
		await migratePostgres(db, folder);
		await check(false);
	}
	finally
	{
		await close();
	}
}

/**
 * Names a file holding a migrated PGlite's data directory (`dumpDataDir`) that `migratedPglite` starts from instead of
 * an empty database. Set only in the functions tests' workers (`src/test/pglite-snapshot.ts`), which build that file
 * once per run instead of migrating once per test file; nothing else sets it.
 */
export const PGLITE_SNAPSHOT_ENV = "BT_PGLITE_SNAPSHOT";

/**
 * A fresh in-process PGlite with the migrations applied, and the PGlite under it. With `PGLITE_SNAPSHOT_ENV` set it
 * loads that snapshot (each call its own copy, so every caller still gets an isolated database) and still runs the
 * migrator, which applies nothing to a current snapshot and anything newer to a stale one, so the result is fully
 * migrated either way.
 */
export async function migratedPglite(): Promise<{ db: PostgresDb;
	pglite: PGlite; }>
{
	const snapshot = process.env[PGLITE_SNAPSHOT_ENV];
	const pglite = snapshot ? new PGlite({
		loadDataDir: new Blob([readFileSync(snapshot)]),
	}) : new PGlite();
	if (snapshot)
	{
		await pglite.waitReady.catch((error: unknown) =>
		{
			throw new Error(`couldn't load the PGlite snapshot ${snapshot} (delete it and the next test run rebuilds it): ${String(error)}`);
		});
	}
	const db = drizzlePglite(pglite);
	await migratePglite(db, {
		migrationsFolder: MIGRATIONS_FOLDER,
	});
	return {
		db,
		pglite,
	};
}
