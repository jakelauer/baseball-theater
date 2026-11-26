/**
 * Laws L14–L17 (docs/v3/LAWS.md; ADR-030, S168; owner, 2026-11-26: "Accept as written
 * (Recommended)"): the build and check graph keeps the shape that lets a change run only what it
 * reaches. Each reads the workspace as it is when it runs (pnpm-workspace.yaml, turbo.json,
 * Turborepo's dry run), never a list of units written here.
 *  (a) L14: every Vitest test file and vitest.config.* lies in exactly one unit, which has its tasks.
 *  (b) L15: no task depends on another unit's test or lint; no edge joins root and unit tasks.
 *  (c) L16: every task declares narrow inputs; globalDependencies is ADR-030's toolchain list.
 *  (d) L17: the leaf unit test: a change to one source file in a leaf unit executes only that unit's
 *      tasks and the declared readers of the file, every other task replaying (S168 AC 8), shown by
 *      comparing dry-run hashes in a copy of the tree (a task whose hash is unchanged replays).
 */
import { execSync } from "node:child_process";
import {
	appendFileSync, readFileSync, rmSync,
} from "node:fs";
import { join } from "node:path";
import {
	afterAll, describe, expect, it,
} from "vitest";
import {
	inputCovers, plan, readTurbo, readUnits, unitOf,
} from "../verify-plan.ts";
import {
	copyTree, dryRun, ROOT, type GraphTask,
} from "./build-graph.ts";

