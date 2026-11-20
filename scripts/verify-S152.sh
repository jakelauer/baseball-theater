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

check 1 "flows and design-specs restore ~/.cache/ms-playwright with actions/cache keyed on the lockfile's @playwright/test version and the runner image (RUNNER_OS, ImageOS), download chromium only on a cache miss, and install its system libraries (install-deps) every run"
check 2 "turbo.json: typecheck/build/test:coverage each depend on ^ of themselves, coverage/** in test:coverage outputs, web#build outputs dist/**, the global inputs AC 2 lists, every env var a task reads declared in its env; offline dry runs prove web/src, packages/domain/src and global-file edits change exactly the right hashes (tree untouched)"
check 3 "pnpm verify's script unchanged; root build and test:coverage call turbo and read no cache unless BT_TURBO_CACHE_READ is set, which ci.yml sets only in a pull_request step; verify job keeps one job-level if, the Markdown step, a 'pnpm verify' step and the ci-passed line; Turborepo cache restored on pull requests (own PR first, then stage) and saved by every run; law tests pass"
check 4 "functions' test:coverage skips on BT_FUNCTIONS_SHARDED; functions/vitest.config.ts turns floors off on BT_COVERAGE_SHARD; >=2 shard jobs after flows run vitest --shard and a merge job merges reports with the floors on; vitest.workers.config.ts runs in exactly one job; step-level ifs on the functions decision; ci-passed requires shards and merge (skipped only for code=false); the decision is reachesFunctions in e2e/select-specs.ts"
check 5 "every spec under e2e/flows and e2e/design declares targets (web/functions only; web alone only when it routes all of **/api/**); e2e/select-specs.ts selects per AC 5's cases; ci.yml runs it on pull requests only, passes the list in place of a fixed path, step-level skips, every spec on push"
check 6 "ESLint runs with --cache --cache-strategy content and a fixed --cache-location (git-ignored); every package's typecheck and build tsc pass --incremental with the same --tsBuildInfoFile; CI keeps both with actions/cache restored before pnpm verify"
check 7 "the note names two measured pull-request runs (URLs and job times)"
check 8 "the note carries a **P11 wording:** line quoting the owner; LAWS.md's P11 row names the pull-request reuse and the fresh full run on every push to stage or main"
check 9 "backlog Status is done (story heading and Story status table)"
check 10 "S152 changed no file outside its fence (plus creating scripts/verify-S152.sh)"

# The commit S152 started from (HEAD when its grader was written).
BASE=585b23e

TMP="$(mktemp -d /tmp/verify-S152.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

# --- Checks 1–6: one Node pass over ci.yml, turbo.json, the package scripts and the selector ---
# It prints "BAD <id> <reason>" lines; everything else it prints is ignored.
node --input-type=module - "$ROOT" "$TMP" >"$TMP/node.out" 2>"$TMP/node.err" <<'JS'
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync, appendFileSync, mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
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

