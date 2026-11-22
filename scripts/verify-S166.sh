#!/usr/bin/env bash
# Grader for backlog story S166 — two faults in the backlog scripts: every script under
# scripts/backlog-vault/ shares one "am I being run directly" check that compares real paths (issue
# #299), and an incremental `pnpm backlog:sync` lists the open issues instead of reading each open
# backlog issue one at a time (owner, 2026-11-21: "Yes, one story (Recommended)").
# Contract: frame note 00, "Verify-script contract" (docs/v3/backlog/frame/).
# No network: github.test.ts's fake GitHub answers every gh call. No writes outside /tmp. Does its own
# checking (never `pnpm verify`); runs the story-scoped Vitest files once and reads each one's result.

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "AC 1: run-directly.ts exports isRunDirectly(moduleUrl, argv1 = process.argv[1]) comparing real paths; every command-line script under scripts/backlog-vault/ calls it and no other process.argv[1] comparison is left; every listed run-directly.test.ts case ran and passed; text-records.ts started through a symlinked folder prints its usage and exits nonzero"
check 2 "AC 2: an incremental syncIssues lists the open issues (every page) before the since listing and makes no per-issue request; its doc comment says how drops are found; every listed github.test.ts case ran and passed and the old 'by reading each open backlog issue' test is renamed"
check 3 "AC 3: S166's Status is done: its snapshot fragment records done"
check 4 "S166 changed no file outside its fence (plus creating scripts/verify-S166.sh)"

# The commit S166's own changes start from: `git merge-base origin/stage HEAD` when this grader was written.
BASE=283e5188

TMP="$(mktemp -d /tmp/verify-S166.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

VAULT=scripts/backlog-vault
AUDIT_DIR=docs/v3/audit

TESTS=(run-directly.test.ts github.test.ts)
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

# --- Check 1: one run-directly check, comparing real paths ---
RD="$VAULT/run-directly.ts"
if [ ! -f "$RD" ]; then
  bad 1 "$RD is missing"
else
  grep -qE '^export function isRunDirectly\(moduleUrl: string, argv1: string \| undefined = process\.argv\[1\]\): boolean' "$RD" ||
    bad 1 "$RD does not export isRunDirectly(moduleUrl: string, argv1: string | undefined = process.argv[1]): boolean"
  grep -q 'realpathSync' "$RD" || bad 1 "$RD does not compare real paths (realpathSync)"
fi
for s in claims github search text-records in-flight areas triage migrate runs; do
  f="$VAULT/$s.ts"
  [ -f "$f" ] || { bad 1 "$f is missing"; continue; }
  grep -qE '^if \(isRunDirectly\(import\.meta\.url\)\)' "$f" || bad 1 "$f does not guard its command line with isRunDirectly(import.meta.url)"
  grep -qE 'from "\./run-directly\.ts"' "$f" || bad 1 "$f does not import ./run-directly.ts"
done
left="$(grep -rnE 'process\.argv\[1\]' "$VAULT" --include='*.ts' | grep -vE "^$VAULT/(run-directly\.ts|[^:]*\.test\.ts):" || true)"
[ -z "$left" ] || bad 1 "process.argv[1] is still compared outside run-directly.ts: $(head -3 <<<"$left" | tr '\n' ' ')"
need_tests 1 run-directly.test.ts \
  "^the real path is run directly" \
  "^a path through a symlinked directory is run directly, where the old comparison said no" \
  "^a different file is not run directly" \
  "^undefined and an empty argv1 are not run directly" \
  "^a path that doesn't exist is not run directly and doesn't throw" \
  "^text-records.ts started through a symlinked folder prints its usage and exits nonzero"
# The same end-to-end case here, outside Vitest: a symlink to scripts/backlog-vault under /tmp.
ln -s "$PWD/$VAULT" "$TMP/vault"
node "$TMP/vault/text-records.ts" >"$TMP/e2e.out" 2>"$TMP/e2e.err"
code=$?
[ "$code" -ne 0 ] || bad 1 "text-records.ts through a symlink exited 0"
grep -q 'usage: text-records.ts' "$TMP/e2e.err" || bad 1 "text-records.ts through a symlink printed no usage on stderr"

# --- Check 2: the quick sync lists instead of reading issue by issue ---
sync_body="$(awk '/^export function syncIssues/,/^}/' "$VAULT/github.ts")"
grep -qE 'issues/\$\{' <<<"$sync_body" && bad 2 "syncIssues still makes a per-issue request (issues/\${…})"
grep -q 'state=open&per_page=100' "$VAULT/github.ts" || bad 2 "github.ts never lists issues?state=open&per_page=100"
doc="$(awk '/^\/\*\*/{buf=""} {buf=buf"\n"$0} /^export function syncIssues/{print buf; exit}' "$VAULT/github.ts")"
grep -qi 'open listing\|lists the open issues\|open issues' <<<"$doc" || bad 2 "syncIssues' doc comment does not say drops are found from the open listing"
grep -q 'read on its own' <<<"$doc" && bad 2 "syncIssues' doc comment still says each issue is read on its own"
grep -q 'by reading each open backlog issue the listing left out' "$VAULT/github.test.ts" && bad 2 "the old test name is still in github.test.ts"
need_tests 2 github.test.ts \
  "^drops a deleted and a transferred issue on an incremental sync" \
  "^an incremental sync over 45 open backlog issues makes no per-issue request" \
  "^an open listing of two pages is read whole" \
  "^an issue closed between the two listings is kept, with its closed state" \
  "^a closed issue is never re-read" \
  "^an issue closed since the last sync is kept, closed, not dropped" \
  "^an open-listing page shift never drops the issue that moved onto a page already read" \
  "^an open issue missing from the cache comes back on the next incremental sync, and leaves the dropped list" \
  "^the incremental sync after a full sync prunes a dropped entry whose issue the full sync listed again" \
  "^an issue deleted between the two open listings is not added back" \
  "^pull requests in the open listing are left out of the cache"

# --- Check 3: Status done, from S166's own snapshot ---
snap="$(find "$AUDIT_DIR" -type f -name '*-S166-snapshot.md' 2>/dev/null | awk -F/ '{ print $NF "\t" $0 }' | LC_ALL=C sort | tail -1 | cut -f2)"
if [ -z "$snap" ]; then
  bad 3 "S166 has no snapshot fragment"
else
  grep -qE '^\| Status \| `done` \|' "$snap" || bad 3 "$snap does not record Status done"
fi

# --- Check 4: fence ---
fence='^(scripts/backlog-vault/|docs/v3/backlog/|docs/v3/audit/|changelog\.d/|scripts/verify-S166\.sh$)'
while IFS= read -r f; do
  [ -z "$f" ] && continue
  grep -qE "$fence" <<<"$f" || bad 4 "outside the fence: $f"
done < <(story_own_changed_files S166 "$BASE" .)
own_added="$(story_own_diff S166 "$BASE" --name-status --diff-filter=A -- scripts/verify-S166.sh)"
[ -n "$own_added" ] || [ -n "$(git ls-files --others --exclude-standard -- scripts/verify-S166.sh)" ] || bad 4 "scripts/verify-S166.sh was not created by S166"

report "verify-S166"
exit $?
