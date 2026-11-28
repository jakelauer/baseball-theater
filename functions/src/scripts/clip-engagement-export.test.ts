/**
 * S174 AC 7: `pnpm clips:engagement-export --from --to` writes the counts of an inclusive range of UTC days as JSON
 * lines, one per row, run here against the memory adapter; a range with no rows leaves an empty file and exits 0.
 */
import {
	mkdtempSync, readFileSync, rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	afterEach, describe, expect, it,
} from "vitest";
import { InMemoryClipEngagementRepository } from "../adapters/memory/repos.js";
import { parseClipExportArgs, runClipEngagementExport } from "./clip-engagement-export.js";

const dirs: string[] = [];

/** A fresh directory for `--out`, removed after the test. */
function scratch(): string
{
	const dir = mkdtempSync(path.join(tmpdir(), "bt-clip-export-"));
	dirs.push(dir);
	return dir;
}

afterEach(() =>
{
	for (const dir of dirs.splice(0)) rmSync(dir, {
		recursive: true,
		force: true,
	});
});

/** The memory store with a row on each of four days. */
async function seeded(): Promise<InMemoryClipEngagementRepository>
{
	const counts = new InMemoryClipEngagementRepository();
	await counts.record("hl-a", 744834, "2026-11-21", "start", 1);
	await counts.record("hl-b", 744834, "2026-11-22", "start", 2);
	await counts.record("hl-b", 744834, "2026-11-22", "start", 2);
	await counts.record("hl-c", 823823, "2026-11-23", "complete", 0);
	await counts.record("hl-d", 823823, "2026-11-24", "start", 3);
	return counts;
}

describe("pnpm clips:engagement-export (S174 AC 7)", () =>
{
	it("S174 AC 7: writes the inclusive range's rows as JSON lines, one per row, to --out (relative to where it was typed)", async () =>
	{
		const dir = scratch();
		const errors: string[] = [];
		const code = await runClipEngagementExport(await seeded(), ["--from", "2026-11-22", "--to=2026-11-23", "--out", "counts.jsonl"], {
			cwd: dir,
			stdout: () => undefined,
			error: (text) => errors.push(text),
		});
		expect([code, errors]).toEqual([0, []]);
		const lines = readFileSync(path.join(dir, "counts.jsonl"), "utf8").split("\n");
		expect(lines.pop()).toBe("");
		expect(lines.map((line) => JSON.parse(line) as unknown)).toEqual([
			{
				mediaId: "hl-b",
				gamePk: 744834,
				viewDay: "2026-11-22",
				event: "start",
				shownPosition: 2,
				count: 2,
			},
			{
				mediaId: "hl-c",
				gamePk: 823823,
				viewDay: "2026-11-23",
				event: "complete",
				shownPosition: 0,
				count: 1,
			},
		]);
	});

	it("S174 AC 7: a range with no rows writes an empty file and exits 0", async () =>
	{
		const dir = scratch();
		const out = path.join(dir, "none.jsonl");
		const code = await runClipEngagementExport(await seeded(), ["--from", "2027-01-01", "--to", "2027-01-31", "--out", out], {
			cwd: "/",
			stdout: () => undefined,
			error: () => undefined,
		});
		expect(code).toBe(0);
		expect(readFileSync(out, "utf8")).toBe("");
	});

	it("S174 AC 7: without --out the lines go to standard output", async () =>
	{
		let written = "";
		const code = await runClipEngagementExport(await seeded(), ["--from", "2026-11-24", "--to", "2026-11-24"], {
			cwd: "/",
			stdout: (text) =>
			{
				written += text;
			},
			error: () => undefined,
		});
		expect(code).toBe(0);
		expect(written).toBe(`${JSON.stringify({
			mediaId: "hl-d",
			gamePk: 823823,
			viewDay: "2026-11-24",
			event: "start",
			shownPosition: 3,
			count: 1,
		})}\n`);
	});

	it("S174 AC 7: refuses arguments it can't read with exit 2 and the usage, writing nothing", async () =>
	{
		for (const argv of [[], ["--from", "2026-11-22"], ["--from", "2026-11-22", "--to", "2026-02-30"], ["--from", "2026-11-23", "--to", "2026-11-22"], ["--to", "2026-11-22", "--from"], ["--format", "csv"]])
		{
			const errors: string[] = [];
			let written = "";
			const code = await runClipEngagementExport(await seeded(), argv, {
				cwd: "/",
				stdout: (text) =>
				{
					written += text;
				},
				error: (text) => errors.push(text),
			});
			expect(code, argv.join(" ")).toBe(2);
			expect(errors[0]).toContain("usage: pnpm clips:engagement-export");
			expect(written).toBe("");
		}
		expect(parseClipExportArgs(["--from=2026-11-01", "--to=2026-11-30"])).toEqual({
			from: "2026-11-01",
			to: "2026-11-30",
			out: null,
		});
	});
});
