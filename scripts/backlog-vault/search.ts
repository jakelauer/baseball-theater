/**
 * Search the backlog instead of reading all of it (S163; owner, 2026-11-20: "if we had hundreds of
 * issues and stories the reviews would be untenable. It makes more sense for agents to search issues
 * or something"). The backlog, doc parity and design intake reviews start from a **seed**: the items
 * the drift events since the last review name, plus what a query ties to them, so a review's cost
 * follows how much changed, not how big the backlog has grown.
 *
 *   pnpm backlog:search item <ID>                one item
 *   pnpm backlog:search next <n>                 the next n open items (compareOpen, INDEX.md's order)
 *   pnpm backlog:search deps <ID>                the stories it depends on
 *   pnpm backlog:search dependents <ID>          the items that depend on it (a removed ID exits 2: the seed finds its dependents)
 *   pnpm backlog:search neighbors <ID> [--window <k>]   the open items within k places of it (default 2)
 *   pnpm backlog:search cites <feature>          stories whose **Source:** names that FEATURES row (or pillar)
 *   pnpm backlog:search design <surface | amendment path>   stories built to that surface's design, or citing that amendment
 *   pnpm backlog:search path <prefix>            stories whose scope_files or acceptance criteria name a path under it
 *   pnpm backlog:search text <regex> [--open]    stories whose body matches (open ones only with --open)
 *   pnpm backlog:search issues [--since <ISO time>]   GitHub issues opened, updated or closed since then (REST)
 *   pnpm backlog:search seed backlog|parity|intake --since <sha> [--in-flight <IDs>]   what a review must read, and why
 *
 * A seed's `--since` is the commit that logged the newest review of its kind (`node
 * scripts/backlog-vault/cli.ts review-base backlog|parity`), not the debt checks' base, which a skip or
 * answers entry also moves: a change a skip passed over is still seeded by the next review.
 *
 * Every query prints its matches and then one `query: <query> → <IDs, or none>` line, which the
 * review copies into its ledger findings (scripts/audit.sh refuses a review without one). `--json`
 * prints the same as JSON. An unknown query or ID, or a malformed argument, exits 2.
 *
 * The queries are pure functions over a {@link BacklogSource}. The default is github.ts's
 * `githubSource`, the issue cache `pnpm backlog:sync` writes (S164: the stories and bugs are GitHub
 * issues); with no cache it exits 2 saying to sync. {@link notesSource}, the Obsidian notes read
 * through the backlog tool's own parser, stays for history at commits before S164.
 */

import { execFileSync } from "node:child_process";
import type {
	GhRunner, IssueSummary, IssuesResult,
} from "./github.ts";
import {
	ghRunner, githubSource, listIssues, NoCacheError,
} from "./github.ts";
import { readFileSync } from "node:fs";
import {
	dirname, join, relative, resolve,
} from "node:path";
import { fileURLToPath } from "node:url";
import { buildFromNotes } from "./assemble.ts";
import { bugsIn } from "./bugs.ts";
import { compareOpen, OPEN } from "./doc-index.ts";
import { inFlightIds } from "./in-flight.ts";
import { ledgerBase, readLedger } from "./ledger.ts";
import { readNotes } from "./notes-dir.ts";
import { parseBacklog } from "./parse.ts";
import type { SourceDocs } from "./source.ts";
import {
	featureEntries, pillarEntries, sourceCitations,
} from "./source.ts";
import { bugNotePath, storyNotePath } from "./vault.ts";

/** One backlog item as the queries see it: a story, or a bug (whose GitHub issue holds its text). */
export interface BacklogItem
{
	id: string;
	kind: "story" | "bug";
	status: string;
	priority: number;
	title: string;
	dependsOn: string[];
	preferAfter: string[];
	design: string[];
	/** The `**Source:**` line's text, or null (always null for a bug). */
	source: string | null;
	body: string;
	scopeFiles: string[];
	/** Where its text is: its note, relative to docs/v3/backlog/ (notesSource), or `issue #<n>` (github.ts). */
	note: string;
	/** Its GitHub issue's number, when it was read from one (github.ts, S164). */
	issue?: number;
}

/** Where the queries read the backlog from. */
export interface BacklogSource
{
	items(): Promise<BacklogItem[]>;
}

