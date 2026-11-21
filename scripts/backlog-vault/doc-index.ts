/**
 * docs/v3/INDEX.md: where an agent starts reading the project docs.
 *
 * Owner, 2026-11-04, on cutting token sinks: "In general, a cascading linked docs approach
 * would be good whenever it is mostly lossless contextually". The big docs stay whole
 * (AUDIT.md ~1 MB, ARCHITECTURE.md ~140 KB), because graders, the backlog tool and people read
 * them as they are. This index sits on top: the backlog's generated status lines (the As of line,
 * the Next line, the review-debt line), every doc with its size, the sections of the large ones
 * with their line ranges (so a reader opens only the part it needs), the backlog rules by number,
 * and the stories and bugs by status with a link to each one's GitHub issue. It points at the text
 * rather than summarising it, so nothing is lost by starting here.
 *
 * Since S164 the stories and bugs are GitHub issues: the open table describes now, so it comes from
 * the issue cache (`pnpm backlog:sync`, read through github.ts); with no cache it lists the recorded
 * items and says to sync. The As of line and the Baseline history describe a commit, so they come
 * from the story text records (text-records.ts), offline.
 *
 * Built, never committed (S156; owner, 2026-11-20: "Stop committing them (Recommended)"):
 * `pnpm backlog:build` writes it (the post-checkout and post-merge hooks run that), and it is
 * git-ignored, so no two branches ever conflict over it. `pnpm backlog:check` builds it in memory
 * and never reads it from disk.
 */

import {
	nextCandidate, nextStoryLine, reviewDebtLine,
} from "./assemble.ts";
import {
	cacheDir, itemsFromCache, readCache,
} from "./github.ts";
import type { ItemProblem } from "./github.ts";
import type { LedgerEntry } from "./ledger.ts";
import type { Story } from "./parse.ts";
import { baselineText } from "./records.ts";
import type { BacklogItem } from "./search.ts";
import type { TextRecord } from "./text-records.ts";
import { chains } from "./text-records.ts";

/** A doc the index lists: its path relative to docs/v3/ and its text. */
export interface IndexedDoc
{
	path: string;
	text: string;
}

/** A heading's span: 1-based first line, last line, level (number of `#`) and title. */
export interface Section
{
	level: number;
	title: string;
	start: number;
	end: number;
}

/** Docs at least this large get their sections listed; a smaller one is cheap enough to read whole. */
const SECTION_BYTES = 8_000;

