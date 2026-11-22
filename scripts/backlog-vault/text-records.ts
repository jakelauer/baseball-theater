/**
 * The repository's one-way record of story text (S164; owner, 2026-11-20: "GitHub owns state
 * (Recommended)"). Since S164 a story's text lives in its GitHub issue, and GitHub owns its state
 * (labels, open or closed, milestone). What the repository keeps is the text agreed at each step,
 * as ledger fragments written only by `scripts/audit.sh` (rule 13):
 *
 *   migration  the body GitHub returned when `pnpm backlog:migrate` made or folded the issue, plus
 *              any rewrite diff the migration applied to an open story
 *   create     a new story's body (`audit.sh create <ID> --body-file … --title … --reason …`), or an
 *              accepted bug's fields block (`audit.sh create B<N> --issue <n>`)
 *   edit       a new body, chained to the one before it by that body's SHA-256 (`from`)
 *   snapshot   at ship time (`audit.sh story`): the newest body record, its hash and its
 *              `**Baseline:**` line, and the status the story ships with, `done`
 *
 * Every body sits byte-exact between {@link BODY_BEGIN} and {@link BODY_END}, and these fragments
 * are in `.prettierignore`, so the stated hash always holds. Reading them needs no network and no
 * cache, so `pnpm backlog:check` (law L9's tree-reproducible part) gives the same verdict at any
 * commit. This module never imports github.ts.
 *
 *   node scripts/backlog-vault/text-records.ts render <kind> <ID> --stamp … --head … [--issue n] [--base sha]
 *        [--from hash] [--title t] [--reason r] [--status s] [--record file] [--body-file f] [--rewrite-file f]
 *                                            prints the fragment audit.sh writes
 *   node scripts/backlog-vault/text-records.ts newest <ID> [--field …]   the newest body record's body, hash, file… (for audit.sh)
 *   node scripts/backlog-vault/text-records.ts body <fragment>          a record's body, checked against its hash (checks.sh)
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
	basename, join, resolve,
} from "node:path";
import { fileURLToPath } from "node:url";
import { isRunDirectly } from "./run-directly.ts";
import { parse as parseYaml } from "yaml";
import { FRAGMENT_NAME, fragmentFiles } from "./ledger.ts";

/** The record kinds, as their fragment file names spell them. */
export const RECORD_KINDS = ["migration", "create", "edit", "snapshot"] as const;
export type RecordKind = (typeof RECORD_KINDS)[number];

/** The kinds that hold a body a later edit chains from (a snapshot copies one, it never starts a link). */
export const BODY_KINDS: RecordKind[] = ["migration", "create", "edit"];

/** The heading word for each kind (`## <date> — S12 migrated`), which ledger.ts's shapes read back. */
export const RECORD_HEADINGS: Record<RecordKind, string> = {
	migration: "migrated",
	create: "created",
	edit: "edited",
	snapshot: "snapshot",
};

export const BODY_BEGIN = "<!-- bt-body:begin -->";
export const BODY_END = "<!-- bt-body:end -->";

/** One text record, parsed from its fragment. */
export interface TextRecord
{
	kind: RecordKind;
	id: string;
	/** The fragment's path relative to the fragments folder (`2026-11-21/<stamp>-S12-edit.md`). */
	file: string;
	issue?: number;
	/** The commit a migration read its notes from, or the `stage` commit a reconcile read. */
	base?: string;
	/** An edit's link: the SHA-256 of the body before it. */
	from?: string;
	/** The SHA-256 the fragment states for its body. */
	hash: string;
	body: string;
	title?: string;
	reason?: string;
	/** A snapshot's status (`done`). */
	status?: string;
	/** A snapshot's source record (its file, relative to the fragments folder). */
	record?: string;
	/** The rewrite diffs a migration applied to an open story. */
	rewrites: string[];
}

