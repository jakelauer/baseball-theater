import {
	mkdtemp, readFile, rm, writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	afterEach, beforeEach, describe, expect, it,
} from "vitest";
import { RELEASES_DIR } from "./release-check.js";
import {
	readReleaseNotesDir, RELEASE_BUNDLE_FILE, renderReleaseBundle, writeReleaseBundle,
} from "./release-bundle.js";

/** One release's notes, approved unless `draft`. */
const notes = (version: string, draft = false) => ({
	version,
	headline: [],
	items: [{
		kind: "feature",
		title: `What ${version} adds`,
		sentence: "Something new.",
	}],
	...!draft && {
		approval: {
			date: "2027-03-25",
			quote: "Yes",
		},
	},
});

describe("release-notes bundle (S132 AC 3)", () =>
{
	let dir: string;
	beforeEach(async () =>
	{
		dir = await mkdtemp(join(tmpdir(), "bt-release-bundle-"));
	});
	afterEach(async () =>
	{
		await rm(dir, {
			recursive: true,
			force: true,
		});
	});
	const put = (name: string, value: unknown) => writeFile(join(dir, name), typeof value === "string" ? value : JSON.stringify(value));

	it("S132 AC 3 drift: the committed bundle is exactly what releases/ renders today", async () =>
	{
		expect(await readFile(RELEASE_BUNDLE_FILE, "utf8")).toBe(await renderReleaseBundle(RELEASES_DIR));
	});

	it("S132 AC 3 approved notes bundled: each file parsed with S131's parser, newest version first, drafts kept for the API to drop", async () =>
	{
		await put("v4.2.0.json", notes("v4.2.0"));
		await put("v4.10.0.json", notes("v4.10.0", true));
		await put("v4.9.0.json", notes("v4.9.0"));
		await put(".DS_Store", "not notes");
		const all = await readReleaseNotesDir(dir);
		expect(all.map((n) => n.version)).toEqual(["v4.10.0", "v4.9.0", "v4.2.0"]);
		// The parser fills a bucket the file left out.
		expect(all[0]).toMatchObject({
			version: "v4.10.0",
			headline: [],
		});
		expect(JSON.parse(await renderReleaseBundle(dir))).toEqual(all);
	});

	it("S132 AC 3 approved: an absent or empty folder bundles no notes", async () =>
	{
		expect(await readReleaseNotesDir(join(dir, "missing"))).toEqual([]);
		expect(await renderReleaseBundle(dir)).toBe("[]\n");
	});

	it("S132 AC 3 unparsable: refuses a file that isn't JSON, doesn't parse as notes, starts with a byte-order mark or isn't named for a version", async () =>
	{
		await put("v4.0.0.json", "{ not json");
		await put("v4.1.0.json", {
			version: "v4.1.0",
			items: [{
				kind: "rumor",
				title: "x",
				sentence: "y",
			}],
		});
		await put("v4.2.0.json", `\uFEFF${JSON.stringify(notes("v4.2.0"))}`);
		await put("notes.json", notes("v4.3.0"));
		const error = await readReleaseNotesDir(dir).then(() => null, (e: unknown) => e as Error);
		expect(error?.message).toContain("v4.0.0.json is not JSON");
		expect(error?.message).toContain("v4.1.0.json: items[0].kind must be one of");
		expect(error?.message).toContain("v4.2.0.json starts with a byte-order mark");
		expect(error?.message).toContain("notes.json is not a release notes file");
	});

	it("S132 AC 3 version mismatch: refuses a file whose version isn't the one its name gives, so two files can't claim one release", async () =>
	{
		await put("v4.0.0.json", notes("v4.0.0"));
		await put("v4.0.1.json", notes("v4.0.0"));
		await expect(readReleaseNotesDir(dir)).rejects.toThrow("v4.0.1.json: version is v4.0.0, not v4.0.1");
		await expect(writeReleaseBundle(dir, join(dir, "out", "bundle.json"))).rejects.toThrow("version is v4.0.0");
	});

	it("S132 AC 3 approved: writes the render into the file it is given", async () =>
	{
		await put("v4.0.0.json", notes("v4.0.0"));
		const out = await mkdtemp(join(tmpdir(), "bt-release-bundle-out-"));
		try
		{
			const file = await writeReleaseBundle(dir, join(out, "nested", "bundle.json"));
			expect(await readFile(file, "utf8")).toBe(await renderReleaseBundle(dir));
		}
		finally
		{
			await rm(out, {
				recursive: true,
				force: true,
			});
		}
	});
});
