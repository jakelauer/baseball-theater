import {
	mkdtemp, rm, writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	afterEach, beforeEach, describe, expect, it,
} from "vitest";
import { checkRelease } from "./release-check.js";

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
});
