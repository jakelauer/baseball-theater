import { spawnSync } from "node:child_process";
import {
	mkdtemp, readFile, rm, symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	describe, expect, it,
} from "vitest";
import {
	GENERATED_DIR, GENERATED_FILE, renderApiTypes, writeApiTypes,
} from "./codegen.js";

// ADR-016's freshness rule, enforced in CI: the committed src/api/generated/ output
// must be exactly what the generator renders from the committed spec today.
describe("src/api/generated/ drift gate", () =>
{
	it("matches a fresh render of openapi/bt-api.v1.json", async () =>
	{
		const committed = await readFile(join(GENERATED_DIR, GENERATED_FILE), "utf8");
		expect(committed).toBe(await renderApiTypes());
	});

	it("writes the render, banner first, into the directory it is given", async () =>
	{
		const dir = await mkdtemp(join(tmpdir(), "bt-api-types-"));
		try
		{
			const file = await writeApiTypes(join(dir, "nested"));
			const written = await readFile(file, "utf8");
			expect(written.split("\n").slice(0, 5).join("\n")).toContain("@generated");
			expect(written).toBe(await renderApiTypes());
		}
		finally
		{
			await rm(dir, {
				recursive: true,
				force: true,
			});
		}
	});

	// S169 (issue #315): `pnpm --filter @bt/web api:types` runs this file with Node. Started through a
	// symlinked folder, the old `process.argv[1] === fileURLToPath(import.meta.url)` guard was false
	// (Node resolves the module's path, not argv[1]), so it exited 0 and wrote nothing. The child
	// `node` process is outside jsdom, which swaps only this test's globals.
	it("started through a symlinked folder, writes the render into the directory it is given", async () =>
	{
		const dir = await mkdtemp(join(tmpdir(), "bt-api-types-link-"));
		try
		{
			// Resolved from the `import.meta.url` string, as codegen.ts does: jsdom swaps in its own `URL`.
			const link = join(dir, "api");
			await symlink(dirname(fileURLToPath(import.meta.url)), link, "dir");
			const out = join(dir, "out");
			const run = spawnSync(process.execPath, [join(link, "codegen.ts"), out], {
				encoding: "utf8",
			});
			expect(run.status, run.stderr).toBe(0);
			expect(await readFile(join(out, GENERATED_FILE), "utf8")).toBe(await renderApiTypes());
		}
		finally
		{
			await rm(dir, {
				recursive: true,
				force: true,
			});
		}
	});
});
