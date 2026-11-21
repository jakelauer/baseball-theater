/**
 * `pnpm backlog:check` is reproducible at any commit (S164 AC 2): it reads the tree and the ledger's
 * fragments only, never the issue cache or GitHub. A throwaway repository gets two commits: the
 * backlog as it is in this checkout's HEAD, then a later one that records a migration while a note is
 * still there (which the check refuses). Run in a worktree at the older commit, with a cache that
 * holds a later `done` story and `gh` broken, the check gives the verdict it gives there with no cache.
 * The tree comes from `git archive HEAD`, not from older history, since CI's checkout is shallow.
 */
import { spawnSync } from "node:child_process";
import {
	chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	afterAll, beforeAll, describe, expect, it,
} from "vitest";
import { renderFields, renderRecord } from "./text-records.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
let dir = "";
let repo = "";

const env = {
	...process.env,
	GIT_AUTHOR_NAME: "T",
	GIT_AUTHOR_EMAIL: "t@e",
	GIT_COMMITTER_NAME: "T",
	GIT_COMMITTER_EMAIL: "t@e",
};
function git(args: string[], cwd = repo): string
{
	const r = spawnSync("git", args, {
		cwd,
		encoding: "utf8",
		env,
		maxBuffer: 64 * 1024 * 1024,
	});
	if (r.status !== 0)
	{
		throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
	}
	return r.stdout;
}

/** `pnpm backlog:check` on a checkout at `wt`, with the given environment additions. */
function check(wt: string, extra: Record<string, string>): { status: number | null;
	out: string }
{
	const r = spawnSync(process.execPath, [join(HERE, "cli.ts"), "check", "--dir", join(wt, "docs/v3/backlog"), "--audit", join(wt, "docs/v3/AUDIT.md"),
		"--index", join(dir, "audit.jsonl"), "--quiet"], {
		encoding: "utf8",
		env: {
			...env,
			...extra,
		},
	});
	return {
		status: r.status,
		out: `${r.stdout}${r.stderr}`,
	};
}

beforeAll(() =>
{
	dir = mkdtempSync(join(tmpdir(), "s164-check-at-commit-"));
	repo = join(dir, "repo");
	mkdirSync(repo);
	git(["init", "-q"]);
	const archive = spawnSync("git", ["archive", "HEAD", "docs/v3", "changelog.d"], {
		cwd: ROOT,
		maxBuffer: 256 * 1024 * 1024,
	});
	spawnSync("tar", ["-x", "-C", repo], {
		input: archive.stdout,
	});
	git(["add", "-A"]);
	git(["commit", "-q", "-m", "older: the notes"]);
	// A migration record for an item of its own, and a bug note left beside it: refused whether or not HEAD is migrated.
	const frag = join(repo, "docs/v3/audit/2030-01-01/20300101T000000Z-B99999-migration.md");
	mkdirSync(dirname(frag), {
		recursive: true,
	});
	writeFileSync(frag, renderRecord({
		kind: "migration",
		id: "B99999",
		date: "2030-01-01",
		stamp: "2030-01-01T00:00:00Z",
		head: "abc",
		body: renderFields({
			priority: 1,
		}),
		issue: 99999,
		base: "abc",
	}));
	mkdirSync(join(repo, "docs/v3/backlog/bugs/todo"), {
		recursive: true,
	});
	writeFileSync(join(repo, "docs/v3/backlog/bugs/todo/B99999.md"), "---\nid: B99999\nissue: 99999\ntitle: a bug\npriority: 1\nstatus: todo\n---\n\nhttps://example.test/issues/99999\n");
	git(["add", "-A"]);
	git(["commit", "-q", "-m", "later: a migration record with the notes still there"]);
});
afterAll(() => rmSync(dir, {
	recursive: true,
	force: true,
}));

describe("backlog:check at a commit (AC 2)", () =>
{
	it("gives the older commit's own verdict while the cache holds a later done story and gh is broken", () =>
	{
		const older = git(["rev-parse", "HEAD~1"]).trim();
		const wt = join(dir, "wt");
		git(["worktree", "add", "-q", "--detach", wt, older]);
		const cache = join(dir, "cache");
		mkdirSync(cache);
		writeFileSync(join(cache, "issues.json"), JSON.stringify({
			repo: "o/r",
			trusted: ["o"],
			syncedAt: "2030-01-01T00:00:00Z",
			issues: [{
				number: 9,
				title: "S9999: from the future",
				state: "closed",
				state_reason: "completed",
				labels: [{
					name: "story",
				}, {
					name: "status:done",
				}],
				user: {
					login: "o",
				},
				body: "no fields block",
			}],
		}));
		const bin = join(dir, "bin");
		mkdirSync(bin);
		writeFileSync(join(bin, "gh"), "#!/bin/sh\nexit 1\n");
		chmodSync(join(bin, "gh"), 0o755);
		const withCache = check(wt, {
			BT_BACKLOG_CACHE: cache,
			PATH: `${bin}:${process.env.PATH}`,
			GH_TOKEN: "",
		});
		const without = check(wt, {
			BT_BACKLOG_CACHE: join(dir, "none"),
		});
		expect(without.status).toBe(0);
		expect(withCache).toEqual(without);
	});

	it("and the later commit gets its own verdict: a migration record with notes left is refused", () =>
	{
		const later = check(repo, {
			BT_BACKLOG_CACHE: join(dir, "none"),
		});
		expect(later.status).toBe(1);
		expect(later.out).toMatch(/no note belongs/);
	});
});
