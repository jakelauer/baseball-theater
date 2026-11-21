/**
 * The backlog's Obsidian notes (docs/v3/VAULT-MIGRATION.md, V3).
 *
 *   pnpm backlog:build    rewrite the notes canonically (derived fields refreshed, each note moved to
 *                         its status folder) and write docs/v3/INDEX.md and docs/v3/audit.jsonl
 *   pnpm backlog:check    exit 1 if build would change a note, or a finished story's records are
 *                         missing (records.ts), or the story text records are inconsistent (law L9's
 *                         tree-reproducible part, S164: text-records.ts); builds INDEX.md in memory,
 *                         never reads it from disk, the issue cache or GitHub, so its verdict at a
 *                         commit is the same wherever and whenever it runs
 *   cli.ts pre-commit     (the Husky hook) canonicalize the staged notes and re-stage them
 *   cli.ts ledger-base backlog|parity   the commit the debt checks measure drift from (ledger.ts)
 *   cli.ts review-base backlog|parity   the commit that logged the newest review itself, past later skips and
 *                                       answers: the base a review's seed measures from (S163; search.ts)
 *   cli.ts done-since backlog|parity    stories completed since the newest review of that kind
 *   cli.ts review-blocked backlog|parity  prints `blocked` when that review waits for the owner, else `clear`
 *   cli.ts in-flight [--in-flight S1,S2]  the items in flight in a parallel run, comma-separated (in-flight.ts)
 *
 * INDEX.md (the docs index agents start reading from, with the generated As of, Next and
 * review-debt lines; doc-index.ts) and audit.jsonl (the ledger's index) are built and git-ignored,
 * never committed (S156; owner, 2026-11-20: "Stop committing them (Recommended)"), and the
 * generated docs/v3/BACKLOG.md is retired (owner, same day: "Retire it (Recommended)"): tools
 * read the notes themselves.
 *
 * `--dir <notes dir>` (default docs/v3/backlog; its parent is the docs dir INDEX.md is written to),
 * `--audit <file>` (default docs/v3/AUDIT.md, the frozen ledger) and `--index <file>` (default
 * docs/v3/audit.jsonl) let graders and hooks work on copies. Everything is computed in memory
 * first, so a note that fails to parse changes nothing on disk.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
	readdir, readFile, writeFile,
} from "node:fs/promises";
import {
	dirname, join, relative, resolve,
} from "node:path";
import { parseArgs } from "node:util";
import type { BuiltBacklog } from "./assemble.ts";
import { buildFromNotes } from "./assemble.ts";
import { changelogFragmentFor } from "./changelog.ts";
import type { IndexedDoc, LedgerState } from "./doc-index.ts";
import {
	docIndexFor, isIndexedDoc, liveBacklog,
} from "./doc-index.ts";
import { inFlightIds } from "./in-flight.ts";
import type { LedgerEntry, ReviewKind } from "./ledger.ts";
import {
	fragmentsDirFor, ledgerBase, parseLedger, readLedger, renderLedgerIndex, reviewBlocked, storiesDoneSince,
} from "./ledger.ts";
import {
	misplacedNotes, readNotes, writeNotes,
} from "./notes-dir.ts";
import { designMatchProblems, parseBacklog } from "./parse.ts";
import { runPrecommit } from "./precommit.ts";
import type { ChangelogState } from "./records.ts";
import { frozenCompletions, recordProblems } from "./records.ts";
import type { SourceDocs } from "./source.ts";
import { sourceProblems } from "./source.ts";
import type { TextRecord } from "./text-records.ts";
import {
	BODY_KINDS, chains, parseFields, readRecords, textRecordProblems,
} from "./text-records.ts";

const repoRoot = resolve(import.meta.dirname, "../..");

const { values, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		dir: {
			type: "string",
			default: join(repoRoot, "docs/v3/backlog"),
		},
		audit: {
			type: "string",
			default: join(repoRoot, "docs/v3/AUDIT.md"),
		},
		index: {
			type: "string",
			default: join(repoRoot, "docs/v3/audit.jsonl"),
		},
		"in-flight": {
			type: "string",
		},
		quiet: {
			type: "boolean",
			default: false,
		},
	},
});

const dir = resolve(values.dir);
/** docs/v3: the notes dir's parent, which holds FEATURES.md, INTENT.md, the other docs and INDEX.md. */
const docsDir = dirname(dir);
const auditPath = resolve(values.audit);
const indexPath = resolve(values.index);

async function readAudit(): Promise<string | undefined>
{
	return readFile(auditPath, "utf8").catch(() => undefined);
}

/**
 * Every ledger entry, in ledger order: the frozen AUDIT.md's, then its fragments' in stamp order
 * (ledger.ts readLedger, from the docs/v3/audit/ folder beside it). The one place this tool reads
 * the whole ledger. No AUDIT.md (a copy of the notes alone) is an empty ledger.
 */
