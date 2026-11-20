import { join } from "node:path";
import {
	describe, expect, it,
} from "vitest";
import {
	assembleBacklog, buildFromNotes, headingAnchor, nextCandidate, nextStoryLine, reviewDebtLine, VaultAssembleError,
} from "./assemble.ts";
import {
	AUDIT, FIXTURE, notesFor,
} from "./fixture.ts";
import { parseLedger } from "./ledger.ts";
import { readNotes } from "./notes-dir.ts";
import { parseBacklog } from "./parse.ts";

function edit(files: Map<string, string>, path: string, change: (content: string) => string): Map<string, string>
{
	const copy = new Map(files);
	copy.set(path, change(copy.get(path) ?? ""));
	return copy;
}

describe("headingAnchor", () =>
{
	it("matches GitHub's anchors for story headings", () =>
	{
		expect(headingAnchor("S26 — Typed BT API route contract")).toBe("s26--typed-bt-api-route-contract");
		expect(headingAnchor("S1 — Domain window helpers fully tested *(pilot)*")).toBe("s1--domain-window-helpers-fully-tested-pilot");
		expect(headingAnchor("S12 — Live HTTP `MlbStatsClient` + domain mappers")).toBe("s12--live-http-mlbstatsclient--domain-mappers");
	});
});

