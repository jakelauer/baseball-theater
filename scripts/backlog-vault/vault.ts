/**
 * Render a parsed backlog as the editable Obsidian notes under docs/v3/backlog/
 * (docs/v3/VAULT-MIGRATION.md, V3). Pure: returns path → content; the CLI writes.
 *
 * A story note holds only what isn't derivable: frontmatter plus the story body without
 * its `### S<N> — …` heading and `**Status:**` line (both rebuilt from frontmatter).
 */

import { stringify } from "yaml";
import type {
	Backlog, FramePart, Story,
} from "./parse.ts";
import { sourceKind } from "./source.ts";

const STATUS_LINE = /^\*\*Status:\*\* `[a-z]+`$/;

/**
 * The editable part of a story body. BACKLOG.md lays every story out as a blank line,
 * the content, a blank line, and the Status line; anything else is refused rather than
 * silently reshaped.
 */
export function storyContent(story: Story): string
{
	const lines = story.body.split("\n");
	const n = lines.length;
	if (n < 4 || lines[0] !== "" || lines[1] === "" || lines[n - 2] !== "" || lines[n - 3] === "" || !STATUS_LINE.test(lines[n - 1] ?? ""))
	{
		throw new Error(`${story.id}: body must be a blank line, content, a blank line, then the **Status:** line`);
	}
	return lines.slice(1, -2).join("\n");
}

export function renderStory(story: Story): string
{
	const frontmatter = stringify({
		// Authoritative — edit these.
		id: story.id,
		title: story.title,
		table_title: story.tableTitle,
		priority: story.priority,
		status: story.status,
		// Derived by `pnpm backlog:build` from the frame and the body — edits are overwritten.
		section: story.section,
		order: story.order,
		depends_on: story.dependsOn.map((id) => `[[${id}]]`),
		prefer_after: story.preferAfter.map((id) => `[[${id}]]`),
		design: story.design.map((id) => `[[${id}]]`),
		source: sourceKind(story.source),
		turn_cap: story.turnCap,
		scope_files: story.scopeFiles,
	}, {
		lineWidth: 0,
	});
	return `---\n${frontmatter}---\n\n${storyContent(story)}\n`;
}

/**
 * Every status a story may have, so each names a folder. The build refuses any other value
 * (assemble.ts readStoryNote), so a typo like `dnoe` fails instead of making a folder.
 */
export const STORY_STATUSES: readonly string[] = ["todo", "doing", "blocked", "done", "superseded"];

/**
 * Where a story's note lives: `stories/<status>/S<N>.md`, the folder named by its frontmatter
 * `status` (owner, 2026-11-17: "I would like the backlog folder organization to put stories into
 * folders by state if possible (and if obsidian won't break). the flat list is getting huge.").
 * The frontmatter stays the source of truth; `pnpm backlog:build` moves the note to match it.
 */
export function storyNotePath(id: string, status: string): string
{
	return `stories/${status}/${id}.md`;
}

/**
 * A story note's key relative to the notes dir: `stories/<status>/S<N>.md`, or the flat
 * `stories/S<N>.md` the vault used before 2026-11-17 (still read, so build can move it).
 * Groups: 1 the folder (undefined when flat), 2 the ID.
 */
export const STORY_NOTE_KEY = /^stories\/(?:([a-z]+)\/)?(S\d+)\.md$/;

/** True for the note keys the build reads: story notes (flat or in a status folder) and frame notes. */
export function isNoteKey(key: string): boolean
{
	return STORY_NOTE_KEY.test(key) || /^frame\/[^/]+\.md$/.test(key);
}

/**
 * Obsidian Bases views over the story notes. Written once if missing; yours to edit after.
 * Paths are relative to the vault root, docs/v3. The filter is a path prefix, which covers every
 * status folder under backlog/stories/ whether or not `file.inFolder` would include subfolders.
 */
export const BACKLOG_BASE = `filters:
  and:
    - file.path.startsWith("backlog/stories/")
properties:
  note.title:
    displayName: Title
  note.priority:
    displayName: Priority
  note.status:
    displayName: Status
  note.turn_cap:
    displayName: Turn cap
  note.depends_on:
    displayName: Depends on
  note.section:
    displayName: Section
  note.source:
    displayName: Source
views:
  - type: table
    name: All stories
    order:
      - file.name
      - note.title
      - note.status
      - note.priority
      - note.turn_cap
      - note.depends_on
    sort:
      - property: note.priority
        direction: ASC
  - type: table
    name: Remaining
    filters:
      and:
        - 'status != "done"'
    order:
      - file.name
      - note.title
      - note.status
      - note.priority
      - note.depends_on
    sort:
      - property: note.priority
        direction: ASC
  - type: table
    name: Why it exists
    filters:
      and:
        - 'source != "feature"'
    order:
      - file.name
      - note.title
      - note.source
      - note.status
      - note.priority
    sort:
      - property: note.priority
        direction: ASC
  - type: table
    name: By status
    groupBy:
      property: note.status
      direction: ASC
    order:
      - file.name
      - note.title
      - note.priority
    sort:
      - property: note.priority
        direction: ASC
`;

/** `frame/NN <heading>.md` — zero-padded so file order is assembly order. */
export function framePath(part: FramePart, index: number): string
{
	const name = part.heading.replace(/[\\/:*?"<>|#^[\]]/g, "-").trim();
	return `frame/${String(index).padStart(2, "0")} ${name}.md`;
}

/** Every story note and frame note, canonically formatted. */
export function renderNotes(backlog: Backlog): Map<string, string>
{
	const files = new Map<string, string>();
	for (const story of backlog.stories)
	{
		files.set(storyNotePath(story.id, story.status), renderStory(story));
	}
	backlog.frame.forEach((part, i) => files.set(framePath(part, i), part.text));
	return files;
}
