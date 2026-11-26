/**
 * The build and check graph as data (ADR-030, S168): the task list the entry point runs, Turborepo's
 * dry run of it, and a throwaway copy of the tree to dry-run edits in. One implementation for the
 * laws registry (laws.test.ts: an enforced law's task is in the full graph), law P8 (verify-chain:
 * no task starts a browser) and laws (a)–(d) (build-graph.test.ts).
 */
import { execFileSync, execSync } from "node:child_process";
import {
	cpSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** One task of a dry run. A unit without a script for the task shows `<NONEXISTENT>` and runs nothing. */
export interface GraphTask
{
	taskId: string;
	hash: string;
	command: string;
	dependencies: string[];
	inputs: Record<string, string>;
}

/** The task names on the entry point's full `turbo run` line (ADR-030 rule 7 writes them out). */
export function entryTasks(script: string): string[]
{
	const line = script.split("\n").find((l) => !/^\s*#/.test(l) && /turbo run lint /.test(l)) ?? "";
	const words = /turbo run ([^"\n]*)/.exec(line)?.[1]?.trim().split(/\s+/) ?? [];
	const out: string[] = [];
	for (const w of words)
	{
		if (w.startsWith("-")) break;
		out.push(w);
	}
	return out;
}

/** Turborepo's dry run of the entry point's task list in `root` (extra args: filters), real tasks only. */
export function dryRun(root: string, args: string[] = []): GraphTask[]
{
	const tasks = entryTasks(readFileSync(join(root, "scripts/verify.sh"), "utf8"));
	const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("TURBO_")));
	const out = execFileSync(join(ROOT, "node_modules/.bin/turbo"), ["run", ...tasks, ...args, "--dry=json"], {
		cwd: root,
		env,
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
		stdio: ["ignore", "pipe", "pipe"],
	});
	const json = JSON.parse(out) as { tasks: GraphTask[] };
	return json.tasks.filter((t) => t.command !== "<NONEXISTENT>");
}

/**
 * A copy of the working tree (tracked and untracked files, as `git ls-files` lists them) in a new
 * temporary folder, committed as one commit, with the real `node_modules` linked in. Edits there never
 * touch the working tree (S168 AC 4, AC 8).
 */
export function copyTree(root: string = ROOT): string
{
	const dir = mkdtempSync(join(tmpdir(), "bt-graph-"));
	const files = execSync("git ls-files --cached --others --exclude-standard", {
		cwd: root,
		encoding: "utf8",
	}).split("\n").filter(Boolean);
	for (const f of files)
	{
		if (!existsSync(join(root, f))) continue;
		mkdirSync(dirname(join(dir, f)), {
			recursive: true,
		});
		cpSync(join(root, f), join(dir, f));
	}
	for (const nm of execSync("ls -d node_modules */node_modules packages/*/node_modules 2>/dev/null || true", {
		cwd: root,
		encoding: "utf8",
		shell: "/bin/bash",
	}).split("\n").filter(Boolean))
	{
		symlinkSync(join(root, nm), join(dir, nm));
	}
	const git = (...a: string[]): void =>
	{
		execFileSync("git", a, {
			cwd: dir,
			stdio: "ignore",
		});
	};
	git("init", "-q", "-b", "stage");
	git("add", "-A");
	git("-c", "user.name=bt", "-c", "user.email=bt@example.invalid", "commit", "-q", "--no-verify", "-m", "base");
	return dir;
}