// ---- Check 1: the Playwright browser is cached, never reinstalled ----
for (const job of ["flows", "design-specs"])
{
	const st = steps(job);
	const cache = st.find((s) => /^actions\/cache@/.test(s.uses ?? "") && String(s.with?.path ?? "").includes("~/.cache/ms-playwright"));
	if (!cache) { bad(1, `${job}: no actions/cache step for ~/.cache/ms-playwright`); continue; }
	if (!cache.id) bad(1, `${job}: the browser cache step has no id (the download can't test its hit)`);
	// Resolve the key: ${{ steps.X.outputs.Y }} by running step X's script here, ${{ runner.os }} as Linux.
	let key = String(cache.with?.key ?? "");
	key = key.replace(/\$\{\{\s*runner\.os\s*\}\}/g, "Linux");
	for (const m of [...key.matchAll(/\$\{\{\s*steps\.([\w-]+)\.outputs\.([\w-]+)\s*\}\}/g)])
	{
		const src = st.find((s) => s.id === m[1]);
		if (!src) { bad(1, `${job}: the browser cache key reads step ${m[1]}, which doesn't exist`); continue; }
		const out = join(TMP, `out-${job}-${m[1]}`);
		writeFileSync(out, "");
		const r = spawnSync("bash", ["-c", runOf(src)], { cwd: ROOT, env: { ...process.env, RUNNER_OS: "Linux", ImageOS: "ubuntu24", GITHUB_OUTPUT: out }, encoding: "utf8" });
		if (r.status !== 0) bad(1, `${job}: step ${m[1]} fails when run here: ${r.stderr.trim().slice(0, 200)}`);
		const val = readFileSync(out, "utf8").split("\n").find((l) => l.startsWith(`${m[2]}=`))?.slice(m[2].length + 1) ?? "";
		key = key.replace(m[0], val);
	}
	if (/\$\{\{/.test(key)) bad(1, `${job}: browser cache key has an expression the grader can't resolve: ${key}`);
	if (!pwVersion || !key.includes(pwVersion)) bad(1, `${job}: browser cache key '${key}' doesn't name the lockfile's @playwright/test ${pwVersion}`);
	if (!key.includes("ubuntu24") || !key.includes("Linux")) bad(1, `${job}: browser cache key '${key}' doesn't name the runner image (ImageOS) and runner.os`);
	if (st.some((s) => /playwright install --with-deps/.test(runOf(s)))) bad(1, `${job}: still runs playwright install --with-deps`);
	const dl = st.filter((s) => /playwright install chromium/.test(runOf(s)));
	if (dl.length === 0) bad(1, `${job}: no 'playwright install chromium' step`);
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
try { turbo = json("turbo.json"); } catch { bad(2, "no parseable turbo.json"); }
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
		const r = spawnSync(turboBin, ["run", "test:coverage", "--dry=json", "--no-update-notifier"], { cwd: copy, env: { ...process.env, TURBO_TELEMETRY_DISABLED: "1", DO_NOT_TRACK: "1" }, encoding: "utf8", maxBuffer: 64 << 20 });
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
const VAR = "BT_TURBO_CACHE_READ";
for (const name of ["build", "test:coverage"])
{
	const m = /turbo run [^&|;]+/.exec(root[name] ?? "");
	if (!m) { bad(3, `root ${name} doesn't call turbo run`); continue; }
	const argsWith = (set) => execFileSync("sh", ["-c", `echo ${m[0]}`], { env: { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== VAR)), ...(set ? { [VAR]: "1" } : {}) } }).toString();
	const off = argsWith(false), on = argsWith(true);
	if (!/--force\b|--cache=local:w\b/.test(off) || /--cache=local:rw/.test(off)) bad(3, `root ${name}'s turbo call reads the cache with ${VAR} unset: ${off.trim()}`);
	if (/--force\b|--cache=local:w\b/.test(on)) bad(3, `root ${name}'s turbo call never reads the cache, even with ${VAR} set: ${on.trim()}`);
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
		if (PR.test(ifOf(save)) && !/!=/.test(ifOf(save))) bad(3, "the Turborepo cache is saved only on pull requests");
		if (vs.indexOf(save) < verifyIdx) bad(3, "the Turborepo cache is saved before pnpm verify");
	}
}
{
	const r = spawnSync(join(ROOT, "node_modules/.bin/vitest"), ["run", "--config", "scripts/backlog-vault/vitest.config.ts", "scripts/backlog-vault/ci-law.test.ts", "scripts/backlog-vault/laws.test.ts", "scripts/backlog-vault/verify-chain.test.ts"], { cwd: ROOT, encoding: "utf8" });
	if (r.status !== 0) bad(3, `the law tests fail: ${(r.stdout + r.stderr).split("\n").filter((l) => /FAIL|✗|×/.test(l)).slice(0, 5).join(" / ")}`);
}

// ---- Check 4: functions tests sharded only when the change reaches them ----
const fnScripts = json("functions/package.json").scripts ?? {};
const fnCov = String(fnScripts["test:coverage"] ?? "");
if (!/BT_FUNCTIONS_SHARDED/.test(fnCov) || !/vitest run --config vitest\.workers\.config\.ts/.test(fnCov)) bad(4, "functions' test:coverage doesn't skip both halves on BT_FUNCTIONS_SHARDED");
else
{
	const run = (env) => spawnSync("sh", ["-c", fnCov.replace(/vitest /g, "echo RAN-vitest ")], { cwd: join(ROOT, "functions"), env: { ...process.env, ...env }, encoding: "utf8" }).stdout;
	if (/RAN-vitest/.test(run({ BT_FUNCTIONS_SHARDED: "1" }))) bad(4, "functions' test:coverage still runs vitest with BT_FUNCTIONS_SHARDED=1");
	if ((run({ BT_FUNCTIONS_SHARDED: "" }).match(/RAN-vitest/g) ?? []).length !== 2) bad(4, "functions' test:coverage doesn't run both halves with BT_FUNCTIONS_SHARDED unset");
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
const workerdJobs = jobNames.filter((j) => JSON.stringify(jobs[j]).includes("vitest.workers.config.ts"));
if (workerdJobs.length !== 1 || !shardJobs.includes(workerdJobs[0])) bad(4, `vitest.workers.config.ts is named by ${workerdJobs.length} jobs (${workerdJobs.join(", ")}), not exactly one shard job`);
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
	const cpRun = steps("ci-passed").map(runOf).join("\n");
	const cpEnv = JSON.stringify(steps("ci-passed").map((s) => s.env ?? {}));
	for (const j of [...shardJobs, ...mergeJobs]) if (!cpEnv.includes(`needs.${j}.result`)) bad(4, `ci-passed doesn't read ${j}'s result`);
	if (!/"success success"/.test(cpRun) || !/"skipped skipped"/.test(cpRun)) bad(4, "ci-passed doesn't require shards and merge to pass for code and be skipped for docs-only");
}