/** The items in a set of backlog notes (path → text, relative to docs/v3/backlog/), parsed as `pnpm backlog:check` parses them. */
export function itemsFromNotes(notes: Map<string, string>): BacklogItem[]
{
	const built = buildFromNotes(notes);
	const stories: BacklogItem[] = parseBacklog(built.backlog).stories.map((s) => ({
		id: s.id,
		kind: "story",
		status: s.status,
		priority: s.priority,
		title: s.tableTitle,
		dependsOn: s.dependsOn,
		preferAfter: s.preferAfter,
		design: s.design,
		source: s.source,
		body: s.body,
		scopeFiles: s.scopeFiles,
		note: storyNotePath(s.id, s.status),
	}));
	const bugs: BacklogItem[] = bugsIn(built.notes).map((b) => ({
		id: b.id,
		kind: "bug",
		status: b.status,
		priority: b.priority,
		title: b.title,
		dependsOn: [],
		preferAfter: [],
		design: [],
		source: null,
		body: "",
		scopeFiles: [],
		note: bugNotePath(b.id, b.status),
	}));
	return [...stories, ...bugs];
}

/** The backlog's Obsidian notes under `<root>/docs/v3/backlog/`. */
export function notesSource(root: string): BacklogSource
{
	return {
		items: async () => itemsFromNotes(await readNotes(join(root, "docs/v3/backlog"))),
	};
}

/** A bad query or an ID no item has: the CLI exits 2. */
export class SearchUsageError extends Error
{}

const isOpen = (item: BacklogItem) => OPEN.includes(item.status);

/** The item with `id`, or a {@link SearchUsageError}. */
export function item(items: BacklogItem[], id: string): BacklogItem
{
	const found = items.find((i) => i.id === id.toUpperCase());
	if (found === undefined)
	{
		throw new SearchUsageError(`no story or bug ${id}`);
	}
	return found;
}

/** The open items in INDEX.md's order (doc-index.ts compareOpen): `doing`, `todo`, `blocked`; by priority; a bug before a story at equal priority. */
export function openOrder(items: BacklogItem[]): BacklogItem[]
{
	return items.filter(isOpen).sort(compareOpen);
}

/** The first `n` open items. */
export function next(items: BacklogItem[], n: number): BacklogItem[]
{
	return openOrder(items).slice(0, n);
}

/**
 * The first `n` `todo` stories in {@link openOrder}: a review's "next 3". A `doing` story is already
 * being built and a bug is not a story, so neither is one of them (the backlog review's check 1).
 */
export function nextTodo(items: BacklogItem[], n: number): BacklogItem[]
{
	return openOrder(items).filter((i) => i.kind === "story" && i.status === "todo").slice(0, n);
}

/** The items `id` depends on. */
export function deps(items: BacklogItem[], id: string): BacklogItem[]
{
	return item(items, id).dependsOn.flatMap((d) => items.filter((i) => i.id === d));
}

/**
 * The items whose `depends_on` names `id`, found by scanning every item, so it works for an ID no note
 * has any more (the seed's `removed` events use it so). The CLI's `dependents <ID>` still requires a
 * known ID, as every ID query does (AC 1).
 */
export function dependents(items: BacklogItem[], id: string): BacklogItem[]
{
	return items.filter((i) => i.dependsOn.includes(id));
}

/** `prefer_after` links both ways: the items `id` prefers to follow, and the items preferring to follow it. */
export function preferLinks(items: BacklogItem[], id: string): BacklogItem[]
{
	const own = items.find((i) => i.id === id)?.preferAfter ?? [];
	return items.filter((i) => own.includes(i.id) || i.preferAfter.includes(id));
}

/** The open items within `window` places of `id` in {@link openOrder}; none when it isn't open. */
export function neighbors(items: BacklogItem[], id: string, window = 2): BacklogItem[]
{
	item(items, id);
	const order = openOrder(items);
	const at = order.findIndex((i) => i.id === id);
	return at === -1 ? [] : order.filter((_, k) => k !== at && Math.abs(k - at) <= window);
}

/** The stories whose `**Source:**` line names the FEATURES row or INTENT pillar `name` (source.ts sourceCitations); a mention elsewhere doesn't count. */
export function cites(items: BacklogItem[], name: string): BacklogItem[]
{
	return items.filter((i) => i.kind === "story" && sourceCitations(i.source).includes(name));
}

/** A design file's surface: `docs/v3/visual/<surface>/…`. */
export function surfaceOf(path: string): string | undefined
{
	return /(?:^|\/)visual\/([^/]+)\//.exec(path)?.[1];
}

/**
 * The stories built to a surface's design: those whose `**Design:**` line names a design story of
 * it (a story some `**Design:**` line names, whose own text points at `visual/<surface>/`). Given an
 * amendment's path, also the stories whose text cites that amendment (`<surface>/amendments/<file>`).
 */
export function design(items: BacklogItem[], arg: string): BacklogItem[]
{
	const surface = surfaceOf(arg) ?? arg;
	const named = new Set(items.flatMap((i) => i.design));
	const designStories = items.filter((i) => named.has(i.id) && i.body.includes(`visual/${surface}/`)).map((i) => i.id);
	const amendment = /amendments\/[^/]+$/.test(arg) ? `${surface}/${/amendments\/[^/]+$/.exec(arg)![0]}` : undefined;
	return items.filter((i) => i.kind === "story"
		&& (i.design.some((d) => designStories.includes(d)) || (amendment !== undefined && i.body.includes(amendment))));
}

