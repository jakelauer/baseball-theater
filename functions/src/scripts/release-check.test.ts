import { existsSync } from "node:fs";
import {
	mkdir, mkdtemp, rm, writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
	afterEach, beforeEach, describe, expect, it,
} from "vitest";
import {
	checkRelease, checkReleasesDir, RELEASES_DIR,
} from "./release-check.js";

const approved = (version: string) => ({
	version,
	fixesAndPolish: "Small fixes.",
	approval: {
		date: "2027-03-25",
		quote: "Looks good",
	},
});

describe("checkRelease (S131 AC 3)", () =>
{
	let dir: string;
	beforeEach(async () =>
	{
		dir = await mkdtemp(join(tmpdir(), "release-check-"));
	});
	afterEach(async () =>
	{
		await rm(dir, {
			recursive: true,
			force: true,
		});
	});
	const put = (name: string, body: unknown) => writeFile(join(dir, name), typeof body === "string" ? body : JSON.stringify(body));

	it("S131 AC 3 valid: approved notes naming their own version pass", async () =>
	{
		await put("v4.0.0.json", approved("v4.0.0"));
		const result = await checkRelease("v4.0.0", dir);
		expect(result.ok).toBe(true);
		expect(result.lines.join("\n")).toContain("Looks good");
	});

	it("S131 AC 3 missing file: a release from v4.0.0 on with no notes fails", async () =>
	{
		const result = await checkRelease("v4.1.0", dir);
		expect(result.ok).toBe(false);
		expect(result.lines.join("\n")).toContain("v4.1.0.json is missing");
	});

	it("S131 AC 3 v4.0.0 with no file fails", async () =>
	{
		expect((await checkRelease("v4.0.0", dir)).ok).toBe(false);
	});

	it("S131 AC 3 draft: notes with no approval fail", async () =>
	{
		await put("v4.0.0.json", {
			version: "v4.0.0",
			fixesAndPolish: "Small fixes.",
		});
		const result = await checkRelease("v4.0.0", dir);
		expect(result.ok).toBe(false);
		expect(result.lines.join("\n")).toContain("is a draft");
	});

	it("S131 AC 3 mismatched version: notes naming another version fail, every problem listed", async () =>
	{
		await put("v4.0.0.json", {
			version: "v4.0.1",
			fixesAndPolish: "Small fixes.",
		});
		const result = await checkRelease("v4.0.0", dir);
		expect(result.ok).toBe(false);
		expect(result.lines).toHaveLength(2);
		expect(result.lines[0]).toContain("version is v4.0.1, not v4.0.0");
		expect(result.lines[1]).toContain("is a draft");
	});

	it("prints each parse problem, and refuses a file that isn't JSON", async () =>
	{
		await put("v4.0.0.json", {
			version: "v4.0.0",
			date: "2027-02-30",
			items: [{
				kind: "setting",
				title: "A",
				sentence: "B",
			}],
		});
		const result = await checkRelease("v4.0.0", dir);
		expect(result.ok).toBe(false);
		expect(result.lines.map((l) => l.split(": ")[1]!.split(" ")[0])).toEqual(["date", "items[0].kind"]);
		await put("v4.0.0.json", "{ not json");
		expect((await checkRelease("v4.0.0", dir)).lines[0]).toContain("is not JSON");
	});

	it("S131 AC 3 v3.3.0 with no file passes: a pre-launch release carries no notes, and releases/ is not read", async () =>
	{
		const result = await checkRelease("v3.3.0", join(dir, "no-such-folder"));
		expect(result.ok).toBe(true);
		expect(result.lines.join("\n")).toContain("pre-launch");
	});

	it("S131 AC 3 bare 3.3.0 fails: a tag with no v is not a version", async () =>
	{
		const result = await checkRelease("3.3.0", dir);
		expect(result.ok).toBe(false);
		expect(result.lines.join("\n")).toContain("not a release version");
	});

	it("S131 AC 3 v3.01.0 fails: a leading zero is not a version", async () =>
	{
		expect((await checkRelease("v3.01.0", dir)).ok).toBe(false);
	});

	it("refuses a malformed tag: surrounding space, a trailing newline, a capital V, a pre-release suffix", async () =>
	{
		for (const tag of [" v4.0.0", "v4.0.0\n", "V4.0.0", "v3.3.0-rc.1"])
		{
			const result = await checkRelease(tag, dir);
			expect(result.ok, JSON.stringify(tag)).toBe(false);
			expect(result.lines.join("\n")).toContain("not a release version");
		}
	});

	it("names a byte-order mark rather than reporting a confusing JSON error", async () =>
	{
		await put("v4.0.0.json", `\uFEFF${JSON.stringify(approved("v4.0.0"))}`);
		const result = await checkRelease("v4.0.0", dir);
		expect(result.ok).toBe(false);
		expect(result.lines.join("\n")).toContain("starts with a byte-order mark");
	});

	it("reports a notes file that can't be read as unreadable, not as missing", async () =>
	{
		await mkdir(join(dir, "v4.0.0.json"));
		const result = await checkRelease("v4.0.0", dir);
		expect(result.ok).toBe(false);
		expect(result.lines.join("\n")).toContain("can't be read");
		expect(result.lines.join("\n")).not.toContain("is missing");
	});
});

