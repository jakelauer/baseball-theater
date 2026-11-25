#!/usr/bin/env bash
# Grader for story S219 — an older Worker (from before S161) never lists a path-only owed edge purge, so it never
# sends the edge a batch it refuses; the current Worker still clears those owes under its origin, and a refused URL
# never holds up the full-URL owes listed beside it.
# A commit-time proof of this story (S84).
# Contract: frame note 00, "Verify-script contract" (docs/v3/backlog/frame/).
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`); runs only the story-scoped Vitest
# file named below, once, and reads each test's result by name.

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "AC 1: after the win-probability fill on PGlite, the pre-S161 listing query (written down in the test, with S161's parent commit named) lists no path-only owe now, a day and 29 days later (also after a failed retry), while a full-URL owe beside them is listed; path-only owes recorded before S219's migration are hidden the same way after it (tests named 'S219 AC 1' pass in win-probability-fill.test.ts)"
check 2 "AC 2: retryOwedEdgePurges purges the fill's owes under its origin on its next allowed tick before the give-up and settles them, every URL the purger receives absolute (test named 'S219 AC 2' passes)"
check 3 "AC 3: with a purger refusing any URL not starting https://, a full-URL owe listed in the same tick as the fill's owes is purged that tick (test named 'S219 AC 3' passes)"
check 4 "AC 4: the comments on retryOwedEdgePurges, listDue and the fill say what older code sees and why (each names S219 and an older Worker)"
check 5 "AC 5: S219 changed no file outside its fence (plus creating scripts/verify-S219.sh and its own records); its snapshot records Status done"

# The commit S219's own changes start from: `git merge-base origin/stage HEAD` when this grader was written.
BASE=d2db5c96739ee21acf0d509d00d876fa38eea3a6

TMP="$(mktemp -d /tmp/verify-S219.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

T=src/adapters/postgres/win-probability-fill.test.ts
(cd functions && pnpm exec vitest run "$T" --reporter=json --outputFile="$TMP/functions.json" >"$TMP/functions.log" 2>&1)
FN="$TMP/functions.json"

# in_file <report> <file suffix> <regex> — a test whose full name matches ran in that file, and every such test passed.
in_file() {
	[ -f "$1" ] || return 1
	node -e '
		const r = require(process.argv[1]);
		const f = r.testResults.find((x) => x.name.endsWith(process.argv[2]));
		const re = new RegExp(process.argv[3]);
		const hit = f ? f.assertionResults.filter((t) => re.test(t.fullName)) : [];
		process.exit(hit.length > 0 && hit.every((t) => t.status === "passed") ? 0 : 1);
	' "$1" "$2" "$3"
}
# doc_of <file> <text the declaration line contains> — the comment block right above the declaration (a fixed string).
doc_of() {
	awk -v pat="$2" '/\/\*\*/{buf=""} {buf=buf"\n"$0} index($0, pat) {print buf; exit}' "$1" 2>/dev/null
}

# --- Check 1: an older Worker never lists a path-only owe ---
TF="functions/$T"
grep -qF 'f152a44d' "$TF" || bad 1 "the test does not name S161's parent commit (f152a44d) for the pre-S161 query"
grep -qF 'function preS161ListDue(' "$TF" || bad 1 "the test does not write down the pre-S161 listing query (preS161ListDue)"
for name in "S219 AC 1 older Worker never lists a path-only owe" "S219 AC 1 rows already owed"; do
	in_file "$FN" "$T" "$name" || bad 1 "test '$name' did not pass"
done

# --- Check 2: the current Worker still clears them ---
in_file "$FN" "$T" "S219 AC 2 the current Worker clears the fill's owes" || bad 2 "test 'S219 AC 2 the current Worker clears the fill's owes' did not pass"

# --- Check 3: a refused batch doesn't hold up the rest ---
in_file "$FN" "$T" "S219 AC 3 a refused URL doesn't hold up the rest" || bad 3 "test 'S219 AC 3 a refused URL doesn't hold up the rest' did not pass"

# --- Check 4: comments are true ---
doc_of functions/src/services/edge-purge.ts 'export async function retryOwedEdgePurges(' | grep -q 'S219' || bad 4 "retryOwedEdgePurges's comment does not name S219"
doc_of functions/src/services/edge-purge.ts 'export async function retryOwedEdgePurges(' | grep -qi 'older' || bad 4 "retryOwedEdgePurges's comment does not say what older code sees"
listdue_doc="$(doc_of functions/src/adapters/postgres/repos.ts 'async listDue(at: string, limit: number)')"
grep -q 'S219' <<<"$listdue_doc" || bad 4 "listDue's comment does not name S219"
grep -qi 'older' <<<"$listdue_doc" || bad 4 "listDue's comment does not say what older code sees"
head -40 functions/src/adapters/postgres/win-probability-fill.ts | grep -q 'S219' || bad 4 "the fill's module comment does not name S219"
head -40 functions/src/adapters/postgres/win-probability-fill.ts | grep -qi 'older' || bad 4 "the fill's module comment does not say what older code sees"

# --- Check 5: fence and status ---
fence='^(functions/src/|functions/vitest\.config\.ts$|docs/v3/backlog/|docs/v3/audit/|changelog\.d/S219\.md$|scripts/verify-S219\.sh$)'
while IFS= read -r f; do
	[ -z "$f" ] && continue
	grep -qE "$fence" <<<"$f" || bad 5 "outside the fence: $f"
done < <(story_own_changed_files S219 "$BASE" .)
own_added="$(story_own_diff S219 "$BASE" --name-status --diff-filter=A -- scripts/verify-S219.sh)"
[ -n "$own_added" ] || [ -n "$(git ls-files --others --exclude-standard -- scripts/verify-S219.sh)" ] || bad 5 "scripts/verify-S219.sh was not created by S219"
[ "$(story_snapshot_status S219)" = "done" ] || bad 5 "S219's snapshot does not record Status done"

report "verify-S219"
exit $?
