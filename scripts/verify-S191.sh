#!/usr/bin/env bash
# Grader for story S191 — A favorite's off day follows that team's own regular season: each month
# day carries the teams of its regular-season games (regularSeasonTeamIds) and the teams in their own
# regular season that day, worked out from the year's stored days (inSeasonTeamIds); favoriteTeamsOff
# counts only favorites in season, falling back to S159's rule when the day can't tell.
# A commit-time proof of this story (S84).
# Contract: docs/v3/backlog/frame/00 (Verify-script contract)
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`).

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "ScheduleDayTally and ScheduleDayCount gain regularSeasonTeamIds: number[] | null, built in both schedule repository adapters by one domain function (dayRegularSeasonTeamIds, through distinctTeamIds), with its unit tests and a contract case each on PGlite and memory for a regular-only day, a mixed spring-and-regular day and an untyped day"
check 2 "one domain function (teamsInOwnSeason) works out, from a year's stored days, which teams are in their own regular season on each day (null when the year's stored days can't tell); ScheduleDayCount gains inSeasonTeamIds: number[] | null; the month service reads the year's stored days in one repository read per request (test counts reads) and asks MLB for no day outside the shown month, the season it needs coming from the scheduled refresh (S194), and a fill answers without a second read (owner, 2026-11-23: \"It should never fetch more than the one month. The year should be fetched server-side with a cron job\")"
check 3 "favoriteTeamsOff counts only favorites in day.inSeasonTeamIds, falling back to S159's rule when it is null or missing: table tests for the Seoul opener, the Tokyo openers, the 2018-10-01 tiebreakers, an ordinary mid-season day and a missing field all pass, and S159's own tests still pass"
check 4 "the OpenAPI spec carries both new fields as required on ScheduleDayCount (pnpm api:spec up to date), pnpm api:breaking exits 0, web/src/api/generated/ is rendered from it, and the month route's tests cover both fields"
check 5 "ScheduleDayCount's and favoriteTeamsOff's comments say the mark follows each team's own season, and S159's comment no longer describes the old limit as a known gap"
check 6 "S191's snapshot records Status done (story_snapshot_status), and the story stays inside its scope files (plus its own records and scripts/verify-S191.sh), touching nothing else under scripts/ or test/"

# The fence (check 6) reads only S191's own commits from here, through story_own_changed_files.
BASE=7f66da7c
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
DOMAIN="packages/domain/src/schedule-month.ts"

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
all_pass() {
  local id="$1" json="$2" where="$3"
  node -e '
    const r = require(process.argv[1]);
    const all = r.testResults.flatMap((f) => f.assertionResults);
    process.exit(all.length > 0 && all.every((t) => t.status === "passed") ? 0 : 1);
  ' "$json" || bad "$id" "$where has a failing (or no) test"
}

DOMAIN_JSON="$TMP/domain.json"; run_json packages/domain src/schedule-month.test.ts "$DOMAIN_JSON"
MEMORY_JSON="$TMP/memory.json"; run_json functions src/adapters/memory/repos.contract.test.ts "$MEMORY_JSON"
PG_JSON="$TMP/pg.json"; run_json functions src/adapters/postgres/repos.contract.test.ts "$PG_JSON"
SERVICE_JSON="$TMP/service.json"; run_json functions src/services/schedule-month.test.ts "$SERVICE_JSON"

# --- Check 1: the teams of each day's regular-season games -------------------------------------------------
for t in ScheduleDayTally ScheduleDayCount; do
  awk "/^export interface $t/,/^}/" "$DOMAIN" | grep -qE '^\s*regularSeasonTeamIds: number\[\] \| null;' || bad 1 "$t has no regularSeasonTeamIds: number[] | null"
done
grep -qE '^export function dayRegularSeasonTeamIds\(' "$DOMAIN" || bad 1 "$DOMAIN has no exported dayRegularSeasonTeamIds"
awk '/^export function dayRegularSeasonTeamIds\(/,/^}/' "$DOMAIN" | grep -qF 'distinctTeamIds(' || bad 1 "dayRegularSeasonTeamIds does not go through distinctTeamIds"
# The memory adapter may tally through scheduleDayTally (stage's #410 refactor), as long as that
# domain function builds the field through dayRegularSeasonTeamIds.
TALLY_OK=0
awk '/^export function scheduleDayTally\(/,/^}/' "$DOMAIN" | grep -qF 'dayRegularSeasonTeamIds(' && TALLY_OK=1
for f in functions/src/adapters/postgres/repos.ts functions/src/adapters/memory/repos.ts; do
  BODY="$(awk '/async listGameCounts\(/,/^\t}$/' "$f")"
  grep -qF 'dayRegularSeasonTeamIds(' <<<"$BODY" ||
    { [ "$f" = functions/src/adapters/memory/repos.ts ] && [ "$TALLY_OK" = 1 ] && grep -qF 'scheduleDayTally' <<<"$BODY"; } ||
    bad 1 "$f listGameCounts does not build regularSeasonTeamIds through dayRegularSeasonTeamIds"
done
[ "$(awk '/async listGameCounts\(/,/^\t}$/' functions/src/adapters/postgres/repos.ts | grep -c 'this.db.select')" = "1" ] || bad 1 "the Postgres listGameCounts does not read in exactly one query"
tagged 1 "$DOMAIN_JSON" "S191 AC 1" "packages/domain/src/schedule-month.test.ts"
for t in "regular only" "mixed" "untyped"; do
  tagged 1 "$MEMORY_JSON" "S191 AC 1 $t" "functions/src/adapters/memory/repos.contract.test.ts"
  tagged 1 "$PG_JSON" "S191 AC 1 $t" "functions/src/adapters/postgres/repos.contract.test.ts"
done

# --- Check 2: each team's own season, from the year ---------------------------------------------------------
grep -qE '^export function teamsInOwnSeason\(' "$DOMAIN" || bad 2 "$DOMAIN has no exported teamsInOwnSeason"
awk '/^export interface ScheduleDayCount/,/^}/' "$DOMAIN" | grep -qE '^\s*inSeasonTeamIds: number\[\] \| null;' || bad 2 "ScheduleDayCount has no inSeasonTeamIds: number[] | null"
awk '/^export function monthGameCounts\(/,/^}/' "$DOMAIN" | grep -qF 'teamsInOwnSeason(' || bad 2 "monthGameCounts does not call teamsInOwnSeason"
grep -qF 'monthGameCounts(' functions/src/services/schedule-month.ts || bad 2 "the month service does not build its days through monthGameCounts"
grep -qE 'getByDate\(' functions/src/services/schedule-month.ts && bad 2 "the month service reads days one by one (getByDate)"
grep -qE 'SEASON_MONTHS|yearFillable' functions/src/services/schedule-month.ts && bad 2 "the month service still asks MLB for other months of the year"
for t in "seoul" "first game in the month before" "untyped day" "unstored day" "off-season" "boundary" "untyped beside R"; do
  tagged 2 "$DOMAIN_JSON" "S191 AC 2 $t" "packages/domain/src/schedule-month.test.ts"
done
tagged 2 "$SERVICE_JSON" "S191 AC 2 one read" "functions/src/services/schedule-month.test.ts"
# The owner's 2026-11-23 answer ("It should never fetch more than the one month. The year should be
# fetched server-side with a cron job"): a read asks MLB for the shown month only; S194's refresh
# stores the year, and a day the stored year can't tell answers null.
for t in "month only" "cron year" "fill read" "outside window" "year lifetime"; do
  tagged 2 "$SERVICE_JSON" "S191 AC 2 $t" "functions/src/services/schedule-month.test.ts"
done

# --- Check 3: the mark follows the team's season -------------------------------------------------------------
SIG="$(awk '/^export function favoriteTeamsOff\(/,/^\{/' "$DOMAIN" | tr -d '\n\t')"
grep -qE 'favoriteTeamsOff\(day: [A-Za-z]+, favoriteTeamIds: readonly number\[\], monthDays: readonly [A-Za-z]+\[\]\)' <<<"$SIG" ||
  bad 3 "favoriteTeamsOff's signature changed from (day, favoriteTeamIds, monthDays)"
awk '/^export interface MonthDayTeams/,/^}/' "$DOMAIN" | grep -qE 'inSeasonTeamIds\?: readonly number\[\] \| null;' || bad 3 "MonthDayTeams has no optional inSeasonTeamIds?: readonly number[] | null"
for t in "seoul yankees with spring" "seoul yankees without spring" "seoul dodgers" "seoul padres and yankees" \
  "tokyo 2019" "tokyo 2025" "tokyo 2019-03-22 mariners" "tiebreaker yankees" "tiebreaker cubs and yankees" "tiebreaker cardinals" \
  "mid-season" "missing" "null"; do
  tagged 3 "$DOMAIN_JSON" "S191 AC 3 $t" "packages/domain/src/schedule-month.test.ts"
done
tagged 3 "$DOMAIN_JSON" "S159 AC 1" "packages/domain/src/schedule-month.test.ts"
all_pass 3 "$DOMAIN_JSON" "packages/domain/src/schedule-month.test.ts"

# --- Check 4: in the API -------------------------------------------------------------------------------------
node -e '
  const spec = require(process.argv[1]);
  const day = spec.components?.schemas?.ScheduleDayCount;
  const ok = ["regularSeasonTeamIds", "inSeasonTeamIds"].every((k) => day?.properties?.[k] && (day.required ?? []).includes(k));
  process.exit(ok ? 0 : 1);
' "$PWD/openapi/bt-api.v1.json" || bad 4 "openapi/bt-api.v1.json's ScheduleDayCount lacks required regularSeasonTeamIds and inSeasonTeamIds"
if ! (cd functions && pnpm exec tsx src/scripts/generate-openapi.ts --check >"$TMP/spec.log" 2>&1); then
  bad 4 "openapi/bt-api.v1.json is stale (pnpm api:spec):"; tail -5 "$TMP/spec.log" | sed 's/^/        /'
fi
pnpm -s api:breaking >"$TMP/breaking.log" 2>&1 || { bad 4 "pnpm api:breaking fails:"; tail -10 "$TMP/breaking.log" | sed 's/^/        /'; }
GEN="$(awk '/^        ScheduleDayCount: \{/,/^        \};/' web/src/api/generated/bt-api.v1.ts)"
grep -qE 'regularSeasonTeamIds: number\[\] \| null;' <<<"$GEN" || bad 4 "web/src/api/generated/bt-api.v1.ts's ScheduleDayCount has no regularSeasonTeamIds"
grep -qE 'inSeasonTeamIds: number\[\] \| null;' <<<"$GEN" || bad 4 "web/src/api/generated/bt-api.v1.ts's ScheduleDayCount has no inSeasonTeamIds"
tagged 4 "$SERVICE_JSON" "S191 AC 4" "functions/src/services/schedule-month.test.ts"

# --- Check 5: comments are true ------------------------------------------------------------------------------
awk '/^export interface ScheduleDayCount/,/^}/' "$DOMAIN" | grep -qiE "own (regular )?season" || bad 5 "ScheduleDayCount's comments don't say the mark follows each team's own season"
awk '/^ \* Which of a fan.s favorite teams are off/,/^export function favoriteTeamsOff/' "$DOMAIN" | grep -qiE "own (regular )?season" || bad 5 "favoriteTeamsOff's comment doesn't say the mark follows each team's own season"
grep -qE "follow-up story is planned|Ship now, fix later" "$DOMAIN" && bad 5 "$DOMAIN still describes the per-day limit as a known gap awaiting a follow-up"

# --- Check 6: Status done, inside the fence ------------------------------------------------------------------
[ "$(story_snapshot_status S191)" = "done" ] || bad 6 "S191's snapshot does not record Status done"
story_own_changed_files S191 "$BASE" . >"$TMP/changed.txt"
grep -vE '^(packages/domain/|packages/ports/src/repositories\.ts$|functions/src/|functions/vitest\.config\.ts$|openapi/|web/src/api/generated/|web/src/api/generated\.types\.test\.ts$|web/src/test/calendar\.tsx$|web/src/api/client\.test\.ts$|docs/v3/backlog/|docs/v3/audit/|changelog\.d/|scripts/verify-S191\.sh$)' "$TMP/changed.txt" >"$TMP/fence.txt"
[ -s "$TMP/fence.txt" ] && bad 6 "the story changes files outside its scope: $(tr '\n' ' ' <"$TMP/fence.txt")"
grep -E '^(test/|scripts/)' "$TMP/changed.txt" | grep -vE '^scripts/verify-S191\.sh$' >"$TMP/test-dir.txt"
[ -s "$TMP/test-dir.txt" ] && bad 6 "the story changes files under scripts/ or test/: $(tr '\n' ' ' <"$TMP/test-dir.txt")"

report "verify-S191"
exit $?
