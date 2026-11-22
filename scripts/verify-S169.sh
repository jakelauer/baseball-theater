#!/usr/bin/env bash
# Grader for backlog story S169 — the two scripts outside scripts/backlog-vault/ that decided whether
# they were started as a command by comparing two spellings of their own path (issue #315):
# e2e/select-specs.ts and web/src/api/codegen.ts now use `import.meta.main`, which resolves symlinks
# (owner, 2026-11-22: "Yes, a small story (Recommended)").
# Contract: frame note 00, "Verify-script contract" (docs/v3/backlog/frame/).
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`); runs the two
# story-scoped Vitest files once each and reads each one's result.

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "AC 1: e2e/select-specs.ts guards main with import.meta.main and compares no process.argv[1]; select-specs.test.ts passes with its existing CLI cases and a symlinked-folder case; started through a symlink with no arguments it prints its usage on stderr and exits 2"
check 2 "AC 2: web/src/api/codegen.ts guards its write with import.meta.main and compares no process.argv[1]; codegen.test.ts passes with its existing cases and a symlinked-folder case; started through a symlink it writes bt-api.v1.ts equal to the committed render"
check 3 "AC 3: S169's Status is done: its snapshot fragment records done"
check 4 "S169 changed no file outside its fence (plus creating scripts/verify-S169.sh)"

# The commit S169's own changes start from: `git merge-base origin/stage HEAD` when this grader was written.
BASE=cb0dc7fa

TMP="$(mktemp -d /tmp/verify-S169.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

SEL=e2e/select-specs.ts
GEN=web/src/api/codegen.ts

(cd e2e && ../node_modules/.bin/vitest run --reporter=json --outputFile="$TMP/e2e.json" select-specs.test.ts >"$TMP/e2e.log" 2>&1)
(cd web && ../node_modules/.bin/vitest run --reporter=json --outputFile="$TMP/web.json" src/api/codegen.test.ts >"$TMP/web.log" 2>&1)

# test_passed <report> <file> — the file ran, and every test in it passed.
test_passed() {
  [ -f "$1" ] || return 1
  node -e '
    const r = require(process.argv[1]);
    const f = r.testResults.find((t) => t.name.endsWith("/" + process.argv[2]));
    process.exit(f && f.status === "passed" && f.assertionResults.length > 0 ? 0 : 1);
  ' "$1" "$2"
}
# has_test <report> <file> <pattern> — a test in <file> whose title matches <pattern> (extended regex,
# any case) ran and passed: a skipped or todo test, or a title only in the source, never counts.
has_test() {
  [ -f "$1" ] || return 1
  node -e '
    const r = require(process.argv[1]);
    const f = r.testResults.find((t) => t.name.endsWith("/" + process.argv[2]));
    const re = new RegExp(process.argv[3], "i");
    process.exit(f && f.assertionResults.some((a) => a.status === "passed" && re.test(a.title)) ? 0 : 1);
  ' "$1" "$2" "$3"
}
# need_tests <check> <report> <file> <pattern>… — the file passes and has a passed test for each pattern.
need_tests() {
  local n="$1" rep="$2" f="$3"
  shift 3
  test_passed "$rep" "$f" || bad "$n" "$f is missing or failing"
  local p
  for p in "$@"; do has_test "$rep" "$f" "$p" || bad "$n" "$f has no passed test matching /$p/"; done
}

# --- Check 1: the spec selector runs however it is started ---
grep -qE '^if \(import\.meta\.main\)' "$SEL" || bad 1 "$SEL does not guard main with if (import.meta.main)"
grep -qE 'process\.argv\[1\]' "$SEL" && bad 1 "$SEL still compares process.argv[1]"
need_tests 1 "$TMP/e2e.json" select-specs.test.ts \
  "^prints nothing selected and false for an empty diff$" \
  "^exits nonzero when git can't diff$" \
  "^exits 2 on a bad command line$" \
  "^started through a symlinked folder with no arguments, prints its usage and exits 2$"
# The same end-to-end case here, outside Vitest: a symlink to e2e/ under /tmp.
ln -s "$PWD/e2e" "$TMP/e2e-link"
node "$TMP/e2e-link/select-specs.ts" >"$TMP/sel.out" 2>"$TMP/sel.err"
code=$?
[ "$code" -eq 2 ] || bad 1 "select-specs.ts through a symlink exited $code, not 2"
grep -q '^usage: node e2e/select-specs.ts' "$TMP/sel.err" || bad 1 "select-specs.ts through a symlink printed no usage on stderr"

# --- Check 2: the API type generator runs however it is started ---
grep -qE '^if \(import\.meta\.main\)' "$GEN" || bad 2 "$GEN does not guard its write with if (import.meta.main)"
grep -qE 'process\.argv\[1\]' "$GEN" && bad 2 "$GEN still compares process.argv[1]"
need_tests 2 "$TMP/web.json" codegen.test.ts \
  "^matches a fresh render of openapi/bt-api.v1.json$" \
  "^writes the render, banner first, into the directory it is given$" \
  "^started through a symlinked folder, writes the render into the directory it is given$"
ln -s "$PWD/web/src/api" "$TMP/api-link"
mkdir "$TMP/out"
node "$TMP/api-link/codegen.ts" "$TMP/out" >"$TMP/gen.out" 2>"$TMP/gen.err"
code=$?
[ "$code" -eq 0 ] || bad 2 "codegen.ts through a symlink exited $code"
if [ ! -f "$TMP/out/bt-api.v1.ts" ]; then
  bad 2 "codegen.ts through a symlink wrote no bt-api.v1.ts"
else
  # The committed output equals a fresh render (the drift gate case above), so it stands in for renderApiTypes().
  cmp -s "$TMP/out/bt-api.v1.ts" web/src/api/generated/bt-api.v1.ts || bad 2 "codegen.ts through a symlink wrote something other than the render"
fi

# --- Check 3: Status done, from S169's own snapshot ---
snap="$(find docs/v3/audit -type f -name '*-S169-snapshot.md' 2>/dev/null | awk -F/ '{ print $NF "\t" $0 }' | LC_ALL=C sort | tail -1 | cut -f2)"
if [ -z "$snap" ]; then
  bad 3 "S169 has no snapshot fragment"
else
  grep -qE '^\| Status \| `done` \|' "$snap" || bad 3 "$snap does not record Status done"
fi

# --- Check 4: fence ---
fence='^(e2e/select-specs\.ts|e2e/select-specs\.test\.ts|web/src/api/codegen\.ts|web/src/api/codegen\.test\.ts|scripts/verify-S169\.sh)$|^(docs/v3/backlog/|docs/v3/audit/|changelog\.d/)'
while IFS= read -r f; do
  [ -z "$f" ] && continue
  grep -qE "$fence" <<<"$f" || bad 4 "outside the fence: $f"
done < <(story_own_changed_files S169 "$BASE" .)
own_added="$(story_own_diff S169 "$BASE" --name-status --diff-filter=A -- scripts/verify-S169.sh)"
[ -n "$own_added" ] || [ -n "$(git ls-files --others --exclude-standard -- scripts/verify-S169.sh)" ] || bad 4 "scripts/verify-S169.sh was not created by S169"

report "verify-S169"
exit $?
