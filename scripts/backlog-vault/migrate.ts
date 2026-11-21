/**
 * `pnpm backlog:migrate [--dry-run] [--reconcile] [--ref <ref>]` (S164 AC 4): one GitHub issue per
 * story note, each bug note folded into its issue, idempotently (owner, 2026-11-20: "Old completed
 * stories should be added for historicity, with their details recorded. I want to make sure that's
 * searchable", and "Make sure the old completed stories are marked as closed").
 *
 * It is the one exception to record-first: it writes to GitHub (through github.ts), then records the
 * body GitHub returned with `scripts/audit.sh migration` (rule 13: fragments come from audit.sh).
 *
 *   - It finds an issue it already made by the trusted-ID rules and brings it into line (body, title,
 *     labels, state), so a run stopped between creating and closing an issue finishes the job, and a
 *     run stopped after any number of issues resumes with no duplicates. A secondary rate limit is
 *     waited out (github.ts request).
 *   - A `done` story's body gains a `### Shipped` section: its shipping commit (reverify.sh
 *     shipping_commit), the pull request that merged it ("pushed directly, before S121" when none),
 *     and links at that commit to its ledger entry, grader and changelog entry; it is closed
 *     `completed` with `status:done`. A `superseded` story is closed `not_planned`.
 *   - An open story's Status criterion is rewritten to read its ship-time snapshot
 *     (`story_snapshot_status`), and its `/goal` line's note path becomes the bare `S<N>`; each
 *     rewrite's diff is recorded in its migration fragment (an `ac-rewritten` event for the next review).
 *   - A bug note's priority goes into its issue's fields block and its status into its labels; the
 *     symptoms stay as they are, and only the fields block is recorded.
 *
 * `--reconcile` (run again right before S164's pull request merges) reads the notes on `--ref`
 * (default origin/stage), but only those that changed on stage since the merge-base of the migration's
 * base and stage ({@link ReconcileView}); every other note is as the migration recorded it. Each such
 * note is compared with its newest text record (rebuilt at that record's own base, so links never
 * differ by commit alone): a changed body becomes an `edit` built and recorded at the stage commit
 * (sent, with its `Applied` comment), a status that differs between the merge-base and stage is set
 * on GitHub directly, a new note becomes a `create` made live as the migration is, and a note deleted
 * on stage is printed and left alone. It refuses an ID the branch itself changed (S164's own note), a
 * HEAD that doesn't contain the stage commit (merge stage in first, so shipping_commit sees stage's
 * fragments), and a stage that already holds a migration fragment (S164 merged). A second run with
 * nothing new records and sends nothing. `--dry-run` reads GitHub (when it can) and prints the plan,
 * changing nothing on GitHub and recording nothing.
 */