/** A body's SHA-256, hex: what every record states and the chain links by. */
export function sha256(text: string): string
{
	return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * The value of a `| <name> | … |` row: a wholly backticked value (a hash, a commit, a path) unwrapped,
 * any other value (a title, a reason) with the `\|` that {@link renderRecord}'s cells escape put back.
 */
function row(text: string, name: string): string | undefined
{
	const m = new RegExp(`^\\| ${name.replace(/[()]/g, "\\$&")} \\| (.*) \\|$`, "m").exec(text);
	if (!m)
	{
		return undefined;
	}
	const ticked = /^`([^`]*)`$/.exec(m[1]!);
	return ticked ? ticked[1]! : m[1]!.replace(/\\\|/g, "|");
}

/** A body with CRLF line ends made LF: GitHub's web editor saves CRLF, and every reader parses LF. */
export function lf(text: string): string
{
	return text.replace(/\r\n/g, "\n");
}

/** A fragment's stamp (`20261121T104717Z`), from its file name: the chain's order. */
export function recordStamp(record: TextRecord): string
{
	return basename(record.file).split("-")[0]!;
}

/** Thrown for a fragment that isn't a well-formed text record. */
export class RecordError extends Error
{
	override name = "RecordError";
}

/**
 * Parses one text-record fragment (`file` relative to the fragments folder). Its name must be a
 * ledger fragment name whose kind is one of {@link RECORD_KINDS}; its body is the exact text between
 * the markers.
 */
export function parseRecord(text: string, file: string): TextRecord
{
	const name = FRAGMENT_NAME.exec(basename(file));
	if (!name || !(RECORD_KINDS as readonly string[]).includes(name[3]!))
	{
		throw new RecordError(`${file}: not a text record (<stamp>-<ID>-migration|create|edit|snapshot.md)`);
	}
	const kind = name[3] as RecordKind;
	const id = name[2]!;
	const begin = text.indexOf(`${BODY_BEGIN}\n`);
	const end = text.lastIndexOf(`\n${BODY_END}`);
	if (begin === -1 || end < begin + BODY_BEGIN.length)
	{
		throw new RecordError(`${file}: no body between ${BODY_BEGIN} and ${BODY_END}`);
	}
	const head = text.slice(0, begin);
	const hash = row(head, "Body SHA-256");
	if (!hash)
	{
		throw new RecordError(`${file}: no | Body SHA-256 | row`);
	}
	const issue = /^Issue: #(\d+)$/m.exec(head)?.[1];
	const rewrites = [...head.matchAll(/^```diff\n([\s\S]*?)\n```$/gm)].map((m) => m[1]!);
	const record: TextRecord = {
		kind,
		id,
		file,
		hash,
		body: text.slice(begin + BODY_BEGIN.length + 1, end),
		rewrites,
	};
	const optional: [keyof TextRecord, string | undefined][] = [
		["base", row(head, "Base") ?? row(head, "Read from stage")],
		["from", row(head, "From")],
		["title", row(head, "Title")],
		["reason", row(head, "Reason")],
		["status", row(head, "Status")],
		["record", row(head, "Record")],
	];
	for (const [key, value] of optional)
	{
		if (value !== undefined)
		{
			(record as unknown as Record<string, unknown>)[key] = value;
		}
	}
	if (issue)
	{
		record.issue = Number(issue);
	}
	return record;
}

/** Every text record under the fragments folder `dir`, in stamp order. Other fragments are skipped. */
export function readRecords(dir: string): TextRecord[]
{
	return fragmentFiles(dir)
		.filter((f) => (RECORD_KINDS as readonly string[]).includes(FRAGMENT_NAME.exec(basename(f))?.[3] ?? ""))
		.map((f) => parseRecord(readFileSync(join(dir, f), "utf8"), f));
}

/** What a record fragment is rendered from (audit.sh passes these as flags). */
export interface RecordInput
{
	kind: RecordKind;
	id: string;
	date: string;
	stamp: string;
	head: string;
	body: string;
	issue?: number;
	base?: string;
	baseLabel?: "Base" | "Read from stage";
	from?: string;
	title?: string;
	reason?: string;
	status?: string;
	record?: string;
	rewrites?: string[];
}

const ENTRY: Record<RecordKind, string> = {
	migration: "story text at migration — the body GitHub returned when `pnpm backlog:migrate` made or folded the issue (S164)",
	create: "story text created — recorded first; `scripts/audit.sh apply` sends it to GitHub once its ledger pull request merges",
	edit: "story text edited — recorded first; `scripts/audit.sh apply` sends it to GitHub once its ledger pull request merges",
	snapshot: "ship-time snapshot — the story's newest body record and the status it ships with, written by `audit.sh story`",
};

/** One table cell's text: no newline or bar can break the row. */
const cell = (text: string) => text.replace(/\s*\n\s*/g, " ").replace(/\|/g, "\\|");

/** The fragment text for a record: the entry heading ledger.ts reads, its rows, any rewrite diffs, then the exact body. */
export function renderRecord(input: RecordInput): string
{
	const rows = [
		"| | |",
		"|---|---|",
		`| Entry | ${ENTRY[input.kind]} |`,
		`| Captured (UTC) | \`${input.stamp}\` |`,
		`| HEAD at capture | \`${input.head}\` |`,
	];
	if (input.base)
	{
		rows.push(`| ${input.baseLabel ?? "Base"} | \`${input.base}\` |`);
	}
	if (input.title)
	{
		rows.push(`| Title | ${cell(input.title)} |`);
	}
	if (input.from)
	{
		rows.push(`| From | \`${input.from}\` |`);
	}
	if (input.record)
	{
		rows.push(`| Record | \`${input.record}\` |`);
	}
	rows.push(`| Body SHA-256 | \`${sha256(input.body)}\` |`);
	if (input.status)
	{
		rows.push(`| Status | \`${input.status}\` |`);
	}
	if (input.reason)
	{
		rows.push(`| Reason | ${cell(input.reason)} |`);
	}
	const out = [`## ${input.date} — ${input.id} ${RECORD_HEADINGS[input.kind]}`, "", ...rows, ""];
	if (input.issue !== undefined)
	{
		out.push(`Issue: #${input.issue}`, "");
	}
	for (const diff of input.rewrites ?? [])
	{
		out.push("**Rewrite**", "", "```diff", diff, "```", "");
	}
	out.push("**Body**", "", BODY_BEGIN, input.body, BODY_END, "");
	return out.join("\n");
}

