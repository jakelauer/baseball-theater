#!/usr/bin/env bash
# Grader for backlog story S156 — parallel backlog work, Phases 0–3: worktrees that don't see each
# other, a grader that holds nothing, rules frozen during a run, a merge train, merge-safe records
# (ledger and changelog fragments, a generated As of line, INDEX.md and audit.jsonl built rather
# than committed, BACKLOG.md retired), own-commit diff helpers, an overseer that schedules while
# workers claim, reviews beside in-flight work, one digest for the owner and a spend guard
# (owner, 2026-11-20: "Phases 0–3"; "I want this to be implemented ASAP. Ideally as one change.").
# Contract: frame note 00, "Verify-script contract" (docs/v3/backlog/frame/).
# No network. No writes outside /tmp: every behavioural check runs in a snapshot of the working
# tree (tracked and untracked files, as they are on disk) committed into a throwaway repository
# under /tmp, or in a `git clone --local` of it; node_modules are symlinked in, never installed.
# Does its own checking (never `pnpm verify`); runs `pnpm test:backlog` once (AC 9 names it) and
# reads each named test file's result from its JSON report.

set -uo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "W1: .claude/worktrees/ ignored by the committed .gitignore and by ESLint; scripts/worktree-for.sh makes two worktrees on new branches from origin/stage with distinct, stable .env.worktree ports and Compose project names; dev, Vite, Playwright, compose.yaml and local.ts read their ports from the environment with today's defaults; no fixed listening port under functions/src/test/ or in any vitest*.config.ts; the note records two simultaneous pnpm verify runs with both exit codes"
check 2 "W2: is_reviewer_path is false for graders and true for what it covers today; a mode function takes the record, the files and the rule files; test_plan_review.py passes (unchanged for grader-only, incremental for checks.sh); CLAUDE.md's stacking hold and run-backlog step 3 except graders; law L12's grader-ci-law.test.ts passes on the tree and fails on a workflow naming a grader or checks.sh"
check 3 "W5: CLAUDE.md, run-backlog's SKILL.md and LOOP.md §7 step 5 gather RULE_FILES edits into one rules pull request per wave boundary"
check 4 "W10: run-backlog's SKILL.md gives the merge train in order (priority order, one at a time, merge origin/stage --no-ff, never rebase or force-push, pnpm backlog:build, pnpm backlog:check, push, CI and review, merge; no local pnpm verify, CI's verify of the merge ref instead; cancelled staging deploy re-run)"
check 5 "W3: audit.sh writes story/skip/review entries to new docs/v3/audit/<date>/<stamp>-<ID>-<kind>.md fragments, AUDIT.md byte-identical; AUDIT.md gains only a frozen header line; ledger.ts parses the base AUDIT.md exactly as the base parser does, and the tests pin that parse and AUDIT.md's SHA-256 without git history; shipping_commit agrees with the base for S84 S88 S121 S141 S147 and finds a fragment's commit; audit.jsonl and the debt counters read the fragments"
check 6 "W4: changelog:build over three fixture fragments gives newest-first order grouped by effort and keeps every line of the base CHANGELOG.md; backlog:check fails on a fixture done story with no changelog fragment; changelog.d/S156.md exists; rule 16 and CLAUDE.md say so and the release step runs changelog:build"
check 7 "W6: the As of line is built into INDEX.md from the newest completion's **Baseline:** line; frame 01 holds no hand-written As of line; 06 Baseline history is frozen; backlog:check fails on a fixture done story with no **Baseline:** line; this note has one; rule 17 and LOOP.md item 27 say so"
check 8 "W8a: INDEX.md and audit.jsonl untracked and ignored; post-checkout and post-merge hooks run pnpm backlog:build; backlog:check passes in a throwaway clone without them; CLAUDE.md says to build INDEX.md when it is missing"
check 9 "W8b: docs/v3/BACKLOG.md is gone and nothing outside graders, ledgers, frozen histories, this note and 'retired' lines names it; pnpm test:backlog passes; scripts/goal.sh S156 prints this note's /goal line; L9's row reads as the owner chose"
check 10 "Phase 1 exit: merge-safety.test.ts passes in pnpm test:backlog; LAWS.md lists L12 and L13 as enforced with their files; laws.test.ts passes"
check 11 "W7: story_own_changed_files lists only a branch's own commit's file after a merge, story_changed_files both; story_diff and story_changed_files are byte-for-byte the base commit's"
check 12 "W9: run-backlog's SKILL.md orders eligible set, barrier, coarse fence filter, claim, admission, with concurrency 2 then 3 after two clean runs, never above 3; claims.ts calls is_reviewer_path, lists the hot files, keeps state in a git-ignored .run/; claims.test.ts covers shared symbol, doc line, hot file, barrier and an out-of-claim file; worker agents run one worktree each; CLAUDE.md pushes each item as ready; CLAUDE.md + SKILL.md words don't grow"
check 13 "W11: review-debt.sh and parity-debt.sh take --in-flight and print the in-flight count; review-debt.test.ts covers in-flight items and passes; audit.sh review --in-flight records the IDs in its fragment; claims.test.ts covers a review editing an in-flight note; the SKILL runs reviews beside in-flight items"
check 14 "W12: claims.test.ts covers merging findings and ordering questions by Blocks:; run-backlog's SKILL names 'Shared fixes' and 'Questions blocking more than one item'; the pending SKILL orders by Blocks:"
check 15 "W13: run-backlog's SKILL caps live subagents at C workers (the concurrency, 2 or 3) plus four reviewers, staggered, stops dispatching after a rate-limit error until a retry succeeds, and ends with a budget line (Claude review runs via gh run list --workflow claude-review.yml, local reviewers on Opus and Sonnet)"
check 16 "this note's Status is done (frontmatter status done, the note in docs/v3/backlog/stories/done/)"
check 17 "S156 changed no file outside its fence (plus creating scripts/verify-S156.sh)"

# The commit S156's own changes start from: story/S156's HEAD when this grader was written
# (S156 is stacked on story/S152, so an older base would count S152's files as S156's).
BASE=8051c3b4

TMP="$(mktemp -d /tmp/verify-S156.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT
# Python must not write __pycache__ into the tree (one under scripts/claude-review/ is tracked).
export PYTHONDONTWRITEBYTECODE=1