// ---- Check 5: specs declare targets; the selector ----
let sel = null;
try { sel = await import(join(ROOT, "e2e/select-specs.ts")); } catch (e) { bad(5, `e2e/select-specs.ts doesn't load: ${e.message.split("\n")[0]}`); bad(4, "no selector, so no functions decision"); }
const specFiles = ["flows", "design"].flatMap((d) => readdirSync(join(ROOT, "e2e", d)).filter((f) => f.endsWith(".spec.ts")).map((f) => `${d}/${f}`));
for (const f of specFiles)
{
	const src = read(`e2e/${f}`);
	const m = /^\/\/ @bt-targets: (.+)$/m.exec(src);
	if (!m) { bad(5, `${f} declares no targets`); continue; }
	const t = m[1].split(",").map((x) => x.trim());
	if (!t.every((x) => x === "web" || x === "functions")) bad(5, `${f} names a target other than web or functions: ${m[1]}`);
	if (t.length === 1 && t[0] === "web" && !/page\.route\(\s*["']\*\*\/api\/\*\*["']|stubApi\(\s*page,\s*["']\/api\/\*\*["']/.test(src)) bad(5, `${f} names web alone but doesn't route all of **/api/**`);
}
if (sel)
{
	const graph = sel.readGraph(ROOT);
	const SYN = [
		{ file: "syn/web.spec.ts", targets: ["web"] },
		{ file: "syn/functions.spec.ts", targets: ["functions"] },
		{ file: "syn/both.spec.ts", targets: ["web", "functions"] },
		{ file: "syn/none.spec.ts", targets: null },
	];
	const all = SYN.map((s) => s.file);
	const pick = (changed) => sel.selectSpecs(changed, SYN, graph).slice().sort().join(",");
	const want = (label, changed, expected) =>
	{
		const got = pick(changed);
		if (got !== expected.slice().sort().join(",")) bad(5, `given ${label}, selected [${got}], want [${expected.join(",")}]`);
	};
	want("packages/ports/", ["packages/ports/src/index.ts"], ["syn/functions.spec.ts", "syn/both.spec.ts", "syn/none.spec.ts"]);
	want("web/src/", ["web/src/main.tsx"], ["syn/web.spec.ts", "syn/both.spec.ts", "syn/none.spec.ts"]);
	for (const p of ["pnpm-lock.yaml", "scripts/backlog-vault/design-reference.ts", "compose.yaml", "e2e/flows/main.spec.ts", "docs/v3/visual/game-shell/RATIFIED.md"]) want(p, [p], all);
	want("only CHANGELOG.md", ["CHANGELOG.md"], []);
	const docs = ["docs/v3/AUDIT.md", "docs/v3/audit.jsonl", "docs/v3/INDEX.md", "docs/v3/BACKLOG.md"];
	want("only the generated docs", docs, []);
	want("the generated docs plus web/src/", [...docs, "web/src/main.tsx"], ["syn/web.spec.ts", "syn/both.spec.ts", "syn/none.spec.ts"]);
	// The real specs, as declared: every one naming web is picked for a web/src change.
	const real = specFiles.map((f) => ({ file: f, targets: sel.specTargets(read(`e2e/${f}`)) }));
	const webOnes = real.filter((s) => s.targets?.includes("web")).map((s) => s.file).sort().join(",");
	if (sel.selectSpecs(["web/src/main.tsx"], real, graph).slice().sort().join(",") !== webOnes) bad(5, "given web/src/, the real specs selected aren't exactly those naming web");
	// AC 4's decision, the same function's graph walk.
	for (const [p, yes] of [["web/src/main.tsx", false], ["packages/domain/src/index.ts", true], ["functions/src/index.ts", true], ["fixtures/x.json", true], ["scripts/preview-pr-open.sh", true]])
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

// ---- Check 6: ESLint and tsc caches ----
const lint = root.lint ?? "";
if (!/eslint \. [^&]*--cache\b/.test(lint) || !/--cache-strategy content/.test(lint) || !/--cache-location \S+/.test(lint)) bad(6, `root lint doesn't run ESLint with --cache --cache-strategy content --cache-location: ${lint}`);
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
	const saved = vs.some((s) => (/^actions\/cache@/.test(s.uses ?? "") || /^actions\/cache\/save@/.test(s.uses ?? "")) && /eslintcache/.test(String(s.with?.path ?? "")));
	if (!saved) bad(6, "the ESLint/tsc caches are never saved");
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
changed=$(story_changed_files S152 "$BASE" .)
while IFS= read -r f; do
	[ -z "$f" ] && continue
	case "$f" in
		.github/workflows/ci.yml | turbo.json | package.json | packages/domain/package.json | packages/ports/package.json | \
			packages/mlb-api/package.json | functions/package.json | functions/vitest.config.ts | web/package.json | \
			pnpm-lock.yaml | .gitignore | eslint.config.js | e2e/* | docs/v3/BACKLOG.md | docs/v3/backlog/* | \
			docs/v3/AUDIT.md | docs/v3/audit.jsonl | docs/v3/INDEX.md | docs/v3/LAWS.md | CHANGELOG.md | scripts/verify-S152.sh) ;;
		*) bad 10 "outside the fence: $f" ;;
	esac
done <<< "$changed"
git cat-file -e "$BASE:scripts/verify-S152.sh" 2>/dev/null && bad 10 "scripts/verify-S152.sh existed before S152 (it may only be created)"

report "verify-S152"
exit $?
