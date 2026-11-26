/**
 * What `pnpm verify` runs for the change in front of it (ADR-030 rule 7, S168). One implementation,
 * read by scripts/verify.sh and by the law tests that prove the narrowing (scripts/backlog-vault/
 * build-graph.test.ts).
 *
 * The change is every file that differs from the merge base with the base branch (`stage`, or
 * BT_VERIFY_BASE when CI or a test names another): committed, uncommitted and untracked alike, the
 * untracked ones listed by git itself, since Turborepo's own affected filter misses them. From it:
 *  - nothing changed → nothing runs;
 *  - a toolchain file (turbo.json's globalDependencies) changed, or `--all` → every task, cache read;
 *  - otherwise the units the files lie in and their dependents (`...<unit>`), the units whose tasks
 *    name a changed file as an outside input (a cross-unit read, ADR-030 rule 6), and the root tasks,
 *    which replay unless their own inputs changed;
 *  - a file in no unit and no task's inputs ("orphan") also runs the law-test unit's test and the root
 *    tasks with a write-only cache, so a non-empty change never runs nothing and law (a) sees the file.
 *
 * Output, one `key value…` line each: `mode none|all|narrow`, `filters <turbo --filter values>`,
 * `orphan 0|1`, `changed <n>`, then `file <path>` per changed file.
 */
import { execSync } from "node:child_process";
import {
	existsSync, readFileSync, readdirSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

/** A workspace unit: its package name and directory relative to the root. */
export interface Unit
{
	name: string;
	dir: string;
}

/** turbo.json's tasks and global dependencies, comments stripped. */
export interface TurboConfig
{
	globalDependencies?: string[];
	tasks: Record<string, { inputs?: string[];
		dependsOn?: string[];
		persistent?: boolean }>;
}

/** turbo.json with its whole-line `//` comments removed (it is JSONC). */
export function readTurbo(root: string): TurboConfig
{
	const text = readFileSync(join(root, "turbo.json"), "utf8").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
	return JSON.parse(text) as TurboConfig;
}

/** The workspace units, from pnpm-workspace.yaml's globs (a trailing `/*` expands one level). */
export function readUnits(root: string): Unit[]
{
	const globs = (parseYaml(readFileSync(join(root, "pnpm-workspace.yaml"), "utf8")) as { packages: string[] }).packages;
	const dirs = globs.flatMap((g) => g.endsWith("/*") ? readdirSync(join(root, g.slice(0, -2)), {
		withFileTypes: true,
	}).filter((d) => d.isDirectory()).map((d) => `${g.slice(0, -2)}/${d.name}`) : [g]);
	return dirs.filter((d) => existsSync(join(root, d, "package.json")))
		.map((dir) => ({
			name: (JSON.parse(readFileSync(join(root, dir, "package.json"), "utf8")) as { name: string }).name,
			dir,
		}));
}

/** The nearest unit a repository path lies in, or undefined. */
export function unitOf(units: Unit[], file: string): Unit | undefined
{
	return units.filter((u) => file.startsWith(`${u.dir}/`)).sort((a, b) => b.dir.length - a.dir.length)[0];
}

/** Whether a turbo input or global dependency (`a/b.json`, `dir/**`) names a repository path. */
export function inputCovers(input: string, file: string): boolean
{
	const p = input.replace(/^\$TURBO_ROOT\$\//, "");
	if (p.endsWith("/**")) return file.startsWith(p.slice(0, -2));
	return p === file;
}

/** The plan for a list of changed files (see the module comment). */
export function plan(turbo: TurboConfig, units: Unit[], changed: string[], all: boolean): { mode: "none" | "all" | "narrow";
	filters: string[];
	orphan: boolean }
{
	if (all || changed.some((f) => (turbo.globalDependencies ?? []).some((g) => inputCovers(g, f)))) return {
		mode: "all",
		filters: [],
		orphan: false,
	};
	if (changed.length === 0) return {
		mode: "none",
		filters: [],
		orphan: false,
	};
	const filters = new Set<string>(["//"]);
	let orphan = false;
	for (const f of changed)
	{
		const unit = unitOf(units, f);
		if (unit) filters.add(`...${unit.name}`);
		let declared = false;
		for (const [key, task] of Object.entries(turbo.tasks))
		{
			if (!(task.inputs ?? []).some((i) => i.startsWith("$TURBO_ROOT$/") && inputCovers(i, f))) continue;
			declared = true;
			if (key.startsWith("//#")) continue;
			if (key.includes("#")) filters.add(key.slice(0, key.lastIndexOf("#")));
			else for (const u of units) filters.add(u.name);
		}
		if (!unit && !declared) orphan = true;
	}
	return {
		mode: "narrow",
		filters: [...filters],
		orphan,
	};
}

/** The changed files against the merge base with the base branch, untracked ones included. */
export function changedFiles(root: string): string[]
{
	const sh = (cmd: string): string => execSync(cmd, {
		cwd: root,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
	}).trim();
	const has = (ref: string): boolean =>
	{
		try { sh(`git rev-parse --verify --quiet ${ref}`); return true; }
		catch { return false; }
	};
	const base = process.env.BT_VERIFY_BASE || (has("origin/stage") ? "origin/stage" : "stage");
	const mergeBase = sh(`git merge-base HEAD ${base}`);
	const tracked = sh(`git diff --name-only ${mergeBase}`);
	const untracked = sh("git ls-files --others --exclude-standard");
	return [...new Set(`${tracked}\n${untracked}`.split("\n").filter(Boolean))].sort();
}

if (process.argv[1] === fileURLToPath(import.meta.url))
{
	const root = fileURLToPath(new URL("..", import.meta.url));
	const changed = changedFiles(root);
	const p = plan(readTurbo(root), readUnits(root), changed, process.argv.includes("--all"));
	console.log(`mode ${p.mode}`);
	console.log(`filters ${p.filters.map((f) => `--filter=${f}`).join(" ")}`);
	console.log(`orphan ${p.orphan ? 1 : 0}`);
	console.log(`changed ${changed.length}`);
	for (const f of changed) console.log(`file ${f}`);
}
