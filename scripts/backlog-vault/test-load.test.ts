/**
 * Two `pnpm verify` runs at once (S156 AC 1, #116). Vitest starts one fork per core but one by default,
 * and Turborepo runs the web and functions suites together, so two worktrees' gates started ~68 workers
 * on 18 cores: a migrated PGlite then took 4–9 s instead of ~0.5 s, and `beforeAll` hooks (10 s default)
 * and web's 1 s `findBy` waits timed out. These pins keep the caps that made two concurrent gates pass,
 * and keep the HTTP test servers on the loopback address their requests go to, so another process's
 * listener on the same port can't answer them.
 */
import { readdirSync, readFileSync } from "node:fs";
import {
	dirname, join, relative,
} from "node:path";
import { fileURLToPath } from "node:url";
import {
	describe, expect, it,
} from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

interface TestConfig { test: { maxWorkers?: number | string;
	hookTimeout?: number;
	testTimeout?: number } }

/** The `test` block of a package's Node Vitest config. */
async function testBlock(path: string): Promise<TestConfig["test"]>
{
	return (await import(join(ROOT, path)) as { default: TestConfig }).default.test;
}

/** Every `.ts` file under `dir`, recursively. */
function tsFiles(dir: string): string[]
{
	return readdirSync(dir, {
		withFileTypes: true,
	}).flatMap((e) =>
	{
		const p = join(dir, e.name);
		return e.isDirectory() ? tsFiles(p) : e.name.endsWith(".ts") ? [p] : [];
	});
}

describe("concurrent pnpm verify runs stay within the machine (#116)", () =>
{
	it("web and functions cap their workers", async () =>
	{
		for (const path of ["web/vitest.config.ts", "functions/vitest.config.ts"])
		{
			const max = (await testBlock(path)).maxWorkers;
			expect(typeof max, `${path} sets no maxWorkers`).toBe("number");
			expect(max).toBeGreaterThan(0);
			expect(max).toBeLessThanOrEqual(4);
		}
	});

	it("functions' hooks get the same time as its tests", async () =>
	{
		const test = await testBlock("functions/vitest.config.ts");
		expect(test.hookTimeout).toBeGreaterThanOrEqual(20_000);
		expect(test.hookTimeout).toBe(test.testTimeout);
	});

	it("every functions test server listens on 127.0.0.1, where its requests go", () =>
	{
		const loose = tsFiles(join(ROOT, "functions/src"))
			.filter((f) => /\.listen\(\s*0\s*(,(?!\s*"127\.0\.0\.1")|\))/.test(readFileSync(f, "utf8")))
			.map((f) => relative(ROOT, f));
		expect(loose).toEqual([]);
	});
});