/** Lines inside fenced code blocks, which can hold `#` lines that are not headings. */
function fencedLines(lines: string[]): Set<number>
{
	const fenced = new Set<number>();
	let open = false;
	lines.forEach((line, i) =>
	{
		if (/^\s*(```|~~~)/.test(line))
		{
			open = !open;
			fenced.add(i);
		}
		else if (open)
		{
			fenced.add(i);
		}
	});
	return fenced;
}

/**
 * The `#`–`###` headings of `text` with the line range each covers: up to the line before the
 * next heading at its level or above, or the end of the text. A level-1 title is left out
 * (it covers the whole doc).
 */
export function sections(text: string, maxLevel = 3): Section[]
{
	const lines = text.split("\n");
	const fenced = fencedLines(lines);
	const found: Omit<Section, "end">[] = [];
	lines.forEach((line, i) =>
	{
		const m = /^(#{2,6}) +(.+?)\s*$/.exec(line);
		if (m && !fenced.has(i) && m[1]!.length <= maxLevel)
		{
			found.push({
				level: m[1]!.length,
				title: m[2]!,
				start: i + 1,
			});
		}
	});
	const last = lines.at(-1) === "" ? lines.length - 1 : lines.length;
	return found.map((s, i) =>
	{
		const next = found.slice(i + 1).find((n) => n.level <= s.level);
		return {
			...s,
			end: next ? next.start - 1 : last,
		};
	});
}

/** Plain text for an index line: no emphasis, code ticks or link targets; the first sentence, at most 90 characters. */
function plain(text: string): string
{
	const flat = text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[*`]/g, "").trim();
	const sentence = /^(.+?[.!?])(\s|$)/.exec(flat)?.[1] ?? flat;
	return sentence.length > 90 ? `${sentence.slice(0, 89).trimEnd()}…` : sentence;
}

/**
 * The numbered backlog rules (`17. The Current baseline moves …`) with their line ranges: the
 * numbered list in the note's opening section, before its first sub-heading. A rule runs to the
 * line before the next rule, or before the first unindented line after a blank one.
 */
export function numberedRules(text: string): Section[]
{
	const lines = text.split("\n");
	const firstSub = lines.findIndex((l, i) => i > 0 && /^#{2,6} /.test(l));
	const scope = firstSub === -1 ? lines.length : firstSub;
	const starts: { start: number;
		title: string }[] = [];
	for (let i = 0; i < scope; i++)
	{
		const m = /^(\d+)\. (.+)$/.exec(lines[i]!);
		if (m)
		{
			starts.push({
				start: i + 1,
				title: `${m[1]}. ${plain(m[2]!)}`,
			});
		}
	}
	return starts.map((r, k) =>
	{
		let end = (starts[k + 1]?.start ?? scope + 1) - 1;
		for (let j = r.start; j < end; j++)
		{
			if (lines[j - 1] === "" && /^\S/.test(lines[j]!))
			{
				end = j;
				break;
			}
		}
		while (end > r.start && lines[end - 1] === "")
		{
			end--;
		}
		return {
			level: 0,
			title: r.title,
			start: r.start,
			end,
		};
	});
}

const kb = (text: string) => `${Math.max(1, Math.round(Buffer.byteLength(text) / 1024))} KB`;

/** A Markdown link target that survives spaces and parentheses in file names. */
const target = (path: string) => (/[\s()]/.test(path) ? `<${path}>` : path);

/** The doc's `# ` title, or its file name. */
function docTitle(doc: IndexedDoc): string
{
	return /^# +(.+)$/m.exec(doc.text)?.[1]?.trim() ?? doc.path;
}

function sectionLines(list: Section[], baseLevel: number): string[]
{
	return list.map((s) => `${"  ".repeat(Math.max(0, s.level - baseLevel))}- \`${s.start}–${s.end}\` ${s.title}`);
}

/** One doc's entry: link, size, and (when large) its sections, plus the rules when asked. */
function docEntry(doc: IndexedDoc, label: string, rules = false): string[]
{
	const out = [`- [${label}](${target(doc.path)}) — ${kb(doc.text)}`];
	if (Buffer.byteLength(doc.text) < SECTION_BYTES)
	{
		return out;
	}
	const list = sections(doc.text);
	const base = Math.min(...list.map((s) => s.level));
	out.push(...sectionLines(list, base).map((l) => `  ${l}`));
	if (rules)
	{
		const numbered = numberedRules(doc.text);
		if (numbered.length > 0)
		{
			out.push("  - Rules, by number:");
			out.push(...numbered.map((r) => `    - \`${r.start}–${r.end}\` ${r.title}`));
		}
	}
	return out;
}

/** The open statuses, in the order the open-work table lists them. */
export const OPEN = ["doing", "todo", "blocked"];

/** What the open-work order reads of a story or a bug, which share one priority scale. */
export interface OpenItem
{
	kind: "bug" | "story";
	priority: number;
	status: string;
}

/**
 * The open-work order, the one definition (ADR-025): `doing`, then `todo`, then `blocked`; by priority
 * within each; at equal priority a bug first (.claude/skills/run-backlog/SKILL.md, step 3: it is broken
 * behaviour already shipped). INDEX.md's table and `pnpm backlog:search next` (search.ts) both sort by it.
 */
export function compareOpen(a: OpenItem, b: OpenItem): number
{
	const rank = (item: OpenItem) => (item.kind === "bug" ? 0 : 1);
	return OPEN.indexOf(a.status) - OPEN.indexOf(b.status) || a.priority - b.priority || rank(a) - rank(b);
}

/** One row of the open-work table. */
interface OpenRow extends OpenItem
{
	cells: string;
}

/** The backlog as it is now: the items in the issue cache, the repository they are issues of, and the issues it skipped. */
export interface LiveBacklog
{
	items: BacklogItem[];
	repo: string;
	/** Issues the backlog skipped (github.ts itemsFromCache), listed at INDEX's top. */
	problems?: ItemProblem[];
}

/**
 * The open stories and bugs in one table, by status then priority (owner, 2026-11-18: "We need the
 * backlog prioritization to include bugs, not just stories."), then the rest of each as linked ID
 * lists, each linked to its GitHub issue.
 */
function workLines(live: LiveBacklog): string[]
{
	const link = (i: BacklogItem) => (i.issue === undefined ? i.id : `[${i.id}](https://github.com/${live.repo}/issues/${i.issue})`);
	const cell = (text: string) => text.replace(/\|/g, "\\|");
	const rows: OpenRow[] = live.items.filter((i) => OPEN.includes(i.status)).map((i) => ({
		kind: i.kind,
		priority: i.priority,
		status: i.status,
		cells: i.kind === "story"
			? `${link(i)} ${cell(i.title)} | \`${i.status}\` | ${i.dependsOn.join(", ") || "—"} | ${i.design.join(", ") || "—"}`
			: `${link(i)} Bug #${i.issue}: ${cell(i.title)} | \`${i.status}\` | — | —`,
	})).sort(compareOpen);
	const out = [
		"| Priority | Story or bug | Status | Depends on | Design |",
		"|---|---|---|---|---|",
		...rows.map((r) => `| ${Number.isFinite(r.priority) ? r.priority : "— (not accepted)"} | ${r.cells} |`),
		"",
	];
	for (const kind of ["story", "bug"] as const)
	{
		const of = live.items.filter((i) => i.kind === kind);
		for (const status of [...new Set(of.map((i) => i.status))].filter((st) => !OPEN.includes(st)).sort())
		{
			const ids = of.filter((i) => i.status === status).sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1))).map(link);
			out.push(`**${kind === "bug" ? "Bugs " : ""}\`${status}\`** (${ids.length}): ${ids.join(", ")}`, "");
		}
	}
	return out;
}

/** The ledger as the index needs it: every entry in ledger order (AUDIT.md's, then the fragments'), and the commit it describes. */
export interface LedgerState
{
	entries: LedgerEntry[];
	/** Short sha of HEAD when the index is built. */
	head: string;
}

const BASELINE_HISTORY = "backlog/frame/06 Baseline history.md";

/**
 * The Current baseline's **As of** line (rule 17), built rather than hand-edited (S156, AC 7): the
 * newest completion entry in ledger order, its date, the HEAD the index was built at, and that
 * story's `**Baseline:**` text. A story that finished before S156 has no such line; the frozen
 * Baseline history holds its text.
 */
export function asOfLine(stories: Pick<Story, "id" | "body">[], ledger: LedgerState): string
{
	const newest = ledger.entries.filter((e) => e.kind === "completed" && e.story).at(-1);
	if (newest === undefined)
	{
		return `**As of:** HEAD \`${ledger.head}\` — no story has landed yet.`;
	}
	const text = baselineText(stories.find((s) => s.id === newest.story)?.body ?? "");
	const what = text === undefined
		? `landed (its note has no **Baseline:** line; see [Baseline history](${target(BASELINE_HISTORY)})).`
		: `landed: ${text}`;
	return `**As of:** ${newest.date} (HEAD \`${ledger.head}\`) — **${newest.story}** ${what}`;
}

/**
 * Baseline history since S156: each completed story's `**Baseline:**` text, newest first (each
 * story once, at its newest completion). The history before it is the frozen frame note 06.
 */
export function baselineHistory(stories: Pick<Story, "id" | "body">[], ledger: LedgerState): string[]
{
	const seen = new Set<string>();
	const lines: string[] = [];
	for (const entry of ledger.entries.filter((e) => e.kind === "completed" && e.story).reverse())
	{
		const id = entry.story as string;
		const text = seen.has(id) ? undefined : baselineText(stories.find((s) => s.id === id)?.body ?? "");
		seen.add(id);
		if (text !== undefined)
		{
			lines.push(`- ${entry.date} — **${id}**: ${text}`);
		}
	}
	return lines;
}

/** The whole of docs/v3/INDEX.md. `docs` are docs/v3's own Markdown files; `frame` the backlog's frame notes. */
export function renderDocIndex(input: { docs: IndexedDoc[];
	frame: IndexedDoc[];
	/** The backlog now (the issue cache), or undefined with no cache. */
	live: LiveBacklog | undefined;
	/** Each recorded story's text at this commit (its snapshot, else its newest text record), for the As of line and Baseline history. */
	texts: Pick<Story, "id" | "body">[];
	ledger: LedgerState }): string
{
	const big = new Set(["AUDIT.md", "INDEX.md"]);
	const history = baselineHistory(input.texts, input.ledger);
	const docs = input.docs.filter((d) => !big.has(d.path)).sort((a, b) => a.path.localeCompare(b.path));
	return [
		"# Baseball Theater v3 — docs index",
		"",
		"<!-- Generated by `pnpm backlog:build` (scripts/backlog-vault/doc-index.ts) — do not edit. -->",
		"",
		...problemLines(input.live),
		"**Start here, then open only what you need.** Each entry links to the text itself; for a large doc, the numbers are the "
		+ "line range of each section, so read just that range (e.g. the Read tool's offset and limit) instead of the whole file. "
		+ "Nothing below summarises a doc, so starting here loses nothing.",
		"",
		"- **A story:** its GitHub issue, `S<N>: <title>` (linked below), holds its whole text — Gap, Impact, Source, ACs, "
		+ "`/goal` line — with its priority and dependencies in its `### Backlog fields` block; GitHub holds its status. "
		+ "Read items with `pnpm backlog:search item <ID>` (from the cache `pnpm backlog:sync` writes) or `pnpm goal <N>`.",
		"- **A bug:** its GitHub issue (labelled `bug`, ID `B<issue>`) holds the symptoms; once accepted, its priority is its recorded fields block "
		+ "(`audit.sh create B<N>`), so bugs and stories are worked in one order (the table below). A bug with no record is "
			+ "unaccepted until its `create B<N>` merges, and sorts last.",
		"- **The ledger:** [audit.jsonl](audit.jsonl), one JSON line per entry with the line it starts at in "
		+ "[AUDIT.md](AUDIT.md) (~1 MB, frozen) or its fragment under `audit/`; read only that entry.",
		"- **The backlog's rules and scheduling:** the frame notes below, by rule number or section.",
		"",
		"## Backlog status",
		"",
		asOfLine(input.texts, input.ledger),
		"",
		input.live === undefined
			? "**Next (generated):** no issue cache — run `pnpm backlog:sync`, then `pnpm backlog:build`."
			: nextStoryLine(input.live.items.filter((i) => i.kind === "story").map(nextCandidate)),
		"",
		reviewDebtLine(input.ledger.entries),
		"",
		"**Baseline history since S156**, newest first (earlier lines: "
		+ `[Baseline history](${target(BASELINE_HISTORY)}), frozen):${history.length === 0 ? " none yet." : ""}`,
		"",
		...(history.length === 0 ? [] : [...history, ""]),
		"## Backlog frame notes",
		"",
		"The backlog's rules and the frame around the stories, in this order.",
		"",
		...input.frame.flatMap((d, i) => docEntry(d, d.path.replace(/^backlog\/frame\//, "").replace(/\.md$/, ""), i === 0)),
		"",
		"## Product and architecture docs",
		"",
		...docs.flatMap((d) => docEntry(d, `${d.path} — ${docTitle(d)}`)),
		"",
		"## Stories and bugs",
		"",
		"Open stories and bugs, in order (`doing`, then `todo`, then `blocked`; by priority within each, a bug before a story at equal priority):",
		"",
		...(input.live === undefined
			? ["No issue cache: run `pnpm backlog:sync`, then `pnpm backlog:build`, for the open stories and bugs. "
				+ `Recorded items at this commit: ${input.texts.map((t) => t.id).join(", ") || "none"}.`, ""]
			: workLines(input.live)),
	].join("\n").replace(/\n+$/, "\n");
}

/** Is `path` (relative to docs/v3/) one of the docs the index lists: a Markdown file directly in docs/v3/? */
export function isIndexedDoc(path: string): boolean
{
	return /^[^/]+\.md$/.test(path) && path !== "INDEX.md";
}

/**
 * Each recorded item's text at this commit: its newest snapshot's body, else its newest text record's
 * (S164; text-records.ts), so the As of line reads the `**Baseline:**` line a story shipped with.
 */
export function recordedTexts(records: TextRecord[]): Pick<Story, "id" | "body">[]
{
	const texts = new Map<string, string>();
	for (const chain of chains(records).values())
	{
		texts.set(chain.id, chain.records.at(-1)!.body);
	}
	for (const snap of records.filter((r) => r.kind === "snapshot"))
	{
		texts.set(snap.id, snap.body);
	}
	return [...texts].map(([id, body]) => ({
		id,
		body,
	}));
}

/**
 * The **Problems** section at INDEX's top: each issue the backlog skipped and why, so a broken item is
 * seen rather than silently missing from the table. Nothing when there are none (or no cache).
 */
function problemLines(live: LiveBacklog | undefined): string[]
{
	const problems = live?.problems ?? [];
	return problems.length === 0 ? [] : ["## Problems", "", "Issues the backlog skipped (fix them on GitHub or in their records, then `pnpm backlog:sync`):", "",
		...problems.map((p) => `- [#${p.issue}](https://github.com/${live!.repo}/issues/${p.issue})${p.id ? ` (${p.id})` : ""}: ${p.message.replace(/\n/g, " ")}`), ""];
}

/**
 * The backlog now, from the issue cache in the main checkout of `root` (github.ts), each item's text
 * its newest record laid over its issue (`records`), or undefined when there is no cache.
 */
export function liveBacklog(root: string, records: TextRecord[] = []): LiveBacklog | undefined
{
	const cache = readCache(cacheDir(root));
	if (cache === undefined)
	{
		return undefined;
	}
	const { items, problems } = itemsFromCache(cache, records);
	return {
		items,
		repo: cache.repo,
		problems,
	};
}

/**
 * INDEX.md for the frame notes, the text records, the ledger and docs/v3's own docs (paths relative to
 * docs/v3/). `live` is the issue cache's backlog (liveBacklog); `pnpm backlog:check` passes undefined,
 * so the check never reads the cache.
 */
export function docIndexFor(notes: Map<string, string>, records: TextRecord[], docs: IndexedDoc[], ledger: LedgerState, live: LiveBacklog | undefined): string
{
	const frame = [...notes].filter(([key]) => key.startsWith("frame/")).sort(([a], [b]) => a.localeCompare(b)).map(([key, text]) => ({
		path: `backlog/${key}`,
		text,
	}));
	return renderDocIndex({
		docs: docs.filter((d) => isIndexedDoc(d.path)),
		frame,
		live,
		texts: recordedTexts(records),
		ledger,
	});
}
