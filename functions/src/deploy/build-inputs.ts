/**
 * The build's inputs (S146): what a staging or preview deploy's build read, so the next deploy can
 * skip installing, building, migrating and deploying when none of it changed (owner, 2026-11-11:
 * "check the inputs to the build at build time or prior to it (ideal)", then "yeah, I like your
 * plan" to recording what the build reads and checking those files' hashes before the next build).
 *
 * `record <out>` runs after a build and writes a JSON record: every repository file the build read,
 * each with its git blob hash at the checked-out commit, the release label (`BT_RELEASE`, which
 * `web/vite.config.ts` builds into the version line) and the commit the deploy names. The files come
 * from the bundlers' own graphs, never a hand list of folders:
 * - the web build: the module ids Vite reported (the `bt-build-inputs` plugin in `web/vite.config.ts`);
 * - the Worker: the inputs of the esbuild metafile `wrangler deploy --dry-run --metafile` writes;
 * - the deploy steps' scripts and the configs' own imports: an esbuild graph of {@link GRAPH_ENTRIES};
 * plus the short list {@link namedInputs} keeps of what no bundler sees (the lockfile, package and
 * TypeScript configs, `web/index.html`, `web/public/`, the migrations, the workflow and its shell
 * scripts, and the configs Vite finds by lookup rather than import, such as `web/postcss.config.cjs`).
 * `node_modules/` and virtual modules have no blob and are left out: `pnpm-lock.yaml` stands for the
 * dependencies.
 *
 * `check <record>` runs before anything is installed: this file imports only `node:` modules, so
 * Node 24 runs it as it is (type stripping), and the esbuild that `record` needs is loaded only then.
 * It prints `unchanged` and exits 0 only when the record parses, was made by this format, lists at
 * least one file, names the `BT_RELEASE` given, (with `--served`) names the commit staging serves,
 * every file it lists has the same blob at HEAD, and HEAD's named list holds no file the record lacks.
 * A new source file can only join a build through an import added to a file already recorded, so that
 * edit changes a recorded hash; a new file in the named list (a `web/public/` file, a migration, a
 * workspace `package.json`, a lookup config) imports nothing, so `check` compares the named list itself.
 *
 * Staging's skips (AC 3): `cover` stores the record again naming, as `covers`, a newer commit a run
 * found unchanged, and `stands` says which commit staging stands for, so an older run queued behind
 * that skip never deploys over it. `runs` and `trust` pick which stored record to believe: only one
 * this repository's own Deploy runs stored, for staging only from a push or manual run of a `stage` commit.
 */
