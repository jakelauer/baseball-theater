/**
 * The spec selector and the functions decision (S152 AC 4, AC 5): one rule over the changed-file
 * list and the workspace graph. Each case below is one AC 4 or AC 5 names, or one the pre-PR
 * review found the selector got wrong (an empty declaration, a target named like an `Object`
 * method, a file renamed out of a package, a crash that must fail CI's step rather than select
 * nothing).
 */
import { spawnSync } from "node:child_process";
import {
	mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
	afterEach, describe, expect, it,
} from "vitest";
import type { Spec } from "./select-specs.ts";
import {
	changedFiles, isUnreadPath, reachesFunctions, readGraph, selectSpecs, specTargets, flowSpecs,
} from "./select-specs.ts";

const ROOT = join(import.meta.dirname, "..");
const GRAPH = readGraph(ROOT);

/** One synthetic spec per kind of declaration, handed to the selector as input (no file written). */
const SPECS: Spec[] = [
	{
		file: "syn/web.spec.ts",
		targets: ["web"],
	},
	{
		file: "syn/functions.spec.ts",
		targets: ["functions"],
	},
	{
		file: "syn/both.spec.ts",
		targets: ["web", "functions"],
	},
	{
		file: "syn/none.spec.ts",
		targets: null,
	},
	{
		file: "syn/unknown.spec.ts",
		targets: ["domain"],
	},
	{
		file: "syn/proto.spec.ts",
		targets: ["toString"],
	},
];
const ALL = SPECS.map((s) => s.file);
/** What a change reaching only `web` selects: the specs naming it, and the undeclared or unknown ones. */
const WEB = ["syn/web.spec.ts", "syn/both.spec.ts", "syn/none.spec.ts", "syn/unknown.spec.ts", "syn/proto.spec.ts"];

const pick = (changed: string[]): string[] => selectSpecs(changed, SPECS, GRAPH).slice().sort();

describe("selectSpecs (S152 AC 5)", () =>
{
	it("a packages/ports/ change selects the specs whose targets depend on @bt/ports, and the undeclared ones", () =>
	{
		expect(pick(["packages/ports/src/index.ts"])).toEqual(["syn/both.spec.ts", "syn/functions.spec.ts", "syn/none.spec.ts", "syn/proto.spec.ts", "syn/unknown.spec.ts"]);
	});

	it("a web/src/ change selects every spec naming web, and the undeclared or unknown ones", () =>
	{
		expect(pick(["web/src/main.tsx"])).toEqual(WEB.slice().sort());
	});

	it.each([
		"pnpm-lock.yaml",
		"scripts/backlog-vault/design-reference.ts",
		"compose.yaml",
		"e2e/flows/main.spec.ts",
		"docs/v3/visual/game-shell/RATIFIED.md",
		"docs/v3/design-checks/S2.json",
		"tools/eslint-rules/no-mlb-in-web.js",
		"wrangler.jsonc",
		"package.json",
		"fixtures/schedule-2025-07-04.json",
	])("%s selects every spec", (path) =>
	{
		expect(pick([path])).toEqual(ALL.slice().sort());
	});

	it.each([
		[["CHANGELOG.md"]],
		[["docs/v3/AUDIT.md", "docs/v3/audit.jsonl", "docs/v3/INDEX.md", "docs/v3/backlog/stories/todo/S1.md"]],
		[[".claude/agents/x.md"]],
	])("%j selects none", (changed) =>
	{
		expect(pick(changed)).toEqual([]);
	});

	it("the generated docs plus a web/src/ file select exactly what web/src/ alone does", () =>
	{
		expect(pick(["docs/v3/AUDIT.md", "docs/v3/audit.jsonl", "docs/v3/INDEX.md", "docs/v3/backlog/stories/todo/S1.md", "web/src/main.tsx"])).toEqual(WEB.slice().sort());
	});

	it("the real specs: a web/src/ change selects exactly those naming web", () =>
	{
		const real = flowSpecs(ROOT).map((file) => ({
			file,
			targets: specTargets(readFileSync(join(ROOT, "e2e", file), "utf8")),
		}));
		expect(selectSpecs(["web/src/main.tsx"], real, GRAPH)).toEqual(real.filter((s) => s.targets?.includes("web")).map((s) => s.file));
	});
});

