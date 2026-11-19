#!/usr/bin/env bash
# Grader for BACKLOG story S140 — the standings answer names the World Series winner in the
# off-season (`champion`), read from the World Series schedule the season calendar already asks MLB
# for. A commit-time proof of this story (S84).
# Contract: docs/v3/BACKLOG.md#verify-script-contract
# No network. Never deploys. No writes outside /tmp. Does its own checking (story-scoped Vitest
# files only, found by the tag each AC's tests carry: "S140 AC <n>").

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "one exported function, worldSeriesChampion, decides the winner from the World Series schedule mapSeasonCalendar already reads: the team whose series wins in the last final, not-cancelled game exceed half its gamesInSeries; none while under way, with no Series, an empty schedule, or no gamesInSeries/series records (tests 'S140 AC 1': 2025 Dodgers, 2026 Brewers, 2027 empty none, 2026 cut to four games none, neither field none)"
check 2 "GET /api/v1/standings answers a top-level champion { season, teamId, name, wonOn } on off-season days on or after wonOn, null otherwise, the same for every includePhases (route tests 'S140 AC 2': 2025-11-15 Dodgers 2025-11-01; 2026-11-10 and 2026-10-28 Brewers 2026-10-28; 2026-10-27, 2026-10-01, 2026-09-05 and a spring day null), with the day's rule one tested domain function (domain tests 'S140 AC 2')"
check 3 "a standings request asks MLB nothing more than before (counting-client tests 'S140 AC 3'), and the season calendar still asks only the seasons and World Series URLs"
check 4 "openapi/bt-api.v1.json's StandingsResponse carries a required, nullable champion with season, teamId, name and wonOn; the spec is up to date (pnpm api:spec), pnpm api:breaking exits 0, and web/src/api/generated/ is rendered from it again"
check 5 "no visual change: the story changes nothing under web/src/ outside web/src/api/"
check 6 "backlog Status is done (story heading and Story status table)"
check 7 "the story changed nothing outside its fence (functions/src/, functions/vitest.config.ts, packages/domain/, packages/ports/, openapi/, fixtures/, web/src/api/, docs/v3/BACKLOG.md, docs/v3/backlog/, docs/v3/AUDIT.md, docs/v3/audit.jsonl, docs/v3/INDEX.md, CHANGELOG.md, scripts/verify-S140.sh)"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
BASE="a38ece9"  # HEAD when S140 started; the story's work comes after it

# run_tagged <check> <package dir> <tag> — runs every test file under the package's src/ that names
# <tag>, filtered to the tests carrying it; fails when none exists or none passes.
run_tagged() {
  local id="$1" dir="$2" tag="$3" files
  files="$(cd "$dir" && grep -rlF --include='*.test.ts' -- "$tag" src 2>/dev/null | grep -v '\.workerd\.test\.ts$')"
  if [ -z "$files" ]; then
    bad "$id" "no test in $dir/src names '$tag'"
    return
  fi
  # shellcheck disable=SC2086
  if ! (cd "$dir" && pnpm exec vitest run $files -t "$tag" --reporter=json --outputFile="$TMP/r.json" >"$TMP/r.log" 2>&1); then
    bad "$id" "$dir '$tag' failed:"; tail -15 "$TMP/r.log" | sed 's/^/        /'
  elif ! node -e 'const r = require(process.argv[1]); process.exit(r.numPassedTests > 0 && r.numFailedTests === 0 ? 0 : 1)' "$TMP/r.json"; then
    bad "$id" "$dir '$tag' ran no passing test"
  fi
}

# --- Check 1: who won the World Series ------------------------------------------------------------------
grep -qE '^export function worldSeriesChampion\(' functions/src/mappers/season-calendar.ts ||
  bad 1 "functions/src/mappers/season-calendar.ts exports no worldSeriesChampion function"
[ "$(grep -rlE 'function worldSeriesChampion\(' functions/src packages 2>/dev/null | grep -v '\.test\.ts$' | wc -l | tr -d ' ')" = "1" ] ||
  bad 1 "worldSeriesChampion is not defined exactly once"
awk '/^export function mapSeasonCalendar\(/{f=1} f{print} f&&/^}/{exit}' functions/src/mappers/season-calendar.ts | grep -qF 'worldSeriesChampion(' ||
  bad 1 "mapSeasonCalendar does not read the winner through worldSeriesChampion"
run_tagged 1 functions "S140 AC 1"

# --- Check 2: champion on the standings answer -------------------------------------------------------------
grep -qE 'champion' packages/domain/src/api-routes.ts || bad 2 "StandingsResponse (packages/domain/src/api-routes.ts) names no champion"
run_tagged 2 packages/domain "S140 AC 2"
run_tagged 2 functions "S140 AC 2"

# --- Check 3: MLB request budget unchanged --------------------------------------------------------------------
run_tagged 3 functions "S140 AC 3"