describe("assembleBacklog", () =>
{
	it("round trip: import then build reproduces a fixture byte-for-byte", () =>
	{
		expect(assembleBacklog(notesFor(FIXTURE))).toBe(FIXTURE);
	});

	it("round trip: the real notes assemble and re-render byte-for-byte (they are canonical)", async () =>
	{
		const notes = await readNotes(join(import.meta.dirname, "../../docs/v3/backlog"));
		const built = buildFromNotes(notes);
		expect([...built.notes.keys()].filter((k) => built.notes.get(k) !== notes.get(k))).toEqual([]);
	});

	it("writes a status edit into both the table row and the section's Status line", () =>
	{
		const out = assembleBacklog(edit(notesFor(FIXTURE), "stories/done/S1.md", (c) => c.replace("status: done", "status: blocked")));
		expect(out).toContain("| 2 | [S1](#s1--domain-window-helpers-fully-tested-pilot) | Domain window helpers *(pilot)* | `blocked` |");
		expect(out).toMatch(/stop after 8 turns\.\n\n\*\*Status:\*\* `blocked`/);
	});

	it("re-sorts the status table on a priority change", () =>
	{
		const out = assembleBacklog(edit(notesFor(FIXTURE), "stories/todo/S9.md", (c) => c.replace("priority: 1\n", "priority: 3\n")));
		expect(out.split("\n").filter((l) => /^\| \d+ \| \[S/.test(l)).map((r) => r.slice(0, 11))).toEqual(["| 2 | [S1](", "| 3 | [S9]("]);
	});

	it("rejects a frame embed with no note, a note no frame embeds, and an id that doesn't match its file", () =>
	{
		const files = notesFor(FIXTURE);
		const missing = new Map(files);
		missing.delete("stories/todo/S9.md");
		expect(() => assembleBacklog(missing)).toThrow(VaultAssembleError);
		expect(() => assembleBacklog(missing)).toThrow(/embeds S9, which has no story note/);

		const framePath = [...files.keys()].find((p) => (files.get(p) ?? "").includes("![[S9]]")) ?? "";
		expect(() => assembleBacklog(edit(files, framePath, (c) => c.replace("![[S9]]\n", "")))).toThrow(/not embedded in any frame note: S9/);

		expect(() => assembleBacklog(edit(files, "stories/todo/S9.md", (c) => c.replace("id: S9", "id: S8")))).toThrow(/id 'S8' does not match the file name/);
	});

	it("rejects a Status line or story heading written into a note body", () =>
	{
		const files = notesFor(FIXTURE);
		expect(() => assembleBacklog(edit(files, "stories/todo/S9.md", (c) => `${c}\n**Status:** \`todo\`\n`))).toThrow(/must not contain "\*\*Status:\*\* `todo`"/);
		expect(() => assembleBacklog(edit(files, "stories/todo/S9.md", (c) => `${c}\n### S9 — Again\n`))).toThrow(/must not contain "### S9 — Again"/);
	});
});

describe("buildFromNotes", () =>
{
	it("accepts Obsidian-style frontmatter and normalizes it without changing the assembled document", () =>
	{
		const files = notesFor(FIXTURE);
		const obsidian = edit(files, "stories/todo/S9.md", (c) => c
			.replace("depends_on:\n  - \"[[S1]]\"", "depends_on: [ '[[S1]]' ]")
			.replace("title: Align `pnpm dev` with emulator story (document + smoke)", "title: 'Align `pnpm dev` with emulator story (document + smoke)'"));
		expect(obsidian.get("stories/todo/S9.md")).not.toBe(files.get("stories/todo/S9.md"));

		const built = buildFromNotes(obsidian);
		expect(built.backlog).toBe(FIXTURE);
		expect(built.notes.get("stories/todo/S9.md")).toBe(files.get("stories/todo/S9.md"));
	});

	it("puts each note in the folder its status names, moving a note whose status changed or that sits flat", () =>
	{
		const files = notesFor(FIXTURE);
		expect([...files.keys()].filter((p) => p.startsWith("stories/")).sort()).toEqual(["stories/done/S1.md", "stories/todo/S9.md"]);

		const flipped = edit(files, "stories/todo/S9.md", (c) => c.replace("status: todo", "status: done"));
		const built = buildFromNotes(flipped);
		expect(built.notes.has("stories/todo/S9.md")).toBe(false);
		expect(built.notes.get("stories/done/S9.md")).toContain("status: done");

		// The flat layout from before 2026-11-17 still reads, so build can move it.
		const flat = new Map(files);
		flat.delete("stories/todo/S9.md");
		flat.set("stories/S9.md", files.get("stories/todo/S9.md") ?? "");
		const fromFlat = buildFromNotes(flat);
		expect(fromFlat.backlog).toBe(FIXTURE);
		expect(fromFlat.notes.get("stories/todo/S9.md")).toBe(files.get("stories/todo/S9.md"));
	});

	it("rejects a status outside the known set, rather than making a folder for it", () =>
	{
		const typo = edit(notesFor(FIXTURE), "stories/todo/S9.md", (c) => c.replace("status: todo", "status: dnoe"));
		expect(() => buildFromNotes(typo)).toThrow(/'status' must be one of todo, doing, blocked, done, superseded, got 'dnoe'/);
	});

	it("rejects two notes that share an ID, naming both", () =>
	{
		const files = notesFor(FIXTURE);
		const twice = new Map(files);
		twice.set("stories/done/S9.md", files.get("stories/todo/S9.md") ?? "");
		expect(() => buildFromNotes(twice)).toThrow(/two notes share the ID S9: stories\/todo\/S9\.md and stories\/done\/S9\.md/);
	});

	it("checks every story's Source line when given FEATURES.md and INTENT.md (rule 19)", () =>
	{
		const docs = {
			features: "## Carry / cut from v2\n\n| v2 capability | Verdict |\n|---|---|\n| Standings | **Carry** |\n",
			intent: "## Pillars\n\n- **Dependable** — Fans can count on it.\n",
		};
		const withSource = (line: string) => edit(notesFor(FIXTURE), "stories/todo/S9.md", (c) => c.replace("**Depends on:** S1", `**Depends on:** S1\n\n**Source:** ${line}`));
		const s1 = (files: Map<string, string>) => edit(files, "stories/done/S1.md", (c) => c.replace("**Goal condition:**", "**Source:** Feature: Standings\n\n**Goal condition:**"));

		expect(() => buildFromNotes(notesFor(FIXTURE), docs)).toThrow(/S1 has no \*\*Source:\*\* line/);
		expect(buildFromNotes(s1(withSource("Feature: Standings")), docs).notes.get("stories/todo/S9.md")).toContain("source: feature");
		expect(() => buildFromNotes(s1(withSource("Feature: Team pages")), docs)).toThrow(/cites "Team pages", which is not a feature/);
		expect(() => buildFromNotes(s1(withSource("Pillar: Dependable — keeps games loading.")), docs)).toThrow(/without the owner's approval/);
		expect(buildFromNotes(s1(withSource("Pillar: Dependable — keeps games loading. Approved by owner 2026-10-09: \"yes\"")), docs).notes.get("stories/todo/S9.md"))
			.toContain("source: pillar");
	});

	it("overwrites edits to derived fields from the body", () =>
	{
		const built = buildFromNotes(edit(notesFor(FIXTURE), "stories/todo/S9.md", (c) => c.replace("turn_cap: 10", "turn_cap: 99")));
		expect(built.notes.get("stories/todo/S9.md")).toContain("turn_cap: 10");
	});
});

describe("generated lines", () =>
{
	const story = (id: string, priority: number, status: string, design: string[] = []) => ({
		id,
		priority,
		status,
		design,
	});

	it("names the story in progress, else the lowest-priority todo, else says none remain", () =>
	{
		expect(nextStoryLine([story("S2", 19, "todo"), story("S27", 16, "doing"), story("S25", 17, "todo")]))
			.toBe("**Next (generated):** **16 / S27** in progress (`doing`) — finish and commit before starting another story (rule 6).");
		expect(nextStoryLine([story("S2", 19, "todo"), story("S25", 17, "todo"), story("S1", 1, "done")]))
			.toBe("**Next (generated):** **17 / S25** — the lowest **Priority** `todo` story not waiting on a design.");
		expect(nextStoryLine([story("S1", 1, "done")])).toBe("**Next (generated):** no `todo` stories remain.");
	});

	it("skips todo stories whose design is not done, and says so", () =>
	{
		const designs = [story("S31", 19, "blocked"), story("S32", 20, "done")];
		expect(nextStoryLine([...designs, story("S2", 24, "todo", ["S31"]), story("S3", 25, "todo", ["S32"]), story("S8", 33, "todo")]))
			.toBe("**Next (generated):** **25 / S3** — the lowest **Priority** `todo` story not waiting on a design. Skipped, waiting on design (rule 18): S2.");
		expect(nextStoryLine([...designs, story("S2", 24, "todo", ["S31"])]))
			.toBe("**Next (generated):** every `todo` story is waiting on a design or the owner. Skipped, waiting on design (rule 18): S2.");
	});

	it("skips todo stories whose reason to exist is an open question, and says so (rule 19)", () =>
	{
		const open = {
			...story("S9", 1, "todo"),
			openSource: true,
		};
		expect(nextStoryLine([open, story("S31", 2, "blocked"), story("S2", 3, "todo", ["S31"]), story("S4", 5, "todo")]))
			.toBe("**Next (generated):** **5 / S4** — the lowest **Priority** `todo` story not waiting on a design. "
				+ "Skipped, waiting on design (rule 18): S2. Skipped, waiting on the owner to say why (rule 19): S9.");
	});

	it("reads an open Source line from the notes into the Next line", () =>
	{
		const files = edit(notesFor(FIXTURE), "stories/todo/S9.md", (c) => c.replace("**Depends on:** S1", "**Depends on:** S1\n\n**Source:** Open: why? Raised 2026-10-09."));
		expect(nextStoryLine(parseBacklog(assembleBacklog(files)).stories.map(nextCandidate))).toContain("Skipped, waiting on the owner to say why (rule 19): S9.");
	});

	it("counts distinct stories completed since the newest review, ignoring re-verifications", () =>
	{
		expect(reviewDebtLine(parseLedger(AUDIT))).toContain("1 of 6 stories `done` since the last backlog review (2026-09-10, verdict `amended`): S1.");
		const due = `${AUDIT}${[2, 3, 4, 5, 6].map((n) => `## 2026-09-13 — S${n} completed\n`).join("")}`;
		expect(reviewDebtLine(parseLedger(due))).toContain("6 of 6 stories `done` since the last backlog review (2026-09-10, verdict `amended`): S1, S2, S3, S4, S5, S6. **A review is due before the next story starts.**");
		expect(reviewDebtLine(parseLedger("## 2026-09-01 — S1 completed\n"))).toContain("(no review logged yet): S1.");
	});

	it("follows the notes: a status flip moves the Next line", () =>
	{
		const out = assembleBacklog(edit(notesFor(FIXTURE), "stories/todo/S9.md", (c) => c.replace("status: todo", "status: doing")));
		expect(nextStoryLine(parseBacklog(out).stories.map(nextCandidate))).toContain("**Next (generated):** **1 / S9** in progress (`doing`)");
	});
});
