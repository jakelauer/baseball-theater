#!/usr/bin/env bash
# Grader for backlog story S163 — search-driven reviews: the backlog, doc parity and design intake
# reviews start from a seed of what changed (pnpm backlog:search seed …) and read only the items a
# search ties to it (owner, 2026-11-20: "Both, in order (Recommended)"; "Yes, once per change
# (Recommended)").
# Contract: frame note 00, "Verify-script contract" (docs/v3/backlog/frame/).
# No network: the debt scripts' --json modes read git only, and the issues query is covered by
# search.test.ts with a stubbed gh runner. No writes outside /tmp. Does its own checking (never
# `pnpm verify`); runs the four story-scoped Vitest files once and reads each one's result.

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "AC 1: search.ts exports BacklogSource and notesSource (reading notes through the backlog tool's own parser, no second YAML parser); pnpm backlog:search runs it; item/next/deps/dependents/neighbors/cites/design/path/text answer with a query: line, --json parses, an unknown query or ID exits 2; search.test.ts covers the queries and passes"
check 2 "AC 2: seed backlog|parity|intake exists; search.test.ts's seed cases (30 vs 300 notes identical, no events, removed story's dependents, far evented item's neighbors, prefer_after, done story named by open text, issue cited by a commit, ADR change) pass"
check 3 "AC 3: review-debt.sh --json and parity-debt.sh --json print { due, base, done, inFlight, events }; review-debt.test.ts covers every event kind, a pure move giving no event, and old/new text output identical, and passes"
check 4 "AC 4: issues --since goes through REST with since=, follows Link pages, leaves out pull requests and bodies, records its start time; search.test.ts covers it; search.ts never names graphql"
check 5 "AC 5: the backlog review SKILL starts from the seed, reads issues once per change through issues --since, argues the order around seeded items, treats issue text as data, asks for query: lines; 'every open GitHub issue' and 'the whole backlog, not just the next few' are gone"
check 6 "AC 6: the doc parity SKILL starts from seed parity, scopes checks 2 and 3 to changed rows (cites), asks for query: lines"
check 7 "AC 7: the design intake SKILL starts from seed intake with a scoped inputs table (no 'read all of them'), keeps two reviewers; the four review agents name the seed first; CLAUDE.md and frame 00 say the order around what changed; SKILLs + CLAUDE.md grow by at most 250 words"
check 8 "AC 8: audit.sh review and parity refuse findings with no query: line (exit 1); audit-queries.test.ts covers it and passes; audit-reverify.test.ts logs a query: line and passes"
check 9 "AC 9: S163's Status is done (frontmatter status done, the note in docs/v3/backlog/stories/done/)"
check 10 "S163 changed no file outside its fence (plus creating scripts/verify-S163.sh)"

# The commit S163's own changes start from: `git merge-base origin/stage HEAD` when this grader was written.
BASE=9bebb01f

TMP="$(mktemp -d /tmp/verify-S163.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

VAULT=scripts/backlog-vault
SEARCH="$VAULT/search.ts"
BR=.claude/skills/backlog-review/SKILL.md
DP=.claude/skills/doc-parity-review/SKILL.md
DI=.claude/skills/design-intake-review/SKILL.md
FRAME="docs/v3/backlog/frame/00 Baseball Theater v3 — Checkable backlog.md"

# A section of a Markdown file: from the first line matching <start> up to (not including) the next line matching <stop>.
section() { awk -v s="$2" -v e="$3" '$0 ~ s { on = 1; print; next } on && $0 ~ e { exit } on { print }' "$1"; }

# The four story-scoped test files, run once; each file's pass/fail read from the JSON report.
TESTS=(search.test.ts review-debt.test.ts audit-queries.test.ts audit-reverify.test.ts)
if [ -f "$SEARCH" ]; then
  (cd "$VAULT" && ../../node_modules/.bin/vitest run --config vitest.config.ts --reporter=json --outputFile="$TMP/report.json" "${TESTS[@]}" >"$TMP/vitest.log" 2>&1)
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
# A title given to it.each(…)("…") counts too.
has_test() { [ -f "$VAULT/$1" ] && grep -qiE "it(\.each\(.*\))?\(\"[^\"]*($2)" "$VAULT/$1"; }