import { execFileSync } from "node:child_process";
import {
	existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import {
	dirname, isAbsolute, join, relative, resolve,
} from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** The record's format; a record of any other format is never trusted, so changing what is recorded changes this. */
export const BUILD_INPUTS_FORMAT = "bt-build-inputs/2";

/** One deploy's record of its build's inputs. */
export interface BuildInputsRecord
{
	/** {@link BUILD_INPUTS_FORMAT} when it was made. */
	format: string;
	/** The commit the deploy names: staging's `GITHUB_SHA`, a preview's pull request head. */
	commit: string;
	/** The `BT_RELEASE` the build saw ("" when unset). */
	release: string;
	/** The address the deploy serves ("" when not given): a skipped preview's comment repeats it. */
	origin: string;
	/**
	 * A newer `stage` commit whose run found this record unchanged and skipped (`cover`), so staging
	 * serving `commit` stands for it too ("" when none). Only staging's skips write it.
	 */
	covers: string;
	/** Each input's repository path and its git blob hash, sorted by path. */
	files: Record<string, string>;
}

/** What `check` found: unchanged, or the first difference in words. */
export type CheckResult = { ok: true } | { ok: false;
	reason: string; };

/**
 * The entries whose esbuild graph is recorded (AC 1): the scripts the deploy steps run
 * (`pnpm deploy:bootstrap`, `db:migrate`, `db:reapply-deletions`, this recorder) and the Vite config,
 * whose imports (`web/src/pwa/options.ts` among them) change the build. Their imports are followed
 * into the workspace packages; any other bare import is a dependency, which the lockfile stands for.
 */
export const GRAPH_ENTRIES = [
	"functions/src/scripts/deploy-bootstrap.ts",
	"functions/src/scripts/db-migrate.ts",
	"functions/src/scripts/db-reapply-deletions.ts",
	"functions/src/deploy/build-inputs.ts",
	"web/vite.config.ts",
];

/** Single files outside every graph (AC 1's named list), each recorded when the commit has it. */
export const NAMED_FILES = [
	"pnpm-lock.yaml",
	"pnpm-workspace.yaml",
	"package.json",
	".nvmrc",
	"wrangler.jsonc",
	"tsconfig.base.json",
	"web/index.html",
	"web/vite.config.ts",
	".github/workflows/deploy.yml",
	// The shell scripts deploy.yml's staging and preview steps run (neither sources another file).
	"scripts/build-release.sh",
	"scripts/preview-pr-open.sh",
];

/** Folders whose every file is an input: copied into the build (`web/public/`) or applied by the deploy (the migrations). */
const NAMED_FOLDERS = ["web/public/", "functions/src/adapters/postgres/migrations/"];

/**
 * Configs a tool finds by looking for a file name, never through an import, so no graph lists them:
 * PostCSS's (postcss-load-config, from Vite's root `web/`), Vite's `.env` files (its envDir is `web/`),
 * browserslist's, and the install's `.npmrc`; a root `tsconfig.json` if one appears. Matched in the tree,
 * so a new one is a new named input that `check` reports.
 */
const NAMED_LOOKUPS = [/^web\/postcss\.config\.[cm]?[jt]s$/, /^web\/\.postcssrc(\.\w+)?$/, /^web\/\.env(\..+)?$/, /^web\/\.browserslistrc$/, /^tsconfig\.json$/, /^\.npmrc$/];

/** The workspace package folders `pnpm-workspace.yaml` lists (`packages/*` matches one level), as found in `tree`. */
export function workspaceDirs(workspaceYaml: string, tree: Map<string, string>): string[]
{
	const globs = [...workspaceYaml.matchAll(/^\s*-\s*["']?([^"'\s#]+)["']?/gm)].map((m) => m[1]!.replace(/\/$/, ""));
	const dirs = new Set<string>();
	for (const path of tree.keys())
	{
		const m = /^(.*)\/package\.json$/.exec(path);
		if (!m) continue;
		const dir = m[1]!;
		if (globs.some((glob) => new RegExp(`^${glob.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]+")}$`).test(dir))) dirs.add(dir);
	}
	return [...dirs].sort();
}

/** AC 1's named list, as it stands in `tree`: the single files, the lookup configs, each workspace's `package.json` and `tsconfig*.json`, and the named folders' files. */
export function namedInputs(tree: Map<string, string>, workspaceYaml: string): string[]
{
	const dirs = workspaceDirs(workspaceYaml, tree);
	const out: string[] = NAMED_FILES.filter((path) => tree.has(path));
	for (const path of tree.keys())
	{
		if (NAMED_FOLDERS.some((folder) => path.startsWith(folder)) || NAMED_LOOKUPS.some((pattern) => pattern.test(path))) out.push(path);
		const slash = path.lastIndexOf("/");
		if (slash > 0 && dirs.includes(path.slice(0, slash)) && /^(package\.json|tsconfig[\w.-]*\.json)$/.test(path.slice(slash + 1))) out.push(path);
	}
	return [...new Set(out)].sort();
}

/**
 * A bundler's module id as a repository path, or undefined when git can hold no blob for it: a
 * virtual module (`\0…`, `virtual:…`, or any `<namespace>:` id esbuild gives, such as
 * `node-built-in-modules:events`), a file under `node_modules/`, or one outside the repository.
 * A query (`?worker`, `?url`) is dropped. Relative ids are read against `base` (the bundle's root).
 */
export function repoPath(root: string, base: string, id: string): string | undefined
{
	if (id.startsWith("\0") || id.includes("virtual:") || /^[a-z][\w-]*:/i.test(id)) return undefined;
	const file = id.replace(/[?#].*$/, "");
	if (!file) return undefined;
	const rel = relative(root, isAbsolute(file) ? file : resolve(base, file)).split("\\").join("/");
	if (!rel || rel.startsWith("../") || isAbsolute(rel) || rel.split("/").includes("node_modules")) return undefined;
	return rel;
}

/** The paths an esbuild metafile's `inputs` name (relative to `base`, the directory the bundle ran from). */
export function metafileInputs(root: string, base: string, meta: unknown): string[]
{
	const inputs = (meta as { inputs?: unknown } | null)?.inputs;
	if (!inputs || typeof inputs !== "object") throw new Error("the Worker metafile has no inputs");
	return Object.keys(inputs).flatMap((id) => repoPath(root, base, id) ?? []);
}

/** Runs git in `root` and returns its output. */
function git(root: string, args: string[]): string
{
	return execFileSync("git", args, {
		cwd: root,
		encoding: "utf8",
		maxBuffer: 256 * 1024 * 1024,
	});
}

/** Whether git in `root` succeeds with `args` (a yes/no question such as `merge-base --is-ancestor`), quietly. */
function gitSays(root: string, args: string[]): boolean
{
	try
	{
		execFileSync("git", args, {
			cwd: root,
			stdio: "ignore",
		});
		return true;
	}
	catch
	{
		return false;
	}
}

/** Whether `sha` is a commit git has and is `ref` or one of its ancestors. */
function commitWithin(root: string, sha: string, ref: string): boolean
{
	return /^[0-9a-f]{40}$/.test(sha) && gitSays(root, ["cat-file", "-e", `${sha}^{commit}`]) && gitSays(root, ["merge-base", "--is-ancestor", sha, ref]);
}

/** Every tracked file at `rev` with its blob hash (submodules and symlinks included as git lists them). */
export function gitTree(root: string, rev = "HEAD"): Map<string, string>
{
	const tree = new Map<string, string>();
	for (const entry of git(root, ["ls-tree", "-r", "-z", "--full-tree", rev]).split("\0"))
	{
		const m = /^\d+ \w+ ([0-9a-f]+)\t(.+)$/s.exec(entry);
		if (m) tree.set(m[2]!, m[1]!);
	}
	return tree;
}

/**
 * The repository files {@link GRAPH_ENTRIES} import, from esbuild's metafile of a bundle of them
 * (never written). esbuild is the one wrangler bundles the Worker with, loaded through wrangler from
 * this file's own install (so `check` never needs it); an entry the commit lacks is skipped.
 */
export async function graphInputs(root: string, entries: string[] = GRAPH_ENTRIES): Promise<string[]>
{
	const present = entries.filter((entry) => existsSync(resolve(root, entry)));
	if (present.length === 0) return [];
	const fromHere = createRequire(import.meta.url);
	const esbuild = createRequire(fromHere.resolve("wrangler"))("esbuild") as {
		build(options: Record<string, unknown>): Promise<{ metafile: unknown }>;
	};
	const result = await esbuild.build({
		absWorkingDir: root,
		entryPoints: present,
		bundle: true,
		write: false,
		metafile: true,
		outdir: "out",
		platform: "node",
		format: "esm",
		logLevel: "silent",
		plugins: [
			{
				name: "dependencies-external",
				setup(build: { onResolve(options: { filter: RegExp }, callback: (args: { path: string }) => { external: boolean } | undefined): void })
				{
					// A bare import is a dependency (the lockfile records it) unless it names a workspace package.
					build.onResolve({
						filter: /^[^./]/,
					}, (args) => (args.path.startsWith("@bt/") ? undefined : {
						external: true,
					}));
				},
			},
		],
	});
	return metafileInputs(root, root, result.metafile);
}

/** What {@link recordBuildInputs} is given. */
export interface RecordInput
{
	/** The checked-out commit's files and blobs ({@link gitTree}). */
	tree: Map<string, string>;
	commit: string;
	release: string;
	origin?: string;
	/** Every input's repository path, from the graphs and {@link namedInputs}. */
	paths: string[];
}

/**
 * The record of one build. A path git doesn't track at the built commit fails it: the build read a
 * file no later commit's check could compare, so a record without it would say `unchanged` wrongly.
 */
export function recordBuildInputs(input: RecordInput): BuildInputsRecord
{
	const files: Record<string, string> = {};
	for (const path of [...new Set(input.paths)].sort())
	{
		const blob = input.tree.get(path);
		if (!blob) throw new Error(`the build read ${path}, which git does not track at this commit`);
		files[path] = blob;
	}
	return {
		format: BUILD_INPUTS_FORMAT,
		commit: input.commit,
		release: input.release,
		origin: input.origin ?? "",
		covers: "",
		files,
	};
}

/** Parses a record's text, or says why it can't be trusted (unparseable, or another format). */
export function parseRecord(text: string): BuildInputsRecord | string
{
	let value: unknown;
	try
	{
		value = JSON.parse(text);
	}
	catch
	{
		return "the record can't be parsed (not JSON)";
	}
	const r = value as Partial<BuildInputsRecord> | null;
	if (!r || typeof r !== "object") return "the record can't be parsed (not an object)";
	if (r.format !== BUILD_INPUTS_FORMAT) return `the record was made by ${JSON.stringify(r.format ?? null)}, not ${BUILD_INPUTS_FORMAT}`;
	const files = r.files as unknown;
	if (typeof r.commit !== "string" || typeof r.release !== "string" || !files || typeof files !== "object" || Array.isArray(files)
		|| Object.values(files).some((blob) => typeof blob !== "string"))
	{
		return "the record can't be parsed (missing commit, release or files)";
	}
	return {
		format: r.format,
		commit: r.commit,
		release: r.release,
		origin: typeof r.origin === "string" ? r.origin : "",
		covers: typeof r.covers === "string" ? r.covers : "",
		files: files as Record<string, string>,
	};
}

/**
 * Whether the record still describes a build of `tree` (HEAD) with `release`: the first difference
 * found, or ok. `served`, when given, must be the record's commit (staging's served-commit rule, AC 3).
 * `named`, HEAD's {@link namedInputs}, must all be in the record: a new `web/public/` file or migration
 * changes no recorded file's hash, so this is the only way `check` sees it. A record listing no files
 * describes no build and is never unchanged (a forged one would otherwise skip every deploy).
 */
export function checkBuildInputs(text: string | undefined, tree: Map<string, string>, release: string, served?: string, named: string[] = []): CheckResult
{
	if (text === undefined) return {
		ok: false,
		reason: "no record",
	};
	const record = parseRecord(text);
	if (typeof record === "string") return {
		ok: false,
		reason: record,
	};
	if (Object.keys(record.files).length === 0) return {
		ok: false,
		reason: "the record lists no files",
	};
	if (record.release !== release) return {
		ok: false,
		reason: `BT_RELEASE differs: the record's is ${JSON.stringify(record.release)}, this build's ${JSON.stringify(release)}`,
	};
	if (served !== undefined && record.commit !== served) return {
		ok: false,
		reason: `the record names ${record.commit}, but ${served} is served`,
	};
	for (const path of Object.keys(record.files).sort())
	{
		const now = tree.get(path);
		if (now === undefined) return {
			ok: false,
			reason: `${path} was deleted`,
		};
		if (now !== record.files[path]) return {
			ok: false,
			reason: `${path} changed`,
		};
	}
	const added = named.find((path) => !(path in record.files));
	if (added !== undefined) return {
		ok: false,
		reason: `${added} is new`,
	};
	return {
		ok: true,
	};
}

/**
 * The record again, covering `commit` (a newer `stage` commit whose run found it unchanged), unless
 * what it covers already contains `commit`, so it never moves back. `contains(a, b)`: `b` is `a` or descends from it.
 */
export function coverRecord(record: BuildInputsRecord, commit: string, contains: (ancestor: string, descendant: string) => boolean): BuildInputsRecord
{
	if (record.covers && contains(commit, record.covers)) return record;
	if (record.covers && !contains(record.covers, commit)) return record;
	return {
		...record,
		covers: commit,
	};
}

/**
 * The commit staging stands for when it serves `served`: the record's `covers` when the record names
 * `served` and `covers` is a known commit containing it, else `served` itself (no record, one it can't
 * parse or of another format, one of another commit after a rollback or an older run landing last).
 */
export function standsFor(text: string | undefined, served: string, contains: (ancestor: string, descendant: string) => boolean): string
{
	const record = text === undefined ? "no record" : parseRecord(text);
	if (typeof record === "string" || record.commit !== served || !record.covers) return served;
	return contains(served, record.covers) ? record.covers : served;
}

/** An artifact as the Actions API lists it (`actions/artifacts`). */
export interface ArtifactInfo
{
	id: number;
	name: string;
	expired: boolean;
	created_at: string;
	workflow_run?: { id?: number } | null;
}

/** The fields of a workflow run (`actions/runs/<id>`) that decide whether its artifact is trusted. */
export interface RunInfo
{
	id: number;
	event: string;
	head_branch: string | null;
	head_sha: string;
	path: string;
	repository?: { full_name?: string };
	head_repository?: { full_name?: string } | null;
}

/** Which records `trust` may accept: an artifact name, this repository, and the environment's own runs. */
export interface TrustWant
{
	name: string;
	repo: string;
	env: "staging" | "preview";
	/** A preview's pull request head branch: only that pull request's runs. */
	headRef?: string;
}

/** The newest `limit` unexpired artifacts named `name`, newest first. */
function newestArtifacts(artifacts: ArtifactInfo[], name: string, limit = Infinity): ArtifactInfo[]
{
	return artifacts.filter((a) => a.name === name && !a.expired).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit);
}

/** The runs of the newest 20 unexpired artifacts named `name`, newest first, each once: the ones `trust` looks up. */
export function artifactRuns(artifacts: ArtifactInfo[], name: string): number[]
{
	return [...new Set(newestArtifacts(artifacts, name, 20).flatMap((a) => (a.workflow_run?.id ? [a.workflow_run.id] : [])))];
}

/**
 * The artifacts a deploy may believe, newest first, with the run each came from. Any pull request's
 * workflow can upload an artifact of any name, a fork's included, so a name proves nothing: the run
 * must be this repository's own `deploy.yml` with this repository as its head (a fork's pull request
 * run has the fork as head repository); for staging a push or manual run on `stage` (a fork can do
 * neither), for a preview a `pull_request` run of that pull request's own head branch. Staging also
 * needs the run's commit on `stage` ({@link main}'s `trust`), since a writer could dispatch on a tag named `stage`.
 */
export function trustedArtifacts(artifacts: ArtifactInfo[], runs: Map<number, RunInfo>, want: TrustWant): { artifact: ArtifactInfo;
	run: RunInfo; }[]
{
	return newestArtifacts(artifacts, want.name).flatMap((artifact) =>
	{
		const run = artifact.workflow_run?.id === undefined ? undefined : runs.get(artifact.workflow_run.id);
		if (!run || run.repository?.full_name !== want.repo || run.head_repository?.full_name !== want.repo || run.path !== ".github/workflows/deploy.yml") return [];
		const own = want.env === "staging"
			? (run.event === "push" || run.event === "workflow_dispatch") && run.head_branch === "stage"
			: run.event === "pull_request" && want.headRef !== undefined && run.head_branch === want.headRef;
		return own ? [{
			artifact,
			run,
		}] : [];
	});
}

/** `--name value` from argv, or undefined. */
function flag(args: string[], name: string): string | undefined
{
	const at = args.indexOf(name);
	return at >= 0 ? args[at + 1] : undefined;
}

const USAGE = `usage: build-inputs.ts record <out> --worker-meta <metafile> [--vite <modules.json>] [--commit <sha>] [--origin <url>]
       build-inputs.ts check <record> [--served <sha>]
       build-inputs.ts get <record> commit|release|origin|covers
       build-inputs.ts cover <record> <commit> <out>
       build-inputs.ts stands <record> --served <sha>
       build-inputs.ts runs <artifacts.json> --name <artifact>
       build-inputs.ts trust [--stage-ref <ref>] --env staging|preview [--head-ref <ref>] --name <artifact> --artifacts <artifacts.json> --runs-dir <dir> --repo <owner/name>
BT_RELEASE (the build's release label) is read from the environment by record and check.`;

/** The workspace list namedInputs reads, from the checkout ("" when it has none). */
function workspaceYaml(root: string): string
{
	return existsSync(resolve(root, "pnpm-workspace.yaml")) ? readFileSync(resolve(root, "pnpm-workspace.yaml"), "utf8") : "";
}

/** A record's text, or undefined when the file doesn't exist. */
function readRecord(file: string): string | undefined
{
	return existsSync(file) ? readFileSync(file, "utf8") : undefined;
}

/**
 * `trust`: the id of the newest record a deploy may believe ({@link trustedArtifacts}), or "" when none
 * may be (the deploy then runs, the safe side). Exit 2 on a usage error.
 */
function trustCommand(args: string[], root: string, print: (line: string) => void): number
{
	const env = flag(args, "--env");
	const name = flag(args, "--name");
	const artifacts = flag(args, "--artifacts");
	const runsDir = flag(args, "--runs-dir");
	const repo = flag(args, "--repo");
	const stageRef = flag(args, "--stage-ref");
	const headRef = flag(args, "--head-ref");
	if ((env !== "staging" && env !== "preview") || !name || !artifacts || !runsDir || !repo || (env === "staging" && !stageRef) || (env === "preview" && !headRef))
	{
		print(USAGE);
		return 2;
	}
	const list = (JSON.parse(readFileSync(artifacts, "utf8")) as { artifacts?: ArtifactInfo[] }).artifacts ?? [];
	const runs = new Map<number, RunInfo>();
	for (const entry of existsSync(runsDir) ? readdirSync(runsDir) : [])
	{
		const run = JSON.parse(readFileSync(join(runsDir, entry), "utf8")) as RunInfo;
		runs.set(run.id, run);
	}
	const found = trustedArtifacts(list, runs, {
		name,
		repo,
		env,
		headRef,
	}).find(({ run }) => env === "preview" || commitWithin(root, run.head_sha, stageRef!));
	print(found ? String(found.artifact.id) : "");
	return 0;
}

/** Where the Vite plugin leaves its module list unless BT_BUILD_INPUTS_VITE says otherwise (web/vite.config.ts). */
function defaultViteList(root: string, env: NodeJS.ProcessEnv): string
{
	return env.BT_BUILD_INPUTS_VITE || resolve(root, "node_modules/.cache/bt-build-inputs/vite.json");
}

/**
 * The command line: returns the exit code (0 ok or unchanged, 1 a difference or a failed record, 2
 * usage) and writes its one line of output through `print`. `root` is the repository's top level.
 */
export async function main(argv: string[], root: string, env: NodeJS.ProcessEnv, print: (line: string) => void): Promise<number>
{
	const [command, file, ...rest] = argv;
	if (command === "trust") return trustCommand(argv.slice(1), root, print);
	if (!file || !["record", "check", "get", "cover", "stands", "runs"].includes(command ?? ""))
	{
		print(USAGE);
		return 2;
	}
	const release = env.BT_RELEASE ?? "";
	const contains = (ancestor: string, descendant: string) => commitWithin(root, ancestor, descendant);
	if (command === "check")
	{
		const tree = gitTree(root);
		const result = checkBuildInputs(readRecord(file), tree, release, flag(rest, "--served"), namedInputs(tree, workspaceYaml(root)));
		print(result.ok ? "unchanged" : result.reason);
		return result.ok ? 0 : 1;
	}
	if (command === "stands")
	{
		const served = flag(rest, "--served");
		if (!served)
		{
			print(USAGE);
			return 2;
		}
		print(standsFor(readRecord(file), served, contains));
		return 0;
	}
	if (command === "runs")
	{
		const name = flag(rest, "--name");
		if (!name)
		{
			print(USAGE);
			return 2;
		}
		print(artifactRuns((JSON.parse(readFileSync(file, "utf8")) as { artifacts?: ArtifactInfo[] }).artifacts ?? [], name).join("\n"));
		return 0;
	}
	if (command === "cover")
	{
		const [commit, to] = rest;
		if (!commit || !to)
		{
			print(USAGE);
			return 2;
		}
		const text = readRecord(file);
		const record = text === undefined ? "no record" : parseRecord(text);
		if (typeof record === "string")
		{
			print(record);
			return 1;
		}
		const covered = coverRecord(record, commit, contains);
		mkdirSync(dirname(to), {
			recursive: true,
		});
		writeFileSync(to, `${JSON.stringify(covered, null, "\t")}\n`);
		print(`the record of ${covered.commit} covers ${covered.covers} in ${to}`);
		return 0;
	}
	if (command === "get")
	{
		const text = readRecord(file);
		const record = text === undefined ? "no record" : parseRecord(text);
		const key = rest[0] as "commit" | "release" | "origin" | "covers" | undefined;
		if (typeof record === "string" || !key || !["commit", "release", "origin", "covers"].includes(key))
		{
			print(typeof record === "string" ? record : USAGE);
			return typeof record === "string" ? 1 : 2;
		}
		print(record[key]);
		return 0;
	}
	const workerMeta = flag(rest, "--worker-meta");
	if (!workerMeta)
	{
		print(USAGE);
		return 2;
	}
	try
	{
		const tree = gitTree(root);
		const vite = JSON.parse(readFileSync(flag(rest, "--vite") ?? defaultViteList(root, env), "utf8")) as string[];
		const paths = [
			...vite.flatMap((id) => repoPath(root, root, id) ?? []),
			// wrangler bundles from the directory holding wrangler.jsonc, the repository root.
			...metafileInputs(root, root, JSON.parse(readFileSync(workerMeta, "utf8"))),
			...await graphInputs(root),
			...namedInputs(tree, workspaceYaml(root)),
		];
		const record = recordBuildInputs({
			tree,
			commit: flag(rest, "--commit") ?? git(root, ["rev-parse", "HEAD"]).trim(),
			release,
			origin: flag(rest, "--origin"),
			paths,
		});
		mkdirSync(dirname(file), {
			recursive: true,
		});
		writeFileSync(file, `${JSON.stringify(record, null, "\t")}\n`);
		print(`recorded ${Object.keys(record.files).length} inputs of ${record.commit} in ${file}`);
		return 0;
	}
	catch (error)
	{
		print(`record failed: ${(error as Error).message}`);
		return 1;
	}
}

/* v8 ignore start -- the command line itself; main() is what the tests drive */
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
{
	const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
		encoding: "utf8",
	}).trim();
	const code = await main(process.argv.slice(2), root, process.env, (line) => console.log(line));
	process.exit(code);
}
/* v8 ignore stop */

/** This file's own path, for tests that run it with plain node. */
export const BUILD_INPUTS_SCRIPT = fileURLToPath(import.meta.url);
