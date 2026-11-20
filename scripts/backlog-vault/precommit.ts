/**
 * Pre-commit step for the backlog notes (docs/v3/VAULT-MIGRATION.md, V3).
 *
 * Builds from the **index**, not the working tree, so the notes a commit carries are exactly the
 * staged ones in canonical form (derived frontmatter refreshed, each note in its status folder),
 * and unstaged edits never leak into them. Results go into the index; a working-tree file is only
 * rewritten when it still matches what was staged, so unstaged edits are never clobbered either.
 * Nothing generated is committed any more (S156): docs/v3/INDEX.md and docs/v3/audit.jsonl are
 * git-ignored and rebuilt after checkout and merge, and the generated BACKLOG.md is retired, so
 * this step refuses a commit that adds or changes any of the three (a branch resolving a
 * modify/delete conflict by keeping one would otherwise track it again). It also refuses a commit
 * that deletes the frozen ledger, docs/v3/AUDIT.md, or stages it with anything but its frozen
 * bytes (law L13); staging exactly those bytes passes, as a merge from `stage` resolving it does.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	mkdirSync, readFileSync, renameSync, rmdirSync, rmSync, writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { buildFromNotes } from "./assemble.ts";
import { FROZEN_AUDIT_SHA256 } from "./ledger.ts";
import { isNoteKey, noteId } from "./vault.ts";

export const NOTES_DIR = "docs/v3/backlog";
/** The generated backlog file S156 retired (owner, 2026-11-20: "Retire it (Recommended)"); a commit may not add it back. */
export const RETIRED_BACKLOG = "docs/v3/BACKLOG.md";
/** The files `pnpm backlog:build` writes and .gitignore ignores (S156; owner, 2026-11-20: "Stop committing them (Recommended)"). */
export const BUILT_DOCS = ["docs/v3/INDEX.md", "docs/v3/audit.jsonl"];
/** The frozen ledger (S156): every new entry is a fragment under docs/v3/audit/. */
export const FROZEN_AUDIT = "docs/v3/AUDIT.md";
export const FEATURES = "docs/v3/FEATURES.md";
export const INTENT = "docs/v3/INTENT.md";

export interface PrecommitResult
{
	ok: boolean;
	message?: string;
	/** Repo-relative paths whose staged content the step changed. */
	restaged: string[];
}

function git(repo: string, args: string[], input?: string): string
{
	return execFileSync("git", args, {
		cwd: repo,
		encoding: "utf8",
		input,
		// `staged()` probes paths that may not exist; a failure throws with git's message, so don't echo it too.
		stdio: ["pipe", "pipe", "pipe"],
		maxBuffer: 64 * 1024 * 1024,
	});
}

/** NUL-separated git output → paths (immune to core.quotepath escaping of "—" and friends). */
function paths(output: string): string[]
{
	return output.split("\0").filter((p) => p !== "");
}

function staged(repo: string, path: string): string | undefined
{
	try
	{
		return git(repo, ["show", `:${path}`]);
	}
	catch
	{
		return undefined;
	}
}

function working(repo: string, path: string): string | undefined
{
	try
	{
		return readFileSync(join(repo, path), "utf8");
	}
	catch
	{
		return undefined;
	}
}

/** A status folder emptied by a move goes too; a folder still holding anything stays (rmdir refuses it). */
function removeFolderIfEmpty(repo: string, path: string)
{
	try
	{
		rmdirSync(dirname(join(repo, path)));
	}
	catch
	{
		// Not empty, or already gone.
	}
}

/**
 * A story or bug note whose staged status moved it (`stories/todo/S5.md` → `stories/doing/S5.md`) but whose
 * working copy also holds unstaged edits: rename the working file to the new path, so the edits stay
 * on the one note (a modification of the new path) instead of leaving a second copy of the ID behind
 * at the old path, which every later build would refuse. A working copy equal to the staged one is
 * left to `restage`, which removes it and writes the built note at the new path.
 */
function moveEditedNotes(repo: string, notes: Map<string, string>, built: Map<string, string>)
{
	const newKeyById = new Map<string, string>();
	for (const key of built.keys())
	{
		const id = noteId(key);
		if (id !== undefined && !notes.has(key))
		{
			newKeyById.set(id, key);
		}
	}
	for (const [key, before] of notes)
	{
		const id = noteId(key);
		const to = id === undefined || built.has(key) ? undefined : newKeyById.get(id);
		const from = `${NOTES_DIR}/${key}`;
		const onDisk = working(repo, from);
		if (to === undefined || onDisk === undefined || onDisk === before || working(repo, `${NOTES_DIR}/${to}`) !== undefined)
		{
			continue;
		}
		mkdirSync(dirname(join(repo, NOTES_DIR, to)), {
			recursive: true,
		});
		renameSync(join(repo, from), join(repo, NOTES_DIR, to));
		removeFolderIfEmpty(repo, from);
	}
}

