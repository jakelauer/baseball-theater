import { execFileSync } from "node:child_process";
import {
	existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
	afterEach, beforeEach, describe, expect, it,
} from "vitest";
import {
	AUDIT, FIXTURE, notesFor,
} from "./fixture.ts";
import { buildFromNotes } from "./assemble.ts";
import { docIndexFor } from "./doc-index.ts";
import { isNoteKey } from "./vault.ts";
import { parseLedger, renderLedgerIndex } from "./ledger.ts";
import {
	AUDIT as AUDIT_PATH, AUDIT_INDEX, BACKLOG, DOC_INDEX, NOTES_DIR, runPrecommit,
} from "./precommit.ts";

let repo = "";

function git(...args: string[]): string
{
	return execFileSync("git", args, {
		cwd: repo,
		encoding: "utf8",
	});
}

function write(path: string, content: string)
{
	mkdirSync(dirname(join(repo, path)), {
		recursive: true,
	});
	writeFileSync(join(repo, path), content);
}

const read = (path: string) => readFileSync(join(repo, path), "utf8");
const stagedFile = (path: string) => git("show", `:${path}`);
const S9 = `${NOTES_DIR}/stories/todo/S9.md`;
/** Where S9's note belongs once its status is `doing` (vault.ts storyNotePath). */
const S9_DOING = `${NOTES_DIR}/stories/doing/S9.md`;

/** The story and frame notes in the working tree, keyed as the build keys them, as `pnpm backlog:build` reads them. */
function workingNotes(): Map<string, string>
{
	const notes = new Map<string, string>();
	for (const sub of ["stories", "frame"])
	{
		for (const name of readdirSync(join(repo, NOTES_DIR, sub), {
			recursive: true,
		}) as string[])
		{
			const key = `${sub}/${name}`;
			if (isNoteKey(key))
			{
				notes.set(key, read(`${NOTES_DIR}/${key}`));
			}
		}
	}
	return notes;
}

beforeEach(() =>
{
	repo = mkdtempSync(join(tmpdir(), "backlog-precommit-"));
	git("init", "-q");
	git("config", "user.email", "test@example.com");
	git("config", "user.name", "Test");
	git("config", "core.hooksPath", "/dev/null");
	for (const [path, content] of notesFor(FIXTURE))
	{
		write(`${NOTES_DIR}/${path}`, content);
	}
	write(BACKLOG, FIXTURE);
	write(AUDIT_PATH, AUDIT);
	write(AUDIT_INDEX, renderLedgerIndex(parseLedger(AUDIT)));
	write(DOC_INDEX, docIndexFor(FIXTURE, notesFor(FIXTURE), [{
		path: "BACKLOG.md",
		text: FIXTURE,
	}, {
		path: "AUDIT.md",
		text: AUDIT,
	}]));
	git("add", "-A");
	git("commit", "-qm", "base");
});

afterEach(() =>
{
	rmSync(repo, {
		recursive: true,
		force: true,
	});
});

