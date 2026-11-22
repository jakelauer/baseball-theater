/**
 * Run records (S158): what a `/run-backlog` run did, whether it counts, whether it ran clean, and what
 * that means for the next run's concurrency (`C`). The run's journal is `.run/run.json` (claims.ts
 * `run start|event`, {@link RunJournal}); `scripts/audit.sh run` turns it into a ledger entry through
 * this file, and the next run reads those entries back (ledger.ts, the one parser) to choose `C`.
 *
 * Owner, 2026-11-20, asked whether to write up a definition of a run: "Yes"; asked what a run's Claude-review
 * findings per pull request are compared against: "First C=2 run sets it (Recommended)" ("Each later run is
 * clean on this point if its findings per pull request are no higher than the lowest earlier recorded run's.
 * The first run passes this condition by definition."); asked what follows an unclean run at 3: "Drop back to
 * 2 (Recommended)". S156's Phase 2 exit criteria add the rest: at least four items, a drain under 3 hours.
 *
 * Everything but the CLI is pure (runs.test.ts). CLI (from the repository root):
 *
 *   node scripts/backlog-vault/runs.ts concurrency [--audit <ledger>] [--run-dir <main checkout>/.run]
 *       prints 2 or 3 from the run entries; 2, naming the run on stderr, while an ended run's journal
 *       (`.run/ended/`, the main checkout's by default, found through git's common dir) has no entry in the tree
 *       (oldest to newest by run ID, which is the run's start time, so a run re-recorded later keeps its place;
 *       a run recorded twice is read once, its newest entry standing)
 *   node scripts/backlog-vault/runs.ts id --journal <run.json>          prints the journal's run ID
 *   node scripts/backlog-vault/runs.ts prs --journal <run.json>         the run's pull requests, space-separated
 *   node scripts/backlog-vault/runs.ts check-end --journal <run.json> --run-dir <main checkout>/.run [--audit <ledger>]
 *       [--abandoned] [--rerecord]   exit 1, saying why, when `audit.sh run` can't record the run truly:
 *       (a) an ended run has no entry in this tree (its entry is missing from the bar and from `concurrency`;
 *       not checked for --abandoned, whose entry never counts; for --rerecord, only runs that started earlier);
 *       (b) this run already has an entry; (c) an item is still in flight (not checked for --abandoned).
 *       A journal marked `"abandoned": true` (claims.ts `run end --abandoned`) counts as --abandoned here and
 *       in `fragment`. Any command that fails other than by refusing exits 2.
 *   node scripts/backlog-vault/runs.ts fragment --journal <run.json> --findings <json> --date <d> --stamp <s>
 *       --head <text> [--audit <ledger>] [--abandoned]   prints the run entry (`audit.sh run` writes it)
 *   node scripts/backlog-vault/runs.ts turn-caps [--audit <ledger>] [--run-dir <main checkout>/.run]
 *       one line per item with a turn-cap hit no backlog review lists: `<ID>\t<turn-cap event JSON>`
 *   node scripts/backlog-vault/runs.ts debt-hits --debt-json <file>     the hits a review's seed held, as its row's text
 */

