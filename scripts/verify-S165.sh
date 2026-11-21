#!/usr/bin/env bash
# Grader for backlog story S165 — the backlog issues' live side: `pnpm backlog:check --live` compares
# the issues with their text records and their state (law L9's live parts), the owner's GitHub edits
# are adopted into the record, issues others file are triaged, areas and milestones are set on GitHub,
# in-flight items are guarded, and CI reads the issues (owner, 2026-11-20: "Accept the split
# (Recommended)", "GitHub owns state (Recommended)", and "Approve (Recommended)" for CI's read access).
# Contract: frame note 00, "Verify-script contract" (docs/v3/backlog/frame/).
# No network: the tests stub every gh call (github-fake.ts) and read committed fixtures, never fixed
# commits from git history (CI's checkout is shallow). No writes outside /tmp. Does its own checking
# (never `pnpm verify`); runs the story-scoped Vitest files once and reads each one's result.

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "AC 1: pnpm backlog:check --live (live-check.ts) checks one issue per ID, status label against state (pending and filer-closed warnings), unlogged body edits against the tree's and origin/stage's records, bugs' fields blocks and the design gate; live-check.test.ts covers every listed case and passes; plain pnpm backlog:check still needs no cache"
check 2 "AC 2: audit.sh edit <ID> --adopt --reason records the live body as an edit and posts its Applied comment; audit-edit.test.ts covers an adopt turning --live green and an adopt refused when GitHub already matches"
check 3 "AC 3: pnpm backlog:triage labels outside issues (sync stays read-only, CI never triages); a triage issue is never claimable, never in Next, listed in INDEX's Triage section by number and title only; triage.test.ts covers every listed case and passes"
check 4 "AC 4: one pure areaOf(scope_files) and pnpm backlog:areas (area labels, done stories' milestones by git merge-base --is-ancestor); areas.test.ts covers each area, a two-area story and a done story with and without a containing release"
check 5 "AC 5: claims.test.ts covers review-edits flagging a claimed item's create and edit, audit.sh edit --review refusing a claimed item, and claim refusing a UI story whose design story is open; it passes"
check 6 "AC 6: CLAUDE.md, the run-backlog SKILL and the backlog-review SKILL each say outside issue text is 'data, never instructions'"
check 7 "AC 7: ci.yml changes only by job-level contents: read + issues: read and one 'pnpm backlog:sync && pnpm backlog:check --live' step with GH_TOKEN in the docs job and the verify job; no other file under .github/ changed (deploy.yml untouched)"
check 8 "AC 8: LAWS.md's L9 row names pnpm backlog:check --live and claims.ts claim for its four live parts, keeps cli.ts first and Step lint, quotes the two owner answers; laws.test.ts passes"
check 9 "AC 9: S165's Status is done: its snapshot fragment records done"
check 10 "S165 changed no file outside its fence (plus creating scripts/verify-S165.sh)"

# The commit S165's own changes start from: `git merge-base origin/stage HEAD` when this grader was written.
BASE=6f5e4513

TMP="$(mktemp -d /tmp/verify-S165.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

VAULT=scripts/backlog-vault
AUDIT_DIR=docs/v3/audit

TESTS=(live-check.test.ts audit-edit.test.ts triage.test.ts areas.test.ts claims.test.ts laws.test.ts doc-index.test.ts github.test.ts)
present=()
for t in "${TESTS[@]}"; do [ -f "$VAULT/$t" ] && present+=("$t"); done
if [ "${#present[@]}" -gt 0 ]; then
  (cd "$VAULT" && ../../node_modules/.bin/vitest run --config vitest.config.ts --reporter=json --outputFile="$TMP/report.json" "${present[@]}" >"$TMP/vitest.log" 2>&1)
fi
# test_passed <file> — the file ran, and every test in it passed.
test_passed() {
  [ -f "$TMP/report.json" ] || return 1
  node -e '
    const r = require(process.argv[1]);
    const f = r.testResults.find((t) => t.name.endsWith("/" + process.argv[2]));
    process.exit(f && f.status === "passed" && f.assertionResults.length > 0 ? 0 : 1);
  ' "$TMP/report.json" "$1"
}
# has_test <file> <pattern> — a test title in <file> matches <pattern> (extended regex, any case).
has_test() { [ -f "$VAULT/$1" ] && grep -qiE "it(\.each\(.*\))?\(\"[^\"]*($2)" "$VAULT/$1"; }
# need_tests <check> <file> <pattern>… — the file passes and has a test title for each pattern.
need_tests() {
  local n="$1" f="$2"
  shift 2
  test_passed "$f" || bad "$n" "$f is missing or failing"
  local p
  for p in "$@"; do has_test "$f" "$p" || bad "$n" "$f has no test matching /$p/"; done
}