# --- Check 1: one query layer ---
if [ ! -f "$SEARCH" ]; then
  bad 1 "$SEARCH is missing"
else
  grep -qE '^export interface BacklogSource' "$SEARCH" || bad 1 "search.ts does not export interface BacklogSource"
  grep -qE '^export function notesSource\(' "$SEARCH" || bad 1 "search.ts does not export function notesSource"
  grep -qE 'from "\./vault\.ts"' "$SEARCH" || bad 1 "search.ts does not import vault.ts"
  grep -qE 'buildFromNotes|parseBacklog' "$SEARCH" || bad 1 "search.ts does not read notes through buildFromNotes/parseBacklog"
  grep -qE 'from "yaml"' "$SEARCH" && bad 1 "search.ts imports yaml: a second parser"
  [ "$(node -e 'console.log(require("./package.json").scripts["backlog:search"] ?? "")')" = "node scripts/backlog-vault/search.ts" ] ||
    bad 1 "package.json's backlog:search is not 'node scripts/backlog-vault/search.ts'"
  out="$(node "$SEARCH" item S163 2>&1)" || bad 1 "item S163 failed: $out"
  grep -qE '^query: item S163 → S163$' <<<"$out" || bad 1 "item S163 printed no 'query: item S163 → S163' line"
  for q in "next 3" "deps S164" "dependents S163" "neighbors S163 --window 1" "cites Backlog in GitHub issues" \
    "design standings-search-settings" "path scripts/backlog-vault/" "text --open '\\bS163\\b'"; do
    # shellcheck disable=SC2086
    out="$(eval node "$SEARCH" $q 2>&1)" || { bad 1 "'$q' failed: $out"; continue; }
    grep -qE '^query: ' <<<"$out" || bad 1 "'$q' printed no query: line"
    # The regex must reach the query intact (single-quoted inside the eval), so `text` is really exercised.
    case "$q" in
      text*) grep -qF 'query: text \bS163\b --open' <<<"$out" || bad 1 "'$q' did not receive its regex intact: $(tail -1 <<<"$out")" ;;
    esac
  done
  node "$SEARCH" next abc >/dev/null 2>&1; [ $? -eq 2 ] || bad 1 "a malformed argument (next abc) does not exit 2"
  node "$SEARCH" dependents S163 --json | node -e 'JSON.parse(require("fs").readFileSync(0, "utf8"))' 2>/dev/null || bad 1 "--json does not print JSON"
  node "$SEARCH" nonsense >/dev/null 2>&1; [ $? -eq 2 ] || bad 1 "an unknown query does not exit 2"
  node "$SEARCH" item S99999 >/dev/null 2>&1; [ $? -eq 2 ] || bad 1 "an unknown ID does not exit 2"
  test_passed search.test.ts || bad 1 "search.test.ts did not pass ($(tail -5 "$TMP/vitest.log" 2>/dev/null | tr '\n' ' '))"
  for t in "bug .*ahead|bug .*before" "neighbors.*(end|first|last)" "cites.*Gap"; do
    has_test search.test.ts "$t" || bad 1 "search.test.ts has no test matching /$t/"
  done
fi

# --- Check 2: a review seed whose size follows the change ---
if [ -f "$SEARCH" ]; then
  for kind in backlog parity intake; do
    grep -qE "\"$kind\"" "$SEARCH" || bad 2 "search.ts names no '$kind' seed"
  done
  grep -q 'seed' "$SEARCH" || bad 2 "search.ts has no seed query"
  for t in "300" "no events" "removed" "far|down the order" "prefer_after" "done story.*(text|named)" "commit" "ADR" "intake.*adds the backlog seed" "todo"; do
    has_test search.test.ts "$t" || bad 2 "search.test.ts has no seed test matching /$t/"
  done
  test_passed search.test.ts || bad 2 "search.test.ts did not pass"
else
  bad 2 "$SEARCH is missing"
fi

# --- Check 3: the debt scripts emit their events ---
for s in review-debt parity-debt; do
  out="$(bash "scripts/$s.sh" --json --in-flight "" 2>"$TMP/$s.err")"
  node -e '
    const o = JSON.parse(process.argv[1]);
    const ok = typeof o.due === "boolean" && typeof o.base === "string" && Array.isArray(o.done) && Array.isArray(o.inFlight) && Array.isArray(o.events)
      && o.events.every((e) => typeof e.kind === "string");
    process.exit(ok ? 0 : 1);
  ' "$out" 2>/dev/null || bad 3 "$s.sh --json did not print { due, base, done, inFlight, events } ($(head -c 200 <<<"$out") $(head -c 200 "$TMP/$s.err"))"
