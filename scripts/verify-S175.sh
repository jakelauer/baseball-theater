#!/usr/bin/env bash
# Grader for backlog story S175 — one copy of "this standings table has no team": the standings
# service calls the domain's `standingsHasNoTeams` (S130) and its private `isEmpty` goes (ADR-025;
# enhancement #340; owner, 2026-11-22: "Yes, a small story (Recommended)").
# Contract: frame note 00, "Verify-script contract" (docs/v3/backlog/frame/).
# No network (the service tests serve fixtures/raw through recordedClient), no writes outside /tmp.
# Does its own checking (never `pnpm verify`); runs the story-scoped Vitest files once and reads each
# one's result from Vitest's JSON report.

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "AC 1: functions/src/services/standings.ts imports standingsHasNoTeams from @bt/domain and calls it at the four call sites; no isEmpty and no 'teams.length === 0' remain under functions/src/ outside tests"
check 2 "AC 2: every test file under functions/src/ importing the standings service, and the route tests serving /api/v1/standings through handlers/api.js, ran and passed; standings.test.ts has a passed S175 case for each call site's empty-table paths (no divisions, divisions with no team, one team), the first spring morning still not missing"
check 3 "AC 3: standingsHasNoTeams's comment no longer says the service keeps its own copy and names the service as a caller; S175's own diff of packages/domain/src/standings-phase.ts touches comment lines only"
check 4 "AC 4: S175 changed no file outside its fence (plus creating scripts/verify-S175.sh), and its snapshot records Status done"

# The commit S175's own changes start from: `git merge-base origin/stage HEAD` when this grader was written.
BASE=c751d6d9

TMP="$(mktemp -d /tmp/verify-S175.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

SERVICE=functions/src/services/standings.ts
SERVICE_TEST=functions/src/services/standings.test.ts
PHASE=packages/domain/src/standings-phase.ts

# --- Check 1: one copy ---
if [ ! -f "$SERVICE" ]; then
	bad 1 "$SERVICE is missing"
else
	# The value import from @bt/domain (the multi-line `import { … } from "@bt/domain";` block) names it.
	imports="$(awk '/^import \{/,/from "@bt\/domain";/' "$SERVICE")"
	grep -qw 'standingsHasNoTeams' <<<"$imports" || bad 1 "$SERVICE does not import standingsHasNoTeams from @bt/domain"
	calls="$(grep -o 'standingsHasNoTeams(' "$SERVICE" | wc -l | tr -d ' ')"
	[ "$calls" -ge 4 ] || bad 1 "$SERVICE calls standingsHasNoTeams $calls times, not at all four call sites"
fi
left="$(grep -rnw 'isEmpty' functions/src --include='*.ts' | grep -v '\.test\.ts:')"
[ -z "$left" ] || bad 1 "isEmpty remains outside tests: $(head -3 <<<"$left" | tr '\n' ' ')"
copies="$(grep -rnF 'teams.length === 0' functions/src --include='*.ts' | grep -v '\.test\.ts:')"
[ -z "$copies" ] || bad 1 "another 'teams.length === 0' check remains outside tests: $(head -3 <<<"$copies" | tr '\n' ' ')"