# --- Check 4: the spec and the generated types ------------------------------------------------------------------
node -e '
  const spec = require("./openapi/bt-api.v1.json");
  const schemas = spec.components?.schemas ?? {};
  const s = schemas.StandingsResponse;
  const find = (o) => {
    if (!o) return null;
    if (o.$ref) return find(schemas[o.$ref.split("/").pop()]);
    if (o.properties?.champion) return o;
    for (const k of ["allOf", "anyOf", "oneOf"]) for (const p of o[k] ?? []) { const r = find(p); if (r) return r; }
    return null;
  };
  const owner = find(s);
  if (!owner) { console.log("StandingsResponse has no champion property"); process.exit(1); }
  if (!(owner.required ?? []).includes("champion")) { console.log("champion is not required"); process.exit(1); }
  let c = owner.properties.champion;
  const text = JSON.stringify(c);
  if (!/null/.test(text)) { console.log("champion is not nullable"); process.exit(1); }
  const resolve = (o) => o.$ref ? schemas[o.$ref.split("/").pop()] : o;
  const variants = [c, ...(c.anyOf ?? []), ...(c.oneOf ?? [])].map(resolve);
  const obj = variants.find((v) => v && v.properties);
  for (const k of ["season", "teamId", "name", "wonOn"]) {
    if (!obj || !obj.properties[k] || !(obj.required ?? []).includes(k)) { console.log("champion lacks required " + k); process.exit(1); }
  }
' >"$TMP/spec-shape.txt" 2>&1 || bad 4 "openapi/bt-api.v1.json: $(cat "$TMP/spec-shape.txt")"
if ! (cd functions && pnpm exec tsx src/scripts/generate-openapi.ts --check >"$TMP/spec.log" 2>&1); then
  bad 4 "openapi/bt-api.v1.json is stale (pnpm api:spec):"; tail -5 "$TMP/spec.log" | sed 's/^/        /'
fi
if ! pnpm -s api:breaking >"$TMP/brk.log" 2>&1; then
  bad 4 "pnpm api:breaking failed:"; tail -8 "$TMP/brk.log" | sed 's/^/        /'
fi
grep -qE '^ +champion: ' web/src/api/generated/bt-api.v1.ts ||
  bad 4 "web/src/api/generated/bt-api.v1.ts has no champion"
if ! (cd web && pnpm exec vitest run src/api/codegen.test.ts >"$TMP/codegen.log" 2>&1); then
  bad 4 "web/src/api/generated/ is not rendered from the current spec (web/src/api/codegen.test.ts):"; tail -8 "$TMP/codegen.log" | sed 's/^/        /'
fi

# core.quotepath=false: git otherwise prints a name with a non-ASCII character (the frame note
# "00 Baseball Theater v3 — Checkable backlog.md") quoted and escaped, which no pattern below matches.
GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.quotepath GIT_CONFIG_VALUE_0=false story_changed_files S140 "$BASE" . >"$TMP/changed.txt"

# --- Check 5: no visual change ------------------------------------------------------------------------------------
grep -E '^web/src/' "$TMP/changed.txt" | grep -vE '^web/src/api/' >"$TMP/web.txt"
[ -s "$TMP/web.txt" ] && { bad 5 "files changed under web/src/ outside web/src/api/:"; sed 's/^/        /' "$TMP/web.txt"; }

# --- Check 6: backlog Status is done ------------------------------------------------------------------------------
grep -qE '^\| [0-9]+ \| \[S140\].*\| `done` \|' docs/v3/BACKLOG.md ||
  bad 6 "S140 row in the Story status table is not \`done\`"
awk '/^### S140 —/{f=1;next} /^### S[0-9]/{f=0} f' docs/v3/BACKLOG.md >"$TMP/s140.md"
grep -qE '^\*\*Status:\*\* `done`$' "$TMP/s140.md" || bad 6 "S140 story heading Status is not \`done\`"

# --- Check 7: the fence -------------------------------------------------------------------------------------------
grep -vE '^(functions/src/|functions/vitest\.config\.ts$|packages/domain/|packages/ports/|openapi/|fixtures/|web/src/api/|docs/v3/BACKLOG\.md$|docs/v3/backlog/|docs/v3/AUDIT\.md$|docs/v3/audit\.jsonl$|docs/v3/INDEX\.md$|CHANGELOG\.md$|scripts/verify-S140\.sh$|docs/v3/\.obsidian/)' "$TMP/changed.txt" >"$TMP/out.txt"
[ -s "$TMP/out.txt" ] && { bad 7 "files changed outside the fence:"; sed 's/^/        /' "$TMP/out.txt"; }

# --- Ledger notes (the reuse check and the cache reasoning), printed so audit.sh captures them -----------
cat <<'NOTES'
S140 notes (design reasoning, not checked by this grader beyond checks 1-3) —
Reuse check (ADR-025): mapSeasonCalendar's walk of the World Series games (worldSeriesFinal) is now one helper,
  seriesGamesOn (not-cancelled games with their day, in order), read by both worldSeriesFinal and the new
  worldSeriesChampion, so the winner comes from the same payload with no new request (worldSeriesUrl unchanged).
  SeasonCalendar (scoreboard-date.ts) gains an optional champion rather than a second calendar type; the day's rule,
  standingsChampion, is built on standingsPhase's final pick (the off-season as S128 defines it), beside
  standingsPhases in standings-phase.ts; getStandings reads it from the calendars standingsCalendars already returns.
  The mlb-api schedule types already carried gamesInSeries, isWinner and leagueRecord; nothing new was modelled.
  The counting client (standingsClient) and the S139 route-test helpers were reused for AC 2 and AC 3.
Freshness: nothing changed. The calendar cache (calendarKeepMs) and the standings' edge cache (standingsFreshness) both
  keep a season's answer only for the floor from regularSeasonEndDate through the day after lastGameDate
  (seasonSettling's postseason window), which covers the day the Series is decided (wonOn is on or before lastGameDate), so the
  winner appears within the floor; a past off-season date before wonOn is cached as settled with null, its correct
  answer for that day.
NOTES

report "verify-S140"
exit $?
