#!/usr/bin/env bash
# Grader for BACKLOG story S136 — The month's game counts also name the teams playing each day.
# Each day of `GET /api/v1/schedule/month/:month` gains `teamIds` (the away and home team IDs of
# its stored games, each once, ascending; `[]` for a stored day with none; `null` when the count
# is), read by the same `listGameCounts` call as the counts; plus two domain functions S125's
# calendar calls: whether a day's teams include a favorite, and what a month's days say about its
# games. A commit-time proof of this story (S84).
# Contract: docs/v3/BACKLOG.md#verify-script-contract
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`).

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "each month day gains teamIds (away and home team IDs of every stored game, each once, ascending; [] for a stored day with none; null exactly when count is null), read by listGameCounts in one query (repository contract on PGlite and memory: doubleheader lists each team once, empty day []; route: unknown day count null and teamIds null; 2024-07 one listGameCounts call, no getByDate)"
check 2 "a day S124's fill stores answers with its teamIds in the same response, with still one schedule request for the range and no game request"
check 3 "one named, tested domain function answers whether a day's teamIds include a favorite: false for null, [], no favorites, and a day with no teamIds at all"
check 4 "one named, tested domain function answers a month's game state: games (a day above 0), none (at least one day, all 0), unknown (a null day with none above 0, or no days)"
check 5 "the OpenAPI spec carries teamIds (pnpm api:spec up to date), pnpm api:breaking exits 0, and web/src/api/generated/ is rendered from it so fetchScheduleMonth's result carries teamIds"
check 6 "backlog Status is done (story heading and Story status table), and the story stays inside its scope files"

BASE=9e72e02840f910dfb61821263324654afc3cabb2 # HEAD when S136 started; the story's work comes after it
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
DOMAIN="packages/domain/src/schedule-month.ts"
DOMAIN_TEST="src/schedule-month.test.ts"
SERVICE_TEST="src/services/schedule-month.test.ts"

# Runs one Vitest file (optionally filtered) and fails <id> unless it passes with at least one
# passing test.
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

# Each story-scoped test file runs once; an AC then needs at least one passing test whose full
# name carries its tag, and every test carrying the tag passes.
run_json() {
  local dir="$1" file="$2" out="$3"
  [ -f "$dir/$file" ] && (cd "$dir" && pnpm exec vitest run "$file" --reporter=json --outputFile="$out" >"$out.log" 2>&1)
  [ -f "$out" ] || echo '{"testResults":[]}' >"$out"
}
tagged() {
  local id="$1" json="$2" tag="$3" where="$4"
  node -e '
    const r = require(process.argv[1]);
    const tag = process.argv[2];
    const hits = r.testResults.flatMap((f) => f.assertionResults).filter((t) => t.fullName.includes(tag));
    process.exit(hits.length > 0 && hits.every((t) => t.status === "passed") ? 0 : 1);
  ' "$json" "$tag" || bad "$id" "no passing test in $where named \"$tag\""
}

SERVICE_JSON="$TMP/service.json"
run_json functions "$SERVICE_TEST" "$SERVICE_JSON"
MEMORY_JSON="$TMP/memory.json"
run_json functions src/adapters/memory/repos.contract.test.ts "$MEMORY_JSON"
PG_JSON="$TMP/pg.json"
run_json functions src/adapters/postgres/repos.contract.test.ts "$PG_JSON"
DOMAIN_JSON="$TMP/domain.json"
run_json packages/domain "$DOMAIN_TEST" "$DOMAIN_JSON"

# --- Check 1: teamIds on each day, read by listGameCounts -------------------------------------------------
awk '/^export interface ScheduleDayTally/,/^}/' "$DOMAIN" 2>/dev/null | grep -qE '^\s*teamIds: (readonly )?number\[\];' || bad 1 "ScheduleDayTally (the port's row) has no teamIds: number[]"
awk '/^export interface ScheduleDayCount/,/^}/' "$DOMAIN" 2>/dev/null | grep -qE '^\s*teamIds: number\[\] \| null;' || bad 1 "ScheduleDayCount has no teamIds: number[] | null"
grep -qE '^export function distinctTeamIds\(' "$DOMAIN" || bad 1 "$DOMAIN has no distinctTeamIds, the one de-duplicating and sorting both adapters share"
for f in functions/src/adapters/postgres/repos.ts functions/src/adapters/memory/repos.ts; do
  awk '/async listGameCounts\(/,/^\t}$/' "$f" | grep -qF 'distinctTeamIds(' || bad 1 "$f listGameCounts does not de-duplicate and sort through distinctTeamIds"
done
awk '/async listGameCounts\(/,/^\t}$/' functions/src/adapters/postgres/repos.ts | grep -qF 'jsonb_path_query_array' ||
  bad 1 "the Postgres listGameCounts does not read the team IDs in its one query (jsonb_path_query_array over document)"
grep -qE 'getByDate\(' functions/src/services/schedule-month.ts && bad 1 "the month service reads days one by one (getByDate)"
tagged 1 "$MEMORY_JSON" "S136 AC 1" "functions/src/adapters/memory/repos.contract.test.ts"
tagged 1 "$PG_JSON" "S136 AC 1" "functions/src/adapters/postgres/repos.contract.test.ts"
tagged 1 "$SERVICE_JSON" "S136 AC 1 route null" "functions/$SERVICE_TEST"
tagged 1 "$SERVICE_JSON" "S136 AC 1 one query" "functions/$SERVICE_TEST"
tagged 1 "$SERVICE_JSON" "S136 AC 1 teams" "functions/$SERVICE_TEST"
tagged 1 "$DOMAIN_JSON" "S136 AC 1" "packages/domain/$DOMAIN_TEST"

# --- Check 2: the fill answers teamIds, asking MLB nothing more ----------------------------------------------
tagged 2 "$SERVICE_JSON" "S136 AC 2" "functions/$SERVICE_TEST"

# --- Check 3: the favorite test for a day --------------------------------------------------------------------------
grep -qE '^export function dayHasFavoriteTeam\(' "$DOMAIN" || bad 3 "$DOMAIN has no dayHasFavoriteTeam"
tagged 3 "$DOMAIN_JSON" "S136 AC 3 null" "packages/domain/$DOMAIN_TEST"
tagged 3 "$DOMAIN_JSON" "S136 AC 3 empty" "packages/domain/$DOMAIN_TEST"
tagged 3 "$DOMAIN_JSON" "S136 AC 3 no favorites" "packages/domain/$DOMAIN_TEST"
tagged 3 "$DOMAIN_JSON" "S136 AC 3 cached before" "packages/domain/$DOMAIN_TEST"
tagged 3 "$DOMAIN_JSON" "S136 AC 3 match" "packages/domain/$DOMAIN_TEST"

# --- Check 4: the month's game state ----------------------------------------------------------------------------------
grep -qE '^export function monthGamesState\(' "$DOMAIN" || bad 4 "$DOMAIN has no monthGamesState"
for t in "every day 0" "every day null" "0 and null" "one above 0" "no days"; do
  tagged 4 "$DOMAIN_JSON" "S136 AC 4 $t" "packages/domain/$DOMAIN_TEST"
done

# --- Check 5: the spec and the web client's types ------------------------------------------------------------------------
node -e '
  const spec = require(process.argv[1]);
  const day = spec.components?.schemas?.ScheduleDayCount;
  process.exit(day?.properties?.teamIds && (day.required ?? []).includes("teamIds") ? 0 : 1);
' "$PWD/openapi/bt-api.v1.json" || bad 5 "openapi/bt-api.v1.json's ScheduleDayCount has no required teamIds"
if ! (cd functions && pnpm exec tsx src/scripts/generate-openapi.ts --check >"$TMP/spec.log" 2>&1); then
  bad 5 "openapi/bt-api.v1.json is stale (pnpm api:spec):"; tail -5 "$TMP/spec.log" | sed 's/^/        /'
fi
pnpm -s api:breaking >"$TMP/breaking.log" 2>&1 || { bad 5 "pnpm api:breaking fails:"; tail -10 "$TMP/breaking.log" | sed 's/^/        /'; }
awk '/^        ScheduleDayCount: \{/,/^        \};/' web/src/api/generated/bt-api.v1.ts | grep -qE 'teamIds: number\[\] \| null;' ||
  bad 5 "web/src/api/generated/bt-api.v1.ts's ScheduleDayCount has no teamIds: number[] | null"
run_vitest 5 web src/api/codegen.test.ts
run_vitest 5 web src/api/generated.types.test.ts

# --- Check 6: Status done, inside the fence ----------------------------------------------------------------------------
grep -qE '^\| [0-9]+ \| \[S136\].*\| `done` \|$' docs/v3/BACKLOG.md || bad 6 "S136 row in the Story status table is not \`done\`"
awk '/^### S136 —/{f=1;next} /^### S[0-9]/{f=0} f' docs/v3/BACKLOG.md >"$TMP/s136.md"
grep -qE '^\*\*Status:\*\* `done`$' "$TMP/s136.md" || bad 6 "S136 story heading Status is not \`done\`"
# core.quotepath=false: git otherwise prints a name with a non-ASCII character quoted (bug #87),
# so a frame note's path would fall outside the fence's pattern.
GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.quotepath GIT_CONFIG_VALUE_0=false story_changed_files S136 "$BASE" . |
  grep -vE '^(functions/src/|functions/vitest\.config\.ts$|packages/domain/|packages/ports/|openapi/|fixtures/|web/src/api/|docs/v3/BACKLOG\.md$|docs/v3/backlog/|docs/v3/AUDIT\.md$|docs/v3/audit\.jsonl$|docs/v3/INDEX\.md$|CHANGELOG\.md$|scripts/verify-S136\.sh$)' >"$TMP/fence.txt"
[ -s "$TMP/fence.txt" ] && bad 6 "the story changes files outside its scope: $(tr '\n' ' ' <"$TMP/fence.txt")"
# The Goal condition: nothing under scripts/ but this grader, nothing under the root test/ folder.
GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.quotepath GIT_CONFIG_VALUE_0=false story_changed_files S136 "$BASE" . |
  grep -E '^(test/|scripts/)' | grep -vE '^scripts/verify-S136\.sh$' >"$TMP/test-dir.txt"
[ -s "$TMP/test-dir.txt" ] && bad 6 "the story changes files under scripts/ or test/: $(tr '\n' ' ' <"$TMP/test-dir.txt")"

report "verify-S136"
exit $?
