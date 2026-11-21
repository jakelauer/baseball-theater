#!/usr/bin/env bash
# Grader for BACKLOG story S139 — Standings answers spring training, the regular season and the
# playoffs at once (owner, 2026-11-13: "it should categorize the results based on the season
# phase, and then return them all by default unless the API query specifies an "includePhases"
# query parameter"). One domain function says what each phase holds on a day; the route adds
# `phases` beside S128's unchanged answer, takes `includePhases`, and is cached at the edge with
# ADR-021's ladder carried to a 30-day cap for standings only; the calendars are cached for a day.
# A commit-time proof of this story (S84).
# Contract: docs/v3/BACKLOG.md#verify-script-contract
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`).

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "season phases spring, regularSeason, playoffs: one exported type and ordered list in packages/domain beside StandingsPhaseName; StandingsResponse keeps S128's fields and gains phases ({ startDate, endDate, table? } | null per phase); generated.types.test.ts lists the new types"
check 2 "one domain function beside standingsPhase answers the season and each phase's dates and pick for a day from the calendars only (2027-02-18, 2027-02-19, 2027-03-24, 2027-03-25, 2026-09-05, 2026-09-27, 2026-09-28, after lastGameDate, before every season, no calendar, missing regularSeasonEndDate, lastGameDate = regularSeasonEndDate)"
check 3 "GET /api/v1/standings takes includePhases (comma, repeated, mixed; duplicates once; exact names); bad names, empty names and spaces answer 400 include_phases_invalid naming the phases and ask MLB nothing; date is checked first; top-level fields identical whatever includePhases names"
check 4 "the regular season before its first game lists the new season's teams by division in name order at 0-0 with null figures (spring teams when spring has any; on the first spring morning MLB's new-season team list, never last season's); S128's top-level table keeps its fallback"
check 5 "MLB's answers recorded under fixtures/raw/ and drift-scanned (spring+regular in one request on a spring and an April day, playoffs types, the new season's teams); the request budget is tested with a counting client; bundled.ts lists every recording the fixture client reads and its guard fails without it"
check 6 "fixtures/raw/standings-2026-09-12.json and fixtures/standings-2026-09-12.json: 1 to 11 teams clinched; its playoffs list is tested, and 2026-09-05's playoffs table has no division"
check 7 "fetchStandings/useStandings take an optional phase list sent comma-joined, keyed in phase order; the spec has includePhases (form, explode false), phases and the 400; pnpm api:breaking exits 0; generated types re-rendered"
check 8 "cached, not stored: no standings repository or table; cacheLifetimeMs takes a ladder, STANDINGS_CACHE_LIFETIME_LADDER caps at 30 days; the route's Cache-Control follows the day asked; calendars kept 24 hours (the floor in the postseason window, rejections never kept); a workerd test shows the Workers Cache serves them"
check 9 "no visual change: nothing under web/src outside web/src/api changes, and nothing outside the story's scope files"
check 10 "backlog Status is done (story heading and Story status table)"

BASE=f4a29a361a4b8ee2f7951d7f0190306e23b3e3a0
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
DOMAIN_FN="packages/domain/src/standings-phase.ts"
DOMAIN_TEST="src/standings-phase.test.ts"
SERVICE_TEST="src/services/standings.test.ts"
ROUTE_TEST="src/handlers/api.test.ts"

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

# --- Check 1: the phases and the answer's shape -------------------------------------------------------
grep -qE 'export type SeasonPhaseName = "spring" \| "regularSeason" \| "playoffs";' packages/domain/src/types.ts || bad 1 "packages/domain/src/types.ts has no SeasonPhaseName = \"spring\" | \"regularSeason\" | \"playoffs\""
grep -qE 'export const SEASON_PHASES[^=]*= \["spring", "regularSeason", "playoffs"\]' packages/domain/src/types.ts || bad 1 "packages/domain/src/types.ts has no ordered SEASON_PHASES list"
grep -qE 'phases: StandingsPhases' packages/domain/src/api-routes.ts || bad 1 "StandingsResponse has no phases"
grep -qE 'export type StandingsResponse = StandingsSnapshot &' packages/domain/src/api-routes.ts || bad 1 "StandingsResponse no longer keeps S128's StandingsSnapshot fields at the top"
for t in StandingsPhases StandingsPhaseAnswer; do
  grep -qF "$t" web/src/api/generated.types.test.ts || bad 1 "web/src/api/generated.types.test.ts does not list $t"
done
run_vitest 1 web src/api/generated.types.test.ts

# --- Check 2: what each phase holds on a day -------------------------------------------------------------
grep -qE 'export function standingsPhases\(' "$DOMAIN_FN" 2>/dev/null || bad 2 "$DOMAIN_FN does not export standingsPhases"
sed -n '/export function standingsPhases(/,/^}/p' "$DOMAIN_FN" >"$TMP/fn.ts"
grep -qF 'standingsPhase(' "$TMP/fn.ts" || bad 2 "standingsPhases is not built on standingsPhase"
grep -qE 'new Date|Date\.now|mlbToday' "$TMP/fn.ts" && bad 2 "standingsPhases reads the clock"
for t in "2027-02-18" "2027-02-19" "2027-03-24" "2027-03-25" "2026-09-05" "2026-09-27" "2026-09-28" "after lastGameDate" "before every known season" "no calendar" "missing regularSeasonEndDate" "no postseason day"; do
  run_vitest 2 packages/domain "$DOMAIN_TEST" -t "standingsPhases $t"
done

# --- Check 3: includePhases ----------------------------------------------------------------------------
grep -qF 'include_phases_invalid' functions/src/handlers/api.ts || bad 3 "the standings route has no include_phases_invalid error"
grep -qF 'getAll("includePhases")' functions/src/handlers/api.ts || bad 3 "the standings route does not read every includePhases value"
for t in "no includePhases" "each phase alone" "comma, repeated and mixed" "named twice" "invalid includePhases" "bad date before includePhases" "top-level fields identical"; do
  run_vitest 3 functions "$ROUTE_TEST" -t "standings $t"
done

# --- Check 4: the regular season before its first game ----------------------------------------------------
for t in "blank regular season from spring teams" "first spring morning"; do
  run_vitest 4 functions "$SERVICE_TEST" -t "$t"
done

# --- Check 5: recordings, budget, bundle -----------------------------------------------------------------------
for f in standings-2026-03-10-spring-regular standings-2026-04-05-spring-regular standings-2026-09-20-wildcard standings-2026-final-wildcard standings-2026-postseason standings-2027-final standings-2026-09-12; do
  [ -f "fixtures/raw/$f.json" ] || bad 5 "fixtures/raw/$f.json missing"
done
if pnpm -s mlb:scan-drift >"$TMP/drift.log" 2>&1; then
  for f in standings-2026-03-10-spring-regular standings-2026-04-05-spring-regular standings-2026-09-20-wildcard standings-2026-final-wildcard standings-2026-postseason standings-2027-final standings-2026-09-12; do
    grep -qE "^  $f\.json$" "$TMP/drift.log" || bad 5 "pnpm mlb:scan-drift does not scan $f.json"
  done
else
  bad 5 "pnpm mlb:scan-drift reports drift:"; tail -10 "$TMP/drift.log" | sed 's/^/        /'
fi
for f in raw/standings-2027-final.json standings-2026-09-12.json; do
  grep -qF "\"$f\"" functions/src/adapters/fixtures/bundled.ts || bad 5 "bundled.ts does not list $f"
done
# What the recordings hold, as the ledger notes report it (the directory is an argument so a doctored copy can show it red).
recordings_hold() {
  node -e '
const dir = process.argv[1];
const records = (f) => require(`${dir}/${f}.json`).records || [];
const types = (f) => [...new Set(records(f).map((r) => r.standingsType))].join(",");
const clinched = (f, type) => records(f).filter((r) => r.standingsType === type).flatMap((r) => r.teamRecords).filter((t) => t.clinched).map((t) => t.team.abbreviation);
const fails = [];
if (types("standings-2026-03-10-spring-regular") !== "springTraining") fails.push("2026-03-10 springTraining,regularSeason is not spring alone");
if (types("standings-2026-04-05-spring-regular") !== "regularSeason") fails.push("2026-04-05 springTraining,regularSeason is not the regular season alone");
if (records("standings-2026-postseason").length !== 0) fails.push("standingsTypes=postseason has records");
for (const f of ["standings-2026-09-20-wildcard", "standings-2026-final-wildcard"]) {
  const regular = new Set(clinched(f, "regularSeason"));
  const wildCard = clinched(f, "wildCard");
  if (wildCard.length === 0 || !wildCard.every((t) => regular.has(t))) fails.push(`${f}: wildCard clinched teams are not a subset of the regular season'"'"'s`);
}
if (clinched("standings-2026-09-20-wildcard", "regularSeason").length !== 6) fails.push("2026-09-20 does not have 6 teams clinched");
const next = records("standings-2027-final");
const nextTeams = next.flatMap((r) => r.teamRecords);
if (types("standings-2027-final") !== "regularSeason" || nextTeams.length !== 30 || !nextTeams.every((t) => t.wins === 0 && t.losses === 0)) fails.push("2027 season table is not 30 regular-season teams at 0-0");
if (JSON.stringify(clinched("standings-2026-09-12", "regularSeason").sort()) !== JSON.stringify(["MIL", "TB"])) fails.push("2026-09-12 clinched is not exactly TB and MIL");
if (fails.length) { console.log(fails.join("\n")); process.exit(1); }
' "$1"
}
recordings_hold "$PWD/fixtures/raw" >"$TMP/rec.log" 2>&1 || { bad 5 "the recordings don't hold what the notes say:"; sed 's/^/        /' "$TMP/rec.log"; }
run_vitest 5 functions "$SERVICE_TEST" -t "request budget"
# The verified count beside each counting-client case (AC 5): the block of the S139 budget test, to its own end.
budget_commented() {
  awk '/it\("request budget, with phases/{f=1} f{print} f&&/^\t}\);$/{exit}' "$1" >"$TMP/budget.ts"
  local n c
  n="$(grep -cE 'expect\(await count\(' "$TMP/budget.ts")"
  c="$(grep -cE 'expect\(await count\(.*\)\)\.toBe\([0-9]+\); // ' "$TMP/budget.ts")"
  grep -qF "verified against MLB" "$TMP/budget.ts" && [ "$n" -ge 8 ] && [ "$n" = "$c" ]
}
budget_commented "functions/$SERVICE_TEST" || bad 5 "the counting-client test does not say it is verified against MLB, or a count has no comment"
run_vitest 5 functions src/adapters/fixtures/bundled.test.ts

