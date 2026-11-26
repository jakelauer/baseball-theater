/**
 * Setup file for the functions Node tests: points `migratedPglite` in this worker at the snapshot
 * `pglite-snapshot.ts` built for the run, so each test file loads a migrated database instead of
 * migrating one. Vitest's `inject` is how a global setup's value reaches a worker.
 *
 * It also closes every PGlite `migratedPglite` opens (#652): each holds ~259 MB of WebAssembly memory
 * until closed, and tests open several per file, so left open they ran a worker out of memory. One
 * opened while a test runs (in the test or its `beforeEach`) is closed when that test finishes; one
 * opened in a `beforeAll` or at module level is closed after the file's own `afterAll` hooks (Vitest
 * runs after-hooks in reverse, so this file's, registered first, runs last).
 */
import type { PGlite } from "@electric-sql/pglite";
import {
	afterAll, inject, onTestFinished,
} from "vitest";
import { getCurrentTest } from "vitest/suite";
import { onMigratedPgliteOpened, PGLITE_SNAPSHOT_ENV } from "../adapters/postgres/migrate.js";

process.env[PGLITE_SNAPSHOT_ENV] = inject("pgliteSnapshot");

const openForFile: PGlite[] = [];

/** Closes `pglite` unless the test already did (some close their own, and a second close throws). */
async function release(pglite: PGlite): Promise<void>
{
	if (!pglite.closed) await pglite.close();
}

onMigratedPgliteOpened((pglite) =>
{
	if (getCurrentTest()) onTestFinished(() => release(pglite));
	else openForFile.push(pglite);
});

afterAll(async () =>
{
	await Promise.all(openForFile.splice(0).map(release));
});
