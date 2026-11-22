/**
 * The one module that talks to GitHub about backlog items (S164; owner, 2026-11-20: "It seems like
 * having all stories and bugs in GitHub issues would be useful", and "GitHub owns state
 * (Recommended)"). Every call goes through REST with `gh api` (Claude Code sessions reach only GitHub's REST
 * API, and GitHub Projects' custom fields aren't in it, so an item's fields live in its body), and
 * through an injected {@link GhRunner}, so tests never reach GitHub:
 *
 *   GET   repos/<repo>                     the repository's name and owner (sync)
 *   GET   user                             the token's login (sync; 403 for CI's Actions token)
 *   GET   repos/<repo>/issues?state=all&since=…&per_page=100   (every page the Link header names)
 *   GET   repos/<repo>/issues?state=open&per_page=100   S166: an incremental sync's open listing (every page; read
 *                                 again only when the first pass leaves a drop candidate)
 *   GET   repos/<repo>/issues/<n>
 *   POST  repos/<repo>/issues
 *   PATCH repos/<repo>/issues/<n>            body, state, state_reason, labels, milestone
 *   POST  repos/<repo>/issues/<n>/comments   and GET the same: the `Applied` comments
 *   POST  repos/<repo>/issues/<n>/labels     S165: adds labels, leaving the others as GitHub has them
 *   DELETE repos/<repo>/issues/<n>/labels/<name>   S165: removes one label (a 404, already gone, is done)
 *   GET   repos/<repo>/issues/<n>/timeline?per_page=100   S165: the live check's newest `closed` event and the merged
 *                                 pull request that closed it (its `closed` event names no commit when a merge closes it)
 *   GET   repos/<repo>/milestones?state=all
 *   GET   repos/<repo>/releases?per_page=100   S165: the published releases (areas.ts milestones)
 *
 * Commands (`node scripts/backlog-vault/github.ts …`):
 *
 *   sync [--full]                 pnpm backlog:sync: read the issues into the main checkout's
 *                                 .backlog-cache/issues.json (only reads GitHub)
 *   item <ID> [goal]              an item's text, its newest text record laid over its cached issue
 *                                 ({@link itemText}); `goal` prints its /goal line (scripts/goal.sh)
 *   status <ID> <todo|doing|blocked|done|superseded>   the coordinator changes state on GitHub
 *   label <ID> [--add <l>]… [--remove <l>]…   any label but story, bug and status:* (status sets those)
 *   milestone <ID> <title|none>
 *   apply                         scripts/audit.sh apply: send recorded creates and edits (AC 6)
 *   taken <ID> [--issue <n>]      why a story ID is taken (an issue, a record, a stage fragment), exit 1;
 *                                 issue #n, the create's own, is excepted
 *   next-id                       one above the highest story ID anywhere (a helper; create checks taken)
 *   removed --since <iso>         the stories closed not_planned since then, from the cache (the debt
 *                                 scripts' and the seed's `removed` drift event)
 *   adopt-body <ID> --out <file>  S165: writes an item's live body (a bug's live fields block) for
 *                                 `audit.sh edit <ID> --adopt`; refused when it already is the newest record
 *   applied <ID> <fragment>       S165: posts that record's `Applied` comment (after the adopt's edit is written)
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
import { isRunDirectly } from "./run-directly.ts";
import type { BacklogItem, BacklogSource } from "./search.ts";
import type { TextRecord } from "./text-records.ts";
import {
	chains, FIELDS_HEADING, fragmentsDir, goalLine, lf, newestBody, parseFields, parseRecord, readRecords, recordStamp, sha256, withoutFields,
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

/** How many rate-limit waits one call sits through before it gives up: a limit that never lifts is an error, not a hang. */
export const MAX_RATE_LIMIT_WAITS = 10;

/**
 * One REST call through `gh api -i`. A secondary rate limit (`retry-after`, or a 403 naming it) is
 * waited out and the same call made again, so a long run resumes where it stopped, up to
 * {@link MAX_RATE_LIMIT_WAITS} times.
 */
export function request(run: GhRunner, method: string, path: string, fields: Field[] = [], sleep: Sleep = sleepSync): Response
{
	// GET is gh's default with no fields: the plain `gh api -i <path>` S163's issues query always ran.
	const args = method === "GET" ? ["api", "-i", path] : ["api", "-i", "-X", method, path];
	for (const [name, value] of fields)
	{
		args.push(typeof value === "string" ? "-f" : "-F", `${name}=${value === null ? "null" : value}`);
	}
	for (let waits = 0; ; waits++)
	{
		const response = parseResponse(run(args));
		const wait = rateLimitWait(response);
		if (wait === undefined)
		{
			return response;
		}
		if (waits === MAX_RATE_LIMIT_WAITS)
		{
			throw new GithubError(`${method} ${path}: still rate-limited after ${MAX_RATE_LIMIT_WAITS} waits`, response.status);
		}
		sleep(wait);
	}
}

