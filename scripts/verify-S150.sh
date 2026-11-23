#!/usr/bin/env bash
# Grader for story S150 — one stored copy of a game's shared state (status, linescore, live moment):
# a `game_states` table written through one switch (`gameStateSource` / `switchGameState`) that hands
# the row to the live feed while the game is in its window and to the schedule otherwise (owner,
# 2026-11-17: "a single point which switches sources"), read by the day and game reads.
# A commit-time proof of this story (S84).
# Contract: docs/v3/backlog/frame/00 (Verify-script contract)
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`).

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "the shared state: GameState in packages/domain with gameStateFromSummary and gameStateFromGame; domain unit tests and the recorded-pair tests (live moment from scheduleMomentsAt at LIVE_FIXTURE_TIMECODE, final pair from mapScheduleGame on fixtures/raw/schedule-2026-09-05.json) pass"
check 2 "the feed's own time beside the game: FetchedGame { game, feedTime? } in packages/domain, returned by fetchGame and fetchGameFeed in packages/ports/src/mlb.ts; GameSnapshot has no feedTime; the HTTP adapter's test reads the feed time as ISO; the stored game and the hub's push carry no feedTime; openapi/bt-api.v1.json unchanged and never names feedTime"
check 3 "one table: game_states in schema.ts with a generated migration, GameStateRepository in ports with Postgres and in-memory adapters under the contract tests, listed in data-classification.ts, COPY_RULES, GAME_TABLES and README (table list and pg_dump line); the copy and migration tests pass"
check 4 "the switch: gameStateSource in packages/domain and switchGameState in functions/src/services/game-state.ts, the only caller of the repository's write; its tests pass"
check 5 "writers hand over every poll: StoredScheduleDay in packages/domain; storeSchedule and storeGame call switchGameState; fixtures unchanged; the writer tests pass"
check 6 "readers use it: joinScheduleDay in packages/domain, readScheduleDay and servedGame in functions/src/services/, served_base on schedule_days, servedGame used by getOrRefreshGame, the game hub's first send and the ingest's publish; the reader tests pass; openapi unchanged"
check 7 "S150's snapshot records Status done (story_snapshot_status)"
check 8 "the story's own commits change nothing outside its scope files, except scripts/verify-S150.sh and its own records"

BASE=1f0261e74574a3b3c4bb7a4bfbc8c32b5ac793a9
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

has() { # has <id> <file> <extended regex> <what>
  if [ ! -f "$2" ]; then bad "$1" "$2 missing"; elif ! grep -qE "$3" "$2"; then bad "$1" "$2: $4"; fi
}

DOMAIN=packages/domain/src/game-state.ts
SERVICE=functions/src/services/game-state.ts

# --- Check 1: the shared state ---------------------------------------------------------------------
has 1 "$DOMAIN" '^export type GameState\b' "no exported GameState type"
has 1 "$DOMAIN" '^export function gameStateFromSummary\(' "no gameStateFromSummary builder"
has 1 "$DOMAIN" '^export function gameStateFromGame\(' "no gameStateFromGame builder"
has 1 packages/domain/src/index.ts 'game-state\.js' "index.ts does not export game-state.js"
run_vitest 1 packages/domain src/game-state.test.ts -t "S150 AC 1"
has 1 functions/src/services/game-state.test.ts 'scheduleMomentsAt' "the recorded-pair test does not use scheduleMomentsAt"
has 1 functions/src/services/game-state.test.ts 'schedule-2026-09-05\.json' "the recorded-pair test does not read fixtures/raw/schedule-2026-09-05.json"
run_vitest 1 functions src/services/game-state.test.ts -t "S150 AC 1"

# --- Check 2: the feed's own time, never stored on the game -----------------------------------------
has 2 "$DOMAIN" '^export type FetchedGame\b' "no exported FetchedGame type"
has 2 packages/ports/src/mlb.ts 'fetchGame\(gamePk: number\): Promise<FetchedGame>' "fetchGame does not return FetchedGame"
has 2 packages/ports/src/mlb.ts 'fetchGameFeed\(gamePk: number\): Promise<FetchedGame>' "fetchGameFeed does not return FetchedGame"
grep -qE '^\s*feedTime\??:' packages/domain/src/types.ts && bad 2 "packages/domain/src/types.ts declares a feedTime field (it must never be on the game)"
grep -q 'feedTime' openapi/bt-api.v1.json && bad 2 "openapi/bt-api.v1.json names feedTime"
[ -n "$(story_own_changed_files S150 "$BASE" openapi)" ] && bad 2 "the story changes openapi/: $(story_own_changed_files S150 "$BASE" openapi | tr '\n' ' ')"
run_vitest 2 functions src/adapters/http/mlb.test.ts -t "S150 AC 2"
run_vitest 2 functions src/services/game-state.test.ts -t "S150 AC 2"

# --- Check 3: one table -----------------------------------------------------------------------------
has 3 functions/src/adapters/postgres/schema.ts 'pgTable\("game_states"' "no game_states table"
for col in game_pk version source feed_time official_date start_time document; do
  grep -A14 'pgTable("game_states"' functions/src/adapters/postgres/schema.ts 2>/dev/null | grep -q "\"$col\"" || bad 3 "game_states has no $col column"
done
story_own_changed_files S150 "$BASE" functions/src/adapters/postgres/migrations | grep -E '\.sql$' >"$TMP/mig.txt"
if [ ! -s "$TMP/mig.txt" ]; then
  bad 3 "no migration added under functions/src/adapters/postgres/migrations/"
else
  grep -l 'CREATE TABLE "game_states"' $(cat "$TMP/mig.txt") >/dev/null 2>&1 || bad 3 "the story's migration does not create game_states"
fi
has 3 packages/ports/src/repositories.ts '^export interface GameStateRepository\b' "no GameStateRepository port"
has 3 functions/src/adapters/postgres/repos.ts 'class PostgresGameStateRepository implements GameStateRepository' "no Postgres adapter"
has 3 functions/src/adapters/memory/repos.ts 'class InMemoryGameStateRepository implements GameStateRepository' "no in-memory adapter"
has 3 functions/src/adapters/repository-contract.ts 'describeGameStateContract' "the repository contract has no game-state case"
has 3 functions/src/adapters/memory/repos.contract.test.ts 'describeGameStateContract' "the memory contract test does not run the game-state case"
has 3 functions/src/adapters/postgres/repos.contract.test.ts 'describeGameStateContract' "the Postgres contract test does not run the game-state case"
run_vitest 3 functions src/adapters/memory/repos.contract.test.ts -t "game state"
run_vitest 3 functions src/adapters/postgres/repos.contract.test.ts -t "game state"
has 3 functions/src/services/data-classification.ts '\bgame_states:' "the data classification manifest does not list game_states"
has 3 functions/src/services/baseball-copy.ts '^\s*game_states:' "COPY_RULES has no rule for game_states"
has 3 functions/src/services/backfill-report.ts 'GAME_TABLES = \[[^]]*"game_states"' "GAME_TABLES does not name game_states"
has 3 README.md '`game_states`' "README's table lists do not name game_states"
has 3 README.md 'pg_dump[^`]*-t game_states' "README's pg_dump line does not name game_states"
run_vitest 3 functions src/services/baseball-copy.test.ts -t "S150 AC 3"
run_vitest 3 functions src/adapters/postgres/migrate.test.ts -t "S150 AC 3"

