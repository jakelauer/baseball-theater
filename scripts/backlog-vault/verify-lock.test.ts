/**
 * `scripts/with-verify-lock.sh` lets only one full `pnpm verify` run at a time across the repository's
 * worktrees (owner, 2026-11-23: "yeah, one at a time lock"). These tests run it in a throwaway git
 * repository, whose common dir holds the lock, with a fast poll: a second run waits for the first, a
 * lock left by a dead pid (or one now reused by another process) is taken over, a nested call doesn't wait on itself, the command's exit code passes through, the lock is released
 * on failure and on Ctrl-C, and GitHub Actions and BT_VERIFY_LOCK=0 skip it.
 */
import { execFileSync, spawn } from "node:child_process";
import {
	existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	afterEach, beforeEach, describe, expect, it,
} from "vitest";

const SCRIPT = fileURLToPath(new URL("../with-verify-lock.sh", import.meta.url));

let repo = "";
let lock = "";

interface Run
{
	code: number | null;
	stderr: string;
	ms: number;
}

/** The environment a local run sees: CI's own GITHUB_ACTIONS and any outer lock are removed. */
function env(extra: Record<string, string> = {}): NodeJS.ProcessEnv
{
	const e: NodeJS.ProcessEnv = {
		...process.env,
		BT_VERIFY_LOCK_POLL: "0.1",
	};
	delete e.GITHUB_ACTIONS;
	delete e.BT_VERIFY_LOCK_HELD;
	delete e.BT_VERIFY_LOCK;
	return {
		...e,
		...extra,
	};
}

/** Starts the wrapper around `sh -c <command>` in the temporary repository. */
function start(command: string, extra: Record<string, string> = {}): { child: ReturnType<typeof spawn>;
	done: Promise<Run> }
{
	const began = Date.now();
	const child = spawn(SCRIPT, ["sh", "-c", command], {
		cwd: repo,
		env: env(extra),
		detached: true,
	});
	let stderr = "";
	child.stderr.on("data", (d: Buffer) =>
	{
		stderr += d.toString();
	});
	const done = new Promise<Run>((resolve) =>
	{
		child.on("close", (code) => resolve({
			code,
			stderr,
			ms: Date.now() - began,
		}));
	});
	return {
		child,
		done,
	};
}

/** Resolves once `path` exists, failing after `ms`. */
async function waitFor(path: string, ms = 10_000): Promise<void>
{
	const until = Date.now() + ms;
	while (!existsSync(path))
	{
		if (Date.now() > until) throw new Error(`timed out waiting for ${path}`);
		await new Promise((r) => setTimeout(r, 25));
	}
}

beforeEach(() =>
{
	repo = mkdtempSync(join(tmpdir(), "bt-verify-lock-"));
	execFileSync("git", ["init", "-q"], {
		cwd: repo,
	});
	lock = join(repo, ".git", "bt-verify.lock");
});

afterEach(() =>
{
	rmSync(repo, {
		recursive: true,
		force: true,
	});
});

describe("scripts/with-verify-lock.sh", () =>
{
	it("passes the command's exit code through and releases the lock after a failure", async () =>
	{
		const run = await start("test -d \"$(git rev-parse --git-common-dir)/bt-verify.lock\" && exit 7").done;
		expect(run.code).toBe(7);
		expect(existsSync(lock)).toBe(false);
		expect((await start("exit 0").done).code).toBe(0);
	});

	it("makes a second run wait for the holder, naming its worktree, then take the lock", async () =>
	{
		const marker = join(repo, "first-done");
		const first = start(`sleep 1; touch ${marker}`);
		await waitFor(join(lock, "worktree"));
		const second = start(`test -f ${marker}`);
		const [a, b] = await Promise.all([first.done, second.done]);
		expect(a.code).toBe(0);
		// The second command ran only after the first finished, or `test -f` would have failed.
		expect(b.code).toBe(0);
		expect(b.stderr).toMatch(/verify lock: waiting for the pnpm verify in .*bt-verify-lock-.* \(pid \d+\)/);
		expect(b.stderr.match(/waiting for/g)).toHaveLength(1);
		expect(b.stderr).toMatch(/verify lock: acquired after \d+ s/);
		expect(existsSync(lock)).toBe(false);
	});

	it("takes over a lock whose holder pid is no longer alive", async () =>
	{
		mkdirSync(lock);
		// Above macOS's and Linux's default pid ceilings, so no live process has it.
		writeFileSync(join(lock, "pid"), "4194399\n");
		writeFileSync(join(lock, "worktree"), "/gone\n");
		const run = await start("exit 0").done;
		expect(run.code).toBe(0);
		expect(run.stderr).toContain("holder pid 4194399 is gone; taking the lock over");
		expect(existsSync(lock)).toBe(false);
	});

	it("takes over a lock whose pid now belongs to some other process", async () =>
	{
		mkdirSync(lock);
		// This test process is alive but is no run of the wrapper, as after a reboot or pid reuse.
		writeFileSync(join(lock, "pid"), `${process.pid}\n`);
		const run = await start("exit 0").done;
		expect(run.code).toBe(0);
		expect(run.stderr).toContain(`holder pid ${process.pid} is gone; taking the lock over`);
		expect(existsSync(lock)).toBe(false);
	});

	it("lets a nested call under the holder run without waiting on itself", async () =>
	{
		const run = await start(`'${SCRIPT}' sh -c 'exit 4'`).done;
		expect(run.code).toBe(4);
		expect(run.stderr).toBe("");
	});

	it("takes over a lock left with no pid file", async () =>
	{
		mkdirSync(lock);
		const run = await start("exit 0").done;
		expect(run.code).toBe(0);
		expect(run.stderr).toContain("taking the lock over");
	});

	it("releases the lock when interrupted with Ctrl-C", async () =>
	{
		const run = start("sleep 5");
		await waitFor(join(lock, "worktree"));
		process.kill(-run.child.pid!, "SIGINT");
		const result = await run.done;
		expect(result.code).toBe(130);
		expect(existsSync(lock)).toBe(false);
	});

	it.each([
		["under GitHub Actions", {
			GITHUB_ACTIONS: "true",
		}],
		["with BT_VERIFY_LOCK=0", {
			BT_VERIFY_LOCK: "0",
		}],
	])("skips the lock %s", async (_name, extra) =>
	{
		// A lock a locked run would take over and remove, so the pid file still there shows it was never touched.
		mkdirSync(lock);
		writeFileSync(join(lock, "pid"), `${process.pid}\n`);
		const run = await start("exit 3", extra).done;
		expect(run.code).toBe(3);
		expect(run.stderr).toBe("");
		expect(existsSync(join(lock, "pid"))).toBe(true);
	});
});
