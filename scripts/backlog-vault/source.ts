/**
 * Rule 19: every story says what it is for. Its `**Source:**` line names, in order of preference:
 *
 *   Feature: <name>; <name>                       features FEATURES.md describes (not dropped ones)
 *   Pillar: <Name> — <why>. Approved by owner YYYY-MM-DD: "<owner's words>"
 *                                                 only when no feature applies, and only with the owner's approval
 *   Open: <the question for the owner>. Raised YYYY-MM-DD.
 *                                                 neither fits — the story can't start until the owner answers
 *
 * Pure: story lines and doc text in, problems out.
 */

import type { Story } from "./parse.ts";

export type SourceKind = "feature" | "pillar" | "open";

/** The docs a `**Source:**` line is checked against. */
export interface SourceDocs
{
	/** docs/v3/FEATURES.md */
	features: string;
	/** docs/v3/INTENT.md */
	intent: string;
}

const KINDS: Record<string, SourceKind> = {
	"Feature:": "feature",
	"Pillar:": "pillar",
	"Open:": "open",
};

export function sourceKind(source: string | null): SourceKind | null
{
	const prefix = Object.keys(KINDS).find((p) => source?.startsWith(p));
	return prefix === undefined ? null : (KINDS[prefix] ?? null);
}

/** FEATURES.md sections whose table rows and `####` headings name features. */
const FEATURE_SECTIONS = ["Carry / cut", "New product themes", "Patronage & access"];

const SEPARATOR_ROW = /^\|[\s:|-]+\|$/;