async function ledgerEntries(): Promise<LedgerEntry[]>
{
	return existsSync(auditPath) ? readLedger(auditPath) : [];
}

/** The frozen ledger's entries alone: AUDIT.md, which draws the pre-S156 line for records.ts. */
async function frozenEntries(): Promise<LedgerEntry[]>
{
	const audit = await readAudit();
	return audit === undefined ? [] : parseLedger(audit);
}

/** A story's changelog fragment as records.ts needs it (changelog.ts reads and parses it). */
function changelogState(id: string): ChangelogState
{
	try
	{
		return changelogFragmentFor(notesRoot(), id) === undefined ? "missing" : "present";
	}
	catch (error)
	{
		return {
			malformed: (error as Error).message,
		};
	}
}

/** The repository the notes dir sits in (docs/v3/backlog → three levels up), for changelog.d/. */
const notesRoot = () => resolve(docsDir, "../..");

/** HEAD's short sha, for the As of line; "unknown" outside a git checkout. */
function head(): string
{
	try
	{
		return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
			cwd: notesRoot(),
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
	}
	catch
	{
		return "unknown";
	}
}

/** FEATURES.md and INTENT.md beside the backlog, which every story's **Source:** line is checked against (rule 19). */
async function readSourceDocs(): Promise<SourceDocs>
{
	return {
		features: await readFile(join(docsDir, "FEATURES.md"), "utf8"),
		intent: await readFile(join(docsDir, "INTENT.md"), "utf8"),
	};
}

/** docs/v3's own Markdown docs, for the docs index. */
async function readIndexedDocs(): Promise<IndexedDoc[]>
{
	const names = (await readdir(docsDir).catch(() => [] as string[])).filter(isIndexedDoc).sort();
	return Promise.all(names.map(async (path) => ({
		path,
		text: await readFile(join(docsDir, path), "utf8"),
	})));
}

/** Where the docs index lives: docs/v3/INDEX.md. */
const docIndexPath = () => join(docsDir, "INDEX.md");

function log(message: string)
{
	if (!values.quiet)
	{
		console.log(`backlog: ${message}`);
	}
}

/**
 * INDEX.md's text for a build, from the frame notes, the text records, the docs and the ledger. `live`
 * reads the issue cache (build only): `pnpm backlog:check` builds it with none, so it never reads the
 * cache and its verdict is the same at any commit (S164 AC 2).
 */
async function docIndex(built: BuiltBacklog, entries: LedgerEntry[], live = false): Promise<string>
{
	const ledger: LedgerState = {
		entries,
		head: head(),
	};
	const backlog = live ? liveBacklog(notesRoot()) : undefined;
	if (live && backlog === undefined)
	{
		// To stderr, so the hooks (which silence stdout) still say it; the build itself succeeds.
		console.error("backlog: no issue cache, so INDEX.md lists only the recorded items: run pnpm backlog:sync");
	}
	return docIndexFor(built.notes, readRecords(fragmentsDirFor(auditPath)), await readIndexedDocs(), ledger, backlog);
}

async function build()
{
	const notes = await readNotes(dir);
	const built = buildFromNotes(notes, await readSourceDocs());
	const entries = await ledgerEntries();
	const index = await docIndex(built, entries, true);
	await writeNotes(dir, notes, built.notes, log);
	log(`built ${built.notes.size} notes in ${dir}`);
	await writeFile(indexPath, renderLedgerIndex(entries));
	log(`built ${indexPath} from the ledger`);
	await writeFile(docIndexPath(), index);
	log(`built ${docIndexPath()}`);
}

async function check()
{
	const notes = await readNotes(dir);
	const built = buildFromNotes(notes, await readSourceDocs());
	// Built in memory so a broken index fails here; the file on disk is git-ignored and never compared.
	await docIndex(built, await ledgerEntries());
	const stale: string[] = [];
	for (const path of new Set([...notes.keys(), ...built.notes.keys()]))
	{
		if (notes.get(path) !== built.notes.get(path))
		{
			stale.push(join(dir, path));
		}
	}
	const problems = [
		...recordProblems(parseBacklog(built.backlog).stories, frozenCompletions(await frozenEntries()), changelogState),
		...(await recordedTextProblems(notes)),
	];
	if (stale.length > 0)
	{
		const misplaced = misplacedNotes(notes, built.notes);
		const moves = misplaced.length === 0 ? "" : `\nNotes in the wrong folder (pnpm backlog:build moves them):\n  ${misplaced.join("\n  ")}`;
		console.error(`backlog: out of date — run pnpm backlog:build. Would change:\n  ${stale.join("\n  ")}${moves}`);
		process.exitCode = 1;
	}
	if (problems.length > 0)
	{
		console.error(`backlog: finished stories with missing records, or inconsistent story text records:\n- ${problems.join("\n- ")}`);
		process.exitCode = 1;
	}
	if (stale.length === 0 && problems.length === 0)
	{
		log("the notes are consistent");
	}
}

