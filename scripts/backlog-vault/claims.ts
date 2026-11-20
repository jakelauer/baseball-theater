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
 *   and covers everything under it (a fence entry).
 * - `symbols`: the exported functions, components and hooks it will add, by name.
 * - `docLines`: the doc lines it rewrites, each `<path>: <the line's text or heading>`, compared with
 *   whitespace collapsed.
 * - `barrier`: whether it must run alone (see {@link isBarrierPath}); `mergeAfter`: the in-flight items
 *   it shares a hot file with, which merge before it.
 *
 * The file name is the in-flight record: `scripts/review-debt.sh` and `scripts/parity-debt.sh` read the
 * in-flight IDs from `.run/claims/*.json` names alone, so a claim is removed (`release`) once its item
 * merges or parks. Two more files are inputs, never written here:
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
 *       at commit time: files touched (stdin, one a line, when no --file) that the claim doesn't cover; exit 1 if any
 *   node scripts/backlog-vault/claims.ts review-edits [--file <p>…]
 *       a review's changed files (stdin when no --file): exit 1 if any is an in-flight item's note
 *   node scripts/backlog-vault/claims.ts findings [--findings <file>]   merge findings by class and file
 *   node scripts/backlog-vault/claims.ts questions [--pending <file>]   owner questions, most-blocking first
 *
 * Everything but the CLI's file and process calls is a pure exported function (claims.test.ts).
 */

import { spawnSync } from "node:child_process";
import {
	mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync,
} from "node:fs";
import {
	dirname, join, resolve,
} from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

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

/** Item IDs: a letter prefix and digits (`S156`, `B87`, a shared fix's `F1`), safe as a file name. */
const ID_RE = /^[A-Z]+[0-9]+$/;

/** The rule and agent files that, besides the reviewer paths, make an item run alone (S156 AC 12). */
const BARRIER_FILES = ["CLAUDE.md", "docs/v3/LOOP.md"];
const BARRIER_DIRS = [".claude/"];

const PLAN_REVIEW = join(dirname(fileURLToPath(import.meta.url)), "../claude-review/plan-review.py");

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

/** Build a claim from a worker's lists; `flags` is {@link reviewerFlags} of `files`, in order. */
export function makeClaim(id: string, input: { files?: string[];
	symbols?: string[];
	docLines?: string[] }, flags: boolean[], now = new Date()): Claim
{
	if (!ID_RE.test(id))
	{
		throw new Error(`not an item ID: ${id}`);
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
 * The item's own records, which only it writes and so never need claiming: its story or bug note, its
 * grader, its changelog fragment and its ledger fragments (named for its ID, S156 ACs 5–6).
 */
export function isOwnRecord(id: string, path: string): boolean
{
	const own = [
		new RegExp(`^docs/v3/backlog/(stories|bugs)/[a-z]+/${id}\\.md$`),
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
 * S156 AC 13: a review running beside in-flight items edits only notes of items not in flight. Returns
 * the changed paths that are an in-flight item's story or bug note.
 */
export function reviewEditsToInFlight(changed: string[], inFlightIds: string[]): string[]
{
	const ids = new Set(inFlightIds);
	return changed.filter((p) =>
	{
		const m = /^docs\/v3\/backlog\/(?:stories|bugs)\/[a-z]+\/([A-Z]+[0-9]+)\.md$/.exec(p);
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
		if (!m)
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
		const blocks = line ? [...new Set((line[1] ?? "").split(/[\s,]+/).filter((id) => ID_RE.test(id)))] : [];
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

/** Every in-flight claim under `root`, by ID. A missing `.run/` means nothing is in flight. */
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
	return names.filter((n) => n.endsWith(".json")).sort().map((n) => JSON.parse(readFileSync(join(claimsDir(root), n), "utf8")) as Claim);
}

/** Write (or replace) one claim's file. */
export function writeClaim(root: string, claim: Claim): void
{
	mkdirSync(claimsDir(root), {
		recursive: true,
	});
	writeFileSync(join(claimsDir(root), `${claim.id}.json`), `${JSON.stringify(claim, null, "\t")}\n`);
}

/** Drop one claim (its item merged or parked). */
export function removeClaim(root: string, id: string): void
{
	rmSync(join(claimsDir(root), `${id}.json`), {
		force: true,
	});
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
		},
	});
	const root = resolve(values.root ?? process.cwd());
	const [command, id] = positionals;
	const listInput = (): string[] => values.file ?? readFileSync(0, "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
	switch (command)
	{
		case "claim":
		{
			const files = values.file ?? [];
			const claim = makeClaim(id ?? "", {
				files,
				symbols: values.symbol,
				docLines: values["doc-line"],
			}, reviewerFlags(files));
			const report = compareClaim(claim, readClaims(root));
			console.log(formatReport(claim, report));
			if (!report.ok)
			{
				return 1;
			}
			if (!values["dry-run"])
			{
				writeClaim(root, {
					...claim,
					mergeAfter: report.mergeAfter,
				});
			}
			return 0;
		}
		case "list":
			for (const c of readClaims(root))
			{
				console.log(`${c.id}${c.barrier ? " barrier" : ""}${c.mergeAfter.length ? ` merges after ${c.mergeAfter.join(", ")}` : ""}`);
			}
			return 0;
		case "release":
			removeClaim(root, id ?? "");
			return 0;
		case "touched":
		{
			const claim = readClaims(root).find((c) => c.id === id);
			if (!claim)
			{
				console.error(`no claim for ${id} in ${claimsDir(root)}`);
				return 2;
			}
			const outside = outsideClaim(claim, listInput());
			outside.forEach((f) => console.log(`outside the claim: ${f}`));
			return outside.length > 0 ? 1 : 0;
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
			for (const q of orderQuestions(parseQuestions(text)))
			{
				console.log(`${q.blocks.length} blocked (${q.blocks.join(", ") || "none"}): ${q.heading}`);
			}
			return 0;
		}
		default:
			console.error("usage: claims.ts claim|list|release|touched|review-edits|findings|questions … (see the file's header)");
			return 2;
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
{
	process.exitCode = main(process.argv.slice(2));
}