# --- Check 6: a day with clinched teams --------------------------------------------------------------------
for f in fixtures/raw/standings-2026-09-12.json fixtures/standings-2026-09-12.json; do
  [ -f "$f" ] || { bad 6 "$f missing"; continue; }
  n="$(node -e '
const d = require(process.argv[1]);
const teams = d.records ? d.records.flatMap((r) => r.teamRecords) : d.divisions.flatMap((v) => v.teams);
process.stdout.write(String(teams.filter((t) => t.clinched).length));
' "./$f")"
  { [ "$n" -ge 1 ] && [ "$n" -lt 12 ]; } || bad 6 "$f has $n teams clinched, want 1 to 11"
done
run_vitest 6 functions "$SERVICE_TEST" -t "playoffs list"

# --- Check 7: web client and spec ---------------------------------------------------------------------------
run_vitest 7 web src/api/standings.test.ts
node -e '
const s = require("./openapi/bt-api.v1.json");
const op = s.paths["/api/v1/standings"].get;
const p = (op.parameters || []).find((x) => x.name === "includePhases");
const t = JSON.stringify(s);
const ok = p && p.style === "form" && p.explode === false && p.schema.type === "array"
  && JSON.stringify(p.schema.items.enum) === JSON.stringify(["spring", "regularSeason", "playoffs"])
  && /repeat/i.test(p.description) && op.responses["400"] && t.includes("include_phases_invalid") && t.includes("\"phases\"");
