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

	it("S146 AC 1: record creates the folder it writes into", async () =>
	{
		const path = join(out, "nested", "dir", "build-inputs.json");
		const result = await run(["record", path, "--worker-meta", join(out, "worker-meta.json"), "--vite", join(out, "vite.json")]);
		expect(result, result.line).toMatchObject({
			code: 0,
		});
		expect(files(path)).toHaveProperty(["web/src/main.ts"]);
	});

	it("S146 AC 1: records the configs Vite finds by lookup (web/postcss.config.cjs), so an edit to one alone fails check", async () =>
	{
		put("web/postcss.config.cjs", "module.exports = { plugins: { \"postcss-preset-mantine\": {} } };\n");
		commit("postcss config");
		const path = await record("lookup.json");
		expect(files(path)).toHaveProperty(["web/postcss.config.cjs"]);
		put("web/postcss.config.cjs", "module.exports = { plugins: { \"postcss-preset-mantine\": { breakpoint: \"50em\" } } };\n");
		commit("edit postcss config");
		expect(await run(["check", path])).toEqual({
			code: 1,
			line: "web/postcss.config.cjs changed",
		});
		const again = await record("lookup-env.json");
		put("web/.env.production", "VITE_X=1\n");
		commit("a new env file");
		expect(await run(["check", again])).toEqual({
			code: 1,
			line: "web/.env.production is new",
		});
		git("rm", "-q", "web/.env.production");
		commit("drop the env file");
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

	it("S146 AC 2: a new file in a named folder, or a new named file, fails check", async () =>
	{
		const path = await record("named-new.json");
		for (const added of ["web/public/robots.txt", "web/tsconfig.node.json", "packages/x/package.json"])
		{
			put(added, "{}\n");
			commit(`add ${added}`);
			expect(await run(["check", path]), added).toEqual({
				code: 1,
				line: `${added} is new`,
			});
			git("rm", "-q", added);
			commit(`drop ${added}`);
			expect((await run(["check", path])).line, added).toBe("unchanged");
		}
	});

	it("S146 AC 2: a record that lists no files is never unchanged", async () =>
	{
		const empty = JSON.stringify({
			format: BUILD_INPUTS_FORMAT,
			commit: "c",
			release: "v3.1.0",
			origin: "",
			covers: "",
			files: {},
		});
		expect(checkBuildInputs(empty, new Map(), "v3.1.0")).toEqual({
			ok: false,
			reason: "the record lists no files",
		});
		writeFileSync(join(out, "empty.json"), empty);
		expect(await run(["check", join(out, "empty.json")])).toEqual({
			code: 1,
			line: "the record lists no files",
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

describe("build-inputs trust, runs, cover and stands (S146 AC 3)", () =>
{
	const REPO = "owner/bt";
	let stage = "";
	let older = "";
	let side = "";

	/** An artifact as the Actions API lists it. */
	function artifact(id: number, run: number, createdAt: string, extra: Record<string, unknown> = {}): Record<string, unknown>
	{
		return {
			id,
			name: "build-inputs-staging",
			expired: false,
			created_at: createdAt,
			workflow_run: {
				id: run,
			},
			...extra,
		};
	}

	/** A run as `actions/runs/<id>` returns it: by default a push to stage of this repository's deploy.yml. */
	function runOf(id: number, extra: Record<string, unknown> = {}): Record<string, unknown>
	{
		return {
			id,
			event: "push",
			head_branch: "stage",
			head_sha: stage,
			path: ".github/workflows/deploy.yml",
			repository: {
				full_name: REPO,
			},
			head_repository: {
				full_name: REPO,
			},
			...extra,
		};
	}

	/** Writes the artifacts list and the runs folder, then runs `trust` with them. */
	async function trust(artifacts: Record<string, unknown>[], runs: Record<string, unknown>[], args: string[] = ["--env", "staging", "--name", "build-inputs-staging"]): Promise<{ code: number;
		line: string; }>
	{
		const dir = mkdtempSync(join(out, "trust-"));
		mkdirSync(join(dir, "runs"));
		writeFileSync(join(dir, "artifacts.json"), JSON.stringify({
			total_count: artifacts.length,
			artifacts,
		}));
		for (const r of runs) writeFileSync(join(dir, "runs", `${String(r.id)}.json`), JSON.stringify(r));
		return run(["trust", "--stage-ref", "origin/stage", ...args, "--artifacts", join(dir, "artifacts.json"), "--runs-dir", join(dir, "runs"), "--repo", REPO]);
	}

	/** A staging record of `commit`, covering `covers`. */
	function recordOf(name: string, commit: string, covers: string, format = BUILD_INPUTS_FORMAT): string
	{
		const path = join(out, name);
		writeFileSync(path, JSON.stringify({
			format,
			commit,
			release: "v3.1.0",
			origin: "https://stage.example",
			covers,
			files: {
				"web/src/main.ts": "0".repeat(40),
			},
		}));
		return path;
	}

	beforeAll(() =>
	{
		for (const n of [1, 2, 3])
		{
			put(`notes/stage-${n}.txt`, `${n}\n`);
			commit(`stage ${n}`);
		}
		stage = git("rev-parse", "HEAD").trim();
		older = git("rev-parse", "HEAD~1").trim();
		git("update-ref", "refs/remotes/origin/stage", stage);
		// A commit that is not on stage, as one dispatched on a tag named `stage` would be.
		side = git("commit-tree", "HEAD^{tree}", "-p", "HEAD", "-m", "side").trim();
		git("tag", "stage-side", side);
	});

	it("S146 AC 3: trust takes the newest record from this repository's own push or manual run on stage, skipping a fork's newer one", async () =>
	{
		const fork = runOf(2, {
			event: "pull_request",
			head_repository: {
				full_name: "someone/bt",
			},
		});
		expect(await trust([artifact(20, 2, "2026-11-26T10:00:00Z"), artifact(10, 1, "2026-11-25T10:00:00Z")], [runOf(1), fork])).toEqual({
			code: 0,
			line: "10",
		});
		expect((await trust([artifact(11, 3, "2026-11-25T10:00:00Z")], [runOf(3, {
			event: "workflow_dispatch",
			head_sha: older,
		})])).line).toBe("11");
	});

	it("S146 AC 3: trust rejects a same-repository pull request run on a branch named stage, another workflow's run, and an expired record", async () =>
	{
		const pr = runOf(4, {
			event: "pull_request",
		});
		const ci = runOf(5, {
			path: ".github/workflows/ci.yml",
		});
		expect(await trust([artifact(40, 4, "2026-11-26T10:00:00Z"), artifact(50, 5, "2026-11-26T09:00:00Z"), artifact(60, 6, "2026-11-26T08:00:00Z", {
			expired: true,
		})], [pr, ci, runOf(6)])).toEqual({
			code: 0,
			line: "",
		});
	});

	it("S146 AC 3: trust rejects a manual run whose commit is not on stage (a tag named stage) or that git doesn't have", async () =>
	{
		const tagged = runOf(7, {
			event: "workflow_dispatch",
			head_sha: side,
		});
		const unknown = runOf(8, {
			head_sha: "f".repeat(40),
		});
		expect(await trust([artifact(70, 7, "2026-11-26T10:00:00Z"), artifact(80, 8, "2026-11-26T09:00:00Z"), artifact(90, 9, "2026-11-25T10:00:00Z")], [tagged, unknown, runOf(9)])).toEqual({
			code: 0,
			line: "90",
		});
	});

	it("S146 AC 3: trust for a preview accepts only that pull request's own runs; bad usage exits 2", async () =>
	{
		const preview = (id: number, ref: string) => runOf(id, {
			event: "pull_request",
			head_branch: ref,
			head_sha: side,
		});
		const art = (id: number, run: number, at: string) => artifact(id, run, at, {
			name: "build-inputs-preview-7",
		});
		const args = ["--env", "preview", "--name", "build-inputs-preview-7", "--head-ref", "story/S1"];
		expect(await trust([art(1, 1, "2026-11-26T10:00:00Z"), art(2, 2, "2026-11-25T10:00:00Z")], [preview(1, "story/S2"), preview(2, "story/S1")], args)).toEqual({
			code: 0,
			line: "2",
		});
		expect((await trust([], [], ["--env", "preview", "--name", "x"])).code).toBe(2);
		expect((await run(["trust", "--env", "staging", "--name", "x", "--artifacts", "a", "--runs-dir", "d", "--repo", REPO])).code).toBe(2);
		expect((await run(["trust", "--env", "other", "--name", "x", "--artifacts", "a", "--runs-dir", "d", "--repo", REPO])).code).toBe(2);
	});

	it("S146 AC 3: runs lists the runs of the newest 20 unexpired records of a name, newest first", async () =>
	{
		const list = Array.from({
			length: 25,
		}, (_, i) => artifact(100 + i, 1000 + i, `2026-11-${String(i + 1).padStart(2, "0")}T00:00:00Z`));
		list.push(artifact(200, 1024, "2026-11-30T00:00:00Z"), artifact(201, 2001, "2026-11-30T01:00:00Z", {
			expired: true,
		}), artifact(202, 2002, "2026-11-30T02:00:00Z", {
			name: "build-inputs-preview-1",
		}));
		writeFileSync(join(out, "runs-artifacts.json"), JSON.stringify({
			artifacts: list,
		}));
		const result = await run(["runs", join(out, "runs-artifacts.json"), "--name", "build-inputs-staging"]);
		expect(result.code).toBe(0);
		const ids = result.line.split("\n");
		// The newest 20 records, of 19 runs: run 1024 stored two of them (a re-run attempt), so it is listed once.
		expect(ids).toHaveLength(19);
		expect(ids.slice(0, 3)).toEqual(["1024", "1023", "1022"]);
		expect(ids.at(-1)).toBe("1006");
		expect((await run(["runs", join(out, "runs-artifacts.json")])).code).toBe(2);
	});

	it("S146 AC 3: cover records that staging stands for a newer commit too, and never moves back", async () =>
	{
		const path = recordOf("cover-base.json", older, "");
		const first = join(out, "cover", "first.json");
		expect((await run(["cover", path, stage, first])).code).toBe(0);
		const covered = JSON.parse(readFileSync(first, "utf8")) as Record<string, unknown>;
		expect(covered).toMatchObject({
			commit: older,
			covers: stage,
			release: "v3.1.0",
			files: {
				"web/src/main.ts": "0".repeat(40),
			},
		});
		const second = join(out, "cover", "second.json");
		expect((await run(["cover", first, older, second])).code).toBe(0);
		expect((JSON.parse(readFileSync(second, "utf8")) as { covers: string }).covers).toBe(stage);
		expect(await run(["cover", join(out, "missing.json"), stage, second])).toEqual({
			code: 1,
			line: "no record",
		});
		expect((await run(["cover", path])).code).toBe(2);
	});

	it("S146 AC 3: stands prints the commit a skip covered, or else the served commit, always exiting 0", async () =>
	{
		const base = git("rev-parse", `${older}~1`).trim();
		expect(await run(["stands", recordOf("stands.json", base, stage), "--served", base])).toEqual({
			code: 0,
			line: stage,
		});
		const cases: [string, string][] = [
			[recordOf("stands-other.json", base, stage), older],
			[recordOf("stands-none.json", base, ""), base],
			[recordOf("stands-unknown.json", base, "f".repeat(40)), base],
			[recordOf("stands-backward.json", stage, base), stage],
			[recordOf("stands-v1.json", base, stage, "bt-build-inputs/1"), base],
			[join(out, "missing.json"), base],
		];
		writeFileSync(join(out, "stands-bad.json"), "{not json");
		cases.push([join(out, "stands-bad.json"), base]);
		for (const [path, served] of cases)
		{
			expect(await run(["stands", path, "--served", served]), path).toEqual({
				code: 0,
				line: served,
			});
		}
		expect((await run(["stands", join(out, "missing.json")])).code).toBe(2);
	});
});
