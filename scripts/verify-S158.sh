#!/usr/bin/env bash
# Grader for backlog story S158 — run records: a /run-backlog run keeps a journal in `.run/run.json`
# (claims.ts run start|event), one pure summarizeRun (runs.ts) says what the run did, whether it counts
# and whether it was clean, `scripts/audit.sh run` writes it as a ledger entry, `runs.ts concurrency`
# reads those entries to set the next run's C, and a turn-cap hit makes a backlog review due until a
# review lists it (owner, 2026-11-20: "Yes", "First C=2 run sets it (Recommended)", "Drop back to 2
# (Recommended)"; 2026-11-21: "Yes, add it to S158 (Recommended)").
# Contract: frame note 00, "Verify-script contract" (docs/v3/backlog/frame/).
# No network: the tests stub gh and build their own repos in /tmp. Does its own checking (never
# `pnpm verify`); runs the story-scoped Vitest files once and reads each one's result.

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "AC 1: claims.ts run start|event keep .run/run.json under the claims lock; every kind, every refusal, a second run start, --resume, claim with and without a journal, claim --dry-run and two appends at once are covered in claims.test.ts and pass"
check 2 "AC 2: runs.ts exports a pure summarizeRun; runs.test.ts's resumed item, interrupted-then-resumed run, barrier, item parked to the end and run with no pull request pass"
check 3 "AC 3: counted and clean; runs.test.ts's uncounted, clean and not-clean cases pass"
check 4 "AC 4: audit.sh run [--abandoned] writes a run fragment and moves the main checkout's journal to .run/ended/; ledger.ts has the run kind; ledger.test.ts, audit-run.test.ts and merge-safety.test.ts pass"
check 5 "AC 5: runs.ts concurrency prints 2 or 3 from the counted run entries; every listed runs.test.ts case passes"
check 6 "AC 6: the run-backlog SKILL defines a run and uses the journal and run entries; CLAUDE.md names the run entry kind; CLAUDE.md and the SKILL grew by at most 400 words"
check 7 "AC 7: turn-cap events make a review due until a backlog review lists the hit (review-debt.sh, audit.sh review --debt-json, search.ts STORY_EVENTS, the backlog-review SKILL); every listed test passes"
check 8 "AC 8: S158's Status is done: its snapshot fragment records done"
check 9 "S158 changed no file outside its fence (plus creating scripts/verify-S158.sh)"

# The commit S158's own changes start from: `git merge-base origin/stage HEAD` when this grader was written.
BASE=e0aa4a6c

TMP="$(mktemp -d /tmp/verify-S158.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

VAULT=scripts/backlog-vault
AUDIT_DIR=docs/v3/audit
SKILL=.claude/skills/run-backlog/SKILL.md
REVIEW_SKILL=.claude/skills/backlog-review/SKILL.md

TESTS=(claims.test.ts runs.test.ts ledger.test.ts audit-run.test.ts merge-safety.test.ts review-debt.test.ts search.test.ts)
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
# has_test <file> <pattern> — a test in <file> whose title (or full name) matches <pattern> (extended
# regex, any case) ran and passed: a skipped or todo test, or a title only in the source, never counts.
has_test() {
  [ -f "$TMP/report.json" ] || return 1
  node -e '
    const r = require(process.argv[1]);
    const f = r.testResults.find((t) => t.name.endsWith("/" + process.argv[2]));
    const re = new RegExp(process.argv[3], "i");
    process.exit(f && f.assertionResults.some((a) => a.status === "passed" && (re.test(a.title) || re.test(a.fullName))) ? 0 : 1);
  ' "$TMP/report.json" "$1" "$2"
}
# need_tests <check> <file> <pattern>… — the file passes and has a passed test for each pattern.
need_tests() {
  local n="$1" f="$2"
  shift 2
  test_passed "$f" || bad "$n" "$f is missing or failing"
  local p
  for p in "$@"; do has_test "$f" "$p" || bad "$n" "$f has no passed test matching /$p/"; done
}

# --- Check 1: the run journal ---
grep -q 'run\.json' "$VAULT/claims.ts" || bad 1 "claims.ts does not write run.json"
kinds=()
for k in item-start needs-lead park resume held pr-open ready merged conflict duplicate turn-cap gate-open gate-close interrupted; do
  kinds+=("^run event $k is appended")
