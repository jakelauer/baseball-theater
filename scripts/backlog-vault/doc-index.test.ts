/**
 * doc-index.ts: docs/v3/INDEX.md, the docs index agents start from (owner, 2026-11-04:
 * cascading linked docs "whenever it is mostly lossless contextually") — section line
 * ranges, the numbered backlog rules, and the stories by status.
 */
import {
	describe, expect, it,
} from "vitest";
import type { LedgerState } from "./doc-index.ts";
import {
	asOfLine, baselineHistory, docIndexFor, isIndexedDoc, numberedRules, renderDocIndex, sections,
} from "./doc-index.ts";
import {
	AUDIT, FIXTURE, notesFor,
} from "./fixture.ts";
import { parseLedger } from "./ledger.ts";
import type { Story } from "./parse.ts";

/** A ledger with no entries, for the cases that are about something else. */
const NO_LEDGER: LedgerState = {
	entries: [],
	head: "abc1234",
};

const story = (id: string, status: string, priority: number, extra: Partial<Story> = {}): Story => ({
	id,
	title: `${id} title`,
	tableTitle: `${id} table title`,
	order: 1,
	section: "Stories",
	body: "",
	status,
	priority,
	dependsOn: [],
	preferAfter: [],
	design: [],
	source: null,
	turnCap: null,
	scopeFiles: [],
	...extra,
});

describe("sections", () =>
{
	it("gives each heading the lines up to the next heading at its level or above, skipping fenced code", () =>
	{
		const text = ["# Title", "intro", "## One", "a", "### One.a", "b", "```", "## not a heading", "```", "## Two", "c", ""].join("\n");
		expect(sections(text)).toEqual([
			{
				level: 2,
				title: "One",
				start: 3,
				end: 9,
			},
			{
				level: 3,
				title: "One.a",
				start: 5,
				end: 9,
			},
			{
				level: 2,
				title: "Two",
				start: 10,
				end: 11,
			},
		]);
	});
});

describe("numberedRules", () =>
{
	it("indexes the opening section's numbered list, as plain first sentences, and stops at its first sub-heading", () =>
	{
		const text = [
			"# Backlog",
			"1. **First rule.** More text.",
			"2. A [linked](#x) `code` rule that keeps going",
			"   onto an indented line.",
			"",
			"Unindented paragraph after the list.",
			"### Later",
			"1. **Not a rule.**",
		].join("\n");
		expect(numberedRules(text)).toEqual([
			{
				level: 0,
				title: "1. First rule.",
				start: 2,
				end: 2,
			},
			{
				level: 0,
				title: "2. A linked code rule that keeps going",
				start: 3,
				end: 4,
			},
		]);
	});

	it("shortens a long first sentence to 90 characters", () =>
	{
		expect(numberedRules(`1. ${"word ".repeat(40)}`)[0]!.title).toHaveLength(93);
	});
});

describe("renderDocIndex", () =>
{
	const big = (heading: string) => `# Big doc\n\n## ${heading}\n\n${"x".repeat(13_000)}\n`;

	it("lists every doc with its size, sections only for large ones, and the rules of the first frame note", () =>
	{
		const index = renderDocIndex({
			docs: [{
				path: "SMALL.md",
				text: "# Small doc\n\n## Hidden section\n",
			}, {
				path: "ARCHITECTURE.md",
				text: big("ADR-001 — Something"),
			}, {
				path: "AUDIT.md",
				text: "not listed as a doc",
			}],
			frame: [{
				path: "backlog/frame/00 Rules.md",
				text: `# Rules\n1. **Rule one.**\n\n## Section\n${"y".repeat(13_000)}\n`,
			}],
			stories: [],
			ledger: NO_LEDGER,
		});
		expect(index).toContain("- [SMALL.md — Small doc](SMALL.md) — 1 KB");
		expect(index).not.toContain("Hidden section");
		expect(index).toContain("- [ARCHITECTURE.md — Big doc](ARCHITECTURE.md) — 13 KB\n  - `3–5` ADR-001 — Something");
		expect(index).toContain("- [00 Rules](<backlog/frame/00 Rules.md>) — 13 KB");
		expect(index).toContain("    - `2–2` 1. Rule one.");
		expect(index).not.toContain("not listed as a doc");
	});

	it("tables the open stories (doing, todo, blocked; by priority) and lists the rest by status", () =>
	{
		const index = renderDocIndex({
			docs: [],
			frame: [],
			stories: [
				story("S3", "blocked", 1),
				story("S2", "todo", 5, {
					dependsOn: ["S1"],
					design: ["S9"],
				}),
				story("S4", "todo", 2),
				story("S1", "done", 3),
				story("S5", "doing", 9),
				story("S6", "superseded", 4),
			],
			ledger: NO_LEDGER,
		});
		const rows = index.split("\n").filter((l) => l.startsWith("| ") && !l.startsWith("| Priority"));
		expect(rows.map((r) => /\[(S\d+)\]/.exec(r)?.[1])).toEqual(["S5", "S4", "S2", "S3"]);
		expect(index).toContain("| 5 | [S2](backlog/stories/todo/S2.md) S2 table title | `todo` | S1 | S9 |");
		expect(index).toContain("**`done`** (1): [S1](backlog/stories/done/S1.md)");
		expect(index).toContain("**`superseded`** (1): [S6](backlog/stories/superseded/S6.md)");
	});

	it("puts open bugs in the same table as the stories, in one priority order, and lists the rest as bugs by status", () =>
	{
		const bug = (id: string, status: string, priority: number) => ({
			id,
			issue: Number(id.slice(1)),
			title: `${id} | title`,
			priority,
			status,
		});
		const index = renderDocIndex({
			docs: [],
			frame: [],
			stories: [story("S2", "todo", 5), story("S4", "todo", 2), story("S5", "doing", 9)],
			bugs: [bug("B74", "todo", 4.5), bug("B80", "doing", 1), bug("B71", "done", 0), bug("B9", "blocked", 0)],
			ledger: NO_LEDGER,
		});
		const rows = index.split("\n").filter((l) => l.startsWith("| ") && !l.startsWith("| Priority"));
		expect(rows.map((r) => /\[([SB]\d+)\]/.exec(r)?.[1])).toEqual(["B80", "S5", "S4", "B74", "S2", "B9"]);
		expect(index).toContain("| 4.5 | [B74](backlog/bugs/todo/B74.md) Bug #74: B74 \\| title | `todo` | — | — |");
		expect(index).toContain("**Bugs `done`** (1): [B71](backlog/bugs/done/B71.md)");
	});

	it("puts a bug before a story of equal priority, and lists closed bugs by issue number", () =>
	{
		const bug = (id: string, status: string, priority: number) => ({
			id,
			issue: Number(id.slice(1)),
			title: id,
			priority,
			status,
		});
		const index = renderDocIndex({
			docs: [],
			frame: [],
			stories: [story("S2", "todo", 5)],
			bugs: [bug("B74", "todo", 5), bug("B80", "done", 1), bug("B71", "done", 2)],
			ledger: NO_LEDGER,
		});
		const rows = index.split("\n").filter((l) => l.startsWith("| ") && !l.startsWith("| Priority"));
		expect(rows.map((r) => /\[([SB]\d+)\]/.exec(r)?.[1])).toEqual(["B74", "S2"]);
		expect(index).toContain("**Bugs `done`** (2): [B71](backlog/bugs/done/B71.md), [B80](backlog/bugs/done/B80.md)");
	});
});