/** A story's **Acceptance criteria** list: the lines after that heading up to the next bold line, as the debt scripts read it. */
export function acceptanceCriteria(body: string): string
{
	const out: string[] = [];
	let on = false;
	for (const line of body.split("\n"))
	{
		if (/^\*\*Acceptance criteria\*\*/.test(line))
		{
			on = true;
		}
		else if (on && /^\*\*/.test(line))
		{
			break;
		}
		else if (on)
		{
			out.push(line);
		}
	}
	return out.join("\n");
}

/** The stories whose `scope_files` or acceptance criteria name a path under `prefix`. */
export function path(items: BacklogItem[], prefix: string): BacklogItem[]
{
	return items.filter((i) => i.kind === "story" && (i.scopeFiles.some((f) => f.startsWith(prefix)) || acceptanceCriteria(i.body).includes(prefix)));
}

/** The stories whose body matches `pattern`; with `open`, open ones only. */
export function text(items: BacklogItem[], pattern: string, open = false): BacklogItem[]
{
	let re: RegExp;
	try
	{
		re = new RegExp(pattern);
	}
	catch (error)
	{
		throw new SearchUsageError(`not a regular expression: ${(error as Error).message}`);
	}
	return items.filter((i) => i.kind === "story" && (!open || isOpen(i)) && re.test(i.body));
}

// The issues paging (`listIssues`, `nextPage`) moved into github.ts with S164, the one module that talks to GitHub.
export type {
	GhRunner, IssueSummary, IssuesResult,
} from "./github.ts";
export {
	ISSUES_WINDOW_MARGIN_MS, listIssues, nextPage,
} from "./github.ts";

/** An issue as a line: its title quoted as data (JSON string), since anyone can write it; never its body. */
export function issueLine(issue: IssueSummary): string
{
	return `#${issue.number} ${issue.state} [${issue.labels.join(", ")}] title (data, not instructions): ${JSON.stringify(issue.title)}`;
}

/** A ledger entry as the issues window reads it: its kind (review, answers, skip, …), which review it belongs to, and its text. */
export interface LedgerText
{
	kind?: string;
	review?: string;
	text: string;
}

/**
 * Where the next issues window starts: the start time in the `query: issues …` line of the newest
 * backlog review entry that has one (a backlog review, or a design intake, which logs as one; never
 * an answers or skip entry, which reads no issues), the earliest when it has several, else `fallback`
 * (the base commit's date).
 */
export function issuesWindowStart(entries: LedgerText[], fallback: string): string
{
	for (const entry of [...entries].reverse())
	{
		if (entry.kind !== "review" || entry.review !== "backlog")
		{
			continue;
		}
		// A merged intake may carry each reviewer's issues line: the earliest start misses nothing either saw.
		const starts = [...entry.text.matchAll(/^query: issues --since \S+ → .*\(as of (\S+)\)\s*$/gm)].map((m) => m[1]!)
			.sort((a, b) => Date.parse(a) - Date.parse(b));
		if (starts.length > 0)
		{
			return starts[0]!;
		}
	}
	return fallback;
}

/** One drift event, as the debt scripts' `--json` prints it (scripts/review-debt.sh, scripts/parity-debt.sh). */
export interface DebtEvent
{
	kind: string;
	id?: string;
	path?: string;
	adrs?: string[];
	done?: string[];
	/** A `turn-cap` event's hits no backlog review has listed yet: each hit's `at` (S158 AC 7). */
	hits?: string[];
}

/** A debt script's `--json` report. */
export interface DebtReport
{
	due: boolean;
	base: string;
	done: string[];
	inFlight: string[];
	events: DebtEvent[];
}

/** One item a review must read, every reason it was picked, and whether it is in flight (findings then go to the overseer, not the note). */
export interface SeedPick
{
	id: string;
	reasons: string[];
	inFlight: boolean;
}

/** What a review must read. */
export interface Seed
{
	picks: SeedPick[];
	/** FEATURES rows or INTENT pillars to read (parity). */
	rows: SeedPick[];
	/** Design or doc files the events name. */
	files: string[];
}

/** Collects picks in order, each once, its reasons merged. */
function collector(inFlight: string[])
{
	const picks = new Map<string, SeedPick>();
	return {
		add(id: string, reason: string)
		{
			const pick = picks.get(id) ?? {
				id,
				reasons: [],
				inFlight: inFlight.includes(id),
			};
			if (!pick.reasons.includes(reason))
			{
				pick.reasons.push(reason);
			}
			picks.set(id, pick);
		},
		list: () => [...picks.values()],
	};
}