done
need_tests 1 claims.test.ts "${kinds[@]}" \
  "^run start writes run.json" "^run start refuses a second run" "^run start --resume keeps the journal" \
  "^run start refuses a missing --n or --c" \
  "^run event refuses an unknown kind" "^run event refuses an item kind without an ID" "^run event refuses an ID that fails ITEM_ID" \
  "^run event refuses pr-open without --pr" "^run event refuses conflict without --path" "^run event refuses an ID on a run kind" \
  "^claim appends claim to the journal" "^claim appends claim-refused on exit 1" "^claim without a journal writes no event" \
  "^claim --dry-run writes no event" "^two appends at once keep both events" \
  "^a journal write waits for the claims lock" "^run event refuses an event while the run is interrupted" \
  "^run event refuses turn-cap on an item that is not a story" "^run event refuses a flag its kind doesn't take" \
  "^run start refuses a --c other than 2 or 3" "^run end moves the journal to ended/ under the lock" \
  "^a corrupt run.json exits 2" "^a refused claim with no journal takes no lock"

# --- Check 2: summarizeRun ---
[ -f "$VAULT/runs.ts" ] || bad 2 "$VAULT/runs.ts is missing"
grep -qE '^export function summarizeRun\(' "$VAULT/runs.ts" 2>/dev/null || bad 2 "runs.ts does not export summarizeRun"
sed -n '/^export function summarizeRun/,/^}/p' "$VAULT/runs.ts" 2>/dev/null |
  grep -qE 'readFileSync|writeFileSync|existsSync|readdirSync|execSync|spawn|process\.(env|argv|cwd)|Date\.now|new Date\(\)' && bad 2 "summarizeRun is not pure"
need_tests 2 runs.test.ts "^summary: a resumed item" "^summary: an interrupted-then-resumed run" "^summary: a barrier" \
  "^summary: an item parked to the end" "^summary: a run with no pull request" "^summary: park ends flight" "^summary: held ends flight"

# --- Check 3: counted and clean ---
need_tests 3 runs.test.ts "^uncounted: 3 items started" "^uncounted: a non-barrier peak below C" "^uncounted: no pull request merged" \
  "^uncounted: an abandoned run" "^clean: the first counted run at 2" "^not clean: more findings per pull request" \
  "^not clean: a record conflict" "^not clean: a duplicate" "^not clean: a 3-hour active drain" \
  "^clean: an interrupted gap over 3 hours" "^clean: a claim-refused event" \
  "^clean: 1 finding over 3 pull requests against a stored 1/3 bar" "^uncounted: a leftover's ready and merged never count" \
  "^uncounted: at C=2, an item that overlaps only a parked one" "^clean: an earlier counted run at 3 never sets the bar"

# --- Check 4: the run ledger entry ---
grep -qE '^  run\)|run\)$|"run"\)' scripts/audit.sh || grep -qE '^[[:space:]]*run\)' scripts/audit.sh || bad 4 "audit.sh has no run command"
grep -qE '"run"' "$VAULT/ledger.ts" || bad 4 "ledger.ts has no run kind"
need_tests 4 ledger.test.ts "^parses a run fragment" "^rejects a run fragment whose name and heading disagree"
need_tests 4 audit-run.test.ts "^audit.sh run writes the entry and moves the journal" "^audit.sh run --abandoned" "^audit.sh run from a linked worktree" \
  "^audit.sh run exits 2 when a review's comments can't be read" "^audit.sh run refuses while an ended run has no entry in the tree" \
  "^audit.sh run --journal re-records an ended run" "^audit.sh run --abandoned ends past an ended run with no entry" \
  "^audit.sh run refuses a run already recorded" "^audit.sh run refuses a run with an item in flight" \
  "^audit.sh run --abandoned records a run with an item in flight" "^audit.sh run: a held item is not in flight"
test_passed merge-safety.test.ts || bad 4 "merge-safety.test.ts is missing or failing"
grep -q -- '-run\.md' "$VAULT/merge-safety.test.ts" || bad 4 "merge-safety.test.ts has no run fragment among its records"

# --- Check 5: concurrency from the records ---
need_tests 5 runs.test.ts "^concurrency: no entries" "^concurrency: one clean at 2" "^concurrency: two clean at 2" \
  "^concurrency: clean then unclean at 2" "^concurrency: two clean at 2 with an uncounted run between" "^concurrency: clean at 3" \
  "^concurrency: unclean at 3$" "^concurrency: unclean at 3 then one clean at 2" "^concurrency: unclean at 3 then two clean at 2" \
  "^concurrency CLI reads the run entries newest first"

