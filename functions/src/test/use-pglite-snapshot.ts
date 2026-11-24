/**
 * Setup file for the functions Node tests: points `migratedPglite` in this worker at the snapshot
 * `pglite-snapshot.ts` built for the run, so each test file loads a migrated database instead of
 * migrating one. Vitest's `inject` is how a global setup's value reaches a worker.
 */
import { inject } from "vitest";
import { PGLITE_SNAPSHOT_ENV } from "../adapters/postgres/migrate.js";

process.env[PGLITE_SNAPSHOT_ENV] = inject("pgliteSnapshot");
