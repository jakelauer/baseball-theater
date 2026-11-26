/**
 * S146: `build-inputs.ts` against a fixture repository (a temporary git repo shaped like this one):
 * what a record holds and leaves out (AC 1), and when `check` says `unchanged` (AC 2). The Vite list
 * and the Worker metafile are written as the plugin and `wrangler --metafile` write them; the deploy
 * scripts' graph is a real esbuild bundle of the fixture's files.
 */
import { execFileSync, spawnSync } from "node:child_process";
import {
	copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
	afterAll, beforeAll, describe, expect, it,
} from "vitest";
import {
	BUILD_INPUTS_FORMAT, BUILD_INPUTS_SCRIPT, checkBuildInputs, gitTree, main, namedInputs, repoPath,
} from "./build-inputs.js";

let root = "";
let out = "";

/** Runs git in the fixture, with no user hooks or identity needed. */
function git(...args: string[]): string
{
	return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args], {
		cwd: root,
		encoding: "utf8",
	});
}

/** Writes a fixture file (making its folders). */
function put(path: string, text: string): void
{
	mkdirSync(dirname(join(root, path)), {
		recursive: true,
	});
	writeFileSync(join(root, path), text);
}

/** Commits everything in the fixture. */
function commit(message: string): void
{
	git("add", "-A");
	git("commit", "-q", "-m", message);
}

/** Runs the command in the fixture, returning its exit code and its line. */
async function run(argv: string[], release = "v3.1.0"): Promise<{ code: number;
	line: string; }>
{
	let line = "";
	const code = await main(argv, root, {
		BT_RELEASE: release,
	}, (text) =>
	{
		line = text;
	});
	return {
		code,
		line,
	};
}

/** Records the fixture's current HEAD into `name`, returning the record's path. */
async function record(name = "record.json", release = "v3.1.0"): Promise<string>
{
	const path = join(out, name);
	const result = await run(["record", path, "--worker-meta", join(out, "worker-meta.json"), "--vite", join(out, "vite.json"), "--origin", "https://pr-1.example.dev"], release);
	expect(result, result.line).toMatchObject({
		code: 0,
	});
	return path;
}

/** The files a record lists. */
function files(path: string): Record<string, string>
{
	return (JSON.parse(readFileSync(path, "utf8")) as { files: Record<string, string> }).files;
}