import {
	existsSync, readdirSync, readFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { isRunDirectly } from "./run-directly.ts";
import { parseArgs } from "node:util";
import type { RunEvent, RunJournal } from "./claims.ts";
import type { LedgerEntry, TurnCapHit } from "./ledger.ts";
import { formatHits, readLedger } from "./ledger.ts";

/** S156's Phase 2 exit criteria: a counted run started at least this many items, and drained in under this long. */
export const MIN_ITEMS = 4;
export const MAX_DRAIN_MS = 3 * 60 * 60 * 1000;

/**
 * A run entry's findings per pull request, rounded to 3 places: the value the entry stores, so a run is
 * compared with the bar in the unit the bar was read back in (1 finding over 3 pull requests is 0.333 on both sides).
 */
export const roundFindings = (x: number) => Math.round(x * 1000) / 1000;

/** What one item did in a run, every duration active time in milliseconds. */
export interface ItemTimes
{
	id: string;
	barrier: boolean;
	/** `item-start` → its first `ready`; null when it never got there. */
	build: number | null;
	/** Its first `ready` → `merged`; null when it never merged. */
	mergeWait: number | null;
	/** Each `park` → its `resume`, or the run's end when none. */
	ownerWait: number;
	stillParked: boolean;
}

/** An earlier run, as its ledger entry records it: what {@link summarizeRun} needs for the findings bar and {@link concurrencyFromRuns} for `C`. */
export interface RunRecord
{
	id?: string;
	c: number;
	counted: boolean;
	clean: boolean;
	findingsPerPr: number | null;
}

/** {@link summarizeRun}'s result: what the run entry records. */
export interface RunSummary extends RunRecord
{
	id: string;
	n: number;
	startedAt: string;
	abandoned: boolean;
	itemsStarted: number;
	/** The most non-barrier items in flight at once. */
	peak: number;
	items: ItemTimes[];
	gate: number;
	/** The first `ready` → the last `merged`; null when nothing merged. */
	drain: number | null;
	merged: number;
	conflicts: number;
	duplicates: number;
	prs: number[];
	turnCaps: TurnCapHit[];
	/** Items still in flight at the journal's end (`audit.sh run` refuses to record such a run unless it is abandoned). */
	inFlightAtEnd: string[];
}

const ms = (at: string) => Date.parse(at);

/**
 * The spans the run was stopped: each `interrupted` → the next `run-resume`, or `end` when none.
 * Every duration in a summary leaves these out (active time).
 */
function stoppedSpans(events: RunEvent[], end: number): [number, number][]
{
	const spans: [number, number][] = [];
	let from: number | undefined;
	for (const e of events)
	{
		if (e.kind === "interrupted" && from === undefined)
		{
			from = ms(e.at);
		}
		else if (e.kind === "run-resume" && from !== undefined)
		{
			spans.push([from, ms(e.at)]);
			from = undefined;
		}
	}
	if (from !== undefined)
	{
		spans.push([from, end]);
	}
	return spans;
}

/**
 * Summarize a run's journal (S158 ACs 2, 3 and 7), pure. `findingsByPr` maps a pull request number to the
 * inline comments on its Claude reviews; `earlierRuns` are the earlier run entries (any order); `abandoned`
 * is a run the owner chose not to finish, which never counts. Active time leaves out every span from
 * `interrupted` to the next `run-resume`; an item is in flight from `item-start` to its `merged`, `park` or
 * `held`, and again from each `resume` (one with no `item-start` never is). Only items this run started count
 * toward its merges and drain: a previous run's pull request that step 0 joins to the merge train never does.
 */
export function summarizeRun(journal: RunJournal, findingsByPr: Record<number, number>, earlierRuns: RunRecord[], opts: { abandoned: boolean }): RunSummary
{
	const events = journal.events;
	const end = Math.max(ms(journal.startedAt), ...events.map((e) => ms(e.at)));
	const stopped = stoppedSpans(events, end);
	const active = (a: number, b: number) => Math.max(0, b - a - stopped.reduce((sum, [x, y]) => sum + Math.max(0, Math.min(b, y) - Math.max(a, x)), 0));

	const started = new Set<string>();
	const barrier = new Set<string>();
	const open = new Set<string>();
	const firstStart = new Map<string, number>();
	const firstReady = new Map<string, number>();
	const mergedAt = new Map<string, number>();
	const parkedAt = new Map<string, number>();
	const ownerWait = new Map<string, number>();
	let peak = 0;
	let gateFrom: number | undefined;
	let gate = 0;
	const prs: number[] = [];
	const turnCaps: TurnCapHit[] = [];
	let conflicts = 0;
	let duplicates = 0;
	let merged = 0;
	let drainFrom: number | undefined;
	let drainTo: number | undefined;
	for (const e of events)
	{
		const t = ms(e.at);
		const id = e.id ?? "";
		switch (e.kind)
		{
			case "item-start":
				started.add(id);
				if (e.barrier)
				{
					barrier.add(id);
				}
				if (!firstStart.has(id))
				{
					firstStart.set(id, t);
				}
				open.add(id);
				break;
			case "resume":
				if (started.has(id))
				{
					open.add(id);
				}
				if (parkedAt.has(id))
				{
					ownerWait.set(id, (ownerWait.get(id) ?? 0) + active(parkedAt.get(id)!, t));
					parkedAt.delete(id);
				}
				break;
			case "park":
				open.delete(id);
				if (!parkedAt.has(id))
				{
					parkedAt.set(id, t);
				}
				break;
			case "held":
				open.delete(id);
				break;
			case "ready":
				if (!started.has(id))
				{
					break;
				}
				if (!firstReady.has(id))
				{
					firstReady.set(id, t);
				}
				drainFrom ??= t;
				break;
			case "merged":
				open.delete(id);
				if (!started.has(id))
				{
					break;
				}
				mergedAt.set(id, t);
				merged++;
				drainTo = t;
				break;
			case "pr-open":
				// Every `pr-open` counts toward findings per pull request, as AC 2 defines it ("the --pr numbers of
				// pr-open events"), an item started by an earlier run included: its pull request opened in this run.
				if (e.pr !== undefined && !prs.includes(e.pr))
				{
					prs.push(e.pr);
				}
				break;
			case "conflict":
				conflicts++;
				break;
			case "duplicate":
				duplicates++;
				break;
			case "turn-cap":
				turnCaps.push({
					id,
					at: e.at,
				});
				break;
			case "gate-open":
				gateFrom ??= t;
				break;
			case "gate-close":
				if (gateFrom !== undefined)
				{
					gate += active(gateFrom, t);
					gateFrom = undefined;
				}
				break;
			default:
				// claim, claim-refused (the admission check working: never a duplicate), needs-lead,
				// interrupted and run-resume move no figure here.
				break;
		}
		peak = Math.max(peak, [...open].filter((i) => !barrier.has(i)).length);
	}
	if (gateFrom !== undefined)
	{
		gate += active(gateFrom, end);
	}
	const items: ItemTimes[] = [...started].map((id) =>
	{
		const s = firstStart.get(id)!;
		const r = firstReady.get(id);
		const m = mergedAt.get(id);
		const parked = parkedAt.get(id);
		return {
			id,
			barrier: barrier.has(id),
			build: r === undefined ? null : active(s, r),
			mergeWait: r === undefined || m === undefined ? null : active(r, m),
			ownerWait: (ownerWait.get(id) ?? 0) + (parked === undefined ? 0 : active(parked, end)),
			stillParked: parked !== undefined,
		};
	});
	const drain = drainFrom === undefined || drainTo === undefined ? null : active(drainFrom, drainTo);
	const findingsPerPr = prs.length === 0 ? null : roundFindings(prs.reduce((sum, pr) => sum + (findingsByPr[pr] ?? 0), 0) / prs.length);
	const counted = started.size >= MIN_ITEMS && peak >= journal.c && merged >= 1 && !opts.abandoned;
	// The bar (owner, 2026-11-20: "First C=2 run sets it"): the lowest findings per pull request of the earlier
	// counted runs at C = 2. None yet, and this run meets it. A run too small to count never sets it.
	const bars = earlierRuns.filter((r) => r.counted && r.c === 2 && r.findingsPerPr !== null).map((r) => roundFindings(r.findingsPerPr!));
	const underBar = bars.length === 0 || (findingsPerPr ?? 0) <= Math.min(...bars);
	const clean = counted && conflicts === 0 && duplicates === 0 && drain !== null && drain < MAX_DRAIN_MS && underBar;
	return {
		id: journal.id,
		n: journal.n,
		c: journal.c,
		startedAt: journal.startedAt,
		abandoned: opts.abandoned,
		itemsStarted: started.size,
		peak,
		items,
		gate,
		drain,
		merged,
		conflicts,
		duplicates,
		prs,
		findingsPerPr,
		turnCaps,
		inFlightAtEnd: [...open],
		counted,
		clean,
	};
}

/**
 * The next run's `C` from the run entries, newest first (S158 AC 5): 3 when the newest counted run was at 3
 * and clean, or the newest two counted runs were both at 2 and clean; otherwise 2. So an unclean run at 3
 * sends the next run back to 2, and it climbs again only after two more clean counted runs at 2 (owner,
 * 2026-11-20: "Drop back to 2 (Recommended)"). Uncounted runs are passed over; never above 3.
 */
export function concurrencyFromRuns(newestFirst: RunRecord[]): 2 | 3
{
	const [a, b] = newestFirst.filter((r) => r.counted);
	if (a?.c === 3 && a.clean)
	{
		return 3;
	}
	return a?.c === 2 && a.clean && b?.c === 2 && b.clean ? 3 : 2;
}

/** A run entry's record, from its ledger entry. */
export function runRecordOf(entry: LedgerEntry): RunRecord
{
	return {
		id: entry.run,
		c: entry.runC ?? 2,
		counted: entry.counted ?? false,
		clean: entry.clean ?? false,
		findingsPerPr: entry.findingsPerPr ?? null,
	};
}

const minutes = (d: number | null) => (d === null ? "—" : String(Math.round(d / 60000)));
const yesNo = (b: boolean) => (b ? "yes" : "no");

/** The run entry's Markdown, from its heading down (`audit.sh run` writes it). Rows ledger.ts reads: C, Counted, Clean, Findings per pull request, Turn-cap hits. */
export function renderRunEntry(s: RunSummary, meta: { date: string;
	stamp: string;
	head: string }): string
{
	const total = (pick: (i: ItemTimes) => number | null) => s.items.reduce((sum, i) => sum + (pick(i) ?? 0), 0);
	const lines = [
		`## ${meta.date} — run ${s.id}`,
		"",
		"| | |",
		"|---|---|",
		"| Entry | a /run-backlog run's record (S158): what it ran side by side, where its time went, and whether it ran clean |",
		`| Captured (UTC) | \`${meta.stamp}\` |`,
		`| HEAD at capture | ${meta.head} |`,
		`| Started | \`${s.startedAt}\` |`,
		`| N | ${s.n} |`,
		`| C | ${s.c} |`,
		`| Items started | ${s.itemsStarted} |`,
		`| Peak in flight (non-barrier) | ${s.peak} |`,
		`| Merged | ${s.merged} |`,
		`| Pull requests | ${s.prs.map((p) => `#${p}`).join(", ") || "none"} |`,
		`| Findings per pull request | ${s.findingsPerPr === null ? "none" : String(s.findingsPerPr)} |`,
		`| Record conflicts | ${s.conflicts} |`,
		`| Duplicate implementations | ${s.duplicates} |`,
		`| Drain (active minutes) | ${minutes(s.drain)} |`,
		`| Build (active minutes, all items) | ${minutes(total((i) => i.build))} |`,
		`| Merge wait (active minutes, all items) | ${minutes(total((i) => i.mergeWait))} |`,
		`| Owner wait (active minutes, all items) | ${minutes(total((i) => i.ownerWait))} |`,
		`| Gate (active minutes) | ${minutes(s.gate)} |`,
		`| Turn-cap hits | ${formatHits(s.turnCaps)} |`,
		`| Abandoned | ${yesNo(s.abandoned)} |`,
		`| Counted | ${yesNo(s.counted)} |`,
		`| Clean | ${yesNo(s.clean)} |`,
		"",
		"**Items** (active minutes)",
		"",
		"| Item | Build | Merge wait | Owner wait | Note |",
		"|---|---|---|---|---|",
		...s.items.map((i) => `| ${i.id} | ${minutes(i.build)} | ${minutes(i.mergeWait)} | ${minutes(i.ownerWait)} | ${[i.barrier ? "barrier" : "", i.stillParked ? "still parked" : ""].filter(Boolean).join(", ") || "—"} |`),
	];
	return `${lines.join("\n")}\n`;
}

/** The key one turn-cap hit is matched by, wherever it is read: the item and the event's time. */
const hitKey = (h: TurnCapHit) => `${h.id}@${h.at}`;

/**
 * The turn-cap hits still making a backlog review due (S158 AC 7): every hit read (run entries, the live
 * journal, ended journals; the same `(id, at)` from more than one place is one hit) that no backlog review
 * entry lists, grouped by item in first-seen order. Only a review clears a hit: a skip or answers entry never does.
 * Only a story's hit counts: a bug's turn cap is never drift (CLAUDE.md), so one read from anywhere is passed over.
 */
export function unlistedTurnCaps(read: TurnCapHit[], reviews: LedgerEntry[]): Map<string, string[]>
{
	const listed = new Set(reviews.filter((e) => e.kind === "review" && e.review === "backlog").flatMap((e) => e.turnCaps ?? []).map(hitKey));
	const seen = new Set<string>();
	const due = new Map<string, string[]>();
	for (const h of read)
	{
		const key = hitKey(h);
		if (!/^S\d+$/.test(h.id) || seen.has(key) || listed.has(key))
		{
			continue;
		}
		seen.add(key);
		due.set(h.id, [...(due.get(h.id) ?? []), h.at]);
	}
	return due;
}

/** The turn-cap hits in a journal file, or none when it is unreadable. */
function journalHits(path: string): TurnCapHit[]
{
	try
	{
		const j = JSON.parse(readFileSync(path, "utf8")) as RunJournal;
		return j.events.filter((e) => e.kind === "turn-cap" && e.id).map((e) => ({
			id: e.id!,
			at: e.at,
		}));
	}
	catch
	{
		return [];
	}
}

/** The run IDs of the ended journals in `<runDir>/ended/` that `recorded` lacks, oldest first. */
function unrecordedEnded(runDir: string, recorded: Set<string | undefined>): string[]
{
	const ended = join(runDir, "ended");
	return existsSync(ended) ? readdirSync(ended).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -".json".length)).filter((id) => !recorded.has(id)).sort() : [];
}