process.exit(ok ? 0 : 1);
' || bad 7 "openapi/bt-api.v1.json lacks includePhases (array, form, explode false, repeated form described), phases or the 400"
pnpm -s api:breaking >"$TMP/breaking.log" 2>&1 || { bad 7 "pnpm api:breaking fails:"; tail -10 "$TMP/breaking.log" | sed 's/^/        /'; }
grep -qF 'includePhases' web/src/api/generated/schema.ts 2>/dev/null || grep -rqF 'includePhases' web/src/api/generated/ || bad 7 "web/src/api/generated/ is not re-rendered with includePhases"
run_vitest 7 web src/api/codegen.test.ts

# --- Check 8: cached, not stored ------------------------------------------------------------------------------
grep -rqiE 'interface Standings\w*Repository' packages/ports/src && bad 8 "packages/ports declares a standings repository"
grep -rliE 'standings' functions/src/adapters/postgres/ 2>/dev/null | grep -v '\.test\.ts$' >"$TMP/pg.txt"
[ -s "$TMP/pg.txt" ] && bad 8 "postgres adapters mention standings: $(tr '\n' ' ' <"$TMP/pg.txt")"
grep -qE 'export const STANDINGS_CACHE_LIFETIME_LADDER' packages/domain/src/cache-lifetime.ts || bad 8 "no STANDINGS_CACHE_LIFETIME_LADDER"
grep -qE 'export const STANDINGS_CACHE_LIFETIME_CAP_MS' packages/domain/src/cache-lifetime.ts || bad 8 "no STANDINGS_CACHE_LIFETIME_CAP_MS"
grep -qE 'export function cacheLifetimeMs\([^)]*ladder' packages/domain/src/cache-lifetime.ts || bad 8 "cacheLifetimeMs takes no ladder argument"
run_vitest 8 packages/domain src/cache-lifetime.test.ts
run_vitest 8 functions src/handlers/cache-control.test.ts
run_vitest 8 functions "$ROUTE_TEST" -t "standings Cache-Control"
run_vitest 8 functions src/adapters/cached-season-calendars.test.ts
if ! (cd functions && pnpm exec vitest run --config vitest.workers.config.ts src/worker.workerd.test.ts -t "standings calendars" --reporter=json --outputFile="$TMP/w.json" >"$TMP/w.log" 2>&1); then
  bad 8 "the workerd standings calendar test failed:"; tail -15 "$TMP/w.log" | sed 's/^/        /'