/** The fields a story's (or an accepted bug's) `### Backlog fields` block holds. */
export interface BacklogFields
{
	priority: number;
	depends_on: string[];
	prefer_after: string[];
	design: string[];
	source: string | null;
	turn_cap: number | null;
	scope_files: string[];
}

export const FIELDS_HEADING = "### Backlog fields";

/** The fields block's YAML text in a body, or undefined when the body has none. */
export function fieldsYaml(text: string): string | undefined
{
	const body = lf(text);
	const at = body.lastIndexOf(`\n${FIELDS_HEADING}\n`);
	const start = body.startsWith(`${FIELDS_HEADING}\n`) ? 0 : at === -1 ? -1 : at + 1;
	if (start === -1)
	{
		return undefined;
	}
	return /```yaml\n([\s\S]*?)\n?```/.exec(body.slice(start))?.[1] ?? "";
}

/** The body without its fields section (a bug's symptoms, or a story's text above the block). */
export function withoutFields(text: string): string
{
	const body = lf(text);
	const at = body.lastIndexOf(`\n${FIELDS_HEADING}\n`);
	return at === -1 ? (body.startsWith(`${FIELDS_HEADING}\n`) ? "" : body) : body.slice(0, at).replace(/\s+$/, "");
}

/** The `### Backlog fields` section for these fields: one fenced `yaml` block. */
export function renderFields(fields: Partial<BacklogFields>): string
{
	const lines: string[] = [];
	for (const [key, value] of Object.entries(fields))
	{
		if (value === undefined)
		{
			continue;
		}
		if (Array.isArray(value))
		{
			lines.push(value.length === 0 ? `${key}: []` : `${key}:\n${value.map((v) => `  - ${JSON.stringify(v)}`).join("\n")}`);
		}
		else
		{
			lines.push(`${key}: ${typeof value === "string" ? JSON.stringify(value) : String(value)}`);
		}
	}
	return `${FIELDS_HEADING}\n\n\`\`\`yaml\n${lines.join("\n")}\n\`\`\`\n`;
}

/** A body with its fields section replaced (or added) by these fields. */
export function withFields(body: string, fields: Partial<BacklogFields>): string
{
	const text = withoutFields(body);
	return `${text === "" ? "" : `${text}\n\n`}${renderFields(fields)}`;
}

/** Thrown when a fields block is missing or doesn't parse; the message names where. */
export class FieldsError extends Error
{
	override name = "FieldsError";
}

const list = (v: unknown, key: string, where: string): string[] =>
{
	if (v === undefined || v === null)
	{
		return [];
	}
	if (!Array.isArray(v) || v.some((x) => typeof x !== "string"))
	{
		throw new FieldsError(`${where}: fields block \`${key}\` is not a list of strings`);
	}
	return (v as string[]).map((x) => x.replace(/^\[\[(.*)\]\]$/, "$1"));
};

/**
 * The fields block of `body`, parsed. `where` names the item in an error (an issue, a fragment).
 * A missing block, YAML that doesn't parse, or a priority that isn't a number throws {@link FieldsError}.
 */