/** A call that must succeed (2xx): its JSON body, else a {@link GithubError} (areas.ts reads releases through it too). */
export function ok<T>(response: Response, what: string): T
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
	/** When it was last closed: the `removed` drift event reads this, never `updated_at`, which any later touch moves. */
	closed_at?: string | null;
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
		...(raw.closed_at ? {
			closed_at: raw.closed_at as string,
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
	return listPages(`repos/{owner}/{repo}/issues?state=all&since=${encodeURIComponent(since)}&per_page=100`, run, now, sleep);
}

/**
 * Every open issue (`issues?state=open&per_page=100`, every page), pull requests left out: what an
 * incremental sync checks its cached open issues against, a page per 100 open issues and pull
 * requests, since GitHub pages over both before the pull requests are left out (S166).
 */
export function listOpenIssues(run: GhRunner, now: () => Date = () => new Date(), sleep: Sleep = sleepSync): CachedIssue[]
{
	return listPages("repos/{owner}/{repo}/issues?state=open&per_page=100", run, now, sleep).issues;
}

/** The one pager both listings share: reads `first` and each `rel="next"` page after it, as {@link listRawIssues} describes. */
function listPages(first: string, run: GhRunner, now: () => Date, sleep: Sleep): { issues: CachedIssue[];
	started: string }
{
	const before = now().getTime();
	let started: string | undefined;
	const issues: CachedIssue[] = [];
	let page: string | undefined = first;
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
	/** The trusted stories a sync dropped (deleted or transferred), with when: the `removed` event counts them. */
	dropped?: DroppedStory[];
}

/** A trusted story a sync dropped from the cache: its ID, its issue and the sync's start time. */
export interface DroppedStory
{
	id: string;
	number: number;
	at: string;
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
 * Puts an issue as a write returned it into the cache (a status, label, milestone or apply), so the
 * next reader sees it without a sync. `syncedAt` stays: the next incremental sync still lists from
 * the last sync's start. Nothing happens with no cache.
 */
export function storeIssue(root: string, issue: CachedIssue, env: Record<string, string | undefined> = process.env): void
{
	const dir = cacheDir(root, env);
	const cache = readCache(dir);
	if (!cache)
	{
		return;
	}
	const issues = cache.issues.filter((i) => i.number !== issue.number);
	issues.push(issue);
	writeCache(dir, {
		...cache,
		issues: issues.sort((a, b) => a.number - b.number),
	});
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

/**
 * `pnpm backlog:sync`: reads GitHub, writes only the cache. Incremental from the last sync's start
 * time, or a full re-list with `full`, with no cache, or when the last full one is over a day old. An
 * issue missing from a full re-list is dropped; a full sync otherwise lists as before. An incremental
 * sync finds drops from listings, with no per-issue read (S166): it lists the repository's open issues
 * first, then the issues changed since the last sync, and a cached open backlog issue in neither is a
 * candidate (deleted, transferred to another repository, or missed by the open listing's offset paging
 * when an issue on a page already read closed before the next page). Only when there is a candidate,
 * it reads the open listing again, after the since listing, and drops a candidate missing from that
 * too. The open listing comes first so an issue closed between it and the since listing moved its
 * `updated_at` and is in the since listing, kept with its closed state. A closed cached issue is never
 * re-read. Dropped issues are named in the result.
 *
 * Rare double races can still drop an open issue wrongly, in two shapes: the first open listing
 * misses it by the page shift and it then closes after the since listing but before the second open
 * listing; or the second open listing shifts the same way, because another issue closes between its
 * pages. Either, and any earlier wrong drop, heals on the next incremental sync: an open issue the
 * cache lacks is added back from the newest open listing read (the second when it ran, so an issue
 * deleted between the two isn't), and an entry in the cache's `dropped` list whose issue is in the
 * cache again is pruned, so the `removed` drift event stops counting it. A full sync lists and keeps
 * the `dropped` list as before; the incremental sync after it prunes what it put back.
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
	// In CI `GET user` answers 403 for the Actions token, so CI trusts only the owner and
	// BT_BACKLOG_TRUSTED (S165): an Applied comment from another login counts only in the coordinator's session.
	const viewer = request(run, "GET", "user", [], sleep);
	if (viewer.status === 200 || viewer.status === 0)
	{
		trusted.add(ok<{ login: string }>(viewer, "reading the token's user").login);
	}
	const since = full ? FULL_SINCE : old!.syncedAt;
	// Read before the since listing (see above): an issue closed in between is then in the since listing.
	// A second open listing, read only when there is a drop candidate, follows the since listing.
	const open = full ? [] : listOpenIssues(run, now, sleep);
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
		const seen = new Set([...open, ...issues].map((i) => i.number));
		let candidates = old!.issues.filter((i) => i.state === "open" && !seen.has(i.number) && isBacklog(i));
		// The open listing pages by offset: an issue on a page already read that closes before the
		// next page is read shifts that page's first issue onto it, unseen. So a candidate is checked
		// against a second open listing, read only when there is one, and the newer listing is the
		// one whose open issues go back into the cache.
		let openNow = open;
		if (candidates.length > 0)
		{
			openNow = listOpenIssues(run, now, sleep);
			const again = new Set(openNow.map((i) => i.number));
			candidates = candidates.filter((i) => !again.has(i.number));
		}
		for (const issue of candidates)
		{
			byNumber.delete(issue.number);
			dropped.push(issue.number);
		}
		// An open issue the cache lacks (dropped wrongly by an earlier sync) comes back.
		for (const issue of openNow.filter((i) => !byNumber.has(i.number)))
		{
			byNumber.set(issue.number, issue);
		}
	}
	// A dropped trusted story is kept by ID and time, so the `removed` drift event still sees it. On an
	// incremental sync, an entry whose issue is in the cache again was dropped wrongly and leaves the
	// list: keyed on the issue number, which GitHub never reuses (a title, and so an ID, can be). A full
	// sync keeps the list as it was; the next incremental sync prunes what it put back.
	const droppedStories = full ? [...(old?.dropped ?? [])] : (old?.dropped ?? []).filter((d) => !byNumber.has(d.number));
	for (const n of dropped)
	{
		const id = old ? old.issues.find((i) => i.number === n) : undefined;
		const story = id ? trustedId(id, old!.trusted) : undefined;
		if (story?.startsWith("S"))
		{
			droppedStories.push({
				id: story,
				number: n,
				at: started,
			});
		}
	}
	const cache: IssueCache = {
		repo: info.full_name,
		trusted: [...trusted],
		syncedAt: started,
		fullSyncedAt: full ? started : old!.fullSyncedAt!,
		issues: [...byNumber.values()].sort((a, b) => a.number - b.number),
		...(droppedStories.length > 0 ? {
			dropped: droppedStories,
		} : {}),
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
	// No leading zero: `S0163:` is not S163.
	const story = /^S([1-9][0-9]*): /.exec(issue.title);
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
 * An item's text as the backlog reads it (ADR-025: the one place an item's text meets its state):
 * its newest text record laid over its cached issue. A story's body is its newest record's, else its
 * issue's; a bug's is its issue's symptoms with its recorded fields block, and a bug with no record is
 * unaccepted (no fields) until its `create B<N>` merges, so an outsider's edit to its body never sets
 * a priority. CRLF (GitHub's web editor) reads as LF. INDEX, search, claim, bugs, item and goal all
 * read an item through this, so they agree.
 */
export function itemText(id: string, issue: CachedIssue | undefined, records: TextRecord[]): { body: string;
	record?: TextRecord;
	accepted: boolean }
{
	const record = newestBody(records, id);
	if (id.startsWith("B"))
	{
		return record ? {
			body: targetBody(record, issue?.body ?? null),
			record,
			accepted: true,
		} : {
			body: lf(issue?.body ?? ""),
			accepted: false,
		};
	}
	return {
		body: lf(record?.body ?? issue?.body ?? ""),
		...(record ? {
			record,
		} : {}),
		accepted: true,
	};
}

/**
 * A trusted issue as S163's {@link BacklogItem}, its text from {@link itemText}, or undefined when it
 * carries no ID. A story's fields block must parse (a {@link FieldsError} naming the issue otherwise);
 * a bug's fields come only from its record, and an unaccepted bug sorts last (priority Infinity).
 */
export function itemFromIssue(issue: CachedIssue, trusted: string[], records: TextRecord[] = []): BacklogItem | undefined
{
	const id = trustedId(issue, trusted);
	if (id === undefined)
	{
		return undefined;
	}
	const text = itemText(id, issue, records);
	const body = text.body;
	const where = `issue #${issue.number} (${id})`;
	const story = id.startsWith("S");
	const fields = story ? parseFields(body, where) : text.record ? parseFields(text.record.body, `${id} (${text.record.file})`) : undefined;
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

/** An item the backlog skipped: the ID (when the issue carries one), its issue, and why. */
export interface ItemProblem
{
	id?: string;
	issue: number;
	message: string;
}

/**
 * Every backlog item in the cache, read through {@link itemFromIssue}. A broken item (a story whose
 * fields block doesn't parse, or an ID two trusted issues carry) is skipped and reported, never
 * failing the whole backlog: INDEX lists the problems at its top, build and search print them, and
 * claim, item and goal refuse a skipped ID quoting its problem.
 */
export function itemsFromCache(cache: IssueCache, records: TextRecord[] = []): { items: BacklogItem[];
	problems: ItemProblem[] }
{
	const items: BacklogItem[] = [];
	const problems: ItemProblem[] = [];
	const carriers = new Map<string, number[]>();
	for (const issue of cache.issues)
	{
		const id = trustedId(issue, cache.trusted);
		if (id !== undefined)
		{
			carriers.set(id, [...(carriers.get(id) ?? []), issue.number]);
		}
	}
	for (const issue of cache.issues)
	{
		const id = trustedId(issue, cache.trusted);
		const twins = id === undefined ? [] : carriers.get(id)!;
		if (twins.length > 1)
		{
			problems.push({
				id,
				issue: issue.number,
				message: `${id} is carried by more than one trusted issue (${twins.map((n) => `#${n}`).join(", ")}); retitle or close the extra one on GitHub`,
			});
			continue;
		}
		try
		{
			const item = itemFromIssue(issue, cache.trusted, records);
			if (item)
			{
				items.push(item);
			}
		}
		catch (error)
		{
			problems.push({
				...(id === undefined ? {} : {
					id,
				}),
				issue: issue.number,
				message: (error as Error).message,
			});
		}
	}
	return {
		items,
		problems,
	};
}

/** The problems that made the backlog skip `id` (none when it reads cleanly). */
export function problemsFor(cache: IssueCache, records: TextRecord[], id: string): string[]
{
	return itemsFromCache(cache, records).problems.filter((p) => p.id?.toLowerCase() === id.toLowerCase()).map((p) => p.message);
}

/**
 * S163's {@link BacklogSource} over the issue cache, each item's text from its newest record
 * ({@link itemText}): the backlog as it is now. Skipped items' problems go to stderr. No cache throws
 * {@link NoCacheError}.
 */
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
			const { items, problems } = itemsFromCache(cache, readRecords(fragmentsDir(env)));
			for (const p of problems)
			{
				console.error(`backlog: skipped issue #${p.issue}: ${p.message}`);
			}
			return items;
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

/** An issue read fresh from GitHub, as the cache keeps it (a label call's response is a label list, never the issue). */
export function readIssue(io: GithubWriter, n: number): CachedIssue
{
	return slim(ok<Record<string, unknown>>(request(io.run, "GET", `repos/{owner}/{repo}/issues/${n}`, [], io.sleep), `reading issue #${n}`));
}

/**
 * Adds labels to an issue (`POST …/labels`), leaving every other label as GitHub has it now, so a
 * label set from a stale cache never undoes a status changed since the sync (S165).
 */
export function addLabels(io: GithubWriter, n: number, names: string[]): void
{
	if (names.length > 0)
	{
		ok(request(io.run, "POST", `repos/{owner}/{repo}/issues/${n}/labels`, names.map((l): Field => ["labels[]", l]), io.sleep), `labelling issue #${n}`);
	}
}

/** Removes one label (`DELETE …/labels/<name>`); a 404 means it is already gone, which is what was asked. */
export function removeLabel(io: GithubWriter, n: number, name: string): void
{
	const response = request(io.run, "DELETE", `repos/{owner}/{repo}/issues/${n}/labels/${encodeURIComponent(name)}`, [], io.sleep);
	if (response.status !== 404)
	{
		ok(response, `removing ${name} from issue #${n}`);
	}
}

/**
 * An issue's newest `closed` event: who closed it, the commit that did (a `Fixes #N` commit pushed to
 * the default branch), and the merged pull request that closed it, if any.
 */
export interface ClosingEvent
{
	actor: string | undefined;
	commitId: string | null;
	/** The merged pull request whose `Closes|Fixes|Resolves #N` closed it, or undefined when none did. */
	closingPull?: number;
}

/** How close a pull request's merge must come before the issue's `closed` event for the merge to be what closed it. */
export const CLOSE_BY_MERGE_MS = 5 * 60_000;

/** One timeline entry as {@link closingEvent} reads it. */
interface TimelineEntry
{
	event: string;
	created_at?: string;
	commit_id?: string | null;
	actor?: { login: string } | null;
	source?: { issue?: { number: number;
		body?: string | null;
		repository?: { full_name?: string };
		pull_request?: { merged_at?: string | null } } };
}

/**
 * The newest `closed` event of an issue (S165's live check), read from its timeline, oldest first, so
 * the last one on the last page wins; undefined when it has none. A merge that closes an issue through
 * its pull request's `Closes #N` leaves a `closed` event naming no commit (seen on #296, 2026-11-21), so
 * the closing pull request is found from the timeline's `cross-referenced` entries: a merged pull
 * request of this repository (`repo`, `owner/name`) whose body says `Closes|Fixes|Resolves #<n>` and
 * that merged within {@link CLOSE_BY_MERGE_MS} before the close. A pull request elsewhere naming `#<n>`
 * means another repository's issue.
 */
export function closingEvent(io: GithubWriter, n: number, repo: string): ClosingEvent | undefined
{
	let closed: TimelineEntry | undefined;
	const pulls: { number: number;
		mergedAt: number }[] = [];
	const keyword = new RegExp(`\\b(close[sd]?|fix(e[sd])?|resolve[sd]?)\\s+#${n}\\b`, "i");
	let page: string | undefined = `repos/{owner}/{repo}/issues/${n}/timeline?per_page=100`;
	while (page !== undefined)
	{
		const response = request(io.run, "GET", page, [], io.sleep);
		for (const e of ok<TimelineEntry[]>(response, `reading issue #${n}'s timeline`))
		{
			if (e.event === "closed")
			{
				closed = e;
			}
			const pull = e.source?.issue;
			const merged = Date.parse(pull?.pull_request?.merged_at ?? "");
			if (e.event === "cross-referenced" && pull !== undefined && pull.repository?.full_name === repo && !Number.isNaN(merged) && keyword.test(pull.body ?? ""))
			{
				pulls.push({
					number: pull.number,
					mergedAt: merged,
				});
			}
		}
		page = nextPage(response.headers);
	}
	if (closed === undefined)
	{
		return undefined;
	}
	const at = Date.parse(closed.created_at ?? "");
	const closer = pulls.find((p) => !Number.isNaN(at) && p.mergedAt <= at && at - p.mergedAt <= CLOSE_BY_MERGE_MS);
	return {
		actor: closed.actor?.login,
		commitId: closed.commit_id ?? null,
		...(closer ? {
			closingPull: closer.number,
		} : {}),
	};
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

/** A record's key in its `Applied` comment: its hash and its fragment's stamp, so a body that comes back (A→B→A) is applied once per record. */
export function appliedKey(record: TextRecord): string
{
	return `${record.hash} ${recordStamp(record)}`;
}

/**
 * The `Applied` comment `apply` posts after setting a record's body: `Applied <ID> <kind> <hash>
 * <stamp>`. The `Applied <ID> edit <hash>` prefix is S165's wording; the stamp keys it to the record.
 */
export function appliedComment(record: TextRecord): string
{
	return `Applied ${record.id} ${record.kind} ${appliedKey(record)}`;
}

/** The records ({@link appliedKey}) an issue's trusted `Applied` comments name (an outsider's comment never counts). */
export function appliedRecords(comments: { body: string;
	user: { login: string } | null }[], id: string, trusted: string[]): Set<string>
{
	const out = new Set<string>();
	for (const c of comments)
	{
		const m = /^Applied (\S+) (?:create|edit|migration) ([0-9a-f]{64}) (\d{8}T\d{6}Z)\s*$/.exec(lf(c.body));
		if (m && m[1] === id && c.user !== null && trusted.includes(c.user.login))
		{
			out.add(`${m[2]} ${m[3]}`);
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
	// Trailing whitespace trimmed, as the migration writes it (migrate.ts desiredFor).
	const symptoms = withoutFields(current ?? "").replace(/\s+$/, "");
	return `${symptoms === "" ? "" : `${symptoms}\n\n`}${record.body}`;
}

/**
 * Whether the issue's body already is what `record` sets (a CRLF copy of it counts). A bug compares
 * its fields block alone ({@link bugFieldsText}), so its filer's symptoms, whitespace included, never
 * matter (S165: the live check, `apply` and `audit.sh edit --adopt` all read it this way).
 */
export function isLive(record: TextRecord, body: string | null): boolean
{
	const text = lf(body ?? "");
	if (record.id.startsWith("B"))
	{
		// Both sides normalized the same way: a record written byte-exact from a body file (text-records.ts
		// fields) may lack the final newline GitHub's copy has, or the reverse.
		const section = bugFieldsText(text);
		return section !== undefined && section === bugFieldsText(record.body);
	}
	return sha256(text) === record.hash;
}

/**
 * `scripts/audit.sh apply`, on an up-to-date `stage` once the records' ledger pull request merged:
 * syncs first and finds every item's issue by its trusted ID before any POST (so a create whose
 * response was lost is found, not posted twice); then, per item, in chain order, sends each recorded
 * create and edit after the newest one a trusted `Applied` comment names (a migration counts as
 * applied), posting `Applied <ID> <kind> <hash> <stamp>` after each ({@link appliedComment}). A body already equal to the record (a
 * crash after the PATCH) gets only the missing comment. The body GitHub returns must hash to the
 * record's hash, else it fails naming the item (a second `apply` retries).
 */
export function applyRecords(records: TextRecord[], io: GithubWriter & { sync: () => IssueCache;
	store?: (issue: CachedIssue) => void; }): ApplyResult
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
		// A chain that is only its migration has nothing to send: no comments to read.
		if (chain.records.every((r) => r.kind === "migration"))
		{
			continue;
		}
		const applied = issue ? appliedRecords(listComments(io, issue.number), chain.id, cache.trusted) : new Set<string>();
		let from = 0;
		chain.records.forEach((r, k) =>
		{
			if (r.kind === "migration" || applied.has(appliedKey(r)))
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
				issue = createIssue(io, `${chain.id}: ${title}`.slice(0, 256), record.body, ["story", "status:todo"]);
				result.created.push(chain.id);
			}
			else if (record.kind === "create" && chain.id.startsWith("S") && !isLive(record, issue.body))
			{
				// Another issue already carries this ID with other text, and no Applied comment says it is this create's.
				throw new Error(`${chain.id}: issue #${issue.number} already carries ${chain.id} with other text, so ${record.file} collides (record the story under a free ID)`);
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
			io.store?.(issue);
		}
	}
	return result;
}

/**
 * Law L9's design clause, "a UI story waits for its ratified design" (S165; owner, 2026-11-20: "GitHub
 * owns state (Recommended)", which moved it from the commit check to the live one and the claim step):
 * each design story in `design` must be carried by an issue closed `completed` with `status:done`.
 * Returns one problem per design story that isn't. `pnpm backlog:check --live` and `claims.ts claim`
 * both call this, so they agree (ADR-025).
 */
export function designGate(cache: IssueCache, id: string, design: string[]): string[]
{
	const problems: string[] = [];
	for (const d of design)
	{
		const issue = findIssue(cache, d);
		const done = issue !== undefined && issue.state === "closed" && (issue.state_reason ?? "completed") === "completed" && labelsOf(issue).includes("status:done");
		if (!done)
		{
			problems.push(`${id} waits for its ratified design, but its design story ${d} ${issue ? `(#${issue.number}) is not closed completed with status:done` : "has no trusted issue"}`);
		}
	}
	return problems;
}

/** The `### Backlog fields` section of a body, from its heading to the end (a bug's recorded text), or undefined when it has none. */
export function fieldsSection(body: string): string | undefined
{
	const text = lf(body);
	if (text.startsWith(`${FIELDS_HEADING}\n`))
	{
		return text;
	}
	const at = text.lastIndexOf(`\n${FIELDS_HEADING}\n`);
	return at === -1 ? undefined : text.slice(at + 1);
}

/**
 * A bug body's fields block as its record holds it: {@link fieldsSection} with trailing whitespace
 * trimmed and one newline added, so a body GitHub returns without its final newline still matches.
 */
export function bugFieldsText(body: string): string | undefined
{
	const section = fieldsSection(body);
	return section === undefined ? undefined : `${section.replace(/\s+$/, "")}\n`;
}

/**
 * What `audit.sh edit <ID> --adopt` records (S165 AC 2): the item's live body as GitHub returns it, a
 * story's whole body or a bug's fields block, so an edit the owner made on GitHub becomes a record
 * chained from the newest one. Refused when the live text already is the newest record (nothing to
 * adopt), when it has no record to chain from, or when a bug's body has no fields block that parses.
 */
export function adoptBody(id: string, issue: CachedIssue, records: TextRecord[]): string
{
	const tip = newestBody(records, id);
	if (!tip)
	{
		throw new Error(`${id} has no text record to chain an adopted edit from (scripts/audit.sh create ${id})`);
	}
	if (isLive(tip, issue.body))
	{
		throw new Error(`issue #${issue.number} already matches ${id}'s newest record (${tip.file}): nothing to adopt`);
	}
	if (id.startsWith("B"))
	{
		const section = bugFieldsText(issue.body ?? "");
		if (section === undefined)
		{
			throw new Error(`issue #${issue.number} (${id}) has no ${FIELDS_HEADING} section to adopt`);
		}
		parseFields(section, `issue #${issue.number} (${id})`);
		return section;
	}
	return lf(issue.body ?? "");
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

/**
 * Why story ID `id` is taken, or undefined when it is free: a trusted issue carries it (`cache`, when
 * there is one), a text record in the tree names it, or a fragment on `stage` does (`stageNames`, the
 * fragment file names there). An ID with a leading zero is never valid.
 */
export function idTaken(id: string, cache: IssueCache | undefined, records: TextRecord[], stageNames: string[], ownIssue?: number): string | undefined
{
	if (!/^S[1-9][0-9]*$/.test(id))
	{
		return `${id} is not a story ID (S<N>, no leading zero)`;
	}
	// `ownIssue`: the issue this create records (an interrupted reconcile made it live first), which may carry the ID.
	const issue = cache ? cache.issues.find((i) => i.number !== ownIssue && trustedId(i, cache.trusted)?.toLowerCase() === id.toLowerCase()) : undefined;
	if (issue)
	{
		return `issue #${issue.number} carries ${id}`;
	}
	const record = records.find((r) => r.id === id && (r.kind === "create" || r.kind === "migration"));
	if (record)
	{
		return `${record.file} records ${id}`;
	}
	const name = stageNames.find((n) => new RegExp(`^\\d{8}T\\d{6}Z-${id}-(create|migration)\\.md$`).test(n));
	return name ? `stage's ${name} records ${id}` : undefined;
}

/** One above the highest story ID among the trusted issues, the tree's records and stage's fragment names (a helper: `create` checks {@link idTaken}). */
export function nextStoryId(cache: IssueCache | undefined, records: TextRecord[], stageNames: string[]): string
{
	const ns = [
		...(cache?.issues ?? []).map((i) => trustedId(i, cache!.trusted)),
		...records.map((r) => r.id),
		...stageNames.map((n) => /^\d{8}T\d{6}Z-(S\d+)-(?:create|migration)\.md$/.exec(n)?.[1]),
	].filter((id): id is string => id !== undefined && /^S\d+$/.test(id)).map((id) => Number(id.slice(1)));
	return `S${Math.max(0, ...ns) + 1}`;
}

/**
 * The stories removed since `since`, from the cache: the `removed` drift event the debt scripts (and
 * through them the review seed) count. A story is removed when it was closed `not_planned` since then
 * (its `closed_at`, never `updated_at`, which any later touch moves), or a sync dropped it as deleted
 * or transferred since then. A closure the migration made is not one: a story whose `migration`
 * record (in `records`) was captured at or after its `closed_at` was closed by the migration itself.
 */
export function removedSince(cache: IssueCache, since: string, records: TextRecord[] = []): string[]
{
	const from = Date.parse(since);
	const migratedAt = new Map(records.filter((r) => r.kind === "migration").map((r) => [r.id, stampTime(recordStamp(r))]));
	const closed = cache.issues.filter((i) => i.state === "closed" && i.state_reason === "not_planned" && Date.parse(i.closed_at ?? "") >= from)
		.map((i) => ({
			id: trustedId(i, cache.trusted),
			at: Date.parse(i.closed_at!),
		}))
		.filter((c) => c.id?.startsWith("S") === true && !(migratedAt.has(c.id!) && c.at <= migratedAt.get(c.id!)!))
		.map((c) => c.id!);
	const dropped = (cache.dropped ?? []).filter((d) => Date.parse(d.at) >= from).map((d) => d.id);
	return [...new Set([...closed, ...dropped])];
}

/** A fragment stamp (`20261121T104717Z`) as a time. */
function stampTime(stamp: string): number
{
	const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(stamp);
	return m ? Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`) : Number.NaN;
}

/** The fragment file names under docs/v3/audit on `stage` (`BT_STAGE_REF`, default origin/stage), or undefined when there is no such ref. */
function stageFragmentNames(root: string, env: Record<string, string | undefined>): string[] | undefined
{
	try
	{
		return execFileSync("git", ["ls-tree", "-r", "--name-only", env.BT_STAGE_REF ?? "origin/stage", "--", "docs/v3/audit"], {
			cwd: root,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
			maxBuffer: 64 * 1024 * 1024,
		}).split("\n").filter(Boolean).map((p) => p.slice(p.lastIndexOf("/") + 1));
	}
	catch
	{
		return undefined;
	}
}

/** The labels the `label` command never changes: the kind (an item without it loses its ID) and status (the `status` command's). */
const MANAGED_LABEL = /^(story|bug|status:.*)$/;

/** The CLI. Returns what to print; throws {@link NoCacheError} (exit 2) or another error (exit 1). Warnings go to stderr. */
export function main(argv: string[], run: GhRunner = ghRunner, root = repoRoot, env: Record<string, string | undefined> = process.env): string
{
	const [command, ...rest] = argv;
	const io = {
		run,
	};
	const cached = () =>
	{
		const dir = cacheDir(root, env);
		const cache = readCache(dir);
		if (!cache)
		{
			throw new NoCacheError(dir);
		}
		return cache;
	};
	const records = () => readRecords(fragmentsDir(env));
	/** The issue carrying `id`, read fresh from GitHub (the cache may be older than a change made since). */
	const freshIssue = (cache: IssueCache, id: string) =>
	{
		const issue = findIssue(cache, id);
		if (!issue)
		{
			throw new Error(`no trusted issue carries ${id} (pnpm backlog:sync, then try again)`);
		}
		const fresh = readIssue(io, issue.number);
		if (trustedId(fresh, cache.trusted)?.toLowerCase() !== id.toLowerCase())
		{
			throw new Error(`issue #${issue.number} no longer carries ${id} on GitHub (pnpm backlog:sync, then try again)`);
		}
		return fresh;
	};
	const store = (issue: CachedIssue) => storeIssue(root, issue, env);
	switch (command)
	{
		case "sync":
		{
			const r = syncIssues(root, {
				run,
				full: rest.includes("--full"),
				env,
			});
			return [`backlog:sync: ${r.full ? "full" : "incremental"}, ${r.listed} issue(s) listed, ${r.cache.issues.length} cached in ${cacheDir(root, env)}`,
				...r.dropped.map((n) => `dropped #${n} (deleted, transferred or gone from the listing)`)].join("\n");
		}
		case "item":
		{
			const id = /^\d+$/.test(rest[0] ?? "") ? `S${rest[0]}` : (rest[0] ?? "");
			const cache = cached();
			const recs = records();
			const problems = problemsFor(cache, recs, id);
			if (problems.length > 0)
			{
				throw new Error(`${id} is skipped by the backlog: ${problems.join("; ")}`);
			}
			const issue = findIssue(cache, id);
			if (!issue && !newestBody(recs, id))
			{
				throw new Error(`no trusted issue or text record carries ${id} (pnpm backlog:sync, then try again)`);
			}
			const body = itemText(id, issue, recs).body;
			if (rest.includes("goal"))
			{
				const line = goalLine(body);
				if (!line)
				{
					throw new Error(`no /goal command in ${id}'s text (${issue ? `issue #${issue.number}` : "its text record"})`);
				}
				return line;
			}
			return body;
		}
		case "status":
		{
			const [id, status] = rest;
			if (!(STATUSES as readonly string[]).includes(status ?? ""))
			{
				throw new Error(`status <ID> <${STATUSES.join("|")}>`);
			}
			const issue = freshIssue(cached(), id!);
			const after = patchIssue(io, issue.number, {
				...stateFor(status!),
				labels: labelsFor(issue, status!),
			});
			store(after);
			return `#${after.number} ${id}: ${after.state} [${labelsOf(after).join(", ")}]`;
		}
		case "label":
		{
			const changes: [string, string][] = [];
			for (let k = 1; k < rest.length; k += 2)
			{
				if ((rest[k] === "--add" || rest[k] === "--remove") && rest[k + 1])
				{
					if (MANAGED_LABEL.test(rest[k + 1]!))
					{
						throw new Error(`label never changes ${rest[k + 1]}: story and bug carry the item's ID, and status:* is the status command's (github.ts status ${rest[0]} <status>)`);
					}
					changes.push([rest[k]!, rest[k + 1]!]);
				}
			}
			const issue = freshIssue(cached(), rest[0]!);
			// Added and removed one by one (S165), so a label changed by anyone in between is kept.
			addLabels(io, issue.number, changes.filter(([op]) => op === "--add").map(([, l]) => l));
			for (const [op, l] of changes)
			{
				if (op === "--remove")
				{
					removeLabel(io, issue.number, l);
				}
			}
			const after = readIssue(io, issue.number);
			store(after);
			return `#${after.number} ${rest[0]}: [${labelsOf(after).join(", ")}]`;
		}
		case "milestone":
		{
			const issue = freshIssue(cached(), rest[0]!);
			const title = rest[1] ?? "";
			const milestone = title === "none" ? null : listMilestones(io).find((m) => m.title === title)?.number;
			if (milestone === undefined)
			{
				throw new Error(`no milestone titled ${title}`);
			}
			store(patchIssue(io, issue.number, {
				milestone,
			}));
			return `#${issue.number} ${rest[0]}: milestone ${title}`;
		}
		case "apply":
		{
			const r = applyRecords(records(), {
				run,
				sync: () => syncIssues(root, {
					run,
					env,
				}).cache,
				store,
			});
			return `apply: created ${r.created.join(", ") || "none"}; sent ${r.sent.join(", ") || "none"}; Applied comments ${r.commented.join(", ") || "none"}`;
		}
		case "taken":
		case "next-id":
		{
			const cache = readCache(cacheDir(root, env));
			if (!cache)
			{
				console.error("warning: no issue cache, so only the text records are checked (run pnpm backlog:sync)");
			}
			const names = stageFragmentNames(root, env);
			if (names === undefined)
			{
				console.error(`warning: no ${env.BT_STAGE_REF ?? "origin/stage"} ref, so stage's records are not checked (git fetch origin)`);
			}
			if (command === "next-id")
			{
				return nextStoryId(cache, records(), names ?? []);
			}
			const at = rest.indexOf("--issue");
			const why = idTaken(rest[0] ?? "", cache, records(), names ?? [], at === -1 ? undefined : Number(rest[at + 1]));
			if (why)
			{
				throw new Error(`${rest[0]} is taken: ${why} (the next free ID is ${nextStoryId(cache, records(), names ?? [])})`);
			}
			return "";
		}
		case "removed":
		{
			const at = rest.indexOf("--since");
			const cache = readCache(cacheDir(root, env));
			if (!cache)
			{
				console.error("no cache: removed events not counted (run pnpm backlog:sync)");
				return "";
			}
			return removedSince(cache, rest[at + 1] ?? "", records()).join("\n");
		}
		case "adopt-body":
		{
			const id = rest[0] ?? "";
			const out = rest[rest.indexOf("--out") + 1];
			if (!rest.includes("--out") || !out)
			{
				throw new Error("adopt-body <ID> --out <file>");
			}
			const issue = freshIssue(cached(), id);
			writeFileSync(out, adoptBody(id, issue, records()));
			return String(issue.number);
		}
		case "applied":
		{
			const [id = "", fragment = ""] = rest;
			const record = parseRecord(readFileSync(fragment, "utf8"), fragment);
			if (record.id !== id || sha256(record.body) !== record.hash)
			{
				throw new Error(`${fragment} is not an intact record of ${id}`);
			}
			const issue = freshIssue(cached(), id);
			postComment(io, issue.number, appliedComment(record));
			return `#${issue.number} ${id}: ${appliedComment(record)}`;
		}
		default:
			throw new Error("usage: github.ts sync [--full] | item <ID> [goal] | status <ID> <status> | label <ID> [--add l] [--remove l] | milestone <ID> <title|none> | apply | taken <ID> [--issue <n>] | next-id | removed --since <iso> | adopt-body <ID> --out <file> | applied <ID> <fragment>");
	}
}

if (isRunDirectly(import.meta.url))
{
	try
	{
		const out = main(process.argv.slice(2));
		if (out !== "")
		{
			console.log(out);
		}
	}
	catch (error)
	{
		console.error(`github: ${(error as Error).message}`);
		process.exitCode = error instanceof NoCacheError ? 2 : 1;
	}
}
