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
	cacheDir, findIssue, githubSource, itemFromIssue, itemsFromCache, main, nextPage, NoCacheError, readCache, request, statusOf, syncIssues, trustedId, writeCache,
} from "./github.ts";
import { FakeGithub } from "./github-fake.ts";
import { renderFields } from "./text-records.ts";

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
	};
});
afterEach(() => rmSync(dir, {
	recursive: true,
	force: true,
}));

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
			run: fake.run,
			env,
		});
		a.gone = "deleted";
		b.gone = "transferred";
		const result = syncIssues(dir, {
			run: fake.run,
			env,
			full: true,
		});
		expect(result.dropped).toEqual([1, 2]);
		expect(result.cache.issues.map((i) => i.number)).toEqual([3]);
		expect(main(["sync", "--full"], fake.run, dir)).not.toContain("dropped");
	});

	it("drops a deleted and a transferred issue on an incremental sync, by reading each open backlog issue the listing left out", () =>
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
			run: fake.run,
			env,
		});
		a.gone = "deleted";
		b.gone = "transferred";
		const result = syncIssues(dir, {
			run: fake.run,
			env,
		});
		expect(result.full).toBe(false);
		expect(result.dropped).toEqual([1, 2]);
		expect(result.cache.issues.map((i) => i.number)).toEqual([3]);
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
		expect(itemsFromCache(readCache(env.BT_BACKLOG_CACHE!)!)).toHaveLength(1);
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
		const e = process.env.BT_BACKLOG_CACHE;
		process.env.BT_BACKLOG_CACHE = env.BT_BACKLOG_CACHE;
		try
		{
			main(["sync"], fake.run, dir);
			expect(main(["status", "S4", "done"], fake.run, dir)).toContain("closed");
			expect(fake.issues.get(1)!.state_reason).toBe("completed");
			expect(fake.issues.get(1)!.labels.map((l) => l.name)).toEqual(["story", "status:done"]);
			main(["milestone", "S4", "v3.1.0"], fake.run, dir);
			expect(fake.issues.get(1)!.milestone?.title).toBe("v3.1.0");
			expect(main(["item", "4"], fake.run, dir)).toContain("**Gap:**");
			expect(existsSync(join(env.BT_BACKLOG_CACHE!, "issues.json"))).toBe(true);
			expect(readFileSync(join(env.BT_BACKLOG_CACHE!, "issues.json"), "utf8")).toContain("S4: four");
		}
		finally
		{
			process.env.BT_BACKLOG_CACHE = e;
		}
	});
});
