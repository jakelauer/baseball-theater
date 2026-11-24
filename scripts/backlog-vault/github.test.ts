/**
 * github.ts (S164 AC 1): the one module that talks to GitHub about backlog items, read-only sync to
 * the cache, and the trusted-ID rules. Every call goes to {@link FakeGithub}; nothing reaches GitHub.
 */
import { spawnSync } from "node:child_process";
import {
	existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	afterEach, beforeEach, describe, expect, it,
} from "vitest";
import type { CachedIssue, IssueCache } from "./github.ts";
import {
	cacheDir, findIssue, githubSource, idTaken, itemFromIssue, itemsFromCache, main, MAX_RATE_LIMIT_WAITS, nextPage, nextStoryId, NoCacheError, readCache, removedSince,
	request, statusOf, syncIssues, trustedId, writeCache,
} from "./github.ts";
import { FakeGithub } from "./github-fake.ts";
import type { RecordInput } from "./text-records.ts";
import {
	parseRecord, renderFields, renderRecord,
} from "./text-records.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const fields = (priority: number | string = 5) => renderFields({
	priority: priority as number,
	depends_on: [],
	scope_files: ["scripts/x.ts"],
});
const storyBody = (priority: number | string = 5) => `**Gap:** g\n\n**Source:** Feature: X\n\n${fields(priority)}`;

let dir = "";
let env: Record<string, string>;
beforeEach(() =>
{
	dir = mkdtempSync(join(tmpdir(), "s164-github-"));
	env = {
		BT_BACKLOG_CACHE: join(dir, "cache"),
		// Text records from the test's own folder, never the repository's.
		BT_AUDIT_LEDGER: join(dir, "AUDIT.md"),
	};
});
afterEach(() => rmSync(dir, {
	recursive: true,
	force: true,
}));

let clock = 0;
/** Writes a text record into the test's fragments folder (`<dir>/audit`) and returns it parsed. */
function record(kind: RecordInput["kind"], id: string, body: string, extra: Partial<RecordInput> = {})
{
	clock++;
	const stamp = `2026-11-21T00:00:${String(clock).padStart(2, "0")}Z`;
	const file = `2026-11-21/${stamp.replace(/[-:]/g, "")}-${id}-${kind}.md`;
	const text = renderRecord({
		kind,
		id,
		date: "2026-11-21",
		stamp,
		head: "h",
		body,
		...extra,
	});
	mkdirSync(join(dir, "audit/2026-11-21"), {
		recursive: true,
	});
	writeFileSync(join(dir, "audit", file), text);
	return parseRecord(text, file);
}

const goalBody = (line: string, priority = 5) => `**Gap:** g\n\n**\`/goal\` command**\n\n\`\`\`text\n${line}\n\`\`\`\n\n${fields(priority)}`;

/** A cached issue for the pure rules. */
function issue(over: Partial<CachedIssue> & { title: string }): CachedIssue
{
	return {
		number: 1,
		state: "open",
		state_reason: null,
		labels: [],
		user: {
			login: "owner",
		},
		body: storyBody(),
		...over,
	};
}

/**
 * The clock every sync here runs on. github-fake.ts answers with a fixed date (21 Nov 2026), and a
 * sync re-lists in full once its last full sync is over a day older than its clock, so a test on the
 * real clock turned full a day after that date and failed every run from 2026-11-22.
 */
const fakeNow = (): Date => new Date("2026-11-21T01:00:00Z");

/** A request for one issue (`issues/<n>`), which an incremental sync never makes (S166 AC 2). */
const PER_ISSUE = /\/issues\/\d+/;

/** An `updated_at` long before any sync here, so an incremental since listing leaves the issue out. */
const QUIET = "2026-11-01T00:00:00Z";

/** A fake holding `count` open, quiet, owner-filed stories, #1 to #count. */
function quietStories(count: number): FakeGithub
{
	const fake = new FakeGithub();
	for (let k = 1; k <= count; k++)
	{
		fake.add({
			title: `S${k}: story ${k}`,
			labels: [{
				name: "story",
			}],
			updated_at: QUIET,
		});
	}
	return fake;
}

/**
 * Rewrites the cache as a sync that wrongly dropped issue `n` (story S<n>) left it: the issue gone
 * from `issues` and named in `dropped`, as the open listing's page race did before S166's round 1.
 */
function dropWrongly(n: number): void
{
	const cache = readCache(env.BT_BACKLOG_CACHE!)!;
	writeCache(env.BT_BACKLOG_CACHE!, {
		...cache,
		issues: cache.issues.filter((i) => i.number !== n),
		dropped: [{
			id: `S${n}`,
			number: n,
			at: cache.syncedAt,
		}],
	});
}