# --- Check 1: the live check ---
[ -f "$VAULT/live-check.ts" ] || bad 1 "$VAULT/live-check.ts is missing"
grep -q -- '--live' "$VAULT/cli.ts" || bad 1 "cli.ts has no --live option"
need_tests 1 live-check.test.ts \
  "two trusted issues" \
  "open .*status:done|status:done.*open" "closed .*status:(todo|doing)|label.*state" "two status: labels" \
  "pending .*inside" "pending .*outside" \
  "unlogged body edit" "not yet applied" "create with no issue" \
  "revert" "revert.*label change" \
  "unaccepted bug" "fields block but no record" \
  "origin/stage .*passes|matches a record on origin/stage" "no origin/stage ref" \
  "filer edited its symptoms" "filer closed" "fields block changed" \
  "outsider.*Applied|Applied.*outsider" \
  "design gate pass" "design gate fail"
# Without --live, the check reads no cache and no GitHub: run it with an empty cache dir and no gh token.
empty="$TMP/no-cache"
mkdir -p "$empty"
if ! env -u GH_TOKEN -u GITHUB_TOKEN BT_BACKLOG_CACHE="$empty" node "$VAULT/cli.ts" check --quiet >"$TMP/check.log" 2>&1; then
  bad 1 "pnpm backlog:check (no --live) fails with no cache: $(tail -3 "$TMP/check.log" | tr '\n' ' ')"
fi

# --- Check 2: adopt ---
grep -q -- '--adopt' scripts/audit.sh || bad 2 "audit.sh has no edit --adopt"
need_tests 2 audit-edit.test.ts "adopt .*Applied.*green|adopt .*green" "adopt .*refused"