describe("isIndexedDoc", () =>
{
	it("takes Markdown directly in docs/v3/, not subfolders or the index itself", () =>
	{
		expect(["ARCHITECTURE.md", "INDEX.md", "visual/x/DESIGN.md", "audit.jsonl"].map(isIndexedDoc)).toEqual([true, false, false, false]);
	});
});

describe("docIndexFor", () =>
{
	it("lists the bug notes among the built notes", () =>
	{
		const bugNote = "---\nid: B74\nissue: 74\ntitle: A bug\npriority: 3\nstatus: todo\n---\n\nhttps://github.com/o/r/issues/74\n";
		const index = docIndexFor(FIXTURE, new Map([...notesFor(FIXTURE), ["bugs/todo/B74.md", bugNote]]), [], NO_LEDGER);
		expect(index).toContain("| 3 | [B74](backlog/bugs/todo/B74.md) Bug #74: A bug | `todo` | — | — |");
	});

	it("carries the generated Next and review-debt lines (BACKLOG.md, which held them, is retired)", () =>
	{
		const index = docIndexFor(FIXTURE, notesFor(FIXTURE), [], {
			entries: parseLedger(AUDIT),
			head: "abc1234",
		});
		expect(index).toContain("**Next (generated):** **1 / S9** — the lowest **Priority** `todo` story not waiting on a design.");
		expect(index).toContain("**Review debt (generated from the ledger):** 1 of 6 stories `done` since the last backlog review");
	});
});

describe("asOfLine and baselineHistory (S156 AC 7: the As of line is built, not hand-edited)", () =>
{
	const withBaseline = (id: string, text: string) => story(id, "done", 1, {
		body: `\n**Gap:** g.\n\n**Baseline:** ${text}\n\n**Status:** \`done\``,
	});
	const ledger = (...ids: string[]): LedgerState => ({
		entries: parseLedger(ids.map((id, i) => `## 2026-11-2${i} — ${id} completed\n`).join("")),
		head: "abc1234",
	});

	it("names the newest completion by ledger order, its date, HEAD and its **Baseline:** text", () =>
	{
		const stories = [withBaseline("S200", "the scoreboard row moved."), withBaseline("S201", "the game row moved.")];
		expect(asOfLine(stories, ledger("S200", "S201"))).toBe("**As of:** 2026-11-21 (HEAD `abc1234`) — **S201** landed: the game row moved.");
		expect(asOfLine(stories, ledger("S201", "S200"))).toContain("**S200** landed: the scoreboard row moved.");
	});

	it("points at the frozen history for a story with no **Baseline:** line, and says when nothing has landed", () =>
	{
		expect(asOfLine([story("S84", "done", 1)], ledger("S84"))).toContain("**S84** landed (its note has no **Baseline:** line; see [Baseline history]");
		expect(asOfLine([], NO_LEDGER)).toBe("**As of:** HEAD `abc1234` — no story has landed yet.");
	});

	it("lists the **Baseline:** lines newest first, each story once, skipping stories without one", () =>
	{
		const stories = [withBaseline("S200", "a."), story("S84", "done", 1), withBaseline("S201", "b.")];
		expect(baselineHistory(stories, ledger("S200", "S84", "S201", "S200"))).toEqual(["- 2026-11-23 — **S200**: a.", "- 2026-11-22 — **S201**: b."]);
	});
});