describe("sync (AC 1)", () =>
{
	it("follows pagination through the Link header and writes every issue to the cache", () =>
	{
		const fake = new FakeGithub();
		for (let k = 1; k <= 150; k++)
		{
			fake.add({
				title: `S${k}: story ${k}`,
				labels: [{
					name: "story",
				}],
				body: storyBody(k),
			});
		}
		const result = syncIssues(dir, {
			now: fakeNow,
			run: fake.run,
			env,
		});
		expect(result.full).toBe(true);
		expect(result.cache.issues).toHaveLength(150);
		expect(fake.calls.filter((c) => c.path.includes("issues?state=all"))).toHaveLength(2);
		expect(readCache(env.BT_BACKLOG_CACHE!)!.issues).toHaveLength(150);
	});

	it("only reads GitHub: a sync makes no POST or PATCH", () =>
	{
		const fake = new FakeGithub();
		fake.add({
			title: "S1: a",
			labels: [{
				name: "story",
			}],
		});
		syncIssues(dir, {
			now: fakeNow,
			run: fake.run,
			env,
		});
		expect(fake.calls.every((c) => c.method === "GET")).toBe(true);
	});

	it("is incremental with since, and re-lists in full with --full or a cache over 24 hours old", () =>
	{
		const fake = new FakeGithub();
		fake.add({
			title: "S1: a",
			labels: [{
				name: "story",
			}],
		});
		const first = syncIssues(dir, {
			run: fake.run,
			env,
			now: () => new Date("2026-11-21T00:00:00Z"),
		});
		expect(first.full).toBe(true);
		const second = syncIssues(dir, {
			run: fake.run,
			env,
			now: () => new Date("2026-11-21T01:00:00Z"),
		});
		expect(second.full).toBe(false);
		expect(fake.calls.at(-1)!.path).toContain(`since=${encodeURIComponent(first.cache.syncedAt)}`);
		expect(syncIssues(dir, {
			now: fakeNow,
			run: fake.run,
			env,
			full: true,
		}).full).toBe(true);
		const cache = readCache(env.BT_BACKLOG_CACHE!)!;
		writeCache(env.BT_BACKLOG_CACHE!, {
			...cache,
			fullSyncedAt: "2026-11-01T00:00:00Z",
		});
		expect(syncIssues(dir, {
			run: fake.run,
			env,
			now: () => new Date("2026-11-21T02:00:00Z"),
		}).full).toBe(true);
	});

	it("drops a deleted and a transferred issue on a full sync, naming them", () =>
	{
		const fake = new FakeGithub();
		const a = fake.add({
			title: "S1: a",
			labels: [{
				name: "story",
			}],
		});
		const b = fake.add({
			title: "S2: b",
			labels: [{
				name: "story",
			}],
		});
		fake.add({
			title: "S3: c",
			labels: [{
				name: "story",
			}],
		});
		syncIssues(dir, {
			now: fakeNow,
			run: fake.run,
			env,
		});
		a.gone = "deleted";
		b.gone = "transferred";
		const result = syncIssues(dir, {
			now: fakeNow,
			run: fake.run,
			env,
			full: true,
		});
		expect(result.dropped).toEqual([1, 2]);
		expect(result.cache.issues.map((i) => i.number)).toEqual([3]);
		expect(main(["sync", "--full"], fake.run, dir)).not.toContain("dropped");
	});

	it("drops a deleted and a transferred issue on an incremental sync, as missing from both the open and the since listing", () =>
	{
		const fake = new FakeGithub();
		const a = fake.add({
			title: "S1: a",
			labels: [{
				name: "story",
			}],
		});
		const b = fake.add({
			title: "B2 symptoms",
			labels: [{
				name: "bug",
			}],
		});
		fake.add({
			title: "S3: c",
			labels: [{
				name: "story",
			}],
		});
		syncIssues(dir, {
			now: fakeNow,
			run: fake.run,
			env,
		});
		a.gone = "deleted";
		b.gone = "transferred";
		const result = syncIssues(dir, {
			now: fakeNow,
			run: fake.run,
			env,
		});
		expect(result.full).toBe(false);
		expect(result.dropped).toEqual([1, 2]);
		expect(result.cache.issues.map((i) => i.number)).toEqual([3]);
		// The dropped story still reaches the cache's dropped list (the removed drift event reads it).
		expect(result.cache.dropped?.map((d) => [d.id, d.number])).toEqual([["S1", 1]]);
		expect(fake.calls.filter((c) => PER_ISSUE.test(c.path))).toEqual([]);
	});

	it("an incremental sync over 45 open backlog issues makes no per-issue request", () =>
	{
		const fake = new FakeGithub();
		for (let k = 1; k <= 45; k++)
		{
			fake.add({
				title: `S${k}: story ${k}`,
				labels: [{
					name: "story",
				}],
				updated_at: QUIET,
			});
		}
		syncIssues(dir, {
			now: fakeNow,
			run: fake.run,
			env,
		});
		fake.calls = [];
		const result = syncIssues(dir, {
			now: fakeNow,
			run: fake.run,
			env,
		});
		expect(result.full).toBe(false);
		expect(result.dropped).toEqual([]);
		expect(result.cache.issues).toHaveLength(45);
		// The repository, the user, then the open listing's one page before the since listing's one page.
		expect(fake.calls.map((c) => c.path.replace(/\?.*$/, (q) => (q.includes("state=open") ? "?open" : "?since")))).toEqual([
			"repos/{owner}/{repo}",
			"user",
			"repos/{owner}/{repo}/issues?open",
			"repos/{owner}/{repo}/issues?since",
		]);
		expect(fake.calls.filter((c) => PER_ISSUE.test(c.path))).toEqual([]);
	});

	it("an open listing of two pages is read whole", () =>
	{
		const fake = new FakeGithub();
		for (let k = 1; k <= 150; k++)
		{
			fake.add({
				title: `S${k}: story ${k}`,
				labels: [{
					name: "story",
				}],
				updated_at: QUIET,
			});
		}
		syncIssues(dir, {
			now: fakeNow,
			run: fake.run,
			env,
		});
		fake.issues.get(140)!.gone = "deleted";
		fake.calls = [];
		const result = syncIssues(dir, {
			now: fakeNow,
			run: fake.run,
			env,
		});
		// Two pages, twice: the deleted #140 is a drop candidate, so the open listing is read again.
		expect(fake.calls.filter((c) => c.path.includes("state=open"))).toHaveLength(4);
		// Only the deleted one: every other issue on the second page was seen there.
		expect(result.dropped).toEqual([140]);
		expect(result.cache.issues).toHaveLength(149);
		expect(fake.calls.filter((c) => PER_ISSUE.test(c.path))).toEqual([]);
	});

	it("an issue closed between the two listings is kept, with its closed state", () =>
	{
		const fake = new FakeGithub();
		for (let k = 1; k <= 3; k++)
		{
			fake.add({
				title: `S${k}: story ${k}`,
				labels: [{
					name: "story",
				}],
				updated_at: QUIET,
			});
		}
		syncIssues(dir, {
			now: fakeNow,
			run: fake.run,
			env,
		});
		// Close #2 just before the second listing is answered: after the first, whichever that is.
		let listings = 0;
		fake.intercept = (call, f) =>
		{
			if (/\/issues\?state=/.test(call.path) && ++listings === 2)
			{
				const two = f.issues.get(2)!;
				two.state = "closed";
				two.state_reason = "completed";
				two.updated_at = f.now();
			}
			return undefined;
		};
		const result = syncIssues(dir, {
			now: fakeNow,
			run: fake.run,
			env,
		});
		expect(result.dropped).toEqual([]);
		expect(result.cache.issues.map((i) => [i.number, i.state])).toEqual([[1, "open"], [2, "closed"], [3, "open"]]);
	});

	it("a closed issue is never re-read", () =>
	{
		const fake = new FakeGithub();
		fake.add({
			title: "S1: a",
			labels: [{
				name: "story",
			}],
			updated_at: QUIET,
		});
		const closed = fake.add({
			title: "S2: b",
			labels: [{
				name: "story",
			}],
			state: "closed",
			state_reason: "completed",
			updated_at: QUIET,
		});
		syncIssues(dir, {
			now: fakeNow,
			run: fake.run,
			env,
		});
		closed.gone = "deleted";
		fake.calls = [];
		const result = syncIssues(dir, {
			now: fakeNow,
			run: fake.run,
			env,
		});
		expect(result.full).toBe(false);
		expect(fake.calls.filter((c) => PER_ISSUE.test(c.path))).toEqual([]);
		// Left as it was: only a full re-list notices a closed issue went away.
		expect(result.dropped).toEqual([]);
		expect(result.cache.issues.find((i) => i.number === 2)?.state).toBe("closed");
	});

	it("an issue closed since the last sync is kept, closed, not dropped", () =>
	{
		const fake = quietStories(3);
		syncIssues(dir, {
			now: fakeNow,
			run: fake.run,
			env,
		});
		// Closed before this sync starts: only the since listing has it, so it must count as seen.
		const two = fake.issues.get(2)!;
		two.state = "closed";
		two.state_reason = "completed";
		two.updated_at = fake.now();
		const result = syncIssues(dir, {
			now: fakeNow,
			run: fake.run,
			env,
		});
		expect(result.full).toBe(false);
		expect(result.dropped).toEqual([]);
		expect(result.cache.issues.map((i) => [i.number, i.state])).toEqual([[1, "open"], [2, "closed"], [3, "open"]]);
	});

	it("an open-listing page shift never drops the issue that moved onto a page already read", () =>
	{
		const fake = quietStories(150);
		syncIssues(dir, {
			now: fakeNow,
			run: fake.run,
			env,
		});
		fake.calls = [];
		// Close #5 once, after the open listing's first page and before its second: #101 moves up
		// onto page 1, already read, so the first open listing never returns it, and it is quiet, so
		// the since listing doesn't either.
		let closed = false;
		fake.intercept = (call, f) =>
		{
			if (!closed && call.path.includes("state=open") && call.path.includes("page=2"))
			{
				closed = true;
				const five = f.issues.get(5)!;
				five.state = "closed";
				five.state_reason = "completed";
				five.updated_at = f.now();
			}
			return undefined;
		};
		const result = syncIssues(dir, {
			now: fakeNow,
			run: fake.run,
			env,
		});
		expect(result.full).toBe(false);
		expect(result.dropped).toEqual([]);
		expect(result.cache.dropped).toBeUndefined();
		expect(result.cache.issues.find((i) => i.number === 101)?.state).toBe("open");
		expect(result.cache.issues.find((i) => i.number === 5)?.state).toBe("closed");
		// The candidate (#101) made the sync read the open listing a second time: two pages, twice.
		expect(fake.calls.filter((c) => c.path.includes("state=open"))).toHaveLength(4);
		expect(fake.calls.filter((c) => PER_ISSUE.test(c.path))).toEqual([]);
	});

	it("an open issue missing from the cache comes back on the next incremental sync, and leaves the dropped list", () =>
	{
		const fake = quietStories(3);
		syncIssues(dir, {
			now: fakeNow,
			run: fake.run,
			env,
		});
		dropWrongly(2);
		const result = syncIssues(dir, {
			now: fakeNow,
			run: fake.run,
			env,
		});
		expect(result.full).toBe(false);
		expect(result.cache.issues.map((i) => [i.number, i.state])).toEqual([[1, "open"], [2, "open"], [3, "open"]]);
		expect(result.cache.dropped).toBeUndefined();
		expect(removedSince(readCache(env.BT_BACKLOG_CACHE!)!, "2000-01-01T00:00:00Z")).toEqual([]);
	});

	it("the incremental sync after a full sync prunes a dropped entry whose issue the full sync listed again", () =>
	{
		const fake = quietStories(3);
		syncIssues(dir, {
			now: fakeNow,
			run: fake.run,
			env,
		});
		dropWrongly(2);
		// A full sync lists as before: it puts #2 back and leaves the dropped list as it was.
		const full = syncIssues(dir, {
			now: fakeNow,
			run: fake.run,
			env,
			full: true,
		});
		expect(full.full).toBe(true);
		expect(full.cache.issues.map((i) => i.number)).toEqual([1, 2, 3]);
		expect(full.cache.dropped?.map((d) => `${d.id} #${d.number}`)).toEqual(["S2 #2"]);
		// The next incremental sync finds #2 in the cache and prunes its entry.
		const next = syncIssues(dir, {
			now: fakeNow,
			run: fake.run,
			env,
		});
		expect(next.full).toBe(false);
		expect(next.cache.dropped).toBeUndefined();
		expect(removedSince(readCache(env.BT_BACKLOG_CACHE!)!, "2000-01-01T00:00:00Z")).toEqual([]);
	});

	it("an issue deleted between the two open listings is not added back", () =>
	{
		const fake = quietStories(4);
		syncIssues(dir, {
			now: fakeNow,
			run: fake.run,
			env,
		});
		// #2 was dropped wrongly before; #4 is deleted now, so the sync reads the open listing twice.
		// #2 is deleted after the first open listing: only the second, read last, says what is open.
		dropWrongly(2);
		fake.issues.get(4)!.gone = "deleted";
		fake.intercept = (call, f) =>
		{
			if (call.path.includes("since="))
			{
				f.issues.get(2)!.gone = "deleted";
			}
			return undefined;
		};
		const result = syncIssues(dir, {
			now: fakeNow,
			run: fake.run,
			env,
		});
		expect(result.full).toBe(false);
		expect(result.dropped).toEqual([4]);
		expect(result.cache.issues.map((i) => i.number)).toEqual([1, 3]);
	});

	it("pull requests in the open listing are left out of the cache", () =>
	{
		const fake = quietStories(1);
		fake.add({
			title: "a pull request",
			updated_at: QUIET,
			pull_request: {
				url: "https://example.test/pulls/2",
			},
		});
		syncIssues(dir, {
			now: fakeNow,
			run: fake.run,
			env,
		});
		const result = syncIssues(dir, {
			now: fakeNow,
			run: fake.run,
			env,
		});
		expect(result.full).toBe(false);
		expect(fake.calls.some((c) => c.path.includes("state=open"))).toBe(true);
		expect(result.cache.issues.map((i) => i.number)).toEqual([1]);
	});

	it("two syncs at once each write their own temporary file, and the cache is one whole copy", () =>
	{
		const cache = join(dir, "cache");
		const script = (n: number) => `import { writeCache } from ${JSON.stringify(join(HERE, "github.ts"))};
import { writeFileSync } from "node:fs";
for (let k = 0; k < 50; k++) writeCache(${JSON.stringify(cache)}, { repo: "o/r", trusted: [], syncedAt: "x", issues: Array.from({ length: 200 }, (_, i) => ({ number: i, title: "w${n}" })) },
  (f, t) => { process.stdout.write(f + "\\n"); writeFileSync(f, t); });`;
		const runs = [1, 2].map((n) => spawnSync(process.execPath, ["--input-type=module", "-e", script(n)], {
			encoding: "utf8",
		}));
		const tmps = runs.map((r) => new Set(r.stdout.trim().split("\n")));
		expect(runs.every((r) => r.status === 0)).toBe(true);
		const [x, y] = tmps.map((t) => [...t]);
		expect(x).toHaveLength(1);
		expect(y).toHaveLength(1);
		expect(x![0]).not.toBe(y![0]);
		expect(x![0]).toMatch(/issues\.json\.\d+\.tmp$/);
		const final = readCache(cache)!;
		expect(final.issues).toHaveLength(200);
		expect(readdirSync(cache)).toEqual(["issues.json"]);
	});

	it("a failed write leaves the old cache whole and no temporary file", () =>
	{
		const cache = join(dir, "cache");
		const old: IssueCache = {
			repo: "o/r",
			trusted: ["o"],
			syncedAt: "2026-11-20T00:00:00Z",
			issues: [],
		};
		writeCache(cache, old);
		expect(() => writeCache(cache, {
			...old,
			syncedAt: "new",
		}, (f, t) =>
		{
			writeFileSync(f, t.slice(0, 5));
			throw new Error("disk full");
		})).toThrow("disk full");
		expect(readCache(cache)).toEqual(old);
		expect(readdirSync(cache)).toEqual(["issues.json"]);
	});

	it("the cache is found from a worktree: the main checkout's .backlog-cache/", () =>
	{
		const repo = join(dir, "main");
		mkdirSync(repo);
		const git = (args: string[], cwd = repo) => spawnSync("git", args, {
			cwd,
			encoding: "utf8",
			env: {
				...process.env,
				GIT_AUTHOR_NAME: "T",
				GIT_AUTHOR_EMAIL: "t@e",
				GIT_COMMITTER_NAME: "T",
				GIT_COMMITTER_EMAIL: "t@e",
			},
		});
		git(["init", "-q"]);
		git(["commit", "-q", "--allow-empty", "-m", "x"]);
		git(["worktree", "add", "-q", join(repo, ".claude/worktrees/S9")]);
		const real = (p: string) => spawnSync("realpath", [p], {
			encoding: "utf8",
		}).stdout.trim();
		expect(real(dirname(cacheDir(join(repo, ".claude/worktrees/S9"), {})))).toBe(real(repo));
		expect(cacheDir(repo, {}).endsWith(".backlog-cache")).toBe(true);
	});
});