/** The event kinds that name one story whose note a review reads. */
// `turn-cap` (S158 AC 7): a story that hit its turn cap mid-run, read from the run journals and run entries.
const STORY_EVENTS = ["inserted", "removed", "reprioritized", "ac-rewritten", "source-changed", "purpose-changed", "turn-cap"];

/** Extra input a backlog seed needs beyond the notes and the events. */
export interface BacklogSeedContext
{
	/** For each story done since the base: the open issues its note or its own commits cite ({@link citedIssues}). */
	citedIssues?: Record<string, number[]>;
	/** Cited numbers REST couldn't check (not a 404): kept, and their reason says so. */
	uncheckedIssues?: number[];
	/** The issues `issues --since` listed. */
	issues?: IssueSummary[];
}

/**
 * The backlog review's seed (S163 AC 2): every item an event names and the next 3 `todo` stories, each
 * with its dependencies, dependents, `prefer_after` links both ways and neighbors (window 2); for
 * each story done since the base, its dependents, the open stories naming it and the issues it
 * cites; for each ADR changed, the open stories citing it; and the issues changed since the last
 * window. Nothing here reads the whole backlog's order, so the seed's size follows the change.
 */
export function seedBacklog(items: BacklogItem[], report: DebtReport, ctx: BacklogSeedContext = {}, c = collector(report.inFlight)): Seed
{
	const known = (id: string) => items.some((i) => i.id === id);
	const anchors: string[] = [];
	for (const event of report.events)
	{
		if (event.id === undefined || !STORY_EVENTS.includes(event.kind))
		{
			continue;
		}
		if (event.kind === "removed")
		{
			// The note is gone, so its links are found by scanning every note for the ID, never by looking it up.
			dependents(items, event.id).forEach((i) => c.add(i.id, `depends on ${event.id}, removed`));
			items.filter((i) => i.preferAfter.includes(event.id!)).forEach((i) => c.add(i.id, `prefers after ${event.id}, removed`));
			continue;
		}
		if (known(event.id))
		{
			c.add(event.id, event.kind);
			anchors.push(event.id);
		}
	}
	for (const story of nextTodo(items, 3))
	{
		c.add(story.id, "one of the next 3 todo stories");
		anchors.push(story.id);
	}
	for (const id of new Set(anchors))
	{
		deps(items, id).forEach((i) => c.add(i.id, `${id} depends on it`));
		dependents(items, id).forEach((i) => c.add(i.id, `depends on ${id}`));
		preferLinks(items, id).forEach((i) => c.add(i.id, `prefer_after link with ${id}`));
		neighbors(items, id, 2).forEach((i) => c.add(i.id, `neighbor of ${id}`));
	}
	const closed = new Set((ctx.issues ?? []).filter((i) => i.state === "closed").map((i) => i.number));
	for (const id of report.done)
	{
		dependents(items, id).forEach((i) => c.add(i.id, `depends on ${id}, done since`));
		text(items, `\\b${id}\\b`, true).filter((i) => i.id !== id).forEach((i) => c.add(i.id, `names ${id}, done since`));
		(ctx.citedIssues?.[id] ?? []).filter((n) => !closed.has(n)).forEach((n) => c.add(`#${n}`,
			`cited by ${id}'s note or commits${ctx.uncheckedIssues?.includes(n) ? " (not checked: gh failed)" : ""}`));
	}
	for (const adr of report.events.filter((e) => e.kind === "adr-changed").flatMap((e) => e.adrs ?? []))
	{
		text(items, `\\b${adr}\\b`, true).forEach((i) => c.add(i.id, `cites ${adr}, changed`));
	}
	for (const issue of ctx.issues ?? [])
	{
		// An issue that is a backlog item (its trusted ID, from the items) is picked as that item, once.
		// A story closed not_planned is a `removed` event in the debt report (github.ts removedSince, by
		// its closed_at), handled above: this window lists issues by updated_at, which any touch moves.
		const item = items.find((i) => i.issue === issue.number);
		c.add(item ? item.id : `#${issue.number}`, `issue ${issue.state === "closed" ? "closed" : "opened or updated"} since the last window`);
	}
	return {
		picks: c.list(),
		rows: [],
		files: [],
	};
}

/**
 * The FEATURES rows and INTENT pillars a change touched (S163 AC 2): each feature or pillar whose text
 * differs between `before` and `after` (added, removed or edited), read as backlog:check reads them
 * (source.ts featureEntries and pillarEntries), so a plain-name row, an edit inside a `####`
 * feature's body and a renamed row (both names) all count.
 */
