/**
 * A finished story's own records (S156, ACs 6 and 7): since S156 each `done` story carries a
 * `**Baseline:**` line in its note (what it changed in the Current baseline; the As of line in
 * docs/v3/INDEX.md is built from the newest one, doc-index.ts) and a changelog fragment,
 * `changelog.d/<ID>.md` (rule 16), or a recorded skip, so no two stories edit one shared line.
 *
 * Which stories this applies to: a `done` story with no completion entry in the frozen ledger,
 * docs/v3/AUDIT.md. Every story that finished before S156 has one there (its history is the frozen
 * Baseline history and CHANGELOG.md), and every later completion is a ledger fragment, so the
 * frozen file, which never changes again, draws the line without a list of IDs. Pure: data in,
 * problems out; `pnpm backlog:check` (cli.ts) fails on any.
 */

import type { LedgerEntry } from "./ledger.ts";

/** A story as the check needs it: its ID, status and note body. */
export interface RecordedStory
{
	id: string;
	status: string;
	body: string;
}

/** A note's `**Baseline:**` text, or undefined when it has none (or an empty one). */
export function baselineText(body: string): string | undefined
{
	const text = /^\*\*Baseline:\*\*[ \t]+(\S.*)$/m.exec(body)?.[1]?.trim();
	return text === "" ? undefined : text;
}

/**
 * A recorded changelog skip: the note's `**Changelog:** skip — <why>` line, for a story with
 * nothing a reader outside the team would call an outcome (rule 16's one exception).
 */
export function changelogSkipped(body: string): boolean
{
	return /^\*\*Changelog:\*\* skip(ped)?\b.*\S/m.test(body);
}

/** Stories the frozen ledger records as finished (a completion or a backfill entry). */
export function frozenCompletions(frozen: LedgerEntry[]): Set<string>
{
	return new Set(frozen.filter((e) => (e.kind === "completed" || e.kind === "backfill") && e.story).map((e) => e.story as string));
}

/**
 * The problems with the records of every `done` story the frozen ledger doesn't list:
 * a missing `**Baseline:**` line, and neither a changelog fragment (`hasChangelog`) nor a skip.
 */
export function recordProblems(stories: RecordedStory[], frozen: Set<string>, hasChangelog: (id: string) => boolean): string[]
{
	const problems: string[] = [];
	for (const story of stories.filter((s) => s.status === "done" && !frozen.has(s.id)))
	{
		if (baselineText(story.body) === undefined)
		{
			problems.push(`${story.id} is \`done\` but its note has no **Baseline:** line (rule 17: what it changed in the Current baseline; the As of line is built from it)`);
		}
		if (!hasChangelog(story.id) && !changelogSkipped(story.body))
		{
			problems.push(`${story.id} is \`done\` but has no changelog fragment, changelog.d/${story.id}.md, and no recorded skip (rule 16)`);
		}
	}
	return problems;
}