beforeAll(() =>
{
	root = mkdtempSync(join(tmpdir(), "build-inputs-repo-"));
	out = mkdtempSync(join(tmpdir(), "build-inputs-out-"));
	git("init", "-q");
	put("package.json", "{\"name\":\"root\"}\n");
	put("pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
	put("pnpm-workspace.yaml", "packages:\n    - \"packages/*\"\n    - \"functions\"\n    - \"web\"\n");
	put(".nvmrc", "24\n");
	put("wrangler.jsonc", "{}\n");
	put("tsconfig.base.json", "{}\n");
	put("README.md", "# fixture\n");
	put(".github/workflows/deploy.yml", "name: Deploy\n");
	put("packages/domain/package.json", "{}\n");
	put("packages/domain/tsconfig.json", "{}\n");
	put("packages/domain/src/index.ts", "export const x = 1;\n");
	put("web/package.json", "{}\n");
	put("web/tsconfig.json", "{}\n");
	put("web/index.html", "<!doctype html>\n");
	put("web/public/icons/flag.svg", "<svg/>\n");
	put("web/vite.config.ts", "import { PWA } from \"./src/pwa/options.js\";\nimport { defineConfig } from \"vite\";\nexport default defineConfig({ plugins: [PWA] });\n");
	put("web/src/pwa/options.ts", "export const PWA = {};\n");
	put("web/src/main.ts", "import { util } from \"./util.js\";\nutil();\n");
	put("web/src/util.ts", "export function util(): void {}\n");
	put("web/src/main.test.ts", "import \"./main.js\";\n");
	put("functions/package.json", "{}\n");
	put("functions/tsconfig.json", "{}\n");
	put("functions/src/worker.ts", "export default {};\n");
	put("functions/src/worker.test.ts", "import \"./worker.js\";\n");
	put("functions/src/adapters/postgres/migrations/0000_initial.sql", "create table t ();\n");
	put("functions/src/adapters/postgres/migrations/meta/_journal.json", "{}\n");
	put("functions/src/scripts/deploy-bootstrap.ts", "import { bootstrap } from \"../deploy/bootstrap.js\";\nimport pg from \"pg\";\nbootstrap(pg);\n");
	put("functions/src/deploy/bootstrap.ts", "export function bootstrap(_: unknown): void {}\n");
	put("functions/src/scripts/db-migrate.ts", "import { readFileSync } from \"node:fs\";\nreadFileSync;\n");
	commit("fixture");
	// As the Vite plugin writes them: absolute ids, a query, virtual modules and a dependency.
	writeFileSync(join(out, "vite.json"), JSON.stringify([
		join(root, "web/index.html"),
		join(root, "web/src/main.ts"),
		`${join(root, "web/src/util.ts")}?used`,
		"\0vite/preload-helper.js",
		"virtual:pwa-register",
		"/@vite-plugin-pwa/virtual:pwa-register",
		join(root, "node_modules/.pnpm/react@19/node_modules/react/index.js"),
	]));
	// As `wrangler deploy --metafile` writes it: paths relative to wrangler.jsonc's folder, the root.
	writeFileSync(join(out, "worker-meta.json"), JSON.stringify({
		inputs: {
			"functions/src/worker.ts": {},
			"packages/domain/src/index.ts": {},
			"node_modules/.pnpm/pg@8/node_modules/pg/lib/index.js": {},
			"node-built-in-modules:events": {},
		},
	}));
});

afterAll(() =>
{
	for (const dir of [root, out]) rmSync(dir, {
		recursive: true,
		force: true,
	});
});

describe("build-inputs record (S146 AC 1)", () =>
{
	it("S146 AC 1: records a file the build imports, from Vite's list, the Worker's metafile and the scripts' graph", async () =>
	{
		const listed = files(await record());
		const tree = gitTree(root);
		for (const path of ["web/src/main.ts", "web/src/util.ts", "functions/src/worker.ts", "packages/domain/src/index.ts", "functions/src/scripts/deploy-bootstrap.ts"])
		{
			expect(listed[path], path).toBe(tree.get(path));
		}
		const parsed = JSON.parse(readFileSync(join(out, "record.json"), "utf8")) as Record<string, unknown>;
		expect(parsed).toMatchObject({
			format: BUILD_INPUTS_FORMAT,
			commit: git("rev-parse", "HEAD").trim(),
			release: "v3.1.0",
			origin: "https://pr-1.example.dev",
		});
	});

	it("S146 AC 1: leaves out a Markdown file and a test file", async () =>
	{
		const listed = files(await record());
		for (const path of ["README.md", "web/src/main.test.ts", "functions/src/worker.test.ts"]) expect(listed, path).not.toHaveProperty([path]);
	});

	it("S146 AC 1: records a web/public file, a migration, web/index.html and a file a config imports", async () =>
	{
		const listed = files(await record());
		for (const path of ["web/public/icons/flag.svg", "functions/src/adapters/postgres/migrations/0000_initial.sql", "functions/src/adapters/postgres/migrations/meta/_journal.json",
			"web/index.html", "web/vite.config.ts", "web/src/pwa/options.ts", "pnpm-lock.yaml", ".nvmrc", "wrangler.jsonc", ".github/workflows/deploy.yml", "package.json",
			"web/package.json", "functions/package.json", "packages/domain/package.json", "packages/domain/tsconfig.json", "tsconfig.base.json"])
		{
			expect(listed, path).toHaveProperty([path]);
		}
	});

	it("S146 AC 1: leaves out node_modules paths and virtual modules without failing", async () =>
	{
		const listed = Object.keys(files(await record()));
		expect(listed.filter((path) => /node_modules|virtual:|\0|:/.test(path))).toEqual([]);
		expect(repoPath(root, root, "\0commonjsHelpers.js")).toBeUndefined();
		expect(repoPath(root, root, "virtual:pwa-register")).toBeUndefined();
		expect(repoPath(root, root, "node-built-in-modules:events")).toBeUndefined();
		expect(repoPath(root, root, join(root, "web/node_modules/x/index.js"))).toBeUndefined();
		expect(repoPath(root, root, "/elsewhere/file.ts")).toBeUndefined();
		expect(repoPath(root, root, "?only-a-query")).toBeUndefined();
		expect(repoPath(root, join(root, "functions"), "src/worker.ts?x")).toBe("functions/src/worker.ts");
	});

	it("S146 AC 1: records a file only deploy-bootstrap.ts imports, so an edit to it alone makes check fail", async () =>
	{
		const path = await record("bootstrap.json");
		expect(files(path)).toHaveProperty(["functions/src/deploy/bootstrap.ts"]);
		expect(await run(["check", path])).toEqual({
			code: 0,
			line: "unchanged",
		});
		put("functions/src/deploy/bootstrap.ts", "export function bootstrap(_: unknown): void { /* new config */ }\n");
		commit("edit bootstrap");
		expect(await run(["check", path])).toEqual({
			code: 1,
			line: "functions/src/deploy/bootstrap.ts changed",
		});
	});

	it("S146 AC 1: check fails given a different BT_RELEASE than the record's", async () =>
	{
		const path = await record("release.json", "v3.1.0");
		expect((await run(["check", path], "v3.1.0")).code).toBe(0);
		expect(await run(["check", path], "v3.2.0")).toEqual({
			code: 1,
			line: "BT_RELEASE differs: the record's is \"v3.1.0\", this build's \"v3.2.0\"",
		});
	});

	it("S146 AC 1: a file the build read that git doesn't track fails the record instead of leaving it out", async () =>
	{
		put("web/src/untracked.ts", "export {};\n");
		writeFileSync(join(out, "vite-untracked.json"), JSON.stringify([join(root, "web/src/untracked.ts")]));
		const result = await run(["record", join(out, "untracked.json"), "--worker-meta", join(out, "worker-meta.json"), "--vite", join(out, "vite-untracked.json")]);
		expect(result).toEqual({
			code: 1,
			line: "record failed: the build read web/src/untracked.ts, which git does not track at this commit",
		});
		rmSync(join(root, "web/src/untracked.ts"));
	});

	it("S146 AC 1: the named list follows pnpm-workspace.yaml's packages, one level under a star", () =>
	{
		const tree = new Map([["packages/a/package.json", "1"], ["packages/a/deep/package.json", "2"], ["e2e/package.json", "3"], ["web/tsconfig.node.json", "4"], ["web/package.json", "5"]]);
		expect(namedInputs(tree, "packages:\n  - 'packages/*'\n  - web\n")).toEqual(["packages/a/package.json", "web/package.json", "web/tsconfig.node.json"]);
	});
});

describe("build-inputs check (S146 AC 2)", () =>
{
	it("S146 AC 2: check prints unchanged when only files the build never read changed", async () =>
	{
		const path = await record("unchanged.json");
		put("README.md", "# fixture, edited\n");
		put("web/src/main.test.ts", "import \"./main.js\";\n// more\n");
		commit("docs and tests");
		expect(await run(["check", path])).toEqual({
			code: 0,
			line: "unchanged",
		});
	});

	it("S146 AC 2: fails with no record", async () =>
	{
		expect(await run(["check", join(out, "missing.json")])).toEqual({
			code: 1,
			line: "no record",
		});
	});

	it("S146 AC 2: fails on a record it can't parse", async () =>
	{
		writeFileSync(join(out, "bad.json"), "{not json");
		expect(await run(["check", join(out, "bad.json")])).toMatchObject({
			code: 1,
			line: "the record can't be parsed (not JSON)",
		});
		for (const text of ["null", JSON.stringify({
			format: BUILD_INPUTS_FORMAT,
			commit: "c",
			release: "",
			files: {
				a: 1,
			},
		}), JSON.stringify({
			format: BUILD_INPUTS_FORMAT,
			commit: "c",
			release: "",
			files: [],
		})])
		{
			expect(checkBuildInputs(text, new Map(), "")).toMatchObject({
				ok: false,
				reason: expect.stringMatching(/can't be parsed/),
			});
		}
	});

	it("S146 AC 2: fails when a listed file's hash changed", async () =>
	{
		const path = await record("hash.json");
		put("web/public/icons/flag.svg", "<svg id=\"new\"/>\n");
		commit("new icon");
		expect(await run(["check", path])).toEqual({
			code: 1,
			line: "web/public/icons/flag.svg changed",
		});
	});

	it("S146 AC 2: fails when a listed file was deleted", async () =>
	{
		const path = await record("deleted.json");
		git("rm", "-q", "functions/src/adapters/postgres/migrations/meta/_journal.json");
		commit("delete");
		expect(await run(["check", path])).toEqual({
			code: 1,
			line: "functions/src/adapters/postgres/migrations/meta/_journal.json was deleted",
		});
		put("functions/src/adapters/postgres/migrations/meta/_journal.json", "{}\n");
		commit("restore");
	});

	it("S146 AC 2: fails on a record made by a different version of the command", async () =>
	{
		const path = await record("version.json");
		const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
		writeFileSync(path, JSON.stringify({
			...parsed,
			format: "bt-build-inputs/0",
		}));
		expect(await run(["check", path])).toEqual({
			code: 1,
			line: `the record was made by "bt-build-inputs/0", not ${BUILD_INPUTS_FORMAT}`,
		});
	});

	it("S146 AC 2: adding an import to a recorded file fails check, so a new source file can't slip in", async () =>
	{
		const path = await record("import.json");
		put("web/src/added.ts", "export const added = 1;\n");
		put("web/src/main.ts", "import { util } from \"./util.js\";\nimport { added } from \"./added.js\";\nutil(added);\n");
		commit("new module");
		expect(await run(["check", path])).toEqual({
			code: 1,
			line: "web/src/main.ts changed",
		});
	});

	it("S146 AC 2: runs with plain node and no installed dependencies, before pnpm install", async () =>
	{
		const path = await record("plain.json");
		// A copy with no node_modules anywhere above it: only node: imports can load.
		const bare = mkdtempSync(join(tmpdir(), "build-inputs-bare-"));
		copyFileSync(BUILD_INPUTS_SCRIPT, join(bare, "build-inputs.ts"));
		const result = spawnSync(process.execPath, [join(bare, "build-inputs.ts"), "check", path], {
			cwd: root,
			encoding: "utf8",
			env: {
				PATH: process.env.PATH,
				BT_RELEASE: "v3.1.0",
			},
		});
		rmSync(bare, {
			recursive: true,
			force: true,
		});
		expect(result.stderr).toBe("");
		expect({
			status: result.status,
			stdout: result.stdout,
		}).toEqual({
			status: 0,
			stdout: "unchanged\n",
		});
	});

	it("S146 AC 2: --served must be the record's commit; get prints a record's fields; bad usage exits 2", async () =>
	{
		const path = await record("served.json");
		const head = git("rev-parse", "HEAD").trim();
		expect((await run(["check", path, "--served", head])).code).toBe(0);
		expect(await run(["check", path, "--served", "0".repeat(40)])).toEqual({
			code: 1,
			line: `the record names ${head}, but ${"0".repeat(40)} is served`,
		});
		expect(await run(["get", path, "commit"])).toEqual({
			code: 0,
			line: head,
		});
		expect(await run(["get", path, "origin"])).toEqual({
			code: 0,
			line: "https://pr-1.example.dev",
		});
		expect(await run(["get", join(out, "missing.json"), "commit"])).toEqual({
			code: 1,
			line: "no record",
		});
		expect((await run(["get", path, "files"])).code).toBe(2);
		expect((await run(["record", join(out, "x.json")])).code).toBe(2);
		expect((await run(["nope", "x"])).code).toBe(2);
		expect((await run([])).code).toBe(2);
	});
});
