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
# Among them: a toolchain edit (the ADR's "Toolchain files" line) changes every task's hash; and a
# change made only of an untracked file in no unit and no declared input (say newdir/x.test.ts) shows
# the law-test unit's test as a cache miss (ADR-030 rule 7 forces it), which then fails on that file.
#
# Pre-park review fixes (2026-11-26, rule 7, each a tightening): the acceptance notes count only at a
# line's start; the dry run covers the entry point's own `turbo run` list; check 3 walks paths, not
# only edges; inputs are an allowlist; the toolchain list and the finishing gate's mode come from the
# ADR; the full-run switch must force a fresh run, --reverify must set it, and the entry point must run
# the law-test unit; comment lines never satisfy a check; check 2 counts untracked files.

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

# The workspace units, read once. The files: tracked and untracked alike (this grader runs before
# the story's commit, so a new test file outside every unit must count before it is committed).
pnpm ls -r --depth -1 --json >"$TMP/units.json" 2>/dev/null || echo "[]" >"$TMP/units.json"
git -c core.quotePath=false ls-files --cached --others --exclude-standard | sort -u >"$TMP/files.txt"
git show "$BASE:package.json" >/dev/null 2>&1 || bad 7 "base commit $BASE is not in this clone"
mkdir -p "$TMP/base"
git ls-tree -r --name-only "$BASE" | grep -E '(^|/)vitest\.config\.[^/]+$' | while IFS= read -r f; do
  mkdir -p "$TMP/base/$(dirname "$f")"
  git show "$BASE:$f" >"$TMP/base/$f"
done

# The Node checks are written to a file and run twice: first to read the task list the entry point
# runs (its `turbo run` lines, printed as TASKS), so Turborepo's dry run covers exactly that list,
# then for real with the dry run in hand.
cat >"$TMP/checks.mjs" <<'JS'
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { createRequire } from "node:module";