export function parseFields(body: string, where: string): BacklogFields
{
	const yaml = fieldsYaml(body);
	if (yaml === undefined)
	{
		throw new FieldsError(`${where}: no ${FIELDS_HEADING} section`);
	}
	let raw: unknown;
	try
	{
		raw = parseYaml(yaml);
	}
	catch (error)
	{
		throw new FieldsError(`${where}: fields block does not parse: ${(error as Error).message.split("\n")[0]}`);
	}
	if (raw === null || typeof raw !== "object" || Array.isArray(raw))
	{
		throw new FieldsError(`${where}: fields block is not a mapping`);
	}
	const f = raw as Record<string, unknown>;
	if (typeof f.priority !== "number" || !Number.isFinite(f.priority))
	{
		throw new FieldsError(`${where}: fields block has no numeric priority`);
	}
	return {
		priority: f.priority,
		depends_on: list(f.depends_on, "depends_on", where),
		prefer_after: list(f.prefer_after, "prefer_after", where),
		design: list(f.design, "design", where),
		source: typeof f.source === "string" ? f.source : null,
		turn_cap: typeof f.turn_cap === "number" ? f.turn_cap : null,
		scope_files: list(f.scope_files, "scope_files", where),
	};
}

/** Each item's body records (migration, create, edit) in chain order, with the problems found ordering them. */
export interface Chain
{
	id: string;
	records: TextRecord[];
	/** The longest valid chain: the start and each edit that chains from the body before it (no fork, gap or misplaced edit). */
	valid: TextRecord[];
	problems: string[];
}

/**
 * Orders each item's body records by their fragments' stamps: the one `migration` or `create` first,
 * then each `edit`, whose `from` must be the hash of the body just before it in stamp order. A body
 * may come back (A→B→A→C is a valid chain), since the order is the stamps', not the hashes'. Reports
 * a second start (two items recorded under one ID), an edit stamped before its start, an edit whose
 * `from` matches an earlier edit's `from` (a fork, naming both fragments: two branches edited one
 * story from one base), and any other edit whose `from` isn't the body before it (a gap).
 */
export function chains(records: TextRecord[]): Map<string, Chain>
{
	const byId = new Map<string, Chain>();
	const byStamp = (a: TextRecord, b: TextRecord) => recordStamp(a).localeCompare(recordStamp(b)) || a.file.localeCompare(b.file);
	for (const r of records.filter((x) => BODY_KINDS.includes(x.kind)).sort(byStamp))
	{
		const chain = byId.get(r.id) ?? {
			id: r.id,
			records: [],
			valid: [],
			problems: [],
		};
		chain.records.push(r);
		byId.set(r.id, chain);
	}
	for (const chain of byId.values())
	{
		const starts = chain.records.filter((r) => r.kind !== "edit");
		if (starts.length > 1)
		{
			chain.problems.push(`${chain.id} is recorded more than once (one recorded item per ID): ${starts.map((s) => s.file).join(" and ")}`);
		}
		if (starts.length === 0)
		{
			chain.problems.push(`${chain.id} has edits but no migration or create record: ${chain.records[0]!.file}`);
		}
		const ordered: TextRecord[] = starts.slice(0, 1);
		const lost: TextRecord[] = [];
		for (const e of chain.records.filter((r) => r.kind === "edit"))
		{
			const tip = ordered.at(-1);
			if (tip === undefined)
			{
				lost.push(e);
				continue;
			}
			if (recordStamp(e) < recordStamp(ordered[0]!))
			{
				chain.problems.push(`${chain.id}'s edit ${e.file} is stamped before its ${ordered[0]!.kind} ${ordered[0]!.file}`);
				lost.push(e);
				continue;
			}
			if (e.from === tip.hash)
			{
				ordered.push(e);
				continue;
			}
			// The newest edit already chained from the same body: the one this edit forks from.
			const twin = [...ordered].reverse().find((r) => r.kind === "edit" && r.from === e.from);
			chain.problems.push(twin
				? `${chain.id}'s text forks: ${twin.file} and ${e.file} both edit from ${e.from?.slice(0, 12)} (delete the unmerged one and re-run its audit.sh edit on top of stage)`
				: `${chain.id}'s edit ${e.file} chains from ${e.from?.slice(0, 12) ?? "nothing"}, which is not the body before it (a gap in the chain)`);
			lost.push(e);
		}
		chain.valid = ordered;
		chain.records = [...ordered, ...lost];
	}
	return byId;
}

