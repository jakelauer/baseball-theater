#!/usr/bin/env bash
# Grader for BACKLOG story S152 — pull-request checks reuse what an unchanged package already
# passed (Turborepo, cache read only on pull requests), keep the Playwright browser between runs,
# split the functions tests into shards when a change reaches them, scope the browser specs to
# the change, cache ESLint and tsc, reword law P11, and measure two real runs (owner, 2026-11-19).
# Contract: docs/v3/BACKLOG.md#verify-script-contract
# No network. No writes outside /tmp (the Turborepo dry runs work on a copy of the tree there).
# Does its own checking (never `pnpm verify`); runs only the law test files AC 3 names.

set -uo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "flows and design-specs restore ~/.cache/ms-playwright with actions/cache keyed on the lockfile's @playwright/test version and the runner image (RUNNER_OS, ImageOS; two images give two keys, no literal version, a failing node fails the key step), download the browser only on a cache miss, and install its system libraries (install-deps) every run"
check 2 "turbo.json: typecheck/build/test:coverage each depend on ^ of themselves, coverage/** in test:coverage outputs, web#build outputs dist/**, the global inputs AC 2 lists, every env var a task reads declared in its env; offline dry runs prove web/src, packages/domain/src and global-file edits change exactly the right hashes (tree untouched)"
check 3 "pnpm verify's script unchanged; root build and test:coverage call turbo, read no cache unless BT_TURBO_CACHE_READ is set (which ci.yml sets only in a pull_request step) and write one only in CI; test:coverage runs pnpm test:selector; verify job keeps one job-level if, the Markdown step, a 'pnpm verify' step and the ci-passed line; Turborepo cache restored on pull requests (own PR first, then stage) and saved by every run, whatever its event; law tests pass"
check 4 "functions' test:coverage skips on BT_FUNCTIONS_SHARDED; functions/vitest.config.ts turns floors off on BT_COVERAGE_SHARD; >=2 shard jobs after flows run vitest --shard and a merge job merges reports with the floors on and uploads them; the pull-request verify step exports BT_FUNCTIONS_SHARDED only when functions=true and the push step neither variable (run with a stub pnpm); vitest.workers.config.ts runs in exactly one job on a pull request for each decision, indirect runs included; step-level ifs on the functions decision; ci-passed, run over each outcome, requires shards and merge (skipped only for code=false) and fails on a missing code; the decision is reachesFunctions in e2e/select-specs.ts, and its step fails when the selector does"
check 5 "every spec under e2e/flows and e2e/design declares targets (web/functions only; web alone only when it routes all of **/api/**, with no fallback, method limit or comment); e2e/select-specs.ts selects per AC 5's cases and the pre-PR review's; its unit tests pass from a config of their own, which Playwright doesn't collect; ci.yml runs it on pull requests only, fails the step when it crashes, passes the list in place of a fixed path, step-level skips, every spec on push"
check 6 "ESLint runs with --cache --cache-strategy content and a fixed --cache-location (git-ignored) in CI only (GITHUB_ACTIONS); its CI cache keys hash the ESLint config, its rules and the lockfile, restored on pull requests only and saved on every run; every package's typecheck and build tsc pass --incremental with the same --tsBuildInfoFile; CI keeps both with actions/cache restored before pnpm verify"
check 7 "the note names two measured pull-request runs (URLs and job times)"
check 8 "the note carries a **P11 wording:** line quoting the owner; LAWS.md's P11 row names the pull-request reuse and the fresh full run on every push to stage or main"
check 9 "backlog Status is done (story heading and Story status table)"
check 10 "S152 changed no file outside its fence (plus creating scripts/verify-S152.sh and updating scripts/backlog-vault/ci-law.test.ts)"

# The commit S152's own changes are measured from. It started at 585b23e (HEAD when its
# grader was written); on 2026-11-20 bug/B87, carrying stage (#95-#98, #106, #107), was merged
# in (9299ae4), and story_diff compares two trees, so measuring from 585b23e counted the 64 files
# stage brought in as S152's. Measuring from that merge's B87 side gives exactly S152's own
# changes, which is what check 10 is for (rule 7: a pre-ship grader update, not a loosening;
# S156's story_own_diff fixes this for later graders).
BASE=9299ae4

TMP="$(mktemp -d /tmp/verify-S152.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

# --- Checks 1–6: one Node pass over ci.yml, turbo.json, the package scripts and the selector ---
# It prints "BAD <id> <reason>" lines; everything else it prints is ignored.
node --input-type=module - "$ROOT" "$TMP" >"$TMP/node.out" 2>"$TMP/node.err" <<'JS'
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync, appendFileSync, mkdirSync, symlinkSync } from "node:fs";
import { join, matchesGlob } from "node:path";
import { createRequire } from "node:module";

const [ROOT, TMP] = process.argv.slice(2);
const require = createRequire(join(ROOT, "package.json"));
const YAML = require("yaml");
const bad = (id, why) => console.log(`BAD ${id} ${why}`);
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const json = (p) => JSON.parse(read(p));

let ci = {};
try { ci = YAML.parse(read(".github/workflows/ci.yml")); } catch (e) { bad(1, `ci.yml does not parse: ${e.message}`); }
const jobs = ci.jobs ?? {};
const jobNames = Object.keys(jobs);
const steps = (job) => jobs[job]?.steps ?? [];
const runOf = (s) => String(s?.run ?? "");
const ifOf = (s) => String(s?.if ?? "");
const PR = /github\.event_name == 'pull_request'/;
const lock = read("pnpm-lock.yaml");
const lockDoc = YAML.parse(lock);
const pwVersion = String(lockDoc?.importers?.["."]?.devDependencies?.["@playwright/test"]?.version ?? "").replace(/\(.*$/, "");

// Every child process gets an environment built from scratch, never a copy of this one: CI exports
// GITHUB_ACTIONS, and a pull request's verify step BT_TURBO_CACHE_READ and BT_FUNCTIONS_SHARDED, so
// a copy would turn every "unset" case below into a "set" one.
const cleanEnv = (extra = {}) => ({ PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: process.env.HOME ?? TMP, ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}), ...extra });
// turbo.json may carry whole-line // comments (Turborepo reads it as JSONC); a naive /* */ strip
// would eat globs like fixtures/**, so only whole lines go.
const jsonc = (p) => JSON.parse(read(p).replace(/^\s*\/\/.*$/gm, ""));