export function changedRows(before: SourceDocs, after: SourceDocs): string[]
{
	const texts = (docs: SourceDocs) =>
	{
		const map = new Map<string, string>();
		featureEntries(docs.features).forEach((e) => map.set(e.name, `${map.get(e.name) ?? ""}${e.text}\n`));
		pillarEntries(docs.intent).forEach((text, name) => map.set(name, `${map.get(name) ?? ""}${text}\n`));
		return map;
	};
	const was = texts(before);
	const now = texts(after);
	return [...new Set([...was.keys(), ...now.keys()])].filter((name) => was.get(name) !== now.get(name));
}

/**
 * The doc parity review's seed (S163 AC 2): every story an event names, the next 3 `todo` stories
 * (its check 1), the stories citing each FEATURES or INTENT row changed since the base, and each
 * story done since with the rows its Source names.
 */
export function seedParity(items: BacklogItem[], report: DebtReport, rows: string[]): Seed
{
	const c = collector(report.inFlight);
	const r = collector([]);
	const files: string[] = [];
	for (const event of report.events)
	{
		if (event.id !== undefined && STORY_EVENTS.includes(event.kind))
		{
			c.add(event.id, event.kind);
		}
		if (event.kind === "doc-changed" && event.path !== undefined)
		{
			files.push(event.path);
		}
	}
	nextTodo(items, 3).forEach((i) => c.add(i.id, "one of the next 3 todo stories"));
	for (const name of rows)
	{
		r.add(name, "changed since the base");
		cites(items, name).forEach((i) => c.add(i.id, `cites "${name}", changed`));
	}
	for (const id of report.done)
	{
		c.add(id, "done since");
		sourceCitations(items.find((i) => i.id === id)?.source ?? null).forEach((name) => r.add(name, `cited by ${id}, done since`));
	}
	return {
		picks: c.list(),
		rows: r.list(),
		files,
	};
}

/**
 * Whether an ADR is a frontend one, whose change makes a design intake due: the same list
 * scripts/review-debt.sh tests ARCHITECTURE.md's diff against (003, 008, 014, 016, 020–026).
 */
export function isFrontendAdr(adr: string): boolean
{
	return /^ADR-0(03|08|14|16|2[0-6])$/.test(adr);
}

/**
 * Whether a report holds only design intake events (a ratified amendment or surface, or an ADR
 * change naming frontend ADRs only) and no story done since. Otherwise the intake, which logs as the
 * backlog review and so moves its base and resets its count, must also read the backlog seed.
 */
export function intakeOnly(report: DebtReport): boolean
{
	return report.done.length === 0 && report.events.every((e) => e.kind === "amendment" || e.kind === "surface-ratified"
		|| (e.kind === "adr-changed" && (e.adrs ?? []).length > 0 && e.adrs!.every(isFrontendAdr)));
}

/**
 * The design intake's seed (S163 AC 2): for each ratified amendment or surface file an event names,
 * that file and the stories {@link design} returns for it; for each changed frontend ADR, the open
 * stories citing it. When the report carries anything else (a story event, a non-frontend ADR, a
 * story done since), the backlog seed too ({@link seedBacklog}, with `ctx`), since the intake is
 * logged as the backlog review (`scripts/audit.sh review`) and the next backlog seed starts after it.
 */
export function seedIntake(items: BacklogItem[], report: DebtReport, ctx: BacklogSeedContext = {}): Seed
{
	const c = collector(report.inFlight);
	const files: string[] = [];
	for (const event of report.events)
	{
		if ((event.kind === "amendment" || event.kind === "surface-ratified") && event.path !== undefined)
		{
			files.push(event.path);
			design(items, event.path).forEach((i) => c.add(i.id, `built to ${event.path}`));
		}
		for (const adr of event.kind === "adr-changed" ? (event.adrs ?? []).filter(isFrontendAdr) : [])
		{
			text(items, `\\b${adr}\\b`, true).forEach((i) => c.add(i.id, `cites ${adr}, changed`));
		}
	}
	if (!intakeOnly(report))
	{
		seedBacklog(items, report, ctx, c);
	}
	return {
		picks: c.list(),
		rows: [],
		files,
	};
}

/** The `query:` line for a list of IDs. */
export function queryLine(query: string, ids: string[]): string
{
	return `query: ${query} → ${ids.length === 0 ? "none" : ids.join(", ")}`;
}

/** An item as one line: ID, status, priority, title and note. */
function itemLine(i: BacklogItem): string
{
	const priority = Number.isFinite(i.priority) ? `p${i.priority}` : "unaccepted";
	return `${i.id} \`${i.status}\` ${priority} ${i.title} — ${i.issue === undefined ? `docs/v3/backlog/${i.note}` : `#${i.issue}`}`;
}

// ---- CLI ----

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function run(cmd: string, args: string[], cwd = repoRoot): string
{
	return execFileSync(cmd, args, {
		cwd,
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
		stdio: ["ignore", "pipe", "pipe"],
	});
}