describe("trusted IDs and items (AC 1)", () =>
{
	const trusted = ["owner"];

	it("leaves out a pull request titled S12: x", () =>
	{
		expect(trustedId(issue({
			title: "S12: x",
			labels: [{
				name: "story",
			}],
			pull_request: {},
		}), trusted)).toBeUndefined();
	});

	it("gives no ID to an outsider's issue titled S12: x, with or without the story label", () =>
	{
		for (const labels of [[], [{
			name: "story",
		}]])
		{
			expect(trustedId(issue({
				title: "S12: x",
				labels,
				user: {
					login: "stranger",
				},
			}), trusted)).toBeUndefined();
		}
	});

	it("an outsider-filed issue takes ID B<number> once the owner labels it bug", () =>
	{
		const filed = issue({
			number: 77,
			title: "Scores don't load",
			user: {
				login: "stranger",
			},
			body: "it broke",
		});
		expect(trustedId(filed, trusted)).toBeUndefined();
		expect(trustedId({
			...filed,
			labels: [{
				name: "bug",
			}],
		}, trusted)).toBe("B77");
	});

	it("keeps S1 and S10 apart", () =>
	{
		const cache: IssueCache = {
			repo: "owner/bt",
			trusted,
			syncedAt: "x",
			issues: [issue({
				number: 5,
				title: "S10: ten",
				labels: [{
					name: "story",
				}],
			}), issue({
				number: 6,
				title: "S1: one",
				labels: [{
					name: "story",
				}],
			})],
		};
		expect(findIssue(cache, "S1")!.number).toBe(6);
		expect(findIssue(cache, "S10")!.number).toBe(5);
		expect(findIssue(cache, "S100")).toBeUndefined();
	});

	it("maps each label and state to a status", () =>
	{
		const cases: [Partial<CachedIssue>, string][] = [
			[{
				labels: [{
					name: "status:todo",
				}],
			}, "todo"],
			[{
				labels: [{
					name: "status:doing",
				}],
			}, "doing"],
			[{
				labels: [{
					name: "status:blocked",
				}],
			}, "blocked"],
			[{
				labels: [],
			}, "todo"],
			[{
				state: "closed",
				state_reason: "completed",
				labels: [{
					name: "status:doing",
				}],
			}, "done"],
			[{
				state: "closed",
				state_reason: "completed",
				labels: [{
					name: "status:done",
				}],
			}, "done"],
			[{
				state: "closed",
				state_reason: "not_planned",
				labels: [{
					name: "status:superseded",
				}],
			}, "superseded"],
		];
		for (const [over, status] of cases)
		{
			expect(statusOf(issue({
				title: "S1: a",
				...over,
			}))).toBe(status);
		}
	});

	it("a story's fields block missing or unparseable is an error naming the issue", () =>
	{
		const story = (body: string) => issue({
			number: 41,
			title: "S9: x",
			labels: [{
				name: "story",
			}],
			body,
		});
		expect(() => itemFromIssue(story("**Gap:** no block"), trusted)).toThrow(/issue #41 \(S9\)/);
		expect(() => itemFromIssue(story("### Backlog fields\n\n```yaml\npriority: [\n```\n"), trusted)).toThrow(/issue #41 \(S9\).*does not parse/);
	});

	it("accepts an unaccepted bug with no fields block, sorting it last", () =>
	{
		const bug = itemFromIssue(issue({
			number: 88,
			title: "Video stalls",
			labels: [{
				name: "bug",
			}],
			body: "steps…",
		}), trusted)!;
		expect(bug.id).toBe("B88");
		expect(bug.kind).toBe("bug");
		expect(bug.priority).toBe(Number.POSITIVE_INFINITY);
	});

	it("reads a fractional priority from the fields block", () =>
	{
		const item = itemFromIssue(issue({
			title: "S7: seven",
			labels: [{
				name: "story",
			}],
			body: storyBody(12.5),
		}), trusted)!;
		expect(item.priority).toBe(12.5);
		expect(item.title).toBe("seven");
		expect(item.scopeFiles).toEqual(["scripts/x.ts"]);
		expect(item.source).toBe("Feature: X");
	});

	it("githubSource reads the cache, and with none says to run pnpm backlog:sync", async () =>
	{
		await expect(githubSource(dir, env).items()).rejects.toBeInstanceOf(NoCacheError);
		await expect(githubSource(dir, env).items()).rejects.toThrow("run pnpm backlog:sync");
		writeCache(env.BT_BACKLOG_CACHE!, {
			repo: "owner/bt",
			trusted,
			syncedAt: "x",
			issues: [issue({
				title: "S3: c",
				labels: [{
					name: "story",
				}],
			}), issue({
				number: 2,
				title: "chatter",
			})],
		});
		expect((await githubSource(dir, env).items()).map((i) => i.id)).toEqual(["S3"]);
		expect(itemsFromCache(readCache(env.BT_BACKLOG_CACHE!)!).items).toHaveLength(1);
	});
});

describe("requests (AC 1)", () =>
{
	it("nextPage reads the Link header's next page (moved here from search.test.ts with the paging), and none on the last page", () =>
	{
		expect(nextPage("Link: <https://api.github.com/repositories/1/issues?page=2>; rel=\"next\"")).toBe("repositories/1/issues?page=2");
		expect(nextPage("Link: <https://api.github.com/x?page=1>; rel=\"prev\"")).toBeUndefined();
		expect(nextPage("")).toBeUndefined();
	});

	it("waits out a secondary rate limit and makes the same call again", () =>
	{
		let first = true;
		const waits: number[] = [];
		const r = request((args) =>
		{
			if (first)
			{
				first = false;
				return "HTTP/2.0 403 Forbidden\n\n{\"message\":\"You have exceeded a secondary rate limit\"}";
			}
			return `HTTP/2.0 200 OK\n\n${JSON.stringify(args)}`;
		}, "GET", "x", [], (ms) => waits.push(ms));
		expect(waits).toEqual([60_000]);
		expect(r.status).toBe(200);
	});

	it("the state commands change GitHub only through PATCH", () =>
	{
		const fake = new FakeGithub();
		fake.add({
			title: "S4: four",
			labels: [{
				name: "story",
			}, {
				name: "status:todo",
			}],
			body: storyBody(),
		});
		main(["sync"], fake.run, dir, env);
		expect(main(["status", "S4", "done"], fake.run, dir, env)).toContain("closed");
		expect(fake.issues.get(1)!.state_reason).toBe("completed");
		expect(fake.issues.get(1)!.labels.map((l) => l.name)).toEqual(["story", "status:done"]);
		main(["milestone", "S4", "v3.1.0"], fake.run, dir, env);
		expect(fake.issues.get(1)!.milestone?.title).toBe("v3.1.0");
		expect(main(["item", "4"], fake.run, dir, env)).toContain("**Gap:**");
		expect(existsSync(join(env.BT_BACKLOG_CACHE!, "issues.json"))).toBe(true);
		expect(readFileSync(join(env.BT_BACKLOG_CACHE!, "issues.json"), "utf8")).toContain("S4: four");
		expect(fake.calls.filter((c) => c.method !== "GET").every((c) => c.method === "PATCH")).toBe(true);
	});

	it("gives up after MAX_RATE_LIMIT_WAITS rate-limit waits instead of retrying forever", () =>
	{
		const waits: number[] = [];
		expect(() => request(() => "HTTP/2.0 403 Forbidden\nretry-after: 1\n\n{}", "GET", "x", [], (ms) => waits.push(ms))).toThrow(/still rate-limited/);
		expect(waits).toHaveLength(MAX_RATE_LIMIT_WAITS);
	});
});

describe("the state commands and the overlay (AC 1, AC 3)", () =>
{
	/** The fake with S4 (open, todo) and a synced cache. */
	function synced(): FakeGithub
	{
		const fake = new FakeGithub();
		fake.add({
			title: "S4: four",
			labels: [{
				name: "story",
			}, {
				name: "status:todo",
			}],
			body: goalBody("/goal S4 (S4). from GitHub"),
		});
		main(["sync"], fake.run, dir, env);
		return fake;
	}

	it("status reads the issue fresh: a label added on GitHub after the sync survives, and the cache holds the result with its syncedAt kept", () =>
	{
		const fake = synced();
		const syncedAt = readCache(env.BT_BACKLOG_CACHE!)!.syncedAt;
		fake.issues.get(1)!.labels.push({
			name: "area:video",
		});
		main(["status", "S4", "doing"], fake.run, dir, env);
		expect(fake.issues.get(1)!.labels.map((l) => l.name).sort()).toEqual(["area:video", "status:doing", "story"]);
		const cached = readCache(env.BT_BACKLOG_CACHE!)!;
		expect(cached.issues[0]!.labels.map((l) => l.name).sort()).toEqual(["area:video", "status:doing", "story"]);
		expect(cached.syncedAt).toBe(syncedAt);
		main(["label", "S4", "--add", "area:scores"], fake.run, dir, env);
		expect(readCache(env.BT_BACKLOG_CACHE!)!.issues[0]!.labels.map((l) => l.name)).toContain("area:scores");
	});

	it("label refuses status:* and removing story or bug", () =>
	{
		const fake = synced();
		expect(() => main(["label", "S4", "--add", "status:doing"], fake.run, dir, env)).toThrow(/status command/);
		expect(() => main(["label", "S4", "--remove", "story"], fake.run, dir, env)).toThrow(/never changes story/);
		expect(fake.calls.filter((c) => c.method === "PATCH")).toEqual([]);
	});

	it("item and goal read the newest text record over the cache's body (the overlay), and the cache's body with no record", () =>
	{
		const fake = synced();
		expect(main(["item", "S4", "goal"], fake.run, dir, env)).toBe("/goal S4 (S4). from GitHub");
		const m = record("migration", "S4", goalBody("/goal S4 (S4). migrated"), {
			issue: 1,
			base: "b",
		});
		record("edit", "S4", goalBody("/goal S4 (S4). edited, not yet applied"), {
			from: m.hash,
			issue: 1,
		});
		expect(main(["item", "4", "goal"], fake.run, dir, env)).toBe("/goal S4 (S4). edited, not yet applied");
		expect(main(["item", "S4"], fake.run, dir, env)).toContain("edited, not yet applied");
	});

	it("goal works for a recorded create with no issue yet", () =>
	{
		const fake = synced();
		record("create", "S20", goalBody("/goal S20 (S20). new"), {
			title: "twenty",
			reason: "r",
		});
		expect(main(["item", "S20", "goal"], fake.run, dir, env)).toBe("/goal S20 (S20). new");
		expect(() => main(["item", "S21", "goal"], fake.run, dir, env)).toThrow(/no trusted issue or text record carries S21/);
	});

	it("item and goal refuse a skipped ID, quoting its problem", () =>
	{
		const fake = synced();
		fake.add({
			title: "S9: broken",
			labels: [{
				name: "story",
			}],
			body: "**Gap:** no fields",
		});
		main(["sync", "--full"], fake.run, dir, env);
		expect(() => main(["item", "S9", "goal"], fake.run, dir, env)).toThrow(/S9 is skipped by the backlog: .*no ### Backlog fields section/);
	});

	it("a CRLF body parses its fields and /goal line (GitHub's web editor saves CRLF)", () =>
	{
		const fake = new FakeGithub();
		fake.add({
			title: "S4: four",
			labels: [{
				name: "story",
			}],
			body: goalBody("/goal S4 (S4). crlf", 3.5).replace(/\n/g, "\r\n"),
		});
		main(["sync"], fake.run, dir, env);
		expect(main(["item", "S4", "goal"], fake.run, dir, env)).toBe("/goal S4 (S4). crlf");
		const item = itemsFromCache(readCache(env.BT_BACKLOG_CACHE!)!).items[0]!;
		expect(item.priority).toBe(3.5);
		expect(item.body).not.toContain("\r");
	});

	it("taken and next-id: an ID an issue, a local record or a stage fragment holds is taken, and one with a leading zero is never valid", () =>
	{
		const fake = synced();
		const cache = readCache(env.BT_BACKLOG_CACHE!)!;
		const records = [record("create", "S30", goalBody("/goal S30 (S30). x"), {
			title: "t",
			reason: "r",
		})];
		expect(idTaken("S4", cache, records, [])).toMatch(/issue #1 carries S4/);
		expect(idTaken("S30", cache, records, [])).toMatch(/records S30/);
		expect(idTaken("S31", cache, records, ["20261121T000000Z-S31-create.md"])).toMatch(/stage's .* records S31/);
		expect(idTaken("S031", cache, records, [])).toMatch(/no leading zero/);
		expect(idTaken("S32", cache, records, ["20261121T000000Z-S31-create.md"])).toBeUndefined();
		expect(idTaken("S32", undefined, [], [])).toBeUndefined();
		expect(nextStoryId(cache, records, ["20261121T000000Z-S31-create.md"])).toBe("S32");
		expect(() => main(["taken", "S4"], fake.run, dir, {
			...env,
			BT_STAGE_REF: "refs/no/such/ref",
		})).toThrow(/S4 is taken: issue #1 carries S4/);
	});

	it("removed --since reads closed_at, never updated_at, and leaves out a closure the migration made", () =>
	{
		const closed = (number: number, closedAt: string, updatedAt: string, reason = "not_planned") => issue({
			number,
			title: `S${number}: x`,
			state: "closed",
			state_reason: reason,
			labels: [{
				name: "story",
			}],
			closed_at: closedAt,
			updated_at: updatedAt,
		});
		const cache: IssueCache = {
			repo: "owner/bt",
			trusted: ["owner"],
			syncedAt: "x",
			issues: [
				closed(7, "2026-11-21T05:00:00Z", "2026-11-21T05:00:00Z"),
				// Closed long ago, touched today: updated_at moved, closed_at didn't.
				closed(8, "2026-11-01T05:00:00Z", "2026-11-21T06:00:00Z"),
				closed(9, "2026-11-21T05:00:00Z", "2026-11-21T05:00:00Z", "completed"),
				// Closed by the migration (its migration record was captured after the closure).
				closed(10, "2026-11-20T23:59:00Z", "2026-11-21T07:00:00Z"),
			],
		};
		const migration = record("migration", "S10", storyBody(), {
			issue: 10,
			base: "b",
		});
		expect(migration.file).toMatch(/T0000\d\dZ-S10-migration/);
		expect(removedSince(cache, "2026-11-20T00:00:00Z", [migration])).toEqual(["S7"]);
		expect(main(["removed", "--since", "2026-11-20T00:00:00Z"], new FakeGithub().run, dir, env)).toBe("");
	});

	it("removed --since counts a story a full sync dropped as deleted, from the cache's dropped list", () =>
	{
		const fake = new FakeGithub();
		const gone = fake.add({
			title: "S1: a",
			labels: [{
				name: "story",
			}],
		});
		fake.add({
			title: "S2: b",
			labels: [{
				name: "story",
			}],
		});
		syncIssues(dir, {
			now: fakeNow,
			run: fake.run,
			env,
		});
		gone.gone = "deleted";
		const result = syncIssues(dir, {
			now: fakeNow,
			run: fake.run,
			env,
			full: true,
		});
		expect(result.cache.dropped?.map((d) => `${d.id} #${d.number}`)).toEqual(["S1 #1"]);
		expect(removedSince(readCache(env.BT_BACKLOG_CACHE!)!, "2000-01-01T00:00:00Z")).toEqual(["S1"]);
		expect(removedSince(readCache(env.BT_BACKLOG_CACHE!)!, "2999-01-01T00:00:00Z")).toEqual([]);
		expect(main(["removed", "--since", "2000-01-01T00:00:00Z"], fake.run, dir, env)).toBe("S1");
	});
});

describe("trusted IDs, accepted bugs and broken items (AC 1)", () =>
{
	const trusted = ["owner"];

	it("S0163: carries no ID (a leading zero is not S163)", () =>
	{
		expect(trustedId(issue({
			title: "S0163: x",
			labels: [{
				name: "story",
			}],
		}), trusted)).toBeUndefined();
	});

	it("an outsider's edit to a bug's fields block doesn't change its priority (unrecorded fields): a bug is accepted only by its record", () =>
	{
		const bug = issue({
			number: 88,
			title: "Video stalls",
			labels: [{
				name: "bug",
			}],
			user: {
				login: "stranger",
			},
			body: `steps\n\n${fields(0)}`,
		});
		expect(itemFromIssue(bug, trusted)!.priority).toBe(Number.POSITIVE_INFINITY);
		const accepted = record("create", "B88", fields(3), {
			issue: 88,
		});
		const item = itemFromIssue(bug, trusted, [accepted])!;
		expect(item.priority).toBe(3);
		expect(item.body).toBe(`steps\n\n${fields(3)}`);
	});

	it("a bug's recorded `group` is read onto the item; a story's is not (only bugs are grouped)", () =>
	{
		const bug = issue({
			number: 88,
			title: "Video stalls",
			labels: [{
				name: "bug",
			}],
			body: "steps",
		});
		const grouped = "### Backlog fields\n\n```yaml\npriority: 3\ngroup: \"videos-room\"\n```\n";
		expect(itemFromIssue(bug, trusted, [record("create", "B88", grouped, {
			issue: 88,
		})])!.group).toBe("videos-room");
		expect(itemFromIssue(bug, trusted, [record("create", "B88", fields(3), {
			issue: 88,
		})])!.group).toBeUndefined();
		const story = itemFromIssue(issue({
			number: 41,
			title: "S9: x",
			labels: [{
				name: "story",
			}],
			body: `**Gap:** x\n\n${grouped}`,
		}), trusted)!;
		expect(story.group).toBeUndefined();
	});

	it("a broken item is skipped and reported, and two issues carrying one ID are both skipped; the rest are listed", () =>
	{
		const story = (number: number, title: string, body: string) => issue({
			number,
			title,
			labels: [{
				name: "story",
			}],
			body,
		});
		const { items, problems } = itemsFromCache({
			repo: "owner/bt",
			trusted,
			syncedAt: "x",
			issues: [story(41, "S9: broken", "**Gap:** none"), story(42, "S5: one", storyBody()), story(43, "S5: two", storyBody()), story(44, "S6: fine", storyBody())],
		});
		expect(items.map((i) => i.id)).toEqual(["S6"]);
		expect(problems.map((p) => `${p.id} #${p.issue}`)).toEqual(["S9 #41", "S5 #42", "S5 #43"]);
		expect(problems[0]!.message).toMatch(/issue #41 \(S9\)/);
		expect(problems[1]!.message).toMatch(/S5 is carried by more than one trusted issue \(#42, #43\)/);
	});
});