elif ! node -e 'process.exit(require(process.argv[1]).numPassedTests > 0 ? 0 : 1)' "$TMP/w.json"; then
  bad 8 "the workerd standings calendar test ran no passing test"
fi

# --- Check 9: no visual change, inside the fence -------------------------------------------------------------
# core.quotepath=false: git otherwise prints a non-ASCII name quoted, which the fence would misread (#87).
export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.quotepath GIT_CONFIG_VALUE_0=false
story_changed_files S139 "$BASE" web/src | grep -v '^web/src/api/' >"$TMP/web.txt"
[ -s "$TMP/web.txt" ] && bad 9 "the story changes web code outside web/src/api: $(tr '\n' ' ' <"$TMP/web.txt")"
story_changed_files S139 "$BASE" . | grep -vE '^(functions/src/|functions/vitest\.config\.ts$|packages/domain/|packages/ports/|openapi/|fixtures/|web/src/api/|docs/v3/BACKLOG\.md$|docs/v3/backlog/|docs/v3/AUDIT\.md$|docs/v3/audit\.jsonl$|docs/v3/INDEX\.md$|CHANGELOG\.md$|scripts/verify-S139\.sh$|docs/v3/\.obsidian/)' >"$TMP/fence.txt"
[ -s "$TMP/fence.txt" ] && bad 9 "the story changes files outside its scope: $(tr '\n' ' ' <"$TMP/fence.txt")"
unset GIT_CONFIG_COUNT GIT_CONFIG_KEY_0 GIT_CONFIG_VALUE_0