/** The flags that take no value; every other `--flag` takes the next word. */
const SWITCHES = ["--json", "--open"];

/**
 * The `--flag value` options a query takes, and the remaining words. A value flag must be followed by
 * a value, not by another flag (`--since --json` is a usage error, never `since = "--json"`).
 */
function options(args: string[]): { words: string[];
	flags: Record<string, string | true> }
{
	const words: string[] = [];
	const flags: Record<string, string | true> = {};
	for (let k = 0; k < args.length; k++)
	{
		const a = args[k]!;
		if (SWITCHES.includes(a))
		{
			flags[a.slice(2)] = true;
		}
		else if (a.startsWith("--"))
		{
			const value = args[k + 1];
			if (value === undefined || value.startsWith("--"))
			{
				throw new SearchUsageError(`${a} needs a value`);
			}
			flags[a.slice(2)] = value;
			k++;
		}
		else
		{
			words.push(a);
		}
	}
	return {
		words,
		flags,
	};
}

/** A whole number ≥ 0 (`next <n>`, `--window <k>`), else a usage error. */
function count(value: string, what: string): number
{
	if (!/^\d+$/.test(value))
	{
		throw new SearchUsageError(`${what} must be a whole number, not '${value}'`);
	}
	return Number(value);
}

/** What `seed` and `issues` reach outside the notes: injected so tests never run the debt scripts, git or GitHub. */
export interface SeedDeps
{
	/**
	 * The debt script's `--json` report measured from `since` (review-debt.sh for a backlog or intake
	 * seed, parity-debt.sh for parity), with `inFlight` passed as its `--in-flight`.
	 */
	debtReport(kind: "backlog" | "parity" | "intake", since: string, inFlight: string[]): DebtReport;
	gh: GhRunner;
	git(args: string[]): string;
	/** The ledger's entries with their text, for {@link issuesWindowStart}. */
	ledgerTexts(): LedgerText[];
	/** The items in flight: `flag` when given (even empty), else the main checkout's claims ({@link seedInFlight}). */
	inFlight(flag?: string): string[];
	/** The commit the `issues` query's default window falls back to: the newest backlog review itself. */
	issuesBase(): string;
}

/** The ledger the tools read: `BT_AUDIT_LEDGER` when set, as the debt scripts and audit.sh read it, else docs/v3/AUDIT.md. */
export function auditLedgerPath(env: Record<string, string | undefined> = process.env): string
{
	return resolve(repoRoot, env.BT_AUDIT_LEDGER ?? "docs/v3/AUDIT.md");
}

/** The ledger's entries with their text (fragments only: the frozen AUDIT.md predates `query:` lines). */
function readLedgerTexts(): LedgerText[]
{
	const audit = auditLedgerPath();
	return readLedger(audit).filter((e) => e.file !== undefined).map((e) => ({
		kind: e.kind,
		review: e.review,
		text: readFileSync(join(dirname(audit), e.file!), "utf8"),
	}));
}

/**
 * The items in flight for a seed run from `root`, which may be a review's own worktree: the claims live
 * in the main checkout's `.run/claims/` (the run writes them there), so they are read from the
 * directory above git's common dir (the skills' `$MAIN`), or from `root` itself outside git. An
 * explicit `flag` wins, even empty (in-flight.ts).
 */