/** The main checkout's `.run/`, through git's common dir (as review-debt.sh finds it); undefined outside a repository. */
function mainRunDir(): string | undefined
{
	try
	{
		return join(dirname(execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim()), ".run");
	}
	catch
	{
		return undefined;
	}
}

/** The hits a `review-debt.sh --json` report holds, from its `turn-cap` events. */
export function debtHits(report: { events?: { kind: string;
	id?: string;
	hits?: string[] }[] }): TurnCapHit[]
{
	return (report.events ?? []).filter((e) => e.kind === "turn-cap" && e.id).flatMap((e) => (e.hits ?? []).map((at) => ({
		id: e.id!,
		at,
	})));
}

function main(argv: string[]): number
{
	const { values, positionals } = parseArgs({
		args: argv,
		allowPositionals: true,
		options: {
			"audit": {
				type: "string",
			},
			"journal": {
				type: "string",
			},
			"findings": {
				type: "string",
			},
			"date": {
				type: "string",
			},
			"stamp": {
				type: "string",
			},
			"head": {
				type: "string",
			},
			"abandoned": {
				type: "boolean",
			},
			"run-dir": {
				type: "string",
			},
			"debt-json": {
				type: "string",
			},
			"rerecord": {
				type: "boolean",
			},
		},
	});
	const audit = values.audit ?? process.env["BT_AUDIT_LEDGER"] ?? "docs/v3/AUDIT.md";
	// The run entries oldest first by run ID (`R<start stamp>`), one per run, its newest entry standing.
	const runs = () =>
	{
		const byRun = new Map<string, LedgerEntry>();
		for (const e of readLedger(audit).filter((x) => x.kind === "run"))
		{
			byRun.set(e.run ?? "", e);
		}
		return [...byRun.values()].sort((a, b) => (a.run ?? "").localeCompare(b.run ?? ""));
	};
	const readJournal = () => JSON.parse(readFileSync(values.journal ?? "", "utf8")) as RunJournal;
	switch (positionals[0])
	{
		case "concurrency":
		{
			const entries = runs();
			// A run that ended without its entry in this tree (its pull request unopened, open or closed
			// unmerged) may be the newest: never move to 3 without it.
			const runDir = values["run-dir"] ?? mainRunDir();
			const missing = runDir === undefined ? [] : unrecordedEnded(runDir, new Set(entries.map((e) => e.run)));
			if (missing.length > 0)
			{
				console.error(`runs.ts concurrency: 2, since ended run ${missing.join(", ")} has no entry in this tree`);
				console.log(2);
				return 0;
			}
			console.log(concurrencyFromRuns(entries.reverse().map(runRecordOf)));
			return 0;
		}
		case "id":
			console.log(readJournal().id);
			return 0;
		case "prs":
			console.log(summarizeRun(readJournal(), {}, [], {
				abandoned: false,
			}).prs.join(" "));
			return 0;
		case "check-end":
		{
			const journal = readJournal();
			const abandoned = values.abandoned === true || journal.abandoned === true;
			const recorded = new Set(runs().map((e) => e.run));
			const problems: string[] = [];
			if (recorded.has(journal.id))
			{
				problems.push(values.rerecord ? `run ${journal.id} already has an entry in this tree` : `run ${journal.id} already has an entry in this tree; if its journal is still open, finish moving it with node scripts/backlog-vault/claims.ts run end ${journal.id} --root <main checkout>${abandoned ? " --abandoned" : ""}`);
			}
			if (!abandoned)
			{
				// A re-recorded run is judged only against runs that started before it, so only those must be in.
				for (const id of unrecordedEnded(values["run-dir"] ?? ".run", recorded).filter((x) => !values.rerecord || x < journal.id))
				{
					problems.push(`run ${id} ended but its entry is not in this tree: merge its backlog/run-${id} pull request and branch from the updated origin/stage; or, if its run-${id} worktree still holds the entry uncommitted, commit it there and open its pull request; or, once gh pr view shows that pull request CLOSED (not MERGED), re-record it in a fresh backlog/run-${id} worktree with scripts/audit.sh run --journal <main checkout>/.run/ended/${id}.json (several such runs re-record oldest first, in one such worktree and one pull request)`);
				}
			}
			const inFlight = summarizeRun(journal, {}, [], {
				abandoned: false,
			}).inFlightAtEnd;
			if (!abandoned && inFlight.length > 0)
			{
				problems.push(`still in flight: ${inFlight.join(", ")} (log each one's merged, park or held first, or record the run with --abandoned)`);
			}
			problems.forEach((p) => console.error(`runs.ts check-end: ${p}`));
			return problems.length > 0 ? 1 : 0;
		}
		case "fragment":
		{
			const journal = readJournal();
			const findings = JSON.parse(readFileSync(values.findings ?? "", "utf8")) as Record<number, number>;
			// Only runs that started before this one are earlier (a run re-recorded later still sits in its place).
			const summary = summarizeRun(journal, findings, runs().filter((e) => (e.run ?? "") < journal.id).map(runRecordOf), {
				abandoned: values.abandoned === true || journal.abandoned === true,
			});
			process.stdout.write(renderRunEntry(summary, {
				date: values.date ?? "",
				stamp: values.stamp ?? "",
				head: values.head ?? "",
			}));
			return 0;
		}
		case "turn-caps":
		{
			const ledger = readLedger(audit);
			const read = ledger.filter((e) => e.kind === "run").flatMap((e) => e.turnCaps ?? []);
			if (values["run-dir"])
			{
				read.push(...journalHits(join(values["run-dir"], "run.json")));
				const ended = join(values["run-dir"], "ended");
				if (existsSync(ended))
				{
					readdirSync(ended).filter((f) => f.endsWith(".json")).sort().forEach((f) => read.push(...journalHits(join(ended, f))));
				}
			}
			for (const [id, hits] of unlistedTurnCaps(read, ledger))
			{
				console.log(`${id}\t${JSON.stringify({
					kind: "turn-cap",
					id,
					hits,
				})}`);
			}
			return 0;
		}
		case "debt-hits":
			console.log(formatHits(debtHits(JSON.parse(readFileSync(values["debt-json"] ?? "", "utf8")))));
			return 0;
		default:
			console.error("usage: runs.ts concurrency|id|prs|check-end|fragment|turn-caps|debt-hits … (see the file's header)");
			return 2;
	}
}

if (isRunDirectly(import.meta.url))
{
	// Exit 1 is a refusal (check-end); anything else that fails (a fragment that doesn't parse, a missing file) is 2.
	try
	{
		process.exitCode = main(process.argv.slice(2));
	}
	catch (e)
	{
		console.error(`runs.ts: ${(e as Error).message}`);
		process.exitCode = 2;
	}
}
