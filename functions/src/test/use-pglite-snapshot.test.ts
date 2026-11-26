/**
 * The functions tests' setup file (use-pglite-snapshot.ts) closes every PGlite `migratedPglite` opens (#652): one
 * opened in a test or its `beforeEach` when that test finishes, one opened in a `beforeAll` or at module level when
 * the file finishes. Before, nothing closed them, so each left ~259 MB of WebAssembly memory resident and a worker's
 * memory grew with every call until `pnpm verify` ran out of it.
 */
import type { PGlite } from "@electric-sql/pglite";
import {
	beforeAll, beforeEach, describe, expect, it,
} from "vitest";
import { migratedPglite } from "../adapters/postgres/migrate.js";

describe("PGlites opened by migratedPglite in the functions tests (#652)", () =>
{
	let fileWide: PGlite | undefined;
	let inTest: PGlite | undefined;
	let inBeforeEach: PGlite | undefined;
	let lastBeforeEach: PGlite | undefined;

	beforeAll(async () =>
	{
		fileWide = (await migratedPglite()).pglite;
	});

	beforeEach(async () =>
	{
		lastBeforeEach = inBeforeEach;
		inBeforeEach = (await migratedPglite()).pglite;
	});

	it("opens one inside a test", async () =>
	{
		inTest = (await migratedPglite()).pglite;
		expect(inTest.closed).toBe(false);
	});

	it("closed the previous test's instances once it finished, and keeps the file's own open (#652)", () =>
	{
		expect(inTest?.closed).toBe(true);
		expect(lastBeforeEach?.closed).toBe(true);
		expect(inBeforeEach?.closed).toBe(false);
		expect(fileWide?.closed).toBe(false);
	});
});
