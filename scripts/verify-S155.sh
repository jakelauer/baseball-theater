#!/usr/bin/env bash
# Grader for story S155 — Standings before 1969: one table per league. MLB's answers for an early
# season are recorded (never typed), the mapper names a record group with no division by its league
# (one domain function, beside divisionName), the API answers the two league tables, and the page
# shows them with the existing DivisionTable (owner, 2026-11-19: "One table per league (Recommended)").
# A commit-time proof of this story (S84).
# Contract: docs/v3/backlog/frame/00 (Verify-script contract)
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`).

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "recorded, not typed: fixtures/raw/{seasons-1950,worldseries-1950,standings-1950-final,standings-1950-07-04}.json are MLB's verbatim answers (copyright line), fixtures/standings-1950-07-04.json is the mapped table, the standings ones parse with parseStandingsResponse (mapper test), and bundled.ts lists every file the fixture client reads by name (bundled.test.ts passes)"
check 2 "the mapper makes one table per league: leagueName in packages/domain beside divisionName, called by the mapper; mapper tests on the 1950-07-04 and 1950 final recordings (two tables, names, league ids, team count, first and last team; the committed mapped file equals the mapper's output on the raw one) and the existing 2026 tests pass"
check 3 "the API answers them: GET /api/v1/standings?date=1950-07-04 answers the two league tables at the top and in phases.regularSeason; ?date=1950-12-01 answers 1950's final as two league tables, or MLB's recorded dated table for that day (route tests named 1950)"
check 4 "the page shows them: StandingsPage, answered the committed fixtures/standings-1950-07-04.json, renders tables headed American League then National League with W, L, PCT, GB through DivisionTable; no new table component under web/src"
check 5 "files this story adds or edits don't call useMediaQuery, hiddenFrom or visibleFrom outside web/src/layout/"
check 6 "S155's snapshot records Status done (story_snapshot_status)"
check 7 "the story's own commits change nothing outside its scope files, except scripts/verify-S155.sh and its own records"

BASE=588b5c78b2db2da25fa66835310e947694093c9d
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

run_vitest() {
  local id="$1" dir="$2" file="$3"
  shift 3
  if [ ! -f "$dir/$file" ]; then
    bad "$id" "$dir/$file missing"
  elif ! (cd "$dir" && pnpm exec vitest run "$file" "$@" --reporter=json --outputFile="$TMP/r.json" >"$TMP/r.log" 2>&1); then
    bad "$id" "$dir/$file $* failed:"; tail -15 "$TMP/r.log" | sed 's/^/        /'
  elif ! node -e 'process.exit(require(process.argv[1]).numPassedTests > 0 ? 0 : 1)' "$TMP/r.json"; then
    bad "$id" "$dir/$file $* ran no passing test"
  fi
}

# --- Check 1: recorded, not typed ---------------------------------------------------------------------
for f in raw/seasons-1950.json raw/worldseries-1950.json raw/standings-1950-final.json raw/standings-1950-07-04.json; do
  if [ ! -f "fixtures/$f" ]; then
    bad 1 "fixtures/$f missing"
  else
    grep -q '"copyright":"Copyright' "fixtures/$f" || bad 1 "fixtures/$f is not MLB's verbatim answer (no copyright line)"
    grep -qF "\"$f\"" functions/src/adapters/fixtures/bundled.ts || bad 1 "bundled.ts does not list $f"
  fi
done
if [ ! -f fixtures/standings-1950-07-04.json ]; then
  bad 1 "fixtures/standings-1950-07-04.json missing"
else
  grep -qF '"standings-1950-07-04.json"' functions/src/adapters/fixtures/bundled.ts || bad 1 "bundled.ts does not list standings-1950-07-04.json"
fi
run_vitest 1 functions src/adapters/fixtures/bundled.test.ts

# --- Check 2: the mapper makes one table per league ----------------------------------------------------
grep -qE '^export function leagueName\(' packages/domain/src/team-colors.ts || bad 2 "packages/domain/src/team-colors.ts does not export leagueName beside divisionName"
grep -qE '\bleagueName\(' functions/src/mappers/standings.ts || bad 2 "functions/src/mappers/standings.ts does not call leagueName"
run_vitest 2 packages/domain src/team-colors.test.ts -t leagueName
run_vitest 2 functions src/mappers/standings.test.ts -t 1950
run_vitest 2 functions src/mappers/standings.test.ts

# --- Check 3: the API answers them ---------------------------------------------------------------------
grep -qF '1950-07-04' functions/src/handlers/api.test.ts || bad 3 "functions/src/handlers/api.test.ts has no 1950-07-04 route test"
grep -qF '1950-12-01' functions/src/handlers/api.test.ts || bad 3 "functions/src/handlers/api.test.ts has no 1950-12-01 route test"
run_vitest 3 functions src/handlers/api.test.ts -t 1950

# --- Check 4: the page shows them ----------------------------------------------------------------------
grep -qF 'standings-1950-07-04.json' web/src/pages/StandingsPage.test.tsx || bad 4 "StandingsPage.test.tsx does not answer the committed fixtures/standings-1950-07-04.json"
run_vitest 4 web src/pages/StandingsPage.test.tsx -t 1950
story_own_diff S155 "$BASE" --name-status -- web/src | awk '$1 == "A" && $2 ~ /Table[^/]*\.tsx$/ && $2 !~ /\.test\.tsx$/ { print $2 }' >"$TMP/tables.txt"
[ -s "$TMP/tables.txt" ] && bad 4 "a new table component is added: $(tr '\n' ' ' <"$TMP/tables.txt")"

# --- Check 5: no viewport queries outside web/src/layout/ ----------------------------------------------
story_own_changed_files S155 "$BASE" web/src | grep -v '^web/src/layout/' | while read -r f; do
  [ -f "$f" ] && grep -lE 'useMediaQuery|hiddenFrom|visibleFrom' "$f"
done >"$TMP/mq.txt"
[ -s "$TMP/mq.txt" ] && bad 5 "viewport queries outside web/src/layout/: $(tr '\n' ' ' <"$TMP/mq.txt")"

# --- Check 6: status ----------------------------------------------------------------------------------
status="$(story_snapshot_status S155)"
[ "$status" = "done" ] || bad 6 "S155's snapshot records Status '${status:-none}', not done"

# --- Check 7: the fence --------------------------------------------------------------------------------
story_own_changed_files S155 "$BASE" . | grep -vE '^(functions/src/|functions/vitest\.config\.ts$|packages/domain/|packages/mlb-api/|fixtures/|web/src/|web/vitest\.config\.ts$|docs/v3/backlog/|docs/v3/AUDIT\.md$|docs/v3/audit\.jsonl$|docs/v3/INDEX\.md$|CHANGELOG\.md$|scripts/verify-S155\.sh$|changelog\.d/S155\.md$|docs/v3/audit/[0-9-]+/[^/]*-S155-[a-z-]+\.md$)' >"$TMP/fence.txt"
[ -s "$TMP/fence.txt" ] && bad 7 "the story changes files outside its scope: $(tr '\n' ' ' <"$TMP/fence.txt")"

report "verify-S155"
exit $?
