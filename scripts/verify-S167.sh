#!/usr/bin/env bash
# Grader for story S167 — Each day of the month answer says whether a regular-season game was
# played. Each stored schedule game keeps MLB's `gameType`; one domain function turns a day's game
# types into `true` / `false` / `null`; `listGameCounts` reads the types in its one query and each
# day of `GET /api/v1/schedule/month/:month` gains `regularSeason`; the backfill re-stores days
# stored before S167 once per run; the fixtures carry the types; the spec and web types follow.
# A commit-time proof of this story (S84).
# Contract: docs/v3/backlog/frame/00 (Verify-script contract)
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`).

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "ScheduleGameSummary gains an optional gameType, copied by mapScheduleGame from the upstream game and left out when MLB sends none (schedule.test.ts: R kept, A kept, none absent)"
check 2 "one domain function in schedule-month.ts answers whether a day has a regular-season game from its game types (true when any is R; false when every game is typed and none is R, an empty day included; null when none is R and one is untyped), used by both repository adapters, with its unit tests"
check 3 "listGameCounts returns each day's game types (one per game, null when untyped) from its one query, and each month day gains regularSeason: boolean | null through ScheduleDayCount and monthGameCounts (contract on PGlite and memory: R+S true, A false, untyped null, R+untyped true, S+untyped null; route: unknown day null)"
check 4 "a backfill-only check beside isScheduleDaySettled says a stored day has an untyped game; the backfill re-stores such a day once per run and counts it complete, a typed day asks MLB nothing, and ingest still skips a settled untyped day"
check 5 "every game in fixtures/schedule-*.json carries its gameType (R for the 2024-07-04, 2026-09-05 and 823823 games), and the fixture-backed month answer for July 2024 says regularSeason true for 2024-07-04"
check 6 "the OpenAPI spec carries regularSeason (pnpm api:spec up to date), pnpm api:breaking exits 0, and web/src/api/generated/ is rendered from it so fetchScheduleMonth's days carry regularSeason"
check 7 "S167's snapshot records Status done (story_snapshot_status), and the story stays inside its scope files (plus its own records and scripts/verify-S167.sh)"

# The fence (check 7) reads only S167's own commits from here, through story_own_changed_files.
BASE=3fb98f9d
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
DOMAIN="packages/domain/src/schedule-month.ts"
DOMAIN_BACKFILL="packages/domain/src/backfill.ts"
TYPES="packages/domain/src/types.ts"

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
run_vitest() {
  local id="$1" dir="$2" file="$3"
  if [ ! -f "$dir/$file" ]; then
    bad "$id" "$dir/$file missing"
  elif ! (cd "$dir" && pnpm exec vitest run "$file" --reporter=json --outputFile="$TMP/v.json" >"$TMP/v.log" 2>&1); then
    bad "$id" "$dir/$file failed:"; tail -15 "$TMP/v.log" | sed 's/^/        /'
  fi
}

MAPPER_JSON="$TMP/mapper.json"; run_json functions src/mappers/schedule.test.ts "$MAPPER_JSON"
DOMAIN_JSON="$TMP/domain.json"; run_json packages/domain src/schedule-month.test.ts "$DOMAIN_JSON"
DBF_JSON="$TMP/dbf.json"; run_json packages/domain src/backfill.test.ts "$DBF_JSON"
MEMORY_JSON="$TMP/memory.json"; run_json functions src/adapters/memory/repos.contract.test.ts "$MEMORY_JSON"
PG_JSON="$TMP/pg.json"; run_json functions src/adapters/postgres/repos.contract.test.ts "$PG_JSON"
SERVICE_JSON="$TMP/service.json"; run_json functions src/services/schedule-month.test.ts "$SERVICE_JSON"
BACKFILL_JSON="$TMP/backfill.json"; run_json functions src/services/backfill.test.ts "$BACKFILL_JSON"
INGEST_JSON="$TMP/ingest.json"; run_json functions src/services/ingest.test.ts "$INGEST_JSON"

# --- Check 1: each stored game keeps its game type ---------------------------------------------------------
awk '/^export type ScheduleGameSummary = \{/,/^\};/' "$TYPES" | grep -qE '^\s*gameType\?: string;' || bad 1 "ScheduleGameSummary has no optional gameType?: string"
awk '/^export function mapScheduleGame\(/,/^}/' functions/src/mappers/schedule.ts | grep -qF 'gameType' || bad 1 "mapScheduleGame does not copy gameType"
for t in "S167 AC 1 regular" "S167 AC 1 all-star" "S167 AC 1 none"; do
  tagged 1 "$MAPPER_JSON" "$t" "functions/src/mappers/schedule.test.ts"
done

# --- Check 2: one function says whether a day has a regular-season game -----------------------------------
grep -qE '^export function dayRegularSeason\(' "$DOMAIN" || bad 2 "$DOMAIN has no dayRegularSeason"
for f in functions/src/adapters/postgres/repos.ts functions/src/adapters/memory/repos.ts; do
  awk '/async listGameCounts\(/,/^\t}$/' "$f" | grep -qF 'dayRegularSeason(' || bad 2 "$f listGameCounts does not answer regularSeason through dayRegularSeason"
done
for t in "R among others" "only S" "only A" "postseason" "no games" "S and untyped" "R and untyped"; do
  tagged 2 "$DOMAIN_JSON" "S167 AC 2 $t" "packages/domain/src/schedule-month.test.ts"
done

# --- Check 3: the month answer carries it --------------------------------------------------------------------
awk '/^export interface ScheduleDayTally/,/^}/' "$DOMAIN" | grep -qE '^\s*gameTypes: \(string \| null\)\[\];' || bad 3 "ScheduleDayTally has no gameTypes: (string | null)[]"
awk '/^export interface ScheduleDayCount/,/^}/' "$DOMAIN" | grep -qE '^\s*regularSeason: boolean \| null;' || bad 3 "ScheduleDayCount has no regularSeason: boolean | null"
awk '/^export function monthGameCounts\(/,/^}/' "$DOMAIN" | grep -qF 'regularSeason' || bad 3 "monthGameCounts does not answer regularSeason"
PGLC="$(awk '/async listGameCounts\(/,/^\t}$/' functions/src/adapters/postgres/repos.ts)"
grep -qF "jsonb_array_elements" <<<"$PGLC" || bad 3 "the Postgres listGameCounts does not read each game's gameType over jsonb_array_elements (keeping untyped games as null)"
grep -qF "\$.games[*].gameType" <<<"$PGLC" && bad 3 "the Postgres listGameCounts reads gameType through jsonb_path_query_array, which drops untyped games"
[ "$(grep -c 'this.db.select' <<<"$PGLC")" = "1" ] || bad 3 "the Postgres listGameCounts does not read in exactly one query"
grep -qE 'getByDate\(' functions/src/services/schedule-month.ts && bad 3 "the month service reads days one by one (getByDate)"
for t in "R and S" "all-star" "untyped" "R and untyped" "S and untyped"; do
  tagged 3 "$MEMORY_JSON" "S167 AC 3 $t" "functions/src/adapters/memory/repos.contract.test.ts"
  tagged 3 "$PG_JSON" "S167 AC 3 $t" "functions/src/adapters/postgres/repos.contract.test.ts"
done
tagged 3 "$SERVICE_JSON" "S167 AC 3 route null" "functions/src/services/schedule-month.test.ts"
tagged 3 "$DOMAIN_JSON" "S167 AC 3" "packages/domain/src/schedule-month.test.ts"

# --- Check 4: days stored before S167 can be re-stored ------------------------------------------------------
grep -qE '^export function scheduleDayLacksGameType\(' "$DOMAIN_BACKFILL" || bad 4 "$DOMAIN_BACKFILL has no scheduleDayLacksGameType beside isScheduleDaySettled"
awk '/^export function isScheduleDaySettled\(/,/^}/' "$DOMAIN_BACKFILL" | grep -qF 'gameType' && bad 4 "isScheduleDaySettled changed to read gameType (ingest shares it and must skip what it skips today)"
[ "$(git show "$BASE:$DOMAIN_BACKFILL" | awk '/^export function isScheduleDaySettled\(/,/^}/')" = "$(awk '/^export function isScheduleDaySettled\(/,/^}/' "$DOMAIN_BACKFILL")" ] ||
  bad 4 "isScheduleDaySettled changed (ingest shares it and must skip exactly the days it skips today)"
grep -qF 'scheduleDayLacksGameType(' functions/src/services/backfill.ts || bad 4 "the backfill does not ask scheduleDayLacksGameType"
tagged 4 "$DBF_JSON" "S167 AC 4" "packages/domain/src/backfill.test.ts"
for t in "untyped re-stored" "typed asks nothing" "MLB sends none"; do
  tagged 4 "$BACKFILL_JSON" "S167 AC 4 $t" "functions/src/services/backfill.test.ts"
done
tagged 4 "$INGEST_JSON" "S167 AC 4 ingest" "functions/src/services/ingest.test.ts"

# --- Check 5: the fixtures carry it --------------------------------------------------------------------------
node -e '
  const fs = require("fs");
  const files = fs.readdirSync("fixtures").filter((f) => /^schedule-.*\.json$/.test(f));
  let ok = files.length > 0;
  for (const f of files) {
    const day = JSON.parse(fs.readFileSync("fixtures/" + f, "utf8"));
    for (const g of day.games ?? []) {
      if (typeof g.gameType !== "string") { console.error(`${f}: game ${g.gamePk} has no gameType`); ok = false; }
      const mustBeR = ["schedule-2024-07-04.json", "schedule-2026-09-05.json"].includes(f) || g.gamePk === 823823;
      if (mustBeR && g.gameType !== "R") { console.error(`${f}: game ${g.gamePk} is not R`); ok = false; }
    }
  }
  process.exit(ok ? 0 : 1);
' 2>"$TMP/fixtures.log" || { bad 5 "fixtures lack game types:"; sed 's/^/        /' "$TMP/fixtures.log"; }
tagged 5 "$SERVICE_JSON" "S167 AC 5" "functions/src/services/schedule-month.test.ts"

# --- Check 6: the spec and the web client's types ------------------------------------------------------------
node -e '
  const spec = require(process.argv[1]);
  const day = spec.components?.schemas?.ScheduleDayCount;
  process.exit(day?.properties?.regularSeason && (day.required ?? []).includes("regularSeason") ? 0 : 1);
' "$PWD/openapi/bt-api.v1.json" || bad 6 "openapi/bt-api.v1.json's ScheduleDayCount has no required regularSeason"
if ! (cd functions && pnpm exec tsx src/scripts/generate-openapi.ts --check >"$TMP/spec.log" 2>&1); then
  bad 6 "openapi/bt-api.v1.json is stale (pnpm api:spec):"; tail -5 "$TMP/spec.log" | sed 's/^/        /'
fi
pnpm -s api:breaking >"$TMP/breaking.log" 2>&1 || { bad 6 "pnpm api:breaking fails:"; tail -10 "$TMP/breaking.log" | sed 's/^/        /'; }
awk '/^        ScheduleDayCount: \{/,/^        \};/' web/src/api/generated/bt-api.v1.ts | grep -qE 'regularSeason: boolean \| null;' ||
  bad 6 "web/src/api/generated/bt-api.v1.ts's ScheduleDayCount has no regularSeason: boolean | null"
run_vitest 6 web src/api/codegen.test.ts
run_vitest 6 web src/api/generated.types.test.ts

# --- Check 7: Status done, inside the fence ------------------------------------------------------------------
[ "$(story_snapshot_status S167)" = "done" ] || bad 7 "S167's snapshot does not record Status done"
story_own_changed_files S167 "$BASE" . >"$TMP/changed.txt"
grep -vE '^(functions/src/|packages/domain/|packages/ports/|openapi/|fixtures/|web/src/api/|docs/v3/backlog/|docs/v3/audit/|changelog\.d/|scripts/verify-S167\.sh$)' "$TMP/changed.txt" >"$TMP/fence.txt"
[ -s "$TMP/fence.txt" ] && bad 7 "the story changes files outside its scope: $(tr '\n' ' ' <"$TMP/fence.txt")"
grep -E '^(test/|scripts/)' "$TMP/changed.txt" | grep -vE '^scripts/verify-S167\.sh$' >"$TMP/test-dir.txt"
[ -s "$TMP/test-dir.txt" ] && bad 7 "the story changes files under scripts/ or test/: $(tr '\n' ' ' <"$TMP/test-dir.txt")"

report "verify-S167"
exit $?