describe("runPrecommit", () =>
{
	it("does nothing when no backlog file is staged", () =>
	{
		write("README.md", "hi\n");
		git("add", "README.md");
		expect(runPrecommit(repo)).toEqual({
			ok: true,
			restaged: [],
		});
	});

	it("builds from the index: unstaged edits neither leak into the commit nor get clobbered", () =>
	{
		write(S9, read(S9).replace("status: todo", "status: doing"));
		git("add", S9);
		const framePath = git("ls-files", "-z", `${NOTES_DIR}/frame`).split("\0").find((p) => p.includes("Data platform")) ?? "";
		write(framePath, read(framePath).replace("Group intro.", "UNSTAGED FRAME EDIT"));
		write(S9, read(S9).replace("Turn cap:** 10", "Turn cap:** 11 UNSTAGED"));

		const result = runPrecommit(repo);

		expect(result.ok).toBe(true);
		// The new status moves S9's note into stories/doing/; the docs index lists each story's status, so it moves with S9 too.
		expect(result.restaged).toEqual([S9, S9_DOING, BACKLOG, DOC_INDEX]);
		expect(git("ls-files", "--", S9)).toBe("");
		expect(stagedFile(S9_DOING)).toContain("status: doing");
		expect(stagedFile(S9_DOING)).not.toContain("UNSTAGED");
		expect(stagedFile(DOC_INDEX)).toContain("[S9](backlog/stories/doing/S9.md) Align `pnpm dev` | `doing` |");
		expect(stagedFile(DOC_INDEX)).not.toContain("UNSTAGED");
		expect(stagedFile(BACKLOG)).toContain("| 1 | [S9](#s9--align-pnpm-dev-with-emulator-story-document--smoke) | Align `pnpm dev` | `doing` |");
		expect(stagedFile(BACKLOG)).not.toContain("UNSTAGED");
		expect(read(framePath)).toContain("UNSTAGED FRAME EDIT");
		// The working copy carries an unstaged edit, so it moves with the note rather than staying behind as a second S9.
		expect(existsSync(join(repo, S9))).toBe(false);
		expect(existsSync(join(repo, dirname(S9)))).toBe(false);
		expect(read(S9_DOING)).toContain("UNSTAGED");
		expect(read(S9_DOING)).toContain("status: doing");
		expect(git("diff", "--name-status", "--", `${NOTES_DIR}/stories`).trim()).toBe(`M\t${S9_DOING}`);
		// So the working tree still builds: one note per ID, each in its status folder.
		const built = buildFromNotes(workingNotes(), AUDIT);
		expect([...built.notes.keys()].filter((k) => k.startsWith("stories/")).sort()).toEqual(["stories/doing/S9.md", "stories/done/S1.md"]);
		// BACKLOG.md on disk still matched the old staged copy, so it is updated too.
		expect(read(BACKLOG)).toBe(stagedFile(BACKLOG));
	});

	it("moves a note whose staged status changed and removes the emptied folder", () =>
	{
		write(S9, read(S9).replace("status: todo", "status: doing"));
		git("add", S9);

		expect(runPrecommit(repo).ok).toBe(true);

		expect(existsSync(join(repo, S9))).toBe(false);
		expect(existsSync(join(repo, dirname(S9)))).toBe(false);
		expect(read(S9_DOING)).toBe(stagedFile(S9_DOING));
		expect(git("diff", "--name-status", "--", `${NOTES_DIR}/stories`).trim()).toBe("");
		expect(() => buildFromNotes(workingNotes(), AUDIT)).not.toThrow();
	});

	it("refuses two staged notes with one ID, saying how to stage a move", () =>
	{
		write(S9_DOING, read(S9).replace("status: todo", "status: doing"));
		git("add", S9_DOING);

		const result = runPrecommit(repo);

		expect(result.ok).toBe(false);
		expect(result.message).toMatch(/two notes share the ID S9/);
		expect(result.message).toContain("git add -A docs/v3/backlog/stories");
	});

	it("normalizes an Obsidian-style staged note in the index and on disk", () =>
	{
		write(S9, read(S9).replace("depends_on:\n  - \"[[S1]]\"", "depends_on: [ '[[S1]]' ]"));
		git("add", S9);

		const result = runPrecommit(repo);

		expect(result).toEqual({
			ok: true,
			restaged: [S9],
		});
		expect(stagedFile(S9)).toBe(notesFor(FIXTURE).get("stories/todo/S9.md"));
		expect(read(S9)).toBe(stagedFile(S9));
	});

	it("rebuilds the review-debt line when only AUDIT.md is staged", () =>
	{
		write(AUDIT_PATH, `${AUDIT}## 2026-09-13 — S9 completed\n`);
		git("add", AUDIT_PATH);

		const result = runPrecommit(repo);

		expect(result.restaged).toEqual([BACKLOG, AUDIT_INDEX]);
		expect(stagedFile(BACKLOG)).toContain("2 of 6 stories `done` since the last backlog review (2026-09-10, verdict `amended`): S1, S9.");
		expect(stagedFile(AUDIT_INDEX).trim().split("\n").at(-1)).toBe(JSON.stringify({
			line: 6,
			date: "2026-09-13",
			kind: "completed",
			story: "S9",
			heading: "## 2026-09-13 — S9 completed",
		}));
	});

	it("rebuilds a hand-edited audit.jsonl from AUDIT.md", () =>
	{
		write(AUDIT_INDEX, "{\"hand\":\"edit\"}\n");
		git("add", AUDIT_INDEX);

		const result = runPrecommit(repo);

		expect(result.ok).toBe(true);
		expect(result.restaged).toEqual([AUDIT_INDEX]);
		expect(stagedFile(AUDIT_INDEX)).toBe(renderLedgerIndex(parseLedger(AUDIT)));
		expect(read(AUDIT_INDEX)).toBe(renderLedgerIndex(parseLedger(AUDIT)));
	});

	it("refuses a hand edit of BACKLOG.md staged on its own", () =>
	{
		write(BACKLOG, `${FIXTURE}HAND EDIT\n`);
		git("add", BACKLOG);

		const result = runPrecommit(repo);

		expect(result.ok).toBe(false);
		expect(result.message).toMatch(/is generated — edit the notes/);
		expect(stagedFile(BACKLOG)).toContain("HAND EDIT");
	});

	it("refuses staged notes that do not build", () =>
	{
		write(S9, read(S9).replace("id: S9", "id: S8"));
		git("add", S9);

		const result = runPrecommit(repo);

		expect(result.ok).toBe(false);
		expect(result.message).toMatch(/do not build: .*id 'S8' does not match/);
	});
});
