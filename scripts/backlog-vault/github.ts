/**
 * The one module that talks to GitHub about backlog items (S164; owner, 2026-11-20: "It seems like
 * having all stories and bugs in GitHub issues would be useful", and "GitHub owns state
 * (Recommended)"). Every call goes through REST with `gh api` (Claude Code sessions reach only GitHub's REST
 * API, and GitHub Projects' custom fields aren't in it, so an item's fields live in its body), and
 * through an injected {@link GhRunner}, so tests never reach GitHub:
 *
 *   GET   repos/<repo>/issues?state=all&since=…&per_page=100   (every page the Link header names)
 *   GET   repos/<repo>/issues/<n>
 *   POST  repos/<repo>/issues
 *   PATCH repos/<repo>/issues/<n>            body, state, state_reason, labels, milestone
 *   POST  repos/<repo>/issues/<n>/comments   and GET the same: the `Applied` comments
 *   GET   repos/<repo>/milestones?state=all
 *
 * Commands (`node scripts/backlog-vault/github.ts …`):
 *
 *   sync [--full]                 pnpm backlog:sync: read the issues into the main checkout's
 *                                 .backlog-cache/issues.json (only reads GitHub)
 *   item <ID> [--field goal|body] an item from the cache (scripts/goal.sh reads its /goal line)
 *   status <ID> <todo|doing|blocked|done|superseded>   the coordinator changes state on GitHub
 *   label <ID> [--add <l>]… [--remove <l>]…
 *   milestone <ID> <title|none>
 *   apply                         scripts/audit.sh apply: send recorded creates and edits (AC 6)
 *
 * State commands are logged in the run journal or the coordinator's output, never the ledger: only
 * story text is recorded (text-records.ts). With no cache, the readers of "now" exit 2 and say to
 * run `pnpm backlog:sync`.
 */

import { execFileSync } from "node:child_process";
import {
	existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync,
} from "node:fs";
import {
	dirname, join, resolve,
} from "node:path";
import { fileURLToPath } from "node:url";
import type { BacklogItem, BacklogSource } from "./search.ts";
import type { TextRecord } from "./text-records.ts";
import {
	chains, fieldsYaml, fragmentsDir, goalLine, parseFields, readRecords, sha256, withoutFields,
} from "./text-records.ts";

/** Runs `gh` with these arguments and returns its stdout (with `-i`, the status line and headers first); injected so tests never reach GitHub. */
export type GhRunner = (args: string[]) => string;

/** The real runner: `gh` itself. A failing exit still returns stdout, whose status line says what failed (a 404, a rate limit). */
export const ghRunner: GhRunner = (args) =>
{
	try
	{
		return execFileSync("gh", args, {
			encoding: "utf8",
			maxBuffer: 256 * 1024 * 1024,
			stdio: ["ignore", "pipe", "pipe"],
		});
	}
	catch (error)
	{
		const out = (error as { stdout?: string }).stdout;
		if (typeof out === "string" && /^HTTP\/\S+ \d{3}/.test(out))
		{
			return out;
		}
		throw error;
	}
};

/** A REST response: its status (0 when the output had no status line), headers and body. */
export interface Response
{
	status: number;
	headers: string;
	body: string;
}

/** `gh api -i` output: the status line and headers, then a blank line, then the JSON body. */
export function parseResponse(raw: string): Response
{
	const at = raw.search(/\r?\n\r?\n/);
	const headers = at === -1 ? "" : raw.slice(0, at);
	const body = at === -1 ? raw : raw.slice(at).replace(/^\r?\n\r?\n/, "");
	const status = Number(/^HTTP\/\S+ (\d{3})/.exec(headers)?.[1] ?? 0);
	return {
		status,
		headers,
		body,
	};
}

