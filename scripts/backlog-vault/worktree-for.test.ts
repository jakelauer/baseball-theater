/**
 * scripts/worktree-for.sh (S156 AC 1; #110): a new item's port slot comes from its name, skipping a
 * slot another worktree's .env.worktree already holds, and re-running for an item keeps its
 * .env.worktree as it is. Runs the real script with --no-install in a throwaway repository.
 */
import { spawnSync } from "node:child_process";
import {
	copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	afterEach, beforeEach, describe, expect, it,
} from "vitest";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "../worktree-for.sh");

let repo = "";

function run(cmd: string, args: string[]): string
{
	const r = spawnSync(cmd, args, {
		cwd: repo,
		encoding: "utf8",
		env: {
			...process.env,
			GIT_AUTHOR_NAME: "Test",
			GIT_AUTHOR_EMAIL: "test@example.com",
			GIT_COMMITTER_NAME: "Test",
			GIT_COMMITTER_EMAIL: "test@example.com",
		},
	});
	if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")}: ${r.stderr}`);
	return r.stdout;
}

/** The slot the script derives from a name: cksum's CRC mod 999, plus 1. */
function slotFor(item: string): number
{
	const crc = Number(spawnSync("cksum", {
		input: item,
		encoding: "utf8",
	}).stdout.split(" ")[0]);
	return crc % 999 + 1;
}

const env = (item: string) => readFileSync(join(repo, ".claude/worktrees", item, ".env.worktree"), "utf8");
const slotIn = (text: string) => Number(/^export BT_WORKTREE_SLOT=(\d+)$/m.exec(text)?.[1]);

beforeEach(() =>
{
	repo = mkdtempSync(join(tmpdir(), "worktree-for-"));
	run("git", ["init", "-q", "-b", "stage"]);
	mkdirSync(join(repo, "scripts"));
	copyFileSync(SCRIPT, join(repo, "scripts/worktree-for.sh"));
	writeFileSync(join(repo, ".gitignore"), ".claude/worktrees/\n");
	run("git", ["add", "-A"]);
	run("git", ["-c", "core.hooksPath=/dev/null", "commit", "-q", "-m", "base"]);
});

afterEach(() => rmSync(repo, {
	recursive: true,
	force: true,
}));

describe("worktree-for.sh --no-install", () =>
{
	it("skips a slot another worktree's .env.worktree holds", () =>
	{
		const taken = slotFor("S2");
		mkdirSync(join(repo, ".claude/worktrees/other"), {
			recursive: true,
		});
		writeFileSync(join(repo, ".claude/worktrees/other/.env.worktree"), `export BT_WORKTREE_SLOT=${taken}\n`);
		run("bash", ["scripts/worktree-for.sh", "--no-install", "S2", "HEAD"]);
		const slot = slotIn(env("S2"));
		expect(slot).toBe(taken % 999 + 1);
		expect(env("S2")).toContain(`export PGLITE_PORT=${26000 + slot}`);
		expect(run("git", ["-C", join(repo, ".claude/worktrees/S2"), "symbolic-ref", "--short", "HEAD"]).trim()).toBe("story/S2");
	});

	it("keeps an item's .env.worktree byte for byte on a re-run", () =>
	{
		run("bash", ["scripts/worktree-for.sh", "--no-install", "S1", "HEAD"]);
		const first = env("S1");
		expect(slotIn(first)).toBe(slotFor("S1"));
		const again = run("bash", ["scripts/worktree-for.sh", "--no-install", "S1", "HEAD"]);
		expect(again).toContain("already exists");
		expect(env("S1")).toBe(first);
	});
});

describe("with no issue cache (S164 AC 3)", () =>
{
	it("worktree-for.sh and pnpm backlog:build (what the post-checkout and post-merge hooks run) exit 0 with no cache, saying to sync", () =>
	{
		const noCache = {
			...process.env,
			BT_BACKLOG_CACHE: join(repo, "no-cache"),
		};
		const made = spawnSync("bash", ["scripts/worktree-for.sh", "--no-install", "S5", "HEAD"], {
			cwd: repo,
			encoding: "utf8",
			env: noCache,
		});
		expect(made.status, made.stderr).toBe(0);
		// It made the worktree, with no network and no cache.
		expect(existsSync(join(repo, ".claude/worktrees/S5/.git"))).toBe(true);
		// The backlog as this checkout has it (git archive, not history: CI's checkout is shallow), built with no cache.
		const ROOT = join(dirname(SCRIPT), "..");
		const archive = spawnSync("git", ["archive", "HEAD", "docs/v3", "changelog.d"], {
			cwd: ROOT,
			maxBuffer: 256 * 1024 * 1024,
		});
		spawnSync("tar", ["-x", "-C", repo], {
			input: archive.stdout,
		});
		const build = spawnSync(process.execPath, [join(ROOT, "scripts/backlog-vault/cli.ts"), "build", "--dir", join(repo, "docs/v3/backlog"),
			"--audit", join(repo, "docs/v3/AUDIT.md"), "--index", join(repo, "docs/v3/audit.jsonl"), "--quiet"], {
			encoding: "utf8",
			env: noCache,
		});
		expect(build.status, build.stderr).toBe(0);
		expect(build.stderr).toContain("run pnpm backlog:sync");
		expect(readFileSync(join(repo, "docs/v3/INDEX.md"), "utf8")).toContain("No issue cache: run `pnpm backlog:sync`");
	});
});