/** The story or bug notes still in the notes dir (stories/<status>/S<N>.md, bugs/<status>/B<N>.md). */
function itemNotes(notes: Map<string, string>): string[]
{
	return [...notes.keys()].filter((p) => /^(stories|bugs)\/([^/]+\/)?[SB]\d+\.md$/.test(p)).map((p) => join(dir, p));
}

/**
 * Law L9's tree-reproducible part over the text records (S164 AC 2), read from the ledger's fragments
 * alone (never the cache or GitHub): the chain, hashes and fields blocks (text-records.ts), and, for
 * text recorded since the migration (a `create` or `edit` tip; migrated text already passed these
 * checks as a note at the migration's base), rule 19's Source and L8's design-match criterion. A
 * snapshot recording `done` needs the story's changelog fragment and its `**Baseline:**` line.
 */
async function recordedTextProblems(notes: Map<string, string>): Promise<string[]>
{
	const records: TextRecord[] = readRecords(fragmentsDirFor(auditPath));
	const problems = textRecordProblems(records, itemNotes(notes));
	const changed = [...chains(records).values()]
		.map((c) => c.records.at(-1)!)
		.filter((tip) => tip.kind !== "migration" && tip.id.startsWith("S") && BODY_KINDS.includes(tip.kind));
	const stories = changed.flatMap((tip) =>
	{
		try
		{
			const fields = parseFields(tip.body, tip.id);
			return [{
				id: tip.id,
				status: "todo",
				source: /^\*\*Source:\*\*\s*(.+)$/m.exec(tip.body)?.[1]?.trim() ?? null,
				design: fields.design,
				body: tip.body,
			}];
		}
		catch
		{
			return []; // textRecordProblems already names a broken fields block
		}
	});
	problems.push(...sourceProblems(stories, await readSourceDocs()), ...designMatchProblems(stories));
	const snapshots = records.filter((r) => r.kind === "snapshot" && r.status === "done");
	problems.push(...recordProblems(snapshots.map((r) => ({
		id: r.id,
		status: "done",
		body: r.body,
	})), frozenCompletions(await frozenEntries()), changelogState));
	return problems;
}

async function preCommit()
{
	const result = runPrecommit(repoRoot);
	if (!result.ok)
	{
		console.error(`pre-commit: ${result.message}`);
		process.exitCode = 1;
		return;
	}
	if (result.restaged.length > 0)
	{
		log(`rebuilt and re-staged ${result.restaged.join(", ")}`);
	}
}

/** The review kind named after a ledger command (`ledger-base backlog`). */
function reviewKind(): ReviewKind
{
	const kind = positionals[1];
	if (kind !== "backlog" && kind !== "parity")
	{
		throw new Error(`${positionals[0]} needs 'backlog' or 'parity'`);
	}
	return kind;
}

/** Prints the short sha of the commit the debt checks measure from, or nothing when no review is logged. */
async function printLedgerBase()
{
	const base = ledgerBase(repoRoot, relative(repoRoot, auditPath), reviewKind());
	if (base)
	{
		console.log(base);
	}
}

/** Prints the short sha of the commit that logged the newest review itself (no skip or answers entry), or nothing when none is logged. */
async function printReviewBase()
{
	const base = ledgerBase(repoRoot, relative(repoRoot, auditPath), reviewKind(), ["review"]);
	if (base)
	{
		console.log(base);
	}
}

/** Prints the stories completed since the newest review of the kind, comma-separated (empty when none). */
async function printDoneSince()
{
	console.log(storiesDoneSince(await ledgerEntries(), reviewKind()).stories.join(", "));
}

/** Prints `blocked` when the review waits for the owner (ledger.ts reviewBlocked), else `clear`; an error prints neither. */
async function printReviewBlocked()
{
	console.log(reviewBlocked(await ledgerEntries(), reviewKind()) ? "blocked" : "clear");
}

/** Prints the items in flight (in-flight.ts): `--in-flight` when given, else the run's claim files under the repo's .run/claims/. */
async function printInFlight()
{
	console.log(inFlightIds(process.cwd(), values["in-flight"]).join(", "));
}

const commands: Record<string, () => Promise<void>> = {
	build,
	check,
	"pre-commit": preCommit,
	"ledger-base": printLedgerBase,
	"review-base": printReviewBase,
	"done-since": printDoneSince,
	"review-blocked": printReviewBlocked,
	"in-flight": printInFlight,
};

// lint-staged and hooks may append file paths; only the first positional is the command.
const command = commands[positionals[0] ?? ""];
if (!command)
{
	console.error("usage: cli.ts <build|check|pre-commit|ledger-base|review-base|done-since|review-blocked <kind>|in-flight> [--dir <notes dir>] [--audit <file>] [--index <file>] [--in-flight <IDs>] [--quiet]");
	process.exitCode = 2;
}
else
{
	try
	{
		await command();
	}
	catch (error)
	{
		console.error(`backlog: ${(error as Error).message}`);
		process.exitCode = 1;
	}
}
