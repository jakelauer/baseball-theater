/**
 * The local check's narrowing (scripts/verify-plan.ts, ADR-030 rule 7) and its ledger record
 * (scripts/verify-record.ts, rule 9), S168. Laws (a)–(d) in build-graph.test.ts check the graph's
 * shape and a leaf unit's change; these check the parts a leaf can't reach: a change's dependents,
 * a cross-unit reader, a toolchain or orphan file, moves and odd file names, and the three lists a
 * finishing gate records (S168's pre-PR review found each could break with every test passing).
 */
import { execFileSync } from "node:child_process";
import {
	mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
	afterEach, describe, expect, it, vi,
} from "vitest";
import {
	changedFiles, plan, readTurbo, readUnits, unitOf, type TurboConfig, type Unit,
} from "../verify-plan.ts";
import { gateRecord, gateRows } from "../verify-record.ts";
import { dryRun, ROOT } from "./build-graph.ts";

const units: Unit[] = [{
	name: "@t/domain",
	dir: "packages/domain",
}, {
	name: "@t/web",
	dir: "web",
}, {
	name: "@t/nested",
	dir: "web/sub",
}];
const turbo: TurboConfig = {
	globalDependencies: ["pnpm-lock.yaml"],
	tasks: {
		"lint": {
			inputs: ["$TURBO_DEFAULT$", "$TURBO_ROOT$/tools/rules/**"],
		},
		"@t/web#build": {
			inputs: ["$TURBO_DEFAULT$", "$TURBO_ROOT$/functions/plugin.ts"],
		},
		"//#format:md": {
			inputs: ["$TURBO_ROOT$/docs/**"],
		},
	},
};

describe("plan: what a change runs", () =>
{
	it("nothing changed runs nothing", () =>
	{
		expect(plan(turbo, units, [], false).mode).toBe("none");
	});

	it("--all, or a toolchain file, runs every task", () =>
	{
		expect(plan(turbo, units, [], true).mode).toBe("all");
		expect(plan(turbo, units, ["pnpm-lock.yaml", "web/a.ts"], false).mode).toBe("all");
	});

	it("a unit's file runs that unit and its dependents, and the root tasks", () =>
	{
		expect(plan(turbo, units, ["packages/domain/src/a.ts"], false)).toEqual({
			mode: "narrow",
			filters: ["//", "...@t/domain"],
			orphan: false,
		});
	});

	it("a file another unit's task names as an outside input runs that unit (a cross-unit read)", () =>
	{
		const p = plan(turbo, units, ["functions/plugin.ts"], false);
		expect(p.filters).toContain("@t/web");
		expect(p.orphan).toBe(false);
	});

	it("an input of an untyped task (every unit's lint) runs every unit", () =>
	{
		expect(plan(turbo, units, ["tools/rules/r.js"], false).filters).toEqual(expect.arrayContaining(["@t/domain", "@t/web", "@t/nested"]));
	});

	it("a root task's input runs only the root tasks, and is not an orphan", () =>
	{
		expect(plan(turbo, units, ["docs/a.md"], false)).toEqual({
			mode: "narrow",
			filters: ["//"],
			orphan: false,
		});
	});

	it("a file in no unit and no task's inputs is an orphan", () =>
	{
		expect(plan(turbo, units, ["newdir/x.md"], false).orphan).toBe(true);
	});

	it("a file in a nested unit belongs to the nearest one", () =>
	{
		expect(unitOf(units, "web/sub/a.ts")?.name).toBe("@t/nested");
		expect(plan(turbo, units, ["web/sub/a.ts"], false).filters).toEqual(["//", "...@t/nested"]);
	});

	it("on the real graph, a change to a unit others depend on runs their tests too", () =>
	{
		const real = readUnits(ROOT);
		const manifest = (dir: string): Record<string, string> =>
		{
			const pkg = JSON.parse(readFileSync(join(ROOT, dir, "package.json"), "utf8")) as { dependencies?: Record<string, string>;
				devDependencies?: Record<string, string> };
			return {
				...pkg.dependencies,
				...pkg.devDependencies,
			};
		};
		// The unit the most others name as a workspace dependency, and those that do.
		const dependents = (u: Unit): Unit[] => real.filter((o) => manifest(o.dir)[u.name]?.startsWith("workspace:"));
		const base = [...real].sort((a, b) => dependents(b).length - dependents(a).length)[0]!;
		expect(dependents(base).length).toBeGreaterThan(0);
		const p = plan(readTurbo(ROOT), real, [`${base.dir}/src/s168-probe.ts`], false);
		const ids = new Set(dryRun(ROOT, p.filters.map((f) => `--filter=${f}`)).map((t) => t.taskId));
		for (const d of dependents(base)) expect(ids, `${d.name} depends on ${base.name}`).toContain(`${d.name}#test`);
	}, 120_000);
});