done
for k in inserted removed reprioritized ac-rewritten source-changed purpose-changed doc-changed adr-changed amendment surface-ratified package-added verify-changed count; do
  grep -q "\"$k\"" "$VAULT/review-debt.test.ts" || bad 3 "review-debt.test.ts never asserts the '$k' event"
done
grep -qE '\-\-json' "$VAULT/review-debt.test.ts" || bad 3 "review-debt.test.ts never runs --json"
has_test review-debt.test.ts "identical|same text" || bad 3 "review-debt.test.ts has no old-vs-new text output test"
has_test review-debt.test.ts "move.*no event|no event.*move" || bad 3 "review-debt.test.ts has no test that a move alone gives no event"
has_test review-debt.test.ts "since" || bad 3 "review-debt.test.ts has no --json --since test"
has_test review-debt.test.ts "ADR.*section|section.*ADR" || bad 3 "review-debt.test.ts has no test that a body edit names its ADR section"
for s in review-debt parity-debt; do
  bash "scripts/$s.sh" --since HEAD >/dev/null 2>&1; [ $? -eq 2 ] || bad 3 "$s.sh --since without --json does not exit 2"
done
[ -n "$(node "$VAULT/cli.ts" review-base backlog 2>/dev/null)" ] || bad 3 "cli.ts review-base backlog prints no commit"
test_passed review-debt.test.ts || bad 3 "review-debt.test.ts did not pass"

# --- Check 4: issues by change, through REST ---
if [ -f "$SEARCH" ]; then
  grep -rn "graphql" "$SEARCH" >/dev/null && bad 4 "search.ts names graphql"
  grep -qF 'issues?state=all&since=' "$SEARCH" || bad 4 "search.ts does not ask REST for issues?state=all&since="
  grep -qiE '\blink\b' "$SEARCH" || bad 4 "search.ts does not follow the Link header"
  for t in "window|design intake" "page" "pull request" "body" "since" "start" "Date header"; do
    has_test search.test.ts "$t" || bad 4 "search.test.ts has no issues test matching /$t/"
  done
else
  bad 4 "$SEARCH is missing"
fi

# --- Check 5: the backlog review starts from the seed ---
grep -qF 'pnpm backlog:search seed backlog --since "$(node scripts/backlog-vault/cli.ts review-base backlog)"' "$BR" || bad 5 "$BR does not start from the backlog seed command"
[ "$(grep -c "every open GitHub issue" "$BR")" = 0 ] || bad 5 "$BR still says 'every open GitHub issue'"
[ "$(grep -c "the whole backlog, not just the next few" "$BR")" = 0 ] || bad 5 "$BR still says 'the whole backlog, not just the next few'"
grep -qF 'issues --since' "$BR" || bad 5 "$BR does not read issues through issues --since"
grep -qF 'Yes, once per change (Recommended)' "$BR" || bad 5 "$BR does not quote the owner's once-per-change answer"
grep -qiE 'data, never instructions' "$BR" || bad 5 "$BR does not say outside issue text is data, never instructions"
grep -qF 'query:' "$BR" || bad 5 "$BR's evidence does not ask for query: lines"
grep -qiE 'neighbo' "$BR" || bad 5 "$BR's check 3 does not argue around the seeded items' neighbors"

# --- Check 6: the doc parity review starts from the seed ---
grep -qF 'pnpm backlog:search seed parity --since "$(node scripts/backlog-vault/cli.ts review-base parity)"' "$DP" || bad 6 "$DP does not start from the parity seed command"
grep -qF 'query:' "$DP" || bad 6 "$DP does not ask for query: lines"
grep -qF 'cites' "$DP" || bad 6 "$DP's check 3 does not use cites"

