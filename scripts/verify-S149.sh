#!/usr/bin/env bash
# Grader for story S149 — the scoreboard's live connection: one WebSocket per day from a
# `day-hub:<date>` Durable Object (ADR-020 as amended 2026-11-16), fed by the leases every
# in-window game's ingest object already publishes through, and by the schedule writers when a
# stored day changes; it only reads (S150's `readScheduleDay`) and pushes the whole day,
# versioned (ADR-022). `GET /api/v1/schedule/live?date=` upgrades only an in-window day, and the
# scoreboard follows it through `useLiveDay`, showing S148's Live marker while the socket is open.
# A commit-time proof of this story (S84).
# Contract: frame note 00, "Verify-script contract" (docs/v3/backlog/frame/).
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`); runs only the
# story-scoped Vitest files named below, one run per package (the three in parallel), and reads
# each test's result by name.

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "AC 1: DayHubObject (day-hub:<date>) in functions/src/day-hub-object.ts on LiveHubState, hibernated and one-way; wrangler.jsonc binds DAY_HUB wherever GAME_HUB is bound and adds migration v3 (DayHubObject) after v1 and v2, unchanged; tests 'S149 AC 1' (connect gets the day, publish reaches every socket, last viewer ends its leases)"
check 2 "AC 2: the day hub leases every in-window game of its date through HubLeases' routes and re-reads the day on renewal; every storeSchedule writer calls the hubs of changed in-window dates once after its writes; ingest publishes a mend; nothing queries schedule_days by gamePk; tests 'S149 AC 2' (each case the AC names)"
check 3 "AC 3: the day hub reads its day with readScheduleDay and writes nothing (no upsert, no storeSchedule, no MLB); tests 'S149 AC 3' (new score pushed, two games, failed read pushes nothing)"
check 4 "AC 4: a push's version is the served day's; the client applies a whole day through applyIfNewer at once however far ahead; ?since on reconnect; tests 'S149 AC 4' on the hub and the client"
check 5 "AC 5: GET /api/v1/schedule/live?date= in STREAMING_ROUTE_EXCEPTIONS and API_ROUTER, judged by scheduleDayWindowMode; the OpenAPI spec doesn't name it; route-table and live handler tests pass; a workerd test 'S149 AC 5' (in-window day gets the day after a game's ingest writes; out-of-window doesn't upgrade)"
check 6 "AC 6: useLiveDay in web/src/api/ on the generalized live stream (no second copy of its reconnect logic), writing through writeScheduleDay; tests 'S149 AC 6' (each case the AC names)"
check 7 "AC 7: the scoreboard shows LiveMarker's strip exactly while useLiveDay reports open (RTL 'S149 AC 7')"
check 8 "AC 8: e2e/design/S149.spec.ts (reduced motion, routeWebSocket) and its captures live-marker-scoreboard-live-{mobile,desktop}.png under docs/v3/design-checks/S149/ at 390 and 1200px"
check 9 "AC 9: S149's Status is done: its snapshot records done"
check 10 "S149 changed no file outside its fence (plus creating scripts/verify-S149.sh and its own records)"

# The commit S149's own changes start from: `git merge-base origin/stage HEAD` when this grader was written.
BASE=bf0537214628090bab9ad523793f3cb53517fc63

TMP="$(mktemp -d /tmp/verify-S149.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

F=functions/src
FN_TESTS=(src/day-hub-object.test.ts src/services/day-hubs.test.ts src/handlers/live.test.ts src/handlers/route-table.test.ts
	src/game-hub-object.test.ts src/services/game-ingest.test.ts)
WEB_TESTS=(src/api/useLiveDay.test.tsx src/api/live.test.ts src/api/useLiveGame.test.tsx src/pages/ScoreboardPage.test.tsx)
WD=src/day-hub.workerd.test.ts

# Only the files that exist (bash 3.2: no mapfile).
fn_present=()
for t in "${FN_TESTS[@]}"; do [ -f "functions/$t" ] && fn_present+=("$t"); done
web_present=()
for t in "${WEB_TESTS[@]}"; do [ -f "web/$t" ] && web_present+=("$t"); done
if [ "${#fn_present[@]}" -gt 0 ]; then
	(cd functions && pnpm exec vitest run "${fn_present[@]}" --reporter=json --outputFile="$TMP/fn.json" >"$TMP/fn.log" 2>&1) &
fi
if [ "${#web_present[@]}" -gt 0 ]; then
	(cd web && pnpm exec vitest run "${web_present[@]}" --reporter=json --outputFile="$TMP/web.json" >"$TMP/web.log" 2>&1) &
fi
if [ -f "functions/$WD" ]; then
	(cd functions && pnpm exec vitest run --config vitest.workers.config.ts "$WD" --reporter=json --outputFile="$TMP/wd.json" >"$TMP/wd.log" 2>&1) &
fi
wait

# passed <report> <regex> — at least one test whose full name matches ran, and every one that matches passed.
passed() {
	[ -f "$1" ] || return 1
	node -e '
		const r = require(process.argv[1]);
		const re = new RegExp(process.argv[2]);
		const all = r.testResults.flatMap((f) => f.assertionResults);
		const hit = all.filter((t) => re.test(t.fullName));
		process.exit(hit.length > 0 && hit.every((t) => t.status === "passed") ? 0 : 1);
	' "$1" "$2"
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
# need <check> <report> <name>... — each named test ran and passed.
need() {
	local id="$1" report="$2"; shift 2
	for name in "$@"; do passed "$report" "$name" || bad "$id" "no passing test named '$name'"; done
}

# --- Check 1: the day hub ---
H="$F/day-hub-object.ts"
if [ ! -f "$H" ]; then
	bad 1 "$H missing"
else
	grep -qE 'export class DayHubObject' "$H" || bad 1 "$H exports no DayHubObject"
	grep -qF 'day-hub:' "$H" || bad 1 "$H does not name its objects day-hub:<date>"
	grep -qw 'LiveHubState' "$H" || bad 1 "$H does not reuse LiveHubState"
	grep -qw 'acceptWebSocket' "$H" && grep -qw 'setWebSocketAutoResponse' "$H" || bad 1 "$H does not hibernate its sockets (acceptWebSocket, setWebSocketAutoResponse)"
fi
grep -qE 'export class DayHubObject|export \{ DayHubObject \}' "$F/worker.ts" || bad 1 "worker.ts does not export DayHubObject"
games=$(grep -cE '"name": "GAME_HUB", "class_name": "GameHubObject"' wrangler.jsonc)
days=$(grep -cE '"name": "DAY_HUB", "class_name": "DayHubObject"' wrangler.jsonc)
[ "$days" -ge 1 ] && [ "$days" = "$games" ] || bad 1 "wrangler.jsonc binds DAY_HUB $days times, GAME_HUB $games times (top level and every env)"
mig="$(awk '/"migrations": \[/{f=1} f{print} f&&/\]/{exit}' wrangler.jsonc)"
grep -qF '{ "tag": "v1", "new_sqlite_classes": ["GameIngestObject"] },' <<<"$mig" || bad 1 "migration v1 changed"
grep -qF '{ "tag": "v2", "new_sqlite_classes": ["GameHubObject"] },' <<<"$mig" || bad 1 "migration v2 changed (or is no longer followed by v3)"
grep -qF '{ "tag": "v3", "new_sqlite_classes": ["DayHubObject"] }' <<<"$mig" || bad 1 "no migration v3 adding DayHubObject"
need 1 "$TMP/fn.json" "S149 AC 1 connect gets the day" "S149 AC 1 publish reaches every socket" "S149 AC 1 last viewer ends its leases"

# --- Check 2: which games feed it ---
grep -qw 'HubLeases' "$F/services/game-ingest.ts" || bad 2 "the ingest object no longer keeps its hubs in HubLeases"
[ -f "$H" ] && { grep -qE '"register"|register' "$H" && grep -qE '"renew"|renew' "$H" && grep -qE '"unregister"|unregister' "$H" || bad 2 "$H does not register, renew and unregister leases"; }
for f in ingest.ts schedule-month.ts backfill.ts; do grep -q 'storeSchedule' "$F/services/$f" || bad 2 "$F/services/$f no longer writes through storeSchedule"; done
grep -rqE "schedule_days[^;]*(gamePk|game_pk|@>)" "$F/adapters/postgres" 2>/dev/null && bad 2 "a query reads schedule_days by gamePk"
need 2 "$TMP/fn.json" "S149 AC 2 in window at connect" "S149 AC 2 enters its window after the next renewal" "S149 AC 2 another date never" \
	"S149 AC 2 doubleheader" "S149 AC 2 postponement reaches the hub" "S149 AC 2 month fill" "S149 AC 2 no game in its window calls no hub" \
	"S149 AC 2 feed mend" "S149 AC 2 state change calls only" "S149 AC 2 once per refresh"

# --- Check 3: the day hub only reads ---
if [ -f "$H" ]; then
	grep -qw 'readScheduleDay' "$H" || bad 3 "$H does not read its day with readScheduleDay"
	grep -qE 'upsert|storeSchedule|switchGameState|\.mlb\.|getOrRefreshSchedule|getScheduleRead' "$H" && bad 3 "$H writes or asks MLB"
fi
need 3 "$TMP/fn.json" "S149 AC 3 new score" "S149 AC 3 two games" "S149 AC 3 failed read pushes nothing"

# --- Check 4: versioned ---
need 4 "$TMP/fn.json" "S149 AC 4 hub"
need 4 "$TMP/web.json" "S149 AC 4 five versions ahead" "S149 AC 4 client" "S149 AC 4 reconnect"
grep -rqw 'applyIfNewer' web/src/api/live-stream.ts || bad 4 "the stream no longer applies pushes through applyIfNewer"

# --- Check 5: the route ---
A="$F/handlers/api.ts"
awk '/STREAMING_ROUTE_EXCEPTIONS =/,/;/' "$A" | grep -qF '"GET /api/v1/schedule/live"' || bad 5 "GET /api/v1/schedule/live is not in STREAMING_ROUTE_EXCEPTIONS"
grep -qE 'route: "GET /api/v1/schedule/live"' "$A" || bad 5 "API_ROUTER does not dispatch GET /api/v1/schedule/live"
grep -qw 'scheduleDayWindowMode' "$F/handlers/live.ts" || bad 5 "the live route does not judge the day with scheduleDayWindowMode"
grep -qF 'schedule/live' openapi/bt-api.v1.json && bad 5 "the OpenAPI spec names the schedule live route"
file_passed "$TMP/fn.json" "handlers/route-table.test.ts" || bad 5 "route-table.test.ts did not pass"
file_passed "$TMP/fn.json" "handlers/live.test.ts" || bad 5 "handlers/live.test.ts did not pass"
need 5 "$TMP/fn.json" "S149 AC 5"
[ -f "functions/$WD" ] || bad 5 "functions/$WD missing"
need 5 "$TMP/wd.json" "S149 AC 5 .*receives the day" "S149 AC 5 .*doesn't upgrade"

# --- Check 6: the scoreboard connects ---
grep -rqE 'export function useLiveDay' web/src/api || bad 6 "no useLiveDay in web/src/api/"
grep -rqw 'writeScheduleDay' web/src/api/live-day.ts 2>/dev/null || bad 6 "useLiveDay (web/src/api/live-day.ts) does not write through writeScheduleDay"
[ "$(grep -rlE 'reconnectDelay\(' web/src --include='*.ts' --include='*.tsx' --exclude='*.test.*' | wc -l | tr -d ' ')" = "1" ] || bad 6 "the reconnect backoff is used outside live-stream.ts (copied, not generalized)"
grep -qw 'useLiveDay' web/src/pages/ScoreboardPage.tsx || bad 6 "the scoreboard does not call useLiveDay"
file_passed "$TMP/web.json" "api/live.test.ts" || bad 6 "web/src/api/live.test.ts (the game stream) did not pass"
file_passed "$TMP/web.json" "api/useLiveGame.test.tsx" || bad 6 "useLiveGame.test.tsx did not pass"
need 6 "$TMP/web.json" "S149 AC 6 in-window day connects" "S149 AC 6 open reports open" "S149 AC 6 close, reconnect waits and polling report not open" \
	"S149 AC 6 out-of-window day doesn't connect" "S149 AC 6 window opens 5 minutes later" "S149 AC 6 leaving its window closes" \
	"S149 AC 6 switching days closes" "S149 AC 6 no refetch interval during a reconnect wait"

# --- Check 7: the marker ---
if [ -f web/src/layout/LiveMarker.tsx ]; then
	need 7 "$TMP/web.json" "S149 AC 7 open shows" "S149 AC 7 closed, reconnecting, polling and out-of-window"
fi

# --- Check 8: design capture ---
if [ -f web/src/layout/LiveMarker.tsx ]; then
	spec=e2e/design/S149.spec.ts
	if [ ! -f "$spec" ]; then
		bad 8 "$spec missing"
	else
		grep -qE 'reducedMotion: "reduce"' "$spec" || bad 8 "$spec does not emulate reduced motion"
		grep -qF 'routeWebSocket' "$spec" || bad 8 "$spec does not open the day's socket with routeWebSocket"
	fi
	for frame in live-marker-scoreboard-live-mobile live-marker-scoreboard-live-desktop; do
		case "$frame" in *-mobile) want=390 ;; *-desktop) want=1200 ;; esac
		f="docs/v3/design-checks/S149/$frame.png"
		if [ ! -f "$f" ]; then
			bad 8 "$f missing"
		else
			w=$(node -e 'const b=require("fs").readFileSync(process.argv[1]);process.stdout.write(String(b.readUInt32BE(16)))' "$f")
			[ "$w" = "$want" ] || bad 8 "$f is ${w}px wide, not $want"
		fi
	done
fi

# --- Check 9: Status done ---
[ "$(story_snapshot_status S149)" = "done" ] || bad 9 "S149's snapshot does not record Status done"

# --- Check 10: fence ---
fence='^(functions/src/|functions/vitest\.workers\.config\.ts$|packages/domain/|web/src/|wrangler\.jsonc$|docs/v3/backlog/|docs/v3/AUDIT\.md$|docs/v3/audit\.jsonl$|docs/v3/INDEX\.md$|CHANGELOG\.md$|e2e/design/|docs/v3/design-checks/|docs/v3/audit/[^/]+/[^/]*-S149-[^/]*\.md$|changelog\.d/S149\.md$|scripts/verify-S149\.sh$)'
while IFS= read -r f; do
	[ -z "$f" ] && continue
	grep -qE "$fence" <<<"$f" || bad 10 "outside the fence: $f"
done < <(story_own_changed_files S149 "$BASE" .)
own_added="$(story_own_diff S149 "$BASE" --name-status --diff-filter=A -- scripts/verify-S149.sh)"
[ -n "$own_added" ] || [ -n "$(git ls-files --others --exclude-standard -- scripts/verify-S149.sh)" ] || bad 10 "scripts/verify-S149.sh was not created by S149"

report "verify-S149"
exit $?
