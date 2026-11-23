#!/usr/bin/env bash
# Grader for story S194 — a durable "checked at" per schedule month, one month fill shared by the
# month route and a scheduled refresh on the existing per-minute cron, a versioned month URL the
# edge may keep for 48 hours (a past year's for as long as the edge allows), and the web asking
# for a month with its version.
# A commit-time proof of this story (S84).
# Contract: frame note 00, "Verify-script contract" (docs/v3/backlog/frame/).
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`); runs only the
# story-scoped Vitest files named below, once per package, and reads each test's result by name.

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "AC 1: ScheduleRepository carries a month record (checkedAt, claimedAt) with a conditional claim and a forward-only check, in memory and Postgres (a migration creates schedule_months); the 5-minute lease is one domain constant; contract tests named 'S194 AC 1' pass in repos.contract.test.ts (never recorded, read back, older check, lease); DATA_CLASSIFICATION lists schedule_months and its test passes; COPY_RULES never copies it (baseball-copy.test.ts 'S194 AC 1')"
check 2 "AC 2: one exported fillScheduleMonth in functions/src/services/schedule-month.ts, called by getScheduleMonth and by the refresh; tests named 'S194 AC 2 windowMode', 'S194 AC 2 gap', 'S194 AC 2 MLB fails' pass"
check 3 "AC 3: the route judges an in-window stored month by its checkedAt against SCHEDULE_MONTH_REFRESH_INTERVAL_MS (6 h) plus a 30-minute margin, not the ladder; tests named 'S194 AC 3 checked 1 h', 'S194 AC 3 checked 7 h', 'S194 AC 3 never checked' pass"
check 4 "AC 4: functions/src/services/schedule-refresh.ts refreshes at most one due month per call; tests in schedule-refresh.test.ts named 'S194 AC 4 order', 'S194 AC 4 January 1', 'S194 AC 4 recent', 'S194 AC 4 claimed', 'S194 AC 4 MLB fails', 'S194 AC 4 store fails', 'S194 AC 4 six hours' pass"
check 5 "AC 5: scheduled() runs the refresh on every allowed tick in its own waitUntil and database scope, without GAME_INGEST; worker.test.ts tests named 'S194 AC 5 refresh rejects', 'S194 AC 5 ingest rejects', 'S194 AC 5 no binding' pass; wrangler.jsonc unchanged"
check 6 "AC 6: through HttpMlbStatsClient, 'S194 AC 6 one month' (ceil(days/7) requests, sportId=1, spans of at most 7 days) and 'S194 AC 6 none due' (no request, one database read) pass; the refresh's comment states the budget (5 requests, 120 every 6 h, 480 a day, ADR-002)"
check 7 "AC 7: GET /api/v1/schedule/month-versions/:year in the route table; a version is contentHash of the month answer's days through one function; ?v= gives 48 h for this and next year, s-maxage=2147483647 (PAST_YEAR_MONTH_EDGE_TTL_S) with no max-age for a past year, the floor for a wrong v; functions tests 'S194 AC 7' pass; web tests 'S194 AC 7' pass; DateControl.test.tsx and ScoreboardPage.refresh.test.tsx pass unchanged"
check 8 "AC 8: without v, a complete month keeps ADR-021's ladder capped at 48 h and an incomplete one keeps the short cache (tests named 'S194 AC 8' pass)"
check 9 "AC 9: docs/v3/ARCHITECTURE.md's ADR-021 carries the past-year exception with the owner's words 'as long as possible, like 100 years'"
check 10 "AC 10: openapi/bt-api.v1.json is up to date and has the month-versions path and the month route's v query; pnpm api:breaking exits 0; web/src/api/generated/bt-api.v1.ts has the new path"
check 11 "AC 11: the named comments no longer say the old thing: worker.ts header and scheduled() name the schedule refresh; schedule-month.ts drops 'ADR-021 lifetime has run out'; edgeCacheControl's comment names the versioned URL; api.ts drops 'never by whether it is past'; scheduleMonth.ts drops 'the API caches the answer on ADR-021's ladder'"
check 12 "AC 12: S194's Status is done: its snapshot fragment records done"
check 13 "S194 changed no file outside its fence (plus creating scripts/verify-S194.sh and its own records)"

# The commit S194's own changes start from: `git merge-base origin/stage HEAD` when this grader was written.
BASE=f0752d057f56e82fbbef38db5849a09471a8f0a1

TMP="$(mktemp -d /tmp/verify-S194.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

FN_TESTS=(src/adapters/postgres/repos.contract.test.ts src/services/data-classification.test.ts src/services/baseball-copy.test.ts
	src/services/schedule-month.test.ts src/services/schedule-refresh.test.ts src/worker.test.ts)
WEB_TESTS=(src/api/scheduleMonth.test.tsx src/api/client.test.ts src/components/scoreboard/DateControl.test.tsx src/pages/ScoreboardPage.refresh.test.tsx)
fn_present=()
for t in "${FN_TESTS[@]}"; do [ -f "functions/$t" ] && fn_present+=("$t"); done
web_present=()
for t in "${WEB_TESTS[@]}"; do [ -f "web/$t" ] && web_present+=("$t"); done
# The suites, the spec check and the breaking-change gate run side by side to stay under 60 seconds.
(cd functions && pnpm exec vitest run "${fn_present[@]}" --reporter=json --outputFile="$TMP/functions.json" >"$TMP/functions.log" 2>&1) &
(cd web && pnpm exec vitest run "${web_present[@]}" --reporter=json --outputFile="$TMP/web.json" >"$TMP/web.log" 2>&1) &
(cd functions && pnpm exec tsx src/scripts/generate-openapi.ts --check >"$TMP/spec.log" 2>&1; echo $? >"$TMP/spec.rc") &
(pnpm -s api:breaking >"$TMP/breaking.log" 2>&1; echo $? >"$TMP/breaking.rc") &
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
# in_file <report> <file suffix> <regex> — a passing test whose full name matches ran in that file.
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
FN="$TMP/functions.json"
WEB="$TMP/web.json"

# --- Check 1: the month record ---
PORT=packages/ports/src/repositories.ts
awk '/^export interface ScheduleRepository/,/^}/' "$PORT" | grep -qE 'claimScheduleMonth\(' || bad 1 "ScheduleRepository has no claimScheduleMonth"
awk '/^export interface ScheduleRepository/,/^}/' "$PORT" | grep -qE 'recordScheduleMonthCheck\(' || bad 1 "ScheduleRepository has no recordScheduleMonthCheck"
awk '/^export interface ScheduleRepository/,/^}/' "$PORT" | grep -qE 'listScheduleMonthChecks\(' || bad 1 "ScheduleRepository has no listScheduleMonthChecks"
grep -rqE 'checkedAt' packages/domain/src/schedule-refresh.ts 2>/dev/null && grep -rqE 'claimedAt' packages/domain/src/schedule-refresh.ts ||
	bad 1 "packages/domain/src/schedule-refresh.ts does not define a month record with checkedAt and claimedAt"
grep -qE '^export const SCHEDULE_MONTH_CLAIM_LEASE_MS = 5 \* MINUTE;' packages/domain/src/schedule-refresh.ts 2>/dev/null || bad 1 "no SCHEDULE_MONTH_CLAIM_LEASE_MS = 5 * MINUTE in packages/domain/src/schedule-refresh.ts"
for f in functions/src/adapters/memory/repos.ts functions/src/adapters/postgres/repos.ts; do
	grep -q 'claimScheduleMonth' "$f" || bad 1 "$f does not implement claimScheduleMonth"
	grep -q 'recordScheduleMonthCheck' "$f" || bad 1 "$f does not implement recordScheduleMonthCheck"
done
grep -lE '^CREATE TABLE "schedule_months"' functions/src/adapters/postgres/migrations/*.sql >/dev/null 2>&1 || bad 1 "no migration creates schedule_months"
grep -q 'scheduleMonths' functions/src/adapters/postgres/schema.ts || bad 1 "schema.ts has no scheduleMonths table"
for name in "S194 AC 1 never recorded" "S194 AC 1 read back" "S194 AC 1 older check" "S194 AC 1 lease"; do
	in_file "$FN" "adapters/postgres/repos.contract.test.ts" "$name\\b" || bad 1 "no passing test named '$name' in functions/src/adapters/postgres/repos.contract.test.ts"
done
awk '/postgresTables: \{/,/^\t\},/' functions/src/services/data-classification.ts | grep -q 'schedule_months' || bad 1 "DATA_CLASSIFICATION.postgresTables does not list schedule_months"
file_passed "$FN" "services/data-classification.test.ts" || bad 1 "functions/src/services/data-classification.test.ts did not pass"
awk '/^export const COPY_RULES/,/^};/' functions/src/services/baseball-copy.ts | grep -q 'schedule_months' || bad 1 "COPY_RULES has no rule for schedule_months"
in_file "$FN" "services/baseball-copy.test.ts" "S194 AC 1\\b" || bad 1 "no passing test named 'S194 AC 1' in baseball-copy.test.ts"

# --- Check 2: one fill ---
SM=functions/src/services/schedule-month.ts
SR=functions/src/services/schedule-refresh.ts
grep -qE '^export async function fillScheduleMonth\(' "$SM" || bad 2 "$SM exports no fillScheduleMonth"
awk '/^export async function getScheduleMonth/,/^}/' "$SM" | grep -q 'fillScheduleMonth(' || bad 2 "getScheduleMonth does not call fillScheduleMonth"
grep -q 'fillScheduleMonth(' "$SR" 2>/dev/null || bad 2 "$SR does not call fillScheduleMonth"
others="$(grep -rlF --exclude='*.test.*' 'fetchScheduleRange(' functions/src/services | grep -vx "$SM")"
[ -z "$others" ] || bad 2 "another service asks MLB for a schedule range: $(tr '\n' ' ' <<<"$others")"
for name in "S194 AC 2 windowMode" "S194 AC 2 gap" "S194 AC 2 MLB fails"; do
	in_file "$FN" "services/schedule-month.test.ts" "$name\\b" || bad 2 "no passing test named '$name' in schedule-month.test.ts"
done

# --- Check 3: the route trusts the refresh ---
grep -qE '^export const SCHEDULE_MONTH_REFRESH_INTERVAL_MS = 6 \* HOUR;' packages/domain/src/schedule-refresh.ts 2>/dev/null || bad 3 "no SCHEDULE_MONTH_REFRESH_INTERVAL_MS = 6 * HOUR in packages/domain/src/schedule-refresh.ts"
grep -qE '30 \* MINUTE' packages/domain/src/schedule-refresh.ts 2>/dev/null || bad 3 "no 30-minute margin in packages/domain/src/schedule-refresh.ts"
grep -q 'needsRefresh' "$SM" && bad 3 "$SM still judges a month by needsRefresh (the ladder)"
for name in "S194 AC 3 checked 1 h" "S194 AC 3 checked 7 h" "S194 AC 3 never checked"; do
	in_file "$FN" "services/schedule-month.test.ts" "$name\\b" || bad 3 "no passing test named '$name' in schedule-month.test.ts"
done

# --- Check 4: the scheduled refresh ---
[ -f "$SR" ] || bad 4 "$SR missing"
grep -qE '^export async function refreshDueScheduleMonth\(' "$SR" 2>/dev/null || bad 4 "$SR exports no refreshDueScheduleMonth"
for name in "S194 AC 4 order" "S194 AC 4 January 1" "S194 AC 4 recent" "S194 AC 4 claimed" "S194 AC 4 MLB fails" "S194 AC 4 store fails" "S194 AC 4 six hours"; do
	in_file "$FN" "services/schedule-refresh.test.ts" "$name\\b" || bad 4 "no passing test named '$name' in schedule-refresh.test.ts"
done

# --- Check 5: the cron hook ---
W=functions/src/worker.ts
awk '/async scheduled\(/,/^\t},/' "$W" | grep -q 'refreshDueScheduleMonth(' || bad 5 "scheduled() does not run refreshDueScheduleMonth"
[ "$(awk '/async scheduled\(/,/^\t},/' "$W" | grep -c 'ctx.waitUntil(')" -ge 2 ] || bad 5 "scheduled() does not give the refresh its own waitUntil"
[ "$(awk '/async scheduled\(/,/^\t},/' "$W" | grep -c 'inDatabaseScope(')" -ge 2 ] || bad 5 "scheduled() does not give the refresh its own database scope"
for name in "S194 AC 5 refresh rejects" "S194 AC 5 ingest rejects" "S194 AC 5 no binding"; do
	in_file "$FN" "src/worker.test.ts" "$name\\b" || bad 5 "no passing test named '$name' in worker.test.ts"
done
[ -z "$(story_own_diff S194 "$BASE" --name-only -- wrangler.jsonc functions/wrangler.jsonc)" ] || bad 5 "S194 changed wrangler.jsonc"

# --- Check 6: the upstream budget ---
for name in "S194 AC 6 one month" "S194 AC 6 none due"; do
	in_file "$FN" "services/schedule-refresh.test.ts" "$name\\b" || bad 6 "no passing test named '$name' in schedule-refresh.test.ts"
done
doc="$(awk '/\/\*\*/{buf=""} {buf=buf"\n"$0} /^export async function refreshDueScheduleMonth/{print buf; exit}' "$SR" 2>/dev/null)"
for phrase in "5 requests" "120" "480" "ADR-002"; do
	grep -qF -- "$phrase" <<<"$doc" || bad 6 "refreshDueScheduleMonth's comment does not state '$phrase'"
done

# --- Check 7: the versioned URL ---
grep -qF '"GET /api/v1/schedule/month-versions/:year": "ScheduleMonthVersionsResponse"' packages/domain/src/api-routes.ts || bad 7 "the route table has no month-versions route"
grep -qF 'route: "GET /api/v1/schedule/month-versions/:year"' functions/src/handlers/api.ts || bad 7 "api.ts dispatches no month-versions route"
grep -qE '^export function scheduleMonthVersion\(' packages/domain/src/schedule-refresh.ts 2>/dev/null || bad 7 "packages/domain/src/schedule-refresh.ts exports no scheduleMonthVersion"
awk '/^export function scheduleMonthVersion/,/^}/' packages/domain/src/schedule-refresh.ts 2>/dev/null | grep -q 'contentHash(' || bad 7 "scheduleMonthVersion does not use contentHash"
[ "$(grep -c 'scheduleMonthVersion(' functions/src/handlers/api.ts functions/src/services/schedule-month.ts | awk -F: '{s+=$2} END {print s+0}')" -ge 2 ] || bad 7 "scheduleMonthVersion is not called for both routes"
grep -qE 'PAST_YEAR_MONTH_EDGE_TTL_S = 2147483647;' functions/src/handlers/cache-control.ts || bad 7 "no PAST_YEAR_MONTH_EDGE_TTL_S = 2147483647 in functions/src/handlers/cache-control.ts"
passed "$FN" "S194 AC 7\\b" || bad 7 "no passing functions test named 'S194 AC 7'"
for name in "S194 AC 7 48 h" "S194 AC 7 past year" "S194 AC 7 wrong v" "S194 AC 7 January 1" "S194 AC 7 refresh changes" "S194 AC 7 unchanged" "S194 AC 7 game state" "S194 AC 7 backfill" "S194 AC 7 versions route"; do
	passed "$FN" "$name\\b" || bad 7 "no passing functions test named '$name'"
done
for name in "S194 AC 7 with v" "S194 AC 7 after the floor" "S194 AC 7 left out" "S194 AC 7 versions fail" "S194 AC 7 key"; do
	passed "$WEB" "$name\\b" || bad 7 "no passing web test named '$name'"
done
grep -qE '^export async function fetchScheduleMonthVersions\(' web/src/api/client.ts || bad 7 "web/src/api/client.ts exports no fetchScheduleMonthVersions"
grep -q 'CACHE_LIFETIME_FLOOR_MS' web/src/api/scheduleMonth.ts || bad 7 "the versions query's staleTime is not CACHE_LIFETIME_FLOOR_MS"
for t in src/components/scoreboard/DateControl.test.tsx src/pages/ScoreboardPage.refresh.test.tsx; do
	file_passed "$WEB" "$t" || bad 7 "web/$t did not pass"
	[ -z "$(story_own_diff S194 "$BASE" --name-only -- "web/$t")" ] || bad 7 "S194 changed web/$t"
done

# --- Check 8: without v ---
for name in "S194 AC 8 ladder" "S194 AC 8 incomplete"; do
	passed "$FN" "$name\\b" || bad 8 "no passing functions test named '$name'"
done

# --- Check 9: ADR-021 ---
grep -qF 'as long as possible, like 100 years' docs/v3/ARCHITECTURE.md || bad 9 "docs/v3/ARCHITECTURE.md has no ADR-021 bullet with the owner's words"

# --- Check 10: in the API ---
[ "$(cat "$TMP/spec.rc" 2>/dev/null)" = "0" ] || bad 10 "openapi/bt-api.v1.json is stale (pnpm api:spec)"
node -e '
	const s = require(process.argv[1]);
	const versions = s.paths["/api/v1/schedule/month-versions/{year}"];
	const month = s.paths["/api/v1/schedule/month/{month}"];
	const v = month && month.get.parameters.find((p) => p.name === "v" && p.in === "query" && !p.required);
	process.exit(versions && versions.get && v ? 0 : 1);
' "$PWD/openapi/bt-api.v1.json" || bad 10 "openapi/bt-api.v1.json lacks the month-versions path or the month route's optional v query"
[ "$(cat "$TMP/breaking.rc" 2>/dev/null)" = "0" ] || { bad 10 "pnpm api:breaking fails:"; tail -5 "$TMP/breaking.log" | sed 's/^/        /'; }
grep -qF '"/api/v1/schedule/month-versions/{year}"' web/src/api/generated/bt-api.v1.ts || bad 10 "web/src/api/generated/bt-api.v1.ts lacks the month-versions path"

# --- Check 11: comments ---
sed -n '1,/^\*\//p' "$W" | grep -qi 'schedule' || bad 11 "worker.ts's header does not name the schedule refresh"
awk '/\/\*\*/{buf=""} {buf=buf"\n"$0} /async scheduled\(/{print buf; exit}' "$W" | grep -qi 'schedule month\|refreshDueScheduleMonth' || bad 11 "scheduled()'s comment does not name the schedule refresh"
grep -qF "ADR-021 lifetime has run" "$SM" && bad 11 "$SM's module comment still says months refresh on read by the ladder"
awk '/\/\*\*/{buf=""} {buf=buf"\n"$0} /^export function edgeCacheControl/{print buf; exit}' functions/src/handlers/cache-control.ts | grep -qi 'version' || bad 11 "edgeCacheControl's comment does not name the versioned month URL"
grep -qF "never by whether it is past" functions/src/handlers/api.ts && bad 11 "api.ts still says 'never by whether it is past'"
awk '/\/\*\*/{buf=""} {buf=buf"\n"$0} /^function withCacheControl/{print buf; exit}' functions/src/handlers/api.ts | grep -qi 'version' || bad 11 "withCacheControl's comment does not describe the month route's versioned lifetimes"
# The comment wraps across `//` lines, so it is read as one line with the comment markers taken out.
tr '\n' ' ' <web/src/api/scheduleMonth.ts | sed -E 's/[[:space:]]*\/\/[[:space:]]*/ /g; s/[[:space:]]+/ /g' | grep -qF "the API caches the answer on ADR-021's ladder" &&
	bad 11 "scheduleMonth.ts still says the API caches the answer on ADR-021's ladder"

# --- Check 12: Status done ---
[ "$(story_snapshot_status S194)" = "done" ] || bad 12 "S194's snapshot does not record Status done"

# --- Check 13: fence ---
fence='^(packages/domain/|packages/ports/src/repositories\.ts$|functions/src/|functions/vitest\.config\.ts$|openapi/|web/src/api/|web/vitest\.config\.ts$|docs/v3/backlog/|docs/v3/audit/|changelog\.d/S194\.md$|scripts/verify-S194\.sh$)'
while IFS= read -r f; do
	[ -z "$f" ] && continue
	grep -qE "$fence" <<<"$f" || bad 13 "outside the fence: $f"
done < <(story_own_changed_files S194 "$BASE" .)
own_added="$(story_own_diff S194 "$BASE" --name-status --diff-filter=A -- scripts/verify-S194.sh)"
[ -n "$own_added" ] || [ -n "$(git ls-files --others --exclude-standard -- scripts/verify-S194.sh)" ] || bad 13 "scripts/verify-S194.sh was not created by S194"

report "verify-S194"
exit $?
