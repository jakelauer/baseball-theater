/**
 * A finished story's own records (S156, ACs 6 and 7): since S156 each `done` story carries a
 * `**Baseline:**` line in its note (what it changed in the Current baseline; the As of line in
 * docs/v3/INDEX.md is built from the newest one, doc-index.ts) and a changelog fragment,
 * `changelog.d/<ID>.md` (rule 16; an entry, or a `skip:` fragment recording why it has none;
 * changelog.ts), so no two stories edit one shared line.
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
 * What a story's changelog fragment is, as changelog.ts's `changelogFragmentFor` finds it: there
 * (an entry or a recorded skip), missing, or malformed (its error message).
 */
export type ChangelogState = "present" | "missing" | { malformed: string };

/** Stories the frozen ledger records as finished (a completion or a backfill entry). */
export function frozenCompletions(frozen: LedgerEntry[]): Set<string>
{
	return new Set(frozen.filter((e) => (e.kind === "completed" || e.kind === "backfill") && e.story).map((e) => e.story as string));
}

/**
 * The problems with the records of every `done` story the frozen ledger doesn't list:
 * a missing `**Baseline:**` line, and a changelog fragment (`changelog`) missing or malformed.
 */
export function recordProblems(stories: RecordedStory[], frozen: Set<string>, changelog: (id: string) => ChangelogState): string[]
{
	const problems: string[] = [];
	for (const story of stories.filter((s) => s.status === "done" && !frozen.has(s.id)))
	{
		if (baselineText(story.body) === undefined)
		{
			problems.push(`${story.id} is \`done\` but its note has no **Baseline:** line (rule 17: what it changed in the Current baseline; the As of line is built from it)`);
		}
		const state = changelog(story.id);
		if (state === "missing")
		{
			problems.push(`${story.id} is \`done\` but has no changelog fragment, changelog.d/${story.id}.md (an entry, or a \`skip:\` recording why; rule 16)`);
		}
		else if (state !== "present")
		{
			problems.push(`${story.id}'s changelog fragment is malformed: ${state.malformed}`);
		}
	}
	return problems;
}