import { execFileSync, spawnSync } from "node:child_process";
import {
	mkdtempSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import {
	join, posix, resolve,
} from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import type {
	CachedIssue, GhRunner, IssueCache, Sleep,
} from "./github.ts";
import {
	appliedComment, createIssue, findIssue, ghRunner, patchIssue, postComment, sleepSync, stateFor, syncIssues, trustedId,
} from "./github.ts";
import { readLedger } from "./ledger.ts";
import type { BacklogFields, TextRecord } from "./text-records.ts";
import {
	fragmentsDir, lf, newestBody, readRecords, renderFields, sha256, withoutFields,
} from "./text-records.ts";

/** One story or bug note, as the migration reads it. */
export interface NoteItem
{
	id: string;
	kind: "story" | "bug";
	status: string;
	path: string;
	frontmatter: Record<string, unknown>;
	body: string;
}

/** The story and bug notes among `notes` (paths relative to the repository: docs/v3/backlog/stories/<status>/S<N>.md, …/bugs/<status>/B<N>.md). */
export function noteItems(notes: Map<string, string>): NoteItem[]
{
	const items: NoteItem[] = [];
	for (const [path, text] of notes)
	{
		const m = /backlog\/(stories|bugs)\/(?:[^/]+\/)?([SB]\d+)\.md$/.exec(path);
		if (!m)
		{
			continue;
		}
		const fm = /^---\n([\s\S]*?)\n---\n/.exec(text);
		const frontmatter = (fm ? parseYaml(fm[1]!) : {}) as Record<string, unknown>;
		items.push({
			id: m[2]!,
			kind: m[1] === "stories" ? "story" : "bug",
			status: String(frontmatter.status ?? "todo"),
			path,
			frontmatter,
			body: (fm ? text.slice(fm[0].length) : text).replace(/^\n+/, ""),
		});
	}
	const n = (id: string) => Number(id.slice(1));
	return items.sort((a, b) => (a.kind === b.kind ? n(a.id) - n(b.id) : a.kind === "story" ? -1 : 1));
}

const OPEN = new Set(["todo", "doing", "blocked"]);

/** A wiki link's target (`[[S163]]` → `S163`). */
const unlink = (v: unknown) => String(v).replace(/^\[\[(.*)\]\]$/, "$1");
const strings = (v: unknown) => (Array.isArray(v) ? v.map(unlink) : []);

/** A story note's frontmatter as its issue's fields block. */
export function storyFields(fm: Record<string, unknown>): Partial<BacklogFields>
{
	return {
		priority: Number(fm.priority),
		depends_on: strings(fm.depends_on),
		prefer_after: strings(fm.prefer_after),
		design: strings(fm.design),
		source: typeof fm.source === "string" ? fm.source : null,
		turn_cap: typeof fm.turn_cap === "number" ? fm.turn_cap : null,
		scope_files: strings(fm.scope_files),
	};
}

/** The Status criterion every open story carries before S164, and what it reads after. */
const STATUS_BEFORE = " (its note's frontmatter `status`, the note in `docs/v3/backlog/stories/done/`)";
const STATUS_AFTER = ": its snapshot records `done`, the status it ships with, written by `audit.sh story` (`story_snapshot_status`)";

/**
 * An open story's rewrites: its Status criterion reads its ship-time snapshot, and its `/goal` line
 * names the bare `S<N>` instead of its note's path. Returns the new body and one diff per changed
 * line; `unshipped` names a grader that exists but hasn't shipped, which the migration leaves alone.
 */
export function rewriteOpen(id: string, body: string, unshipped?: string): { body: string;
	diffs: string[] }
{
	const diffs: string[] = [];
	const lines = body.split("\n").map((line) =>
	{
		let next = line.split(STATUS_BEFORE).join(STATUS_AFTER);
		next = next.replace(new RegExp(`^/goal ${id} \\(docs/v3/backlog/stories/[^)]*/${id}\\.md\\)`), `/goal ${id} (${id})`);
		if (next !== line)
		{
			diffs.push(`-${line}\n+${next}`);
		}
		return next;
	});
	if (unshipped && diffs.length > 0)
	{
		diffs[diffs.length - 1] += `\n# ${unshipped} exists but hasn't shipped: the migration leaves it alone, and ${id} updates it under rule 7, red first.`;
	}
	return {
		body: lines.join("\n"),
		diffs,
	};
}

/** What a finished story's `### Shipped` section links to, all at its shipping commit. */
export interface Shipped
{
	commit?: string;
	/** The pull request that merged it, or undefined when it was pushed directly (before S121). */
	pr?: number;
	/** Its ledger entry when it is a fragment: the path under docs/v3/. */
	ledger?: string;
	/** Its ledger entry when it is in the frozen docs/v3/AUDIT.md: the entry's line in that file. */
	frozenLine?: number;
	grader?: string;
	changelog?: string;
}

/**
 * A done story's `### Shipped` section: the commit, fragment, grader and changelog links at its
 * shipping commit in `repo`. An entry in the frozen AUDIT.md is linked at `base`, the commit the
 * migration read, as plain text (`?plain=1`, so `#L<line>` jumps to the line): its line number is
 * a line of today's file, and at the shipping commit the entry is often not in the file yet.
 */
export function shippedSection(s: Shipped, repo: string, base: string): string
{
	const at = (path: string) => `[\`${path.replace(/#.*$/, "")}\`](https://github.com/${repo}/blob/${s.commit}/${path})`;
	const lines = ["### Shipped", ""];
	if (!s.commit)
	{
		lines.push("- **Shipping commit:** not recorded in the ledger");
		return `${lines.join("\n")}\n`;
	}
	lines.push(`- **Shipping commit:** [\`${s.commit.slice(0, 8)}\`](https://github.com/${repo}/commit/${s.commit})`);
	lines.push(`- **Pull request:** ${s.pr === undefined ? "pushed directly, before S121" : `#${s.pr}`}`);
	const frozen = s.frozenLine === undefined ? undefined
		: `[\`docs/v3/AUDIT.md\` line ${s.frozenLine}](https://github.com/${repo}/blob/${base}/docs/v3/AUDIT.md?plain=1#L${s.frozenLine})`;
	lines.push(`- **Ledger entry:** ${s.ledger ? at(s.ledger) : frozen ?? "none"}`);
	lines.push(`- **Grader:** ${s.grader ? at(s.grader) : "none"}`);
	lines.push(`- **Changelog:** ${s.changelog ? at(s.changelog) : "none (shipped before changelog fragments)"}`);
	return `${lines.join("\n")}\n`;
}

/** What the migration wants an item's issue to be. */
export interface Desired
{
	id: string;
	kind: "story" | "bug";
	status: string;
	title?: string;
	body: string;
	/** For a bug: the fields section alone, which is what gets recorded. */
	fields?: string;
	labels: string[];
	state: string;
	state_reason?: string;
	rewrites: string[];
}

/**
 * A story body's relative Markdown links (`./VISUAL-DESIGN.md#videos`, written for docs/v3/, where the
 * backlog text was read) as links to that file at `base`, anchors kept, so they still work in an
 * issue. Absolute URLs, `#anchors`, `/paths` and wiki links are left alone.
 */
export function absoluteLinks(body: string, repo: string, base: string): string
{
	return body.replace(/\]\(([^)\s]+)\)/g, (whole, target: string) =>
	{
		if (/^([a-z][a-z0-9+.-]*:|#|\/)/i.test(target))
		{
			return whole;
		}
		const [path, anchor] = target.split(/(?=#)/);
		return `](https://github.com/${repo}/blob/${base}/${posix.normalize(posix.join("docs/v3", path!))}${anchor ?? ""})`;
	});
}

/** GitHub caps an issue title at 256 characters. */
const titleOf = (id: string, title: string) => `${id}: ${title}`.slice(0, 256);

/** The issue a note becomes. `live` is a bug's current issue (its symptoms stay). */
export function desiredFor(item: NoteItem, ctx: { shipped: (id: string) => Shipped;
	repo: string;
	base: string;
	unshipped: (id: string) => string | undefined; }, live?: CachedIssue): Desired
{
	const status = item.status;
	if (item.kind === "bug")
	{
		const fields = renderFields({
			priority: Number(item.frontmatter.priority),
		});
		// Trailing whitespace trimmed, as github.ts targetBody does, so a re-run finds the body already in line.
		const symptoms = withoutFields(live?.body ?? "").replace(/\s+$/, "");
		const keep = (live?.labels ?? []).map((l) => l.name).filter((l) => !l.startsWith("status:") && l !== "bug");
		const closing = status === "done" || status === "superseded";
		return {
			id: item.id,
			kind: "bug",
			status,
			body: `${symptoms === "" ? "" : `${symptoms}\n\n`}${fields}`,
			fields,
			labels: ["bug", ...keep, `status:${status}`],
			...(closing ? stateFor(status) : {
				state: live?.state ?? "open",
			}),
			rewrites: [],
		};
	}
	let text = absoluteLinks(item.body.replace(/\s+$/, ""), ctx.repo, ctx.base);
	let rewrites: string[] = [];
	if (OPEN.has(status))
	{
		const r = rewriteOpen(item.id, text, ctx.unshipped(item.id));
		text = r.body;
		rewrites = r.diffs;
	}
	const sections = [text];
	if (status === "done")
	{
		sections.push(shippedSection(ctx.shipped(item.id), ctx.repo, ctx.base).replace(/\n$/, ""));
	}
	sections.push(renderFields(storyFields(item.frontmatter)));
	return {
		id: item.id,
		kind: "story",
		status,
		title: titleOf(item.id, String(item.frontmatter.title ?? item.frontmatter.table_title ?? item.id)),
		body: sections.join("\n\n"),
		labels: ["story", `status:${status}`],
		...stateFor(status),
		rewrites,
	};
}

/** A text record the migration asks audit.sh to write. */
export interface RecordRequest
{
	kind: "migration" | "create" | "edit";
	id: string;
	issue: number;
	base: string;
	/** True when `base` is the `stage` commit a reconcile read. */
	stage: boolean;
	body: string;
	title?: string;
	reason?: string;
	rewrites: string[];
}

/** What the migration reaches outside its own logic: injected so tests use a fake GitHub and no audit.sh. */
export interface MigrateIO
{
	run: GhRunner;
	sleep: Sleep;
	/** pnpm backlog:sync: the issues as GitHub has them now. */
	sync(): IssueCache;
	/** The text records already in the tree. */
	recorded(): TextRecord[];
	/** Writes one text record (scripts/audit.sh). */
	record(request: RecordRequest): void;
	shipped(id: string): Shipped;
	unshipped(id: string): string | undefined;
	repo: string;
	log(line: string): void;
	/** A recorded (short) base as the full commit the bodies' links name; identity when absent. */
	resolve?(ref: string): string;
}

/**
 * What `--reconcile` reads from git about stage and the branch (injected, so tests need no history).
 * The merge-base is that of the migration's base (its `kind=migration` records' Base) and stage.
 */
export interface ReconcileView
{
	/** `git diff --name-status --no-renames <merge-base> <stage>` over the note folders: each changed note path and its letter. */
	changed: { letter: string;
		path: string }[];
	/** The IDs whose notes the branch itself changed between the merge-base and the migration's base (S164's own note). */
	branchChanged: string[];
	/** Each note's status at the merge-base, by ID. */
	baseStatus: Map<string, string>;
	/** Whether HEAD contains the stage commit. */
	headContainsStage: boolean;
	/** Whether stage already holds a migration fragment (S164 merged). */
	stageMigrated: boolean;
}

/** A run's tally. */
export interface Summary
{
	created: string[];
	updated: string[];
	unchanged: string[];
	recorded: string[];
	rewritten: string[];
	missing: string[];
	edits: string[];
	/** Notes deleted on stage since the merge-base: printed, nothing sent. */
	deleted: string[];
	/** IDs the branch itself changed: never touched by a reconcile. */
	refused: string[];
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join("\n") === [...b].sort().join("\n");

/**
 * The PATCH that brings `issue` into line with `want`, or undefined when it already is. A CRLF copy
 * of the body still differs, so it is PATCHed to the LF body that gets recorded. `stateToo` false
 * leaves labels and state alone (a reconcile whose note's status didn't change).
 */
function difference(issue: CachedIssue, want: Desired, bodyToo: boolean, stateToo = true): Parameters<typeof patchIssue>[2] | undefined
{
	const change: Parameters<typeof patchIssue>[2] = {};
	if (bodyToo && (issue.body ?? "") !== want.body)
	{
		change.body = want.body;
	}
	if (want.title !== undefined && issue.title !== want.title)
	{
		change.title = want.title;
	}
	if (stateToo && !sameSet(issue.labels.map((l) => l.name), want.labels))
	{
		change.labels = want.labels;
	}
	if (stateToo && (issue.state !== want.state || (want.state_reason !== undefined && issue.state_reason !== want.state_reason)))
	{
		change.state = want.state;
		if (want.state_reason !== undefined)
		{
			change.state_reason = want.state_reason;
		}
	}
	return Object.keys(change).length === 0 ? undefined : change;
}

/** The ID a note path names (`…/S12.md` → `S12`), or undefined. */
const noteId = (path: string) => /\/([SB]\d+)\.md$/.exec(path)?.[1];

/**
 * Migrates (or, with `reconcile`, reconciles) the notes in `notes`, read at commit `base`. Returns the
 * tally; with `dryRun` nothing is sent or recorded and the tally says what would be.
 */
export function migrate(notes: Map<string, string>, base: string, io: MigrateIO, opts: { dryRun?: boolean;
	reconcile?: ReconcileView } = {}): Summary
{
	const summary: Summary = {
		created: [],
		updated: [],
		unchanged: [],
		recorded: [],
		rewritten: [],
		missing: [],
		edits: [],
		deleted: [],
		refused: [],
	};
	const view = opts.reconcile;
	let items = noteItems(notes);
	if (view)
	{
		if (view.stageMigrated)
		{
			throw new Error("stage already holds a migration fragment (S164 merged): there are no notes on stage to reconcile");
		}
		if (!view.headContainsStage)
		{
			throw new Error(`HEAD does not contain ${base}: merge stage into this branch first, so shipping_commit sees stage's ledger fragments`);
		}
		const inScope = new Set(view.changed.map((c) => noteId(c.path)).filter((id): id is string => id !== undefined));
		for (const id of [...inScope].sort())
		{
			if (view.branchChanged.includes(id))
			{
				inScope.delete(id);
				summary.refused.push(id);
				io.log(`${id}: refused — this branch changed its note too, so stage's copy is stale for it; reconcile it by hand`);
			}
			else if (!items.some((i) => i.id === id))
			{
				inScope.delete(id);
				summary.deleted.push(id);
				io.log(`${id}: its note was deleted on stage; nothing sent (close or retitle its issue by hand if it should go)`);
			}
		}
		items = items.filter((i) => inScope.has(i.id));
	}
	const cache = io.sync();
	const records = io.recorded();
	const resolveRef = (ref: string) => io.resolve?.(ref) ?? ref;
	const writer = {
		run: io.run,
		sleep: io.sleep,
	};
	// Writes are paced, one second apart, to stay clear of GitHub's secondary rate limit.
	let wrote = false;
	const pace = () =>
	{
		if (wrote)
		{
			io.sleep(1000);
		}
		wrote = true;
	};
	for (const item of items)
	{
		const existing = item.kind === "story" ? findIssue(cache, item.id) : cache.issues.find((i) => i.number === Number(item.id.slice(1)));
		if (item.kind === "bug" && !existing)
		{
			summary.missing.push(item.id);
			io.log(`${item.id}: no issue #${item.id.slice(1)} on GitHub to fold its note into; skipped`);
			continue;
		}
		const want = desiredFor(item, {
			...io,
			base,
		}, existing);
		const checked = (written: CachedIssue): CachedIssue =>
		{
			if (trustedId(written, cache.trusted) !== item.id)
			{
				throw new Error(`${item.id}: issue #${written.number} as GitHub returned it carries no trusted ID ${item.id} (labels ${written.labels.map((l) => l.name).join(", ") || "none"}); fix it on GitHub before re-running, or the next run makes a duplicate`);
			}
			return written;
		};
		const newest = newestBody(records, item.id);
		const textOf = (d: Desired) => (item.kind === "bug" ? d.fields! : d.body);
		// A reconcile compares the note with its newest record rebuilt at that record's own base, so a
		// body whose links name another commit is not a change; the migration compares at `base` itself.
		const asRecorded = view && newest?.base !== undefined ? desiredFor(item, {
			...io,
			base: resolveRef(newest.base),
		}, existing) : want;
		const textChanged = newest !== undefined && newest.hash !== sha256(textOf(asRecorded));
		if (want.rewrites.length > 0 && newest === undefined)
		{
			summary.rewritten.push(item.id);
		}
		// A reconcile changes the body of an already recorded item only when its text changed (an edit),
		// and its labels and state only when its status differs between the merge-base and stage.
		const bodyToo = !view || newest === undefined || textChanged;
		const stateToo = !view || newest === undefined || view.baseStatus.get(item.id) !== item.status;
		let issue = existing;
		if (!issue)
		{
			summary.created.push(item.id);
			io.log(`${item.id}: create "${want.title!.slice(0, 70)}" (${want.status})`);
			if (!opts.dryRun)
			{
				pace();
				issue = checked(createIssue(writer, want.title!, want.body, want.labels));
			}
		}
		const change = issue ? difference(issue, want, bodyToo, stateToo) : undefined;
		if (issue && change)
		{
			if (existing)
			{
				summary.updated.push(item.id);
				io.log(`${item.id}: bring #${issue.number} into line (${Object.keys(change).join(", ")})`);
			}
			if (!opts.dryRun)
			{
				pace();
				issue = checked(patchIssue(writer, issue.number, change));
			}
		}
		else if (existing)
		{
			summary.unchanged.push(item.id);
		}
		if (newest !== undefined && !textChanged)
		{
			continue;
		}
		const kind = newest === undefined ? (view ? "create" : "migration") : "edit";
		if (kind === "edit")
		{
			summary.edits.push(item.id);
		}
		summary.recorded.push(`${item.id} ${kind}`);
		if (opts.dryRun || !issue)
		{
			continue;
		}
		// What GitHub returned, with any CRLF made LF (the PATCH above already sent the LF body).
		const returned = lf(issue.body ?? "");
		const body = item.kind === "bug" ? returned.slice(returned.lastIndexOf("### Backlog fields\n")) : returned;
		io.record({
			kind,
			id: item.id,
			issue: issue.number,
			base,
			stage: view !== undefined,
			body,
			...(want.title ? {
				title: want.title.replace(/^S\d+: /, ""),
			} : {}),
			...(kind === "migration" ? {} : {
				reason: view ? `reconcile: the note on stage ${kind === "create" ? "is new" : "changed"} since the migration` : "migration",
			}),
			rewrites: want.rewrites,
		});
		if (kind === "edit")
		{
			// Sent live already, so apply must skip it: the same trusted comment apply would post, keyed to the record just written.
			const written = newestBody(io.recorded(), item.id)!;
			pace();
			postComment(writer, issue.number, appliedComment(written));
		}
	}
	return summary;
}

/** The tally as the CLI prints it. */
export function summaryText(s: Summary, dryRun: boolean): string
{
	const head = dryRun ? "backlog:migrate --dry-run (nothing sent, nothing recorded)" : "backlog:migrate";
	const line = (label: string, ids: string[]) => `${label}: ${ids.length}${ids.length > 0 ? ` (${ids.slice(0, 12).join(", ")}${ids.length > 12 ? ", …" : ""})` : ""}`;
	return [head, line("issues to create", s.created), line("issues brought into line", s.updated), line("already in line", s.unchanged),
		line("records", s.recorded), line("open stories rewritten", s.rewritten), line("edits", s.edits), line("bug notes with no issue", s.missing),
		line("notes deleted on stage (nothing sent)", s.deleted), line("refused (changed on this branch too)", s.refused)].join("\n");
}

const repoRoot = resolve(fileURLToPath(import.meta.url), "../../..");

function git(args: string[], input?: string): string
{
	return execFileSync("git", args, {
		cwd: repoRoot,
		encoding: "utf8",
		maxBuffer: 512 * 1024 * 1024,
		...(input === undefined ? {} : {
			input,
		}),
	});
}

/** The story and bug notes at `ref`, path → text, read with one `git cat-file --batch`. */
export function notesAt(ref: string): Map<string, string>
{
	const paths = git(["ls-tree", "-r", "--name-only", ref, "--", "docs/v3/backlog/stories", "docs/v3/backlog/bugs"]).split("\n").filter((p) => /\/[SB]\d+\.md$/.test(p));
	const out = git(["cat-file", "--batch"], paths.map((p) => `${ref}:${p}`).join("\n") + "\n");
	const notes = new Map<string, string>();
	let at = 0;
	for (const path of paths)
	{
		const header = out.slice(at, out.indexOf("\n", at));
		const size = Number(header.split(" ")[2]);
		const start = out.indexOf("\n", at) + 1;
		const bytes = Buffer.from(out.slice(start), "utf8").subarray(0, size).toString("utf8");
		notes.set(path, bytes);
		at = start + bytes.length + 1;
	}
	return notes;
}

/** The repository's `owner/name`, from origin's URL (no network). */
function originRepo(): string
{
	const url = git(["remote", "get-url", "origin"]).trim();
	return /github\.com[:/](.+?)(\.git)?$/.exec(url)?.[1] ?? url;
}

/** The real lookups for `### Shipped`: shipping commits, the pull request each merged in, ledger links, and what exists at each commit. */
function realShipped(): (id: string) => Shipped
{
	const prOf = new Map<string, number>();
	for (const line of git(["log", "--first-parent", "--merges", "--reverse", "--format=%H %P%x09%s", "origin/stage"]).split("\n").filter(Boolean))
	{
		const [shas, subject] = line.split("\t");
		const [, p1, p2] = shas!.split(" ");
		const pr = /Merge pull request #(\d+)/.exec(subject ?? "")?.[1];
		if (!pr || !p2)
		{
			continue;
		}
		for (const c of git(["rev-list", `${p1}..${p2}`]).split("\n").filter(Boolean))
		{
			if (!prOf.has(c))
			{
				prOf.set(c, Number(pr));
			}
		}
	}
	const ledger = readLedger(join(repoRoot, "docs/v3/AUDIT.md"));
	return (id) =>
	{
		const short = spawnSync("bash", ["-c", `source scripts/lib/reverify.sh; shipping_commit docs/v3/AUDIT.md ${id}`], {
			cwd: repoRoot,
			encoding: "utf8",
		}).stdout.trim();
		if (!short)
		{
			return {};
		}
		const commit = git(["rev-parse", short]).trim();
		const entry = [...ledger].reverse().find((e) => e.story === id && (e.kind === "completed" || e.kind === "backfill"));
		const there = git(["ls-tree", "-r", "--name-only", commit, "--", `scripts/verify-${id}.sh`, `changelog.d/${id}.md`]).split("\n");
		return {
			commit,
			...(prOf.has(commit) ? {
				pr: prOf.get(commit)!,
			} : {}),
			...(entry?.file ? {
				ledger: `docs/v3/${entry.file}`,
			} : {}),
			...(entry && !entry.file ? {
				frozenLine: entry.line,
			} : {}),
			...(there.includes(`scripts/verify-${id}.sh`) ? {
				grader: `scripts/verify-${id}.sh`,
			} : {}),
			...(there.includes(`changelog.d/${id}.md`) ? {
				changelog: `changelog.d/${id}.md`,
			} : {}),
		};
	};
}

/** Writes a record through scripts/audit.sh, the only writer of ledger fragments (rule 13). */
function auditRecord(r: RecordRequest): void
{
	const dir = mkdtempSync(join(tmpdir(), `migrate-${r.id}-`));
	try
	{
		writeFileSync(join(dir, "body.md"), r.body);
		const args = [r.kind, r.id, "--issue", String(r.issue), r.stage ? "--stage" : "--base", r.base, "--body-file", join(dir, "body.md")];
		if (r.title)
		{
			args.push("--title", r.title);
		}
		if (r.reason)
		{
			args.push("--reason", r.reason);
		}
		if (r.rewrites.length > 0)
		{
			writeFileSync(join(dir, "rewrite.diff"), r.rewrites.join("\n@@@@\n"));
			args.push("--rewrite-file", join(dir, "rewrite.diff"));
		}
		const run = spawnSync("bash", [join(repoRoot, "scripts/audit.sh"), ...args], {
			cwd: repoRoot,
			encoding: "utf8",
		});
		if (run.status !== 0)
		{
			throw new Error(`audit.sh ${args.slice(0, 2).join(" ")} failed: ${run.stderr}`);
		}
	}
	finally
	{
		rmSync(dir, {
			recursive: true,
			force: true,
		});
	}
}

/** The real dependencies. `dryRun` tolerates an unreachable GitHub (an empty issue list, said so). */
export function realIO(dryRun: boolean): MigrateIO
{
	return {
		run: ghRunner,
		sleep: sleepSync,
		sync: () =>
		{
			try
			{
				return syncIssues(repoRoot).cache;
			}
			catch (error)
			{
				if (!dryRun)
				{
					throw error;
				}
				console.log(`(GitHub not reachable: ${(error as Error).message.split("\n")[0]}; planning against no existing issues)`);
				return {
					repo: originRepo(),
					trusted: [],
					syncedAt: new Date(0).toISOString(),
					issues: [],
				};
			}
		},
		recorded: () => readRecords(fragmentsDir()),
		record: auditRecord,
		shipped: realShipped(),
		unshipped: (id) =>
		{
			const grader = `scripts/verify-${id}.sh`;
			const shipped = spawnSync("bash", ["-c", `source scripts/lib/reverify.sh; shipping_commit docs/v3/AUDIT.md ${id}`], {
				cwd: repoRoot,
				encoding: "utf8",
			}).stdout.trim();
			return !shipped && spawnSync("test", ["-f", join(repoRoot, grader)]).status === 0 ? grader : undefined;
		},
		repo: originRepo(),
		log: (line) => console.log(line),
		resolve: (ref) => git(["rev-parse", ref]).trim(),
	};
}

/** The note folders a reconcile diffs. */
const NOTE_DIRS = ["docs/v3/backlog/stories", "docs/v3/backlog/bugs"];

/**
 * What git says about stage and this branch, for `--reconcile` ({@link ReconcileView}). The merge-base
 * is that of the migration's base (the `kind=migration` records' Base, which never moves) and stage.
 */
export function realView(stage: string, records: TextRecord[]): ReconcileView
{
	const bases = [...new Set(records.filter((r) => r.kind === "migration" && r.base).map((r) => r.base!))];
	if (bases.length !== 1)
	{
		throw new Error(`--reconcile needs the migration's one base, but the migration records name ${bases.length === 0 ? "none" : bases.join(", ")}`);
	}
	const migrationBase = git(["rev-parse", bases[0]!]).trim();
	const mergeBase = git(["merge-base", migrationBase, stage]).trim();
	const ids = (text: string) => text.split("\n").map(noteId).filter((id): id is string => id !== undefined);
	const baseStatus = new Map(noteItems(notesAt(mergeBase)).map((i) => [i.id, i.status]));
	return {
		changed: git(["diff", "--name-status", "--no-renames", mergeBase, stage, "--", ...NOTE_DIRS]).split("\n").filter(Boolean).map((line) =>
		{
			const [letter, path] = line.split("\t");
			return {
				letter: letter!,
				path: path!,
			};
		}),
		branchChanged: [...new Set(ids(git(["diff", "--name-only", "--no-renames", mergeBase, migrationBase, "--", ...NOTE_DIRS])))],
		baseStatus,
		headContainsStage: spawnSync("git", ["merge-base", "--is-ancestor", stage, "HEAD"], {
			cwd: repoRoot,
		}).status === 0,
		stageMigrated: git(["ls-tree", "-r", "--name-only", stage, "--", "docs/v3/audit"]).split("\n").some((p) => p.endsWith("-migration.md")),
	};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
{
	try
	{
		const argv = process.argv.slice(2);
		const dryRun = argv.includes("--dry-run");
		const reconcile = argv.includes("--reconcile");
		const at = argv.indexOf("--ref");
		const ref = at === -1 ? (reconcile ? "origin/stage" : "HEAD") : argv[at + 1]!;
		const base = git(["rev-parse", ref]).trim();
		const io = realIO(dryRun);
		const summary = migrate(notesAt(base), base, io, {
			dryRun,
			...(reconcile ? {
				reconcile: realView(base, io.recorded()),
			} : {}),
		});
		console.log(summaryText(summary, dryRun));
	}
	catch (error)
	{
		console.error(`backlog:migrate: ${(error as Error).message}`);
		process.exitCode = 1;
	}
}