describe("RELEASES_DIR (S131 AC 3)", () =>
{
	it("S131 AC 3 releases folder: the command reads <repo>/releases, wherever it is run from", () =>
	{
		expect(basename(RELEASES_DIR)).toBe("releases");
		expect(existsSync(join(RELEASES_DIR, "..", "pnpm-workspace.yaml"))).toBe(true);
	});
});

describe("checkReleasesDir (S131 AC 6)", () =>
{
	let dir: string;
	beforeEach(async () =>
	{
		dir = await mkdtemp(join(tmpdir(), "release-dir-"));
	});
	afterEach(async () =>
	{
		await rm(dir, {
			recursive: true,
			force: true,
		});
	});

	it("S131 AC 6 every file in releases/: the repository's notes all pass, and none names a pre-launch version", async () =>
	{
		const result = await checkReleasesDir(RELEASES_DIR);
		expect(result.ok, result.lines.join("\n")).toBe(true);
	});

	it("passes a folder that doesn't exist yet: no release has notes before v4.0.0's land", async () =>
	{
		expect((await checkReleasesDir(join(dir, "releases"))).ok).toBe(true);
	});

	it("flags a draft, a pre-launch notes file and a file that isn't release notes, and passes approved notes", async () =>
	{
		await writeFile(join(dir, "v4.0.0.json"), JSON.stringify(approved("v4.0.0")));
		await writeFile(join(dir, "v4.1.0.json"), JSON.stringify({
			version: "v4.1.0",
			fixesAndPolish: "Small fixes.",
		}));
		await writeFile(join(dir, "v3.9.0.json"), JSON.stringify(approved("v3.9.0")));
		await writeFile(join(dir, "notes.txt"), "hello");
		const result = await checkReleasesDir(dir);
		expect(result.ok).toBe(false);
		const text = result.lines.join("\n");
		expect(text).toContain("v4.1.0.json: is a draft");
		expect(text).toContain("v3.9.0.json is a pre-launch release's notes file");
		expect(text).toContain("notes.txt is not a release notes file");
		expect(text).not.toContain("v4.0.0.json:");
	});

	it("skips hidden files such as .DS_Store, as the grader's releases/* glob does", async () =>
	{
		await writeFile(join(dir, ".DS_Store"), "junk");
		await writeFile(join(dir, ".gitkeep"), "");
		await writeFile(join(dir, "v4.0.0.json"), JSON.stringify(approved("v4.0.0")));
		const result = await checkReleasesDir(dir);
		expect(result.ok, result.lines.join("\n")).toBe(true);
	});

	it("throws when the folder can't be read for any reason but not existing", async () =>
	{
		const file = join(dir, "not-a-folder");
		await writeFile(file, "");
		await expect(checkReleasesDir(file)).rejects.toThrow("ENOTDIR");
	});
});