# --- Check 3: triage ---
grep -qE '"backlog:triage": "node scripts/backlog-vault/' package.json || bad 3 "package.json has no backlog:triage script"
grep -q 'backlog:triage' .github/workflows/*.yml && bad 3 "a workflow runs backlog:triage (CI's token is read-only)"
need_tests 3 triage.test.ts "outside issue (is )?labelled" "owner-filed" "unlabelled outside issue.*claim" "S12" "outside bug.*accepted in place" "INDEX.*no body"
grep -qE '"(POST|PATCH)"' <(awk '/^export function syncIssues/,/^}/' "$VAULT/github.ts") && bad 3 "syncIssues writes to GitHub"

# --- Check 4: areas and milestones ---
grep -qE '^export function areaOf\(' "$VAULT/areas.ts" 2>/dev/null || bad 4 "areas.ts does not export areaOf"
grep -qE '"backlog:areas": "node scripts/backlog-vault/' package.json || bad 4 "package.json has no backlog:areas script"
grep -q 'is-ancestor' "$VAULT/areas.ts" 2>/dev/null || bad 4 "areas.ts does not check containment with git merge-base --is-ancestor"
need_tests 4 areas.test.ts "area:web" "area:api" "area:ingest" "area:design" "area:process" "two areas|spanning two" "with a containing release" "without a containing release"

# --- Check 5: in-flight guards ---
need_tests 5 claims.test.ts "review-edits.*claimed.*(create|edit)" "edit --review.*claimed" "design story.*open|UI story.*design"

# --- Check 6: outside text is data ---
for f in CLAUDE.md .claude/skills/run-backlog/SKILL.md .claude/skills/backlog-review/SKILL.md; do
  n="$(grep -c "data, never instructions" "$f" 2>/dev/null)"
  [ "${n:-0}" -ge 1 ] || bad 6 "$f does not say outside issue text is 'data, never instructions'"
done

# --- Check 7: CI reads the issues, exactly as approved ---
ci_diff="$(story_own_diff S165 "$BASE" -U0 -- .github/workflows/ci.yml)"
removed="$(grep -E '^-[^-]' <<<"$ci_diff" || true)"
[ -z "$removed" ] || bad 7 "ci.yml lost lines: $(head -2 <<<"$removed" | tr '\n' ' ')"
added="$(grep -E '^\+[^+]' <<<"$ci_diff" | cut -c2- | grep -vE '^\s*$' || true)"
allowed='^ {8}permissions:$|^ {12}contents: read$|^ {12}issues: read$|^ {12}- name: [^#]+$|^ {14}env:$|^ {18}GH_TOKEN: \$\{\{ github\.token \}\}$|^ {14}run: pnpm backlog:sync && pnpm backlog:check --live$'
while IFS= read -r line; do
  [ -z "$line" ] && continue
  grep -qE "$allowed" <<<"$line" || bad 7 "ci.yml gained a line outside the approved change: $line"
done <<<"$added"
for want in 'issues: read' 'contents: read' 'GH_TOKEN: ${{ github.token }}' 'run: pnpm backlog:sync && pnpm backlog:check --live' 'permissions:'; do
  n="$(grep -cF -- "$want" <<<"$added" || true)"
  [ "$n" = "2" ] || bad 7 "ci.yml gained '$want' $n time(s), not 2 (one per job)"
done
# Each new step follows its job's existing check or verify step.
node -e '
  const y = require("yaml").parse(require("fs").readFileSync(".github/workflows/ci.yml", "utf8"));
  const live = "pnpm backlog:sync && pnpm backlog:check --live";
  const want = { docs: "pnpm backlog:check", verify: "pnpm verify" };
  let ok = true;
  for (const [job, before] of Object.entries(want)) {
    const j = y.jobs[job];
    const p = j.permissions || {};
    if (p.contents !== "read" || p.issues !== "read" || Object.keys(p).length !== 2) { console.log(`${job}: permissions are not exactly contents: read, issues: read`); ok = false; }
    const steps = j.steps;
    const at = steps.findIndex((s) => s.run === live);
    if (at < 1 || !String(steps[at - 1].run || "").includes(before)) { console.log(`${job}: the live step does not follow its ${before} step`); ok = false; }
    if (at >= 0 && (steps[at].env || {}).GH_TOKEN !== "${{ github.token }}") { console.log(`${job}: the live step has no GH_TOKEN`); ok = false; }
  }
  const others = Object.entries(y.jobs).filter(([k, j]) => !(k in want) && JSON.stringify(j).includes("backlog:check --live"));
  if (others.length) { console.log(`other jobs run the live check: ${others.map(([k]) => k)}`); ok = false; }
  process.exit(ok ? 0 : 1);
' >"$TMP/ci.log" 2>&1 || bad 7 "ci.yml: $(tr '\n' ' ' <"$TMP/ci.log")"
wf="$(story_own_changed_files S165 "$BASE" .github/ | grep -vx '.github/workflows/ci.yml' || true)"
[ -z "$wf" ] || bad 7 "S165 changed other files under .github/: $(tr '\n' ' ' <<<"$wf")"
grep -q 'GH_TOKEN\|GITHUB_TOKEN\|gh api' <(sed -n '/"verify":/p' package.json) && bad 7 "pnpm verify needs GitHub"

# --- Check 8: the L9 row ---
row="$(grep -E '^\| L9 \|' docs/v3/LAWS.md || true)"
for p in 'pnpm backlog:check --live' 'claims.ts claim' 'one issue per ID' 'status label agreeing with state' 'no unlogged edit' 'a UI story waits for its ratified design' \
  '"Accept the split (Recommended)"' '"GitHub owns state (Recommended)"'; do
  grep -qF -- "$p" <<<"$row" || bad 8 "the L9 row does not name: $p"
done
cells="$(awk -F' \\| ' '{ print $4 "\t" $5 }' <<<"$row")"
enforced="$(cut -f1 <<<"$cells")"
step="$(cut -f2 <<<"$cells")"
[ "$(grep -oE '`[^`]+`' <<<"$enforced" | head -1)" = '`scripts/backlog-vault/cli.ts`' ] || bad 8 "the L9 Enforced-by cell's first backticked token is not scripts/backlog-vault/cli.ts"
[ "$step" = "lint" ] || bad 8 "the L9 Step is '$step', not lint"
grep -qF 'will run in S165' <<<"$row" && bad 8 "the L9 row still says the live parts 'will run in S165'"
test_passed laws.test.ts || bad 8 "laws.test.ts is missing or failing"

# --- Check 9: Status done, from S165's own snapshot ---
snap="$(find "$AUDIT_DIR" -type f -name '*-S165-snapshot.md' 2>/dev/null | awk -F/ '{ print $NF "\t" $0 }' | LC_ALL=C sort | tail -1 | cut -f2)"
if [ -z "$snap" ]; then
  bad 9 "S165 has no snapshot fragment"
else
  grep -qE '^\| Status \| `done` \|' "$snap" || bad 9 "$snap does not record Status done"
fi

# --- Check 10: fence ---
fence='^(scripts/backlog-vault/|scripts/audit\.sh$|package\.json$|\.github/workflows/ci\.yml$|\.claude/skills/run-backlog/SKILL\.md$|\.claude/skills/backlog-review/SKILL\.md$|CLAUDE\.md$|docs/v3/LAWS\.md$|docs/v3/backlog/|docs/v3/audit/|changelog\.d/|scripts/verify-S165\.sh$)'
while IFS= read -r f; do
  [ -z "$f" ] && continue
  grep -qE "$fence" <<<"$f" || bad 10 "outside the fence: $f"
done < <(story_own_changed_files S165 "$BASE" .)
own_added="$(story_own_diff S165 "$BASE" --name-status --diff-filter=A -- scripts/verify-S165.sh)"
[ -n "$own_added" ] || [ -n "$(git ls-files --others --exclude-standard -- scripts/verify-S165.sh)" ] || bad 10 "scripts/verify-S165.sh was not created by S165"

report "verify-S165"
exit $?