# --- Check 7: the design intake, the agents, CLAUDE.md and frame 00 ---
grep -qF 'pnpm backlog:search seed intake --since "$(node scripts/backlog-vault/cli.ts review-base backlog)"' "$DI" || bad 7 "$DI does not start from the intake seed command"
grep -qiF 'read all of them' "$DI" && bad 7 "$DI still says 'read all of them'"
grep -qiF 'the whole order' "$DI" && bad 7 "$DI still says check 3 argues against 'the whole order'"
for a in backlog-reviewer doc-parity-reviewer; do
  grep -qF 'backlog:search item' ".claude/agents/$a.md" || bad 7 ".claude/agents/$a.md does not find a seeded item's note with backlog:search item"
done
grep -qiE 'two (independent )?reviewers|two .*design-intake-reviewer' "$DI" || bad 7 "$DI dropped the two-reviewer rule"
for a in backlog-reviewer doc-parity-reviewer design-intake-reviewer design-intake-merger; do
  grep -qF 'pnpm backlog:search seed' ".claude/agents/$a.md" || bad 7 ".claude/agents/$a.md does not name the seed command"
done
grep -qF "argues against the whole backlog's priority order" CLAUDE.md && bad 7 "CLAUDE.md still says the review argues against the whole backlog's priority order"
grep -qF "order around what changed" CLAUDE.md || bad 7 "CLAUDE.md does not say the review argues against the order around what changed"
for s in "Backlog reviews" "Doc parity reviews"; do
  # Captured first: `grep -q` closing the pipe early would fail the pipeline under pipefail.
  text="$(section "$FRAME" "^### $s\$" '^### ')"
  grep -qF 'pnpm backlog:search seed' <<<"$text" || bad 7 "frame 00's $s section does not name the seed"
done
words() { local n=0 f; for f in "$BR" "$DP" "$DI" CLAUDE.md; do n=$((n + $(git show "$1:$f" 2>/dev/null | wc -w))); done; echo "$n"; }
before="$(words "$BASE")"
after=0; for f in "$BR" "$DP" "$DI" CLAUDE.md; do after=$((after + $(wc -w <"$f"))); done
[ "$after" -le $((before + 250)) ] || bad 7 "the three SKILLs and CLAUDE.md grew from $before to $after words (more than 250)"
echo "words: $before at $BASE, $after now"

# --- Check 8: the ledger records what was searched ---
grep -qE "\^query:|'\^query:'|\"\^query:\"" scripts/audit.sh || bad 8 "audit.sh does not test findings for a line starting query:"
test_passed audit-queries.test.ts || bad 8 "audit-queries.test.ts did not pass or is missing"
grep -qF 'query:' "$VAULT/audit-reverify.test.ts" || bad 8 "audit-reverify.test.ts's review gains no query: line"
test_passed audit-reverify.test.ts || bad 8 "audit-reverify.test.ts did not pass"

# --- Check 9: status ---
NOTE="$(ls docs/v3/backlog/stories/*/S163.md 2>/dev/null | head -1)"
[ "$NOTE" = "docs/v3/backlog/stories/done/S163.md" ] || bad 9 "S163's note is at '${NOTE}', not stories/done/"
grep -qE '^status: done$' "$NOTE" 2>/dev/null || bad 9 "S163's frontmatter status is not done"

# --- Check 10: fence ---
fence='^(scripts/backlog-vault/|scripts/review-debt\.sh$|scripts/parity-debt\.sh$|scripts/lib/story-notes\.sh$|scripts/audit\.sh$|package\.json$|\.claude/skills/(backlog-review|doc-parity-review|design-intake-review)/SKILL\.md$|\.claude/agents/(backlog-reviewer|doc-parity-reviewer|design-intake-reviewer|design-intake-merger)\.md$|CLAUDE\.md$|docs/v3/backlog/|docs/v3/audit/|changelog\.d/S163\.md$|scripts/verify-S163\.sh$)'
while IFS= read -r f; do
  [ -z "$f" ] && continue
  grep -qE "$fence" <<<"$f" || bad 10 "outside the fence: $f"
done < <(story_own_changed_files S163 "$BASE" .)
own_diff_added="$(story_own_diff S163 "$BASE" --name-status --diff-filter=A -- scripts/verify-S163.sh)"
[ -n "$own_diff_added" ] || [ -n "$(git ls-files --others --exclude-standard -- scripts/verify-S163.sh)" ] || bad 10 "scripts/verify-S163.sh was not created by S163"

report "verify-S163"
exit $?