function plain(cell: string): string
{
	return cell.replace(/[*`]/g, "").trim();
}

/** One feature FEATURES.md names, with the text that describes it. */
export interface FeatureEntry
{
	name: string;
	/** A **Drop** verdict: citing it is a problem, not a source. */
	dropped: boolean;
	/** Its table row, or its `####` heading and the lines under it up to the next heading. */
	text: string;
}

/**
 * The features FEATURES.md gives, the one reading of it (ADR-025): the first cell of each table row
 * and each `####` heading (minus a trailing goal tag like "(G2, G4)") in the feature sections, each
 * with its text, so `pnpm backlog:search seed parity` (search.ts changedRows) can tell which ones a
 * change touched, including a plain-name row or a line inside a `####` feature's body.
 */
export function featureEntries(features: string): FeatureEntry[]
{
	const entries: FeatureEntry[] = [];
	const lines = features.split("\n");
	let inSection = false;
	/** The `####` feature whose body the lines below belong to, until the next heading. */
	let open: FeatureEntry | undefined;
	lines.forEach((line, i) =>
	{
		if (/^#{1,4} /.test(line))
		{
			open = undefined;
		}
		if (line.startsWith("## "))
		{
			inSection = FEATURE_SECTIONS.some((s) => line.slice(3).startsWith(s));
			return;
		}
		if (!inSection)
		{
			return;
		}
		const heading = /^#### (.+?)(?: \([^)]*\))?$/.exec(line)?.[1];
		if (heading !== undefined)
		{
			open = {
				name: plain(heading),
				dropped: false,
				text: line,
			};
			entries.push(open);
			return;
		}
		// A line under a `####` feature is part of its text; a table there still names features, as it always has.
		if (open !== undefined)
		{
			open.text += `\n${line}`;
		}
		const isHeaderRow = SEPARATOR_ROW.test(lines[i + 1] ?? "");
		if (!line.startsWith("|") || SEPARATOR_ROW.test(line) || isHeaderRow)
		{
			return;
		}
		const cells = line.split("|").slice(1, -1);
		const name = plain(cells[0] ?? "");
		if (name !== "")
		{
			entries.push({
				name,
				dropped: cells.some((c) => c.trim().startsWith("**Drop")),
				text: line,
			});
		}
	});
	return entries;
}

/**
 * Feature names FEATURES.md gives ({@link featureEntries}). Rows with a **Drop** verdict are
 * returned separately — citing a dropped feature is a problem, not a source.
 */
export function featureNames(features: string): { live: Set<string>;
	dropped: Set<string> }
{
	const live = new Set<string>();
	const dropped = new Set<string>();
	for (const entry of featureEntries(features))
	{
		(entry.dropped ? dropped : live).add(entry.name);
	}
	return {
		live,
		dropped,
	};
}

/** INTENT.md's pillars (`## Pillars` bullets, `- **Name** — …`), each with its bullet's text: the one reading of them. */
export function pillarEntries(intent: string): Map<string, string>
{
	const pillars = new Map<string, string>();
	let inPillars = false;
	let open: string | undefined;
	for (const line of intent.split("\n"))
	{
		if (line.startsWith("#"))
		{
			open = undefined;
		}
		if (line.startsWith("## "))
		{
			inPillars = line === "## Pillars";
			continue;
		}
		const name = inPillars ? /^- \*\*(.+?)\*\* —/.exec(line)?.[1] : undefined;
		if (name !== undefined)
		{
			open = name;
			pillars.set(name, line);
		}
		else if (open !== undefined && /^\s+\S/.test(line))
		{
			// An indented continuation of the bullet belongs to it.
			pillars.set(open, `${pillars.get(open)!}\n${line}`);
		}
		else
		{
			open = undefined;
		}
	}
	return pillars;
}

/** Pillar names from INTENT.md's `## Pillars` bullets ({@link pillarEntries}). */
export function pillarNames(intent: string): Set<string>
{
	return new Set(pillarEntries(intent).keys());
}

const PILLAR = /^Pillar: (.+?) — (.+?)\s+Approved by owner (\d{4}-\d{2}-\d{2}): "(.+)"$/;

/**
 * The FEATURES rows or INTENT pillar a `**Source:**` line names: each `;`-separated feature name, or
 * the pillar's name; none for an `Open:` line. The one reading of a citation (ADR-025), used by
 * {@link sourceProblems} and by `pnpm backlog:search cites` (search.ts).
 */
export function sourceCitations(source: string | null): string[]
{
	const kind = sourceKind(source);
	if (kind === "feature")
	{
		return (source ?? "").slice("Feature:".length).split(";").map((n) => n.trim()).filter((n) => n !== "");
	}
	const pillar = kind === "pillar" ? /^Pillar: (.+?) — /.exec(source ?? "")?.[1] : undefined;
	return pillar === undefined ? [] : [pillar];
}
const RAISED = /Raised \d{4}-\d{2}-\d{2}\.?$/;

export function sourceProblems(stories: Pick<Story, "id" | "status" | "source">[], docs: SourceDocs): string[]
{
	const { live, dropped } = featureNames(docs.features);
	const pillars = pillarNames(docs.intent);
	const problems: string[] = [];
	for (const {
		id, status, source,
	} of stories)
	{
		const kind = sourceKind(source);
		if (source === null)
		{
			problems.push(`${id} has no **Source:** line — name the feature it serves, an owner-approved pillar, or the open question (rule 19)`);
		}
		else if (kind === "feature")
		{
			const names = sourceCitations(source);
			if (names.length === 0)
			{
				problems.push(`${id}'s **Source:** names no feature`);
			}
			for (const name of names)
			{
				if (dropped.has(name))
				{
					problems.push(`${id}'s **Source:** cites "${name}", which FEATURES.md drops`);
				}
				else if (!live.has(name))
				{
					problems.push(`${id}'s **Source:** cites "${name}", which is not a feature in FEATURES.md`);
				}
			}
		}
		else if (kind === "pillar")
		{
			const match = PILLAR.exec(source);
			if (!match)
			{
				problems.push(`${id}'s **Source:** cites a pillar without the owner's approval — `
					+ "`Pillar: <Name> — <why>. Approved by owner YYYY-MM-DD: \"<owner's words>\"` (rule 19)");
			}
			else if (!pillars.has(match[1] ?? ""))
			{
				problems.push(`${id}'s **Source:** cites "${match[1]}", which is not a pillar in INTENT.md`);
			}
		}
		else if (kind === "open")
		{
			if (!RAISED.test(source))
			{
				problems.push(`${id}'s open **Source:** question must end "Raised YYYY-MM-DD."`);
			}
			if (status === "doing")
			{
				problems.push(`${id} is \`${status}\` but why it exists is still an open question — the owner answers first (rule 19)`);
			}
		}
		else
		{
			problems.push(`${id}'s **Source:** must start with Feature:, Pillar:, or Open: (rule 19)`);
		}
	}
	return problems;
}