# --- Check 6: the skill and CLAUDE.md ---
for p in 'runs.ts concurrency' 'claims.ts run start --n' 'run start --resume' 'scripts/audit.sh run --abandoned' 'backlog/run-<id>' '**Time:**' 'run event' 'interrupted'; do
  grep -qF -- "$p" "$SKILL" || bad 6 "the run-backlog SKILL does not say: $p"
done
grep -qE 'story, snapshot, review, answers, skip, parity, design, run' CLAUDE.md || bad 6 "CLAUDE.md's list of audit.sh entry kinds does not name run"
grep -qF 'two clean runs at 2 (no record conflicts' "$SKILL" && bad 6 "the SKILL keeps the old, undefined concurrency rule"
before="$( (git show "$BASE:CLAUDE.md"; git show "$BASE:$SKILL") | wc -w | tr -d ' ')"
after="$(cat CLAUDE.md "$SKILL" | wc -w | tr -d ' ')"
[ "$((after - before))" -le 400 ] || bad 6 "CLAUDE.md and the SKILL grew by $((after - before)) words (over 400)"

# --- Check 7: turn-cap hits make a review due ---
grep -q 'a turn cap hit (S158 AC 7' scripts/review-debt.sh || bad 7 "review-debt.sh's header does not name the turn-cap event"
grep -q 'turn cap hit mid-run (rule 10 stop-and-report)' scripts/review-debt.sh && bad 7 "review-debt.sh still says a turn cap is not detectable"
grep -qE '\\ +[^ ]' "$REVIEW_SKILL" && bad 7 "the backlog-review SKILL has a line continuation followed by more text (a broken command)"
grep -q -- '--debt-json' scripts/audit.sh || bad 7 "audit.sh review takes no --debt-json"
grep -q -- '--debt-json' "$REVIEW_SKILL" || bad 7 "the backlog-review SKILL does not pass --debt-json"
grep -qE 'STORY_EVENTS.*turn-cap|"turn-cap"' "$VAULT/search.ts" || bad 7 "search.ts STORY_EVENTS has no turn-cap"
need_tests 7 review-debt.test.ts "^turn cap: an unlisted run-entry hit is due" "^turn cap: a hit a review lists is not due" \
  "^turn cap: a skip and an answers entry do not clear a hit" "^turn cap: a hit stamped after the review's commit but listed is not due" \
  "^turn cap: a run entry committed after the review that listed its hit is not due" "^turn cap: a live run.json hit is due" \
  "^turn cap: an ended journal's hit is due" "^turn cap: the same hit from three places is one" "^turn cap: two hits on one ID are one event" \
  "^turn cap: a run with no turn-cap event is not due" "^turn cap: --json prints the event" \
  "^turn cap: a hit in the main checkout's run.json is due from a linked worktree"
need_tests 7 audit-run.test.ts "^audit.sh review --debt-json lists the hits"
need_tests 7 search.test.ts "^a turn-cap event seeds its ID"
need_tests 7 runs.test.ts "^summary: turn-cap hits in event order" "ignores a hit on a bug"

# --- Check 8: Status done, from S158's own snapshot ---
snap="$(find "$AUDIT_DIR" -type f -name '*-S158-snapshot.md' 2>/dev/null | awk -F/ '{ print $NF "\t" $0 }' | LC_ALL=C sort | tail -1 | cut -f2)"
if [ -z "$snap" ]; then
  bad 8 "S158 has no snapshot fragment"
else
  grep -qE '^\| Status \| `done` \|' "$snap" || bad 8 "$snap does not record Status done"
fi

# --- Check 9: fence ---
fence='^(scripts/backlog-vault/|scripts/audit\.sh$|scripts/review-debt\.sh$|\.claude/skills/run-backlog/SKILL\.md$|\.claude/skills/backlog-review/SKILL\.md$|CLAUDE\.md$|docs/v3/backlog/|docs/v3/audit/|changelog\.d/|scripts/verify-S158\.sh$)'
while IFS= read -r f; do
  [ -z "$f" ] && continue
  grep -qE "$fence" <<<"$f" || bad 9 "outside the fence: $f"
done < <(story_own_changed_files S158 "$BASE" .)
own_added="$(story_own_diff S158 "$BASE" --name-status --diff-filter=A -- scripts/verify-S158.sh)"
[ -n "$own_added" ] || [ -n "$(git ls-files --others --exclude-standard -- scripts/verify-S158.sh)" ] || bad 9 "scripts/verify-S158.sh was not created by S158"

report "verify-S158"
exit $?
