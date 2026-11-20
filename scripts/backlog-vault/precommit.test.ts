import { execFileSync } from "node:child_process";
import {
	existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	afterEach, beforeEach, describe, expect, it,
} from "vitest";
import { FIXTURE, notesFor } from "./fixture.ts";
import { buildFromNotes } from "./assemble.ts";
import { readNotes } from "./notes-dir.ts";
import {
	BUILT_DOCS, FROZEN_AUDIT, NOTES_DIR, RETIRED_BACKLOG, runPrecommit,
} from "./precommit.ts";

/** The repository root (this file is scripts/backlog-vault/precommit.test.ts). */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

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

/** Where a bug note for issue #74 sits while `todo`, and once `doing` (vault.ts bugNotePath). */
const B74 = `${NOTES_DIR}/bugs/todo/B74.md`;
const B74_DOING = `${NOTES_DIR}/bugs/doing/B74.md`;
const bugNote = (status: string) => `---\nid: B74\nissue: 74\ntitle: A bug\npriority: 3\nstatus: ${status}\n---\n\nhttps://github.com/o/r/issues/74\n`;

/** The notes in the working tree, read as `pnpm backlog:build` reads them (notes-dir.ts readNotes). */
const workingNotes = () => readNotes(join(repo, NOTES_DIR));

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

	it("builds from the index: unstaged edits neither leak into the commit nor get clobbered", async () =>
	{
		write(S9, read(S9).replace("status: todo", "status: doing"));
		git("add", S9);
		const framePath = git("ls-files", "-z", `${NOTES_DIR}/frame`).split("\0").find((p) => p.includes("Data platform")) ?? "";
		write(framePath, read(framePath).replace("Group intro.", "UNSTAGED FRAME EDIT"));
		write(S9, read(S9).replace("Turn cap:** 10", "Turn cap:** 11 UNSTAGED"));

		const result = runPrecommit(repo);

		expect(result.ok).toBe(true);
		// The new status moves S9's note into stories/doing/; nothing generated is staged (S156).
		expect(result.restaged).toEqual([S9, S9_DOING]);
		expect(git("ls-files", "--", S9)).toBe("");
		expect(stagedFile(S9_DOING)).toContain("status: doing");
		expect(stagedFile(S9_DOING)).not.toContain("UNSTAGED");
		expect(read(framePath)).toContain("UNSTAGED FRAME EDIT");
		// The working copy carries an unstaged edit, so it moves with the note rather than staying behind as a second S9.
		expect(existsSync(join(repo, S9))).toBe(false);
		expect(existsSync(join(repo, dirname(S9)))).toBe(false);
		expect(read(S9_DOING)).toContain("UNSTAGED");
		expect(read(S9_DOING)).toContain("status: doing");
		expect(git("diff", "--name-status", "--", `${NOTES_DIR}/stories`).trim()).toBe(`M\t${S9_DOING}`);
		// So the working tree still builds: one note per ID, each in its status folder.
		const built = buildFromNotes(await workingNotes());
		expect([...built.notes.keys()].filter((k) => k.startsWith("stories/")).sort()).toEqual(["stories/doing/S9.md", "stories/done/S1.md"]);
	});

	it("moves a note whose staged status changed and removes the emptied folder", async () =>
	{
		write(S9, read(S9).replace("status: todo", "status: doing"));
		git("add", S9);

		expect(runPrecommit(repo).ok).toBe(true);

		expect(existsSync(join(repo, S9))).toBe(false);
		expect(existsSync(join(repo, dirname(S9)))).toBe(false);
		expect(read(S9_DOING)).toBe(stagedFile(S9_DOING));
		expect(git("diff", "--name-status", "--", `${NOTES_DIR}/stories`).trim()).toBe("");
		expect(buildFromNotes(await workingNotes()).notes.size).toBeGreaterThan(0);
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

	it("refuses a commit that adds back the retired BACKLOG.md", () =>
	{
		write(RETIRED_BACKLOG, FIXTURE);
		git("add", RETIRED_BACKLOG);

		const result = runPrecommit(repo);

		expect(result.ok).toBe(false);
		expect(result.message).toMatch(/is retired \(S156\): edit the notes/);
	});

	it("refuses a commit that tracks a built doc again, INDEX.md or audit.jsonl (S156)", () =>
	{
		for (const path of BUILT_DOCS)
		{
			write(path, "built\n");
			git("add", "-f", path);
			const result = runPrecommit(repo);
			expect(result.ok, path).toBe(false);
			expect(result.message).toContain(`${path}: built by pnpm backlog:build and git-ignored`);
			git("rm", "-q", "--cached", path);
		}
	});

	it("refuses any staged content for the frozen AUDIT.md but its frozen bytes, and its deletion (law L13)", () =>
	{
		const frozen = readFileSync(join(REPO_ROOT, FROZEN_AUDIT));
		mkdirSync(join(repo, "docs/v3"), {
			recursive: true,
		});
		writeFileSync(join(repo, FROZEN_AUDIT), frozen);
		git("add", FROZEN_AUDIT);
		// Staging exactly the frozen bytes passes: a merge from stage that resolves AUDIT.md to them.
		expect(runPrecommit(repo).ok).toBe(true);
		git("commit", "-qm", "frozen ledger");

		writeFileSync(join(repo, FROZEN_AUDIT), Buffer.concat([frozen, Buffer.from("\n## 2026-11-21 — S9 completed\n")]));
		git("add", FROZEN_AUDIT);
		expect(runPrecommit(repo)).toMatchObject({
			ok: false,
			message: expect.stringContaining("is frozen history (S156, law L13)"),
		});

		git("rm", "-q", "-f", FROZEN_AUDIT);
		expect(runPrecommit(repo)).toMatchObject({
			ok: false,
			message: expect.stringContaining("may not be deleted or moved"),
		});
	});

	it("the real repository tracks none of the built docs or the retired BACKLOG.md (works in a shallow clone)", () =>
	{
		const tracked = execFileSync("git", ["ls-files", "--", RETIRED_BACKLOG, ...BUILT_DOCS], {
			cwd: REPO_ROOT,
			encoding: "utf8",
		});
		expect(tracked).toBe("");
	});

	it("checks a staged FEATURES.md, which every **Source:** line is checked against, even with no note staged", () =>
	{
		write("docs/v3/FEATURES.md", "| **Standings** | x |\n");
		write("docs/v3/INTENT.md", "# Intent\n");
		git("add", "docs/v3/FEATURES.md", "docs/v3/INTENT.md");

		const result = runPrecommit(repo);

		expect(result.ok).toBe(false);
		expect(result.message).toMatch(/S1 has no \*\*Source:\*\* line/);
	});

	it("refuses staged notes that do not build", () =>
	{
		write(S9, read(S9).replace("id: S9", "id: S8"));
		git("add", S9);

		const result = runPrecommit(repo);

		expect(result.ok).toBe(false);
		expect(result.message).toMatch(/do not build: .*id 'S8' does not match/);
	});

	it("accepts a newly staged bug note in its status folder as it is", () =>
	{
		write(B74, bugNote("todo"));
		git("add", B74);

		expect(runPrecommit(repo)).toEqual({
			ok: true,
			restaged: [],
		});
	});

	it("moves a bug note whose staged status changed, carrying its unstaged edit to the new path", async () =>
	{
		write(B74, bugNote("todo"));
		git("add", B74);
		git("commit", "-qm", "B74 filed");
		write(B74, bugNote("doing"));
		git("add", B74);
		write(B74, `${bugNote("doing")}UNSTAGED\n`);

		expect(runPrecommit(repo).ok).toBe(true);

		expect(git("ls-files", "--", B74)).toBe("");
		expect(existsSync(join(repo, B74))).toBe(false);
		expect(existsSync(join(repo, dirname(B74)))).toBe(false);
		expect(stagedFile(B74_DOING)).toBe(bugNote("doing"));
		expect(read(B74_DOING)).toBe(`${bugNote("doing")}UNSTAGED\n`);
		expect(git("diff", "--name-status", "--", `${NOTES_DIR}/bugs`).trim()).toBe(`M\t${B74_DOING}`);
		// So the working tree still builds: one note per ID, each in its status folder.
		const built = buildFromNotes(await workingNotes());
		expect([...built.notes.keys()].filter((k) => k.startsWith("bugs/"))).toEqual(["bugs/doing/B74.md"]);
	});

	it("refuses two staged bug notes with one ID, saying how to stage a move", () =>
	{
		write(B74, bugNote("todo"));
		write(B74_DOING, bugNote("doing"));
		git("add", B74, B74_DOING);

		const result = runPrecommit(repo);

		expect(result.ok).toBe(false);
		expect(result.message).toMatch(/two notes share the ID B74/);
		expect(result.message).toContain("docs/v3/backlog/bugs");
	});

	it("refuses a staged .md under bugs/ that isn't named like a bug note", () =>
	{
		write(`${NOTES_DIR}/bugs/todo/b74.md`, bugNote("todo"));
		git("add", `${NOTES_DIR}/bugs/todo/b74.md`);

		const result = runPrecommit(repo);

		expect(result.ok).toBe(false);
		expect(result.message).toContain("bugs/todo/b74.md: not a bug note's name");
	});
});
