#!/usr/bin/env bash
# Grader for story S212 — past, finished days and games served from BT's own copy with no MLB call
# on read, long edge lifetimes for them, the edge copy purged (by URL) when a write really changes
# one, and the cron re-checking each recently finished game's full detail every six hours.
# A commit-time proof of this story (S84).
# Contract: frame note 00, "Verify-script contract" (docs/v3/backlog/frame/).
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`); runs only the
# story-scoped Vitest files named below, once per package, and reads each test's result by name.

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "AC 1: packages/domain/src/past-finished.ts exports isPastFinishedDay (mlbToday, windowMode cache, isScheduleDaySettled with the moved set) and isPastFinishedGame (isSettledGame, windowMode cache as of now, officialDate before mlbToday); tests named 'S212 AC 1' pass (yesterday final, today final, suspended not moved, suspended moved away, stored active, 03:00 UTC, game, live-ingested)"
check 2 "AC 2: the day, game and digest reads serve stored past, finished data with zero MLB requests on a fresh RefreshCoordinator; unstored, today, future, unfinished and ?refresh=1 still ask MLB (tests named 'S212 AC 2' pass in ingest.past.test.ts and digest.test.ts)"
check 3 "AC 3: cache-control.ts has PAST_EDGE_TTL_S = 2592000, PAST_STALE_S = 86400, PAST_BROWSER_MAX_AGE_S = 3600 and PAST_CACHE_CONTROL from them; the three routes send it for past, finished data, a partial past digest the floor, everything else today's header (tests named 'S212 AC 3' pass)"
check 4 "AC 4: an EdgeCachePurger port in packages/ports/src; a Cloudflare adapter (purge_cache, files, BT_CF_PURGE_TOKEN, BT_CF_ZONE_ID, PURGE_URLS_PER_REQUEST = 30; '101 urls' in 4 requests) and a memory double; a no-op without credentials or BT_APP_ORIGIN; storeSchedule and storeGame purge the schedule, digest and game URLs of a changed or new past, finished day or game (tests named 'S212 AC 4' pass)"
check 5 "AC 5: recheckDueGame in functions/src/services/game-recheck.ts, run by scheduled() in its own waitUntil under tickAllowed; RECENT_GAME_RECHECK_DAYS = 7 in packages/domain; a durable recheck record (game_rechecks migration, both adapters, contract tests 'S212 AC 5'); its comment states the budget; tests named 'S212 AC 5' pass"
check 6 "AC 6: needsRefresh and RefreshCoordinator.lastRefreshedAt stay, and their comments say they no longer decide a past, finished read"
check 7 "AC 7: docs/v3/ARCHITECTURE.md's ADR-021 amendment carries the owner's words and names S212"
check 8 "AC 8: the named comments say what they now do (each of edgeCacheControl, needsRefresh, getOrRefreshSchedule, getOrRefreshGame, getDayDigest, fillScheduleMonth, refreshDueScheduleMonth and scheduled() names S212)"
check 9 "AC 9: S212's Status is done (its snapshot records done)"
check 10 "S212 changed no file outside its fence (plus creating scripts/verify-S212.sh and its own records)"

# The commit S212's own changes start from: `git merge-base origin/stage HEAD` when this grader was written.
BASE=be5fbfc8763e28da22bc3260068a0ee306fc32e6

TMP="$(mktemp -d /tmp/verify-S212.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

FN_TESTS=(src/services/ingest.past.test.ts src/services/digest.test.ts src/handlers/api.past-cache.test.ts src/services/edge-purge.test.ts
	src/adapters/cloudflare/edge-cache-purger.test.ts src/services/game-recheck.test.ts src/worker.test.ts src/worker-app.test.ts
	src/adapters/postgres/repos.contract.test.ts src/adapters/memory/repos.contract.test.ts src/services/data-classification.test.ts src/services/baseball-copy.test.ts)
DOMAIN_TESTS=(src/past-finished.test.ts)
fn_present=()
for t in "${FN_TESTS[@]}"; do [ -f "functions/$t" ] && fn_present+=("$t"); done
dom_present=()
for t in "${DOMAIN_TESTS[@]}"; do [ -f "packages/domain/$t" ] && dom_present+=("$t"); done
if [ "${#fn_present[@]}" -gt 0 ]; then
	(cd functions && pnpm exec vitest run "${fn_present[@]}" --reporter=json --outputFile="$TMP/functions.json" >"$TMP/functions.log" 2>&1) &
fi
if [ "${#dom_present[@]}" -gt 0 ]; then
	(cd packages/domain && pnpm exec vitest run "${dom_present[@]}" --reporter=json --outputFile="$TMP/domain.json" >"$TMP/domain.log" 2>&1) &
fi
wait

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
# file_passed <report> <file suffix> — the file ran, and every test in it passed.
file_passed() {
	[ -f "$1" ] || return 1
	node -e '
		const r = require(process.argv[1]);
		const f = r.testResults.find((x) => x.name.endsWith(process.argv[2]));
		process.exit(f && f.assertionResults.length > 0 && f.assertionResults.every((t) => t.status === "passed") ? 0 : 1);
	' "$1" "$2"
}
# doc_of <file> <text the declaration line contains> — the comment block right above the declaration (a fixed string,
# not a regex, so a "(" in it needs no escaping).
doc_of() {
	awk -v pat="$2" '/\/\*\*/{buf=""} {buf=buf"\n"$0} index($0, pat) {print buf; exit}' "$1" 2>/dev/null
}
FN="$TMP/functions.json"
DOM="$TMP/domain.json"

# --- Check 1: one rule for "past and finished" ---
PF=packages/domain/src/past-finished.ts
grep -qE '^export function isPastFinishedDay\(' "$PF" 2>/dev/null || bad 1 "$PF exports no isPastFinishedDay"
grep -qE '^export function isPastFinishedGame\(' "$PF" 2>/dev/null || bad 1 "$PF exports no isPastFinishedGame"
day_fn="$(awk '/^export function isPastFinishedDay/,/^}/' "$PF" 2>/dev/null)"
for token in 'mlbToday(' 'isScheduleDaySettled(' '"cache"' 'moved'; do
	grep -qF -- "$token" <<<"$day_fn" || bad 1 "isPastFinishedDay does not use $token"
done
game_fn="$(awk '/^export function isPastFinishedGame/,/^}/' "$PF" 2>/dev/null)"
for token in 'mlbToday(' 'isSettledGame(' '"cache"' 'officialDate'; do
	grep -qF -- "$token" <<<"$game_fn" || bad 1 "isPastFinishedGame does not use $token"
done
grep -qF 'past-finished.js' packages/domain/src/index.ts || bad 1 "packages/domain/src/index.ts does not export past-finished.js"
for name in "S212 AC 1 yesterday final" "S212 AC 1 today final" "S212 AC 1 suspended not moved" "S212 AC 1 suspended moved away" "S212 AC 1 stored active" "S212 AC 1 03:00 UTC" "S212 AC 1 game" "S212 AC 1 live-ingested"; do
	in_file "$DOM" "src/past-finished.test.ts" "$name\\b" || bad 1 "no passing test named '$name' in packages/domain/src/past-finished.test.ts"
done
# The read paths, the headers, the purge and the re-check call these two (and no other "past" rule).
grep -q 'isPastFinishedDay(' functions/src/services/ingest.ts || bad 1 "ingest.ts does not call isPastFinishedDay"
grep -q 'isPastFinishedGame(' functions/src/services/ingest.ts || bad 1 "ingest.ts does not call isPastFinishedGame"
grep -q 'isPastFinishedGame(' functions/src/services/digest.ts 2>/dev/null || bad 1 "digest.ts does not call isPastFinishedGame"
grep -q 'isPastFinishedGame(' functions/src/handlers/api.ts || bad 1 "api.ts does not judge the game route by isPastFinishedGame"
grep -q 'gamesDueForRecheck(' functions/src/services/game-recheck.ts 2>/dev/null || bad 1 "game-recheck.ts does not pick games through gamesDueForRecheck"
awk '/^export function gamesDueForRecheck/,/^}/' "$PF" 2>/dev/null | grep -q 'isPastFinishedGame(' || bad 1 "gamesDueForRecheck does not call isPastFinishedGame"

# --- Check 2: no MLB call on read ---
for name in "S212 AC 2 schedule zero" "S212 AC 2 game zero" "S212 AC 2 not stored" "S212 AC 2 today stale" "S212 AC 2 future stale" "S212 AC 2 unfinished stale" "S212 AC 2 force"; do
	in_file "$FN" "services/ingest.past.test.ts" "$name\\b" || bad 2 "no passing test named '$name' in functions/src/services/ingest.past.test.ts"
done
in_file "$FN" "services/digest.test.ts" "S212 AC 2 digest zero\\b" || bad 2 "no passing test named 'S212 AC 2 digest zero' in functions/src/services/digest.test.ts"
file_passed "$FN" "services/digest.test.ts" || bad 2 "functions/src/services/digest.test.ts did not pass"

# --- Check 3: headers ---
CC=functions/src/handlers/cache-control.ts
grep -qE '^export const PAST_EDGE_TTL_S = 2592000;' "$CC" || bad 3 "no PAST_EDGE_TTL_S = 2592000 in $CC"
grep -qE '^export const PAST_STALE_S = 86400;' "$CC" || bad 3 "no PAST_STALE_S = 86400 in $CC"
grep -qE '^export const PAST_BROWSER_MAX_AGE_S = 3600;' "$CC" || bad 3 "no PAST_BROWSER_MAX_AGE_S = 3600 in $CC"
grep -qE '^export const PAST_CACHE_CONTROL = `public, max-age=\$\{PAST_BROWSER_MAX_AGE_S\}, s-maxage=\$\{PAST_EDGE_TTL_S\}, stale-while-revalidate=\$\{PAST_STALE_S\}`;' "$CC" ||
	bad 3 "$CC has no PAST_CACHE_CONTROL built from the three constants"
for c in PAST_EDGE_TTL_S PAST_STALE_S PAST_BROWSER_MAX_AGE_S; do
	doc="$(doc_of "$CC" "export const $c =")"
	[ -n "$(grep -E '[0-9]' <<<"$doc")" ] || bad 3 "$c's comment does not give its value"
done
grep -q 'PAST_CACHE_CONTROL' functions/src/handlers/api.ts || bad 3 "api.ts never sends PAST_CACHE_CONTROL"
for name in "S212 AC 3 schedule past" "S212 AC 3 game past" "S212 AC 3 digest past" "S212 AC 3 today" "S212 AC 3 future" "S212 AC 3 live game" "S212 AC 3 digest unfinished game" "S212 AC 3 digest partial"; do
	in_file "$FN" "handlers/api.past-cache.test.ts" "$name\\b" || bad 3 "no passing test named '$name' in functions/src/handlers/api.past-cache.test.ts"
done

# --- Check 4: the purge ---
PORT="$(grep -rlE '^export interface EdgeCachePurger' packages/ports/src 2>/dev/null | head -1)"
[ -n "$PORT" ] || bad 4 "packages/ports/src has no EdgeCachePurger interface"
[ -z "$PORT" ] || grep -qF "$(basename "$PORT" .ts).js" packages/ports/src/index.ts || bad 4 "packages/ports/src/index.ts does not export the EdgeCachePurger module"
CF=functions/src/adapters/cloudflare/edge-cache-purger.ts
for token in 'purge_cache' 'files' 'BT_CF_PURGE_TOKEN' 'BT_CF_ZONE_ID'; do
	grep -qF -- "$token" "$CF" 2>/dev/null || bad 4 "$CF does not use $token"
done
grep -qE '^export const PURGE_URLS_PER_REQUEST = 30;' "$CF" 2>/dev/null || bad 4 "no PURGE_URLS_PER_REQUEST = 30 in $CF"
in_file "$FN" "adapters/cloudflare/edge-cache-purger.test.ts" "S212 AC 4 101 urls\\b" || bad 4 "no passing test named 'S212 AC 4 101 urls' in $CF's test"
grep -qE 'implements EdgeCachePurger' functions/src/adapters/memory/edge-cache-purger.ts 2>/dev/null || bad 4 "no memory EdgeCachePurger under functions/src/adapters/memory/"
for f in storeSchedule storeGame; do
	awk "/^(export )?async function $f\\(/,/^}/" functions/src/services/ingest.ts | grep -qE 'purge(Day|Game)Edge\(' || bad 4 "$f does not purge"
done
for name in "S212 AC 4 month changes one day" "S212 AC 4 month unchanged" "S212 AC 4 first store" "S212 AC 4 today future" "S212 AC 4 game ingest change" "S212 AC 4 unchanged poll" "S212 AC 4 refresh read" "S212 AC 4 no credentials" "S212 AC 4 purger rejects"; do
	in_file "$FN" "services/edge-purge.test.ts" "$name\\b" || bad 4 "no passing test named '$name' in functions/src/services/edge-purge.test.ts"
done
in_file "$FN" "src/worker-app.test.ts" "S212 AC 4 no-op\\b" || bad 4 "no passing test named 'S212 AC 4 no-op' in functions/src/worker-app.test.ts"
for path in '/api/v1/schedule?date=' '/api/v1/digest?date=' '/api/v1/games/'; do
	grep -qF -- "$path" functions/src/services/edge-purge.ts 2>/dev/null || bad 4 "functions/src/services/edge-purge.ts does not build $path"
done

# --- Check 5: the recent-game re-check ---
GR=functions/src/services/game-recheck.ts
grep -qE '^export async function recheckDueGame\(' "$GR" 2>/dev/null || bad 5 "$GR exports no recheckDueGame"
grep -rqE '^export const RECENT_GAME_RECHECK_DAYS = 7;' packages/domain/src || bad 5 "no RECENT_GAME_RECHECK_DAYS = 7 in packages/domain"
grep -q 'ingestGame(' "$GR" 2>/dev/null || bad 5 "$GR does not store through ingestGame"
grep -q 'fetchGame(' "$GR" 2>/dev/null || bad 5 "$GR does not fetch through fetchGame"
grep -q 'SCHEDULE_MONTH_REFRESH_INTERVAL_MS' "$GR" packages/domain/src/past-finished.ts 2>/dev/null || bad 5 "the re-check does not use S194's 6 h interval"
doc="$(doc_of "$GR" 'export async function recheckDueGame(')"
for phrase in "5,760" "1,900" "4 MLB requests" "7 days"; do
	grep -qF -- "$phrase" <<<"$doc" || bad 5 "recheckDueGame's comment does not state '$phrase'"
done
W=functions/src/worker.ts
sched="$(awk '/async scheduled\(/,/^\t},/' "$W")"
grep -q 'recheckDueGame(' <<<"$sched" || bad 5 "scheduled() does not run recheckDueGame"
[ "$(grep -c 'ctx.waitUntil(' <<<"$sched")" -ge 3 ] || bad 5 "scheduled() does not give the re-check its own waitUntil"
grep -lE 'CREATE TABLE "game_rechecks"' functions/src/adapters/postgres/migrations/*.sql >/dev/null 2>&1 || bad 5 "no migration creates game_rechecks"
for f in functions/src/adapters/memory/repos.ts functions/src/adapters/postgres/repos.ts; do
	for m in claimGameRecheck recordGameRecheck listRecheckCandidates; do
		grep -q "$m" "$f" || bad 5 "$f does not implement $m"
	done
done
awk '/postgresTables: \{/,/^\t\},/' functions/src/services/data-classification.ts | grep -q 'game_rechecks' || bad 5 "DATA_CLASSIFICATION.postgresTables does not list game_rechecks"
for t in services/data-classification.test.ts services/baseball-copy.test.ts; do
	file_passed "$FN" "$t" || bad 5 "functions/src/$t did not pass"
done
in_file "$FN" "adapters/postgres/repos.contract.test.ts" "S212 AC 5\\b" || bad 5 "no passing contract test named 'S212 AC 5' for Postgres"
in_file "$FN" "adapters/memory/repos.contract.test.ts" "S212 AC 5\\b" || bad 5 "no passing contract test named 'S212 AC 5' for memory"
for name in "S212 AC 5 picks" "S212 AC 5 new clip" "S212 AC 5 change purges" "S212 AC 5 unchanged" "S212 AC 5 six hours" "S212 AC 5 none due" "S212 AC 5 MLB fails"; do
	in_file "$FN" "services/game-recheck.test.ts" "$name\\b" || bad 5 "no passing test named '$name' in $GR's test"
done
in_file "$FN" "src/worker.test.ts" "S212 AC 5 recheck rejects\\b" || bad 5 "no passing test named 'S212 AC 5 recheck rejects' in functions/src/worker.test.ts"

# --- Check 6: dead read-path code narrowed ---
grep -qE '^export function needsRefresh\(' functions/src/services/ingest.ts || bad 6 "needsRefresh is gone"
doc_of functions/src/services/ingest.ts 'export function needsRefresh(' | grep -qi 'past, finished' || bad 6 "needsRefresh's comment does not say it no longer decides a past, finished read"
grep -qE '^\s*lastRefreshedAt\(' functions/src/services/refresh.ts || bad 6 "RefreshCoordinator.lastRefreshedAt is gone"
doc_of functions/src/services/refresh.ts 'lastRefreshedAt(key: string)' | grep -qi 'past, finished' || bad 6 "lastRefreshedAt's comment does not say it no longer decides a past, finished read"

# --- Check 7: ADR-021 ---
grep -qF 'I was hoping that the 6hrly cron job would result in both a fresh set of data AND an updated edge cache' docs/v3/ARCHITECTURE.md || bad 7 "ARCHITECTURE.md lacks the owner's words"
awk '/Amended 2026-11-24: the edge is the read cache for past data/,/^\*\*Why|^### /' docs/v3/ARCHITECTURE.md | grep -q 'S212' || bad 7 "ADR-021's 2026-11-24 amendment does not name S212"

# --- Check 8: comments ---
doc_of "$CC" 'export function edgeCacheControl(' | grep -q 'S212' || bad 8 "edgeCacheControl's comment does not name S212"
for decl in 'export function needsRefresh(' 'export async function getOrRefreshSchedule(' 'export async function getOrRefreshGame('; do
	doc_of functions/src/services/ingest.ts "$decl" | grep -q 'S212' || bad 8 "the comment on '$decl' does not name S212"
done
doc_of functions/src/services/digest.ts 'export async function getDayDigest(' | grep -q 'S212' || bad 8 "getDayDigest's comment does not name S212"
doc_of functions/src/services/schedule-month.ts 'export async function fillScheduleMonth(' | grep -q 'S212' || bad 8 "fillScheduleMonth's comment does not name S212"
doc_of functions/src/services/schedule-refresh.ts 'export async function refreshDueScheduleMonth(' | grep -q 'S212' || bad 8 "refreshDueScheduleMonth's comment does not name S212"
doc_of "$W" 'async scheduled(' | grep -q 'S212' || bad 8 "scheduled()'s comment does not name S212"

# --- Check 9: Status done ---
[ "$(story_snapshot_status S212)" = "done" ] || bad 9 "S212's snapshot does not record Status done"

# --- Check 10: fence ---
fence='^(packages/domain/|packages/ports/src/|functions/src/|functions/vitest\.config\.ts$|docs/v3/backlog/|docs/v3/audit/|changelog\.d/S212\.md$|scripts/verify-S212\.sh$)'
while IFS= read -r f; do
	[ -z "$f" ] && continue
	grep -qE "$fence" <<<"$f" || bad 10 "outside the fence: $f"
done < <(story_own_changed_files S212 "$BASE" .)
own_added="$(story_own_diff S212 "$BASE" --name-status --diff-filter=A -- scripts/verify-S212.sh)"
[ -n "$own_added" ] || [ -n "$(git ls-files --others --exclude-standard -- scripts/verify-S212.sh)" ] || bad 10 "scripts/verify-S212.sh was not created by S212"

report "verify-S212"
exit $?
