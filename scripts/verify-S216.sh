#!/usr/bin/env bash
# Grader for story S216 — an on-read refresh answers from the data it formed (no read-back, no repeat read), reads a
# day's games in one batched read, writes what carries no version of the answer after the response (BackgroundWork),
# and keeps a slow playMetrics from holding a cold game's answer.
# A commit-time proof of this story (S84).
# Contract: frame note 00, "Verify-script contract" (docs/v3/backlog/frame/).
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`); runs only the story-scoped Vitest
# files named below, once, and reads each test's result by name.
#
# Red-first counts (S216 AC 4), the same test on HEAD ea39e6ea (after S212): a cold 15-game digest made 144 round trips,
# a cold game 9, a cold day 24, a stored, fresh digest 32.

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "AC 1: getOrRefreshGame answers servedGame of the stamped snapshot and the switch's row (no readServedGame), storeGame takes the caller's stored snapshot, storeSchedule the caller's stored day and served base and builds the day with joinStoredScheduleDay, getScheduleRead judges pastFinished from the formed day; the schedules upsert reports the served base it stored; tests named 'S216 AC 1' pass (no read-back or repeat read on a cold game, day and digest; answers equal a fresh read after the flush; a dropped game's served base; a refused awaited write answers the stored version)"
check 2 "AC 2: GameRepository.getMany, GameRepository.upsertMany and GameProjectionRepository.upsertMany in packages/ports/src, held to the repository contract (tests named 'S216 AC 2' pass in both adapters' contract tests: 0, 1 and 15 keys, per-key refusals); a cold digest makes one games.getMany and one gameStates.getMany for its games (test named 'S216 AC 2' in ingest.round-trips.test.ts)"
check 3 "AC 3: a BackgroundWork port in packages/ports/src; the Worker hands it to ctx.waitUntil inside inDatabaseScope, the Node server runs it and logs a failure, a test double records it to flush; only a cache-window refresh on read defers (projections, purges gathered into one purgeGameEdge, the playMetrics follow-up); the hand-written date and settledness pre-filters are gone from ingest.ts; tests named 'S216 AC 3' pass (answer complete before the flush, projection after, a refused deferred write logged, a failed one never fails the request, game ingest writes before it publishes)"
check 4 "AC 4: the round-trip bounds are expect()ed with toBeLessThanOrEqual — cold digest 7 before its answer and 9 in all, cold game 4 and 6, cold day 4 and 5, stored fresh digest 4 — and those tests (named 'S216 AC 4') pass with an edgePurge composed on 2021-06-15"
check 5 "AC 5: functions/src/adapters/http/mlb.ts has one named playMetrics time-limit constant of 750 ms with a comment giving the value and why; tests named 'S216 AC 5' pass (answer within the limit without playMetrics, stored with them after the flush and the game's and its day's URLs purged after the write, an answer inside the limit purges nothing, a refused follow-up retries once, a second refusal is logged)"
check 6 "AC 6: the named comments say what they now do (getOrRefreshGame, getOrRefreshSchedule, storeGame, storeSchedule, getDayDigest, fetchGame, the BackgroundWork port and its adapters name S216) and docs/v3/ARCHITECTURE.md gains a dated S216 note under ADR-021 or ADR-022"
check 7 "AC 7: S216 changed no file outside its fence (plus creating scripts/verify-S216.sh and its own records); its snapshot records Status done"

# The commit S216's own changes start from: `git merge-base origin/stage HEAD` when this grader was written.
BASE=ea39e6ea15935a5fe0777470b72f54ea11871c93

TMP="$(mktemp -d /tmp/verify-S216.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

FN_TESTS=(src/services/ingest.round-trips.test.ts src/services/ingest.play-metrics.test.ts src/adapters/background-work.test.ts
	src/services/game-ingest.test.ts src/adapters/memory/repos.contract.test.ts src/adapters/postgres/repos.contract.test.ts)
fn_present=()
for t in "${FN_TESTS[@]}"; do [ -f "functions/$t" ] && fn_present+=("$t"); done
if [ "${#fn_present[@]}" -gt 0 ]; then
	(cd functions && pnpm exec vitest run "${fn_present[@]}" --reporter=json --outputFile="$TMP/functions.json" >"$TMP/functions.log" 2>&1)
fi
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
# body_of <file> <declaration text> — the declaration through its closing brace at column 0.
body_of() {
	awk -v pat="$2" 'index($0, pat) {on=1} on {print} on && /^}/ {exit}' "$1" 2>/dev/null
}

ING=functions/src/services/ingest.ts
RT=src/services/ingest.round-trips.test.ts

# --- Check 1: answer from the data formed ---
game_fn="$(body_of "$ING" 'export async function getOrRefreshGame(')"
[ -n "$game_fn" ] || bad 1 "getOrRefreshGame not found in $ING"
grep -qF 'readServedGame(deps, gamePk' <<<"$game_fn" && bad 1 "getOrRefreshGame still reads the game back after its refresh (readServedGame)"
# storeGame / storeGames take the snapshot their caller read (ingestGame's one read, the read path's getMany).
store_fns="$(body_of "$ING" 'async function storeGames(')$(body_of "$ING" 'async function storeGame(')"
grep -qE 'deps\.games\.getByPk\(' <<<"$store_fns" && bad 1 "storeGame still re-reads the stored snapshot"
grep -qF 'await deps.schedules.getByDate(fetched.date)' "$ING" && bad 1 "storeSchedule still re-reads the stored day"
grep -qF 'joinStoredScheduleDay(' "$ING" || bad 1 "ingest.ts does not build the served day with joinStoredScheduleDay"
read_fn="$(body_of "$ING" 'export async function getScheduleRead(')"
[ "$(grep -c 'readJoinedScheduleDay(' <<<"$read_fn")" -le 1 ] || bad 1 "getScheduleRead still reads the day back after its refresh"
grep -qE 'upsert\(day: StoredScheduleDay\): Promise<number \| null>' packages/ports/src/repositories.ts || bad 1 "ScheduleRepository.upsert does not report the served base it stored (Promise<number | null>)"
for name in "S216 AC 1 cold game no read-back" "S216 AC 1 cold day no read-back" "S216 AC 1 cold digest no read-back" "S216 AC 1 answers equal a fresh read" "S216 AC 1 dropped game served base" "S216 AC 1 refused game write answers the stored version" "S216 AC 1 refused day write answers the stored version"; do
	in_file "$FN" "$RT" "$name" || bad 1 "test '$name' did not pass"
done

# --- Check 2: batched reads and multi-row upserts ---
PORTS=packages/ports/src/repositories.ts
game_port="$(awk '/^export interface GameRepository/,/^}/' "$PORTS")"
grep -qE 'getMany\(gamePks: readonly number\[\]\): Promise<GameSnapshot\[\]>' <<<"$game_port" || bad 2 "GameRepository has no getMany(gamePks)"
grep -qE 'upsertMany\(' <<<"$game_port" || bad 2 "GameRepository has no upsertMany"
grep -qE 'upsertMany\(' <<<"$(awk '/^export interface GameProjectionRepository/,/^}/' "$PORTS")" || bad 2 "GameProjectionRepository has no upsertMany"
for f in src/adapters/memory/repos.contract.test.ts src/adapters/postgres/repos.contract.test.ts; do
	in_file "$FN" "$f" "S216 AC 2 games getMany 0, 1 and 15 keys" || bad 2 "$f: games getMany contract test did not pass"
	in_file "$FN" "$f" "S216 AC 2 games upsertMany reports refusals" || bad 2 "$f: games upsertMany contract test did not pass"
	in_file "$FN" "$f" "S216 AC 2 projections upsertMany reports refusals" || bad 2 "$f: projections upsertMany contract test did not pass"
	in_file "$FN" "$f" "S216 AC 1 schedules upsert reports its served base" || bad 2 "$f: schedules upsert served-base contract test did not pass"
done
in_file "$FN" "$RT" "S216 AC 2 one games.getMany and one gameStates.getMany" || bad 2 "test 'S216 AC 2 one games.getMany and one gameStates.getMany' did not pass"

# --- Check 3: writes after the answer ---
grep -qE '^export interface BackgroundWork' packages/ports/src/*.ts 2>/dev/null || bad 3 "no BackgroundWork port in packages/ports/src"
W=functions/src/worker.ts
fetch_fn="$(awk '/async fetch\(/,/^\t},/' "$W")"
grep -qF 'inDatabaseScope(' <<<"$fetch_fn" && grep -qF 'waitUntil' <<<"$fetch_fn" || bad 3 "the Worker's fetch does not run its deferred work through waitUntil inside inDatabaseScope"
grep -qE 'Background' functions/src/local-server.ts || bad 3 "local-server.ts composes no BackgroundWork adapter"
grep -qF 'stored.date >= mlbToday(now)' "$ING" && bad 3 "wasPastFinishedDay's hand-written date pre-filter is still there"
grep -qF 'isSettledGame(' "$ING" && bad 3 "ingest.ts still hand-filters by isSettledGame instead of isPastFinishedGame / isPastFinishedDay alone"
for name in "S216 AC 3 answer complete before the flush" "S216 AC 3 refused deferred write logged" "S216 AC 3 failed deferred write never fails the request" "S216 AC 3 one deferred purge"; do
	in_file "$FN" "$RT" "$name" || bad 3 "test '$name' did not pass"
done
in_file "$FN" src/adapters/background-work.test.ts "S216 AC 3" || bad 3 "the BackgroundWork adapters' tests ('S216 AC 3') did not pass"
in_file "$FN" src/services/game-ingest.test.ts "S216 AC 3 game ingest writes before it publishes" || bad 3 "test 'S216 AC 3 game ingest writes before it publishes' did not pass"

# --- Check 4: the bound ---
RTF="functions/$RT"
for bound in 'before).toBeLessThanOrEqual(7)' 'total).toBeLessThanOrEqual(9)' 'before).toBeLessThanOrEqual(4)' 'total).toBeLessThanOrEqual(6)' 'total).toBeLessThanOrEqual(5)' 'stored).toBeLessThanOrEqual(4)'; do
	grep -qF "$bound" "$RTF" 2>/dev/null || bad 4 "$RTF does not expect $bound"
done
for name in "S216 AC 4 cold digest" "S216 AC 4 cold game" "S216 AC 4 cold day" "S216 AC 4 stored fresh digest"; do
	in_file "$FN" "$RT" "$name" || bad 4 "test '$name' did not pass"
done

# --- Check 5: playMetrics' time limit ---
M=functions/src/adapters/http/mlb.ts
grep -qE '^(export )?const PLAY_METRICS_LIMIT_MS = 750;' "$M" || bad 5 "$M has no PLAY_METRICS_LIMIT_MS = 750 constant"
doc_of "$M" 'const PLAY_METRICS_LIMIT_MS' | grep -qE '0\.71' || bad 5 "PLAY_METRICS_LIMIT_MS's comment does not give the probe's 0.71–0.78 s"
for name in "S216 AC 5 answers within the limit" "S216 AC 5 inside the limit purges nothing" "S216 AC 5 refused follow-up retries once" "S216 AC 5 second refusal logged"; do
	in_file "$FN" src/services/ingest.play-metrics.test.ts "$name" || bad 5 "test '$name' did not pass"
done

# --- Check 6: comments and the ARCHITECTURE note ---
for decl in 'export async function getOrRefreshGame(' 'export async function getOrRefreshSchedule(' 'async function storeGame' 'export async function storeSchedule('; do
	doc_of "$ING" "$decl" | grep -q 'S216' || bad 6 "the comment on '$decl' does not name S216"
done
doc_of functions/src/services/digest.ts 'export async function getDayDigest(' | grep -q 'S216' || bad 6 "getDayDigest's comment does not name S216"
doc_of "$M" 'async fetchGame(gamePk' | grep -q 'S216' || bad 6 "fetchGame's comment does not name S216"
grep -B12 -E '^export interface BackgroundWork' packages/ports/src/*.ts 2>/dev/null | grep -q 'S216' || bad 6 "the BackgroundWork port's comment does not name S216"
grep -q 'S216' functions/src/adapters/background-work.ts 2>/dev/null || bad 6 "the BackgroundWork adapters' comments do not name S216"
story_own_diff S216 "$BASE" -- docs/v3/ARCHITECTURE.md | grep -E '^\+' | grep -E '2026-11-2[0-9]' | grep -q 'S216' || bad 6 "docs/v3/ARCHITECTURE.md gains no dated note naming S216"

# --- Check 7: fence and status ---
fence='^(packages/domain/|packages/ports/src/|functions/src/|functions/vitest\.config\.ts$|functions/vitest\.workers\.config\.ts$|docs/v3/ARCHITECTURE\.md$|docs/v3/backlog/|docs/v3/audit/|changelog\.d/S216\.md$|scripts/verify-S216\.sh$)'
while IFS= read -r f; do
	[ -z "$f" ] && continue
	grep -qE "$fence" <<<"$f" || bad 7 "outside the fence: $f"
done < <(story_own_changed_files S216 "$BASE" .)
own_added="$(story_own_diff S216 "$BASE" --name-status --diff-filter=A -- scripts/verify-S216.sh)"
[ -n "$own_added" ] || [ -n "$(git ls-files --others --exclude-standard -- scripts/verify-S216.sh)" ] || bad 7 "scripts/verify-S216.sh was not created by S216"
[ "$(story_snapshot_status S216)" = "done" ] || bad 7 "S216's snapshot does not record Status done"

report "verify-S216"
exit $?
