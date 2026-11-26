#!/usr/bin/env bash
# Grader for BACKLOG story S168 — each area of the repository is a workspace unit with its own
# lint/typecheck/test/build tasks, the task graph has only the edges a task consumes, every task
# declares its inputs, the local check and CI run only what a change reaches (stage and Deploy's
# gate run everything fresh), and the laws name the tasks that enforce them (ADR-030; owner,
# 2026-11-21).
# Contract: docs/v3/backlog/frame/00 (Verify-script contract).
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`); runs only the
# law-test unit's named test files AC 7 and AC 8 name.
#
# Every check reads the workspace as it is when it runs (pnpm-workspace.yaml, `pnpm ls -r`,
# Turborepo's dry run, git ls-files), never a list of units written here. The names ADR-030 settles
# (the entry point, the full-run switch, the base branch, the law-test unit, the finishing gate) are
# read from its "Settings the checks read" lines.
#
# Written before the ADR was accepted (2026-11-26): checks 4 and 5's dynamic parts (the hash-change
# and isolated-copy runs, the narrowed dry runs against a temporary base and the ledger lists) are
# added under rule 7 once the owner accepts ADR-030, since how they run follows its accepted rules.

set -uo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "ARCHITECTURE.md has the build-and-check ADR, status accepted, covering units, repo-wide checks, the law-test unit, task dependencies, typecheck-only builds, inputs, toolchain files, the base branch, concurrency, the cache, the ledger record, the finishing gate, CI on pull requests and pushes, sharding, and each law it rewords; S168's text carries **ADR acceptance:** and **Finishing gate:** lines, each with a quotation"
check 2 "every tracked *.test.* and vitest.config.* lies in exactly one workspace unit; each unit defines the lint/typecheck/test/build its contents need and turbo.json runs them; root tasks are named //# tasks that run no eslint/tsc/vitest; no root script the local check or CI runs calls eslint, tsc or vitest"
check 3 "in the dry-run task graph no unit's test/lint/typecheck depends on another unit's test or lint, cross-unit edges go only to a workspace dependency's build or typecheck, and no edge joins a root task and a unit task"
check 4 "every turbo.json task declares inputs, none wider than its unit plus named outside paths; globalDependencies holds only the toolchain files ADR-030 lists"
check 5 "the entry point ADR-030 names compares against its base branch's merge base, counts untracked files, honours its full-run switch, sets a concurrency, and audit.sh story records ran / replayed / not-affected tasks"
check 6 "ci.yml's pull-request verify calls the entry point; push and Deploy's verify job (push, release, workflow_dispatch) force the full run with no cache read; shard jobs call the unit's test task, not vitest; ci-passed stays the aggregate"
check 7 "every enforced law names a task present in the full dry-run graph; no vitest.config.* coverage floor is lower than, or gone since, the story's base; the law-test unit's law tests pass"
check 8 "a test in the law-test unit proves a change to one leaf unit executes only its own tasks (and declared readers), and it passes"
check 9 "CLAUDE.md, the verify and run-backlog skills and LOOP.md name the entry point, the full-run switch and the finishing gate's mode, and that stage runs everything"
check 10 "S168 changed no file outside its fence (its own records allowed); its snapshot records Status done"

# The commit S168's own changes are measured from: origin/stage when its grader was written.
BASE=f0a6b3e2902fca30e9b98ae19a8c701ad93a862d

TMP="$(mktemp -d /tmp/verify-S168.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

# The story's text: its ship-time snapshot once it has one, else its newest text record.
story_snapshot S168 >"$TMP/story.md" 2>/dev/null || node scripts/backlog-vault/text-records.ts newest S168 >"$TMP/story.md" 2>/dev/null || true

# The workspace units and Turborepo's full dry run, read once.
pnpm ls -r --depth -1 --json >"$TMP/units.json" 2>/dev/null || echo "[]" >"$TMP/units.json"
pnpm exec turbo run lint typecheck test build --dry=json >"$TMP/dry.json" 2>"$TMP/dry.err" || echo "{}" >"$TMP/dry.json"
git ls-files >"$TMP/files.txt"
git show "$BASE:package.json" >/dev/null 2>&1 || bad 7 "base commit $BASE is not in this clone"
mkdir -p "$TMP/base"
git ls-tree -r --name-only "$BASE" | grep -E '(^|/)vitest\.config\.[^/]+$' | while IFS= read -r f; do
  mkdir -p "$TMP/base/$(dirname "$f")"
  git show "$BASE:$f" >"$TMP/base/$f"
done

node --input-type=module - "$ROOT" "$TMP" >"$TMP/node.out" 2>"$TMP/node.err" <<'JS'
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { createRequire } from "node:module";

const [ROOT, TMP] = process.argv.slice(2);
const require = createRequire(join(ROOT, "package.json"));
const YAML = require("yaml");
const bad = (id, why) => console.log(`BAD ${id} ${why}`);
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const tryRead = (p) => { try { return read(p); } catch { return ""; } };
// turbo.json carries comments; strip whole-line // comments before parsing.
const jsonc = (s) => JSON.parse(s.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n"));

// --- Check 1: the ADR ---
const arch = tryRead("docs/v3/ARCHITECTURE.md");
const adrs = [...arch.matchAll(/^### (ADR-(\d+)) — (.*)$/gm)].map((m) => ({ id: m[1], n: Number(m[2]), title: m[3], at: m.index }));
const adr = adrs.find((a) => /build/i.test(a.title) && /check/i.test(a.title));
let adrText = "";
const setting = (name) => (adrText.match(new RegExp(`^- ${name}: (.+)$`, "m"))?.[1] ?? "").trim();
const code = (s) => s.match(/`([^`]+)`/)?.[1] ?? "";
if (!adr) bad(1, "no ADR titled for the build and check architecture in docs/v3/ARCHITECTURE.md");
else
{
	const next = adrs.filter((a) => a.at > adr.at).sort((a, b) => a.at - b.at)[0];
	const end = Math.min(next ? next.at : arch.length, (arch.indexOf("\n## ", adr.at) + 1) || arch.length);
	adrText = arch.slice(adr.at, end);
	if (!/\(accepted \d{4}-\d{2}-\d{2}\)/.test(adr.title)) bad(1, `${adr.id}'s status is not "accepted <date>" (${adr.title.match(/\(([^)]*)\)\s*$/)?.[1] ?? "none"})`);
	const items = {
		"what a unit is": /\bunit is\b/i,
		"repo-wide checks": /repo-wide/i,
		"the law-test unit": /law-test unit/i,
		"task dependencies": /depend/i,
		"typecheck-only builds": /--noEmit/,
		"declared inputs": /\binputs\b/,
		"toolchain-wide files": /toolchain/i,
		"the base branch": /Base branch:/,
		"concurrency": /concurrency/i,
		"the cache": /cache/i,
		"the ledger record": /ledger/i,
		"the finishing gate": /finishing gate/i,
		"CI on a pull request": /pull request/i,
		"a push to stage or main": /push to `stage` or `main`/,
		"functions' sharding": /shard/i,
		"law P11's rewording": /\*\*P11:\*\*/,
		"new laws": /new laws/i,
	};
	for (const [what, re] of Object.entries(items)) if (!re.test(adrText)) bad(1, `${adr.id} does not cover ${what}`);
	for (const s of ["Entry point", "Full-run switch", "Base branch", "Law-test unit", "Finishing gate", "Concurrency"]) if (!setting(s)) bad(1, `${adr.id} has no "- ${s}:" setting line`);
	if (/owner's answer is recorded here when given/.test(setting("Finishing gate"))) bad(1, `${adr.id}'s finishing gate still awaits the owner's answer`);
}
const story = existsSync(join(TMP, "story.md")) ? readFileSync(join(TMP, "story.md"), "utf8") : "";
const quoted = (label) => { const m = story.match(new RegExp(`\\*\\*${label}:\\*\\*([^\\n]*)`)); return m && /[*_]?"[^"]+"|“[^”]+”/.test(m[1]); };
if (!quoted("ADR acceptance")) bad(1, "S168's text has no **ADR acceptance:** line quoting the owner");
if (!quoted("Finishing gate")) bad(1, "S168's text has no **Finishing gate:** line quoting the owner");

const ENTRY = code(setting("Entry point")) || "pnpm verify";
const FULL = code(setting("Full-run switch"));
const BASE_BRANCH = code(setting("Base branch")) || "stage";
const LAWUNIT = code(setting("Law-test unit"));

// --- Check 2: units ---
let units = [];
try { units = JSON.parse(readFileSync(join(TMP, "units.json"), "utf8")); } catch {}
units = units.map((u) => ({ name: u.name, dir: relative(ROOT, u.path) })).filter((u) => u.dir !== "");
const files = readFileSync(join(TMP, "files.txt"), "utf8").split("\n").filter(Boolean);
const unitOf = (f) => units.filter((u) => f.startsWith(u.dir + "/")).sort((a, b) => b.dir.length - a.dir.length)[0];
for (const f of files)
{
	if (!/(^|\/)[^/]*\.test\.[cm]?[jt]sx?$/.test(f) && !/(^|\/)vitest\.config\.[^/]+$/.test(f)) continue;
	if (/(^|\/)fixtures\//.test(f)) continue;
	if (!unitOf(f)) bad(2, `${f} lies in no workspace unit`);
}
let turbo = {};
try { turbo = jsonc(read("turbo.json")); } catch (e) { bad(2, `turbo.json does not parse: ${e.message}`); }
const tasks = turbo.tasks ?? {};
const taskNames = new Set(Object.keys(tasks).map((t) => t.replace(/^.*#/, "")));
for (const u of units)
{
	let pkg = {};
	try { pkg = JSON.parse(read(join(u.dir, "package.json"))); } catch {}
	const scripts = pkg.scripts ?? {};
	const own = files.filter((f) => unitOf(f)?.dir === u.dir);
	const need = [];
	if (own.some((f) => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(f))) need.push("lint");
	if (own.some((f) => /\.tsx?$/.test(f) && !/\.d\.ts$/.test(f))) need.push("typecheck");
	if (own.some((f) => /\.test\.[cm]?[jt]sx?$/.test(f))) need.push("test");
	for (const t of need)
	{
		if (!scripts[t]) bad(2, `${u.name} (${u.dir}) has no "${t}" script`);
		if (!taskNames.has(t)) bad(2, `turbo.json runs no "${t}" task`);
	}
	if (/tsc\b[^&|;]*--noEmit/.test(scripts.build ?? "")) bad(2, `${u.name}'s build only type-checks (tsc --noEmit); ADR-030 makes that its typecheck`);
}
const rootPkg = JSON.parse(read("package.json"));
const rootScripts = rootPkg.scripts ?? {};
const exempt = new Set(["lint:fix", "test:watch", "format", "prepare", "preinstall"]);
// The scripts the local check reaches: the entry point's script and every `pnpm <script>` it names, transitively.
const reached = new Set();
const walk = (name) =>
{
	if (reached.has(name) || !rootScripts[name]) return;
	reached.add(name);
	for (const m of rootScripts[name].matchAll(/pnpm (?:run )?([a-z][\w:-]*)/g)) walk(m[1]);
};
walk(ENTRY.replace(/^pnpm (run )?/, ""));
const wf = {};
for (const f of files.filter((f) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(f))) { try { wf[f] = YAML.parse(read(f)); } catch {} }
for (const doc of Object.values(wf)) for (const job of Object.values(doc?.jobs ?? {})) for (const s of job?.steps ?? []) for (const m of String(s?.run ?? "").matchAll(/pnpm (?:run )?([a-z][\w:-]*)/g)) walk(m[1]);
for (const name of reached)
{
	if (exempt.has(name)) continue;
	if (/(^|[\s;&|(])(eslint|tsc|vitest)(\s|$)/.test(rootScripts[name])) bad(2, `root script "${name}" (reached by the check or CI) calls eslint, tsc or vitest itself`);
}
for (const t of Object.keys(tasks)) if (t.startsWith("//#") && /eslint|tsc|vitest/.test(rootScripts[t.slice(3)] ?? "")) bad(2, `root task ${t} runs eslint, tsc or vitest`);
if (!Object.keys(tasks).some((t) => t.startsWith("//#"))) bad(2, "turbo.json names no //# root task (the backlog check at least is one)");
for (const doc of Object.values(wf)) for (const job of Object.values(doc?.jobs ?? {})) for (const s of job?.steps ?? []) if (/(^|[\s;&|])(pnpm exec |npx )?vitest\b/.test(String(s?.run ?? "")) && !/--merge-reports/.test(String(s?.run ?? ""))) bad(2, `a workflow step calls vitest outside the graph: ${String(s.run).split("\n")[0]}`);

// --- Check 3: edges ---
let dry = {};
try { dry = JSON.parse(readFileSync(join(TMP, "dry.json"), "utf8")); } catch {}
const dtasks = dry.tasks ?? [];
if (dtasks.length === 0) bad(3, `Turborepo's dry run of lint/typecheck/test/build gave no tasks (${readFileSync(join(TMP, "dry.err"), "utf8").split("\n").find(Boolean) ?? "no error"})`);
const pkgOf = (id) => id.slice(0, id.lastIndexOf("#"));
const tOf = (id) => id.slice(id.lastIndexOf("#") + 1);
for (const t of dtasks)
{
	for (const d of t.dependencies ?? [])
	{
		const root = (x) => x.startsWith("//#");
		if (root(t.taskId) !== root(d)) { bad(3, `${t.taskId} → ${d} joins a root task and a unit task`); continue; }
		if (pkgOf(d) === pkgOf(t.taskId)) continue;
		if (["test", "lint", "test:coverage"].includes(tOf(d))) bad(3, `${t.taskId} depends on another unit's ${tOf(d)} (${d})`);
		else if (!["build", "typecheck"].includes(tOf(d))) bad(3, `${t.taskId} depends on ${d}, not a dependency's build or typecheck`);
	}
}

// --- Check 4: inputs ---
const TOOLCHAIN = ["pnpm-lock.yaml", "tsconfig.base.json", ".nvmrc", "turbo.json", "eslint.config.js", "vitest.config.ts"];
for (const g of turbo.globalDependencies ?? []) if (!TOOLCHAIN.includes(g)) bad(4, `globalDependencies holds ${g}, not a toolchain file`);
for (const [name, t] of Object.entries(tasks))
{
	if (!Array.isArray(t.inputs)) { bad(4, `task ${name} declares no inputs`); continue; }
	for (const i of t.inputs) if (/^(\.\.\/)+\*\*|^\$TURBO_ROOT\$\/\*\*|^\$TURBO_ROOT\$\/?$|^\*\*\/\*$|^(\.\.\/)+\*?$/.test(i)) bad(4, `task ${name}'s input ${i} reaches wider than its unit`);
}

// --- Check 5: the entry point and the ledger record ---
const entryScript = [...reached].map((n) => rootScripts[n]).join("\n");
const entryFiles = [...entryScript.matchAll(/(scripts\/[\w./-]+\.(?:sh|ts))/g)].map((m) => tryRead(m[1])).join("\n");
const entryAll = entryScript + "\n" + entryFiles;
if (!new RegExp(`merge-base[^\\n]*${BASE_BRANCH}|${BASE_BRANCH}[^\\n]*merge-base|TURBO_SCM_BASE`).test(entryAll)) bad(5, `the entry point (${ENTRY}) does not compare against the merge base with ${BASE_BRANCH}`);
if (!/ls-files --others --exclude-standard/.test(entryAll)) bad(5, "the entry point does not count untracked files");
if (!FULL || !entryAll.includes(FULL.split("=")[0])) bad(5, `the entry point does not honour the full-run switch (${FULL || "none named"})`);
if (!/--concurrency/.test(entryAll)) bad(5, "the entry point sets no Turborepo concurrency");
const audit = tryRead("scripts/audit.sh");
if (!/--summarize|runs\/.*\.json/.test(audit) || !/replayed/i.test(audit) || !/not affected/i.test(audit)) bad(5, "scripts/audit.sh story does not record the tasks that ran, replayed and were not affected");

// --- Check 6: CI ---
const ci = wf[".github/workflows/ci.yml"] ?? {};
const deploy = wf[".github/workflows/deploy.yml"] ?? {};
const stepsOf = (doc, job) => doc?.jobs?.[job]?.steps ?? [];
const verifySteps = stepsOf(ci, "verify").filter((s) => String(s?.run ?? "").includes(ENTRY));
const fullStep = (s) => FULL && (String(s?.run ?? "").includes(FULL) || JSON.stringify(s?.env ?? {}).includes(FULL.split("=")[0]));
const prStep = verifySteps.find((s) => /pull_request/.test(String(s?.if ?? "")) && !/!=\s*'pull_request'/.test(String(s?.if ?? "")));
const pushStep = verifySteps.find((s) => /!=\s*'pull_request'|push/.test(String(s?.if ?? "")));
if (!prStep) bad(6, `ci.yml's verify job has no pull-request step calling ${ENTRY}`);
if (!pushStep || !fullStep(pushStep)) bad(6, `ci.yml's push verify step does not force the full run (${FULL || "no switch named"})`);
if (pushStep && /BT_TURBO_CACHE_READ/.test(JSON.stringify(pushStep.env ?? {}))) bad(6, "ci.yml's push verify step reads the cache");
const dv = stepsOf(deploy, "verify").filter((s) => String(s?.run ?? "").includes(ENTRY));
if (dv.length === 0 || !dv.every(fullStep)) bad(6, "Deploy's verify job does not force the full run on every event it runs the gate for");
for (const [job, j] of Object.entries(ci.jobs ?? {})) if (/shard/.test(job)) for (const s of j.steps ?? []) if (/vitest/.test(String(s?.run ?? "")) && !/--merge-reports/.test(String(s?.run ?? ""))) bad(6, `${job} calls vitest instead of the unit's test task`);
if (!ci.jobs?.["ci-passed"]) bad(6, "ci.yml has no ci-passed aggregate job");

// --- Check 7: laws and floors ---
const laws = tryRead("docs/v3/LAWS.md").split("\n").filter((l) => /^\| [LP]\d+ \|/.test(l)).map((l) => l.split("|").map((c) => c.trim()));
const graphIds = new Set(dtasks.map((t) => t.taskId));
for (const row of laws)
{
	const [id, step, status] = [row[1], row[row.length - 3], row[row.length - 2]];
	if (status !== "enforced") continue;
	const named = [...step.matchAll(/`?((?:@[\w/-]+|\/\/)#[\w:-]+|<unit>#[\w:-]+|each unit's `?\w+`?)`?/g)].map((m) => m[1]);
	if (named.length === 0) { bad(7, `law ${id}'s step (${step}) names no graph task`); continue; }
	for (const n of named) if (/^(@|\/\/)/.test(n) && !graphIds.has(n)) bad(7, `law ${id}'s task ${n} is not in the full dry-run graph`);
}
const floors = (src) => Object.fromEntries([...src.matchAll(/\b(lines|branches|functions|statements):\s*([\d.]+)/g)].map((m) => [m[1], Number(m[2])]));
const walkBase = (d) => readdirSync(d).flatMap((n) => statSync(join(d, n)).isDirectory() ? walkBase(join(d, n)) : [join(d, n)]);
for (const f of existsSync(join(TMP, "base")) ? walkBase(join(TMP, "base")) : [])
{
	const rel = relative(join(TMP, "base"), f);
	const before = floors(readFileSync(f, "utf8"));
	if (Object.keys(before).length === 0) continue;
	const now = existsSync(join(ROOT, rel)) ? floors(read(rel)) : null;
	if (!now) { bad(7, `${rel} had coverage floors at the base and is gone`); continue; }
	for (const [k, v] of Object.entries(before)) if (!(k in now) || now[k] < v) bad(7, `${rel}'s ${k} floor fell from ${v} to ${now[k] ?? "none"}`);
}
if (!LAWUNIT || !units.some((u) => u.dir === LAWUNIT)) bad(7, `the law-test unit (${LAWUNIT || "none named"}) is not a workspace unit`);
console.log(`LAWUNIT ${LAWUNIT}`);

// --- Check 8: the leaf-unit test ---
const lawFiles = LAWUNIT ? files.filter((f) => f.startsWith(LAWUNIT + "/") && /\.test\.ts$/.test(f)) : [];
const leaf = lawFiles.find((f) => /leaf/i.test(f) || /leaf unit/i.test(tryRead(f)));
if (!leaf) bad(8, "no test in the law-test unit proves the leaf-unit property");
else console.log(`LEAFTEST ${leaf}`);

// --- Check 9: docs ---
for (const f of ["CLAUDE.md", ".claude/skills/verify/SKILL.md", ".claude/skills/run-backlog/SKILL.md", "docs/v3/LOOP.md"])
{
	const t = tryRead(f);
	if (!t.includes(ENTRY)) bad(9, `${f} does not name the entry point ${ENTRY}`);
	if (!FULL || !t.includes(FULL.split("=")[0])) bad(9, `${f} does not name the full-run switch (${FULL || "none named"})`);
	if (!/finishing gate/i.test(t)) bad(9, `${f} does not say what the finishing gate runs`);
}
JS
node_exit=$?
[ "$node_exit" -eq 0 ] || bad 1 "the Node checks crashed (exit $node_exit): $(head -c 400 "$TMP/node.err")"
while IFS= read -r line; do
  case "$line" in BAD\ *) rest="${line#BAD }"; bad "${rest%% *}" "${rest#* }" ;; esac
done <"$TMP/node.out"
LAWUNIT="$(sed -n 's/^LAWUNIT //p' "$TMP/node.out")"
LEAFTEST="$(sed -n 's/^LEAFTEST //p' "$TMP/node.out")"

# --- Check 7 (law tests) and check 8 (leaf-unit test): run the named law-test files ---
if [ -n "$LAWUNIT" ] && [ -d "$LAWUNIT" ]; then
  law_tests=()
  for t in verify-chain ci-law laws; do
    f="$(git ls-files -- "$LAWUNIT" | grep -E "/$t\.test\.ts$" | head -1)"
    [ -n "$f" ] && law_tests+=("${f#"$LAWUNIT"/}")
  done
  if [ "${#law_tests[@]}" -lt 3 ]; then
    bad 7 "the law-test unit lacks verify-chain, ci-law or laws tests"
  elif ! (cd "$LAWUNIT" && pnpm exec vitest run "${law_tests[@]}" >"$TMP/law.log" 2>&1); then
    bad 7 "the law tests fail: $(grep -m1 -E 'FAIL|Error' "$TMP/law.log")"
  fi
  if [ -n "$LEAFTEST" ] && ! (cd "$LAWUNIT" && pnpm exec vitest run "${LEAFTEST#"$LAWUNIT"/}" >"$TMP/leaf.log" 2>&1); then
    bad 8 "the leaf-unit test fails: $(grep -m1 -E 'FAIL|Error' "$TMP/leaf.log")"
  fi
fi

# --- Check 10: fence and status ---
fence='^(package\.json|pnpm-workspace\.yaml|pnpm-lock\.yaml|turbo\.json|tsconfig\.base\.json|eslint\.config\.js|vitest\.config\.ts|\.jscpd\.json|\.size-limit\.json|lighthouserc\.json|\.gitignore|functions/package\.json|functions/tsconfig\.json|functions/vitest\.config\.ts|functions/vitest\.workers\.config\.ts|functions/src/deploy/deploy-workflow\.test\.ts|functions/src/scripts/copy-baseball-run\.test\.ts|web/package\.json|web/tsconfig\.json|web/vitest\.config\.ts|web/vite\.config\.ts|CLAUDE\.md|docs/v3/ARCHITECTURE\.md|docs/v3/LAWS\.md|docs/v3/LOOP\.md)$|^(\.husky/|packages/|tools/|e2e/|scripts/|\.github/workflows/|\.claude/skills/verify/|\.claude/skills/run-backlog/|docs/v3/backlog/|docs/v3/audit/|changelog\.d/)'
while IFS= read -r f; do
  [ -z "$f" ] && continue
  grep -qE "$fence" <<<"$f" || bad 10 "outside the fence: $f"
done < <(story_own_changed_files S168 "$BASE" .)
[ "$(story_snapshot_status S168)" = "done" ] || bad 10 "S168's snapshot does not record Status done"

report "verify-S168"
exit $?