# --- Check 10: backlog Status is done ---------------------------------------------------------------------
grep -qE '^\| [0-9]+ \| \[S139\].*\| `done` \|$' docs/v3/BACKLOG.md ||
  bad 10 "S139 row in the Story status table is not \`done\`"
awk '/^### S139 —/{f=1;next} /^### S[0-9]/{f=0} f' docs/v3/BACKLOG.md > "$TMP/s139.md"
grep -qE '^\*\*Status:\*\* `done`$' "$TMP/s139.md" || bad 10 "S139 story heading Status is not \`done\`"

# --- Ledger notes (AC 5's recordings and the reuse check), printed so audit.sh captures them -----------
cat <<'NOTES'
S139 notes (not checked by this grader beyond what check 5 asserts of the recordings and the budget test) —
MLB's answers, recorded 2026-11-18 with the repo's recorder (verbatim, fixtures/raw/, drift-scanned):
- springTraining,regularSeason in one request (standings-2026-03-10-spring-regular, standings-2026-04-05-spring-regular):
  it answers only the table the day has: six springTraining records on 2026-03-10, six regularSeason records on 2026-04-05
  (no spring table, though spring's last-day table exists). So it is two requests, as the owner asked to check.
- Playoffs: standingsTypes=postseason answers no records (standings-2026-postseason). wildCard
  (standings-2026-09-20-wildcard, standings-2026-final-wildcard) comes in the same request as the regular season but
  only ranks the non-division-leaders; its clinched teams are a subset of the regular-season table's (2026-09-20:
  BOS, NYY of 6; final: 6 of 12), so it names no different set. The playoffs phase is the regular-season table's
  clinched teams, at no request of its own.
- The new season's teams before its first game: the season's table with no date (standings-2027-final, the URL
  fetchFinalStandings asks) lists all 30 teams at 0-0, regularSeason type. So AC 4's first-spring-morning list is
  fetchFinalStandings(new season).
- AC 6: standings-2026-09-12 has 2 teams clinched (TB, MIL); 2026-09-20 has 6 (standings-2026-09-20-wildcard's
  regular-season records), and 2026's final table all 12.
- Verified budget (standings requests beyond the two calendars): regular-season day 2, spring day 1, off-season 2,
  first spring morning 3, no calendar 1; includePhases=playoffs or regularSeason on 2026-09-05 1; spring on a spring day 1.
Reuse check (ADR-025): standingsPhase, previousStandingsPhase, StandingsPick (standingsPhases is built on them, the
  pick type reused for every phase), StandingsPhaseName's spring/regularSeason reused as SeasonPhaseName's, addDays,
  SeasonCalendar, mlbToday (the new mlbDayEndsAt sits beside it, the one place BT knows MLB's zone), fetchPick and
  isEmpty in the standings service (kept; picks are memoized per request so a shared table is asked once),
  standingsCalendars (now takes any fetchSeasonCalendar source, the cache adapter's, and says whether every calendar
  answered), cacheLifetimeMs (gains a ladder argument, not copied) and edgeCacheControl (gains the same), the route's
  withCacheControl, isCalendarDate for the date check, the S128 standings fixtures and recordedClient;
  fetchStandings/standingsKey extended rather than duplicated, with SEASON_PHASES/SeasonPhaseName from the domain.
  New in the domain beside standingsPhases: playoffsTable and blankRegularSeasonTable (the playoffs list and AC 4's
  0-0 list), and seasonSettling, the postseason window the calendar cache already used (calendarKeepMs now calls it)
  and the standings' edge cache now judges an answer's season by. Nothing fit the calendar cache, so
  cached-season-calendars.ts is new, an adapter around the unchanged port.
Grader changed before shipping (pre-PR review, 2026-11-18): check 5 now asserts the recording claims above and that
  every counting-client case carries its verified count; tightening only.
NOTES

report "verify-S139"
exit $?