const [ROOT, TMP] = process.argv.slice(2);
const require = createRequire(join(ROOT, "package.json"));
const YAML = require("yaml");
const bad = (id, why) => console.log(`BAD ${id} ${why}`);
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const tryRead = (p) => { try { return read(p); } catch { return ""; } };
const tryReadTmp = (p) => { try { return readFileSync(join(TMP, p), "utf8"); } catch { return ""; } };
// turbo.json carries comments; strip whole-line // comments before parsing.
const jsonc = (s) => JSON.parse(s.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n"));

// --- Check 1: the ADR ---
const arch = tryRead("docs/v3/ARCHITECTURE.md");
const adrs = [...arch.matchAll(/^### (ADR-(\d+)) — (.*)$/gm)].map((m) => ({ id: m[1], n: Number(m[2]), title: m[3], at: m.index }));
const adr = adrs.find((a) => /build/i.test(a.title) && /check/i.test(a.title));
let adrText = "";
const setting = (name) => (adrText.match(new RegExp(`^- ${name}: (.+)$`, "m"))?.[1] ?? "").trim();
const code = (s) => s.match(/`([^`]+)`/)?.[1] ?? "";
const codes = (s) => [...s.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
// Code lines only: a shell `#` or JS `//` comment line can't satisfy a check that a script does something.
const codeLines = (s) => s.split("\n").filter((l) => !/^\s*(#|\/\/)/.test(l)).join("\n");
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// The finishing gate's modes (ADR-030 rule 8's three options) and the phrase a doc must use for each.
// `need` all match the doc's line, `not` none (so "full graph fresh, no cache read" can't pass as full-cached).
const MODES = {
	full: { need: [/full/i, /fresh|no cache/i], not: [/cached|replay/i] },
	"full-cached": { need: [/full/i, /replay|cached/i], not: [/fresh|no cache/i] },
	narrowed: { need: [/narrow/i], not: [] },
};
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
	for (const s of ["Entry point", "Full-run switch", "Base branch", "Law-test unit", "Finishing gate", "Concurrency", "Toolchain files"]) if (!setting(s)) bad(1, `${adr.id} has no "- ${s}:" setting line`);
	if (/owner's answer is recorded here when given/.test(setting("Finishing gate"))) bad(1, `${adr.id}'s finishing gate still awaits the owner's answer`);
	if (!(code(setting("Finishing gate")) in MODES)) bad(1, `${adr.id}'s finishing gate names no mode (\`${Object.keys(MODES).join("`, `")}\`)`);
}
const story = existsSync(join(TMP, "story.md")) ? readFileSync(join(TMP, "story.md"), "utf8") : "";
// Only a line that starts with the label is the note (AC 1's own text mentions both labels mid-line).
const quoted = (label) => [...story.matchAll(new RegExp(`^\\*\\*${label}:\\*\\*(.*)$`, "gm"))].some((m) => /"[^"]+"|“[^”]+”/.test(m[1]));
if (!quoted("ADR acceptance")) bad(1, "S168's text has no **ADR acceptance:** line quoting the owner");
if (!quoted("Finishing gate")) bad(1, "S168's text has no **Finishing gate:** line quoting the owner");

const ENTRY = code(setting("Entry point")) || "pnpm verify";
const FULL = code(setting("Full-run switch"));
const BASE_BRANCH = code(setting("Base branch")) || "stage";
const LAWUNIT = code(setting("Law-test unit"));
const MODE = code(setting("Finishing gate"));
const TOOLCHAIN = codes(setting("Toolchain files"));

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
const entryOnly = new Set(reached);
// A script's text plus the scripts/ files it calls, transitively, as code lines.
const withFiles = (text) =>
{
	const seen = new Set();
	let all = codeLines(text);
	for (let todo = [...all.matchAll(/(scripts\/[\w./-]+\.(?:sh|ts|mjs))/g)].map((m) => m[1]); todo.length;)
	{
		const f = todo.pop();
		if (seen.has(f)) continue;
		seen.add(f);
		const t = codeLines(tryRead(f));
		all += "\n" + t;
		todo.push(...[...t.matchAll(/(scripts\/[\w./-]+\.(?:sh|ts|mjs))/g)].map((m) => m[1]));
	}
	return all;
};
const entryOwn = withFiles([...entryOnly].map((n) => rootScripts[n]).join("\n"));
// The tasks the entry point runs: the union of the task names on every `turbo run` line it reaches
// (ADR-030 rule 7 writes them out; a line continued with `\` counts as one), up to the first flag.
const turboTasks = [...new Set([...entryOwn.replace(/\\\n/g, " ").matchAll(/turbo run ([^\n;&|"]*)/g)].flatMap((m) =>
{
	const out = [];
	for (const w of m[1].trim().split(/\s+/)) { if (w.startsWith("-")) break; if (/^[a-z][\w:-]*$/.test(w)) out.push(w); }
	return out;
}))];
const nonPersistent = [...new Set(Object.entries(tasks).filter(([, t]) => !t?.persistent).map(([k]) => k.replace(/^.*#/, "")))];
if (turboTasks.length === 0) bad(5, `the entry point (${ENTRY}) runs no Turborepo task list (no \`turbo run <tasks>\` line)`);
const TASKS = turboTasks.length ? turboTasks : nonPersistent;
console.log(`TASKS ${TASKS.join(" ")}`);
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
if (dtasks.length === 0) bad(3, `Turborepo's dry run of ${TASKS.join("/") || "the entry point's tasks"} gave no tasks (${tryReadTmp("dry.err").split("\n").find(Boolean) ?? "no error"})`);
const pkgOf = (id) => id.slice(0, id.lastIndexOf("#"));
const tOf = (id) => id.slice(id.lastIndexOf("#") + 1);
const isRoot = (x) => x.startsWith("//#");
const byId = new Map(dtasks.map((t) => [t.taskId, t]));
for (const t of dtasks)
{
	for (const d of t.dependencies ?? [])
	{
		if (isRoot(t.taskId) !== isRoot(d)) { bad(3, `${t.taskId} → ${d} joins a root task and a unit task`); continue; }
		if (pkgOf(d) === pkgOf(t.taskId)) continue;
		if (["test", "lint", "test:coverage"].includes(tOf(d))) bad(3, `${t.taskId} depends on another unit's ${tOf(d)} (${d})`);
		else if (!["build", "typecheck"].includes(tOf(d))) bad(3, `${t.taskId} depends on ${d}, not a dependency's build or typecheck`);
	}
	// Paths, not only edges: a same-unit edge (say typecheck → its own test) can carry another unit's
	// task to it, and a path through a root task joins the two kinds as an edge would. The direct
	// edges are reported above; this reports what is reached through one.
	const seen = new Set();
	const stack = (t.dependencies ?? []).flatMap((first) => (byId.get(first)?.dependencies ?? []).map((d) => [d, first]));
	while (stack.length)
	{
		const [d, via] = stack.pop();
		if (seen.has(d)) continue;
		seen.add(d);
		if (isRoot(t.taskId) !== isRoot(d)) bad(3, `${t.taskId} reaches ${d} through ${via}, joining a root task and a unit task`);
		else if (!isRoot(d) && pkgOf(d) !== pkgOf(t.taskId) && ["test", "test:coverage", "lint", "typecheck"].includes(tOf(t.taskId)) && ["test", "test:coverage", "lint"].includes(tOf(d))) bad(3, `${t.taskId} reaches ${d} through ${via}`);
		for (const e of byId.get(d)?.dependencies ?? []) stack.push([e, via]);
	}
}
const graphIds = new Set(dtasks.map((t) => t.taskId));
for (const k of Object.keys(tasks)) if (isRoot(k) && TASKS.includes(k.slice(3)) && dtasks.length && !graphIds.has(k)) bad(3, `root task ${k} is in the entry point's list but not in the dry run`);

// --- Check 4: inputs ---
if (TOOLCHAIN.length === 0) bad(4, "ADR-030 lists no toolchain files, so globalDependencies can't be checked");
for (const g of turbo.globalDependencies ?? []) if (!TOOLCHAIN.includes(g)) bad(4, `globalDependencies holds ${g}, not a toolchain file`);
for (const n of nonPersistent) if (turboTasks.length && !turboTasks.includes(n)) bad(4, `turbo.json task ${n} is not one the entry point runs (a convenience is a unit script, not a turbo.json task)`);
// An input is the unit's own files ($TURBO_DEFAULT$), a negation, a pattern inside the unit that is
// not the whole unit, or an outside path naming a file or a directory's `/**`. No `.` or `..`
// segment anywhere, so `$TURBO_ROOT$/./**` or `web/../**` can't stand in for a wide glob.
const dotSeg = (p) => p.split("/").some((s) => s === "." || s === "..");
const okInput = (i) =>
{
	if (i === "$TURBO_DEFAULT$" || i.startsWith("!")) return true;
	let rest;
	if (i.startsWith("$TURBO_ROOT$/")) rest = i.slice("$TURBO_ROOT$/".length);
	else if (/^(\.\.\/)+/.test(i)) rest = i.replace(/^(\.\.\/)+/, "");
	else return !/^[/$]/.test(i) && !dotSeg(i) && !/^(\*\*?)(\/\*\*?)*$/.test(i);
	return rest !== "" && !dotSeg(rest) && /^[^*?[\]{}!]+(\/\*\*(\/\*)?)?$/.test(rest);
};
for (const [name, t] of Object.entries(tasks))
{
	if (t?.persistent) continue;
	if (!Array.isArray(t.inputs)) { bad(4, `task ${name} declares no inputs`); continue; }
	for (const i of t.inputs) if (!okInput(i)) bad(4, `task ${name}'s input ${i} reaches wider than its unit plus named paths`);
}

// --- Check 5: the entry point and the ledger record ---
const entryAll = withFiles([...reached].map((n) => rootScripts[n]).join("\n"));
const FULLVAR = FULL.split("=")[0];
if (!new RegExp(`merge-base[^\\n]*${BASE_BRANCH}|${BASE_BRANCH}[^\\n]*merge-base|TURBO_SCM_BASE`).test(entryAll)) bad(5, `the entry point (${ENTRY}) does not compare against the merge base with ${BASE_BRANCH}`);
if (!/ls-files --others --exclude-standard/.test(entryAll)) bad(5, "the entry point does not count untracked files");
if (!FULL || !entryAll.includes(FULLVAR)) bad(5, `the entry point does not honour the full-run switch (${FULL || "none named"})`);
// The fresh-run flag must go with the switch, in the branch that runs when it is on: R1's no-unit
// branch also passes a write-only cache, so a flag elsewhere proves nothing. A test of the switch is
// positive (`= 1`, `== 1`, `-eq 1`, `-n`) or negated (`!= 1`, `-z`); the flag counts after `&&` (or
// in an if's then-branch) for a positive test, after `||` (or in its else-branch) for a negated one,
// or inside `${VAR:+…}`. A test of neither kind, or a case statement, proves nothing.
const FRESH = /--force\b|--cache=(?:local|remote):w\b/;
const switchForces = (text) =>
{
	const ls = text.split("\n");
	const sense = (l) => (/!=\s*["']?1\b|-z\s/.test(l) ? "neg" : /(==?|-eq)\s*["']?1\b|-n\s/.test(l) ? "pos" : "");
	return ls.some((l, i) =>
	{
		if (!FULLVAR || !l.includes(FULLVAR)) return false;
		if (new RegExp(`\\$\\{${reEsc(FULLVAR)}:\\+[^}]*(--force\\b|--cache=(local|remote):w\\b)`).test(l)) return true;
		const sn = sense(l);
		if (!sn) return false;
		if (/(^|[\s;])if\b/.test(l))
		{
			const then = [], other = [];
			let inElse = false, depth = 0;
			for (let j = i + 1; j < ls.length; j++)
			{
				const t = ls[j];
				if (/^\s*if\b/.test(t)) depth++;
				if (/^\s*fi\b/.test(t)) { if (depth === 0) break; depth--; }
				if (depth === 0 && /^\s*(else|elif)\b/.test(t)) { inElse = true; continue; }
				(inElse ? other : then).push(t);
			}
			return (sn === "pos" ? then : other).some((t) => FRESH.test(t));
		}
		const m = l.match(/&&(.*?)(\|\|(.*))?$/);
		if (!m) return false;
		return FRESH.test(sn === "pos" ? m[1] : (m[3] ?? ""));
	});
};
if (!switchForces(entryAll)) bad(5, "the full-run switch does not force a fresh run (--force or a write-only --cache=local:w)");
if (!/--concurrency/.test(entryAll)) bad(5, "the entry point sets no Turborepo concurrency");
const lawPkg = units.find((u) => u.dir === LAWUNIT)?.name ?? "";
const lawFilter = lawPkg && new RegExp(`--filter[= ]['"]?(${reEsc(lawPkg)}|\\./${reEsc(LAWUNIT)})['"]?(\\s|$)|${reEsc(lawPkg)}#test\\b`);
if (!lawFilter || !lawFilter.test(entryAll)) bad(5, `the entry point does not run the law-test unit (${lawPkg || LAWUNIT || "none named"}) for a file outside every unit and input`);
const audit = codeLines(tryRead("scripts/audit.sh"));
if (!/--summarize|runs\/.*\.json/.test(audit) || !/replayed/i.test(audit) || !/not affected/i.test(audit)) bad(5, "scripts/audit.sh story does not record the tasks that ran, replayed and were not affected");
const auditLines = audit.split("\n");
const verifyLines = auditLines.filter((l) => /pnpm verify\b/.test(l));
const reverifyFull = FULLVAR && (auditLines.some((l) => l.includes(FULLVAR) && /reverify|LABEL/.test(l)) || (MODE === "full" && verifyLines.length > 0 && verifyLines.every((l) => l.includes(FULLVAR))));
if (!reverifyFull) bad(5, `scripts/audit.sh story --reverify does not set ${FULLVAR || "the full-run switch"}`);

// --- Check 6: CI ---
const ci = wf[".github/workflows/ci.yml"] ?? {};
const deploy = wf[".github/workflows/deploy.yml"] ?? {};
const stepsOf = (doc, job) => doc?.jobs?.[job]?.steps ?? [];
const runOf = (s) => codeLines(String(s?.run ?? ""));
const verifySteps = stepsOf(ci, "verify").filter((s) => runOf(s).includes(ENTRY));
const fullStep = (s) => FULL && (runOf(s).includes(FULL) || JSON.stringify(s?.env ?? {}).includes(FULLVAR));
const readsCache = (s, job) => /BT_TURBO_CACHE_READ/.test(JSON.stringify(s?.env ?? {}) + JSON.stringify(job?.env ?? {}) + runOf(s));
const prStep = verifySteps.find((s) => /pull_request/.test(String(s?.if ?? "")) && !/!=\s*'pull_request'/.test(String(s?.if ?? "")));
const pushStep = verifySteps.find((s) => /!=\s*'pull_request'|push/.test(String(s?.if ?? "")));
if (!prStep) bad(6, `ci.yml's verify job has no pull-request step calling ${ENTRY}`);
if (!pushStep || !fullStep(pushStep)) bad(6, `ci.yml's push verify step does not force the full run (${FULL || "no switch named"})`);
if (pushStep && readsCache(pushStep, ci.jobs?.verify)) bad(6, "ci.yml's push verify step reads the cache");
const dv = stepsOf(deploy, "verify").filter((s) => runOf(s).includes(ENTRY));
if (dv.length === 0 || !dv.every(fullStep)) bad(6, "Deploy's verify job does not force the full run on every event it runs the gate for");
if (dv.some((s) => readsCache(s, deploy.jobs?.verify))) bad(6, "Deploy's verify job reads the cache");
for (const ev of ["push", "release", "workflow_dispatch"]) if (!(ev in (deploy.on ?? {}))) bad(6, `Deploy no longer runs on ${ev}, so its gate can't run for it`);
for (const [job, j] of Object.entries(ci.jobs ?? {})) if (/shard/.test(job)) for (const s of j.steps ?? []) if (/vitest/.test(runOf(s)) && !/--merge-reports/.test(runOf(s))) bad(6, `${job} calls vitest instead of the unit's test task`);
if (!ci.jobs?.["ci-passed"]) bad(6, "ci.yml has no ci-passed aggregate job");

// --- Check 7: laws and floors ---
const laws = tryRead("docs/v3/LAWS.md").split("\n").filter((l) => /^\| [LP]\d+ \|/.test(l)).map((l) => l.split("|").map((c) => c.trim()));
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
	// The mode ADR-030 records (rule 8), on a line that names the finishing gate, and that stage runs everything.
	const lines = t.split("\n");
	const phrase = MODES[MODE];
	if (!phrase || !lines.some((l) => /finishing gate/i.test(l) && phrase.need.every((re) => re.test(l)) && !phrase.not.some((re) => re.test(l)))) bad(9, `${f} does not say the finishing gate runs ${MODE || "the recorded mode"}`);
	if (!lines.some((l) => /\bstage\b/.test(l) && /runs everything|every task|full graph/i.test(l))) bad(9, `${f} does not say stage runs everything`);
}
JS
echo "{}" >"$TMP/dry.json"
node "$TMP/checks.mjs" "$ROOT" "$TMP" >"$TMP/tasks.out" 2>/dev/null
read -r -a TASKS <<<"$(sed -n 's/^TASKS //p' "$TMP/tasks.out")"
: >"$TMP/dry.err"
if [ "${#TASKS[@]}" -gt 0 ]; then
  pnpm exec turbo run "${TASKS[@]}" --dry=json >"$TMP/dry.json" 2>"$TMP/dry.err" || echo "{}" >"$TMP/dry.json"
fi
node "$TMP/checks.mjs" "$ROOT" "$TMP" >"$TMP/node.out" 2>"$TMP/node.err"
node_exit=$?
# A crash proves none of the checks it holds, so each of them fails, not only check 1.
if [ "$node_exit" -ne 0 ]; then
  for n in 1 2 3 4 5 6 7 8 9; do bad "$n" "the Node checks crashed (exit $node_exit): $(head -c 400 "$TMP/node.err")"; done
fi
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
  # The unit's own Vitest config (scripts' sits in backlog-vault/): run without it, Vitest walks up
  # and finds no project of the unit's, so a startup error would fail checks 7 and 8 for the wrong reason.
  law_cfg="$(git ls-files -- "$LAWUNIT" | grep -E '/vitest\.config\.[cm]?[jt]s$' | head -1)"
  law_cfg_args=()
  [ -n "$law_cfg" ] && law_cfg_args=(--config "${law_cfg#"$LAWUNIT"/}")
  if [ "${#law_tests[@]}" -lt 3 ]; then
    bad 7 "the law-test unit lacks verify-chain, ci-law or laws tests"
  elif ! (cd "$LAWUNIT" && pnpm exec vitest run "${law_cfg_args[@]}" "${law_tests[@]}" >"$TMP/law.log" 2>&1); then
    bad 7 "the law tests fail: $(grep -m1 -E 'FAIL|Error' "$TMP/law.log")"
  fi
  if [ -n "$LEAFTEST" ] && ! (cd "$LAWUNIT" && pnpm exec vitest run "${law_cfg_args[@]}" "${LEAFTEST#"$LAWUNIT"/}" >"$TMP/leaf.log" 2>&1); then
    bad 8 "the leaf-unit test fails: $(grep -m1 -E 'FAIL|Error' "$TMP/leaf.log")"
  fi
fi

# --- Checks 4 and 5, dynamic parts (added under rule 7 after ADR-030's acceptance, 2026-11-26; each
# only adds failures). Every run happens in a copy under $TMP with its own .git, never in this tree.
# AC 4's isolated runs execute every unit's lint and test, so this grader runs for minutes, past the
# Verify-script contract's 60 s: the AC asks for those runs and the AC outranks the contract's budget.
TURBO="$ROOT/node_modules/.bin/turbo"
read -r -a TOOLCHAIN <<<"$(node -e 'const t=JSON.parse(require("fs").readFileSync("turbo.json","utf8").replace(/^\s*\/\/.*$/gm,""));console.log((t.globalDependencies||[]).join(" "))')"
pnpm ls -r --depth -1 --json 2>/dev/null | node -e 'const r=require("path").relative;const j=JSON.parse(require("fs").readFileSync(0,"utf8"));const m={};for(const p of j){const d=r(process.argv[1],p.path);if(d)m[p.name]=d;}require("fs").writeFileSync(process.argv[2],JSON.stringify(m))' "$ROOT" "$TMP/units.json"
UNIT_DIRS="$(node -e 'console.log(Object.values(require(process.argv[1])).join(" "))' "$TMP/units.json")"
GLOBJS='const glob=(p)=>new RegExp("^"+p.replace(/[.+^${}()|[\]\\]/g,"\\$&").replace(/\*\*/g,"\u0000").replace(/\*/g,"[^/]*").replace(/\u0000/g,".*")+"$");'
# A full copy of the tracked and untracked (not ignored) files, pnpm's links kept, committed on `stage`.
# The root node_modules is a symlink in a copy, which .gitignore's `node_modules/` doesn't match, so
# .git/info/exclude keeps it out of the copy's commit, as the real tree's ignored directory is.
full_copy()
{
  local d="$1"; mkdir -p "$d"
  git ls-files -co --exclude-standard -z | tar --null -T - -cf - 2>/dev/null | tar -xf - -C "$d"
  ln -s "$ROOT/node_modules" "$d/node_modules"
  for u in $UNIT_DIRS; do [ -d "$ROOT/$u/node_modules" ] && cp -a "$ROOT/$u/node_modules" "$d/$u/"; done
  (cd "$d" && git init -q -b stage && printf "/node_modules\n" >>.git/info/exclude && git add -A && git -c user.email=g@t -c user.name=g commit -qm base --no-verify)
}
# taskId<TAB>hash<TAB>dependents for one dry run of every task the entry point runs.
dry_hashes()
{
  (cd "$1" && "$TURBO" run "${TASKS[@]}" --dry=json 2>/dev/null) | node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8"));for(const t of j.tasks)if(t.command!=="<NONEXISTENT>")console.log([t.taskId,t.hash,(t.dependents||[]).join(",")].join("\t"))'
}
if [ "${#TASKS[@]}" -gt 0 ] && [ -x "$TURBO" ]; then
  C="$TMP/copy"; full_copy "$C"
  dry_hashes "$C" >"$TMP/h0.tsv"
  [ -s "$TMP/h0.tsv" ] || bad 4 "the dry run in the copy gave no task hashes"
  # The global list is narrow: one file under each named outside input; a task that neither declares
  # it (among its inputs, or as its own unit's file) nor depends on one that does keeps its hash.
  node -e "$GLOBJS"'
const fs=require("fs"),cp=require("child_process");const C=process.argv[1];
const t=JSON.parse(fs.readFileSync(C+"/turbo.json","utf8").replace(/^\s*\/\/.*$/gm,""));
const files=cp.execSync("git -c core.quotePath=false ls-files",{cwd:C,encoding:"utf8"}).split("\n").filter(Boolean);
const seen=new Set();
for(const task of Object.values(t.tasks))for(const i of task.inputs??[]){
 if(!i.startsWith("$TURBO_ROOT$/")||seen.has(i))continue;seen.add(i);
 const re=glob(i.slice(13));const f=files.find((x)=>re.test(x)&&!(t.globalDependencies??[]).includes(x));if(f)console.log(f);}' "$C" | sort -u >"$TMP/probes.txt"
  while IFS= read -r f; do
    printf '\n' >>"$C/$f"
    dry_hashes "$C" >"$TMP/h1.tsv"
    (cd "$C" && git checkout -q -- "$f")
    moved="$(node -e "$GLOBJS"'
const fs=require("fs");const [C,f,a,b,uj]=process.argv.slice(1);
const t=JSON.parse(fs.readFileSync(C+"/turbo.json","utf8").replace(/^\s*\/\/.*$/gm,""));
const units=JSON.parse(fs.readFileSync(uj,"utf8"));
const rows=(p)=>new Map(fs.readFileSync(p,"utf8").split("\n").filter(Boolean).map((l)=>{const [id,h,d]=l.split("\t");return [id,{h,d:d?d.split(","):[]}];}));
const h0=rows(a),h1=rows(b);
const declares=(id)=>{const k=id.lastIndexOf("#");const pkg=id.slice(0,k),name=id.slice(k+1);
 const cfg=t.tasks[id]??t.tasks[name]??{};const dir=units[pkg];
 if(dir&&f.startsWith(dir+"/"))return true;
 return (cfg.inputs??[]).some((i)=>i.startsWith("$TURBO_ROOT$/")&&glob(i.slice(13)).test(f));};
const hit=new Set([...h0.keys()].filter(declares));const q=[...hit];
while(q.length){const id=q.pop();for(const d of h0.get(id)?.d??[])if(!hit.has(d)){hit.add(d);q.push(d);}}
console.log([...h0].filter(([id,{h}])=>!hit.has(id)&&h1.get(id)?.h!==h).map(([id])=>id).join(" "));' "$C" "$f" "$TMP/h0.tsv" "$TMP/h1.tsv" "$TMP/units.json")"
    [ -z "$moved" ] || bad 4 "an edit to $f changed the hash of tasks that neither declare it nor depend on one that does: $moved"
  done <"$TMP/probes.txt"
  [ -s "$TMP/probes.txt" ] || bad 4 "no named outside input matched a tracked file to probe"
  # A toolchain edit changes every task's hash.
  for f in "${TOOLCHAIN[@]}"; do
    [ -f "$C/$f" ] || { bad 4 "the toolchain file $f is missing"; continue; }
    printf '\n' >>"$C/$f"
    dry_hashes "$C" >"$TMP/h1.tsv"
    (cd "$C" && git checkout -q -- "$f")
    same="$(join -t "$(printf '\t')" <(cut -f1,2 "$TMP/h0.tsv" | sort) <(cut -f1,2 "$TMP/h1.tsv" | sort) | awk -F'\t' '$2==$3 {print $1}' | head -3 | tr '\n' ' ')"
    [ -z "$same" ] || bad 4 "an edit to the toolchain file $f left these tasks' hashes unchanged: $same"
  done

  # AC 5: the entry point's plan against a temporary base (the copy's `stage`), on a `work` branch.
  (cd "$C" && git checkout -qb work)
  vplan() { (cd "$C" && BT_VERIFY_BASE=stage node scripts/verify-plan.ts 2>/dev/null); }
  [ "$(vplan | sed -n 's/^mode //p')" = "none" ] || bad 5 "with no change the entry point does not run nothing"
  printf '\n' >>"$C/${TOOLCHAIN[0]}"
  [ "$(vplan | sed -n 's/^mode //p')" = "all" ] || bad 5 "a toolchain change does not run everything"
  (cd "$C" && git checkout -q -- "${TOOLCHAIN[0]}")
  leaf_u="$(cut -d' ' -f1 <<<"$UNIT_DIRS")"
  leaf_name="$(node -p "require('$C/$leaf_u/package.json').name")"
  leaf_f="$(cd "$C" && git ls-files -- "$leaf_u" | grep -E '\.ts$' | grep -v '\.test\.' | head -1)"
  plan_has_unit()
  {
    local out filters
    out="$(vplan)"; [ "$(sed -n 's/^mode //p' <<<"$out")" = "narrow" ] || return 1
    read -r -a filters <<<"$(sed -n 's/^filters //p' <<<"$out")"
    (cd "$C" && "$TURBO" run "${TASKS[@]}" "${filters[@]}" --dry=json 2>/dev/null) | node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8"));const n=process.argv[1];process.exit(j.tasks.some(t=>t.package===n&&t.command!=="<NONEXISTENT>")?0:1)' "$leaf_name"
  }
  printf '\n' >>"$C/$leaf_f"
  plan_has_unit || bad 5 "an uncommitted change to $leaf_f does not run $leaf_name's tasks"
  (cd "$C" && git checkout -q -- "$leaf_f")
  printf 'export {};\n' >"$C/$leaf_u/zz-s168-untracked.ts"
  plan_has_unit || bad 5 "an untracked file in $leaf_u does not run $leaf_name's tasks"
  rm -f "${C:?}/${leaf_u:?}/zz-s168-untracked.ts"
  # The ledger-writing step (scripts/verify-record.ts, which audit.sh story calls) writes the three
  # lists from a fixture story's run summary: one task ran, one replayed, the rest not affected.
  mkdir -p "$C/.turbo/runs"
  (cd "$C" && "$TURBO" run "${TASKS[@]}" --dry=json 2>/dev/null) >"$TMP/graph.json"
  node -e 'const fs=require("fs");const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));const ts=j.tasks.filter(t=>t.command!=="<NONEXISTENT>");fs.writeFileSync(process.argv[2],JSON.stringify({tasks:[{...ts[0],execution:{exitCode:0},cache:{status:"MISS"}},{...ts[1],execution:{exitCode:0},cache:{status:"HIT"}}]}))' "$TMP/graph.json" "$C/.turbo/runs/fixture-S9999.json"
  rows="$(cd "$C" && node scripts/verify-record.ts --root "$C" --graph "$TMP/graph.json" 2>&1)"
  for l in "tasks that ran" "replayed from the cache" "not affected"; do
    grep -qE "Gate: $l \| [^|]*[a-z]" <<<"$rows" || bad 5 "the ledger rows lack a filled '$l' list: $(head -c 300 <<<"$rows")"
  done

  # AC 4: an undeclared read fails. Each unit's test and lint, in a copy holding only that unit, its
  # tasks' declared inputs, the toolchain files, each workspace dependency's package.json and what its
  # typecheck reads (ADR-030: a source-only dependency's output is its source, reached via ^typecheck),
  # the installed dependencies with pnpm's links, and a .git with those files committed.
  for u in $UNIT_DIRS; do
    I="$TMP/iso-${u//\//-}"; mkdir -p "$I"
    node -e "$GLOBJS"'
const fs=require("fs"),cp=require("child_process");const [R,u,uj]=process.argv.slice(1);
const t=JSON.parse(fs.readFileSync(R+"/turbo.json","utf8").replace(/^\s*\/\/.*$/gm,""));
// quotePath off: a quoted name (a frame note with an em dash) would match no file and drop out of the copy.
const files=cp.execSync("git -c core.quotePath=false ls-files -co --exclude-standard",{cwd:R,encoding:"utf8"}).split("\n").filter(Boolean);
const pkg=JSON.parse(fs.readFileSync(R+"/"+u+"/package.json","utf8"));const dirOf=JSON.parse(fs.readFileSync(uj,"utf8"));
const keep=new Set([...(t.globalDependencies??[]),"pnpm-workspace.yaml"]);
const under=(d)=>files.filter((f)=>f.startsWith(d+"/"));
for(const f of under(u))keep.add(f);
for(const name of ["test","lint"])for(const i of (t.tasks[pkg.name+"#"+name]??t.tasks[name]??{}).inputs??[])
 if(i.startsWith("$TURBO_ROOT$/"))for(const f of files.filter((x)=>glob(i.slice(13)).test(x)))keep.add(f);
const deps=[pkg.name];
for(let k=0;k<deps.length;k++){const p=JSON.parse(fs.readFileSync(R+"/"+(dirOf[deps[k]]??u)+"/package.json","utf8"));
 for(const [n,v] of Object.entries({...p.dependencies,...p.devDependencies}))if(String(v).startsWith("workspace:")&&!deps.includes(n))deps.push(n);}
for(const n of deps.slice(1))for(const f of under(dirOf[n]))keep.add(f);
for(const f of keep)console.log(f);' "$ROOT" "$u" "$TMP/units.json" >"$TMP/iso.list"
    (cd "$ROOT" && tar -cf - -T "$TMP/iso.list" 2>/dev/null) | tar -xf - -C "$I"
    ln -s "$ROOT/node_modules" "$I/node_modules"
    for d in $UNIT_DIRS; do [ -d "$I/$d" ] && [ -d "$ROOT/$d/node_modules" ] && cp -a "$ROOT/$d/node_modules" "$I/$d/"; done
    (cd "$I" && git init -q -b stage && printf "/node_modules\n" >>.git/info/exclude && git add -A && git -c user.email=g@t -c user.name=g commit -qm iso --no-verify)
    for task in lint test; do
      node -e 'process.exit(require(process.argv[1]).scripts?.[process.argv[2]]?0:1)' "$I/$u/package.json" "$task" || continue
      (cd "$I/$u" && BT_VERIFY_BASE=stage pnpm run "$task" >"$TMP/iso-$task.log" 2>&1) || bad 4 "$u's $task fails in a copy holding only its declared inputs: $(grep -m1 -E 'Error|FAIL|ENOENT|error' "$TMP/iso-$task.log" | head -c 300)"
    done
    rm -rf "${I:?}"
  done
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
