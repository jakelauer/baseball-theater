/**
 * Bug notes: a bug's place in the backlog order (owner, 2026-11-18: "We need the backlog
 * prioritization to include bugs, not just stories."). The bug itself is a GitHub issue, which
 * holds the symptoms, evidence and cause (CLAUDE.md, "A bug gets an issue"); its note holds only
 * what orders the work: `id` (`B` + the issue number), `issue`, `title`, `priority`, `status`.
 * The body is free text, usually the issue's link.
 *
 * Bugs are not stories: they never enter BACKLOG.md (graders, the Story status table and the
 * Next line read stories only) and the review-debt checks never count them (they read
 * `stories/` only; owner, same day: bugs "should not require design reviews, backlog reviews,
 * or intake reviews"). They appear beside the open stories, in one priority order, in
 * docs/v3/INDEX.md (doc-index.ts), which `/run-backlog` picks from.
 *
 * A note sits in `bugs/<status>/B<N>.md`, the folder named by its status, like a story note
 * (vault.ts storyNotePath). Build moves it there and keeps its text as written; there is nothing
 * derived to refresh.
 */

import { parse } from "yaml";
import {
	BUG_NOTE_KEY, bugNotePath, STORY_STATUSES,
} from "./vault.ts";

/** A bug note's statuses: the story ones, so a bug moves through the same folders (`superseded` for a duplicate or a non-bug). */
export const BUG_STATUSES = STORY_STATUSES;

export interface Bug
{
	id: string;
	issue: number;
	title: string;
	/** Same scale as a story's priority (lower runs first). May be fractional, to fall between two stories. */
	priority: number;
	status: string;
}

export class BugNoteError extends Error
{}

/** Parse and check one bug note. Throws {@link BugNoteError} naming the note and what is wrong. */
export function readBugNote(path: string, content: string): Bug
{
	const fail = (why: string) => new BugNoteError(`${path}: ${why}`);
	const match = /^---\n([\s\S]*?)\n---\n/.exec(content);
	if (!match)
	{
		throw fail("missing frontmatter");
	}
	const fields = (parse(match[1] ?? "") ?? {}) as Record<string, unknown>;
	const text = (key: string): string =>
	{
		const value = fields[key];
		if (typeof value !== "string" || value === "")
		{
			throw fail(`frontmatter '${key}' must be a non-empty string`);
		}
		return value;
	};
	const id = text("id");
	if (id !== BUG_NOTE_KEY.exec(path)?.[2])
	{
		throw fail(`frontmatter id '${id}' does not match the file name`);
	}
	const issue = fields.issue;
	// The ID is the issue's number, so a note can't silently point at another bug's issue.
	if (typeof issue !== "number" || `B${issue}` !== id)
	{
		throw fail(`frontmatter 'issue' must be the issue number in the ID (${id.slice(1)})`);
	}
	const priority = fields.priority;
	if (typeof priority !== "number" || !Number.isFinite(priority))
	{
		throw fail("frontmatter 'priority' must be a number");
	}
	const status = text("status");
	if (!BUG_STATUSES.includes(status))
	{
		throw fail(`frontmatter 'status' must be one of ${BUG_STATUSES.join(", ")}, got '${status}'`);
	}
	return {
		id,
		issue,
		title: text("title"),
		priority,
		status,
	};
}

/** Every bug note in `files`, parsed. Refuses two notes with one ID (a note copied rather than moved). */
export function readBugNotes(files: Map<string, string>): { bug: Bug;
	path: string;
	content: string }[]
{
	const seen = new Map<string, string>();
	const out: { bug: Bug;
		path: string;
		content: string }[] = [];
	for (const [path, content] of files)
	{
		if (!BUG_NOTE_KEY.test(path))
		{
			continue;
		}
		const bug = readBugNote(path, content);
		const other = seen.get(bug.id);
		if (other !== undefined)
		{
			throw new BugNoteError(`two notes share the ID ${bug.id}: ${other} and ${path} — keep one`);
		}
		seen.set(bug.id, path);
		out.push({
			bug,
			path,
			content,
		});
	}
	return out;
}

/** The bug notes as build writes them: each at the path its status names, its text unchanged. */
export function placeBugNotes(files: Map<string, string>): Map<string, string>
{
	return new Map(readBugNotes(files).map(({ bug, content }) => [bugNotePath(bug.id, bug.status), content]));
}

/** The bugs in a set of notes (built or on disk). */
export function bugsIn(files: Map<string, string>): Bug[]
{
	return readBugNotes(files).map(({ bug }) => bug);
}