export function seedInFlight(root: string, flag?: string): string[]
{
	let main = root;
	try
	{
		main = dirname(resolve(root, run("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], root).trim()));
	}
	catch
	{
		// Not a git checkout: the claims, if any, are under root.
	}
	return inFlightIds(main, flag);
}

/** The real dependencies: the repo's debt scripts, git, gh and ledger. */
export const realDeps: SeedDeps = {
	debtReport: (kind, since, inFlight) => JSON.parse(run("bash", [
		join(repoRoot, kind === "parity" ? "scripts/parity-debt.sh" : "scripts/review-debt.sh"), "--json", "--since", since, "--in-flight", inFlight.join(","),
	])) as DebtReport,
	gh: ghRunner,
	git: (args) => run("git", args),
	ledgerTexts: readLedgerTexts,
	inFlight: (flag) => seedInFlight(repoRoot, flag),
	issuesBase: () => ledgerBase(repoRoot, relative(repoRoot, auditLedgerPath()), "backlog", ["review"]) ?? "",
};

/** The default issues window: from the newest backlog review's `issues` line, else the base commit's date. */
function defaultSince(base: string, io: SeedDeps): string
{
	const fallback = base === "" ? new Date(0).toISOString() : io.git(["show", "-s", "--format=%cI", base]).trim();
	return issuesWindowStart(io.ledgerTexts(), fallback);
}

/** A citation of an issue or pull request by number (`#12`, `Fixes #12`, `Part of #12`): not part of a word, a path or a colour like `#12ab`. */
const CITED = /(?<![\w&/#])#(\d{1,6})(?![\w-])/g;

/** The open issues done stories cite, and those of them REST couldn't check. */
export interface CitedIssues
{
	cited: Record<string, number[]>;
	unchecked: number[];
}

/**
 * The open issues a done story cites (S163 AC 2), by story: the numbers its note and its own commits
 * name. Its own commits are those whose subject starts with its ID ("S156: …", "S156 AC 1: …",
 * "S144 done: …"), merges left out (a merge's "Merge pull request #N" names the pull request, and
 * "Backlog: S158, …" names many stories). Each number is checked through REST and kept only when it is
 * an open issue, not a pull request or a closed issue. A 404 (no such issue) drops it; any other
 * failure (REST can't be reached) keeps it as unchecked, since reading one issue too many is cheaper
 * than missing one, and the seed says it wasn't checked.
 */
export function citedIssues(items: BacklogItem[], done: string[], io: Pick<SeedDeps, "git" | "gh">): CitedIssues
{
	const cited: Record<string, number[]> = {};
	const unchecked = new Set<number>();
	if (done.length === 0)
	{
		return {
			cited,
			unchecked: [],
		};
	}
	const commits = io.git(["log", "--no-merges", "--format=%H%x09%s", "HEAD"]).split("\n").filter(Boolean).map((l) => l.split("\t") as [string, string]);
	const open = new Map<number, boolean>();
	const isOpen = (n: number) =>
	{
		if (!open.has(n))
		{
			try
			{
				const issue = JSON.parse(io.gh(["api", `repos/{owner}/{repo}/issues/${n}`])) as { state?: string;
					pull_request?: unknown };
				open.set(n, issue.state === "open" && issue.pull_request === undefined);
			}
			catch (error)
			{
				const missing = /HTTP 404/.test((error as Error).message);
				open.set(n, !missing);
				if (!missing)
				{
					unchecked.add(n);
				}
			}
		}
		return open.get(n)!;
	};
	for (const id of done)
	{
		const own = new RegExp(`^${id}([^0-9]|$)`);
		const shas = commits.filter(([, subject]) => own.test(subject)).map(([sha]) => sha);
		const bodies = shas.length === 0 ? "" : io.git(["show", "-s", "--format=%B", ...shas]);
		const text = `${items.find((i) => i.id === id)?.body ?? ""}\n${bodies}`;
		const numbers = [...new Set([...text.matchAll(CITED)].map((m) => Number(m[1])))].sort((a, b) => a - b);
		cited[id] = numbers.filter(isOpen);
	}
	return {
		cited,
		unchecked: [...unchecked].sort((a, b) => a - b),
	};
}

/** A sha `--since` can name: 4–40 hex digits. */
const SHA = /^[0-9a-f]{4,40}$/i;

async function seedCommand(kind: string | undefined, flags: Record<string, string | true>, source: BacklogSource, io: SeedDeps): Promise<string>
{
	if (kind !== "backlog" && kind !== "parity" && kind !== "intake")
	{
		throw new SearchUsageError("seed needs backlog, parity or intake");
	}
	const since = flags.since;
	const review = kind === "parity" ? "parity" : "backlog";
	if (since === "")
	{
		throw new SearchUsageError(`no ${review} review logged yet (cli.ts review-base ${review} printed nothing): the first review reads the whole backlog`);
	}
	if (typeof since !== "string" || !SHA.test(since))
	{
		throw new SearchUsageError(`seed needs --since <sha> (node scripts/backlog-vault/cli.ts review-base ${review})`);
	}
	const json = flags.json === true;
	const items = await source.items();
	const report = io.debtReport(kind, since, io.inFlight(typeof flags["in-flight"] === "string" ? flags["in-flight"] : undefined));
	const lines = report.events.map((e) => `event: ${[e.kind, e.id ?? e.path, ...(e.adrs ?? []), ...(e.done ?? [])].filter((x) => x !== undefined && x !== "").join(" ")}`);
	let seed: Seed;
	let issues: IssuesResult | undefined;
	let issuesError: string | null = null;
	/** The backlog seed's outside reads: the issues changed since the last window and the issues done stories cite. */
	const backlogContext = (): BacklogSeedContext =>
	{
		try
		{
			issues = listIssues(defaultSince(since, io), io.gh);
		}
		catch (error)
		{
			issuesError = (error as Error).message.split("\n")[0] ?? "gh failed";
			lines.push(`issues: could not list them (${issuesError}); run \`pnpm backlog:search issues\` before the review ends`);
		}
		const cited = citedIssues(items, report.done, io);
		return {
			citedIssues: cited.cited,
			uncheckedIssues: cited.unchecked,
			issues: issues?.issues,
		};
	};
	if (kind === "backlog")
	{
		seed = seedBacklog(items, report, backlogContext());
	}
	else if (kind === "parity")
	{
		const docs = (rev: string): SourceDocs => ({
			features: io.git(["show", `${rev}:docs/v3/FEATURES.md`]),
			intent: io.git(["show", `${rev}:docs/v3/INTENT.md`]),
		});
		seed = seedParity(items, report, changedRows(docs(since), docs("HEAD")));
	}
	else
	{
		seed = seedIntake(items, report, intakeOnly(report) ? {} : backlogContext());
	}
	const query = queryLine(`seed ${kind} --since ${since}`, [...seed.picks.map((p) => p.id), ...seed.rows.map((r) => `"${r.id}"`), ...seed.files]);
	if (json)
	{
		return JSON.stringify({
			...seed,
			events: report.events,
			issues: issues?.issues,
			issuesError,
			queries: [query, ...(issues ? [issues.query] : [])],
		}, null, "\t");
	}
	const titles = new Map((issues?.issues ?? []).map((i) => [`#${i.number}`, i]));
	for (const pick of seed.picks)
	{
		const it = items.find((i) => i.id === pick.id);
		const issue = titles.get(pick.id);
		const what = it ? itemLine(it) : issue ? issueLine(issue) : pick.id;
		lines.push(`${what}${pick.inFlight ? " (in flight: send findings to the overseer)" : ""}\n    why: ${pick.reasons.join("; ")}`);
	}
	seed.rows.forEach((r) => lines.push(`row "${r.id}"\n    why: ${r.reasons.join("; ")}`));
	seed.files.forEach((f) => lines.push(`file ${f}`));
	if (issues)
	{
		lines.push(issues.query);
	}
	lines.push(query);
	return lines.join("\n");
}

/** An ISO 8601 date or time `issues --since` takes. */
const ISO = /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/;

/** Runs one query; returns what to print. Throws {@link SearchUsageError} for exit 2. */
export async function main(argv: string[], source: BacklogSource = githubSource(repoRoot), io: SeedDeps = realDeps): Promise<string>
{
	const { words, flags } = options(argv);
	const [name, ...rest] = words;
	const json = flags.json === true;
	if (name === "seed")
	{
		return seedCommand(rest[0], flags, source, io);
	}
	if (name === "issues")
	{
		if (typeof flags.since === "string" && (!ISO.test(flags.since) || Number.isNaN(Date.parse(flags.since))))
		{
			throw new SearchUsageError(`issues --since needs an ISO date or time, not '${flags.since}'`);
		}
		const since = typeof flags.since === "string" ? flags.since : defaultSince(io.issuesBase(), io);
		const result = listIssues(since, io.gh);
		return json ? JSON.stringify(result, null, "\t") : [...result.issues.map(issueLine), result.query].join("\n");
	}
	const arg = rest.join(" ");
	const window = typeof flags.window === "string" ? count(flags.window, "--window") : 2;
	const items = await source.items();
	const need = () =>
	{
		if (arg === "")
		{
			throw new SearchUsageError(`${name} needs an argument`);
		}
		return arg;
	};
	/** An ID argument, normalized once to the item's own ID (a lowercase `s9` is S9); an ID no item has exits 2. */
	const id = () => item(items, need()).id;
	let found: BacklogItem[];
	let query: string;
	switch (name)
	{
		case "item": found = [item(items, need())]; query = `item ${found[0]!.id}`; break;
		case "next": found = next(items, count(need(), "next")); query = `next ${arg}`; break;
		case "deps": query = `deps ${id()}`; found = deps(items, id()); break;
		case "dependents": query = `dependents ${id()}`; found = dependents(items, id()); break;
		case "neighbors": query = `neighbors ${id()} --window ${window}`; found = neighbors(items, id(), window); break;
		case "cites": found = cites(items, need()); query = `cites ${arg}`; break;
		case "design": found = design(items, need()); query = `design ${arg}`; break;
		case "path": found = path(items, need()); query = `path ${arg}`; break;
		case "text": found = text(items, need(), flags.open === true); query = flags.open === true ? `text ${arg} --open` : `text ${arg}`; break;
		default: throw new SearchUsageError(`unknown query '${name ?? ""}': item, next, deps, dependents, neighbors, cites, design, path, text, issues or seed`);
	}
	const line = queryLine(query, found.map((i) => i.id));
	if (json)
	{
		return JSON.stringify({
			query: line,
			items: found,
		}, null, "\t");
	}
	return [...found.map(itemLine), line].join("\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
{
	try
	{
		console.log(await main(process.argv.slice(2)));
	}
	catch (error)
	{
		console.error(`backlog:search: ${(error as Error).message}`);
		process.exitCode = error instanceof SearchUsageError || error instanceof NoCacheError ? 2 : 1;
	}
}
