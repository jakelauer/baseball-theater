/**
 * Which browser specs a pull request's change can affect, and whether it reaches the
 * `functions` package's tests (S152; owner, 2026-11-19: "The point would be to only build the
 * stuff that changes", and of the browser jobs: "Yes, scope them too").
 *
 * One rule decides both: a changed file under a workspace package's directory reaches that
 * package and every package that depends on it (through the `@bt/*` dependencies in each
 * `package.json`); a path on the short list no browser run reads reaches nothing; any other path
 * (the lockfile, `scripts/`, `e2e/`, `fixtures/`, `compose.yaml`, …) reaches every package, since
 * it may change how anything builds or runs. CI's `changes` job asks `reachesFunctions` whether to
 * run the functions tests in shards; the `flows` job asks `selectSpecs` which spec files to run.
 * Pushes to `stage` and `main` never ask: they run everything.
 *
 * A spec declares its direct targets on a line `// @bt-targets: web, functions`. It names `web`
 * alone only when it answers every API request itself (it routes all of `**\/api/**`), so a
 * request it forgot to mock fails instead of quietly reaching `functions`. A spec with no
 * declaration, or naming a target this file doesn't know, is selected whenever anything is.
 *
 * Pure apart from `readGraph` and the CLI, which read the tree and `git diff`. Runs under Node's
 * own type stripping (`node e2e/select-specs.ts …`), so it imports only Node built-ins.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** One workspace package: its name, its directory (relative to the repo root) and its `@bt/*` dependencies. */
export interface WorkspacePackage
{
	name: string;
	dir: string;
	deps: string[];
}

/** A spec file (relative to `e2e/`) and the targets it declares, or `null` for none. */
export interface Spec
{
	file: string;
	targets: string[] | null;
}

/** The app's package directories, which browser specs exercise (`pnpm-workspace.yaml` also lists the tooling units scripts, tools and e2e, ADR-030, which no spec runs). */
const WORKSPACE_DIRS = ["packages/*", "functions", "web"];

/** A spec target names a package by its directory's last segment (`web`, `functions`). */
const TARGET_DIRS: Record<string, string> = {
	web: "web",
	functions: "functions",
};

/** Reads each workspace package's name and `@bt/*` dependencies from its `package.json`. */
export function readGraph(root: string): WorkspacePackage[]
{
	const dirs = WORKSPACE_DIRS.flatMap((d) => d.endsWith("/*")
		? readdirSync(join(root, d.slice(0, -2)), {
			withFileTypes: true,
		}).filter((e) => e.isDirectory()).map((e) => `${d.slice(0, -2)}/${e.name}`)
		: [d]);
	return dirs.flatMap((dir) =>
	{
		let pkg: { name?: string;
			dependencies?: Record<string, string>;
			devDependencies?: Record<string, string> };
		try
		{
			pkg = JSON.parse(readFileSync(join(root, dir, "package.json"), "utf8")) as typeof pkg;
		}
		catch
		{
			return [];
		}
		const deps = Object.keys({
			...pkg.dependencies,
			...pkg.devDependencies,
		}).filter((d) => d.startsWith("@bt/"));
		return [{
			name: pkg.name ?? dir,
			dir,
			deps,
		}];
	});
}

/**
 * Whether no browser run (and no package's build or tests) reads this path: `docs/v3/` except
 * the designs and design captures `e2e/design/helpers.ts` reads, `.claude/`, and Markdown
 * anywhere outside those two folders.
 */
export function isUnreadPath(path: string): boolean
{
	if (path.startsWith("docs/v3/visual/") || path.startsWith("docs/v3/design-checks/")) return false;
	return path.startsWith("docs/v3/") || path.startsWith(".claude/") || path.endsWith(".md");
}

/** The directories of the packages a change reaches (see the file comment for the rule). */
export function reachedPackages(changed: string[], graph: WorkspacePackage[]): Set<string>
{
	const reached = new Set<string>();
	const reach = (dir: string): void =>
	{
		if (reached.has(dir)) return;
		reached.add(dir);
		const name = graph.find((p) => p.dir === dir)?.name;
		for (const p of graph) if (name && p.deps.includes(name)) reach(p.dir);
	};
	for (const path of changed)
	{
		const owner = graph.find((p) => path.startsWith(`${p.dir}/`));
		if (owner) reach(owner.dir);
		else if (!isUnreadPath(path)) for (const p of graph) reach(p.dir);
	}
	return reached;
}