# --- Check 2: every caller still behaves the same ---
# Test files that import the service itself, and the route tests: test files importing handlers/api.js
# (which calls getStandings and standingsNothingYet) that name the standings route.
callers() {
	# The service's own folder imports it as ./standings.js; anywhere else names services/standings.js.
	grep -lE 'from "\./standings\.js"' functions/src/services/*.test.ts
	grep -rlE 'from "(\.\./)+services/standings\.js"' functions/src --include='*.test.ts'
	grep -rlE 'from "(\./|\.\./)+(handlers/)?api\.js"' functions/src --include='*.test.ts' | xargs grep -l 'v1/standings'
}
files=()
while IFS= read -r f; do
	[ -n "$f" ] && files+=("${f#functions/}")
done < <(callers 2>/dev/null | grep -v '\.workerd\.test\.ts$' | sort -u)
[ "${#files[@]}" -gt 0 ] || files=(none)
for need in src/services/standings.test.ts src/handlers/api.test.ts; do
	printf '%s\n' "${files[@]}" | grep -qx "$need" || bad 2 "functions/$need was not found among the standings callers' tests"
done
(cd functions && ../node_modules/.bin/vitest run --reporter=json --outputFile="$TMP/report.json" "${files[@]}" >"$TMP/vitest.log" 2>&1)
# test_passed <file> — the file ran, and every test in it passed.
test_passed() {
	[ -f "$TMP/report.json" ] || return 1
	node -e '
		const r = require(process.argv[1]);
		const f = r.testResults.find((t) => t.name.endsWith("/" + process.argv[2]));
		process.exit(f && f.status === "passed" && f.assertionResults.length > 0 ? 0 : 1);
	' "$TMP/report.json" "$1"
}
# has_test <file> <pattern> — a test in <file> whose title matches <pattern> (extended regex) ran and passed.
has_test() {
	[ -f "$TMP/report.json" ] || return 1
	node -e '
		const r = require(process.argv[1]);
		const f = r.testResults.find((t) => t.name.endsWith("/" + process.argv[2]));
		const re = new RegExp(process.argv[3]);
		process.exit(f && f.assertionResults.some((a) => a.status === "passed" && re.test(a.title)) ? 0 : 1);
	' "$TMP/report.json" "$1" "$2"
}
for f in "${files[@]}"; do
	test_passed "$f" || bad 2 "functions/$f is missing or failing"
done
for p in \
	"^S175 AC 2: opening day's own table" \
	"^S175 AC 2: the first spring morning's spring table" \
	"^S175 AC 2: S128's table" \
	"^S175 AC 2: nothing yet"; do
	has_test src/services/standings.test.ts "$p" || bad 2 "$SERVICE_TEST has no passed test matching /$p/"
done

# --- Check 3: the comment is true ---
doc="$(awk '/^\/\*\*/ { buf = "" } { buf = buf $0 "\n" } /^export function standingsHasNoTeams\(/ { printf "%s", buf; exit }' "$PHASE")"
if [ -z "$doc" ]; then
	bad 3 "$PHASE has no standingsHasNoTeams"
else
	comment="$(grep -v '^export function' <<<"$doc" | tr '\n' ' ')"
	grep -qiE 'own copy|still has' <<<"$comment" && bad 3 "standingsHasNoTeams's comment still says the service keeps its own copy"
	grep -qE 'functions/src/services/standings\.ts|standings service' <<<"$comment" || bad 3 "standingsHasNoTeams's comment does not name the standings service as a caller"
fi
# Every added or removed line of S175's own diff of the file is a comment line (` * …`, `/**`, ` */`).
code="$(story_own_diff S175 "$BASE" -U0 -- "$PHASE" | grep -E '^[+-]' | grep -vE '^(\+\+\+|---) ' | grep -vE '^[+-][[:space:]]*(/\*\*|\*/|\*( |$))')"
[ -z "$code" ] || bad 3 "S175 changed code in $PHASE: $(head -3 <<<"$code" | tr '\n' ' ')"

# --- Check 4: fence and Status ---
fence='^(functions/src/services/standings\.ts$|functions/src/services/standings\.test\.ts$|packages/domain/src/standings-phase\.ts$|docs/v3/backlog/|docs/v3/audit/|changelog\.d/|scripts/verify-S175\.sh$)'
while IFS= read -r f; do
	[ -z "$f" ] && continue
	grep -qE "$fence" <<<"$f" || bad 4 "outside the fence: $f"
done < <(story_own_changed_files S175 "$BASE" .)
own_added="$(story_own_diff S175 "$BASE" --name-status --diff-filter=A -- scripts/verify-S175.sh)"
[ -n "$own_added" ] || [ -n "$(git ls-files --others --exclude-standard -- scripts/verify-S175.sh)" ] || bad 4 "scripts/verify-S175.sh was not created by S175"
status="$(story_snapshot_status S175)"
[ "$status" = "done" ] || bad 4 "S175's snapshot records Status '${status:-none}', not done"

report "verify-S175"
exit $?