/** Stage `content` at `path` (or remove it when undefined); mirror to disk only if disk still equals the old staged copy. */
function restage(repo: string, path: string, before: string | undefined, content: string | undefined)
{
	const onDisk = working(repo, path);
	if (content === undefined)
	{
		git(repo, ["update-index", "--force-remove", "--", path]);
		if (onDisk !== undefined && onDisk === before)
		{
			rmSync(join(repo, path));
			removeFolderIfEmpty(repo, path);
		}
		return;
	}
	const blob = git(repo, ["hash-object", "-w", "--stdin"], content).trim();
	git(repo, ["update-index", "--add", "--cacheinfo", `100644,${blob},${path}`]);
	if (onDisk === before)
	{
		// A story note moved by its status may land in a folder that doesn't exist yet (vault.ts storyNotePath).
		mkdirSync(dirname(join(repo, path)), {
			recursive: true,
		});
		writeFileSync(join(repo, path), content);
	}
}

/** Why the staged frozen ledger is refused, or undefined when it isn't staged or holds exactly its frozen bytes. */
function frozenAuditProblem(repo: string): string | undefined
{
	// With the pathspec on one side only, a rename shows as a deletion, so AMD covers it.
	if (paths(git(repo, ["diff", "--cached", "--name-only", "-z", "--diff-filter=AMD", "--", FROZEN_AUDIT])).length === 0)
	{
		return undefined;
	}
	let bytes: Buffer;
	try
	{
		bytes = execFileSync("git", ["show", `:${FROZEN_AUDIT}`], {
			cwd: repo,
			stdio: ["ignore", "pipe", "pipe"],
			maxBuffer: 64 * 1024 * 1024,
		});
	}
	catch
	{
		return `${FROZEN_AUDIT} is frozen history (S156, law L13) and may not be deleted or moved: restore it (git restore --staged --worktree ${FROZEN_AUDIT}).`;
	}
	return createHash("sha256").update(bytes).digest("hex") === FROZEN_AUDIT_SHA256
		? undefined
		: `${FROZEN_AUDIT} is frozen history (S156, law L13): new entries are fragments under docs/v3/audit/, written by scripts/audit.sh. Restore it (git restore --staged --worktree ${FROZEN_AUDIT}).`;
}

export function runPrecommit(repo: string): PrecommitResult
{
	if (paths(git(repo, ["diff", "--cached", "--name-only", "-z", "--diff-filter=AM", "--", RETIRED_BACKLOG])).length > 0)
	{
		return {
			ok: false,
			message: `${RETIRED_BACKLOG} is retired (S156): edit the notes in ${NOTES_DIR}/ instead, and unstage it (git rm --cached ${RETIRED_BACKLOG}).`,
			restaged: [],
		};
	}
	const builtDocs = paths(git(repo, ["diff", "--cached", "--name-only", "-z", "--diff-filter=AM", "--", ...BUILT_DOCS]));
	if (builtDocs.length > 0)
	{
		return {
			ok: false,
			message: `${builtDocs.join(", ")}: built by pnpm backlog:build and git-ignored (S156), never committed; unstage with git rm --cached ${builtDocs.join(" ")}.`,
			restaged: [],
		};
	}
	const audit = frozenAuditProblem(repo);
	if (audit)
	{
		return {
			ok: false,
			message: audit,
			restaged: [],
		};
	}
	// The notes, and the two docs every **Source:** line is checked against, are all the build reads.
	const changed = paths(git(repo, ["diff", "--cached", "--name-only", "-z", "--", NOTES_DIR, FEATURES, INTENT]));
	if (changed.length === 0)
	{
		return {
			ok: true,
			restaged: [],
		};
	}

	const notes = new Map<string, string>();
	for (const path of paths(git(repo, ["ls-files", "-z", "--cached", "--", `${NOTES_DIR}/stories`, `${NOTES_DIR}/bugs`, `${NOTES_DIR}/frame`])))
	{
		const key = path.slice(NOTES_DIR.length + 1);
		const content = staged(repo, path);
		if (isNoteKey(key) && content !== undefined)
		{
			notes.set(key, content);
		}
	}

	// A renamed feature or pillar can orphan a story's **Source:** line, so those docs are checked as staged too (rule 19).
	const features = staged(repo, FEATURES);
	const intent = staged(repo, INTENT);
	const docs = features === undefined || intent === undefined ? undefined : {
		features,
		intent,
	};

	let built;
	try
	{
		built = buildFromNotes(notes, docs);
	}
	catch (error)
	{
		const why = (error as Error).message;
		// Usually a note moved on disk with only one side of the move staged (the new path, not the old one's removal).
		const hint = why.includes("two notes share the ID") ? " (if you moved a note, stage both sides of the move: git add -A docs/v3/backlog/stories docs/v3/backlog/bugs)" : "";
		return {
			ok: false,
			message: `the staged backlog notes do not build: ${why}${hint}`,
			restaged: [],
		};
	}

	moveEditedNotes(repo, notes, built.notes);
	const restaged: string[] = [];
	for (const key of new Set([...notes.keys(), ...built.notes.keys()]))
	{
		const before = notes.get(key);
		const after = built.notes.get(key);
		if (before !== after)
		{
			restage(repo, `${NOTES_DIR}/${key}`, before, after);
			restaged.push(`${NOTES_DIR}/${key}`);
		}
	}
	return {
		ok: true,
		restaged,
	};
}