const units = readUnits(ROOT);
const turbo = readTurbo(ROOT);
const files = execSync("git ls-files --cached --others --exclude-standard", {
	cwd: ROOT,
	encoding: "utf8",
}).split("\n").filter(Boolean);
const adr = readFileSync(join(ROOT, "docs/v3/ARCHITECTURE.md"), "utf8");
const toolchain = [...(/^- Toolchain files: (.+)$/m.exec(adr)?.[1] ?? "").matchAll(/`([^`]+)`/g)].map((m) => m[1]!);
const LAW_UNIT = /^- Law-test unit: `([^`]+)`/m.exec(adr)?.[1] ?? "";

/** (a): the problems with test files and unit tasks. */
export function unitProblems(list: string[], all: { name: string;
	dir: string }[], scriptsOf: (dir: string) => Record<string, string>): string[]
{
	const problems: string[] = [];
	for (const f of list)
	{
		if (!/(^|\/)[^/]*\.test\.[cm]?[jt]sx?$|(^|\/)vitest\.config\.[^/]+$/.test(f) || /(^|\/)fixtures\//.test(f)) continue;
		if (!unitOf(all, f)) problems.push(`${f} lies in no unit`);
	}
	for (const u of all)
	{
		const own = list.filter((f) => unitOf(all, f)?.dir === u.dir);
		const scripts = scriptsOf(u.dir);
		const need = [
			own.some((f) => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(f)) && "lint",
			own.some((f) => /\.tsx?$/.test(f) && !/\.d\.ts$/.test(f)) && "typecheck",
			own.some((f) => /\.test\.[cm]?[jt]sx?$/.test(f)) && "test",
		].filter(Boolean) as string[];
		for (const t of need) if (!scripts[t]) problems.push(`${u.name} has no ${t} script`);
	}
	return problems;
}

/** (b): the forbidden edges of a dry run. */
export function edgeProblems(tasks: Pick<GraphTask, "taskId" | "dependencies">[]): string[]
{
	const pkg = (id: string): string => id.slice(0, id.lastIndexOf("#"));
	const task = (id: string): string => id.slice(id.lastIndexOf("#") + 1);
	const problems: string[] = [];
	for (const t of tasks)
	{
		for (const d of t.dependencies)
		{
			if (t.taskId.startsWith("//#") !== d.startsWith("//#")) problems.push(`${t.taskId} → ${d} joins a root and a unit task`);
			else if (pkg(d) !== pkg(t.taskId) && ["test", "lint"].includes(task(d))) problems.push(`${t.taskId} → ${d}`);
		}
	}
	return problems;
}

/** (c): the problems with declared inputs and globalDependencies. */
export function inputProblems(config: typeof turbo, toolchainFiles: string[], all: { dir: string }[], lawUnitTask: string): string[]
{
	const problems: string[] = [];
	for (const g of config.globalDependencies ?? []) if (!toolchainFiles.includes(g)) problems.push(`globalDependencies holds ${g}`);
	for (const [name, t] of Object.entries(config.tasks))
	{
		if (t.persistent) continue;
		if (!Array.isArray(t.inputs)) { problems.push(`${name} declares no inputs`); continue; }
		for (const i of t.inputs)
		{
			if (i === "$TURBO_DEFAULT$" || i.startsWith("!")) continue;
			const rest = i.replace(/^\$TURBO_ROOT\$\//, "");
			if (rest === i || rest.split("/").some((s) => s === "." || s === "..") || !/^[^*?[\]{}!]+(\/\*\*)?$/.test(rest)) problems.push(`${name}'s input ${i} is wider than a named path`);
		}
	}
	const lawInputs = config.tasks[lawUnitTask]?.inputs ?? [];
	for (const u of all) if (!lawInputs.some((i) => inputCovers(i, `${u.dir}/package.json`)) && u.dir !== LAW_UNIT) problems.push(`${lawUnitTask} does not name ${u.dir}/package.json`);
	return problems;
}

describe("the build and check graph (laws L14–L17, ADR-030)", () =>
{
	const tasks = dryRun(ROOT);
	const lawPkg = units.find((u) => u.dir === LAW_UNIT)?.name ?? "";

	it("L14: every test file and vitest config lies in one unit, which has its tasks", () =>
	{
		expect(units.length).toBeGreaterThan(3);
		expect(unitProblems(files, units, (dir) => (JSON.parse(readFileSync(join(ROOT, dir, "package.json"), "utf8")) as { scripts?: Record<string, string> }).scripts ?? {})).toEqual([]);
	});

	it("L14 catches a test file outside every unit and a unit missing its test script", () =>
	{
		expect(unitProblems(["newdir/x.test.ts"], units, () => ({
			lint: "x",
			typecheck: "x",
			test: "x",
		}))).toContain("newdir/x.test.ts lies in no unit");
		expect(unitProblems(["web/a.test.ts"], [{
			name: "@bt/web",
			dir: "web",
		}], () => ({
			lint: "x",
			typecheck: "x",
		}))).toContain("@bt/web has no test script");
	});

	it("L15: no task waits on another unit's test or lint, and root tasks stand apart", () =>
	{
		expect(tasks.length).toBeGreaterThan(10);
		expect(edgeProblems(tasks)).toEqual([]);
		expect(edgeProblems([{
			taskId: "@bt/web#test",
			dependencies: ["@bt/domain#test"],
		}, {
			taskId: "//#dup:check",
			dependencies: ["@bt/web#build"],
		}])).toHaveLength(2);
	});

	it("L16: every task declares narrow inputs and globalDependencies is the toolchain list", () =>
	{
		expect(toolchain).toContain("pnpm-lock.yaml");
		expect(inputProblems(turbo, toolchain, units, `${lawPkg}#test`)).toEqual([]);
		const wide = {
			...turbo,
			globalDependencies: [...turbo.globalDependencies ?? [], "fixtures/**"],
			tasks: {
				...turbo.tasks,
				x: {
					inputs: ["$TURBO_ROOT$/**"],
				},
				y: {},
			},
		};
		expect(inputProblems(wide, toolchain, units, `${lawPkg}#test`)).toEqual(expect.arrayContaining(["globalDependencies holds fixtures/**", "x's input $TURBO_ROOT$/** is wider than a named path", "y declares no inputs"]));
	});

	it("L16: Markdown anywhere in a unit is an input of the Markdown format check", () =>
	{
		// Prettier's check reads every *.md it isn't told to ignore, so a unit's Markdown must reach its
		// hash, or a badly formatted note in a unit replays a cached pass (S168's pre-PR review).
		const md = turbo.tasks["//#format:md"]?.inputs ?? [];
		expect(units.filter((u) => !md.some((i) => inputCovers(i, `${u.dir}/NOTES.md`))).map((u) => u.dir)).toEqual([]);
	});

	describe("L17: a change in one leaf unit executes only what reads it", () =>
	{
		const copy = copyTree();
		afterAll(() => rmSync(copy, {
			recursive: true,
			force: true,
		}));
		const before = new Map(dryRun(copy).map((t) => [t.taskId, t.hash]));
		const dependedOn = new Set(units.flatMap((u) =>
		{
			const pkg = JSON.parse(readFileSync(join(ROOT, u.dir, "package.json"), "utf8")) as { dependencies?: Record<string, string>;
				devDependencies?: Record<string, string> };
			return Object.keys({
				...pkg.dependencies,
				...pkg.devDependencies,
			});
		}));
		const leaves = units.filter((u) => !dependedOn.has(u.name));

		it("there are leaf units to check", () =>
		{
			expect(leaves.length).toBeGreaterThan(0);
		});

		for (const leaf of leaves)
		{
			it(`${leaf.name}`, () =>
			{
				const source = files.find((f) => unitOf(units, f)?.dir === leaf.dir && /\.(ts|tsx|js)$/.test(f) && !/\.test\./.test(f) && !/(^|\/)fixtures\//.test(f));
				expect(source, `a source file in ${leaf.dir}`).toBeDefined();
				const original = readFileSync(join(copy, source!), "utf8");
				appendFileSync(join(copy, source!), "\n// S168 law L17 probe\n");
				try
				{
					const p = plan(turbo, units, [source!], false);
					expect(p.mode).toBe("narrow");
					const after = dryRun(copy, p.filters.map((f) => `--filter=${f}`));
					const misses = after.filter((t) => before.get(t.taskId) !== t.hash).map((t) => t.taskId);
					const allowed = (id: string): boolean =>
					{
						const pkg = id.slice(0, id.lastIndexOf("#"));
						if (pkg === leaf.name) return true;
						const key = Object.keys(turbo.tasks).find((k) => k === id) ?? id.slice(id.lastIndexOf("#") + 1);
						return (turbo.tasks[key]?.inputs ?? []).some((i) => i.startsWith("$TURBO_ROOT$/") && inputCovers(i, source!));
					};
					expect(misses.filter((id) => !allowed(id)), `${source} made these execute`).toEqual([]);
					expect(misses.some((id) => id.startsWith(`${leaf.name}#`))).toBe(true);
				}
				finally
				{
					execSync(`git checkout -q -- ${JSON.stringify(source)}`, {
						cwd: copy,
					});
					expect(readFileSync(join(copy, source!), "utf8")).toBe(original);
				}
			}, 120_000);
		}
	});
});