# --- Check 4: the switch ----------------------------------------------------------------------------
has 4 "$DOMAIN" '^export function gameStateSource\(' "no gameStateSource in packages/domain"
has 4 "$SERVICE" '^export async function switchGameState\(' "no switchGameState in functions/src/services/game-state.ts"
grep -rnE 'gameStates\.write\(' functions/src packages --include='*.ts' 2>/dev/null | grep -vE '\.test\.ts:|^functions/src/services/game-state\.ts:|^functions/src/adapters/repository-contract\.ts:' >"$TMP/writers.txt"
[ -s "$TMP/writers.txt" ] && bad 4 "the game-state write is called outside switchGameState: $(cut -d: -f1,2 "$TMP/writers.txt" | tr '\n' ' ')"
run_vitest 4 packages/domain src/game-state.test.ts -t "S150 AC 4"
run_vitest 4 functions src/services/game-state.test.ts -t "S150 AC 4"

# --- Check 5: writers hand over every poll ----------------------------------------------------------
has 5 "$DOMAIN" '^export type StoredScheduleDay\b' "no StoredScheduleDay type"
awk '/^export async function storeSchedule\(/,/^}/' functions/src/services/ingest.ts | grep -q 'switchGameState' || bad 5 "storeSchedule does not call switchGameState"
awk '/^async function storeGame\(|^export async function storeGame\(/,/^}/' functions/src/services/ingest.ts | grep -q 'switchGameState' || bad 5 "storeGame does not call switchGameState"
[ -n "$(story_own_changed_files S150 "$BASE" fixtures)" ] && bad 5 "the story changes fixtures/: $(story_own_changed_files S150 "$BASE" fixtures | tr '\n' ' ')"
run_vitest 5 functions src/services/game-state.test.ts -t "S150 AC 5"

# --- Check 6: readers use it ------------------------------------------------------------------------
has 6 "$DOMAIN" '^export function joinScheduleDay\(' "no joinScheduleDay in packages/domain"
has 6 "$SERVICE" '^export async function readScheduleDay\(' "no readScheduleDay in functions/src/services/game-state.ts"
has 6 "$SERVICE" '^export function servedGame\(' "no servedGame in functions/src/services/game-state.ts"
has 6 functions/src/adapters/postgres/schema.ts '"served_base"' "schedule_days has no served_base column"
awk '/^export async function getOrRefreshGame\(/,/^}/' functions/src/services/ingest.ts | grep -qE 'servedGame|readServedGame' || bad 6 "getOrRefreshGame does not serve servedGame"
has 6 functions/src/game-hub-object.ts 'readServedGame|servedGame' "the game hub's first send does not use the served game"
has 6 functions/src/services/game-ingest.ts 'readServedGame|servedGame' "the ingest object's publish does not use the served game"
run_vitest 6 packages/domain src/game-state.test.ts -t "S150 AC 6"
run_vitest 6 functions src/services/game-state.test.ts -t "S150 AC 6"

# --- Check 7: status --------------------------------------------------------------------------------
status="$(story_snapshot_status S150)"
[ "$status" = "done" ] || bad 7 "S150's snapshot records Status '${status:-none}', not done"

# --- Check 8: the fence -----------------------------------------------------------------------------
story_own_changed_files S150 "$BASE" . | grep -vE '^(functions/src/|packages/domain/|packages/ports/|README\.md$|docs/v3/backlog/|docs/v3/AUDIT\.md$|docs/v3/audit\.jsonl$|docs/v3/INDEX\.md$|CHANGELOG\.md$|scripts/verify-S150\.sh$|changelog\.d/S150\.md$|docs/v3/audit/[0-9-]+/[^/]*-S150-[a-z-]+\.md$)' >"$TMP/fence.txt"
[ -s "$TMP/fence.txt" ] && bad 8 "the story changes files outside its scope: $(tr '\n' ' ' <"$TMP/fence.txt")"

report "verify-S150"
exit $?