/**
 * The newest body record of `id`: the tip of its valid chain, or undefined when it has none. With a
 * fork or gap that is still the valid chain's tip, never the forked edit, which `apply` refuses and
 * GitHub never carried (`audit.sh story` refuses a chain with problems before it snapshots).
 */
export function newestBody(records: TextRecord[], id: string): TextRecord | undefined
{
	const chain = chains(records).get(id);
	return chain?.valid.at(-1) ?? chain?.records[0];
}

/** A story's `/goal` line in its body (the first `/goal ` line inside a ```text block), or undefined. */
export function goalLine(body: string): string | undefined
{
	let inside = false;
	for (const line of lf(body).split("\n"))
	{
		if (line === "```text")
		{
			inside = true;
		}
		else if (inside && line.startsWith("```"))
		{
			inside = false;
		}
		else if (inside && line.startsWith("/goal "))
		{
			return line;
		}
	}
	return undefined;
}

/**
 * The tree-reproducible problems with the text records (law L9's first clause, the part `pnpm
 * backlog:check` holds at every commit): a stated hash that doesn't match its body, a story body
 * whose fields block is missing or doesn't parse (a bug's `create`/`migration` holds its fields block
 * alone), the chain problems of {@link chains}, a snapshot whose hash matches no record, and, once a
 * `migration` record exists, any note file left under the story or bug folders (`noteFiles`).
 */
export function textRecordProblems(records: TextRecord[], noteFiles: string[]): string[]
{
	const problems: string[] = [];
	for (const r of records)
	{
		if (sha256(r.body) !== r.hash)
		{
			problems.push(`${r.file}: its body's SHA-256 is ${sha256(r.body).slice(0, 12)}…, not the ${r.hash.slice(0, 12)}… it states`);
		}
		if (BODY_KINDS.includes(r.kind) && r.id.startsWith("B") && withoutFields(r.body).trim() !== "")
		{
			problems.push(`${r.file}: ${r.id}'s record holds more than its fields block (a bug's symptoms are its issue's, never recorded)`);
		}
		if (BODY_KINDS.includes(r.kind))
		{
			try
			{
				parseFields(r.body, `${r.id} (${r.file})`);
			}
			catch (error)
			{
				problems.push((error as Error).message);
			}
		}
	}
	for (const chain of chains(records).values())
	{
		problems.push(...chain.problems);
	}
	const bodies = new Set(records.filter((r) => BODY_KINDS.includes(r.kind)).map((r) => `${r.id} ${r.hash}`));
	for (const snap of records.filter((r) => r.kind === "snapshot"))
	{
		if (!bodies.has(`${snap.id} ${snap.hash}`))
		{
			problems.push(`${snap.file}: the snapshot's body matches none of ${snap.id}'s recorded bodies`);
		}
	}
	if (records.some((r) => r.kind === "migration"))
	{
		for (const note of noteFiles)
		{
			problems.push(`${note}: the stories and bugs were migrated to GitHub issues (S164), so no note belongs under docs/v3/backlog/stories/ or bugs/`);
		}
	}
	return problems;
}

/** Command-line flags: `--name value` pairs. */
function flags(argv: string[]): Record<string, string>
{
	const out: Record<string, string> = {};
	for (let k = 0; k < argv.length; k++)
	{
		if (argv[k]!.startsWith("--"))
		{
			out[argv[k]!.slice(2)] = argv[k + 1] ?? "";
			k++;
		}
	}
	return out;
}

const repoRoot = resolve(fileURLToPath(import.meta.url), "../../..");

/** The fragments folder audit.sh writes to (`BT_AUDIT_LEDGER`'s lower-case sibling). */
export function fragmentsDir(env: Record<string, string | undefined> = process.env): string
{
	const ledger = resolve(repoRoot, env.BT_AUDIT_LEDGER ?? "docs/v3/AUDIT.md");
	return join(ledger, "..", basename(ledger, ".md").toLowerCase());
}

