/**
 * Claims: what each in-flight backlog item says it will touch, so the overseer of a parallel
 * `/run-backlog` admits only items that can't collide (S156 ACs 12–14; owner, 2026-11-20: "The goal
 * is to enable agents to work in tandem on backlog items in a way that they don't conflict, and in a
 * way that is managed by an overseer").
 *
 * State lives in the git-ignored `.run/` at the repository root, one file per in-flight item:
 *
 *   .run/claims/<ID>.json   { "id", "files", "symbols", "docLines", "barrier", "mergeAfter", "claimedAt" }
 *
 * - `files`: repository-relative paths the item expects to touch; one ending in `/` is a directory
 *   and covers everything under it (a fence entry). A path given without the `/` that is a directory on
 *   disk is stored with it.
 * - `symbols`: the exported functions, components and hooks it will add, by name.
 * - `docLines`: the doc lines it rewrites, each `<path>: <the line's text or heading>`, compared with
 *   whitespace collapsed.
 * - `barrier`: whether it must run alone (see {@link isBarrierPath}); `mergeAfter`: the in-flight items
 *   it shares a hot file with, which merge before it.
 *
 * The file name is the in-flight record: `scripts/review-debt.sh` and `scripts/parity-debt.sh` read the
 * in-flight IDs from `.run/claims/*.json` names alone, so a claim is removed (`release`) once its item
 * merges or parks. A `/run-backlog` run's journal sits beside them (S158; see {@link RunJournal}):
 *
 *   .run/run.json               the open run's journal (`run start|event`)
 *   .run/ended/<run id>.json    an ended run's journal (`run end`, which `scripts/audit.sh run` calls), kept so
 *                               review-debt.sh still reads its turn-cap hits and `audit.sh run` can tell
 *                               whether its entry has reached the tree
 *
 * Two more files are inputs, never written here:
 *
 *   .run/findings.md          one finding a line: `- <ID> | <checklist class> | <path>[:<line>] | <text>`
 *   .pending/needs-input.md   the owner's questions (`.claude/skills/pending/SKILL.md`), each `##` section
 *                             with a `Blocks: <ID>, <ID>` line naming the items it holds
 *
 * CLI (from the repository root; `--root <dir>` points elsewhere):
 *
 *   node scripts/backlog-vault/claims.ts claim <ID> --file <p>… --symbol <s>… --doc-line "<p>: <text>"… [--dry-run]
 *       compare with the in-flight claims; exit 1 on a conflict or a barrier (nothing written),
 *       else write the claim (unless --dry-run) and exit 0. Re-claiming an in-flight ID replaces it.
 *   node scripts/backlog-vault/claims.ts list                 in-flight IDs, barrier flag and merge order
 *   node scripts/backlog-vault/claims.ts release <ID>         drop the claim (merged or parked)
 *   node scripts/backlog-vault/claims.ts touched <ID> [--file <p>…]
 *       at commit time: files touched (stdin, one a line, when no --file) that the claim doesn't cover, and, for
 *       a claim that isn't a barrier, any touched barrier path (one made after the claim, or covered only by a
 *       directory entry); exit 1 if any
 *   node scripts/backlog-vault/claims.ts review-edits [--file <p>…]
 *       a review's changed files (stdin when no --file): exit 1 if any is an in-flight item's note
 *   node scripts/backlog-vault/claims.ts findings [--findings <file>]   merge findings by class and file
 *   node scripts/backlog-vault/claims.ts questions [--pending <file>]   owner questions, most-blocking first,
 *       then `no question: <ID> is blocked` for each story or bug note in a `blocked/` folder that no
 *       question's `Blocks:` line names, with the local branches whose name holds its ID
 *
 *   node scripts/backlog-vault/claims.ts run start --n <N> --c <2|3> | run start --resume
 *   node scripts/backlog-vault/claims.ts run event <kind> [<ID>] [--pr <n>] [--path <p>] [--barrier]
 *   node scripts/backlog-vault/claims.ts run end <run id> [--abandoned]
 *       the run journal, `.run/run.json` (S158 AC 1; see {@link RunJournal}): `start` opens one (exit 1 naming
 *       the run when one is open), `--resume` keeps it and logs `run-resume`; `event` appends one event
 *       (exit 1 on an unknown kind, a missing ID or flag, a flag its kind doesn't take, an ID that fails
 *       `ITEM_ID`, a `turn-cap` on an item that isn't a story, or any event while the run is interrupted:
 *       an `interrupted` with no later `run-resume`); `end` moves the journal to `.run/ended/<run id>.json`
 *       (exit 1 when no run, or another, is open), with `"abandoned": true` written into it for `--abandoned`. `claim` appends its own `claim` or `claim-refused`
 *       event when a journal exists and it is not a `--dry-run`. A journal that doesn't parse exits 2.
 *
 * `claim`, `release` and every journal write run under a lock, the directory `.run/claims.lock` holding the holder's pid, so two
 * claims made at once can't both be admitted against an empty in-flight set. A command that can't take it
 * within 10 s exits 2 naming the holder's pid and whether that process is alive; a dead holder's lock is
 * the overseer's to remove (never broken automatically). Claims are written to a temp file and renamed,
 * so a crash never leaves a half-written claim; one that is unreadable anyway stops every command with
 * exit 2 and its name, rather than being skipped, since skipping it could admit a conflicting item. Every
 * command that takes an ID checks it against in-flight.ts's `ITEM_ID` before touching a file.
 *
 * Everything but the CLI's file and process calls is a pure exported function (claims.test.ts).
 */

