/**
 * Assemble the notes under docs/v3/backlog/ into one backlog document, in memory, and check it
 * (docs/v3/VAULT-MIGRATION.md, V3). The document is the notes laid end to end (the frame notes in
 * order, each `![[S<N>]]` embed replaced by its story), which parse.ts reads back, so a note whose
 * frontmatter disagrees with its body, a missing embed, a broken design gate or an invalid
 * **Source:** fails the build. It was once written to docs/v3/BACKLOG.md, retired by S156 (owner,
 * 2026-11-20: "Retire it (Recommended)"); nothing writes it now. Pure: path → content in, the
 * document + canonical notes out.
 */

import { placeBugNotes } from "./bugs.ts";
import { parse as parseYaml } from "yaml";
import type { LedgerEntry } from "./ledger.ts";
import { storiesDoneSince } from "./ledger.ts";
import {
	parseBacklog, STATUS_TABLE_MARKER, storyIds,
} from "./parse.ts";
import type { SourceDocs } from "./source.ts";
import { sourceProblems } from "./source.ts";
import {
	renderNotes, STORY_NOTE_KEY, STORY_STATUSES,
} from "./vault.ts";

export class VaultAssembleError extends Error
{
	constructor(message: string)
	{
		super(message);
		this.name = "VaultAssembleError";
	}
}

interface StoryNote
{
	id: string;
	title: string;
	tableTitle: string;
	priority: number;
	status: string;
	content: string;
}

const FRONTMATTER = /^---\n([\s\S]*?)\n?---\n/;

function readStoryNote(path: string, content: string): StoryNote
{
	const fail = (why: string) => new VaultAssembleError(`${path}: ${why}`);
	const match = FRONTMATTER.exec(content);
	if (!match)
	{
		throw fail("no frontmatter");
	}
	let data: unknown;
	try
	{
		data = parseYaml(match[1] ?? "");
	}
	catch (error)
	{
		throw fail(`frontmatter is not valid YAML: ${(error as Error).message}`);
	}
	const fields = (data ?? {}) as Record<string, unknown>;

	const text = (key: string) =>
	{
		const value = fields[key];
		if (typeof value !== "string" || value === "")
		{
			throw fail(`frontmatter '${key}' must be a non-empty string`);
		}
		return value;
	};

	const id = text("id");
	const fileId = /(S\d+)\.md$/.exec(path)?.[1];
	if (id !== fileId)
	{
		throw fail(`frontmatter id '${id}' does not match the file name`);
	}
	const priority = fields.priority;
	if (typeof priority !== "number" || !Number.isInteger(priority))
	{
		throw fail("frontmatter 'priority' must be an integer");
	}
	const status = text("status");
	// The status names the note's folder (vault.ts storyNotePath), so an unknown one is refused rather than made into a folder.
	if (!STORY_STATUSES.includes(status))
	{
		throw fail(`frontmatter 'status' must be one of ${STORY_STATUSES.join(", ")}, got '${status}'`);
	}

	const body = content.slice(match[0].length).replace(/^\n+/, "").replace(/\s+$/, "");
	if (body === "")
	{
		throw fail("story body is empty");
	}
	// The build writes these from frontmatter; a copy in the body would silently disagree with it.
	const duplicate = /^(### S\d+ —|\*\*Status:\*\*).*$/m.exec(body);
	if (duplicate)
	{
		throw fail(`story body must not contain "${duplicate[0]}" — the build writes the heading and Status line from frontmatter`);
	}
	return {
		id,
		title: text("title"),
		tableTitle: text("table_title"),
		priority,
		status,
		content: body,
	};
}

/** GitHub's heading anchor: lowercase, punctuation dropped, spaces to hyphens. */
export function headingAnchor(heading: string): string
{
	return heading.toLowerCase().replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, "").replace(/ /g, "-");
}

function statusRow(story: StoryNote): string
{
	return `| ${story.priority} | [${story.id}](#${headingAnchor(`${story.id} — ${story.title}`)}) | ${story.tableTitle} | \`${story.status}\` |`;
}