/** A git repository holding a copy of verify-plan.ts and a two-unit workspace, on branch `stage`. */
function tempRepo(): string
{
	const dir = mkdtempSync(join(tmpdir(), "bt-verify-plan-"));
	const write = (f: string, text: string): void =>
	{
		mkdirSync(dirname(join(dir, f)), {
			recursive: true,
		});
		writeFileSync(join(dir, f), text);
	};
	write("scripts/verify-plan.ts", readFileSync(join(ROOT, "scripts/verify-plan.ts"), "utf8"));
	symlinkSync(join(ROOT, "node_modules"), join(dir, "node_modules"));
	write(".gitignore", "node_modules\n");
	write("pnpm-workspace.yaml", "packages:\n  - a\n  - b\n");
	write("a/package.json", "{\"name\":\"@t/a\"}\n");
	write("b/package.json", "{\"name\":\"@t/b\"}\n");
	write("a/x.ts", "export const x = 1;\n");
	write("turbo.json", "{\n// a comment\n\"globalDependencies\": [\"lock.yaml\"], \"tasks\": {}}\n");
	git(dir, "init", "-q", "-b", "stage");
	git(dir, "add", "-A");
	git(dir, "commit", "-q", "-m", "base");
	git(dir, "checkout", "-q", "-b", "work");
	return dir;
}

function git(dir: string, ...args: string[]): void
{
	execFileSync("git", ["-c", "user.name=bt", "-c", "user.email=bt@example.invalid", ...args], {
		cwd: dir,
		stdio: "ignore",
	});
}

/** The CLI's output in `dir`, with only the environment given (never the runner's BT_VERIFY_BASE). */
function cli(dir: string, args: string[], env: Record<string, string> = {}): string
{
	return execFileSync("node", ["scripts/verify-plan.ts", ...args], {
		cwd: dir,
		encoding: "utf8",
		env: {
			PATH: process.env.PATH ?? "",
			HOME: process.env.HOME ?? "",
			...env,
		},
		stdio: ["ignore", "pipe", "pipe"],
	});
}

