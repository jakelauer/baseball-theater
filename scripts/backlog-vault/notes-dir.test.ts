import {
	existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
	afterEach, beforeEach, describe, expect, it,
} from "vitest";
import { buildFromNotes } from "./assemble.ts";
import { FIXTURE, notesFor } from "./fixture.ts";
import {
	misplacedNotes, readNotes, writeNotes,
} from "./notes-dir.ts";

let dir = "";
const quiet = () => undefined;

function write(path: string, content: string)
{
	mkdirSync(dirname(join(dir, path)), {
		recursive: true,
	});
	writeFileSync(join(dir, path), content);
}

const bug = (status: string) => `---\nid: B74\nissue: 74\ntitle: A bug\npriority: 3\nstatus: ${status}\n---\n\nhttps://github.com/o/r/issues/74\n`;

beforeEach(() =>
{
	dir = mkdtempSync(join(tmpdir(), "backlog-notes-dir-"));
	for (const [path, content] of notesFor(FIXTURE))
	{
		write(path, content);
	}
});

afterEach(() =>
{
	rmSync(dir, {
		recursive: true,
		force: true,
	});
});

describe("readNotes", () =>
{
	it("reads every .md under bugs/, a misnamed or misfiled one included, and nothing else there", async () =>
	{
		write("bugs/todo/B74.md", bug("todo"));
		write("bugs/todo/x/B75.md", "x");
		write("bugs/b76.md", "x");
		write("bugs/todo/.DS_Store", "x");
		const keys = [...(await readNotes(dir)).keys()].filter((k) => k.startsWith("bugs/"));
		expect(keys.sort()).toEqual(["bugs/b76.md", "bugs/todo/B74.md", "bugs/todo/x/B75.md"]);
	});
});

describe("misplacedNotes", () =>
{
	it("names a bug note in the wrong status folder and where it belongs", async () =>
	{
		write("bugs/doing/B74.md", bug("todo"));
		const notes = await readNotes(dir);
		expect(misplacedNotes(notes, buildFromNotes(notes).notes)).toEqual(["B74: bugs/doing/B74.md belongs in bugs/todo/B74.md (its status names the folder)"]);
	});
});

describe("writeNotes", () =>
{
	it("moves a bug note to its status folder and removes the bug folder it emptied (a lone .DS_Store counts as empty)", async () =>
	{
		write("bugs/doing/B74.md", bug("todo"));
		write("bugs/doing/.DS_Store", "x");
		const notes = await readNotes(dir);
		await writeNotes(dir, notes, buildFromNotes(notes).notes, quiet);
		expect(readFileSync(join(dir, "bugs/todo/B74.md"), "utf8")).toBe(bug("todo"));
		expect(existsSync(join(dir, "bugs/doing"))).toBe(false);
	});
});