/** The CLI audit.sh calls: `render` prints a record fragment, `newest` prints a body record. */
export function main(argv: string[]): string
{
	const [command, ...rest] = argv;
	if (command === "render")
	{
		const [kind, id, ...more] = rest;
		const f = flags(more);
		if (!(RECORD_KINDS as readonly string[]).includes(kind ?? "") || !id)
		{
			throw new RecordError("render <migration|create|edit|snapshot> <ID> …");
		}
		return renderRecord({
			kind: kind as RecordKind,
			id,
			date: f.date ?? f.stamp!.slice(0, 10),
			stamp: f.stamp ?? "",
			head: f.head ?? "",
			body: f["body-file"] ? readFileSync(f["body-file"], "utf8") : "",
			...(f.issue ? {
				issue: Number(f.issue),
			} : {}),
			...(f.base ? {
				base: f.base,
				baseLabel: f["base-label"] === "stage" ? "Read from stage" : "Base",
			} : {}),
			...(f.from ? {
				from: f.from,
			} : {}),
			...(f.title ? {
				title: f.title,
			} : {}),
			...(f.reason ? {
				reason: f.reason,
			} : {}),
			...(f.status ? {
				status: f.status,
			} : {}),
			...(f.record ? {
				record: f.record,
			} : {}),
			rewrites: f["rewrite-file"] ? readFileSync(f["rewrite-file"], "utf8").split("\n@@@@\n").filter(Boolean) : [],
		});
	}
	if (command === "newest")
	{
		const id = rest[0] ?? "";
		const records = readRecords(fragmentsDir());
		const tip = newestBody(records, id);
		if (!tip)
		{
			throw new RecordError(`${id} has no text record (run pnpm backlog:migrate, or scripts/audit.sh create ${id})`);
		}
		const f = flags(rest.slice(1));
		if (f.field === "hash")
		{
			return tip.hash;
		}
		if (f.field === "file")
		{
			return tip.file;
		}
		if (f.field === "issue")
		{
			return tip.issue === undefined ? "" : String(tip.issue);
		}
		if (f.field === "title")
		{
			return [...records].reverse().find((r) => r.id === id && r.title)?.title ?? "";
		}
		if (f.field === "design")
		{
			try
			{
				return parseFields(tip.body, id).design.join(",");
			}
			catch
			{
				return "";
			}
		}
		if (f.field === "problems")
		{
			return (chains(records).get(id)?.problems ?? []).join("\n");
		}
		return tip.body;
	}
	if (command === "changes")
	{
		// For the debt scripts (scripts/lib/story-notes.sh record_changes): one tab-separated line per text
		// record among the given fragment paths (repo-relative, the ones added since a review's base):
		//   A <id> <path>                   a story created
		//   R <id> <before path> <path>     a story's text edited (the record it chains from, then the edit)
		//   X <id> <path>                   a migration that rewrote the story's text (its diffs are in it)
		const dir = fragmentsDir();
		const all = readRecords(dir);
		const rel = (file: string) => `docs/v3/audit/${file}`;
		const lines: string[] = [];
		for (const path of rest)
		{
			const record = all.find((r) => rel(r.file) === path);
			if (!record || !record.id.startsWith("S"))
			{
				continue;
			}
			if (record.kind === "create")
			{
				lines.push(`A\t${record.id}\t${path}`);
			}
			else if (record.kind === "edit")
			{
				const before = all.find((r) => r.id === record.id && BODY_KINDS.includes(r.kind) && r.hash === record.from);
				lines.push(`R\t${record.id}\t${before ? rel(before.file) : ""}\t${path}`);
			}
			else if (record.kind === "migration" && record.rewrites.length > 0)
			{
				lines.push(`X\t${record.id}\t${path}`);
			}
		}
		return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
	}
	if (command === "fields")
	{
		// The `### Backlog fields` section of a body file, byte-exact, once it parses (audit.sh create B<N>).
		const text = readFileSync(rest[0] ?? "", "utf8");
		parseFields(text, rest[1] ?? rest[0] ?? "");
		const at = text.startsWith(`${FIELDS_HEADING}\n`) ? 0 : text.lastIndexOf(`\n${FIELDS_HEADING}\n`) + 1;
		return text.slice(at);
	}
	if (command === "body")
	{
		// A snapshot's (or any record's) body, refused when it doesn't hash to what its fragment states.
		const file = rest[0] ?? "";
		const record = parseRecord(readFileSync(file, "utf8"), basename(file));
		if (sha256(record.body) !== record.hash)
		{
			throw new RecordError(`${file}: its body does not hash to the ${record.hash.slice(0, 12)}… it states`);
		}
		return record.body;
	}
	throw new RecordError("usage: text-records.ts render … | newest <ID> [--field body|hash|file|issue|title|design|problems] | fields <file> [ID] | body <fragment>");
}

if (isRunDirectly(import.meta.url))
{
	try
	{
		process.stdout.write(main(process.argv.slice(2)));
	}
	catch (error)
	{
		console.error(`text-records: ${(error as Error).message}`);
		process.exitCode = 2;
	}
}