/** Whether a change reaches the `functions` package, so CI runs its tests in shards (S152 AC 4). */
export function reachesFunctions(changed: string[], graph: WorkspacePackage[]): boolean
{
	return reachedPackages(changed, graph).has("functions");
}

/** The targets a spec's source declares on its `// @bt-targets:` line, or `null` without one (or with a blank one). */
export function specTargets(source: string): string[] | null
{
	const line = /^\/\/ @bt-targets:(.*)$/m.exec(source);
	const targets = line ? line[1]!.split(",").map((t) => t.trim()).filter(Boolean) : [];
	// A blank declaration names nothing, so it counts as none and runs whenever anything does.
	return targets.length > 0 ? targets : null;
}

/** The specs a change selects: each one with a reached target, plus undeclared ones whenever anything is reached. */
export function selectSpecs(changed: string[], specs: Spec[], graph: WorkspacePackage[]): string[]
{
	const reached = reachedPackages(changed, graph);
	if (reached.size === 0) return [];
	return specs.filter((s) => s.targets === null
		|| s.targets.some((t) => !Object.hasOwn(TARGET_DIRS, t) || reached.has(TARGET_DIRS[t]!)))
		.map((s) => s.file);
}

/**
 * The flows job's spec pool, relative to `e2e/`: `flows/` plus the harness spec, as `pnpm e2e`
 * runs. The design-capture specs have no CI job (owner, 2026-11-20: "We don't need to do this in
 * CI; it can be something we run manually.").
 */
export function flowSpecs(root: string): string[]
{
	const flows = readdirSync(join(root, "e2e", "flows")).filter((f) => f.endsWith(".spec.ts")).map((f) => `flows/${f}`).sort();
	return [...flows, "design/harness.spec.ts"];
}

/**
 * The files a pull request changes, `git diff --no-renames --name-only <base>...<head>`, read as
 * `scripts/ci-changes.sh` reads them: paths unquoted, and no rename detection, so a file moved out
 * of a package (to `docs/`, say) still lists its old path and reaches that package. Throws when git
 * can't diff, so CI's step fails instead of selecting nothing.
 */
export function changedFiles(root: string, base: string, head: string): string[]
{
	return execFileSync("git", ["-c", "core.quotepath=false", "diff", "--no-renames", "--name-only", `${base}...${head}`], {
		cwd: root,
	}).toString().split("\n").filter(Boolean);
}

/**
 * `node e2e/select-specs.ts specs flows <base> <head>` prints the selected spec files
 * (relative to `e2e/`, space-separated, nothing when none); `… functions <base> <head>` prints
 * `true` or `false`.
 */
function main(argv: string[]): void
{
	const root = join(import.meta.dirname, "..");
	const graph = readGraph(root);
	const [command, ...rest] = argv;
	if (command === "specs" && rest[0] === "flows" && rest.length === 3)
	{
		const specs = flowSpecs(root).map((file) => ({
			file,
			targets: specTargets(readFileSync(join(root, "e2e", file), "utf8")),
		}));
		process.stdout.write(`${selectSpecs(changedFiles(root, rest[1]!, rest[2]!), specs, graph).join(" ")}\n`);
	}
	else if (command === "functions" && rest.length === 2)
	{
		process.stdout.write(`${reachesFunctions(changedFiles(root, rest[0]!, rest[1]!), graph)}\n`);
	}
	else
	{
		process.stderr.write("usage: node e2e/select-specs.ts specs flows <base> <head> | functions <base> <head>\n");
		process.exitCode = 2;
	}
}

// `import.meta.main` (Node 24), not a comparison of the typed script path (`argv[1]`) with this file's: Node
// leaves argv[1] as typed but resolves the module's own path through symlinks, so started through a
// linked folder (every macOS temp path is one) that comparison was false, `main` never ran, and an
// empty answer read as "no browser specs to run" (S169, issue #315).
if (import.meta.main) main(process.argv.slice(2));