// Runs one ci.yml step's script the way GitHub does when a step names no shell (`bash -e {0}`, no
// pipefail), with its ${{ }} expressions taken from ctx (any other one makes the run fail, so a
// renamed input is noticed) and its env resolved the same way. stubs: { command: bash body },
// put first on PATH. Returns the exit status, the GITHUB_OUTPUT lines and stdout/stderr.
let stepSeq = 0;
const runStep = (step, ctx = {}, { env = {}, stubs = {}, cwd = ROOT } = {}) =>
{
	const unresolved = [];
	const sub = (t) => String(t).replace(/\$\{\{\s*([\s\S]+?)\s*\}\}/g, (m, e) => (Object.hasOwn(ctx, e) ? String(ctx[e]) : (unresolved.push(e), m)));
	const script = sub(runOf(step));
	const stepEnv = Object.fromEntries(Object.entries(step?.env ?? {}).map(([k, v]) => [k, sub(v)]));
	if (unresolved.length) return { status: -1, output: {}, stdout: "", stderr: `unresolved expressions: ${unresolved.join(", ")}` };
	const n = ++stepSeq;
	const bin = join(TMP, `bin-${n}`);
	mkdirSync(bin);
	for (const [cmd, body] of Object.entries(stubs)) writeFileSync(join(bin, cmd), `#!/bin/bash\n${body}\n`, { mode: 0o755 });
	const out = join(TMP, `gh-output-${n}`);
	writeFileSync(out, "");
	const r = spawnSync("bash", ["-e", "-c", script], { cwd, env: cleanEnv({ ...stepEnv, ...env, GITHUB_OUTPUT: out, PATH: `${bin}:${process.env.PATH}` }), encoding: "utf8" });
	const output = Object.fromEntries(readFileSync(out, "utf8").split("\n").filter(Boolean).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
	return { status: r.status, output, stdout: r.stdout, stderr: r.stderr };
};
const PR_CTX = { "github.event_name": "pull_request", "github.event.pull_request.base.sha": "b".repeat(40), "github.sha": "c".repeat(40) };

// ---- Check 1: the Playwright browser is cached, never reinstalled ----
for (const job of ["flows", "design-specs"])
{
	const st = steps(job);
	const cache = st.find((s) => /^actions\/cache@/.test(s.uses ?? "") && String(s.with?.path ?? "").includes("~/.cache/ms-playwright"));
	if (!cache) { bad(1, `${job}: no actions/cache step for ~/.cache/ms-playwright`); continue; }
	if (!cache.id) bad(1, `${job}: the browser cache step has no id (the download can't test its hit)`);
	// Resolve the key under two runner images: ${{ steps.X.outputs.Y }} by running step X's script
	// here as GitHub would, ${{ runner.os }} as the image's OS. The keys must name each image and
	// the lockfile's version, and differ, so a new image downloads afresh.
	const keyFor = (os, image) =>
	{
		let key = String(cache.with?.key ?? "").replace(/\$\{\{\s*runner\.os\s*\}\}/g, os);
		for (const m of [...key.matchAll(/\$\{\{\s*steps\.([\w-]+)\.outputs\.([\w-]+)\s*\}\}/g)])
		{
			const src = st.find((s) => s.id === m[1]);
			if (!src) { bad(1, `${job}: the browser cache key reads step ${m[1]}, which doesn't exist`); continue; }
			const r = runStep(src, PR_CTX, { env: { RUNNER_OS: os, ImageOS: image } });
			if (r.status !== 0) bad(1, `${job}: step ${m[1]} fails when run here: ${r.stderr.trim().slice(0, 200)}`);
			key = key.replace(m[0], r.output[m[2]] ?? "");
			// The version must come from the installed package, and a failure to read it must fail
			// the step rather than write a key without it.
			if (runOf(src).includes(pwVersion) || String(cache.with?.key ?? "").includes(pwVersion)) bad(1, `${job}: the browser cache key names the Playwright version as a literal (${pwVersion}), not the installed package's`);
			const broken = runStep(src, PR_CTX, { env: { RUNNER_OS: os, ImageOS: image }, stubs: { node: "exit 1" } });
			if (broken.status === 0) bad(1, `${job}: step ${m[1]} still succeeds when node fails (it writes '${Object.values(broken.output).join(" ")}')`);
		}
		if (/\$\{\{/.test(key)) bad(1, `${job}: browser cache key has an expression the grader can't resolve: ${key}`);
		if (!pwVersion || !key.includes(pwVersion)) bad(1, `${job}: browser cache key '${key}' doesn't name the lockfile's @playwright/test ${pwVersion}`);
		if (!key.includes(image) || !key.includes(os)) bad(1, `${job}: browser cache key '${key}' doesn't name the runner image (${image}) and runner.os (${os})`);
		return key;
	};
	if (keyFor("Linux", "ubuntu24") === keyFor("macOS", "macos14")) bad(1, `${job}: the browser cache key is the same on two runner images`);
	if (st.some((s) => /playwright install --with-deps/.test(runOf(s)))) bad(1, `${job}: still runs playwright install --with-deps`);
	// Any browser download (`playwright install`, with or without a browser named) counts; only
	// install-deps, the system libraries, runs every time.
	const dl = st.filter((s) => /playwright install(?!-deps)\b/.test(runOf(s)));
	if (!dl.some((s) => /playwright install chromium/.test(runOf(s)))) bad(1, `${job}: no 'playwright install chromium' step`);
	for (const s of dl)
	{
		if (!new RegExp(`steps\\.${cache.id}\\.outputs\\.cache-hit != 'true'`).test(ifOf(s))) bad(1, `${job}: the browser download isn't conditional on a cache miss (if: ${ifOf(s)})`);
	}
	const deps = st.filter((s) => /playwright install-deps chromium/.test(runOf(s)));
	if (deps.length === 0) bad(1, `${job}: no 'playwright install-deps chromium' step`);
	if (deps.some((s) => /cache-hit/.test(ifOf(s)))) bad(1, `${job}: install-deps depends on the cache hit`);
	if (st.indexOf(cache) > st.indexOf(dl[0] ?? cache)) bad(1, `${job}: the cache is restored after the download`);
}

// ---- Check 2: turbo.json and the offline dry runs ----
let turbo = null;
try { turbo = jsonc("turbo.json"); } catch { bad(2, "no parseable turbo.json"); }
const tasks = turbo?.tasks ?? {};
const taskDef = (pkg, t) => tasks[`${pkg}#${t}`] ?? tasks[t];
const PKGS = ["@bt/domain", "@bt/ports", "@bt/mlb-api", "@bt/functions", "@bt/web"];
if (turbo)
{
	for (const t of ["typecheck", "build", "test:coverage"])
	{
		for (const p of PKGS)
		{
			const d = taskDef(p, t);
			if (!d) { bad(2, `turbo.json defines no ${t} task for ${p}`); continue; }
			if (!(d.dependsOn ?? []).includes(`^${t}`)) bad(2, `${p}#${t} doesn't depend on ^${t}`);
		}
	}
	for (const p of PKGS)
	{
		if (!(taskDef(p, "test:coverage")?.outputs ?? []).some((o) => /^coverage\/\*\*/.test(o))) bad(2, `${p}#test:coverage outputs don't include coverage/**`);
	}
	if (!(taskDef("@bt/web", "build")?.outputs ?? []).includes("dist/**")) bad(2, "web#build's outputs don't name dist/**");
	const globals = turbo.globalDependencies ?? [];
	for (const g of ["pnpm-lock.yaml", "tsconfig.base.json", "eslint.config.js", ".nvmrc", ".jscpd.json", ".size-limit.json", "wrangler.jsonc", "fixtures/**", "openapi/**", "tools/**", ".github/workflows/**", "scripts/preview-pr-open.sh"])
	{
		if (!globals.includes(g)) bad(2, `turbo.json's globalDependencies miss ${g}`);
	}
	// Every BT_* variable a task's script or functions/vitest.config.ts reads is in that task's env.
	for (const [pkgDir, pkg] of [["packages/domain", "@bt/domain"], ["packages/ports", "@bt/ports"], ["packages/mlb-api", "@bt/mlb-api"], ["functions", "@bt/functions"], ["web", "@bt/web"]])
	{
		const scripts = json(`${pkgDir}/package.json`).scripts ?? {};
		for (const t of ["typecheck", "build", "test:coverage"])
		{
			const names = new Set([...String(scripts[t] ?? "").matchAll(/\$\{?(BT_[A-Z0-9_]+)/g)].map((m) => m[1]));
			if (t === "test:coverage" && pkg === "@bt/functions")
			{
				for (const m of read("functions/vitest.config.ts").matchAll(/process\.env\.(BT_[A-Z0-9_]+)/g)) names.add(m[1]);
			}
			for (const n of names) if (!(taskDef(pkg, t)?.env ?? []).includes(n)) bad(2, `${pkg}#${t} reads ${n} but turbo.json doesn't declare it in that task's env`);
		}
	}
	// The dry runs, on a copy of the tree under /tmp (git-tracked plus new files), so this tree is never touched.
	const copy = join(TMP, "tree");
	mkdirSync(copy);
	const files = execFileSync("git", ["-c", "core.quotepath=false", "ls-files", "-co", "--exclude-standard", "-z"], { cwd: ROOT }).toString().split("\0").filter(Boolean).filter((f) => existsSync(join(ROOT, f)));
	writeFileSync(join(TMP, "files"), files.join("\0"));
	execFileSync("rsync", ["-a", "--from0", `--files-from=${join(TMP, "files")}`, `${ROOT}/`, `${copy}/`]);
	symlinkSync(join(ROOT, "node_modules"), join(copy, "node_modules"));
	const git = (...a) => execFileSync("git", ["-c", "user.email=g@x", "-c", "user.name=g", "-c", "commit.gpgsign=false", ...a], { cwd: copy, stdio: "pipe" });
	git("init", "-q"); git("add", "-A"); git("commit", "-qm", "base", "--no-verify");
	const turboBin = join(ROOT, "node_modules/.bin/turbo");
	const hashes = () =>
	{
		const r = spawnSync(turboBin, ["run", "test:coverage", "--dry=json", "--no-update-notifier"], { cwd: copy, env: cleanEnv({ TURBO_TELEMETRY_DISABLED: "1", DO_NOT_TRACK: "1" }), encoding: "utf8", maxBuffer: 64 << 20 });
		if (r.status !== 0) throw new Error(`turbo dry run failed: ${(r.stderr || r.stdout).slice(0, 300)}`);
		const out = JSON.parse(r.stdout.slice(r.stdout.indexOf("{")));
		return Object.fromEntries(out.tasks.map((t) => [t.package, t.hash]));
	};
	const expectChange = (label, edit, changed, same) =>
	{
		const before = hashes();
		appendFileSync(join(copy, edit), "\n");
		const after = hashes();
		git("checkout", "-q", "--", ".");
		for (const p of changed) if (before[p] === after[p]) bad(2, `editing ${edit} (${label}) left ${p}#test:coverage's hash unchanged`);
		for (const p of same) if (before[p] !== after[p]) bad(2, `editing ${edit} (${label}) changed ${p}#test:coverage's hash`);
	};
	if (!existsSync(turboBin)) bad(2, "turbo isn't installed from the lockfile (node_modules/.bin/turbo)");
	else
	{
		try
		{
			const webFile = readdirSync(join(copy, "web/src")).find((f) => f.endsWith(".ts") || f.endsWith(".tsx"));
			const domainFile = readdirSync(join(copy, "packages/domain/src")).find((f) => f.endsWith(".ts"));
			const fixture = readdirSync(join(copy, "fixtures")).find((f) => f.endsWith(".json"));
			expectChange("web/src", `web/src/${webFile}`, ["@bt/web"], ["@bt/functions", "@bt/domain"]);
			expectChange("packages/domain/src", `packages/domain/src/${domainFile}`, ["@bt/domain", "@bt/functions", "@bt/web"], []);
			for (const g of ["pnpm-lock.yaml", "tsconfig.base.json", `fixtures/${fixture}`]) expectChange("global input", g, PKGS, []);
			if (git("status", "--porcelain").toString().trim()) bad(2, "the dry-run copy wasn't left as it was");
		}
		catch (e) { bad(2, e.message); }
	}
}
if (!/^\s+turbo:/m.test(lock) || !json("package.json").devDependencies?.turbo) bad(2, "turbo is not a root devDependency in the lockfile");

// ---- Check 3: the gate keeps its shape; the cache is read only on pull requests ----
const root = json("package.json").scripts ?? {};
if (root.verify !== "pnpm build && pnpm dup:check && pnpm test:coverage && pnpm size") bad(3, `pnpm verify's script changed: ${root.verify}`);
if (!/^pnpm lint && /.test(root.build ?? "")) bad(3, "root build no longer starts with pnpm lint");
if (!/pnpm test:backlog && pnpm test:tools/.test(root["test:coverage"] ?? "")) bad(3, "root test:coverage no longer runs test:backlog and test:tools");
if (!/&& pnpm test:selector\b/.test(root["test:coverage"] ?? "")) bad(3, "root test:coverage doesn't run the spec selector's tests (pnpm test:selector)");
const VAR = "BT_TURBO_CACHE_READ";
for (const name of ["build", "test:coverage"])
{
	const m = /turbo run [^&|;]+/.exec(root[name] ?? "");
	if (!m) { bad(3, `root ${name} doesn't call turbo run`); continue; }
	// Expand the call as the shell would, under each combination of the read switch and
	// GitHub's own GITHUB_ACTIONS: it reads the cache exactly when BT_TURBO_CACHE_READ is set,
	// writes it whenever it runs in CI (a push saves stage's cache), and never touches a remote.
	for (const readOn of [false, true])
	{
		for (const gha of [false, true])
		{
			const args = execFileSync("sh", ["-c", `echo ${m[0]}`], { env: cleanEnv({ ...(readOn ? { [VAR]: "1" } : {}), ...(gha ? { GITHUB_ACTIONS: "true" } : {}) }) }).toString().trim();
			const spec = /--cache=(\S*)/.exec(args)?.[1];
			const force = /--force\b/.test(args);
			const local = spec === undefined ? "rw" : (/(?:^|,)local:(\w*)/.exec(spec)?.[1] ?? "");
			const reads = !force && local.includes("r");
			const writes = local.includes("w");
			const label = `${VAR} ${readOn ? "set" : "unset"}, GITHUB_ACTIONS ${gha ? "set" : "unset"}`;
			if (spec !== undefined && /remote:\w*r/.test(spec)) bad(3, `root ${name}'s turbo call reads a remote cache: ${args}`);
			if (reads !== readOn) bad(3, `root ${name}'s turbo call ${reads ? "reads" : "doesn't read"} the cache with ${label}: ${args}`);
			if (gha && !writes) bad(3, `root ${name}'s turbo call doesn't write the cache in CI (${label}): ${args}`);
			if (!gha && writes) bad(3, `root ${name}'s turbo call writes a cache outside CI that nothing reads (${label}): ${args}`);
		}
	}
}
const ciText = read(".github/workflows/ci.yml");
if (ci.env?.[VAR] !== undefined) bad(3, `ci.yml sets ${VAR} for the whole workflow`);
for (const [j, d] of Object.entries(jobs))
{
	if (d.env?.[VAR] !== undefined) bad(3, `job ${j} sets ${VAR} job-wide`);
	for (const s of d.steps ?? [])
	{
		const sets = s.env?.[VAR] !== undefined || runOf(s).includes(VAR);
		if (sets && !PR.test(ifOf(s))) bad(3, `${j}: step '${s.name}' sets ${VAR} without if: github.event_name == 'pull_request'`);
	}
}
if (!jobs.verify?.steps?.some((s) => PR.test(ifOf(s)) && (s.env?.[VAR] !== undefined || runOf(s).includes(VAR)) && /pnpm verify/.test(runOf(s)))) bad(3, `no pull-request step in verify runs pnpm verify with ${VAR}`);
const verifyText = ciText.slice(ciText.indexOf("\n    verify:\n"), ciText.indexOf("\n    flows:\n"));
if ([...verifyText.matchAll(/^ {8}if:/gm)].length !== 1) bad(3, "the verify job doesn't have exactly one job-level if:");
if (!/^\s*run: pnpm verify\s*$/m.test(verifyText)) bad(3, "the verify job has no 'run: pnpm verify' step");
if (!/- name: Markdown format\n\s+run: pnpm exec prettier --check "\*\*\/\*\.md"/.test(verifyText)) bad(3, "the verify job lost its Markdown format step");
if (!ciText.includes('test "$VERIFY $FLOWS $DESIGN $LIGHTHOUSE" = "success success success success"')) bad(3, "the ci-passed line changed");
{
	const vs = steps("verify");
	const restore = vs.find((s) => /^actions\/cache(\/restore)?@/.test(s.uses ?? "") && String(s.with?.path ?? "").includes(".turbo/cache"));
	const save = vs.find((s) => /^actions\/cache\/save@/.test(s.uses ?? "") && String(s.with?.path ?? "").includes(".turbo/cache"));
	const verifyIdx = vs.findIndex((s) => /pnpm verify/.test(runOf(s)));
	if (!restore || !/^actions\/cache\/restore@/.test(restore.uses)) bad(3, "verify doesn't restore .turbo/cache with actions/cache/restore");
	else
	{
		if (!PR.test(ifOf(restore))) bad(3, "the Turborepo cache is restored on runs other than pull requests");
		if (vs.indexOf(restore) > verifyIdx) bad(3, "the Turborepo cache is restored after pnpm verify");
		const rk = String(restore.with?.["restore-keys"] ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
		if (!/pull_request\.number/.test(rk[0] ?? "") || !/stage/.test(rk[1] ?? "")) bad(3, `restore keys don't reach the pull request's own cache first, then stage's: ${rk.join(" | ")}`);
	}
	if (!save) bad(3, "verify doesn't save .turbo/cache with actions/cache/save");
	else
	{
		if (!/github\.run_id/.test(String(save.with?.key ?? ""))) bad(3, "the Turborepo cache key isn't unique to the run (github.run_id)");
		// Pull requests save their own cache (AC 7's second run reuses it) and pushes save stage's.
		if (/event_name/.test(ifOf(save))) bad(3, `the Turborepo cache is saved only for some events (if: ${ifOf(save)})`);
		if (vs.indexOf(save) < verifyIdx) bad(3, "the Turborepo cache is saved before pnpm verify");
	}
}
{
	const r = spawnSync(join(ROOT, "node_modules/.bin/vitest"), ["run", "--config", "scripts/backlog-vault/vitest.config.ts", "scripts/backlog-vault/ci-law.test.ts", "scripts/backlog-vault/laws.test.ts", "scripts/backlog-vault/verify-chain.test.ts"], { cwd: ROOT, env: cleanEnv(), encoding: "utf8" });
	if (r.status !== 0) bad(3, `the law tests fail: ${(r.stdout + r.stderr).split("\n").filter((l) => /FAIL|✗|×/.test(l)).slice(0, 5).join(" / ")}`);
}

// ---- Check 4: functions tests sharded only when the change reaches them ----
const fnScripts = json("functions/package.json").scripts ?? {};
const fnCov = String(fnScripts["test:coverage"] ?? "");
if (!/BT_FUNCTIONS_SHARDED/.test(fnCov) || !/vitest run --config vitest\.workers\.config\.ts/.test(fnCov)) bad(4, "functions' test:coverage doesn't skip both halves on BT_FUNCTIONS_SHARDED");
else
{
	const run = (env) => spawnSync("sh", ["-c", fnCov.replace(/vitest /g, "echo RAN-vitest ")], { cwd: join(ROOT, "functions"), env: cleanEnv(env), encoding: "utf8" }).stdout;
	if (/RAN-vitest/.test(run({ BT_FUNCTIONS_SHARDED: "1" }))) bad(4, "functions' test:coverage still runs vitest with BT_FUNCTIONS_SHARDED=1");
	if ((run({}).match(/RAN-vitest/g) ?? []).length !== 2) bad(4, "functions' test:coverage doesn't run both halves with BT_FUNCTIONS_SHARDED unset");
}
const fnCfg = read("functions/vitest.config.ts");
if (!/process\.env\.BT_COVERAGE_SHARD/.test(fnCfg)) bad(4, "functions/vitest.config.ts doesn't read BT_COVERAGE_SHARD");
for (const [k, v] of [["lines", 97], ["functions", 96], ["branches", 92], ["statements", 97]]) if (!new RegExp(`${k}: ${v}\\b`).test(fnCfg)) bad(4, `functions' ${k} floor isn't ${v} any more`);
const shardJobs = jobNames.filter((j) => steps(j).some((s) => /vitest run[^\n]*--shard=/.test(runOf(s))));
const shardCount = shardJobs.reduce((n, j) => n + (Array.isArray(jobs[j].strategy?.matrix?.shard) ? jobs[j].strategy.matrix.shard.length : 1), 0);
if (shardCount < 2) bad(4, `fewer than two shard jobs (${shardCount})`);
for (const j of shardJobs)
{
	if (jobNames.indexOf(j) < jobNames.indexOf("flows")) bad(4, `shard job ${j} sits before flows`);
	const sh = steps(j).find((s) => /--shard=/.test(runOf(s)));
	if (!/BT_COVERAGE_SHARD/.test(JSON.stringify(sh?.env ?? {}) + runOf(sh))) bad(4, `${j}: the shard run doesn't turn the floors off (BT_COVERAGE_SHARD)`);
}
const mergeJobs = jobNames.filter((j) => steps(j).some((s) => /--merge-reports/.test(runOf(s))));
if (mergeJobs.length !== 1) bad(4, `expected one merge job, found ${mergeJobs.length}`);
for (const j of mergeJobs)
{
	const ms = steps(j).find((s) => /--merge-reports/.test(runOf(s)));
	if (/BT_COVERAGE_SHARD/.test(JSON.stringify(ms.env ?? {}) + runOf(ms))) bad(4, "the merge run turns the floors off");
	if (!/--coverage/.test(runOf(ms))) bad(4, "the merge run doesn't merge coverage");
	if (!(jobs[j].needs ?? []).some((n) => shardJobs.includes(n))) bad(4, "the merge job doesn't need the shard jobs");
}
// The verify job's two pnpm verify steps, run with a stub pnpm that records what each exports: on
// a pull request BT_FUNCTIONS_SHARDED only when the change reaches functions (and the cache switch
// always); on a push neither.
const REC = join(TMP, "pnpm-record");
const recordPnpm = { pnpm: `printf '%s %s %s\\n' "\${BT_FUNCTIONS_SHARDED-unset}" "\${BT_TURBO_CACHE_READ-unset}" "$*" >> "$REC"` };
const verifyRecord = (step, ctx) =>
{
	writeFileSync(REC, "");
	const r = runStep(step, ctx, { env: { REC }, stubs: recordPnpm });
	return r.status === 0 ? readFileSync(REC, "utf8").trim() : `failed (${r.stderr.trim().slice(0, 160)})`;
};
const verifySteps = steps("verify").filter((s) => /pnpm verify/.test(runOf(s)));
const prVerify = verifySteps.filter((s) => PR.test(ifOf(s)));
const pushVerify = verifySteps.filter((s) => /github\.event_name != 'pull_request'/.test(ifOf(s)));
if (prVerify.length !== 1 || pushVerify.length !== 1) bad(4, `expected one pull-request and one push pnpm verify step in verify, found ${prVerify.length} and ${pushVerify.length}`);
for (const [fn, want] of [["true", "1 1 verify"], ["false", "unset 1 verify"]])
{
	for (const st of prVerify)
	{
		const got = verifyRecord(st, { ...PR_CTX, "needs.changes.outputs.functions": fn });
		if (got !== want) bad(4, `the pull-request verify step with functions=${fn} runs pnpm as '${got}', want '${want}' (BT_FUNCTIONS_SHARDED, BT_TURBO_CACHE_READ, args)`);
	}
}
for (const st of pushVerify)
{
	const got = verifyRecord(st, { "github.event_name": "push", "github.sha": "c".repeat(40), "needs.changes.outputs.functions": "false" });
	if (got !== "unset unset verify") bad(4, `the push verify step runs pnpm as '${got}', want 'unset unset verify'`);
}

// Which jobs run functions' workerd tests on a pull request, for each functions decision: a step
// that can run on a pull request runs them when its command names vitest.workers.config.ts or calls
// a package script that does (root scripts, `pnpm --filter @bt/functions …`, a functions
// working-directory, `turbo run <task>` into functions' task); functions' test:coverage counts
// only when the step leaves BT_FUNCTIONS_SHARDED unset (for the verify steps, as recorded above).
const pkgScripts = { root, functions: fnScripts };
const runsWorkers = (cmd, pkg, sharded, seen = new Set()) =>
{
	if (/vitest\.workers\.config\.ts/.test(cmd)) return true;
	for (const m of cmd.matchAll(/\bturbo run ([\w:\s-]+?)(?=\s--|\s*$|\s*&&|\s*;)/g))
	{
		for (const task of m[1].trim().split(/\s+/)) if (scriptRuns("functions", task, sharded, seen)) return true;
	}
	for (const m of cmd.matchAll(/\bpnpm\s+(?:(?:--filter|-F)[\s=]+(\S+)\s+)?(?:run\s+)?([\w:-]+)/g))
	{
		const target = m[1] ? (m[1] === "@bt/functions" ? "functions" : null) : pkg;
		if (target && scriptRuns(target, m[2], sharded, seen)) return true;
	}
	return false;
};
const scriptRuns = (pkg, name, sharded, seen) =>
{
	const key = `${pkg}#${name}`;
	const body = pkgScripts[pkg]?.[name];
	if (body === undefined || seen.has(key)) return false;
	seen.add(key);
	if (pkg === "functions" && name === "test:coverage" && sharded) return false;
	return runsWorkers(body, pkg, sharded, seen);
};
// Statically too: a job naming vitest.workers.config.ts at all (a push-only step included) must
// be a shard job, so the workerd tests never run a second time anywhere.
{
	const naming = jobNames.filter((j) => JSON.stringify(jobs[j]).includes("vitest.workers.config.ts"));
	if (naming.length !== 1 || !shardJobs.includes(naming[0])) bad(4, `vitest.workers.config.ts is named by ${naming.length} jobs (${naming.join(", ")}), not exactly one shard job`);
}
for (const fn of ["true", "false"])
{
	const running = jobNames.filter((j) => steps(j).some((st) =>
	{
		const cond = ifOf(st);
		if (/github\.event_name != 'pull_request'/.test(cond)) return false;
		if (/needs\.changes\.outputs\.functions == 'true'/.test(cond) && fn !== "true") return false;
		if (/needs\.changes\.outputs\.functions != 'true'/.test(cond) && fn === "true") return false;
		const pkg = st["working-directory"] === "functions" ? "functions" : "root";
		let sharded = /BT_FUNCTIONS_SHARDED/.test(JSON.stringify(st.env ?? {})) || /\bBT_FUNCTIONS_SHARDED=1/.test(runOf(st));
		if (prVerify.includes(st)) sharded = verifyRecord(st, { ...PR_CTX, "needs.changes.outputs.functions": fn }).startsWith("1 ");
		return runsWorkers(runOf(st), pkg, sharded);
	}));
	const okJob = fn === "true" ? shardJobs.includes(running[0]) : running[0] === "verify";
	if (running.length !== 1 || !okJob) bad(4, `with functions=${fn}, vitest.workers.config.ts runs in ${running.length} jobs on a pull request (${running.join(", ")}), not exactly one (${fn === "true" ? "a shard job" : "verify"})`);
}
for (const j of [...shardJobs, ...mergeJobs])
{
	if (jobs[j].if && !/needs\.changes\.outputs\.code == 'true'/.test(jobs[j].if)) bad(4, `${j}'s job-level if is more than the docs-only skip`);
	for (const s of steps(j)) if (!/needs\.changes\.outputs\.functions == 'true'/.test(ifOf(s))) bad(4, `${j}: step '${s.name ?? s.uses}' lacks the step-level functions if`);
}
if (!/node e2e\/select-specs\.ts functions/.test(JSON.stringify(jobs.changes ?? {}))) bad(4, "the changes job doesn't decide with e2e/select-specs.ts functions");
if (!jobs.changes?.outputs?.functions) bad(4, "the changes job has no functions output");
{
	const cp = jobs["ci-passed"] ?? {};
	for (const j of [...shardJobs, ...mergeJobs]) if (!(cp.needs ?? []).includes(j)) bad(4, `ci-passed doesn't need ${j}`);
	// The gate's script, run as GitHub runs it (bash -e) over each outcome: a skipped job passes
	// only when the change didn't need it, and a missing or odd `code` fails.
	const cpStep = steps("ci-passed").find((st) => /test "\$CHANGES" = success/.test(runOf(st)));
	if (!cpStep) bad(4, "ci-passed has no step checking the jobs' results");
	else
	{
		const S = "success", K = "skipped", F = "failure";
		const codeRun = { code: "true", changes: S, docs: K, verify: S, flows: S, "design-specs": S, lighthouse: S, "functions-shard": S, "functions-coverage": S, milestone: S, stage: "true" };
		const docsRun = { ...codeRun, code: "false", docs: S, verify: K, flows: K, "design-specs": K, lighthouse: K, "functions-shard": K, "functions-coverage": K };
		const cases = [
			["code, every job passed", codeRun, 0],
			["code, shards skipped", { ...codeRun, "functions-shard": K }, 1],
			["code, merge failed", { ...codeRun, "functions-coverage": F }, 1],
			["code, merge skipped", { ...codeRun, "functions-coverage": K }, 1],
			["code, lighthouse failed", { ...codeRun, lighthouse: F }, 1],
			["docs-only, docs passed", docsRun, 0],
			["docs-only, docs failed", { ...docsRun, docs: F }, 1],
			["docs-only, shards ran", { ...docsRun, "functions-shard": S, "functions-coverage": S }, 1],
			["no code output, everything skipped", { ...docsRun, code: "", docs: K }, 1],
			["no code output, docs passed", { ...docsRun, code: "" }, 1],
			["code=maybe", { ...codeRun, code: "maybe" }, 1],
			["changes failed", { ...codeRun, changes: F }, 1],
			["into stage, milestone skipped", { ...codeRun, milestone: K }, 1],
			["not into stage, milestone skipped", { ...codeRun, milestone: K, stage: "false" }, 0],
		];
		for (const [label, o, want] of cases)
		{
			const ctx = { "needs.changes.outputs.code": o.code, "github.event_name == 'pull_request' && github.event.pull_request.base.ref == 'stage'": o.stage };
			for (const j of ["changes", "docs", "verify", "flows", "design-specs", "lighthouse", "functions-shard", "functions-coverage", "milestone"]) ctx[`needs.${j}.result`] = o[j];
			const r = runStep(cpStep, ctx);
			if (r.status === -1) { bad(4, `ci-passed: ${r.stderr}`); break; }
			if ((r.status === 0 ? 0 : 1) !== want) bad(4, `ci-passed ${want ? "passes" : "fails"} for ${label}`);
		}
	}
}
// The merged functions coverage is uploaded like verify's (the shards leave verify without it).
if (!mergeJobs.some((j) => steps(j).some((st) => /^actions\/upload-artifact@/.test(st.uses ?? "") && String(st.with?.path ?? "").includes("functions/coverage/coverage-summary.json")))) bad(4, "the merge job doesn't upload functions/coverage/coverage-summary.json");
// The decision step fails, rather than deciding, when the selector crashes or prints something else.
{
	const fnStep = steps("changes").find((st) => /node e2e\/select-specs\.ts functions/.test(runOf(st)));
	if (fnStep)
	{
		if (runStep(fnStep, PR_CTX, { stubs: { node: "exit 1" } }).status === 0) bad(4, "the functions decision step succeeds when the selector fails");
		if (runStep(fnStep, PR_CTX, { stubs: { node: "echo maybe" } }).status === 0) bad(4, "the functions decision step accepts an answer other than true or false");
		const ok = runStep(fnStep, PR_CTX, { stubs: { node: "echo true" } });
		if (ok.status !== 0 || ok.output.functions !== "true") bad(4, `the functions decision step doesn't write functions=true for the selector's 'true' (${ok.stderr.trim().slice(0, 120)})`);
	}
}

// ---- Check 5: specs declare targets; the selector ----
let sel = null;
try { sel = await import(join(ROOT, "e2e/select-specs.ts")); } catch (e) { bad(5, `e2e/select-specs.ts doesn't load: ${e.message.split("\n")[0]}`); bad(4, "no selector, so no functions decision"); }
// Whether a spec's source routes every API request itself: comments dropped first, then either a
// page.route("**/api/**", …) whose handler never falls back, continues or checks the method, or a
// four-argument stubApi(page, "/api/**", status, body) (a fifth argument limits it to one method,
// and stubApi falls back for the rest).
const callArgs = (src, open) =>
{
	// The text between the "(" at open and its matching ")", split at top-level commas.
	let depth = 0, quote = "", cur = "";
	const args = [];
	for (let i = open; i < src.length; i++)
	{
		const c = src[i];
		if (quote) { cur += c; if (c === quote && src[i - 1] !== "\\") quote = ""; continue; }
		if (c === "\"" || c === "'" || c === "`") { quote = c; cur += c; continue; }
		if ("([{".includes(c)) { depth++; if (depth === 1) continue; }
		if (")]}".includes(c)) { depth--; if (depth === 0) { args.push(cur); return args.map((a) => a.trim()); } }
		if (c === "," && depth === 1) { args.push(cur); cur = ""; continue; }
		cur += c;
	}
	return null;
};
const routesAllApi = (source) =>
{
	const src = source.replace(/^\s*\/\*[\s\S]*?\*\//gm, "").replace(/^\s*\/\/.*$/gm, "").replace(/([;{}(),])\s*\/\/.*$/gm, "$1");
	for (const m of src.matchAll(/page\.route\(\s*["']\*\*\/api\/\*\*["']\s*,/g))
	{
		const args = callArgs(src, m.index + m[0].indexOf("("));
		if (args && args.length === 2 && !/fallback\(|continue\(|method\(\)/.test(args[1])) return true;
	}
	for (const m of src.matchAll(/stubApi\(\s*page\s*,\s*["']\/api\/\*\*["']\s*,/g))
	{
		const args = callArgs(src, m.index + m[0].indexOf("("));
		if (args && args.length === 4) return true;
	}
	return false;
};
for (const [label, src, want] of [
	["a commented-out catch-all", `// await page.route("**/api/**", (r) => r.fulfill({ status: 404 }));`, false],
	["a catch-all in a trailing comment", `await page.goto("/"); // page.route("**/api/**", (r) => r.fulfill({}))`, false],
	["a catch-all in a block comment", `/* await page.route("**/api/**", (r) => r.fulfill({})); */`, false],
	["a catch-all that falls back", `await page.route("**/api/**", (r) => r.fallback());`, false],
	["a catch-all that continues", `await page.route("**/api/**", (r) => r.continue());`, false],
	["a catch-all for one method", `await page.route("**/api/**", (r) => { if (r.request().method() !== "GET") return r.abort(); return r.fulfill({ status: 200, body: "{}" }); });`, false],
	["a stubApi for one method", `await stubApi(page, "/api/**", 200, { a: 1, b: 2 }, "GET");`, false],
	["a full catch-all", `await page.route("**/api/**", (route) => route.fulfill({ status: 404, body: JSON.stringify({ error: "x" }) }));`, true],
	["a full stubApi", `await stubApi(page, "/api/**", 404, { error: "x", n: [1, 2] });`, true],
])
{
	if (routesAllApi(src) !== want) bad(5, `the routing check misjudges ${label} (says ${!want})`);
}
const specFiles = ["flows", "design"].flatMap((d) => readdirSync(join(ROOT, "e2e", d)).filter((f) => f.endsWith(".spec.ts")).map((f) => `${d}/${f}`));
for (const f of specFiles)
{
	const src = read(`e2e/${f}`);
	const m = /^\/\/ @bt-targets:\s*(.+)$/m.exec(src);
	if (!m) { bad(5, `${f} declares no targets`); continue; }
	const t = m[1].split(",").map((x) => x.trim());
	if (!t.every((x) => x === "web" || x === "functions")) bad(5, `${f} names a target other than web or functions: ${m[1]}`);
	if (t.length === 1 && t[0] === "web" && !routesAllApi(src)) bad(5, `${f} names web alone but doesn't route all of **/api/**`);
}
if (sel)
{
	const graph = sel.readGraph(ROOT);
	const SYN = [
		{ file: "syn/web.spec.ts", targets: ["web"] },
		{ file: "syn/functions.spec.ts", targets: ["functions"] },
		{ file: "syn/both.spec.ts", targets: ["web", "functions"] },
		{ file: "syn/none.spec.ts", targets: null },
		{ file: "syn/unknown.spec.ts", targets: ["domain"] },
		{ file: "syn/proto.spec.ts", targets: ["toString"] },
	];
	const UNDECLARED = ["syn/none.spec.ts", "syn/unknown.spec.ts", "syn/proto.spec.ts"];
	const all = SYN.map((s) => s.file);
	const pick = (changed) => sel.selectSpecs(changed, SYN, graph).slice().sort().join(",");
	const want = (label, changed, expected) =>
	{
		const got = pick(changed);
		if (got !== expected.slice().sort().join(",")) bad(5, `given ${label}, selected [${got}], want [${expected.join(",")}]`);
	};
	want("packages/ports/", ["packages/ports/src/index.ts"], ["syn/functions.spec.ts", "syn/both.spec.ts", ...UNDECLARED]);
	want("web/src/", ["web/src/main.tsx"], ["syn/web.spec.ts", "syn/both.spec.ts", ...UNDECLARED]);
	for (const p of ["pnpm-lock.yaml", "scripts/backlog-vault/design-reference.ts", "compose.yaml", "e2e/flows/main.spec.ts", "docs/v3/visual/game-shell/RATIFIED.md", "docs/v3/design-checks/S2.json", "tools/eslint-rules/no-mlb-in-web.js"]) want(p, [p], all);
	want("only CHANGELOG.md", ["CHANGELOG.md"], []);
	want("only .claude/agents/x.md", [".claude/agents/x.md"], []);
	for (const blank of ["// @bt-targets:  \n", "// @bt-targets: , \n"]) if (sel.specTargets(blank) !== null) bad(5, `specTargets(${JSON.stringify(blank)}) isn't null (a blank declaration must count as none)`);
	const docs = ["docs/v3/AUDIT.md", "docs/v3/audit.jsonl", "docs/v3/INDEX.md", "docs/v3/BACKLOG.md"];
	want("only the generated docs", docs, []);
	want("the generated docs plus web/src/", [...docs, "web/src/main.tsx"], ["syn/web.spec.ts", "syn/both.spec.ts", ...UNDECLARED]);
	// The real specs, as declared: every one naming web is picked for a web/src change.
	const real = specFiles.map((f) => ({ file: f, targets: sel.specTargets(read(`e2e/${f}`)) }));
	const webOnes = real.filter((s) => s.targets?.includes("web")).map((s) => s.file).sort().join(",");
	if (sel.selectSpecs(["web/src/main.tsx"], real, graph).slice().sort().join(",") !== webOnes) bad(5, "given web/src/, the real specs selected aren't exactly those naming web");
	// AC 4's decision, the same function's graph walk.
	for (const [p, yes] of [["web/src/main.tsx", false], ["packages/domain/src/index.ts", true], ["functions/src/index.ts", true], ["fixtures/x.json", true], ["scripts/preview-pr-open.sh", true], ["tools/eslint-rules/no-mlb-in-web.js", true], [".claude/agents/x.md", false]])
	{
		if (sel.reachesFunctions([p], graph) !== yes) bad(4, `reachesFunctions([${p}]) should be ${yes}`);
	}
	if (/(docs\/v3|\.claude)/.test(read("e2e/select-specs.ts").split("export function reachesFunctions")[1] ?? "")) bad(4, "reachesFunctions keeps its own copy of the path lists");
}
for (const [job, fixed] of [["flows", /\bflows\/(\s|$)/], ["design-specs", /\bdesign\/(\s|$)/]])
{
	const st = steps(job);
	if (jobs[job]?.if && !/^needs\.changes\.outputs\.code == 'true'$/.test(jobs[job].if)) bad(5, `${job} has a job-level if beyond the docs-only skip`);
	const selStep = st.find((s) => /node e2e\/select-specs\.ts specs/.test(runOf(s)));
	if (!selStep) { bad(5, `${job} doesn't run the selector`); continue; }
	if (!PR.test(ifOf(selStep)) || /!=/.test(ifOf(selStep))) bad(5, `${job} runs the selector on more than pull requests`);
	// A selector that crashes fails the step (not an empty list that runs no specs), and its
	// list reaches the step's output as it printed it.
	if (runStep(selStep, PR_CTX, { stubs: { node: "exit 1" } }).status === 0) bad(5, `${job}'s selector step succeeds when the selector fails`);
	{
		const ok = runStep(selStep, PR_CTX, { stubs: { node: "echo flows/a.spec.ts design/harness.spec.ts" } });
		if (ok.status !== 0 || ok.output[Object.keys(ok.output)[0]] !== "flows/a.spec.ts design/harness.spec.ts") bad(5, `${job}'s selector step doesn't pass the printed list through (${JSON.stringify(ok.output)} ${ok.stderr.trim().slice(0, 120)})`);
	}
	if (!/github\.event\.pull_request\.base\.sha/.test(JSON.stringify(selStep))) bad(5, `${job}'s selector doesn't diff against the pull request's base sha`);
	if (jobs[job]?.steps?.[0]?.with?.["fetch-depth"] !== 0) bad(5, `${job} doesn't fetch the history the base diff needs`);
	const prRun = st.find((s) => /playwright test/.test(runOf(s)) && new RegExp(`steps\\.${selStep.id}\\.outputs`).test(runOf(s)));
	if (!prRun) bad(5, `${job} doesn't pass the selected specs to playwright test`);
	else
	{
		if (fixed.test(runOf(prRun))) bad(5, `${job} passes the selected specs beside a fixed path`);
		if (!PR.test(ifOf(prRun)) || !new RegExp(`steps\\.${selStep.id}\\.outputs\\.\\w+ != ''`).test(ifOf(prRun))) bad(5, `${job}'s pull-request run doesn't skip with a step-level if when nothing is selected`);
		if (job === "flows" && !/--workers=4/.test(runOf(prRun) + JSON.stringify(st))) bad(5, "flows lost --workers=4");
		if (job === "flows" && !/--repeat-each=2/.test(runOf(prRun))) bad(5, "flows lost --repeat-each=2 on pull requests");
	}
	const pushRun = st.find((s) => /pnpm e2e/.test(runOf(s)) && /github\.event_name != 'pull_request'/.test(ifOf(s)));
	if (!pushRun) bad(5, `${job} doesn't run every spec on a push`);
}
if (sel)
{
	const flowsList = sel.specsFor?.("flows", ROOT) ?? [];
	if (!flowsList.includes("design/harness.spec.ts")) bad(5, "the flows job's spec pool lost design/harness.spec.ts");
	if (!(sel.specsFor?.("design", ROOT) ?? []).includes("design/harness.spec.ts")) bad(5, "the design job's spec pool lost design/harness.spec.ts");
}
// The selector's unit tests run in pnpm verify, from a config that collects no browser spec (law
// P8), and Playwright in turn collects only the specs, not the unit tests beside them.
{
	const include = /include:\s*\[([^\]]*)\]/.exec(existsSync(join(ROOT, "e2e/vitest.config.ts")) ? read("e2e/vitest.config.ts") : "")?.[1]?.split(",").map((x) => x.trim()).filter(Boolean) ?? [];
	if (include.join(",") !== '"select-specs.test.ts"') bad(5, `e2e/vitest.config.ts must include exactly "select-specs.test.ts" (it includes ${include.join(", ") || "nothing"})`);
	if (!/^\s*testMatch:\s*["']\*\*\/\*\.spec\.ts["'],?\s*$/m.test(read("e2e/playwright.config.ts"))) bad(5, "e2e/playwright.config.ts doesn't limit Playwright to **/*.spec.ts (it would collect select-specs.test.ts)");
	const r = spawnSync("pnpm", ["test:selector"], { cwd: ROOT, env: cleanEnv(), encoding: "utf8" });
	if (r.status !== 0) bad(5, `pnpm test:selector fails: ${(r.stdout + r.stderr).split("\n").filter((l) => /FAIL|×|Error/.test(l)).slice(0, 4).join(" / ")}`);
}

// ---- Check 6: ESLint and tsc caches ----
// ESLint reads and writes its cache only in CI (GITHUB_ACTIONS), where a pull request restores it
// and a push starts with none, so a local pnpm verify or scripts/audit.sh lints every file fresh.
const lintRaw = root.lint ?? "";
const lintWith = (vars) => (/eslint \.[^&|;]*/.exec(lintRaw) ? execFileSync("sh", ["-c", `echo ${/eslint \.[^&|;]*/.exec(lintRaw)[0]}`], { env: cleanEnv(vars) }).toString().trim() : "");
const lint = lintWith({ GITHUB_ACTIONS: "true" });
if (!lint) bad(6, `root lint doesn't run eslint .: ${lintRaw}`);
if (!/--cache\b/.test(lint) || !/--cache-strategy content/.test(lint) || !/--cache-location \S+/.test(lint)) bad(6, `root lint in CI doesn't run ESLint with --cache --cache-strategy content --cache-location: ${lint}`);
for (const vars of [{}, { BT_TURBO_CACHE_READ: "1" }]) if (/--cache\b/.test(lintWith(vars))) bad(6, `root lint uses ESLint's cache outside CI (${JSON.stringify(vars)}): ${lintWith(vars)}`);
const eslintLoc = /--cache-location (\S+)/.exec(lint)?.[1] ?? "";
const ignore = read(".gitignore").split("\n").map((l) => l.trim());
if (eslintLoc && !ignore.includes(eslintLoc) && !ignore.includes(`/${eslintLoc}`)) bad(6, `${eslintLoc} isn't in .gitignore`);
if (!ignore.includes("*.tsbuildinfo")) bad(6, "*.tsbuildinfo is no longer git-ignored");
const infoFiles = [];
for (const dir of ["packages/domain", "packages/ports", "packages/mlb-api", "functions", "web"])
{
	const s = json(`${dir}/package.json`).scripts ?? {};
	const infos = new Set();
	for (const t of ["typecheck", "build"])
	{
		const calls = [...String(s[t] ?? "").matchAll(/tsc [^&|;]*/g)].map((m) => m[0]);
		if (calls.length === 0) bad(6, `${dir}'s ${t} runs no tsc`);
		for (const c of calls)
		{
			if (!/--incremental\b/.test(c)) bad(6, `${dir}'s ${t}: '${c.trim()}' lacks --incremental`);
			const info = /--tsBuildInfoFile (\S+)/.exec(c)?.[1];
			if (!info) bad(6, `${dir}'s ${t}: '${c.trim()}' lacks --tsBuildInfoFile`);
			else if (!info.endsWith(".tsbuildinfo")) bad(6, `${dir}'s ${t}: ${info} isn't git-ignored (*.tsbuildinfo)`);
			else infos.add(info);
		}
	}
	if (infos.size > 1) bad(6, `${dir}'s typecheck and build use different --tsBuildInfoFile (${[...infos].join(", ")})`);
	for (const i of infos) infoFiles.push(`${dir}/${i}`);
}
{
	const vs = steps("verify");
	const verifyIdx = vs.findIndex((s) => /pnpm verify/.test(runOf(s)));
	const c = vs.filter((s) => /^actions\/cache(\/restore)?@/.test(s.uses ?? "") && /eslintcache|tsbuildinfo/.test(String(s.with?.path ?? "")));
	const paths = c.map((s) => String(s.with?.path ?? "")).join("\n");
	if (c.length === 0) bad(6, "verify doesn't restore the ESLint and tsc caches with actions/cache");
	if (c.some((s) => vs.indexOf(s) > verifyIdx)) bad(6, "the ESLint/tsc caches are restored after pnpm verify");
	if (eslintLoc && !paths.includes(eslintLoc)) bad(6, `the CI cache doesn't keep ${eslintLoc}`);
	for (const f of infoFiles) if (!paths.includes(f) && !paths.includes(f.replace(/^packages\/[^/]+\//, "packages/*/"))) bad(6, `the CI cache doesn't keep ${f}`);
	const tsconfigs = execFileSync("git", ["-c", "core.quotepath=false", "ls-files", "*tsconfig*.json"], { cwd: ROOT }).toString().split("\n").filter(Boolean);
	if (!tsconfigs.includes("scripts/tsconfig.json")) bad(6, "the grader found no scripts/tsconfig.json to check the cache key against");
	const savers = vs.filter((s) => (/^actions\/cache@/.test(s.uses ?? "") || /^actions\/cache\/save@/.test(s.uses ?? "")) && /eslintcache/.test(String(s.with?.path ?? "")));
	if (savers.length === 0) bad(6, "the ESLint/tsc caches are never saved");
	// Read only on pull requests (a push lints fresh and saves the cache for them), saved on both.
	for (const s of c.filter((x) => /^actions\/cache\/restore@/.test(x.uses ?? ""))) if (!PR.test(ifOf(s))) bad(6, `the ESLint/tsc caches are restored on runs other than pull requests (if: ${ifOf(s)})`);
	for (const s of savers) if (/event_name/.test(ifOf(s))) bad(6, `the ESLint/tsc caches are saved only for some events (if: ${ifOf(s)})`);
	// The key, and each restore key, change with ESLint's config, its own rules and the lockfile
	// (the plugins), so a pull request's replayed lint results never outlive a rule change.
	for (const s of [...c, ...savers])
	{
		const keys = [String(s.with?.key ?? ""), ...String(s.with?.["restore-keys"] ?? "").split("\n").map((l) => l.trim()).filter(Boolean)];
		for (const k of keys)
		{
			const h = /hashFiles\(([^)]*)\)/.exec(k)?.[1] ?? "";
			for (const f of ["eslint.config.js", "tools/eslint-rules/**", "pnpm-lock.yaml"]) if (!h.includes(`'${f}'`)) bad(6, `the ESLint/tsc cache key '${k}' doesn't hash ${f}`);
			// Every tsconfig the type-aware rules can read (projectService finds each file's own,
			// scripts/ and scripts/backlog-vault/ included) is matched by the key's patterns.
			const pats = [...h.matchAll(/'([^']+)'/g)].map((x) => x[1]);
			const covered = (f) => pats.some((g) => !g.startsWith("!") && matchesGlob(f, g)) && !pats.some((g) => g.startsWith("!") && matchesGlob(f, g.slice(1)));
			for (const f of tsconfigs) if (!covered(f)) bad(6, `the ESLint/tsc cache key '${k.slice(0, 60)}…' doesn't hash ${f}`);
		}
	}
}
JS
node_status=$?
while IFS= read -r line; do
	case "$line" in
		"BAD "*)
			rest=${line#BAD }
			bad "${rest%% *}" "${rest#* }"
			;;
	esac
done < "$TMP/node.out"
if [ "$node_status" -ne 0 ]; then
	for i in 1 2 3 4 5 6; do bad "$i" "the grader's Node pass crashed: $(tail -3 "$TMP/node.err" | tr '\n' ' ')"; done
fi

NOTE=$(ls docs/v3/backlog/stories/*/S152.md 2>/dev/null | head -1)

# --- Check 7: two measured runs in the note -------------------------------------------------
notes=$(awk '/^\*\*Notes:\*\*/{f=1} /^\*\*Reuse check\*\*/{f=0} f' "$NOTE")
measured=$(printf '%s\n' "$notes" | grep -E '^\s*- \*\*Measured' || true)
urls=$(printf '%s\n' "$measured" | grep -oE 'https://github\.com/[^ )]+/actions/runs/[0-9]+' | sort -u | wc -l | tr -d ' ')
[ "$urls" -ge 2 ] || bad 7 "the note's **Measured** lines name $urls run URLs, not two"
printf '%s\n' "$measured" | grep -qiE 'web' || bad 7 "no measured run changing only web/"
printf '%s\n' "$measured" | grep -qiE 'functions' || bad 7 "no measured run changing functions/"
[ "$(printf '%s\n' "$measured" | grep -oE '[0-9]+(\.[0-9]+)? ?(s|min|m)\b' | wc -l | tr -d ' ')" -ge 4 ] || bad 7 "the measured lines give fewer than four job times"

# --- Check 8: law P11's wording -------------------------------------------------------------
grep -qE '^- \*\*P11 wording:\*\*.*Reword P11 \(Recommended\)' "$NOTE" || bad 8 "the note has no **P11 wording:** line quoting the owner"
p11=$(grep -E '^\| P11 \|' docs/v3/LAWS.md | cut -d'|' -f3)
printf '%s' "$p11" | grep -qiE 'pull request[^.]*reuse' || bad 8 "P11's row doesn't say a pull request reuses unchanged packages' results"
printf '%s' "$p11" | grep -qiE 'push to `?stage`? or `?main`?[^.]*fresh|fresh[^.]*push to `?stage`? or `?main`?' || bad 8 "P11's row doesn't say every push to stage or main runs all of pnpm verify fresh"

# --- Check 9: backlog Status is done ----------------------------------------------------------
grep -qE '^\| [0-9]+ \| \[S152\].*\| `done` \|' docs/v3/BACKLOG.md || bad 9 "S152 row in the Story status table is not \`done\`"
awk '/^### S152 —/{f=1;next} /^### S[0-9]/{f=0} f' docs/v3/BACKLOG.md | grep -qE '^\*\*Status:\*\* `done`$' ||
	bad 9 "S152 story heading Status is not \`done\`"

# --- Check 10: fence ---------------------------------------------------------------------------
# scripts/backlog-vault/ci-law.test.ts joined the fence on the owner's word (2026-11-19, asked
# whether S152 may update the test that enforces law P11: "Widen the fence (Recommended)"): the one
# check this grader widens before S152 ships; every other change to it tightens.
changed=$(story_changed_files S152 "$BASE" .)
while IFS= read -r f; do
	[ -z "$f" ] && continue
	case "$f" in
		.github/workflows/ci.yml | turbo.json | package.json | packages/domain/package.json | packages/ports/package.json | \
			packages/mlb-api/package.json | functions/package.json | functions/vitest.config.ts | web/package.json | \
			pnpm-lock.yaml | .gitignore | eslint.config.js | e2e/* | docs/v3/BACKLOG.md | docs/v3/backlog/* | \
			docs/v3/AUDIT.md | docs/v3/audit.jsonl | docs/v3/INDEX.md | docs/v3/LAWS.md | CHANGELOG.md | scripts/verify-S152.sh | \
			scripts/backlog-vault/ci-law.test.ts) ;;
		*) bad 10 "outside the fence: $f" ;;
	esac
done <<< "$changed"
git cat-file -e "$BASE:scripts/verify-S152.sh" 2>/dev/null && bad 10 "scripts/verify-S152.sh existed before S152 (it may only be created)"

report "verify-S152"
exit $?
