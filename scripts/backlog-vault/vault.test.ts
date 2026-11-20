import { join } from "node:path";
import {
	describe, expect, it,
} from "vitest";
import { assembleBacklog } from "./assemble.ts";
import { readNotes } from "./notes-dir.ts";
import { parseBacklog } from "./parse.ts";
import type { Story } from "./parse.ts";
import {
	isNoteKey, noteId, renderNotes, renderStory,
} from "./vault.ts";

const story: Story = {
	id: "S26",
	title: "Typed *route* contract",
	tableTitle: "Typed route contract (`/api/v1`)",
	order: 4,
	section: "Stories",
	body: "\n**Depends on:** S21\n\n**Status:** `done`",
	status: "done",
	priority: 15,
	dependsOn: ["S21"],
	preferAfter: [],
	design: [],
	source: "Feature: Standings",
	turnCap: null,
	scopeFiles: ["packages/domain/"],
};

describe("renderStory", () =>
{
	it("writes canonical YAML frontmatter, then the body without its heading or Status line", () =>
	{
		expect(renderStory(story)).toBe([
			"---",
			"id: S26",
			"title: Typed *route* contract",
			"table_title: Typed route contract (`/api/v1`)",
			"priority: 15",
			"status: done",
			"section: Stories",
			"order: 4",
			"depends_on:",
			"  - \"[[S21]]\"",
			"prefer_after: []",
			"design: []",
			"source: feature",
			"turn_cap: null",
			"scope_files:",
			"  - packages/domain/",
			"---",
			"",
			"**Depends on:** S21",
			"",
		].join("\n"));
	});

	it("refuses a body that is not blank, content, blank, Status", () =>
	{
		expect(() => renderStory({
			...story,
			body: "\n**Depends on:** S21\n**Status:** `done`",
		})).toThrow(/S26: body must be/);
	});
});

describe("renderNotes", () =>
{
	it("renders one note per story in the real backlog, plus frame notes", async () =>
	{
		const markdown = assembleBacklog(await readNotes(join(import.meta.dirname, "../../docs/v3/backlog")));
		const files = renderNotes(parseBacklog(markdown));
		const headings = markdown.match(/^### S\d+ —/gm) ?? [];

		expect([...files.keys()].filter((p) => p.startsWith("stories/"))).toHaveLength(headings.length);
		expect([...files.keys()].some((p) => p.startsWith("frame/00 "))).toBe(true);
		for (const [path, content] of files)
		{
			if (path.startsWith("stories/"))
			{
				expect(content).not.toMatch(/^### S\d+ —|^\*\*Status:\*\*/m);
			}
		}
	});
});

describe("noteId and isNoteKey", () =>
{
	it("give a bug note's ID, flat or in a status folder, and no ID for a key that only looks like one", () =>
	{
		expect(noteId("bugs/todo/B74.md")).toBe("B74");
		expect(noteId("bugs/B74.md")).toBe("B74");
		for (const key of ["bugs/todo/S5.md", "stories/todo/B74.md", "bugs/a/b/B74.md"])
		{
			expect(noteId(key), key).toBeUndefined();
		}
	});

	it("read every .md under bugs/, so the build refuses a misnamed one instead of dropping it, and no other file", () =>
	{
		expect(isNoteKey("bugs/todo/B74.md")).toBe(true);
		expect(isNoteKey("bugs/a/b/B74.md")).toBe(true);
		expect(isNoteKey("bugs/todo/S5.md")).toBe(true);
		expect(isNoteKey("bugs/todo/.DS_Store")).toBe(false);
		expect(isNoteKey("stories/todo/B74.md")).toBe(false);
	});
});