import { spawnSync } from "node:child_process";
import {
	existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import {
	dirname, join, resolve,
} from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { IssueCache } from "./github.ts";
import {
	cacheDir, designGate, findIssue, itemFromIssue, problemsFor, readCache, statusOf, trustedId,
} from "./github.ts";
import type { TextRecord } from "./text-records.ts";
import { fragmentsDir, readRecords } from "./text-records.ts";
import { ITEM_ID } from "./in-flight.ts";
import { isTriage, TRIAGE_LABEL } from "./triage.ts";

/** One in-flight item's claim, as stored in `.run/claims/<ID>.json`. */
export interface Claim
{
	id: string;
	files: string[];
	symbols: string[];
	docLines: string[];
	barrier: boolean;
	mergeAfter: string[];
	claimedAt: string;
	/** The item's GitHub issue (S164): a story or bug claim resolves it through github.ts. */
	issue?: number;
}

/** What comparing a new claim with the in-flight ones found. `ok` is false on any conflict or barrier hold. */
export interface ClaimReport
{
	ok: boolean;
	conflicts: string[];
	barrier: string[];
	/** Hot files shared with an in-flight item: not a conflict, but that item merges first. */
	hot: { file: string;
		with: string }[];
	/** Ordinary files shared with an in-flight item: git merges these; reported so the overseer sees them. */
	shared: { file: string;
		with: string }[];
	mergeAfter: string[];
}

/** The files almost every feature edits (S156 AC 12): sharing one fixes the merge order instead of blocking. */
export const HOT_FILES = ["packages/domain/src/index.ts", "functions/src/handlers/api.ts", "web/src/routes.tsx", "openapi/", "web/src/api/generated/", "vitest.config.ts"];


/** The rule and agent files that, besides the reviewer paths, make an item run alone (S156 AC 12). */
const BARRIER_FILES = ["CLAUDE.md", "docs/v3/LOOP.md"];
const BARRIER_DIRS = [".claude/"];

const PLAN_REVIEW = join(dirname(fileURLToPath(import.meta.url)), "../claude-review/plan-review.py");

/**
 * A `/run-backlog` run's journal, `.run/run.json` (S158 AC 1; owner, 2026-11-20, asked whether to write up
 * a definition of a run: "Yes"): the run's ID (`R<stamp>`, no `-`, so a ledger fragment's name can carry
 * it), how many items it starts (`n`), its concurrency (`c`), and what happened, in order. runs.ts
 * summarizes it, and `scripts/audit.sh run` turns it into a ledger entry when the run ends.
 */
export interface RunJournal
{
	id: string;
	n: number;
	c: number;
	startedAt: string;
	events: RunEvent[];
	/** Set by `run end --abandoned` in the ended journal, so a re-recorded run stays abandoned (runs.ts). */
	abandoned?: boolean;
}

/** One journal event; `id` for an item's events, `pr` for `pr-open`, `path` for `conflict`, `barrier` on a barrier's `item-start`. */
export interface RunEvent
{
	kind: string;
	id?: string;
	pr?: number;
	path?: string;
	barrier?: boolean;
	at: string;
}

/** The item events `run event` takes, each needing an item ID (run-backlog steps 2–5 say where each is logged). */
export const RUN_ITEM_KINDS = ["item-start", "needs-lead", "park", "resume", "held", "pr-open", "ready", "merged", "conflict", "duplicate", "turn-cap"];
/** The run events `run event` takes, which name no item. `run-resume`, `claim` and `claim-refused` are written only by `run start --resume` and `claim`. */
export const RUN_KINDS = ["gate-open", "gate-close", "interrupted"];

/** A refused journal command: the CLI prints it and exits 1. */
export class RunError extends Error
{
	override name = "RunError";
}

/** The journal file under a repository root. */
export function runJournalPath(root: string): string
{
	return join(runDir(root), "run.json");
}

/** The `R<stamp>` run ID for a start time: `2026-11-21T10:15:00.000Z` → `R20261121T101500Z`. */
export function runIdFor(at: string): string
{
	return `R${at.replace(/\.\d+Z$/, "Z").replace(/[-:]/g, "")}`;
}

/** The event `run event <kind>` would append, or a {@link RunError} saying what is wrong with the input. */
export function makeRunEvent(kind: string, input: { id?: string;
	pr?: string;
	path?: string;
	barrier?: boolean; }, at: string): RunEvent
{
	const item = RUN_ITEM_KINDS.includes(kind);
	if (!item && !RUN_KINDS.includes(kind))
	{
		throw new RunError(`unknown event kind '${kind}' (item: ${RUN_ITEM_KINDS.join(", ")}; run: ${RUN_KINDS.join(", ")})`);
	}
	if (item && !input.id)
	{
		throw new RunError(`${kind} needs an item ID`);
	}
	if (!item && input.id)
	{
		throw new RunError(`${kind} is a run event and takes no ID`);
	}
	if (input.id && !ITEM_ID.test(input.id))
	{
		throw new RunError(`not an item ID: '${input.id}' (S<N>, B<N>, F<N> or V<N>)`);
	}
	// A turn cap hit on a story is a drift event (review-debt.sh reports it); a bug's never is (CLAUDE.md).
	if (kind === "turn-cap" && !/^S\d+$/.test(input.id ?? ""))
	{
		throw new RunError(`turn-cap is logged for a story only (a bug's turn cap is never drift), not '${input.id}'`);
	}
	if (kind === "pr-open" && !/^[1-9][0-9]*$/.test(input.pr ?? ""))
	{
		throw new RunError("pr-open needs --pr <n>");
	}
	if (kind === "conflict" && !input.path)
	{
		throw new RunError("conflict needs --path <p>");
	}
	// A flag on a kind that doesn't take it would be dropped silently, so it is refused.
	if ((input.pr !== undefined && kind !== "pr-open") || (input.path !== undefined && kind !== "conflict") || (input.barrier && kind !== "item-start"))
	{
		throw new RunError(`${kind} takes no ${input.pr !== undefined && kind !== "pr-open" ? "--pr" : input.path !== undefined && kind !== "conflict" ? "--path" : "--barrier"}`);
	}
	return {
		kind,
		...(input.id ? {
			id: input.id,
		} : {}),
		...(kind === "pr-open" ? {
			pr: Number(input.pr),
		} : {}),
		...(input.path ? {
			path: input.path,
		} : {}),
		...(input.barrier ? {
			barrier: true,
		} : {}),
		at,
	};
}

/** The open run's journal, or undefined when no run is open. A journal that doesn't parse throws {@link ClaimsError} (exit 2), never a refusal's exit 1. */
export function readRunJournal(root: string): RunJournal | undefined
{
	const path = runJournalPath(root);
	if (!existsSync(path))
	{
		return undefined;
	}
	try
	{
		return JSON.parse(readFileSync(path, "utf8")) as RunJournal;
	}
	catch (e)
	{
		throw new ClaimsError(`${path} is not a run journal: ${(e as Error).message}`);
	}
}

/** Whether the run is interrupted: its newest `interrupted` has no later `run-resume` (run-backlog step 6). */
export function isInterrupted(journal: RunJournal): boolean
{
	const last = [...journal.events].reverse().find((e) => e.kind === "interrupted" || e.kind === "run-resume");
	return last?.kind === "interrupted";
}

/** Write the journal through a temp file and a rename, so a crash never leaves half a journal. Hold the claims lock. */
export function writeRunJournal(root: string, journal: RunJournal): void
{
	mkdirSync(runDir(root), {
		recursive: true,
	});
	const tmp = join(runDir(root), `.run.json.${process.pid}.tmp`);
	writeFileSync(tmp, `${JSON.stringify(journal, null, "\t")}\n`);
	renameSync(tmp, runJournalPath(root));
}

/** Append `event` to the open run's journal; false (nothing written) when no run is open. Hold the claims lock. */
export function appendRunEvent(root: string, event: RunEvent): boolean
{
	const journal = readRunJournal(root);
	if (!journal)
	{
		return false;
	}
	journal.events.push(event);
	writeRunJournal(root, journal);
	return true;
}

/** The `.run/` directory and claims directory under a repository root. */
export function runDir(root: string): string
{
	return join(root, ".run");
}

function claimsDir(root: string): string
{
	return join(runDir(root), "claims");
}

/**
 * Whether two path entries meet: equal, or one is a directory entry (trailing `/`) the other lies under.
 * A file entry never covers anything but itself.
 */
export function pathsOverlap(a: string, b: string): boolean
{
	return a === b || (a.endsWith("/") && b.startsWith(a)) || (b.endsWith("/") && a.startsWith(b));
}

/**
 * The hot files a claim entry reaches, by their {@link HOT_FILES} name, except `vitest.config.ts`, which
 * is hot at any depth and is keyed by the entry's own path (two items' different packages don't collide).
 * A directory entry that merely contains some `vitest.config.ts` isn't counted: a worker names the config
 * it changes.
 */
export function hotKeys(entry: string): string[]
{
	const keys: string[] = [];
	for (const hot of HOT_FILES)
	{
		if (hot === "vitest.config.ts")
		{
			if (entry === hot || entry.endsWith(`/${hot}`))
			{
				keys.push(entry);
			}
		}
		else if (pathsOverlap(entry, hot))
		{
			keys.push(hot);
		}
	}
	return keys;
}

/**
 * Whether a claimed path makes its item a barrier (runs alone): `CLAUDE.md`, `docs/v3/LOOP.md`, anything
 * under `.claude/`, or a reviewer path. `isReviewer` is plan-review.py's `is_reviewer_path` for that path
 * (graders are excepted there, not here: one implementation, ADR-025). A directory entry is a barrier when
 * it reaches a barrier file, e.g. `docs/v3/` contains LOOP.md.
 */
export function isBarrierPath(path: string, isReviewer: boolean): boolean
{
	return isReviewer || BARRIER_FILES.some((f) => pathsOverlap(path, f)) || BARRIER_DIRS.some((d) => pathsOverlap(path, d));
}

/**
 * plan-review.py's `is_reviewer_path` for each path, in order, from one `python3` call. Its lists are
 * never copied here (ADR-025), so a change to what the reviewer always re-reads changes the barrier too.
 * The environment is built from scratch, with `PYTHONDONTWRITEBYTECODE=1` so importing the module never
 * rewrites its tracked `__pycache__`.
 */
export function reviewerFlags(paths: string[]): boolean[]
{
	if (paths.length === 0)
	{
		return [];
	}
	const code = [
		"import importlib.util, json, sys",
		"spec = importlib.util.spec_from_file_location('plan_review', sys.argv[1])",
		"mod = importlib.util.module_from_spec(spec)",
		"spec.loader.exec_module(mod)",
		"print(json.dumps([mod.is_reviewer_path(p) for p in json.loads(sys.argv[2])]))",
	].join("\n");
	const run = spawnSync("python3", ["-c", code, PLAN_REVIEW, JSON.stringify(paths)], {
		encoding: "utf8",
		env: {
			PATH: process.env["PATH"] ?? "/usr/bin:/bin",
			PYTHONDONTWRITEBYTECODE: "1",
		},
	});
	if (run.status !== 0)
	{
		throw new Error(`is_reviewer_path failed: ${run.stderr || run.error?.message}`);
	}
	return JSON.parse(run.stdout) as boolean[];
}

/** A doc line's comparison key: whitespace collapsed, so a re-wrapped claim still matches. */
export function docLineKey(line: string): string
{
	return line.trim().replace(/\s+/g, " ");
}

/**
 * The claim entries as stored: an entry naming a directory on disk without its trailing `/` gets one,
 * so it covers what is under it ({@link pathsOverlap}).
 */
export function normalizeEntries(root: string, files: string[]): string[]
{
	return files.map((f) => !f.endsWith("/") && existsSync(join(root, f)) && statSync(join(root, f)).isDirectory() ? `${f}/` : f);
}

/** The files git tracks under a directory entry, repository-relative. */
function trackedUnder(root: string, dir: string): string[]
{
	const run = spawnSync("git", ["-C", root, "ls-files", "-z", "--", dir], {
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
	});
	return run.status === 0 ? run.stdout.split("\0").filter(Boolean) : [];
}

/**
 * {@link reviewerFlags} for claim entries (already {@link normalizeEntries normalized}): a directory entry
 * is a reviewer path when it is one itself or any file git tracks under it is (`functions/` holds
 * `functions/package.json`, `web/` holds `web/vite.config.ts`). One python call for every path.
 */
export function claimReviewerFlags(root: string, files: string[]): boolean[]
{
	const groups = files.map((f) => f.endsWith("/") ? [f, ...trackedUnder(root, f)] : [f]);
	const flags = reviewerFlags(groups.flat());
	let i = 0;
	return groups.map((g) =>
	{
		const mine = flags.slice(i, i + g.length);
		i += g.length;
		return mine.some(Boolean);
	});
}

/** Build a claim from a worker's lists; `flags` is {@link reviewerFlags} of `files`, in order. */
export function makeClaim(id: string, input: { files?: string[];
	symbols?: string[];
	docLines?: string[] }, flags: boolean[], now = new Date()): Claim
{
	if (!ITEM_ID.test(id))
	{
		throw new ClaimsError(`not an item ID: ${id}`);
	}
	const files = [...new Set(input.files ?? [])];
	return {
		id,
		files,
		symbols: [...new Set(input.symbols ?? [])],
		docLines: [...new Set((input.docLines ?? []).map(docLineKey))],
		barrier: files.some((f, i) => isBarrierPath(f, flags[i] ?? false)),
		mergeAfter: [],
		claimedAt: now.toISOString(),
	};
}

/**
 * Compare a new claim with the in-flight ones (its own earlier claim, if any, excluded). A shared new
 * symbol or doc line is a conflict (two items would write two implementations or two versions of one
 * rule). A barrier holds either way: a barrier item starts only with nothing in flight, and nothing starts
 * while one is in flight. A shared hot file only orders the merge: the earlier claim merges first.
 */
export function compareClaim(claim: Claim, inFlight: Claim[]): ClaimReport
{
	const others = inFlight.filter((c) => c.id !== claim.id);
	const report: ClaimReport = {
		ok: true,
		conflicts: [],
		barrier: [],
		hot: [],
		shared: [],
		mergeAfter: [],
	};
	if (claim.barrier && others.length > 0)
	{
		report.barrier.push(`${claim.id} is a barrier item and must run alone; in flight: ${others.map((c) => c.id).join(", ")}`);
	}
	for (const other of others)
	{
		if (other.barrier)
		{
			report.barrier.push(`${other.id} is a barrier item in flight; nothing new starts until it merges`);
		}
		for (const symbol of claim.symbols.filter((s) => other.symbols.includes(s)))
		{
			report.conflicts.push(`symbol ${symbol}: also added by ${other.id}`);
		}
		const theirs = new Set(other.docLines.map(docLineKey));
		for (const line of claim.docLines.filter((l) => theirs.has(docLineKey(l))))
		{
			report.conflicts.push(`doc line "${line}": also rewritten by ${other.id}`);
		}
		const theirHot = new Set(other.files.flatMap(hotKeys));
		const hot = [...new Set(claim.files.flatMap(hotKeys).filter((k) => theirHot.has(k)))];
		for (const file of hot)
		{
			report.hot.push({
				file,
				with: other.id,
			});
		}
		if (hot.length > 0)
		{
			report.mergeAfter.push(other.id);
		}
		for (const mine of claim.files)
		{
			const meet = other.files.find((t) => pathsOverlap(mine, t));
			if (meet && hotKeys(mine).length === 0)
			{
				report.shared.push({
					file: mine,
					with: other.id,
				});
			}
		}
	}
	report.ok = report.conflicts.length === 0 && report.barrier.length === 0;
	return report;
}

/**
 * The item's own records, which only it writes and so never need claiming: its grader, its changelog
 * fragment and its ledger fragments (named for its ID, S156 ACs 5–6), its text records among them
 * since S164 retired the notes.
 */
export function isOwnRecord(id: string, path: string): boolean
{
	const own = [
		new RegExp(`^scripts/verify-${id}\\.sh$`),
		new RegExp(`^changelog\\.d/${id}\\.md$`),
		new RegExp(`^docs/v3/audit/[0-9-]+/[^/]*-${id}-[a-z-]+\\.md$`),
	];
	return own.some((re) => re.test(path));
}

/** Commit time: touched files the claim doesn't cover (its own records excepted), for the overseer to look at. */
export function outsideClaim(claim: Claim, touched: string[]): string[]
{
	return touched.filter((t) => t !== "" && !isOwnRecord(claim.id, t) && !claim.files.some((f) => pathsOverlap(f, t)));
}

/**
 * Commit time: touched files that would have made a claim that isn't a barrier one (`flags` is
 * {@link reviewerFlags} of `touched`): a reviewer or barrier path created after the claim, or covered only by
 * a directory entry. A barrier claim already runs alone, so it has none.
 */
export function barrierTouches(claim: Claim, touched: string[], flags: boolean[]): string[]
{
	return claim.barrier ? [] : touched.filter((t, i) => t !== "" && isBarrierPath(t, flags[i] ?? false));
}

/**
 * S156 AC 13: a review running beside in-flight items edits only notes of items not in flight. Returns
 * the changed paths that are an in-flight item's story or bug note.
 */
export function reviewEditsToInFlight(changed: string[], inFlightIds: string[]): string[]
{
	const ids = new Set(inFlightIds);
	return changed.filter((p) =>
	{
		// A story's note before S164, or since then a text record (create, edit) of its text.
		const m = /^docs\/v3\/backlog\/(?:stories|bugs)\/[a-z]+\/([A-Z]+[0-9]+)\.md$/.exec(p)
			?? /^docs\/v3\/audit\/[0-9-]+\/[^/]*-([A-Z]+[0-9]+)-(?:create|edit)\.md$/.exec(p);
		return m !== null && ids.has(m[1] ?? "");
	});
}

/** One line of `.run/findings.md`. */
export interface Finding
{
	item: string;
	checklistClass: string;
	file: string;
	line?: number;
	text: string;
}

/** Findings that share a checklist class and file: one fix when more than one item has them. */
export interface FindingGroup
{
	checklistClass: string;
	file: string;
	items: string[];
	findings: Finding[];
	/** Shared by two or more items: becomes its own fix item (S156 AC 14). */
	shared: boolean;
}

/** Parse `.run/findings.md`; lines that aren't `- <ID> | <class> | <path>[:<line>] | <text>` are ignored (headings, notes). */
export function parseFindings(text: string): Finding[]
{
	const out: Finding[] = [];
	for (const raw of text.split("\n"))
	{
		const m = /^\s*[-*]\s+([A-Z]+[0-9]+)\s*\|\s*([^|]+?)\s*\|\s*([^|\s]+?)(?::([0-9]+))?\s*\|\s*(.+?)\s*$/.exec(raw);
		if (!m || !ITEM_ID.test(m[1] ?? ""))
		{
			continue;
		}
		const finding: Finding = {
			item: m[1] ?? "",
			checklistClass: (m[2] ?? "").toLowerCase(),
			file: m[3] ?? "",
			text: m[5] ?? "",
		};
		if (m[4] !== undefined)
		{
			finding.line = Number(m[4]);
		}
		out.push(finding);
	}
	return out;
}

/** Group findings by checklist class and file (line numbers aside), shared groups first, then in first-seen order. */
export function mergeFindings(findings: Finding[]): FindingGroup[]
{
	const groups = new Map<string, FindingGroup>();
	for (const f of findings)
	{
		const key = `${f.checklistClass}\u0000${f.file}`;
		const group = groups.get(key) ?? {
			checklistClass: f.checklistClass,
			file: f.file,
			items: [],
			findings: [],
			shared: false,
		};
		group.findings.push(f);
		if (!group.items.includes(f.item))
		{
			group.items.push(f.item);
		}
		group.shared = group.items.length > 1;
		groups.set(key, group);
	}
	const all = [...groups.values()];
	return [...all.filter((g) => g.shared), ...all.filter((g) => !g.shared)];
}

/** One `##` section of `.pending/needs-input.md` and the items its `Blocks:` line names. */
export interface Question
{
	heading: string;
	blocks: string[];
	body: string;
}

/** Split the pending file into its `##` questions; a section with no `Blocks:` line blocks nothing. */
export function parseQuestions(text: string): Question[]
{
	const out: Question[] = [];
	for (const section of text.split(/^(?=## )/m).filter((s) => s.startsWith("## ")))
	{
		const heading = (section.split("\n")[0] ?? "").slice(3).trim();
		const line = /^Blocks:\s*(.*)$/m.exec(section);
		const blocks = line ? [...new Set((line[1] ?? "").split(/[\s,]+/).filter((id) => ITEM_ID.test(id)))] : [];
		out.push({
			heading,
			blocks,
			body: section.trimEnd(),
		});
	}
	return out;
}

/** Most-blocking first (S156 AC 14); equal counts keep the file's order. */
export function orderQuestions(questions: Question[]): Question[]
{
	return questions.map((q, i) => ({
		q,
		i,
	})).sort((a, b) => b.q.blocks.length - a.q.blocks.length || a.i - b.i).map(({ q }) => q);
}

/**
 * The blocked items no question names, by ID. `/pending` writes a question for each before it asks anything,
 * so the owner never learns by chance that something is stuck (owner, 2026-11-20: "I want to stop finding out
 * things are blocked by chance. Pending should never show as empty as long as something is blocked.").
 */
export function uncoveredBlocked(blocked: string[], questions: Question[]): string[]
{
	const named = new Set(questions.flatMap((q) => q.blocks));
	return [...new Set(blocked)].filter((id) => !named.has(id)).sort((a, b) => a.localeCompare(b, "en", {
		numeric: true,
	}));
}

/** The issue cache for `root` (github.ts), or a {@link ClaimsError} saying to run `pnpm backlog:sync`. */
function cacheOf(root: string): IssueCache
{
	const dir = cacheDir(root);
	const cache = readCache(dir);
	if (!cache)
	{
		throw new ClaimsError(`no issue cache in ${dir}: run pnpm backlog:sync`);
	}
	return cache;
}

/** The IDs of the open stories and bugs whose issues are labelled `status:blocked` (S164: GitHub owns state), from the issue cache. */
export function blockedItems(root: string): string[]
{
	const cache = cacheOf(root);
	return cache.issues.filter((i) => i.state === "open" && statusOf(i) === "blocked")
		.map((i) => trustedId(i, cache.trusted)).filter((id): id is string => id !== undefined);
}

/**
 * Whether a story or bug may be claimed, from GitHub state alone (S164): its trusted issue must exist,
 * be open and be labelled `status:todo` or `status:doing`, never `triage`, and a UI story's design
 * stories must be done (github.ts designGate; S165). Returns its issue number, or why not. A fix
 * item (`F<n>`) or a vault item (`V<n>`) has no issue and is always claimable. An item the backlog
 * skipped (github.ts itemsFromCache: a broken fields block, two issues carrying one ID) is refused,
 * quoting its problem; `records` are the text records its text is read from.
 */
export function claimable(cache: IssueCache, id: string, records: TextRecord[] = []): { issue?: number;
	error?: string }
{
	if (!/^[SB]/.test(id))
	{
		return {};
	}
	const problems = problemsFor(cache, records, id);
	if (problems.length > 0)
	{
		return {
			error: `${id} is skipped by the backlog, so it can't be claimed: ${problems.join("; ")}`,
		};
	}
	const issue = findIssue(cache, id);
	if (!issue)
	{
		// S165: an issue someone else filed carries no ID until the owner accepts it (triage.ts).
		const outside = /^B[1-9][0-9]*$/.test(id) ? cache.issues.find((i) => i.number === Number(id.slice(1)) && isTriage(i, cache.trusted)) : undefined;
		return {
			error: outside
				? `${id}: issue #${outside.number} is a triage issue someone else filed; nothing is built from one until the owner accepts it (a priority and a Source)`
				: `no trusted issue carries ${id} (pnpm backlog:sync, then try again)`,
		};
	}
	// An outside bug accepted in place (its create record exists) may still carry the triage label it
	// had before; only an unaccepted one is refused.
	const accepted = records.some((r) => r.kind === "create" && r.id.toLowerCase() === id.toLowerCase());
	if (issue.labels.some((l) => l.name === TRIAGE_LABEL) && !accepted)
	{
		return {
			error: `${id} (#${issue.number}) is labelled ${TRIAGE_LABEL}: nothing is built from it until the owner accepts it and the label comes off`,
		};
	}
	const status = statusOf(issue);
	if (issue.state !== "open" || (status !== "todo" && status !== "doing"))
	{
		return {
			error: `${id} (#${issue.number}) is ${issue.state === "open" ? `labelled status:${status}` : "closed"}: only an open item labelled status:todo or status:doing can be claimed`,
		};
	}
	// S165: law L9's design clause, moved here and to the live check by the owner's "GitHub owns state (Recommended)".
	const design = designGate(cache, id, itemFromIssue(issue, cache.trusted, records)?.design ?? []);
	if (design.length > 0)
	{
		return {
			error: design.join("; "),
		};
	}
	return {
		issue: issue.number,
	};
}

/**
 * The local branches whose name holds `id` as a whole ID (`story/S133-redraw` for S133, never S1330), so a
 * blocked item's question can say where its stranded work is (S107, S123, S129 and S133 sat ratified on
 * unpushed branches for a day).
 */
export function branchesNaming(branches: string[], id: string): string[]
{
	const whole = new RegExp(`(^|[^A-Za-z0-9])${id}($|[^0-9])`);
	return branches.filter((b) => whole.test(b));
}

/** A claim file that can't be read as a claim: every command stops on it rather than skip it. */
export class ClaimsError extends Error
{
}

/** Throw unless `id` is an item ID ({@link ITEM_ID}), so it is safe as a file name. */
function checkId(id: string): void
{
	if (!ITEM_ID.test(id))
	{
		throw new ClaimsError(`not an item ID: '${id}' (S<N>, B<N>, F<N> or V<N>)`);
	}
}

/**
 * Every in-flight claim under `root`, by ID. A missing `.run/` means nothing is in flight. A file that
 * isn't a claim throws {@link ClaimsError} naming it (an interrupted write, a hand edit).
 */
export function readClaims(root: string): Claim[]
{
	let names: string[];
	try
	{
		names = readdirSync(claimsDir(root));
	}
	catch
	{
		return [];
	}
	return names.filter((n) => n.endsWith(".json")).sort().map((n) =>
	{
		const path = join(claimsDir(root), n);
		let claim: Claim;
		try
		{
			claim = JSON.parse(readFileSync(path, "utf8")) as Claim;
		}
		catch (e)
		{
			throw new ClaimsError(`${path} is not a valid claim (${(e as Error).message}): fix it, or delete it and claim again`);
		}
		if (typeof claim?.id !== "string" || !Array.isArray(claim.files) || !Array.isArray(claim.symbols) || !Array.isArray(claim.docLines))
		{
			throw new ClaimsError(`${path} is not a valid claim (missing id, files, symbols or docLines): fix it, or delete it and claim again`);
		}
		return claim;
	});
}

/** Write (or replace) one claim's file: to a temp file first, then renamed into place, so it is never half-written. */
export function writeClaim(root: string, claim: Claim): void
{
	checkId(claim.id);
	mkdirSync(claimsDir(root), {
		recursive: true,
	});
	// Not ending in .json, so readClaims and in-flight.ts never read it.
	const tmp = join(claimsDir(root), `.${claim.id}.json.${process.pid}.tmp`);
	writeFileSync(tmp, `${JSON.stringify(claim, null, "\t")}\n`);
	renameSync(tmp, join(claimsDir(root), `${claim.id}.json`));
}

/** Drop one claim (its item merged or parked). */
export function removeClaim(root: string, id: string): void
{
	checkId(id);
	rmSync(join(claimsDir(root), `${id}.json`), {
		force: true,
	});
}

/** The lock `claim` and `release` hold: a directory, so taking it is one atomic mkdir. */
export function lockDir(root: string): string
{
	return join(runDir(root), "claims.lock");
}

/**
 * Run `fn` holding the claims lock. Waits up to `waitMs` for another holder; then throws
 * {@link ClaimsError} naming the holder's pid and whether it is still alive. A lock is never broken
 * automatically: a dead holder's is the overseer's to remove.
 */
export function withClaimsLock<T>(root: string, fn: () => T, waitMs = 10_000): T
{
	const lock = lockDir(root);
	mkdirSync(runDir(root), {
		recursive: true,
	});
	const deadline = Date.now() + waitMs;
	for (;;)
	{
		try
		{
			mkdirSync(lock);
			break;
		}
		catch (e)
		{
			if ((e as NodeJS.ErrnoException).code !== "EEXIST")
			{
				throw e;
			}
			if (Date.now() >= deadline)
			{
				throw new ClaimsError(lockHeldMessage(lock));
			}
			Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
		}
	}
	try
	{
		writeFileSync(join(lock, "pid"), `${process.pid}\n`);
		return fn();
	}
	finally
	{
		rmSync(lock, {
			recursive: true,
			force: true,
		});
	}
}

function lockHeldMessage(lock: string): string
{
	let pid = Number.NaN;
	try
	{
		pid = Number(readFileSync(join(lock, "pid"), "utf8").trim());
	}
	catch
	{
		// A holder that died between mkdir and writing its pid leaves none.
	}
	if (!Number.isInteger(pid) || pid <= 0)
	{
		return `${lock} is held by an unknown process (no pid in it); if no claims.ts is running, remove it (rm -r ${lock})`;
	}
	let alive = true;
	try
	{
		process.kill(pid, 0);
	}
	catch (e)
	{
		alive = (e as NodeJS.ErrnoException).code === "EPERM";
	}
	return alive
		? `${lock} is held by pid ${pid}, which is still running; try again when it finishes`
		: `${lock} is held by pid ${pid}, which is no longer running; remove it (rm -r ${lock}) and try again`;
}

function formatReport(claim: Claim, report: ClaimReport): string
{
	const lines = [`claim ${claim.id}: ${report.ok ? "admitted" : "held"}${claim.barrier ? " (barrier item: runs alone)" : ""}`];
	lines.push(...report.conflicts.map((c) => `conflict: ${c}`));
	lines.push(...report.barrier.map((b) => `barrier: ${b}`));
	lines.push(...report.hot.map((h) => `hot file ${h.file}: shared with ${h.with}, which merges first`));
	lines.push(...report.shared.map((s) => `shared file ${s.file}: also claimed by ${s.with}`));
	return lines.join("\n");
}

/** `run start`, `run event` and `run end`, under the claims lock; throws {@link RunError} on refused input. */
function runCommand(root: string, sub: string, rest: string[], values: { n?: string;
	c?: string;
	resume?: boolean;
	pr?: string;
	path?: string;
	barrier?: boolean;
	abandoned?: boolean; }): number
{
	const at = new Date().toISOString();
	const open = readRunJournal(root);
	if (sub === "start" && values.resume)
	{
		if (values.n !== undefined || values.c !== undefined)
		{
			throw new RunError("run start --resume takes no --n or --c: the journal's stand");
		}
		if (!open)
		{
			throw new RunError("run start --resume: no run is open (.run/run.json is missing)");
		}
		appendRunEvent(root, {
			kind: "run-resume",
			at,
		});
		console.log(`run ${open.id} resumed (n ${open.n}, c ${open.c})`);
		return 0;
	}
	if (sub === "start")
	{
		if (open)
		{
			throw new RunError(`run ${open.id} is already open (started ${open.startedAt}): resume it (run start --resume) or record it (scripts/audit.sh run [--abandoned])`);
		}
		const n = Number(values.n);
		const c = Number(values.c);
		// C is 2 or 3 (run-backlog step 3, **Concurrency**; runs.ts concurrency prints one of them).
		if (!/^[1-9][0-9]*$/.test(values.n ?? "") || !/^[23]$/.test(values.c ?? ""))
		{
			throw new RunError("run start needs --n <N>, a positive whole number, and --c <C>, 2 or 3");
		}
		const journal: RunJournal = {
			id: runIdFor(at),
			n,
			c,
			startedAt: at,
			events: [],
		};
		writeRunJournal(root, journal);
		console.log(`run ${journal.id} started (n ${n}, c ${c})`);
		return 0;
	}
	if (sub === "event")
	{
		const [kind = "", id] = rest;
		const event = makeRunEvent(kind, {
			id,
			pr: values.pr,
			path: values.path,
			barrier: values.barrier,
		}, at);
		if (!open)
		{
			throw new RunError("no run is open (.run/run.json is missing): run start first");
		}
		// An interrupted run's time is stopped until `run start --resume` (AC 2's active time), so nothing is
		// logged inside that span. Only `run event` refuses: `run start --resume` and `claim` still append.
		if (isInterrupted(open))
		{
			throw new RunError(`run ${open.id} is interrupted: run start --resume first`);
		}
		appendRunEvent(root, event);
		return 0;
	}
	if (sub === "end")
	{
		const [runId] = rest;
		if (!open || open.id !== runId)
		{
			throw new RunError(open ? `run ${open.id} is open, not ${runId ?? "(none named)"}` : "no run is open (.run/run.json is missing)");
		}
		const ended = join(runDir(root), "ended");
		mkdirSync(ended, {
			recursive: true,
		});
		if (values.abandoned)
		{
			// The abandonment travels with the journal: re-recording it later (audit.sh run --journal) stays abandoned.
			const tmp = join(ended, `.${open.id}.${process.pid}.tmp`);
			writeFileSync(tmp, `${JSON.stringify({
				...open,
				abandoned: true,
			}, null, "\t")}\n`);
			renameSync(tmp, join(ended, `${open.id}.json`));
			rmSync(runJournalPath(root));
		}
		else
		{
			renameSync(runJournalPath(root), join(ended, `${open.id}.json`));
		}
		console.log(`run ${open.id} ended: its journal is .run/ended/${open.id}.json`);
		return 0;
	}
	throw new RunError("usage: claims.ts run start --n <N> --c <C> | run start --resume | run event <kind> [<ID>] [--pr <n>] [--path <p>] [--barrier] | run end <run id>");
}

function main(argv: string[]): number
{
	const { values, positionals } = parseArgs({
		args: argv,
		allowPositionals: true,
		options: {
			"root": {
				type: "string",
			},
			"file": {
				type: "string",
				multiple: true,
			},
			"symbol": {
				type: "string",
				multiple: true,
			},
			"doc-line": {
				type: "string",
				multiple: true,
			},
			"dry-run": {
				type: "boolean",
			},
			"findings": {
				type: "string",
			},
			"pending": {
				type: "string",
			},
			"n": {
				type: "string",
			},
			"c": {
				type: "string",
			},
			"resume": {
				type: "boolean",
			},
			"pr": {
				type: "string",
			},
			"path": {
				type: "string",
			},
			"barrier": {
				type: "boolean",
			},
			"abandoned": {
				type: "boolean",
			},
		},
	});
	const root = resolve(values.root ?? process.cwd());
	const [command, id = ""] = positionals;
	const listInput = (): string[] => values.file ?? readFileSync(0, "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
	// Before any file is touched: an ID names a file under .run/claims/.
	if (["claim", "release", "touched"].includes(command ?? "") && !ITEM_ID.test(id))
	{
		console.error(`claims.ts ${command}: not an item ID: '${id}' (S<N>, B<N>, F<N> or V<N>)`);
		return 2;
	}
	switch (command)
	{
		case "claim":
		{
			let state: { issue?: number;
				error?: string };
			try
			{
				state = claimable(cacheOf(root), id, readRecords(fragmentsDir()));
			}
			catch (error)
			{
				console.error(`claims.ts claim: ${(error as Error).message}`);
				return 2;
			}
			// The journal (S158 AC 1): a claim logs itself, refused or admitted, unless it is a dry run.
			const log = (kind: "claim" | "claim-refused") => values["dry-run"] || appendRunEvent(root, {
				kind,
				id,
				at: new Date().toISOString(),
			});
			if (state.error)
			{
				console.error(`claims.ts claim: ${state.error}`);
				// The lock only when there is something to log: a dry run, or no run, refuses as it did before S158.
				if (!values["dry-run"] && existsSync(runJournalPath(root)))
				{
					withClaimsLock(root, () => log("claim-refused"));
				}
				return 1;
			}
			const files = normalizeEntries(root, values.file ?? []);
			// The python call runs before the lock is taken, so the lock is held only for the compare and write.
			const claim = makeClaim(id, {
				files,
				symbols: values.symbol,
				docLines: values["doc-line"],
			}, claimReviewerFlags(root, files));
			return withClaimsLock(root, () =>
			{
				const report = compareClaim(claim, readClaims(root));
				console.log(formatReport(claim, report));
				if (!report.ok)
				{
					log("claim-refused");
					return 1;
				}
				log("claim");
				if (!values["dry-run"])
				{
					writeClaim(root, {
						...claim,
						mergeAfter: report.mergeAfter,
						...(state.issue === undefined ? {} : {
							issue: state.issue,
						}),
					});
				}
				return 0;
			});
		}
		case "run":
			try
			{
				return withClaimsLock(root, () => runCommand(root, id, positionals.slice(2), values));
			}
			catch (e)
			{
				if (!(e instanceof RunError))
				{
					throw e;
				}
				console.error(`claims.ts run: ${e.message}`);
				return 1;
			}
		case "list":
			for (const c of readClaims(root))
			{
				console.log(`${c.id}${c.barrier ? " barrier" : ""}${c.mergeAfter.length ? ` merges after ${c.mergeAfter.join(", ")}` : ""}`);
			}
			return 0;
		case "release":
			withClaimsLock(root, () => removeClaim(root, id));
			return 0;
		case "touched":
		{
			const claim = readClaims(root).find((c) => c.id === id);
			if (!claim)
			{
				console.error(`no claim for ${id} in ${claimsDir(root)}`);
				return 2;
			}
			const touched = listInput();
			const outside = outsideClaim(claim, touched);
			outside.forEach((f) => console.log(`outside the claim: ${f}`));
			const barrier = barrierTouches(claim, touched, claim.barrier ? [] : reviewerFlags(touched));
			barrier.forEach((f) => console.log(`reviewer path under a non-barrier claim: ${f}`));
			return outside.length + barrier.length > 0 ? 1 : 0;
		}
		case "review-edits":
		{
			const hits = reviewEditsToInFlight(listInput(), readClaims(root).map((c) => c.id));
			hits.forEach((f) => console.log(`review edited an in-flight item's note: ${f}`));
			return hits.length > 0 ? 1 : 0;
		}
		case "findings":
		{
			let text = "";
			try
			{
				text = readFileSync(values.findings ?? join(runDir(root), "findings.md"), "utf8");
			}
			catch
			{
				// No findings file yet: nothing to merge.
			}
			for (const g of mergeFindings(parseFindings(text)))
			{
				console.log(`${g.shared ? "shared fix" : "item fix"} [${g.checklistClass}] ${g.file}: ${g.items.join(", ")}`);
				g.findings.forEach((f) => console.log(`  - ${f.item}${f.line === undefined ? "" : ` line ${f.line}`}: ${f.text}`));
			}
			return 0;
		}
		case "questions":
		{
			let text = "";
			try
			{
				text = readFileSync(values.pending ?? join(root, ".pending", "needs-input.md"), "utf8");
			}
			catch
			{
				// No pending file: no questions.
			}
			const questions = parseQuestions(text);
			for (const q of orderQuestions(questions))
			{
				console.log(`${q.blocks.length} blocked (${q.blocks.join(", ") || "none"}): ${q.heading}`);
			}
			const refs = spawnSync("git", ["-C", root, "for-each-ref", "--format=%(refname:short)", "refs/heads/"], {
				encoding: "utf8",
			});
			const branches = refs.status === 0 ? refs.stdout.split("\n").filter(Boolean) : [];
			let blocked: string[] = [];
			try
			{
				blocked = blockedItems(root);
			}
			catch (error)
			{
				console.log(`(blocked items unknown: ${(error as Error).message})`);
			}
			for (const id of uncoveredBlocked(blocked, questions))
			{
				const named = branchesNaming(branches, id);
				console.log(`no question: ${id} is blocked${named.length ? ` (local branches: ${named.join(", ")})` : ""}`);
			}
			return 0;
		}
		default:
			console.error("usage: claims.ts claim|list|release|touched|review-edits|findings|questions|run … (see the file's header)");
			return 2;
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
{
	try
	{
		process.exitCode = main(process.argv.slice(2));
	}
	catch (e)
	{
		if (!(e instanceof ClaimsError))
		{
			throw e;
		}
		console.error(`claims.ts: ${e.message}`);
		process.exitCode = 2;
	}
}
