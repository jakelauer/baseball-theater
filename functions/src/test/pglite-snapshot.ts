/**
 * Global setup for the functions Node tests: migrates one PGlite per run and saves its data directory
 * (`dumpDataDir`), so each test file's `migratedPglite` loads its own copy of that instead of running
 * every migration again (owner, 2026-11-23, asked to add it to the verify-lock tooling pull request:
 * "yes, add those two to the same tooling pull request"). Loading took ~0.2 s against ~0.9–1.6 s for a
 * migration on a loaded machine.
 *
 * The file is keyed by a hash of the migrations folder and the installed PGlite and drizzle-orm, so a
 * changed migration or an upgrade builds a new one, and lives in the temp folder, shared by every
 * worktree with the same migrations. It is written to a temporary name and renamed, so a run in
 * another worktree never reads half of it. `migratedPglite` still runs the migrator after loading,
 * so even a stale snapshot ends fully migrated. The workerd tests' server (`pglite-server.ts`) is
 * unaffected: its process never sets the variable.
 */
import { createHash } from "node:crypto";
import {
	existsSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import {
	dirname, join, relative,
} from "node:path";
import type { TestProject } from "vitest/node";
import { MIGRATIONS_FOLDER, migratedPglite } from "../adapters/postgres/migrate.js";

declare module "vitest"
{
	interface ProvidedContext
	{
		/** The snapshot file {@link setup} wrote, read by `use-pglite-snapshot.ts` in each worker. */
		pgliteSnapshot: string;
	}
}

/**
 * The installed version of `name`, so a worktree that hasn't installed an upgrade yet never shares a newer one's
 * snapshot: the nearest package.json named `name` above its entry point (neither package exports its package.json).
 */
function installed(name: string): string
{
	let dir = dirname(createRequire(import.meta.url).resolve(name));
	for (;;)
	{
		const file = join(dir, "package.json");
		if (existsSync(file))
		{
			const pkg = JSON.parse(readFileSync(file, "utf8")) as { name?: string;
				version: string; };
			if (pkg.name === name) return pkg.version;
		}
		if (dirname(dir) === dir) throw new Error(`no package.json for ${name} above its entry point`);
		dir = dirname(dir);
	}
}

/**
 * The hash naming the snapshot: every file under `folder` (path and bytes, in a fixed order) and the installed PGlite
 * (which writes the data directory) and drizzle-orm (whose migrator records what ran).
 */
export function snapshotKey(folder: string = MIGRATIONS_FOLDER): string
{
	const hash = createHash("sha256");
	hash.update(`pglite ${installed("@electric-sql/pglite")}\ndrizzle-orm ${installed("drizzle-orm")}\n`);
	const files = (readdirSync(folder, {
		recursive: true,
		withFileTypes: true,
	}))
		.filter((entry) => entry.isFile())
		.map((entry) => join(entry.parentPath, entry.name))
		.sort();
	for (const file of files)
	{
		hash.update(`${relative(folder, file)}\n`);
		hash.update(readFileSync(file));
	}
	return hash.digest("hex").slice(0, 16);
}

/** Migrates a fresh PGlite and writes its data directory to `path`, atomically (a temporary name, then a rename). */
export async function writeSnapshot(path: string): Promise<void>
{
	const { pglite } = await migratedPglite();
	const dump = await pglite.dumpDataDir("none");
	await pglite.close();
	const partial = `${path}.${process.pid}.partial`;
	writeFileSync(partial, Buffer.from(await dump.arrayBuffer()));
	renameSync(partial, path);
}

/**
 * Vitest's global setup: builds the snapshot when no run has yet, and hands its path to the workers. A leftover
 * `.partial` over an hour old (a run killed while writing) is removed first; `migratedPglite` names the file if one fails to load.
 */
export default async function setup(project: TestProject): Promise<void>
{
	const path = join(tmpdir(), `bt-pglite-${snapshotKey()}.tar`);
	// Only an hour-old one: a younger one may be another worktree's run still writing.
	for (const name of readdirSync(tmpdir()).filter((file) => file.startsWith("bt-pglite-") && file.endsWith(".partial")))
	{
		// Another worktree may delete it first, or it may be another user's: a failed clean-up never fails the run.
		try
		{
			const partial = join(tmpdir(), name);
			if (Date.now() - statSync(partial).mtimeMs > 3_600_000) rmSync(partial, {
				force: true,
			});
		}
		catch
		{
			continue;
		}
	}
	if (!existsSync(path)) await writeSnapshot(path);
	project.provide("pgliteSnapshot", path);
}