describe("specTargets", () =>
{
	it("reads the declared targets", () =>
	{
		expect(specTargets("import x;\n// @bt-targets: web, functions\n")).toEqual(["web", "functions"]);
	});

	it.each(["", "// @bt-targets:\n", "// @bt-targets:  \n", "// @bt-targets: , \n"])("treats %j as no declaration", (source) =>
	{
		expect(specTargets(source)).toBeNull();
	});
});

describe("reachesFunctions (S152 AC 4)", () =>
{
	it.each([
		["web/src/main.tsx", false],
		["CHANGELOG.md", false],
		[".claude/agents/x.md", false],
		["packages/domain/src/index.ts", true],
		["packages/ports/src/index.ts", true],
		["functions/src/index.ts", true],
		["fixtures/x.json", true],
		["scripts/preview-pr-open.sh", true],
		["tools/eslint-rules/no-mlb-in-web.js", true],
	] as const)("%s → %s", (path, yes) =>
	{
		expect(reachesFunctions([path], GRAPH)).toBe(yes);
	});
});

describe("readGraph, isUnreadPath, flowSpecs", () =>
{
	it("reads functions' @bt dependencies from its package.json", () =>
	{
		expect(GRAPH.find((p) => p.dir === "functions")?.deps.slice().sort()).toEqual(["@bt/domain", "@bt/mlb-api", "@bt/ports"]);
	});

	it("keeps the designs and design checks out of the unread list", () =>
	{
		expect(isUnreadPath("docs/v3/visual/x.png")).toBe(false);
		expect(isUnreadPath("docs/v3/design-checks/x.json")).toBe(false);
		expect(isUnreadPath("docs/v3/LAWS.md")).toBe(true);
	});

	it("runs the harness spec in the flows job", () =>
	{
		expect(flowSpecs(ROOT)).toContain("design/harness.spec.ts");
	});
});

describe("changedFiles", () =>
{
	let repo = "";
	afterEach(() =>
	{
		if (repo) rmSync(repo, {
			recursive: true,
			force: true,
		});
		repo = "";
	});

	// A file moved out of a package (here to an unread Markdown path) must still list its old
	// path, as scripts/ci-changes.sh does, or the change would select nothing.
	it("lists both sides of a rename", () =>
	{
		repo = mkdtempSync(join(tmpdir(), "select-specs-"));
		const git = (...args: string[]): string =>
		{
			const r = spawnSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args], {
				cwd: repo,
				encoding: "utf8",
			});
			if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
			return r.stdout.trim();
		};
		mkdirSync(join(repo, "web/src"), {
			recursive: true,
		});
		writeFileSync(join(repo, "web/src/a.ts"), "export const a = 1;\n".repeat(20));
		git("init", "-q");
		git("add", "-A");
		git("commit", "-qm", "base");
		const base = git("rev-parse", "HEAD");
		mkdirSync(dirname(join(repo, "docs/a.md")), {
			recursive: true,
		});
		git("mv", "web/src/a.ts", "docs/a.md");
		git("commit", "-qm", "move");
		expect(changedFiles(repo, base, "HEAD").sort()).toEqual(["docs/a.md", "web/src/a.ts"]);
	});
});

describe("the CLI", () =>
{
	const cli = (...args: string[]): ReturnType<typeof spawnSync> => spawnSync(process.execPath, [join(import.meta.dirname, "select-specs.ts"), ...args], {
		cwd: ROOT,
		encoding: "utf8",
	});

	it("prints nothing selected and false for an empty diff", () =>
	{
		expect(cli("specs", "flows", "HEAD", "HEAD").stdout).toBe("\n");
		expect(cli("functions", "HEAD", "HEAD").stdout).toBe("false\n");
	});

	// CI's steps assign the output before writing it, so this exit fails the step instead of
	// running no specs (the pre-PR review of S152).
	it("exits nonzero when git can't diff", () =>
	{
		expect(cli("specs", "flows", "0000000000000000000000000000000000000001", "HEAD").status).not.toBe(0);
		expect(cli("functions", "0000000000000000000000000000000000000001", "HEAD").status).not.toBe(0);
	});

	it("exits 2 on a bad command line", () =>
	{
		expect(cli("specs", "nope", "a", "b").status).toBe(2);
	});
});
