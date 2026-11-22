/**
 * run-directly.ts (S166 AC 1): the shared "started as a command?" check compares real paths, so a
 * script started through a symlinked folder runs its command line.
 */
import { spawnSync } from "node:child_process";
import {
	mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import {
	dirname, join, resolve,
} from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	afterEach, beforeEach, describe, expect, it,
} from "vitest";
import { isRunDirectly } from "./run-directly.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

let dir = "";
let real = "";
let link = "";
let url = "";
beforeEach(() =>
{
	// A file in `real/`, and `link` a symlink to that folder: the shape a macOS temp path has.
	dir = mkdtempSync(join(tmpdir(), "s166-run-directly-"));
	real = join(dir, "real");
	mkdirSync(real);
	writeFileSync(join(real, "script.ts"), "");
	writeFileSync(join(real, "other.ts"), "");
	link = join(dir, "link");
	symlinkSync(real, link, "dir");
	url = pathToFileURL(join(real, "script.ts")).href;
});
afterEach(() => rmSync(dir, {
	recursive: true,
	force: true,
}));

describe("isRunDirectly (AC 1)", () =>
{
	it("the real path is run directly", () =>
	{
		expect(isRunDirectly(url, join(real, "script.ts"))).toBe(true);
	});

	it("a path through a symlinked directory is run directly, where the old comparison said no", () =>
	{
		const through = join(link, "script.ts");
		expect(isRunDirectly(url, through)).toBe(true);
		// The comparison every script made before S166: false for these same inputs.
		expect(resolve(through) === fileURLToPath(url)).toBe(false);
	});

	it("a different file is not run directly", () =>
	{
		expect(isRunDirectly(url, join(real, "other.ts"))).toBe(false);
		expect(isRunDirectly(url, join(link, "other.ts"))).toBe(false);
	});

	it("undefined and an empty argv1 are not run directly", () =>
	{
		expect(isRunDirectly(url, undefined)).toBe(false);
		expect(isRunDirectly(url, "")).toBe(false);
	});

	it("a path that doesn't exist is not run directly and doesn't throw", () =>
	{
		expect(() => isRunDirectly(url, join(dir, "missing.ts"))).not.toThrow();
		expect(isRunDirectly(url, join(dir, "missing.ts"))).toBe(false);
		// Nor when the module itself is gone: the plain comparison answers.
		const gone = pathToFileURL(join(dir, "gone.ts")).href;
		expect(isRunDirectly(gone, join(dir, "gone.ts"))).toBe(true);
		expect(isRunDirectly(gone, join(real, "script.ts"))).toBe(false);
	});

	it("text-records.ts started through a symlinked folder prints its usage and exits nonzero", () =>
	{
		const vault = join(dir, "vault");
		symlinkSync(HERE, vault, "dir");
		const run = spawnSync(process.execPath, [join(vault, "text-records.ts")], {
			encoding: "utf8",
		});
		expect(run.status).not.toBe(0);
		expect(run.stderr).toContain("usage: text-records.ts");
	});
});