/** The `rel="next"` page of a `Link` header, as a path `gh api` takes, or undefined on the last page. */
export function nextPage(headers: string): string | undefined
{
	const link = /^link:\s*(.+)$/im.exec(headers)?.[1] ?? "";
	const url = /<([^>]+)>;\s*rel="next"/.exec(link)?.[1];
	return url?.replace(/^https:\/\/api\.github\.com\//, "");
}

/** Waits `ms` milliseconds; injected so a rate-limit test doesn't sleep. */
export type Sleep = (ms: number) => void;

/** The real wait: a blocking sleep (the migration is a sequential script). */
export const sleepSync: Sleep = (ms) =>
{
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

/** How long a secondary rate limit asks to wait, or undefined when the response isn't one. */
export function rateLimitWait(response: Response): number | undefined
{
	if (response.status !== 403 && response.status !== 429)
	{
		return undefined;
	}
	const after = /^retry-after:\s*(\d+)/im.exec(response.headers)?.[1];
	if (after !== undefined)
	{
		return Number(after) * 1000;
	}
	return /secondary rate limit/i.test(response.body) ? 60_000 : undefined;
}

/** A failed call: names the method, path and status. */
export class GithubError extends Error
{
	override name = "GithubError";
	readonly status: number;
	constructor(message: string, status = 0)
	{
		super(message);
		this.status = status;
	}
}

/** One field for `gh api`: `-f` sends a string, `-F` a typed value (number, null). */
export type Field = [name: string, value: string | number | null];

/**
 * One REST call through `gh api -i`. A secondary rate limit (`retry-after`, or a 403 naming it) is
 * waited out and the same call made again, so a long run resumes where it stopped.
 */
export function request(run: GhRunner, method: string, path: string, fields: Field[] = [], sleep: Sleep = sleepSync): Response
{
	// GET is gh's default with no fields: the plain `gh api -i <path>` S163's issues query always ran.
	const args = method === "GET" ? ["api", "-i", path] : ["api", "-i", "-X", method, path];
	for (const [name, value] of fields)
	{
		args.push(typeof value === "string" ? "-f" : "-F", `${name}=${value === null ? "null" : value}`);
	}
	for (;;)
	{
		const response = parseResponse(run(args));
		const wait = rateLimitWait(response);
		if (wait === undefined)
		{
			return response;
		}
		sleep(wait);
	}
}

/** A call that must succeed (2xx): its JSON body, else a {@link GithubError}. */
function ok<T>(response: Response, what: string): T
{
	if (response.status !== 0 && (response.status < 200 || response.status > 299))
	{
		throw new GithubError(`${what}: HTTP ${response.status} ${response.body.slice(0, 200)}`, response.status);
	}
	return JSON.parse(response.body === "" ? "null" : response.body) as T;
}

/** An issue as the cache keeps it: GitHub's own fields, the ones the backlog reads. */
export interface CachedIssue
{
	number: number;
	title: string;
	state: string;
	state_reason?: string | null;
	labels: { name: string }[];
	user: { login: string } | null;
	body: string | null;
	milestone?: { number: number;
		title: string } | null;
	updated_at?: string;
	repository_url?: string;
	pull_request?: unknown;
}

/** Keeps only the fields {@link CachedIssue} names, so the cache stays small and stable. */
function slim(raw: Record<string, unknown>): CachedIssue
{
	const m = raw.milestone as { number: number;
		title: string } | null | undefined;
	return {
		number: raw.number as number,
		title: raw.title as string,
		state: raw.state as string,
		state_reason: (raw.state_reason as string | null | undefined) ?? null,
		labels: ((raw.labels ?? []) as ({ name: string } | string)[]).map((l) => ({
			name: typeof l === "string" ? l : l.name,
		})),
		user: raw.user ? {
			login: (raw.user as { login: string }).login,
		} : null,
		body: (raw.body as string | null | undefined) ?? null,
		milestone: m ? {
			number: m.number,
			title: m.title,
		} : null,
		...(raw.updated_at ? {
			updated_at: raw.updated_at as string,
		} : {}),
		...(raw.repository_url ? {
			repository_url: raw.repository_url as string,
		} : {}),
	};
}

/** One GitHub issue as a review lists it: never its body, which anyone can write. */
export interface IssueSummary
{
	number: number;
	state: string;
	labels: string[];
	title: string;
}

/** The issues query's result: the issues, and the time it started, which the next review's window starts from. */
export interface IssuesResult
{
	issues: IssueSummary[];
	since: string;
	started: string;
	query: string;
}

/** How far before GitHub's clock on the first response the recorded start time goes, so it is no later than the first request. */
export const ISSUES_WINDOW_MARGIN_MS = 5 * 60_000;

/** A response's `Date` header (any case) as a time, or undefined. */
function responseDate(headers: string): number | undefined
{
	const at = Date.parse(/^date:\s*(.+?)\s*$/im.exec(headers)?.[1] ?? "");
	return Number.isNaN(at) ? undefined : at;
}

/**
 * Every issue changed since `since` (`issues?state=all&since=…&per_page=100`, each page the Link
 * header names), pull requests left out, and the time the listing started: GitHub's clock on the
 * first response less {@link ISSUES_WINDOW_MARGIN_MS}, else the local clock read before it.
 */
export function listRawIssues(since: string, run: GhRunner, now: () => Date = () => new Date(), sleep: Sleep = sleepSync): { issues: CachedIssue[];
	started: string }
{
	const before = now().getTime();
	let started: string | undefined;
	const issues: CachedIssue[] = [];
	let page: string | undefined = `repos/{owner}/{repo}/issues?state=all&since=${encodeURIComponent(since)}&per_page=100`;
	while (page !== undefined)
	{
		const response = request(run, "GET", page, [], sleep);
		if (started === undefined)
		{
			const github = responseDate(response.headers);
			started = new Date(github === undefined ? before : github - ISSUES_WINDOW_MARGIN_MS).toISOString();
		}
		for (const raw of ok<Record<string, unknown>[]>(response, "listing issues"))
		{
			if (raw.pull_request === undefined)
			{
				issues.push(slim(raw));
			}
		}
		page = nextPage(response.headers);
	}
	return {
		issues,
		started: started ?? new Date(before).toISOString(),
	};
}

/**
 * The issues opened, updated or closed since `since` (S163's `issues --since`, moved here by S164),
 * as summaries with no body. An issue changed while the review runs falls in the next review's
 * window, and one changed just before it may be read twice, which is harmless (owner, 2026-11-20:
 * "Yes, once per change (Recommended)").
 */
export function listIssues(since: string, run: GhRunner, now: () => Date = () => new Date()): IssuesResult
{
	const { issues, started } = listRawIssues(since, run, now);
	const ids = issues.map((i) => `#${i.number}`).join(", ") || "none";
	return {
		issues: issues.map((i) => ({
			number: i.number,
			state: i.state,
			labels: i.labels.map((l) => l.name),
			title: i.title,
		})),
		since,
		started,
		query: `query: issues --since ${since} → ${ids} (as of ${started})`,
	};
}

/** The cache `pnpm backlog:sync` writes. */
export interface IssueCache
{
	repo: string;
	/** The logins whose issues and `Applied` comments count: the repository's owner and the coordinator's token. */
	trusted: string[];
	syncedAt: string;
	fullSyncedAt?: string;
	issues: CachedIssue[];
}

/** The cache is missing: the now-readers exit 2 with this message. */
export class NoCacheError extends Error
{
	override name = "NoCacheError";
	constructor(dir: string)
	{
		super(`no issue cache in ${dir}: run pnpm backlog:sync`);
	}
}

/**
 * Where the cache lives: `BT_BACKLOG_CACHE` when set (tests, the grader), else `.backlog-cache/` in the
 * main checkout, found like `.run/` through git's common dir, so every worktree reads one copy.
 */
export function cacheDir(root: string, env: Record<string, string | undefined> = process.env): string
{
	if (env.BT_BACKLOG_CACHE)
	{
		return resolve(env.BT_BACKLOG_CACHE);
	}
	let main = root;
	try
	{
		main = dirname(resolve(root, execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
			cwd: root,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim()));
	}
	catch
	{
		// Not a git checkout: the cache sits under root.
	}
	return join(main, ".backlog-cache");
}

/** The cache in `dir`, or undefined when there is none (or it doesn't parse: a sync rewrites it). */
export function readCache(dir: string): IssueCache | undefined
{
	const file = join(dir, "issues.json");
	if (!existsSync(file))
	{
		return undefined;
	}
	try
	{
		return JSON.parse(readFileSync(file, "utf8")) as IssueCache;
	}
	catch
	{
		return undefined;
	}
}

/**
 * Writes the cache whole or not at all: to `issues.json.<pid>.tmp`, unique to this process, then a
 * rename over `issues.json`. Two syncs at once each write their own temp file and the last rename
 * wins; a failed write removes its temp file and leaves the old cache as it was.
 */
export function writeCache(dir: string, cache: IssueCache, write: (file: string, text: string) => void = writeFileSync): void
{
	mkdirSync(dir, {
		recursive: true,
	});
	const tmp = join(dir, `issues.json.${process.pid}.tmp`);
	try
	{
		write(tmp, `${JSON.stringify(cache)}\n`);
		renameSync(tmp, join(dir, "issues.json"));
	}
	catch (error)
	{
		rmSync(tmp, {
			force: true,
		});
		throw error;
	}
}

/**
 * The `since` a full re-list sends: before the repository existed. Not the epoch: GitHub answers
 * `since=1970-01-01T00:00:00Z` (and any time in 1970) with an empty list.
 */
export const FULL_SINCE = "2000-01-01T00:00:00Z";

/** A cache older than this is re-listed whole, so a deleted or transferred issue can't linger. */
export const FULL_SYNC_AFTER_MS = 24 * 60 * 60_000;

/** What a sync did. */
export interface SyncResult
{
	cache: IssueCache;
	full: boolean;
	dropped: number[];
	listed: number;
}

/** Is `issue` one of this repository's own, at its own number (not moved away by a transfer)? */
function isHere(issue: CachedIssue, repo: string, n: number): boolean
{
	return issue.number === n && (issue.repository_url === undefined || issue.repository_url.endsWith(`/repos/${repo}`));
}

/**
 * `pnpm backlog:sync`: reads GitHub, writes only the cache. Incremental from the last sync's start
 * time, or a full re-list with `full`, with no cache, or when the last full one is over a day old. An
 * issue missing from a full re-list is dropped; on an incremental sync each open backlog issue the
 * listing didn't return is read on its own, and one answering 404, 410 or a redirect (deleted or
 * transferred) is dropped. Dropped issues are named in the result.
 */
export function syncIssues(root: string, opts: { run?: GhRunner;
	now?: () => Date;
	sleep?: Sleep;
	full?: boolean;
	env?: Record<string, string | undefined>; } = {}): SyncResult
{
	const run = opts.run ?? ghRunner;
	const now = opts.now ?? (() => new Date());
	const sleep = opts.sleep ?? sleepSync;
	const env = opts.env ?? process.env;
	const dir = cacheDir(root, env);
	const old = readCache(dir);
	const full = opts.full === true || old === undefined || old.fullSyncedAt === undefined ||
		now().getTime() - Date.parse(old.fullSyncedAt) > FULL_SYNC_AFTER_MS;
	const info = ok<{ full_name: string;
		owner: { login: string } }>(request(run, "GET", "repos/{owner}/{repo}", [], sleep), "reading the repository");
	const trusted = new Set([info.owner.login, ...(env.BT_BACKLOG_TRUSTED ?? "").split(",").filter(Boolean)]);
	const viewer = request(run, "GET", "user", [], sleep);
	if (viewer.status === 200 || viewer.status === 0)
	{
		trusted.add(ok<{ login: string }>(viewer, "reading the token's user").login);
	}
	const since = full ? FULL_SINCE : old!.syncedAt;
	const { issues, started } = listRawIssues(since, run, now, sleep);
	const byNumber = new Map<number, CachedIssue>(full ? [] : old!.issues.map((i) => [i.number, i]));
	const dropped: number[] = [];
	for (const issue of issues)
	{
		byNumber.set(issue.number, issue);
	}
	if (full)
	{
		dropped.push(...(old?.issues ?? []).map((i) => i.number).filter((n) => !byNumber.has(n)));
	}
	else
	{
		const listed = new Set(issues.map((i) => i.number));
		for (const issue of old!.issues.filter((i) => i.state === "open" && !listed.has(i.number) && isBacklog(i)))
		{
			const response = request(run, "GET", `repos/{owner}/{repo}/issues/${issue.number}`, [], sleep);
			const gone = response.status === 404 || response.status === 410 || (response.status >= 300 && response.status < 400);
			const fresh = gone ? undefined : slim(ok<Record<string, unknown>>(response, `reading issue #${issue.number}`));
			if (gone || !isHere(fresh!, info.full_name, issue.number))
			{
				byNumber.delete(issue.number);
				dropped.push(issue.number);
			}
			else
			{
				byNumber.set(issue.number, fresh!);
			}
		}
	}
	const cache: IssueCache = {
		repo: info.full_name,
		trusted: [...trusted],
		syncedAt: started,
		fullSyncedAt: full ? started : old!.fullSyncedAt!,
		issues: [...byNumber.values()].sort((a, b) => a.number - b.number),
	};
	writeCache(dir, cache);
	return {
		cache,
		full,
		dropped: dropped.sort((a, b) => a - b),
		listed: issues.length,
	};
}

const labelsOf = (issue: CachedIssue) => issue.labels.map((l) => l.name);
const isBacklog = (issue: CachedIssue) => labelsOf(issue).some((l) => l === "story" || l === "bug");

/** The backlog statuses a `status:*` label can name. */
export const STATUSES = ["todo", "doing", "blocked", "done", "superseded"] as const;

/**
 * The item ID a trusted issue carries, or undefined. A story: labelled `story`, titled exactly
 * `S<N>: …`, written by a trusted login, and not a pull request. A bug: `B<number>`, from the `bug`
 * label alone (only collaborators can set labels, so an outsider's bug counts once the owner labels it).
 */
export function trustedId(issue: CachedIssue, trusted: string[]): string | undefined
{
	if (issue.pull_request !== undefined)
	{
		return undefined;
	}
	const labels = labelsOf(issue);
	const story = /^S([0-9]+): /.exec(issue.title);
	if (labels.includes("story") && story && issue.user !== null && trusted.includes(issue.user.login))
	{
		return `S${Number(story[1])}`;
	}
	return labels.includes("bug") ? `B${issue.number}` : undefined;
}

/**
 * An issue's backlog status: a closed issue is `done` when closed `completed` and `superseded` when
 * `not_planned` (GitHub owns state; the label follows after the merge); an open one takes its
 * `status:*` label, `todo` when it has none.
 */
export function statusOf(issue: CachedIssue): string
{
	if (issue.state === "closed")
	{
		return issue.state_reason === "not_planned" || issue.state_reason === "duplicate" ? "superseded" : "done";
	}
	const label = labelsOf(issue).find((l) => l.startsWith("status:"))?.slice("status:".length);
	return label !== undefined && (STATUSES as readonly string[]).includes(label) && label !== "done" && label !== "superseded" ? label : "todo";
}

/**
 * A trusted issue as S163's {@link BacklogItem}, or undefined when it carries no ID. A story's fields
 * block must parse (a {@link FieldsError} naming the issue otherwise); a bug's is needed only once it
 * is accepted, and an unaccepted bug sorts last (priority Infinity).
 */
export function itemFromIssue(issue: CachedIssue, trusted: string[]): BacklogItem | undefined
{
	const id = trustedId(issue, trusted);
	if (id === undefined)
	{
		return undefined;
	}
	const body = issue.body ?? "";
	const where = `issue #${issue.number} (${id})`;
	const story = id.startsWith("S");
	const fields = story || fieldsYaml(body) !== undefined ? parseFields(body, where) : undefined;
	return {
		id,
		kind: story ? "story" : "bug",
		status: statusOf(issue),
		priority: fields?.priority ?? Number.POSITIVE_INFINITY,
		title: story ? issue.title.replace(/^S[0-9]+: /, "") : issue.title,
		dependsOn: fields?.depends_on ?? [],
		preferAfter: fields?.prefer_after ?? [],
		design: fields?.design ?? [],
		source: story ? (/^\*\*Source:\*\*\s*(.+)$/m.exec(body)?.[1]?.trim() ?? fields?.source ?? null) : null,
		body,
		scopeFiles: fields?.scope_files ?? [],
		note: `issue #${issue.number}`,
		issue: issue.number,
	};
}

/** Every backlog item in the cache. Issues whose fields block is broken are reported together, each named. */
export function itemsFromCache(cache: IssueCache): BacklogItem[]
{
	const items: BacklogItem[] = [];
	const errors: string[] = [];
	for (const issue of cache.issues)
	{
		try
		{
			const item = itemFromIssue(issue, cache.trusted);
			if (item)
			{
				items.push(item);
			}
		}
		catch (error)
		{
			errors.push((error as Error).message);
		}
	}
	if (errors.length > 0)
	{
		throw new Error(errors.join("\n"));
	}
	return items;
}

/** S163's {@link BacklogSource} over the issue cache: the backlog as it is now. No cache throws {@link NoCacheError}. */
export function githubSource(root: string, env: Record<string, string | undefined> = process.env): BacklogSource
{
	return {
		items: async () =>
		{
			const dir = cacheDir(root, env);
			const cache = readCache(dir);
			if (!cache)
			{
				throw new NoCacheError(dir);
			}
			return itemsFromCache(cache);
		},
	};
}

/** The trusted issue carrying `id`, or undefined. */
export function findIssue(cache: IssueCache, id: string): CachedIssue | undefined
{
	return cache.issues.find((i) => trustedId(i, cache.trusted)?.toLowerCase() === id.toLowerCase());
}

/** Calls that change GitHub, and the comment reads `apply` needs. */
export interface GithubWriter
{
	run: GhRunner;
	sleep?: Sleep;
}

/** Opens a story's issue: `S<N>: <title>`, labelled `story` and its status. */
export function createIssue(io: GithubWriter, title: string, body: string, labels: string[]): CachedIssue
{
	return slim(ok(request(io.run, "POST", "repos/{owner}/{repo}/issues", [
		["title", title],
		["body", body],
		...labels.map((l): Field => ["labels[]", l]),
	], io.sleep), `creating "${title.slice(0, 40)}"`));
}

/** Changes an issue: any of body, title, state, state_reason, labels (the whole set) and milestone (a number, or null). */
export function patchIssue(io: GithubWriter, n: number, change: { body?: string;
	title?: string;
	state?: string;
	state_reason?: string;
	labels?: string[];
	milestone?: number | null; }): CachedIssue
{
	const fields: Field[] = [];
	for (const key of ["body", "title", "state", "state_reason"] as const)
	{
		if (change[key] !== undefined)
		{
			fields.push([key, change[key]!]);
		}
	}
	for (const l of change.labels ?? [])
	{
		fields.push(["labels[]", l]);
	}
	if (change.milestone !== undefined)
	{
		fields.push(["milestone", change.milestone]);
	}
	return slim(ok(request(io.run, "PATCH", `repos/{owner}/{repo}/issues/${n}`, fields, io.sleep), `changing issue #${n}`));
}

/** An issue's comments, every page. */
export function listComments(io: GithubWriter, n: number): { body: string;
	user: { login: string } | null }[]
{
	const out: { body: string;
		user: { login: string } | null }[] = [];
	let page: string | undefined = `repos/{owner}/{repo}/issues/${n}/comments?per_page=100`;
	while (page !== undefined)
	{
		const response = request(io.run, "GET", page, [], io.sleep);
		out.push(...ok<{ body: string;
			user: { login: string } | null }[]>(response, `reading issue #${n}'s comments`));
		page = nextPage(response.headers);
	}
	return out;
}

/** Posts a comment on an issue. */
export function postComment(io: GithubWriter, n: number, body: string): void
{
	ok(request(io.run, "POST", `repos/{owner}/{repo}/issues/${n}/comments`, [["body", body]], io.sleep), `commenting on issue #${n}`);
}

/** The repository's milestones, open and closed. */
export function listMilestones(io: GithubWriter): { number: number;
	title: string }[]
{
	return ok(request(io.run, "GET", "repos/{owner}/{repo}/milestones?state=all&per_page=100", [], io.sleep), "listing milestones");
}

/** The `Applied` comment `apply` posts after setting a record's body: `Applied <ID> <kind> <hash>`. */
export function appliedComment(record: TextRecord): string
{
	return `Applied ${record.id} ${record.kind} ${record.hash}`;
}

/** The record hashes an issue's trusted `Applied` comments name (an outsider's comment never counts). */
export function appliedHashes(comments: { body: string;
	user: { login: string } | null }[], id: string, trusted: string[]): Set<string>
{
	const out = new Set<string>();
	for (const c of comments)
	{
		const m = /^Applied (\S+) (?:create|edit|migration) ([0-9a-f]{64})\s*$/.exec(c.body);
		if (m && m[1] === id && c.user !== null && trusted.includes(c.user.login))
		{
			out.add(m[2]!);
		}
	}
	return out;
}

/** What `apply` did, item by item. */
export interface ApplyResult
{
	sent: string[];
	commented: string[];
	created: string[];
}

/** The body a record sets on its issue: a story's whole body, or, for a bug, its symptoms with the recorded fields block. */
function targetBody(record: TextRecord, current: string | null): string
{
	if (!record.id.startsWith("B"))
	{
		return record.body;
	}
	parseFields(record.body, record.file);
	const symptoms = withoutFields(current ?? "");
	return `${symptoms === "" ? "" : `${symptoms}\n\n`}${record.body}`;
}

/** Whether the issue's body already is what `record` sets. */
function isLive(record: TextRecord, body: string | null): boolean
{
	return record.id.startsWith("B") ? fieldsYaml(body ?? "") === fieldsYaml(record.body) : sha256(body ?? "") === record.hash;
}

/**
 * `scripts/audit.sh apply`, on an up-to-date `stage` once the records' ledger pull request merged:
 * syncs first and finds every item's issue by its trusted ID before any POST (so a create whose
 * response was lost is found, not posted twice); then, per item, in chain order, sends each recorded
 * create and edit after the newest one a trusted `Applied` comment names (a migration counts as
 * applied), posting `Applied <ID> <kind> <hash>` after each. A body already equal to the record (a
 * crash after the PATCH) gets only the missing comment. The body GitHub returns must hash to the
 * record's hash, else it fails naming the item (a second `apply` retries).
 */
export function applyRecords(records: TextRecord[], io: GithubWriter & { sync: () => IssueCache }): ApplyResult
{
	const cache = io.sync();
	const result: ApplyResult = {
		sent: [],
		commented: [],
		created: [],
	};
	for (const chain of [...chains(records).values()].sort((a, b) => a.id.localeCompare(b.id, "en", {
		numeric: true,
	})))
	{
		if (chain.problems.length > 0)
		{
			throw new Error(`${chain.id}: ${chain.problems.join("; ")}`);
		}
		let issue = findIssue(cache, chain.id);
		const applied = issue ? appliedHashes(listComments(io, issue.number), chain.id, cache.trusted) : new Set<string>();
		let from = 0;
		chain.records.forEach((r, k) =>
		{
			if (r.kind === "migration" || applied.has(r.hash))
			{
				from = k + 1;
			}
		});
		for (const record of chain.records.slice(from))
		{
			if (!issue)
			{
				if (record.kind !== "create" || !chain.id.startsWith("S"))
				{
					throw new Error(`${chain.id}: no issue carries it, and ${record.file} is not a story's create`);
				}
				const title = record.title ?? chain.id;
				issue = createIssue(io, `${chain.id}: ${title}`, record.body, ["story", "status:todo"]);
				result.created.push(chain.id);
			}
			else if (!isLive(record, issue.body))
			{
				issue = patchIssue(io, issue.number, {
					body: targetBody(record, issue.body),
				});
				result.sent.push(`${chain.id} ${record.kind}`);
			}
			if (!isLive(record, issue.body))
			{
				throw new Error(`${chain.id}: issue #${issue.number}'s body as GitHub returned it does not hash to ${record.file}'s ${record.hash.slice(0, 12)}… (run apply again; if someone changed the issue, adopt it with audit.sh edit ${chain.id} --adopt, S165)`);
			}
			postComment(io, issue.number, appliedComment(record));
			result.commented.push(`${chain.id} ${record.kind}`);
		}
	}
	return result;
}

/** The labels an item gets for a status: its kind's label, `status:<status>`, and any other labels it had. */
export function labelsFor(issue: CachedIssue, status: string): string[]
{
	return [...labelsOf(issue).filter((l) => !l.startsWith("status:")), `status:${status}`];
}

/** The state change for a status: done closes `completed`, superseded closes `not_planned`, the rest reopen. */
export function stateFor(status: string): { state: string;
	state_reason?: string }
{
	if (status === "done")
	{
		return {
			state: "closed",
			state_reason: "completed",
		};
	}
	if (status === "superseded")
	{
		return {
			state: "closed",
			state_reason: "not_planned",
		};
	}
	return {
		state: "open",
	};
}

const repoRoot = resolve(fileURLToPath(import.meta.url), "../../..");

/** The CLI. Returns what to print; throws {@link NoCacheError} (exit 2) or another error (exit 1). */
export function main(argv: string[], run: GhRunner = ghRunner, root = repoRoot): string
{
	const [command, ...rest] = argv;
	const io = {
		run,
	};
	const cached = () =>
	{
		const dir = cacheDir(root);
		const cache = readCache(dir);
		if (!cache)
		{
			throw new NoCacheError(dir);
		}
		return cache;
	};
	const needIssue = (cache: IssueCache, id: string) =>
	{
		const issue = findIssue(cache, id);
		if (!issue)
		{
			throw new Error(`no trusted issue carries ${id} (pnpm backlog:sync, then try again)`);
		}
		return issue;
	};
	switch (command)
	{
		case "sync":
		{
			const r = syncIssues(root, {
				run,
				full: rest.includes("--full"),
			});
			return [`backlog:sync: ${r.full ? "full" : "incremental"}, ${r.listed} issue(s) listed, ${r.cache.issues.length} cached in ${cacheDir(root)}`,
				...r.dropped.map((n) => `dropped #${n} (deleted, transferred or gone from the listing)`)].join("\n");
		}
		case "item":
		{
			const id = /^\d+$/.test(rest[0] ?? "") ? `S${rest[0]}` : (rest[0] ?? "");
			const issue = needIssue(cached(), id);
			if (rest.includes("goal"))
			{
				const line = goalLine(issue.body ?? "");
				if (!line)
				{
					throw new Error(`no /goal command in issue #${issue.number} (${id})`);
				}
				return line;
			}
			return issue.body ?? "";
		}
		case "status":
		{
			const [id, status] = rest;
			if (!(STATUSES as readonly string[]).includes(status ?? ""))
			{
				throw new Error(`status <ID> <${STATUSES.join("|")}>`);
			}
			const issue = needIssue(cached(), id!);
			const after = patchIssue(io, issue.number, {
				...stateFor(status!),
				labels: labelsFor(issue, status!),
			});
			return `#${after.number} ${id}: ${after.state} [${labelsOf(after).join(", ")}]`;
		}
		case "label":
		{
			const issue = needIssue(cached(), rest[0]!);
			const labels = new Set(labelsOf(issue));
			for (let k = 1; k < rest.length; k += 2)
			{
				if (rest[k] === "--add")
				{
					labels.add(rest[k + 1]!);
				}
				else if (rest[k] === "--remove")
				{
					labels.delete(rest[k + 1]!);
				}
			}
			const after = patchIssue(io, issue.number, {
				labels: [...labels],
			});
			return `#${after.number} ${rest[0]}: [${labelsOf(after).join(", ")}]`;
		}
		case "milestone":
		{
			const issue = needIssue(cached(), rest[0]!);
			const title = rest[1] ?? "";
			const milestone = title === "none" ? null : listMilestones(io).find((m) => m.title === title)?.number;
			if (milestone === undefined)
			{
				throw new Error(`no milestone titled ${title}`);
			}
			patchIssue(io, issue.number, {
				milestone,
			});
			return `#${issue.number} ${rest[0]}: milestone ${title}`;
		}
		case "apply":
		{
			const r = applyRecords(readRecords(fragmentsDir()), {
				run,
				sync: () => syncIssues(root, {
					run,
				}).cache,
			});
			return `apply: created ${r.created.join(", ") || "none"}; sent ${r.sent.join(", ") || "none"}; Applied comments ${r.commented.join(", ") || "none"}`;
		}
		default:
			throw new Error("usage: github.ts sync [--full] | item <ID> [goal] | status <ID> <status> | label <ID> [--add l] [--remove l] | milestone <ID> <title|none> | apply");
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
{
	try
	{
		console.log(main(process.argv.slice(2)));
	}
	catch (error)
	{
		console.error(`github: ${(error as Error).message}`);
		process.exitCode = error instanceof NoCacheError ? 2 : 1;
	}
}