NOTE=$(ls docs/v3/backlog/stories/*/S156.md 2>/dev/null | head -1)
SKILL=.claude/skills/run-backlog/SKILL.md

# git for the throwaway repositories: a fixed identity, no signing, no hooks of the user's.
tgit() { git -c user.name=verify-S156 -c user.email=verify-S156@invalid -c commit.gpgsign=false -c core.hooksPath=/dev/null -c init.defaultBranch=stage "$@"; }

# Own-commit helpers (AC 11) once they exist; the two-tree ones until then (Work item 0).
own_changed_files() { if declare -F story_own_changed_files >/dev/null; then story_own_changed_files "$@"; else story_changed_files "$@"; fi; }
own_diff() { if declare -F story_own_diff >/dev/null; then story_own_diff "$@"; else story_diff "$@"; fi; }

# A section of a Markdown file: from the first line matching <start> up to (not including) the
# next line matching <stop>.
section() { awk -v s="$2" -v e="$3" 'f && $0 ~ e {exit} $0 ~ s {f=1} f' "$1" 2>/dev/null; }

# in_order <text-file> <regex>… — every regex matches, each after the previous match (case-insensitive).
in_order() {
	node -e '
		const fs = require("fs");
		const t = fs.readFileSync(process.argv[1], "utf8");
		let at = 0;
		for (const r of process.argv.slice(2))
		{
			const m = new RegExp(r, "i").exec(t.slice(at));
			if (!m) { console.log(r); process.exit(1); }
			at += m.index + m[0].length;
		}' "$@"
}

# --- Snapshot of the working tree, committed on `stage` in a throwaway repository -----------
SNAP="$TMP/snap"
mkdir -p "$SNAP"
git -c core.quotepath=false ls-files -z -co --exclude-standard | while IFS= read -r -d '' f; do
	[ -e "$f" ] && printf '%s\0' "$f"
done >"$TMP/files"
tar -cf - --null -T "$TMP/files" 2>/dev/null | tar -xf - -C "$SNAP"
(cd "$SNAP" && tgit init -q && tgit add -A && tgit commit -q -m snapshot) || echo "snapshot repository could not be made"

# clone_snap <dir> — a `git clone --local` of the snapshot with every node_modules symlinked in.
clone_snap() {
	git clone -q --local "$SNAP" "$1" 2>/dev/null || return 1
	(cd "$ROOT" && find . -maxdepth 3 -name node_modules -type d -not -path '*/node_modules/*/*' -prune) | while read -r d; do
		mkdir -p "$1/$(dirname "$d")"
		ln -s "$ROOT/${d#./}" "$1/${d#./}" 2>/dev/null
	done
	return 0
}

# --- pnpm test:backlog, once, with a JSON report ---------------------------------------------
pnpm -s test:backlog --reporter=json --outputFile="$TMP/tb.json" >"$TMP/tb.out" 2>&1
TB_STATUS=$?
# test_passed <file-name> — the named file ran in test:backlog and every test in it passed.
test_passed() {
	node -e '
		const fs = require("fs");
		let r; try { r = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); } catch { console.log("no test:backlog report"); process.exit(1); }
		const f = (r.testResults ?? []).find((t) => t.name.endsWith("/" + process.argv[2]));
		if (!f) { console.log(process.argv[2] + " did not run in pnpm test:backlog"); process.exit(1); }
		if (f.status !== "passed") { console.log(process.argv[2] + " failed in pnpm test:backlog"); process.exit(1); }' "$TMP/tb.json" "$1"
}

# =============================================================================================
# --- Check 1: worktrees don't see each other ------------------------------------------------
# =============================================================================================
node --input-type=module -e '
	import { createRequire } from "node:module";
	const require = createRequire(process.cwd() + "/package.json");
	const { ESLint } = require("eslint");
	const e = new ESLint({ cwd: process.cwd() });
	process.exit((await e.isPathIgnored(".claude/worktrees/x/a.ts")) ? 0 : 1);' 2>/dev/null ||
	bad 1 "ESLint does not ignore .claude/worktrees/x/a.ts"
grep -qE '\*\*/\.claude/worktrees/\*\*' eslint.config.js || bad 1 "eslint.config.js's ignores don't name **/.claude/worktrees/**"
src=$(git check-ignore --no-index -v .claude/worktrees/x/a.ts 2>/dev/null | cut -d: -f1)
[ "$src" = ".gitignore" ] || bad 1 ".claude/worktrees/ is not ignored by the committed .gitignore (matched by: ${src:-nothing})"
git ls-files --error-unmatch .gitignore >/dev/null 2>&1 || bad 1 ".gitignore is not committed"

if [ ! -f scripts/worktree-for.sh ]; then
	bad 1 "scripts/worktree-for.sh is missing"
else
	# The helper runs in a clone of the snapshot (its own copy), with the install-skipping flag
	# `--no-install` given before the item name.
	WT="$TMP/wtclone"
	if clone_snap "$WT"; then
		for item in S9301 S9302; do
			(cd "$WT" && bash scripts/worktree-for.sh --no-install "$item") >"$TMP/wt-$item.out" 2>&1 ||
				bad 1 "worktree-for.sh --no-install $item failed: $(tail -2 "$TMP/wt-$item.out" | tr '\n' ' ')"
			d="$WT/.claude/worktrees/$item"
			if [ ! -f "$d/.env.worktree" ]; then bad 1 "$item: no .claude/worktrees/$item/.env.worktree"; continue; fi
			cp "$d/.env.worktree" "$TMP/env-$item.1"
			[ "$(git -C "$d" rev-parse HEAD 2>/dev/null)" = "$(git -C "$WT" rev-parse origin/stage)" ] || bad 1 "$item: the worktree is not at origin/stage"
			git -C "$d" symbolic-ref -q HEAD >/dev/null || bad 1 "$item: the worktree is not on a branch"
			git -C "$d" check-ignore -q .env.worktree || bad 1 "$item: .env.worktree is not git-ignored"
		done
		b1=$(git -C "$WT/.claude/worktrees/S9301" symbolic-ref -q --short HEAD 2>/dev/null)
		b2=$(git -C "$WT/.claude/worktrees/S9302" symbolic-ref -q --short HEAD 2>/dev/null)
		[ -n "$b1" ] && [ "$b1" = "$b2" ] && bad 1 "both worktrees are on one branch ($b1)"
		for item in S9301 S9302; do
			(cd "$WT" && bash scripts/worktree-for.sh --no-install "$item") >"$TMP/wt-$item.re" 2>&1 || bad 1 "re-running worktree-for.sh --no-install $item failed"
			cmp -s "$TMP/env-$item.1" "$WT/.claude/worktrees/$item/.env.worktree" 2>/dev/null || bad 1 "$item: a re-run gives a different .env.worktree"
		done
		if [ -f "$TMP/env-S9301.1" ] && [ -f "$TMP/env-S9302.1" ]; then
			node -e '
				const fs = require("fs");
				const parse = (p) => Object.fromEntries(fs.readFileSync(p, "utf8").split("\n").map((l) => l.replace(/^export\s+/, "").match(/^([A-Z0-9_]+)=["\x27]?([^"\x27]*)["\x27]?\s*$/)).filter(Boolean).map((m) => [m[1], m[2]]));
				const a = parse(process.argv[1]), b = parse(process.argv[2]);
				const bad = (w) => console.log("BAD " + w);
				const ports = (e) => Object.entries(e).filter(([k, v]) => /PORT/.test(k) && /^\d+$/.test(v));
				for (const [n, e] of [["S9301", a], ["S9302", b]])
				{
					const p = ports(e);
					if (p.length < 3) bad(`${n}: .env.worktree has ${p.length} port variables, not API, web and Postgres`);
					if (new Set(p.map(([, v]) => v)).size !== p.length) bad(`${n}: two of its ports are equal`);
					for (const [k, v] of p) if (["8787", "5173", "5432"].includes(v) || +v < 1024 || +v > 65535) bad(`${n}: ${k}=${v} is a default or invalid port`);
					if (!e.COMPOSE_PROJECT_NAME) bad(`${n}: .env.worktree sets no COMPOSE_PROJECT_NAME`);
				}
				for (const [k, v] of ports(a)) if (b[k] === v) bad(`${k} is ${v} in both worktrees`);
				if (a.COMPOSE_PROJECT_NAME && a.COMPOSE_PROJECT_NAME === b.COMPOSE_PROJECT_NAME) bad("both worktrees share a Compose project name");
				fs.writeFileSync(process.argv[3], Object.keys(a).join("\n") + "\n");' \
				"$TMP/env-S9301.1" "$TMP/env-S9302.1" "$TMP/envkeys" >"$TMP/env.out" 2>&1
			while IFS= read -r l; do case "$l" in "BAD "*) bad 1 "${l#BAD }" ;; esac; done <"$TMP/env.out"
		fi
	else
		bad 1 "could not clone the snapshot for worktree-for.sh"
	fi
fi

# Each port setting reads a variable .env.worktree sets, keeps today's value as the default, and
# no longer hard-wires it. <file> <default> <old literal regex>…
envkeys=$(cat "$TMP/envkeys" 2>/dev/null | tr '\n' '|' | sed 's/|$//')
port_reads_env() {
	local f="$1" def="$2" names
	shift 2
	[ -f "$f" ] || { bad 1 "$f is missing"; return; }
	grep -q "$def" "$f" || bad 1 "$f no longer keeps today's $def as the default"
	for old in "$@"; do grep -qE -e "$old" "$f" && bad 1 "$f still hard-wires $def ($old)"; done
	names=$(grep -oE '(process\.env\.|env\.|env\[["'\'']|\$\{|\$)[A-Z][A-Z0-9_]*' "$f" | sed -E 's/^(process\.env\.|env\.|env\[["'\'']|\$\{|\$)//' | sort -u)
	[ -n "$names" ] || { bad 1 "$f reads no environment variable"; return; }
	if [ -n "$envkeys" ]; then
		printf '%s\n' "$names" | grep -qxE "$envkeys" || bad 1 "$f reads none of the variables .env.worktree sets ($(printf '%s' "$names" | tr '\n' ' '))"
	fi
}
dev=$(node -e 'console.log(require("./functions/package.json").scripts?.dev ?? "")')
printf '%s\n' "$dev" >"$TMP/dev.txt"
printf '%s' "$dev" | grep -qE -- '--port[ =]+"?\$\{[A-Z0-9_]+:-8787\}' || bad 1 "functions/package.json's dev doesn't pass --port \${<VAR>:-8787}"
port_reads_env "$TMP/dev.txt" 8787 '--port 8787'
port_reads_env web/vite.config.ts 5173 'port: *5173\b' 'localhost:8787["`]'
grep -q 8787 web/vite.config.ts || bad 1 "web/vite.config.ts's /api proxy lost today's 8787 default"
port_reads_env e2e/playwright.config.ts 5173 'baseURL: *"http://localhost:5173"' 'url: *"http://localhost:5173"'
port_reads_env compose.yaml 5432 '"5432:5432"'
grep -qE '\$\{[A-Z0-9_]+:-5432\}:5432' compose.yaml || bad 1 "compose.yaml's host port is not \${<VAR>:-5432}"
lcs=$(awk '/export function localConnectionString/{f=1} f{print} f && /^}/{exit}' functions/src/adapters/postgres/local.ts 2>/dev/null)
printf '%s' "$lcs" | grep -q 'process\.env' || bad 1 "localConnectionString doesn't read an override from the environment"
printf '%s' "$lcs" | grep -q 'wrangler.jsonc' || bad 1 "localConnectionString no longer falls back to wrangler.jsonc's value"
fixed=$(grep -rnE '([Pp][Oo][Rr][Tt][A-Za-z_]*["'\'']?[[:space:]]*[:=][[:space:]]*|:)([1-9][0-9]{3,4})\b' functions/src/test/ $(git ls-files -co --exclude-standard | grep -E '(^|/)vitest[^/]*\.config\.[a-z]+$') 2>/dev/null |
	grep -E '[Pp][Oo][Rr][Tt]' | grep -vE '^[^:]+:[0-9]+:[[:space:]]*(//|\*|/\*)' || true)
[ -z "$fixed" ] || bad 1 "a fixed listening port under functions/src/test/ or in a vitest config: $(printf '%s' "$fixed" | head -2 | tr '\n' ' ')"
notes=$(awk '/^\*\*Notes:\*\*/{f=1} /^\*\*Reuse check\*\*/{f=0} f' "$NOTE" 2>/dev/null)
ran=$(printf '%s\n' "$notes" | grep -iE 'pnpm verify' | grep -iE 'worktree' | grep -iE 'at once|simultaneous|same time|in parallel|concurrent' || true)
codes=$(printf '%s\n' "$ran" | grep -oiE 'exit(ed)?( code| status)?( was| of)?[ :=]*`?[0-9]+' | wc -l | tr -d ' ')
[ -n "$ran" ] && [ "$codes" -ge 2 ] || bad 1 "the note's Notes don't record one run of pnpm verify in two worktrees at once with both exit codes"

# =============================================================================================
# --- Check 2: a grader holds nothing --------------------------------------------------------
# =============================================================================================
python3 - "$ROOT/scripts/claude-review/plan-review.py" >"$TMP/py.out" 2>&1 <<'PY' || echo "BAD the plan-review.py probe crashed" >>"$TMP/py.out"
import importlib.util, inspect, sys
spec = importlib.util.spec_from_file_location("plan_review", sys.argv[1])
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
for p in ["scripts/verify-S156.sh", "scripts/verify-B87.sh", "scripts/verify-V3.sh", "scripts/verify-S1.sh"]:
    if m.is_reviewer_path(p):
        print(f"BAD is_reviewer_path({p!r}) is true for a grader")
for p in ["scripts/lib/checks.sh", "scripts/audit.sh", ".github/workflows/ci.yml", "package.json", "web/package.json",
          "scripts/verify-all.sh", "scripts/lib/verify-S1.sh", "scripts/verify-S1.sh.orig", "scripts/claude-review/plan-review.py"]:
    if not m.is_reviewer_path(p):
        print(f"BAD is_reviewer_path({p!r}) is false, but it is reviewer machinery")
found = []
for name, fn in inspect.getmembers(m, inspect.isfunction):
    if fn.__module__ != m.__name__:
        continue
    ps = [p.lower() for p in inspect.signature(fn).parameters]
    if any("record" in p for p in ps) and any(("file" in p or "path" in p) for p in ps if "rule" not in p) and any("rule" in p for p in ps):
        found.append(name)
if not found:
    print("BAD plan-review.py has no function taking the record, the pull request's files and the rule files")
print("MODEFN " + " ".join(found))
PY
while IFS= read -r l; do case "$l" in "BAD "*) bad 2 "${l#BAD }" ;; esac; done <"$TMP/py.out"
modefn=$(grep '^MODEFN ' "$TMP/py.out" | cut -d' ' -f2-)
T=scripts/claude-review/test_plan_review.py
if [ ! -f "$T" ]; then
	bad 2 "$T is missing"
else
	(cd scripts/claude-review && python3 -m unittest -q test_plan_review) >"$TMP/ut.out" 2>&1 || bad 2 "$T fails: $(tail -3 "$TMP/ut.out" | tr '\n' ' ')"
	grep -q 'import unittest\|from unittest' "$T" || bad 2 "$T is not a unittest file"
	grep -qE 'urllib|requests|socket|http\.client|"gh"|'\''gh'\''' "$T" && bad 2 "$T reaches the network or gh"
	grep -q '"unchanged"\|'\''unchanged'\''' "$T" || bad 2 "$T doesn't assert an unchanged mode"
	grep -q '"incremental"\|'\''incremental'\''' "$T" || bad 2 "$T doesn't assert an incremental mode"
	grep -q 'scripts/lib/checks.sh' "$T" || bad 2 "$T has no case changing scripts/lib/checks.sh"
	grep -qE 'scripts/verify-[SBV][0-9]+\.sh' "$T" || bad 2 "$T has no grader-only case"
	used=0
	for fn in $modefn; do grep -qw "$fn" "$T" && used=1; done
	[ "$used" -eq 1 ] || bad 2 "$T doesn't call the mode function (${modefn:-none found})"
fi
stack=$(grep -n 'is_reviewer_path' CLAUDE.md | grep -i 'stack' || true)
[ -n "$stack" ] || bad 2 "CLAUDE.md's stacking hold no longer names is_reviewer_path"
printf '%s' "$stack" | grep -qiE 'grader|verify-' || bad 2 "CLAUDE.md's stacking hold still counts a grader as a reviewer path"
step3=$(section "$SKILL" '^## 3\.' '^## 4\.')
printf '%s\n' "$step3" | grep -iE 'is_reviewer_path|reviewer path' | grep -qiE 'grader|verify-' || bad 2 "run-backlog step 3 doesn't except graders from the reviewer paths"
LAW12=scripts/backlog-vault/grader-ci-law.test.ts
if [ ! -f "$LAW12" ]; then
	bad 2 "$LAW12 is missing"
else
	r=$(test_passed grader-ci-law.test.ts) || bad 2 "$r"
	# The law test must fail on a workflow that names a grader, or checks.sh.
	LC="$TMP/lawclone"
	if clone_snap "$LC"; then
		for token in 'bash scripts/verify-S1.sh' 'run: ./verify-V3.sh' 'source scripts/lib/checks.sh'; do
			mkdir -p "$LC/.github/workflows"
			printf 'name: fixture\non: push\njobs:\n  x:\n    runs-on: ubuntu-latest\n    steps:\n      - run: %s\n' "$token" >"$LC/.github/workflows/zz-fixture.yml"
			if (cd "$LC" && pnpm -s exec vitest run --config scripts/backlog-vault/vitest.config.ts grader-ci-law) >"$TMP/law12.out" 2>&1; then
				bad 2 "grader-ci-law.test.ts passes on a workflow that says '$token'"
			fi
		done
	else
		bad 2 "could not clone the snapshot for the L12 negative case"
	fi
fi

# =============================================================================================
# --- Check 3: rules freeze during a run -----------------------------------------------------
# =============================================================================================
for f in CLAUDE.md "$SKILL"; do
	grep -E 'RULE_FILES' "$f" 2>/dev/null | grep -qiE 'wave boundar' || bad 3 "$f has no rule gathering RULE_FILES edits per wave boundary"
done
step5=$(section docs/v3/LOOP.md '^5\. Wait for Claude' '^(### |## |[0-9]+\. )')
printf '%s' "$step5" | grep -q 'RULE_FILES' && printf '%s' "$step5" | grep -qiE 'wave boundar' ||
	bad 3 "LOOP.md §7 step 5 doesn't gather RULE_FILES edits into one rules pull request per wave boundary"
for f in CLAUDE.md "$SKILL" docs/v3/LOOP.md; do
	grep -iE 'wave boundar' "$f" 2>/dev/null | grep -qiE 'one rules pull request|single rules pull request|one pull request' || bad 3 "$f doesn't say one rules pull request per wave boundary"
done

# =============================================================================================
# --- Check 4: merge train -------------------------------------------------------------------
# =============================================================================================
section "$SKILL" '[Mm]erge train' '^## ' >"$TMP/train.md"
if [ ! -s "$TMP/train.md" ]; then
	bad 4 "run-backlog's SKILL.md has no merge train"
else
	# Updated before shipping (rule 7): asked "Cut local pnpm verify runs per backlog item? …", the owner chose
	# "Both (Recommended)" (2026-11-20), so the train checks the merged notes (pnpm backlog:build, then
	# pnpm backlog:check) and relies on CI's verify of the pull request's merge ref instead of a local pnpm verify.
	miss=$(in_order "$TMP/train.md" 'priority order' 'one at a time' 'origin/stage' 'git merge --no-ff' 'pnpm backlog:build' 'pnpm backlog:check' 'push' '\bCI\b' 'review' 'merge') ||
		bad 4 "the merge train's steps are missing or out of order (stuck at: $miss)"
	grep -qiE 'merge ref' "$TMP/train.md" || bad 4 "the merge train doesn't rely on CI's verify of the pull request's merge ref"
	grep -iE 'pnpm verify' "$TMP/train.md" | grep -qviE "no local|never .*locally|not .*locally|CI's" &&
		bad 4 "the merge train still runs pnpm verify locally"
	grep -qiE 'rebase' "$TMP/train.md" && grep -qiE 'force-push' "$TMP/train.md" || bad 4 "the merge train doesn't rule out a rebase and a force-push"
	grep -qiE 'cancel' "$TMP/train.md" && grep -qiE 're-run|rerun' "$TMP/train.md" || bad 4 "the merge train doesn't re-run a cancelled staging deploy"
	grep -qiE 'merge queue' "$TMP/train.md" || bad 4 "the merge train doesn't say why (no merge queue on a user-owned repository)"
fi

# =============================================================================================
# --- Checks 5–8, 13: merge-safe records, in a clone of the snapshot -------------------------
# =============================================================================================
R="$TMP/records"
clone_snap "$R" || { for i in 5 6 7 8 13; do bad "$i" "could not clone the snapshot"; done; }

# Check 8 (first, on the untouched clone): backlog:check needs neither generated file on disk.
rm -f "$R/docs/v3/INDEX.md" "$R/docs/v3/audit.jsonl"
(cd "$R" && pnpm -s backlog:check) >"$TMP/check0.out" 2>&1
CHECK0=$?
[ "$CHECK0" -eq 0 ] || bad 8 "pnpm backlog:check fails in a clone without INDEX.md and audit.jsonl: $(tail -2 "$TMP/check0.out" | tr '\n' ' ')"
for f in docs/v3/INDEX.md docs/v3/audit.jsonl; do
	[ -z "$(git ls-files -- "$f")" ] || bad 8 "$f is still tracked"
	git check-ignore -q --no-index "$f" || bad 8 "$f is not git-ignored"
done
for h in post-checkout post-merge; do
	grep -q 'pnpm backlog:build' ".husky/$h" 2>/dev/null || bad 8 ".husky/$h doesn't run pnpm backlog:build"
done
grep -E 'Read the docs from `?docs/v3/INDEX.md`? down' CLAUDE.md | grep -q 'pnpm backlog:build' &&
	grep -E 'Read the docs from `?docs/v3/INDEX.md`? down' CLAUDE.md | grep -qiE 'missing' ||
	bad 8 "CLAUDE.md's 'Read the docs from docs/v3/INDEX.md down' doesn't say to run pnpm backlog:build when it is missing"

# Check 5, statically: AUDIT.md gains one frozen-history header line and nothing else.
ns=$(own_diff S156 "$BASE" --numstat -- docs/v3/AUDIT.md | awk '{print $1" "$2}')
[ "$ns" = "1 0" ] || bad 5 "docs/v3/AUDIT.md's own diff is '${ns:-none}', not one added line"
own_diff S156 "$BASE" -- docs/v3/AUDIT.md | grep -E '^\+[^+]' | grep -qiE 'frozen' || bad 5 "AUDIT.md's added line doesn't say it is frozen history"

# Check 5: ledger.ts parses the base AUDIT.md exactly as the base parser does.
mkdir -p "$TMP/base-ledger"
git show "$BASE:scripts/backlog-vault/ledger.ts" >"$TMP/base-ledger/ledger.ts"
git show "$BASE:docs/v3/AUDIT.md" >"$TMP/base-AUDIT.md"
node --input-type=module -e '
	import { readFileSync } from "node:fs";
	import { pathToFileURL } from "node:url";
	const [baseParser, nowParser, audit] = process.argv.slice(1);
	const a = await import(pathToFileURL(baseParser).href);
	const b = await import(pathToFileURL(nowParser).href);
	if (typeof b.parseLedger !== "function") { console.log("ledger.ts no longer exports parseLedger"); process.exit(1); }
	const text = readFileSync(audit, "utf8");
	const x = JSON.stringify(a.parseLedger(text)), y = JSON.stringify(b.parseLedger(text));
	if (x !== y) { console.log("ledger.ts parses the base AUDIT.md differently from the base parser"); process.exit(1); }' \
	"$TMP/base-ledger/ledger.ts" "$ROOT/scripts/backlog-vault/ledger.ts" "$TMP/base-AUDIT.md" >"$TMP/parse.out" 2>&1 ||
	bad 5 "$(tail -1 "$TMP/parse.out")"
# Tightened before shipping (rule 7, after the pre-PR review): CI's depth-1 checkout has no base commit to
# `git show`, so the test pins what the base parser gives instead. The parse hash lives in ledger.test.ts (the
# parser's contract) and must equal the base parser's output on today's AUDIT.md, computed here with history; the
# file hash lives in merge-safety.test.ts (law L13: the frozen AUDIT.md never changes) and must equal the file's.
parse_pin=$(grep -oE 'BASE_PARSER_SHA256 = "[0-9a-f]{64}"' scripts/backlog-vault/ledger.test.ts 2>/dev/null | grep -oE '[0-9a-f]{64}')
file_pin=$(grep -oE 'FROZEN_AUDIT_SHA256 = "[0-9a-f]{64}"' scripts/backlog-vault/ledger.ts 2>/dev/null | grep -oE '[0-9a-f]{64}')
base_parse=$(node --input-type=module -e '
	import { readFileSync } from "node:fs";
	import { createHash } from "node:crypto";
	import { pathToFileURL } from "node:url";
	const { parseLedger } = await import(pathToFileURL(process.argv[1]).href);
	process.stdout.write(createHash("sha256").update(JSON.stringify(parseLedger(readFileSync(process.argv[2], "utf8")))).digest("hex"));' \
	"$TMP/base-ledger/ledger.ts" "$ROOT/docs/v3/AUDIT.md" 2>/dev/null)
[ -n "$parse_pin" ] && [ "$parse_pin" = "$base_parse" ] ||
	bad 5 "ledger.test.ts pins no BASE_PARSER_SHA256 equal to the base parser's output on AUDIT.md (${parse_pin:-none} vs ${base_parse:-?})"
[ -n "$file_pin" ] && [ "$file_pin" = "$(shasum -a 256 docs/v3/AUDIT.md | cut -d' ' -f1)" ] ||
	bad 5 "ledger.ts pins no FROZEN_AUDIT_SHA256 equal to docs/v3/AUDIT.md's SHA-256"
grep -q 'FROZEN_AUDIT_SHA256' scripts/backlog-vault/merge-safety.test.ts 2>/dev/null ||
	bad 5 "merge-safety.test.ts (law L13) doesn't assert AUDIT.md's pinned SHA-256"
grep -q 'git", \["show"' scripts/backlog-vault/ledger.test.ts 2>/dev/null &&
	bad 5 "ledger.test.ts still runs git show, which fails in CI's depth-1 checkout"

# Check 5: shipping_commit agrees with the base commit's for five shipped stories.
git show "$BASE:scripts/lib/reverify.sh" >"$TMP/base-reverify.sh"
for s in S84 S88 S121 S141 S147; do
	was=$(source "$TMP/base-reverify.sh" && shipping_commit docs/v3/AUDIT.md "$s")
	now=$(source scripts/lib/reverify.sh && shipping_commit docs/v3/AUDIT.md "$s")
	[ -n "$was" ] && [ "$(git rev-parse "$was" 2>/dev/null)" = "$(git rev-parse "$now" 2>/dev/null)" ] ||
		bad 5 "shipping_commit $s is '${now:-empty}', the base commit's is '${was:-empty}'"
done

# Check 5: in the clone, audit.sh writes a new fragment and leaves AUDIT.md alone.
FIXGRADER='#!/usr/bin/env bash
cd "$(dirname "$0")/.." || exit 1
source scripts/lib/checks.sh
check 1 "fixture"
report "verify-S9001"
exit $?'
if [ -d "$R/.git" ]; then
	cp "$R/docs/v3/AUDIT.md" "$TMP/AUDIT.before"
	printf '%s\n' "$FIXGRADER" >"$R/scripts/verify-S9001.sh" && chmod +x "$R/scripts/verify-S9001.sh"
	# A fixture story copied from S16's note, first as todo, then flipped to done.
	src16=$(ls "$R"/docs/v3/backlog/stories/*/S16.md | head -1)
	mkdir -p "$R/docs/v3/backlog/stories/todo" "$R/docs/v3/backlog/stories/done"
	perl -ne 's/\bS16\b/S9001/g; s/^status: done$/status: todo/; s/^order: .*/order: 9001/; print unless /^\*\*Baseline:\*\*/' "$src16" >"$R/docs/v3/backlog/stories/todo/S9001.md"
	# Embedded beside S16 wherever a frame note embeds it, so the fixture is a normal story.
	grep -rlF '![[S16]]' "$R/docs/v3/backlog/frame/" 2>/dev/null | while IFS= read -r fr; do perl -i -pe 's/^!\[\[S16\]\]$/![[S16]]\n\n![[S9001]]/' "$fr"; done
	(cd "$R" && tgit add -A && tgit commit -q -m "fixture S9001 (todo)")
	sed -E 's/^status: todo$/status: done/' "$R/docs/v3/backlog/stories/todo/S9001.md" >"$R/docs/v3/backlog/stories/done/S9001.md"
	rm "$R/docs/v3/backlog/stories/todo/S9001.md"
	(cd "$R" && tgit add -A && tgit commit -q -m "fixture S9001 done")
	# The debt counters' done count before S9001's completion fragment lands (other stories, S156 among
	# them once it is done, may already count; the fragment must add exactly one).
	count_of() { (cd "$R" && bash "scripts/$1.sh") 2>&1 | grep -oE '\b[0-9]+ of 6\b' | head -1 | cut -d' ' -f1; }
	before_review_debt=$(count_of review-debt)
	before_parity_debt=$(count_of parity-debt)
	(cd "$R" && bash scripts/audit.sh story S9001 --no-verify) >"$TMP/audit-story.out" 2>&1 || bad 5 "audit.sh story S9001 --no-verify failed: $(tail -2 "$TMP/audit-story.out" | tr '\n' ' ')"
	cmp -s "$TMP/AUDIT.before" "$R/docs/v3/AUDIT.md" || bad 5 "audit.sh story changed docs/v3/AUDIT.md"
	frag=$(cd "$R" && git -c core.quotepath=false ls-files --others --exclude-standard -- docs/v3/audit/ 2>/dev/null | grep -E '^docs/v3/audit/[0-9]{4}-[0-9]{2}-[0-9]{2}/[^/]*-S9001-[a-z]+\.md$' || true)
	[ "$(printf '%s' "$frag" | grep -c .)" -eq 1 ] || bad 5 "audit.sh story wrote no docs/v3/audit/<date>/<stamp>-S9001-<kind>.md fragment"
	(cd "$R" && tgit add -A && tgit commit -q -m "S9001 completion")
	fragsha=$(cd "$R" && git rev-parse HEAD)
	got=$(cd "$R" && source scripts/lib/reverify.sh && shipping_commit docs/v3/AUDIT.md S9001)
	[ -n "$got" ] && [ "$(cd "$R" && git rev-parse "$got" 2>/dev/null)" = "$fragsha" ] || bad 5 "shipping_commit S9001 is '${got:-empty}', not the commit that added its fragment"
	# The debt counters see the fragment's completion (AC 13 has them print the done count, due or
	# not): the count rises by exactly one when S9001's fragment lands. (Before shipping, rule 7: it
	# first expected exactly 1, which stopped holding once S156 itself went done in the copied tree.)
	for d in review-debt parity-debt; do
		(cd "$R" && bash "scripts/$d.sh") >"$TMP/$d.out" 2>&1
		after=$(grep -oE '\b[0-9]+ of 6\b' "$TMP/$d.out" | head -1 | cut -d' ' -f1)
		before=$([ "$d" = review-debt ] && echo "$before_review_debt" || echo "$before_parity_debt")
		[ -n "$before" ] && [ -n "$after" ] && [ "$after" -eq "$((before + 1))" ] ||
			bad 5 "scripts/$d.sh doesn't count the fragment's completion (done count ${before:-?} before, ${after:-?} after): $(head -1 "$TMP/$d.out")"
	done
	# audit.jsonl, built, lists the frozen ledger's entries and the fragment's.
	(cd "$R" && pnpm -s backlog:build) >"$TMP/build1.out" 2>&1 || bad 5 "pnpm backlog:build fails in the clone: $(tail -2 "$TMP/build1.out" | tr '\n' ' ')"
	grep -q '"story":"S9001"' "$R/docs/v3/audit.jsonl" 2>/dev/null && grep -q '"story":"S84"' "$R/docs/v3/audit.jsonl" 2>/dev/null ||
		bad 5 "the built audit.jsonl doesn't list both AUDIT.md's entries and the fragment's"
	for f in scripts/review-debt.sh scripts/parity-debt.sh; do grep -q 'ledger.ts' "$f" || bad 5 "$f doesn't read the ledger through ledger.ts"; done
	if [ -f scripts/backlog-vault/assemble.ts ]; then
		grep -qE 'from "\./ledger\.ts"' scripts/backlog-vault/assemble.ts || bad 5 "assemble.ts doesn't read the ledger through ledger.ts"
	else
		grep -lE 'from "\./ledger\.ts"' scripts/backlog-vault/*.ts | grep -qv '\.test\.ts$' || bad 5 "nothing that replaces assemble.ts reads the ledger through ledger.ts"
	fi

	# Checks 6 and 7: backlog:check fails on a done story with no changelog fragment or no
	# **Baseline:** line, and passes once it has both.
	[ "$CHECK0" -eq 0 ] || { bad 6 "backlog:check fails in the clone before any fixture"; bad 7 "backlog:check fails in the clone before any fixture"; }
	DONE9001="$R/docs/v3/backlog/stories/done/S9001.md"
	CL9001="$R/changelog.d/S9001.md"
	BL='**Baseline:** FIXTURE-BASELINE-9001 the fixture story moved the fixture row.'
	add_baseline() { awk -v l="$BL" '{print} /^\*\*Impact:\*\*/{print ""; print l}' "$DONE9001.orig" >"$DONE9001"; }
	cp "$DONE9001" "$DONE9001.orig"
	mkdir -p "$R/changelog.d"
	mkfrag() { printf -- '---\neffort: none\n---\n\n- **FIXTURE-CHANGELOG-9001 before, nothing; now, a fixture.** Details: **S9001**.\n' >"$CL9001"; }
	# a: neither
	(cd "$R" && pnpm -s backlog:check) >"$TMP/ca.out" 2>&1 && { bad 6 "backlog:check passes on a done story with no changelog fragment"; bad 7 "backlog:check passes on a done story with no **Baseline:** line"; }
	# b: fragment only
	mkfrag
	if (cd "$R" && pnpm -s backlog:check) >"$TMP/cb.out" 2>&1; then bad 7 "backlog:check passes on a done story with no **Baseline:** line"; else grep -qi 'baseline' "$TMP/cb.out" || bad 7 "backlog:check's failure doesn't name the missing **Baseline:** line"; fi
	# c: Baseline only
	rm -f "$CL9001"
	add_baseline
	if (cd "$R" && pnpm -s backlog:check) >"$TMP/cc.out" 2>&1; then bad 6 "backlog:check passes on a done story with no changelog fragment"; else grep -qi 'changelog' "$TMP/cc.out" || bad 6 "backlog:check's failure doesn't name the missing changelog fragment"; fi
	# d: both
	mkfrag
	rm -f "$DONE9001.orig"
	(cd "$R" && pnpm -s backlog:check) >"$TMP/cd.out" 2>&1 || { bad 6 "backlog:check fails on a done story with both: $(tail -2 "$TMP/cd.out" | tr '\n' ' ')"; bad 7 "backlog:check fails on a done story with both"; }
	# Check 7: the built As of line names the newest completion and its Baseline text.
	(cd "$R" && pnpm -s backlog:build) >"$TMP/build2.out" 2>&1
	asof=$(grep -E 'As of' "$R/docs/v3/INDEX.md" 2>/dev/null | head -1)
	printf '%s' "$asof" | grep -q 'S9001' && printf '%s' "$asof" | grep -q 'FIXTURE-BASELINE-9001' ||
		bad 7 "INDEX.md's built As of line doesn't name the newest completion (S9001) and its **Baseline:** text"

	# Check 13 and the rest of check 5: review and skip entries are fragments too.
	(cd "$R" && tgit add -A && tgit commit -q -m "fixture records")
	cp "$R/docs/v3/AUDIT.md" "$TMP/AUDIT.before2"
	before=$(cd "$R" && find docs/v3/audit -type f 2>/dev/null | sort)
	(cd "$R" && printf 'fixture findings\n' | bash scripts/audit.sh review --verdict continue --trigger manual --findings - --in-flight S9201,S9202) >"$TMP/audit-review.out" 2>&1 ||
		bad 13 "audit.sh review --in-flight failed: $(tail -2 "$TMP/audit-review.out" | tr '\n' ' ')"
	rfrag=$(cd "$R" && comm -13 <(printf '%s\n' "$before") <(find docs/v3/audit -type f 2>/dev/null | sort) | grep -E -- '-review\.md$|review' | head -1)
	if [ -z "$rfrag" ]; then
		bad 13 "audit.sh review wrote no review fragment"
		bad 5 "audit.sh review wrote no fragment"
	else
		grep -q 'S9201' "$R/$rfrag" && grep -q 'S9202' "$R/$rfrag" || bad 13 "the review fragment doesn't record the in-flight IDs"
	fi
	before=$(cd "$R" && find docs/v3/audit -type f 2>/dev/null | sort)
	(cd "$R" && printf 'owner: no\n' | bash scripts/audit.sh skip backlog --commit "$(git rev-parse --short HEAD)" --answers -) >"$TMP/audit-skip.out" 2>&1 ||
		bad 5 "audit.sh skip failed: $(tail -2 "$TMP/audit-skip.out" | tr '\n' ' ')"
	[ -n "$(cd "$R" && comm -13 <(printf '%s\n' "$before") <(find docs/v3/audit -type f 2>/dev/null | sort))" ] || bad 5 "audit.sh skip wrote no fragment"
	cmp -s "$TMP/AUDIT.before2" "$R/docs/v3/AUDIT.md" || bad 5 "audit.sh review or skip changed docs/v3/AUDIT.md"
fi

# Check 6: changelog:build over three fixture fragments, in a clone of its own.
C="$TMP/changelog"
if ! grep -q '"changelog:build"' package.json; then
	bad 6 "package.json has no changelog:build script"
elif clone_snap "$C"; then
	(cd "$C" && rm -f changelog.d/[SBV][0-9]*.md && tgit add -A && tgit commit -q --allow-empty -m "no fragments")
	mkdir -p "$C/changelog.d"
	n=0
	for spec in "S9101|Fixture effort S156" "S9102|none" "S9103|Fixture effort S156"; do
		id=${spec%%|*} effort=${spec#*|}
		n=$((n + 1))
		printf -- '---\neffort: %s\n---\n\n- **FIXTURE-%s before, nothing; now, a fixture.** Details: **%s**.\n' "$effort" "$id" "$id" >"$C/changelog.d/$id.md"
		touch -t "20300101000$n" "$C/changelog.d/$id.md"
		(cd "$C" && tgit add -A && GIT_AUTHOR_DATE="2030-01-0${n}T00:00:00Z" GIT_COMMITTER_DATE="2030-01-0${n}T00:00:00Z" tgit commit -q -m "fragment $id")
	done
	(cd "$C" && pnpm -s changelog:build) >"$TMP/clb.out" 2>&1 || bad 6 "pnpm changelog:build fails: $(tail -2 "$TMP/clb.out" | tr '\n' ' ')"
	git show "$BASE:CHANGELOG.md" >"$TMP/base-CHANGELOG.md"
	node -e '
		const fs = require("fs");
		const out = fs.readFileSync(process.argv[1], "utf8").split("\n");
		const hist = fs.readFileSync(process.argv[2], "utf8").split("\n");
		const bad = (w) => console.log("BAD " + w);
		let i = 0;
		for (const l of hist) { while (i < out.length && out[i] !== l) i++; if (i === out.length) { bad("CHANGELOG.md lost a line of its history: " + l.slice(0, 80)); break; } i++; }
		const at = (s) => out.findIndex((l) => l.includes(s));
		const [h, a, b, c] = [at("Fixture effort S156"), at("FIXTURE-S9101"), at("FIXTURE-S9102"), at("FIXTURE-S9103")];
		if ([h, a, b, c].some((x) => x < 0)) bad("a fixture fragment or its effort header is missing from the built CHANGELOG.md");
		else
		{
			if (out.filter((l) => l.includes("Fixture effort S156")).length !== 1) bad("the effort header appears more than once (fragments not grouped)");
			if (!(h < c && c < a && a < b)) bad("built order is not: effort header, S9103 (newest), S9101, then S9102");
			const firstHist = out.findIndex((l) => /^## /.test(l) && hist.includes(l));
			if (firstHist >= 0 && Math.max(a, b, c) > firstHist) bad("fixture fragments are not above the history");
		}' "$C/CHANGELOG.md" "$TMP/base-CHANGELOG.md" >"$TMP/clb.check" 2>&1
	while IFS= read -r l; do case "$l" in "BAD "*) bad 6 "${l#BAD }" ;; esac; done <"$TMP/clb.check"
else
	bad 6 "could not clone the snapshot for changelog:build"
fi
if [ -f changelog.d/S156.md ]; then
	awk '/^---$/{n++;next} n==1' changelog.d/S156.md | grep -qE '^effort: ' || bad 6 "changelog.d/S156.md has no effort frontmatter"
	grep -q 'Details' changelog.d/S156.md && grep -q 'S156' changelog.d/S156.md || bad 6 "changelog.d/S156.md has no Details line naming S156"
else
	bad 6 "changelog.d/S156.md is missing"
fi
FRAME00="docs/v3/backlog/frame/00 Baseball Theater v3 — Checkable backlog.md"
section "$FRAME00" '^16\. ' '^17\. ' | grep -q 'changelog.d' || bad 6 "rule 16 doesn't say a story's entry is its changelog.d fragment"
grep -E 'A `done` story updates' CLAUDE.md | grep -q 'changelog.d' || bad 6 "CLAUDE.md's changelog bullet doesn't name changelog.d"
grep -q 'changelog:build' CLAUDE.md || bad 6 "CLAUDE.md's release step 4 doesn't run pnpm changelog:build"

# Check 7, statically.
grep -qE '^\*\*Baseline:\*\* [^[:space:]]' "$NOTE" || bad 7 "this note has no **Baseline:** line"
BASEL="docs/v3/backlog/frame/01 Current baseline.md"
grep -qE '^\*\*As of:\*\*' "$BASEL" && bad 7 "frame 01 still holds a hand-written **As of:** line"
grep -qiE '<!--.*as of|as of.*-->|\{\{.*as.?of' "$BASEL" || bad 7 "frame 01 holds no marker where the As of line was"
HIST="docs/v3/backlog/frame/06 Baseline history.md"
head -8 "$HIST" | grep -qiE 'frozen' || bad 7 "06 Baseline history.md has no header line saying it is frozen"
# Updated before shipping (rule 7): own_diff's per-commit numstat printed one line a commit, so the check read
# "0" only while one commit touched the file, and missed a change made in a dirty tree at capture time. The
# file's net change from the base is what must lose no line (a merge from stage only adds lines to it).
# The tree against the base: at a capture that is the commit being recorded, and under --reverify the worktree
# sits at the shipping commit, so it is that commit.
[ "$(git -c core.quotepath=false diff --numstat "$BASE" -- "$HIST" | awk '{d+=$2} END {print d+0}')" = "0" ] ||
	bad 7 "06 Baseline history.md lost or changed lines (only a header line may be added)"
section "$FRAME00" '^17\. ' '^18\. ' | grep -q 'Baseline:' || bad 7 "rule 17 doesn't name the **Baseline:** line"
section docs/v3/LOOP.md '^27\. ' '^28\. ' | grep -q 'Baseline:' || bad 7 "LOOP.md checklist item 27 doesn't name the **Baseline:** line"

# =============================================================================================
# --- Check 9: BACKLOG.md retired ------------------------------------------------------------
# =============================================================================================
[ ! -e docs/v3/BACKLOG.md ] || bad 9 "docs/v3/BACKLOG.md still exists"
[ -z "$(git ls-files -- docs/v3/BACKLOG.md)" ] || bad 9 "docs/v3/BACKLOG.md is still tracked"
rv_start=$(grep -n '^### Backlog reviews' "$FRAME00" | head -1 | cut -d: -f1)
rv_end=$(grep -n '^### Goal command for multiple stories' "$FRAME00" | head -1 | cut -d: -f1)
git -c core.quotepath=false grep --untracked -I -n -F 'BACKLOG.md' -- . \
	':(exclude)scripts/verify-*.sh' ':(exclude)docs/v3/AUDIT.md' ':(exclude)docs/v3/VAULT-MIGRATION-AUDIT.md' \
	':(exclude)docs/v3/audit/' ':(exclude)CHANGELOG.md' ':(exclude)docs/v3/backlog/frame/06 Baseline history.md' \
	":(exclude)$NOTE" 2>/dev/null | grep -viE 'retired' |
	awk -F: -v f="$FRAME00" -v s="${rv_start:-0}" -v e="${rv_end:-0}" '!($1 == f && $2 >= s && $2 < e)' >"$TMP/mentions"
cnt=$(grep -c . "$TMP/mentions")
[ "$cnt" -eq 0 ] || bad 9 "$cnt lines still name BACKLOG.md, e.g. $(head -3 "$TMP/mentions" | cut -c1-110 | tr '\n' ' ')"
[ "$TB_STATUS" -eq 0 ] || bad 9 "pnpm test:backlog fails: $(grep -m1 -E 'FAIL|✗|×' "$TMP/tb.out" | cut -c1-150)"
goalline=$(awk '/^```text$/{f=1;next} f && /^```/{exit} f && /^\/goal /{print; exit}' "$NOTE")
printf '%s' "$goalline" | grep -q 'BACKLOG.md' && bad 9 "this note's /goal line still names docs/v3/BACKLOG.md"
mkdir -p "$TMP/stub" && printf '#!/bin/sh\ncat >/dev/null\n' >"$TMP/stub/pbcopy" && chmod +x "$TMP/stub/pbcopy"
printed=$(PATH="$TMP/stub:$PATH" bash scripts/goal.sh S156 2>/dev/null | head -1)
[ -n "$goalline" ] && [ "$printed" = "$goalline" ] || bad 9 "scripts/goal.sh S156 doesn't print this note's /goal line"
l9=$(grep -E '^\| L9 \|' docs/v3/LAWS.md)
[ "$(printf '%s' "$l9" | cut -d'|' -f3 | sed -E 's/^ +| +$//g')" = "The backlog notes are consistent (one note per ID, in its status's folder, frontmatter agreeing with the body); a UI story waits for its ratified design; every story says what it is for" ] ||
	bad 9 "L9's law doesn't read as the owner chose"
printf '%s' "$l9" | cut -d'|' -f4 | grep -q 'Retire it (Recommended)' || bad 9 "L9's source doesn't quote the owner's 'Retire it (Recommended)'"

# =============================================================================================
# --- Check 10: records merge in any order; laws L12 and L13 ---------------------------------
# =============================================================================================
if [ ! -f scripts/backlog-vault/merge-safety.test.ts ]; then
	bad 10 "scripts/backlog-vault/merge-safety.test.ts is missing"
else
	r=$(test_passed merge-safety.test.ts) || bad 10 "$r"
	for w in 'Baseline:' 'changelog.d' 'docs/v3/audit/' 'backlog:check\|runCheck\|check('; do
		grep -q "$w" scripts/backlog-vault/merge-safety.test.ts || bad 10 "merge-safety.test.ts doesn't involve $w"
	done
	grep -qiE 'tmpdir|os\.tmpdir' scripts/backlog-vault/merge-safety.test.ts || bad 10 "merge-safety.test.ts doesn't work under the OS temp directory"
fi
law_row() { grep -E "^\| $1 \|" docs/v3/LAWS.md; }
r12=$(law_row L12)
printf '%s' "$r12" | grep -q 'grader-ci-law.test.ts' && printf '%s' "$r12" | grep -qE '\| enforced \|$' || bad 10 "LAWS.md doesn't list L12 as enforced by grader-ci-law.test.ts"
r13=$(law_row L13)
printf '%s' "$r13" | grep -qiE 'merge-safe' && printf '%s' "$r13" | grep -qE '\| enforced \|$' || bad 10 "LAWS.md doesn't list L13 (records merge-safe) as enforced"
f13=$(printf '%s' "$r13" | cut -d'|' -f5 | grep -oE '`[^`]+`' | head -1 | tr -d '`')
[ -n "$f13" ] && [ -f "$f13" ] || bad 10 "L13's enforcing file '${f13:-none}' doesn't exist"
r=$(test_passed laws.test.ts) || bad 10 "$r"

# =============================================================================================
# --- Check 11: own-commit diff helpers ------------------------------------------------------
# =============================================================================================
if ! declare -F story_own_changed_files >/dev/null || ! declare -F story_own_diff >/dev/null; then
	bad 11 "scripts/lib/checks.sh has no story_own_diff and story_own_changed_files"
else
	G="$TMP/own"
	mkdir -p "$G"
	(
		cd "$G" && tgit init -q && echo a >base.txt && tgit add -A && tgit commit -q -m base &&
			tgit branch other && tgit switch -q -c story &&
			echo own >own.txt && tgit add -A && tgit commit -q -m own &&
			tgit switch -q other && echo other >other.txt && tgit add -A && tgit commit -q -m other &&
			tgit switch -q story && tgit merge -q --no-ff --no-edit other
	) >/dev/null 2>&1 || bad 11 "could not build the throwaway merge repository"
	gb=$(git -C "$G" rev-list --max-parents=0 HEAD)
	ownf=$(cd "$G" && story_own_changed_files SX "$gb" . | tr '\n' ' ')
	allf=$(cd "$G" && story_changed_files SX "$gb" . | tr '\n' ' ')
	[ "$ownf" = "own.txt " ] || bad 11 "story_own_changed_files lists '$ownf', not just own.txt"
	[ "$allf" = "other.txt own.txt " ] || bad 11 "story_changed_files lists '$allf', not both files"
	(cd "$G" && story_own_diff SX "$gb" --name-only) | grep -q 'other.txt' && bad 11 "story_own_diff includes the merged-in file"
fi
fn_text() { awk -v n="$1" '$0 ~ "^" n "\\(\\) \\{" {f=1} f {print} f && /^}/ {exit}'; }
for fn in story_diff story_changed_files; do
	[ "$(git show "$BASE:scripts/lib/checks.sh" | fn_text "$fn")" = "$(fn_text "$fn" <scripts/lib/checks.sh)" ] || bad 11 "$fn is not byte-for-byte the base commit's"
done
section "$FRAME00" '^### Verify-script contract' '^### ' | grep -q 'story_own' || bad 11 "the Verify-script contract doesn't tell new graders to use the own-commit helpers"
section "$FRAME00" '^### Verify-script contract' '^### ' | grep -iE 'merge from `?stage`?' | grep -qiE 'conflict resolution' || bad 11 "the Verify-script contract doesn't say a merge from stage carries only its conflict resolutions"

# =============================================================================================
# --- Check 12: the overseer schedules, the workers claim ------------------------------------
# =============================================================================================
miss=$(in_order "$SKILL" 'eligible' 'barrier' 'coarse fence filter|fence filter' 'claim' 'admission') ||
	bad 12 "run-backlog's SKILL doesn't order eligible set, barrier, fence filter, claim, admission (stuck at: $miss)"
grep -iE 'barrier' "$SKILL" | grep -q 'is_reviewer_path' && grep -iE 'barrier' "$SKILL" | grep -q 'CLAUDE.md' &&
	grep -iE 'barrier' "$SKILL" | grep -q 'docs/v3/LOOP.md' && grep -iE 'barrier' "$SKILL" | grep -q '\.claude/' ||
	bad 12 "the SKILL's barrier doesn't name is_reviewer_path, CLAUDE.md, docs/v3/LOOP.md and .claude/"
grep -qiE 'two clean runs' "$SKILL" && grep -qiE 'never (above|more than) (3|three)' "$SKILL" || bad 12 "the SKILL doesn't move concurrency from 2 to 3 after two clean runs, never above 3"
grep -qiE 'true dependency' "$SKILL" || bad 12 "the SKILL doesn't keep stacking for a true dependency only"
grep -q 'needs-lead' "$SKILL" && grep -q 'SendMessage' "$SKILL" || bad 12 "the SKILL has no needs-lead return resumed with SendMessage"
grep -iE 'claim' "$SKILL" | grep -qiE 'export' && grep -iE 'claim' "$SKILL" | grep -qiE 'doc line' || bad 12 "the SKILL's claim doesn't list exported symbols and doc lines"
CL=scripts/backlog-vault/claims.ts
if [ ! -f "$CL" ]; then
	bad 12 "$CL is missing"
else
	grep -qE 'is_reviewer_path|plan-review\.py' "$CL" || bad 12 "claims.ts doesn't call is_reviewer_path"
	grep -qE '"functions/src/deploy/"|"tools/"|REVIEWER_PATHS' "$CL" && bad 12 "claims.ts copies is_reviewer_path's lists"
	for h in packages/domain/src/index.ts functions/src/handlers/api.ts web/src/routes.tsx openapi/ web/src/api/generated/ vitest.config.ts; do
		grep -qF "$h" "$CL" || bad 12 "claims.ts's hot-file list lacks $h"
	done
	grep -q '\.run' "$CL" || bad 12 "claims.ts keeps no state in .run/"
fi
git check-ignore -q --no-index .run/x || bad 12 ".run/ is not git-ignored"
CT=scripts/backlog-vault/claims.test.ts
if [ ! -f "$CT" ]; then
	bad 12 "$CT is missing"
else
	r=$(test_passed claims.test.ts) || bad 12 "$r"
	for w in 'symbol' 'doc line|docLine|doc-line' 'hot' 'barrier' 'outside'; do
		grep -qiE "$w" "$CT" || bad 12 "claims.test.ts has no case for: $w"
	done
fi
for a in .claude/agents/story-worker.md .claude/agents/bug-worker.md; do
	grep -q 'One at a time, never in parallel' "$a" && bad 12 "$a still says 'One at a time, never in parallel'"
	grep -qiE 'worktree' "$a" || bad 12 "$a doesn't say one worktree each"
done
grep -q 'Push each as ready (Recommended)' CLAUDE.md || bad 12 "CLAUDE.md doesn't push each item when its pre-PR review is clean (owner: 'Push each as ready (Recommended)')"
grep -iE 'independent' CLAUDE.md | grep -q 'origin/stage' || bad 12 "CLAUDE.md doesn't say independent items branch from origin/stage"
w_now=$(($(wc -w <CLAUDE.md) + $(wc -w <"$SKILL")))
w_was=$(($(git show "$BASE:CLAUDE.md" | wc -w) + $(git show "$BASE:$SKILL" | wc -w)))
[ "$w_now" -le "$w_was" ] || bad 12 "CLAUDE.md and run-backlog's SKILL.md have $w_now words, more than the base's $w_was"

# =============================================================================================
# --- Check 13: reviews run beside what is in flight -----------------------------------------
# =============================================================================================
for d in review-debt parity-debt; do
	out=$(bash "scripts/$d.sh" --in-flight S9201,S9202 2>&1)
	printf '%s' "$out" | grep -iE 'in.flight' | grep -qE '\b2\b' || bad 13 "scripts/$d.sh --in-flight S9201,S9202 doesn't print an in-flight count of 2: $(printf '%s' "$out" | head -1)"
done
RT=scripts/backlog-vault/review-debt.test.ts
r=$(test_passed review-debt.test.ts) || bad 13 "$r"
grep -qiE 'in.?flight' "$RT" || bad 13 "review-debt.test.ts has no in-flight case"
grep -qiE 'review' "$CT" 2>/dev/null && grep -qiE 'in.?flight' "$CT" 2>/dev/null || bad 13 "claims.test.ts has no case for a review editing an in-flight item's note"
grep -iE 'in.flight' "$SKILL" | grep -qiE 'review' || bad 13 "the SKILL doesn't run reviews beside in-flight items"
grep -iE 'blocked' "$SKILL" | grep -qiE 'new dispatch' || bad 13 "the SKILL doesn't say a blocked verdict stops new dispatches only"
grep -qE 'audit\.sh review --in-flight|review [^`]*--in-flight' "$SKILL" || bad 13 "the SKILL doesn't log the review with audit.sh review --in-flight"
grep -iE 'drift' "$SKILL" | grep -qiE 'in.flight' || bad 13 "the SKILL doesn't make a drift event from an in-flight item make a review due"

# =============================================================================================
# --- Check 14: one fix per shared problem, one digest ---------------------------------------
# =============================================================================================
if [ -f "$CT" ]; then
	grep -qiE 'findings' "$CT" || bad 14 "claims.test.ts doesn't merge findings"
	grep -q 'Blocks:' "$CT" || bad 14 "claims.test.ts doesn't order questions by Blocks:"
else
	bad 14 "scripts/backlog-vault/claims.test.ts is missing"
fi
[ -f "$CL" ] && grep -qE 'findings' "$CL" || bad 14 "claims.ts has no findings command"
grep -q 'Shared fixes' "$SKILL" || bad 14 "run-backlog's SKILL doesn't name the 'Shared fixes' summary section"
grep -q 'Questions blocking more than one item' "$SKILL" || bad 14 "run-backlog's SKILL doesn't name the 'Questions blocking more than one item' section"
grep -q '\.run/findings\.md' "$SKILL" || bad 14 "run-backlog's SKILL doesn't gather findings in .run/findings.md"
grep -q 'Blocks:' .claude/skills/pending/SKILL.md || bad 14 "the pending SKILL doesn't order by Blocks:"

# =============================================================================================
# --- Check 15: spend guard ------------------------------------------------------------------
# =============================================================================================
grep -qiE 'four reviewers|4 reviewers' "$SKILL" || bad 15 "the SKILL doesn't cap reviewers at four"
# Tightened before shipping (rule 7, after the pre-PR review): N is the number of items to start, so the
# concurrency has its own name, C, defined once as 2 or 3, and the worker cap is stated in it.
grep -qF 'at most C workers' "$SKILL" || bad 15 "the SKILL doesn't cap live workers at the concurrency C"
grep -qF '`C`, 2 or 3' "$SKILL" || bad 15 "the SKILL doesn't define the concurrency as \`C\`, 2 or 3"
grep -qiE 'stagger' "$SKILL" || bad 15 "the SKILL doesn't stagger subagents"
grep -iE 'rate.limit' "$SKILL" | grep -qiE 'retry' || bad 15 "the SKILL doesn't stop dispatching after a rate-limit error until a retry succeeds"
budget=$(grep -iE 'budget' "$SKILL")
for w in 'gh run list --workflow claude-review.yml' 'Opus' 'Sonnet'; do
	printf '%s' "$budget" | grep -qF "$w" || bad 15 "the SKILL's budget line doesn't name: $w"
done

# =============================================================================================
# --- Check 16: Status done ------------------------------------------------------------------
# =============================================================================================
[ -f docs/v3/backlog/stories/done/S156.md ] || bad 16 "the note is not in docs/v3/backlog/stories/done/"
[ "$(ls docs/v3/backlog/stories/*/S156.md 2>/dev/null | wc -l | tr -d ' ')" = "1" ] || bad 16 "there is not exactly one S156 note"
awk '/^---$/{n++;next} n==1' "$NOTE" | grep -qE '^status: done$' || bad 16 "the note's frontmatter status is not done"

# Check 1 (tightened before shipping, rule 7): under `pnpm verify` Turborepo's strict env mode strips any
# variable turbo.json doesn't pass through, so a worktree's PGLITE_PORT never reached the workerd tests and two
# worktrees collided on 54329. Every port .env.worktree sets must be in globalPassThroughEnv.
for v in PGLITE_PORT BT_API_PORT BT_WEB_PORT BT_PG_PORT; do
	grep -v '^\s*//' turbo.json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);process.exit((j.globalPassThroughEnv||[]).includes(process.argv[1])?0:1)})' "$v" ||
		bad 1 "turbo.json's globalPassThroughEnv doesn't pass $v through, so pnpm verify strips it"
done


# =============================================================================================
# --- Check 17: fence ------------------------------------------------------------------------
# The owner widened the fence on 2026-11-20 ("Widen the fence to these four (Recommended)") to AGENTS.md,
# .cursor/rules/agent-boundaries.mdc, docs/v3/FEATURES.md and e2e/select-specs.test.ts, which still named the
# retired BACKLOG.md (rule 7: a pre-ship update recorded in the note; it widens only by those four).
# On 2026-11-20 the owner also added turbo.json ("Widen the fence to turbo.json (Recommended)"), so the
# worktree port variables pass through Turborepo's strict env mode to the tests (check 1).
# On 2026-11-20 the owner also added web/vitest.config.ts and the five functions files whose test servers
# listen on an OS port (asked "Fix the concurrent-verify failures inside S156's pull request (#117) and drop the
# 'one pnpm verify at a time' rule? …", chose "Yes, in S156 (Recommended)"): worker caps, hook time and
# 127.0.0.1 listeners, so two worktrees' pnpm verify pass at once (#116). And .claude/agents/fix-worker.md, whose
# finish step runs the one local pnpm verify (asked "Cut local pnpm verify runs per backlog item? …", the owner
# chose "Both (Recommended)").
# =============================================================================================
# Updated before shipping (rule 7, stricter only): once a completion fragment is committed, story_tip stops the
# own-commit helpers there, so a later fix round's commits and its uncommitted capture went unchecked. Add the
# first-parent non-merge commits after the tip, the working tree and untracked files; under --reverify the
# worktree is clean at the shipping commit, so they add nothing.
fence_tip=$(story_tip S156)
changed=$({
	own_changed_files S156 "$BASE" .
	if [ -n "$fence_tip" ]; then
		git -c core.quotepath=false log --first-parent --no-merges --format= --name-only "$fence_tip..HEAD"
		git -c core.quotepath=false diff --name-only HEAD
		git -c core.quotepath=false ls-files --others --exclude-standard
	fi
} | grep -v '^$' | sort -u)
while IFS= read -r f; do
	[ -z "$f" ] && continue
	case "$f" in
		eslint.config.js | .gitignore | .prettierignore | .jscpd.json | package.json | compose.yaml | functions/package.json | \
			functions/src/adapters/postgres/local.ts | functions/src/test/pglite-server.ts | functions/vitest.workers.config.ts | \
			functions/vitest.config.ts | web/vite.config.ts | e2e/playwright.config.ts | .husky/* | scripts/worktree-for.sh | \
			scripts/audit.sh | scripts/goal.sh | scripts/review-debt.sh | scripts/parity-debt.sh | scripts/review-gate.sh | \
			scripts/pre-commit-tests.ts | scripts/lib/* | scripts/backlog-vault/* | scripts/claude-review/plan-review.py | \
			scripts/claude-review/test_plan_review.py | CLAUDE.md | README.md | .claude/skills/run-backlog/SKILL.md | \
			.claude/skills/backlog-review/SKILL.md | .claude/skills/doc-parity-review/SKILL.md | \
			.claude/skills/design-intake-review/SKILL.md | .claude/skills/verify/SKILL.md | .claude/skills/pending/SKILL.md | \
			.claude/agents/story-worker.md | .claude/agents/bug-worker.md | .claude/agents/backlog-reviewer.md | \
			.claude/agents/doc-parity-reviewer.md | .claude/agents/pre-pr-reviewer.md | docs/v3/LOOP.md | docs/v3/LAWS.md | \
			docs/v3/ARCHITECTURE.md | docs/v3/INTENT.md | docs/v3/VAULT-MIGRATION.md | docs/v3/BACKLOG.md | docs/v3/backlog/* | \
			docs/v3/AUDIT.md | docs/v3/audit/* | docs/v3/audit.jsonl | docs/v3/INDEX.md | CHANGELOG.md | changelog.d/* | \
			AGENTS.md | .cursor/rules/agent-boundaries.mdc | docs/v3/FEATURES.md | e2e/select-specs.test.ts | turbo.json | \
			web/vitest.config.ts | functions/src/handlers/me.test.ts | functions/src/handlers/settings.test.ts | \
			functions/src/handlers/api.test.ts | functions/src/handlers/account-harness.ts | \
			functions/src/adapters/node/http.test.ts | .claude/agents/fix-worker.md | scripts/verify-S156.sh) ;;
		*) bad 17 "outside the fence: $f" ;;
	esac
done <<<"$changed"
git cat-file -e "$BASE:scripts/verify-S156.sh" 2>/dev/null && bad 17 "scripts/verify-S156.sh existed before S156 (it may only be created)"

report "verify-S156"
exit $?