function storySection(story: StoryNote): string
{
	return `### ${story.id} — ${story.title}\n\n${story.content}\n\n**Status:** \`${story.status}\``;
}

/** Review debt is due at this many `done` stories since the last review (backlog rule 11; doubled from 3 by the owner, 2026-10-21; a single drift event still triggers it). */
const REVIEW_BACKSTOP = 6;

/** What the Next line needs to know about a story. */
export interface NextCandidate
{
	id: string;
	priority: number;
	status: string;
	/** Design stories named on its `**Design:**` line (rule 18). */
	design: string[];
	/** Its `**Source:**` is an open question for the owner (rule 19). */
	openSource?: boolean;
}

/** What the generated Next and review-debt lines in docs/v3/INDEX.md (doc-index.ts) start with. */
export const GENERATED_PREFIX = {
	next: "**Next (generated):** ",
	reviewDebt: "**Review debt (generated from the ledger):** ",
} as const;

/** What the Next line reads from a story note: its open-question **Source:** and **Design:** stories. */
export function nextCandidate(story: { id: string;
	priority: number;
	status: string;
	body: string }): NextCandidate
{
	return {
		id: story.id,
		priority: story.priority,
		status: story.status,
		design: storyIds(/^\*\*Design:\*\*(.*)$/m.exec(story.body)?.[1]),
		openSource: /^\*\*Source:\*\* Open:/m.test(story.body),
	};
}

/**
 * `**Next (generated):**` — the story in progress, else the lowest-priority `todo` whose
 * design stories are all `done` (rule 18) and whose reason to exist is settled (rule 19),
 * naming the gated `todo` stories it skipped.
 */
export function nextStoryLine(stories: NextCandidate[]): string
{
	const byPriority = [...stories].sort((a, b) => a.priority - b.priority);
	const statusById = new Map(stories.map((s) => [s.id, s.status]));
	const designGated = (s: NextCandidate) => s.design.some((id) => statusById.get(id) !== "done");
	const gated = (s: NextCandidate) => designGated(s) || s.openSource === true;
	const doing = byPriority.filter((s) => s.status === "doing");
	const todo = byPriority.filter((s) => s.status === "todo");
	const next = todo.find((s) => !gated(s));
	const skipped = todo.filter((s) => gated(s) && (next === undefined || s.priority < next.priority));
	const skippedFor = (why: string, ids: string[]) => (ids.length > 0 ? ` Skipped, ${why}: ${ids.join(", ")}.` : "");
	const skippedNote = skippedFor("waiting on design (rule 18)", skipped.filter(designGated).map((s) => s.id))
		+ skippedFor("waiting on the owner to say why (rule 19)", skipped.filter((s) => !designGated(s)).map((s) => s.id));
	let text: string;
	if (doing.length > 0)
	{
		text = `${doing.map((s) => `**${s.priority} / ${s.id}**`).join(", ")} in progress (\`doing\`) — finish and commit before starting another story (rule 6).`;
	}
	else if (next)
	{
		text = `**${next.priority} / ${next.id}** — the lowest **Priority** \`todo\` story not waiting on a design.${skippedNote}`;
	}
	else if (skipped.length > 0)
	{
		text = `every \`todo\` story is waiting on a design or the owner.${skippedNote}`;
	}
	else
	{
		text = "no `todo` stories remain.";
	}
	return `${GENERATED_PREFIX.next}${text}`;
}

/**
 * `**Review debt (generated …):**` — stories completed since the newest backlog review in the ledger.
 * The count is ledger.ts's {@link storiesDoneSince}, the same one `pnpm review:debt` reports.
 */