describe("changedFiles and the CLI", () =>
{
	const dirs: string[] = [];
	afterEach(() =>
	{
		vi.unstubAllEnvs();
		for (const d of dirs.splice(0)) rmSync(d, {
			recursive: true,
			force: true,
		});
	});
	const repo = (): string =>
	{
		const d = tempRepo();
		dirs.push(d);
		return d;
	};

	it("a move lists both its old and its new path", () =>
	{
		const dir = repo();
		git(dir, "mv", "a/x.ts", "b/x.ts");
		git(dir, "commit", "-q", "-m", "move");
		vi.stubEnv("BT_VERIFY_BASE", "stage");
		expect(changedFiles(dir)).toEqual(["a/x.ts", "b/x.ts"]);
	});

	it("with no base named, it compares against stage (origin's when fetched)", () =>
	{
		const dir = repo();
		writeFileSync(join(dir, "b/y.ts"), "export const y = 2;\n");
		vi.stubEnv("BT_VERIFY_BASE", "");
		expect(changedFiles(dir)).toEqual(["b/y.ts"]);
	});

	it("odd file names come back as they are, never quoted", () =>
	{
		const dir = repo();
		const names = ["docs/01 Current baseline — x.md", "docs/a\"b.md", "docs/tab\there.md"];
		for (const n of names) writeFileSync(join(dir, n.replace(/^docs\//, "")), "x\n");
		mkdirSync(join(dir, "docs"));
		for (const n of names) writeFileSync(join(dir, n), "x\n");
		git(dir, "add", "docs");
		git(dir, "commit", "-q", "-m", "names");
		vi.stubEnv("BT_VERIFY_BASE", "stage");
		// The untracked copies at the root come back unquoted too.
		expect(changedFiles(dir)).toEqual([...names, ...names.map((n) => n.replace(/^docs\//, ""))].sort());
	});

	it("prints none for no change, and narrow with each file for one", () =>
	{
		const dir = repo();
		expect(cli(dir, [], {
			BT_VERIFY_BASE: "stage",
		})).toContain("mode none");
		writeFileSync(join(dir, "a/y.ts"), "export const y = 2;\n");
		const out = cli(dir, [], {
			BT_VERIFY_BASE: "stage",
		});
		expect(out).toContain("mode narrow");
		expect(out).toContain("filters --filter=// --filter=...@t/a");
		expect(out).toContain("file a/y.ts");
	});

	it("--all runs every task even where the base branch is missing", () =>
	{
		const dir = repo();
		git(dir, "branch", "-q", "-m", "stage", "old");
		expect(cli(dir, ["--all"])).toContain("mode all");
		expect(() => cli(dir, [])).toThrow();
	});
});

describe("gateRecord: what a finishing gate did", () =>
{
	it("sorts tasks into ran, replayed and not affected", () =>
	{
		const r = gateRecord([{
			tasks: [{
				taskId: "a#test",
				cache: {
					status: "MISS",
				},
			}, {
				taskId: "b#test",
				cache: {
					status: "HIT",
				},
			}, {
				taskId: "c#test",
				command: "<NONEXISTENT>",
			}, {
				taskId: "d#lint",
				cache: {
					status: "HIT",
				},
			}],
		}, {
			tasks: [{
				taskId: "d#lint",
				cache: {
					status: "MISS",
				},
			}],
		}], ["a#test", "b#test", "d#lint", "e#build"]);
		expect(r).toEqual({
			ran: ["a#test", "d#lint"],
			replayed: ["b#test"],
			notAffected: ["e#build"],
		});
		expect(gateRows(r)).toBe([
			"| Gate: tasks that ran | 2: `a#test`, `d#lint` |",
			"| Gate: replayed from the cache | 1: `b#test` |",
			"| Gate: not affected | 1: `e#build` |",
		].join("\n"));
	});

	it("an empty list reads none", () =>
	{
		expect(gateRows(gateRecord([], []))).toContain("| Gate: tasks that ran | none |");
	});

	it("its CLI reads the run summaries since a time and a saved graph", () =>
	{
		const dir = mkdtempSync(join(tmpdir(), "bt-verify-record-"));
		try
		{
			mkdirSync(join(dir, ".turbo/runs"), {
				recursive: true,
			});
			writeFileSync(join(dir, ".turbo/runs/r.json"), JSON.stringify({
				tasks: [{
					taskId: "a#test",
					cache: {
						status: "MISS",
					},
				}, {
					taskId: "b#test",
					cache: {
						status: "HIT",
					},
				}],
			}));
			writeFileSync(join(dir, "graph.json"), JSON.stringify({
				tasks: [{
					taskId: "a#test",
				}, {
					taskId: "b#test",
				}, {
					taskId: "c#build",
				}, {
					taskId: "x#lint",
					command: "<NONEXISTENT>",
				}],
			}));
			const out = execFileSync("node", [join(ROOT, "scripts/verify-record.ts"), "--root", dir, "--since", "0", "--graph", join(dir, "graph.json")], {
				encoding: "utf8",
			});
			expect(out).toContain("| Gate: tasks that ran | 1: `a#test` |");
			expect(out).toContain("| Gate: replayed from the cache | 1: `b#test` |");
			expect(out).toContain("| Gate: not affected | 1: `c#build` |");
		}
		finally
		{
			rmSync(dir, {
				recursive: true,
				force: true,
			});
		}
	});
});
