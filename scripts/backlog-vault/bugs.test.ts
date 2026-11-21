import {
	describe, expect, it,
} from "vitest";
import { buildFromNotes } from "./assemble.ts";
import {
	BugNoteError, bugsIn, placeBugNotes, readBugNote,
} from "./bugs.ts";
import { FIXTURE, notesFor } from "./fixture.ts";

const note = (fields: Record<string, string | number>, body = "https://github.com/o/r/issues/74\n") =>
	`---\n${Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join("\n")}\n---\n\n${body}`;

const B74 = {
	id: "B74",
	issue: 74,
	title: "A game under review looks not started",
	priority: 82.5,
	status: "todo",
};

describe("readBugNote", () =>
{
	it("reads the ID, issue, title, priority (fractional allowed) and status", () =>
	{
		expect(readBugNote("bugs/todo/B74.md", note(B74))).toEqual(B74);
	});

	it("refuses an ID that isn't the file name or the issue number, a bad priority and an unknown status", () =>
	{
		expect(() => readBugNote("bugs/todo/B75.md", note(B74))).toThrow(/does not match the file name/);
		expect(() => readBugNote("bugs/todo/B74.md", note({
			...B74,
			issue: 75,
		}))).toThrow(/'issue' must be the issue number in the ID \(74\)/);
		expect(() => readBugNote("bugs/todo/B74.md", note({
			...B74,
			priority: "soon",
		}))).toThrow(/'priority' must be a number/);
		expect(() => readBugNote("bugs/todo/B74.md", note({
			...B74,
			status: "fixed",
		}))).toThrow(/'status' must be one of/);
		expect(() => readBugNote("bugs/todo/B74.md", "no frontmatter")).toThrow(BugNoteError);
	});

	it("refuses an issue number written as a string, an infinite priority and a missing title", () =>
	{
		expect(() => readBugNote("bugs/todo/B74.md", note({
			...B74,
			issue: "\"74\"",
		}))).toThrow(/'issue' must be the issue number in the ID \(74\)/);
		expect(() => readBugNote("bugs/todo/B74.md", note({
			...B74,
			priority: ".inf",
		}))).toThrow(/'priority' must be a number/);
		const untitled = Object.fromEntries(Object.entries(B74).filter(([key]) => key !== "title"));
		expect(() => readBugNote("bugs/todo/B74.md", note(untitled))).toThrow(/'title' must be a non-empty string/);
	});

	it("names the note when its frontmatter is not valid YAML", () =>
	{
		expect(() => readBugNote("bugs/todo/B74.md", "---\nid: [\n---\n")).toThrow(/^bugs\/todo\/B74\.md: frontmatter is not valid YAML/);
	});

	it("refuses a frontmatter key a bug note doesn't take", () =>
	{
		expect(() => readBugNote("bugs/todo/B74.md", note({
			...B74,
			depends_on: "S5",
		}))).toThrow(/takes only id, issue, title, priority, status; remove depends_on/);
	});

	it("accepts Obsidian's own properties, which its property editor adds", () =>
	{
		expect(readBugNote("bugs/todo/B74.md", note({
			...B74,
			tags: "[bug]",
			aliases: "[]",
			cssclasses: "[]",
		}))).toEqual(B74);
	});
});

describe("placeBugNotes", () =>
{
	it("moves a note to the folder its status names, keeping its text, and refuses two notes with one ID", () =>
	{
		const done = note({
			...B74,
			status: "done",
		});
		expect([...placeBugNotes(new Map([["bugs/todo/B74.md", done]]))]).toEqual([["bugs/done/B74.md", done]]);
		expect(() => placeBugNotes(new Map([["bugs/todo/B74.md", note(B74)], ["bugs/done/B74.md", done]]))).toThrow(/two notes share the ID B74/);
	});

	it("refuses any .md under bugs/ that isn't named bugs/<status>/B<issue>.md, so a new bug can't silently miss the order", () =>
	{
		for (const path of ["bugs/todo/b74.md", "bugs/B74 title.md", "bugs/Todo/B74.md", "bugs/todo/x/B74.md"])
		{
			expect(() => placeBugNotes(new Map([[path, note(B74)]])), path).toThrow(new RegExp(`^${path.replace(/[.]/g, "\\.")}: not a bug note's name`));
		}
	});
});

describe("buildFromNotes with bug notes", () =>
{
	it("keeps bug notes out of the assembled backlog document and returns them in their status folders", () =>
	{
		const stories = notesFor(FIXTURE);
		const withBug = new Map([...stories, ["bugs/B74.md", note(B74)]]);
		const built = buildFromNotes(withBug);
		expect(built.backlog).toBe(buildFromNotes(stories).backlog);
		expect(built.notes.get("bugs/todo/B74.md")).toBe(note(B74));
		expect(built.notes.has("bugs/B74.md")).toBe(false);
		expect(bugsIn(built.notes)).toEqual([B74]);
	});
});