export function reviewDebtLine(entries: LedgerEntry[]): string
{
	const { review, stories: since } = storiesDoneSince(entries, "backlog");
	const count = `${since.length} of ${REVIEW_BACKSTOP} stories \`done\` since the last backlog review`;
	const when = review ? ` (${review.date}, verdict \`${review.verdict}\`)` : " (no review logged yet)";
	const which = since.length > 0 ? `: ${since.join(", ")}` : "";
	const verdict = since.length >= REVIEW_BACKSTOP
		? " **A review is due before the next story starts.**"
		: " A drift event makes a review due regardless of this count.";
	return `${GENERATED_PREFIX.reviewDebt}${count}${when}${which}.${verdict}`;
}

/** The in-memory backlog document: the frame notes in order, each story embed replaced by its section. */
export function assembleBacklog(files: Map<string, string>): string
{
	const stories = new Map<string, StoryNote>();
	// Story notes sit in status folders (vault.ts storyNotePath), so two copies of one ID can
	// coexist on disk (a note copied rather than moved); refuse rather than pick one.
	const pathById = new Map<string, string>();
	for (const [path, content] of files)
	{
		if (STORY_NOTE_KEY.test(path))
		{
			const note = readStoryNote(path, content);
			const other = pathById.get(note.id);
			if (other !== undefined)
			{
				throw new VaultAssembleError(`two notes share the ID ${note.id}: ${other} and ${path} — keep one`);
			}
			pathById.set(note.id, path);
			stories.set(note.id, note);
		}
	}

	const frameLines = [...files.keys()]
		.filter((path) => /^frame\/\d+ .*\.md$/.test(path))
		.sort()
		.map((path) => files.get(path) ?? "")
		.join("\n")
		.split("\n");
	if (frameLines.length <= 1)
	{
		throw new VaultAssembleError("no frame notes");
	}

	const embedOrder: string[] = [];
	for (const line of frameLines)
	{
		const id = /^!\[\[(S\d+)\]\]$/.exec(line)?.[1];
		if (id === undefined)
		{
			continue;
		}
		if (!stories.has(id))
		{
			throw new VaultAssembleError(`frame embeds ${id}, which has no story note`);
		}
		if (embedOrder.includes(id))
		{
			throw new VaultAssembleError(`frame embeds ${id} more than once`);
		}
		embedOrder.push(id);
	}
	const orphans = [...stories.keys()].filter((id) => !embedOrder.includes(id));
	if (orphans.length > 0)
	{
		throw new VaultAssembleError(`story notes not embedded in any frame note: ${orphans.join(", ")}`);
	}

	const rows = embedOrder
		.map((id, order) => ({
			note: stories.get(id) as StoryNote,
			order,
		}))
		.sort((a, b) => a.note.priority - b.note.priority || a.order - b.order)
		.map(({ note }) => statusRow(note));

	return frameLines.map((line) =>
	{
		if (line === STATUS_TABLE_MARKER)
		{
			return rows.join("\n");
		}
		const id = /^!\[\[(S\d+)\]\]$/.exec(line)?.[1];
		return id === undefined ? line : storySection(stories.get(id) as StoryNote);
	}).join("\n");
}

/**
 * What `pnpm backlog:build` works from: the in-memory backlog document, and every note in canonical
 * form with derived fields refreshed (bug notes as written, in their status folder).
 */
export interface BuiltBacklog
{
	/** The assembled document (never written to disk; parse.ts reads it back). */
	backlog: string;
	notes: Map<string, string>;
}

/** `docs`, when given, checks every story's `**Source:**` line against FEATURES.md and INTENT.md (rule 19). */
export function buildFromNotes(files: Map<string, string>, docs?: SourceDocs): BuiltBacklog
{
	const backlog = assembleBacklog(files);
	const parsed = parseBacklog(backlog);
	const problems = docs === undefined ? [] : sourceProblems(parsed.stories, docs);
	if (problems.length > 0)
	{
		throw new VaultAssembleError(`stories without a valid reason to exist:\n- ${problems.join("\n- ")}`);
	}
	// Bug notes never enter the backlog document (bugs.ts); build only moves each to the folder its status names.
	return {
		backlog,
		notes: new Map([...renderNotes(parsed), ...placeBugNotes(files)]),
	};
}
