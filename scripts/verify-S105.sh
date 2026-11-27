#!/usr/bin/env bash
# Grader for backlog story S105 — BT keeps each ballpark's field drawing from Baseball Savant (fetched by ingest the
# first time a game there is stored, sanitized, kept) and serves it itself at GET /api/v1/venues/{venueId}/field.svg.
# A commit-time proof of this story (S84). Contract: docs/v3/backlog/frame/00 (Verify-script contract).
# No network. Never deploys. No writes outside /tmp. Does its own checking (story-scoped Vitest files only, found by
# the tag each AC's tests carry: "S105 AC <n>").

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "fixtures/raw/savant-field-4169.svg and fixtures/raw/savant-field-3313.svg are Savant's SVG answers (a 250×250 viewBox), committed; the fixture client (and the Worker's bundled one) serves them without the network; tests 'S105 AC 1'"
check 2 "MlbStatsClient has fetchVenueField(venueId: number) returning the SVG text or null, in the fixture and HTTP adapters (the HTTP one on Savant's host); ingest fetches a venue's drawing once, the first time a game there is stored, and keeps it; tests 'S105 AC 2' (a counting fake)"
check 3 "one function in functions/src sanitizes the SVG before it is stored (no <script>, no on* attribute, no href / xlink:href but a local # fragment, no <foreignObject>); the 4169 and 3313 recordings come through intact; tests 'S105 AC 3' (a hostile SVG among them)"
check 4 "GET /api/v1/venues/:venueId/field.svg is in the route table, dispatched, in the spec as image/svg+xml with a 404, and in the generated client; spec fresh, pnpm api:breaking 0, generated client rendered; no web code reaches Savant; tests 'S105 AC 4' (content type, long-lived Cache-Control, 404)"
check 5 "the source is optional: a venue with no drawing or a failed fetch answers 404 and the game is stored and served as before; tests 'S105 AC 5'"
check 6 "S105's snapshot records Status done (story_snapshot_status), and the story stays inside its scope files (plus its own records and scripts/verify-S105.sh), touching nothing under scripts/ or test/ but its grader"

# The commit S105's own changes start from (origin/stage when the story started, 2026-11-27). The fence (check 6)
# reads only S105's own commits from here through story_own_changed_files (scripts/lib/checks.sh).
BASE=72e31aaf
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
ROUTE="GET /api/v1/venues/:venueId/field.svg"
SPEC_PATH="/api/v1/venues/{venueId}/field.svg"

# run_tagged <check> <package dir> <tag> — runs every test file under the package's src/ that names <tag>,
# filtered to the tests carrying it; fails when none exists or none passes.
tagged_files() {
  (cd "$1" && grep -rlF --include="*.test.ts" --include="*.test.tsx" -- "$2" src 2>/dev/null | grep -v '\.workerd\.test\.ts$')
}
run_tagged() {
  local id="$1" dir="$2" tag="$3" files
  files="$(tagged_files "$dir" "$tag")"
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

# --- Check 1: the two recordings, read from disk -------------------------------------------------------------
for venue in 4169 3313; do
  rec="fixtures/raw/savant-field-$venue.svg"
  if [ ! -f "$rec" ]; then
    bad 1 "$rec is missing"
    continue
  fi
  grep -q '<svg' "$rec" || bad 1 "$rec holds no <svg> element"
  grep -qF 'viewBox="0 0 250 250"' "$rec" || bad 1 "$rec is not Savant's 250×250 field outline"
  git ls-files --error-unmatch "$rec" >/dev/null 2>&1 || bad 1 "$rec is not committed"
done
grep -rqF 'fetchVenueField' functions/src/adapters/fixtures/fixture-client.ts 2>/dev/null || bad 1 "the fixture client (functions/src/adapters/fixtures/fixture-client.ts) has no fetchVenueField"
run_tagged 1 functions "S105 AC 1"

# --- Check 2: the port, two adapters, fetched once by ingest -------------------------------------------------
# awk's output goes to a file first: under pipefail, grep -q's early exit can SIGPIPE awk and fail a match.
awk '/^export interface MlbStatsClient/{f=1} f{print} f&&/^}/{exit}' packages/ports/src/mlb.ts >"$TMP/port.txt"
grep -qE 'fetchVenueField\(venueId: number\): Promise<string \| null>' "$TMP/port.txt" ||
  bad 2 "MlbStatsClient (packages/ports/src/mlb.ts) has no fetchVenueField(venueId: number): Promise<string | null>"
grep -qF 'fetchVenueField' functions/src/adapters/http/mlb.ts || bad 2 "the HTTP client has no fetchVenueField"
grep -qF 'site-core/images/fields/' functions/src/adapters/http/mlb.ts || bad 2 "the HTTP client never names Savant's field drawings (site-core/images/fields/)"
# Ingest owns the call: a module under functions/src/services calls fetchVenueField( (tests aside), and nothing under
# functions/src/handlers names it (a request never reaches Savant). A module that only hands the method on (ingest.ts's
# after-step, `.bind`) doesn't call it, so check 3 doesn't ask it to sanitize. (Before S105 shipped this matched any
# mention, which flagged that hand-off; rule 7, shown red on 72e31aaf first.)
grep -rlE --include='*.ts' 'fetchVenueField\(' functions/src/services 2>/dev/null | grep -v '\.test\.ts$' >"$TMP/ingest.txt"
[ -s "$TMP/ingest.txt" ] || bad 2 "no ingest service (functions/src/services) calls fetchVenueField"
grep -rlF --include='*.ts' 'fetchVenueField' functions/src/handlers 2>/dev/null | grep -v '\.test\.ts$' >"$TMP/handlers.txt"
[ -s "$TMP/handlers.txt" ] && bad 2 "a request handler calls fetchVenueField: $(tr '\n' ' ' <"$TMP/handlers.txt")"
run_tagged 2 functions "S105 AC 2"

# --- Check 3: one sanitizer, used before storing ---------------------------------------------------------------
grep -rlE --include='*.ts' '^export function sanitize[A-Za-z]*Svg[A-Za-z]*\(' functions/src 2>/dev/null | grep -v '\.test\.ts$' >"$TMP/sanitizers.txt"
if [ "$(wc -l <"$TMP/sanitizers.txt")" -ne 1 ]; then
  bad 3 "expected exactly one exported sanitize…Svg function in functions/src, found: $(tr '\n' ' ' <"$TMP/sanitizers.txt")"
else
  name="$(grep -oE '^export function sanitize[A-Za-z]*Svg[A-Za-z]*' "$(cat "$TMP/sanitizers.txt")" | head -1 | sed 's/^export function //')"
  # Every ingest module that fetches a drawing also sanitizes it (calls the one function).
  while read -r f; do
    grep -qw "$name" "$f" || bad 3 "$f fetches a drawing but never calls $name"
  done <"$TMP/ingest.txt"
fi
run_tagged 3 functions "S105 AC 3"

# --- Check 4: the route, the spec, the generated client --------------------------------------------------------
grep -qF "\"$ROUTE\"" packages/domain/src/api-routes.ts || bad 4 "ApiRoutes (packages/domain/src/api-routes.ts) has no \"$ROUTE\""
grep -qF "route: \"$ROUTE\"" functions/src/handlers/api.ts || bad 4 "API_ROUTER (functions/src/handlers/api.ts) dispatches no \"$ROUTE\""
node -e '
  const spec = require("./openapi/bt-api.v1.json");
  const op = spec.paths?.[process.argv[1]]?.get;
  if (!op) { console.log("has no GET " + process.argv[1]); process.exit(1); }
  if (!op.responses?.["200"]?.content?.["image/svg+xml"]) { console.log("its 200 is not image/svg+xml"); process.exit(1); }
  if (!op.responses?.["404"]) { console.log("it lists no 404"); process.exit(1); }
' "$SPEC_PATH" >"$TMP/spec-shape.txt" 2>&1 || bad 4 "openapi/bt-api.v1.json: $(cat "$TMP/spec-shape.txt")"
if ! (cd functions && pnpm exec tsx src/scripts/generate-openapi.ts --check >"$TMP/spec.log" 2>&1); then
  bad 4 "openapi/bt-api.v1.json is stale (pnpm api:spec):"; tail -5 "$TMP/spec.log" | sed 's/^/        /'
fi
pnpm -s api:breaking >"$TMP/brk.log" 2>&1 || { bad 4 "pnpm api:breaking failed:"; tail -8 "$TMP/brk.log" | sed 's/^/        /'; }
grep -qF "\"$SPEC_PATH\"" web/src/api/generated/bt-api.v1.ts || bad 4 "the generated client (web/src/api/generated/bt-api.v1.ts) has no \"$SPEC_PATH\""
if ! (cd web && pnpm exec vitest run src/api/codegen.test.ts >"$TMP/codegen.log" 2>&1); then
  bad 4 "web/src/api/generated/ is not rendered from the current spec (web/src/api/codegen.test.ts):"; tail -8 "$TMP/codegen.log" | sed 's/^/        /'
fi
# The browser never asks Savant for a drawing: no web code names the drawings' path or the port method. (Before S105
# shipped this matched any `baseballsavant`, which S209's player-page links to Savant, merged from stage, legitimately
# name; rule 7, shown red on 72e31aaf first.)
grep -rnE --include='*.ts' --include='*.tsx' 'site-core/images/fields|fetchVenueField|baseballsavant\.mlb\.com/(gf|site-core)' web/src >"$TMP/web.txt" 2>/dev/null
[ -s "$TMP/web.txt" ] && bad 4 "web code reaches Savant: $(cut -d: -f1,2 "$TMP/web.txt" | tr '\n' ' ')"
run_tagged 4 functions "S105 AC 4"

# --- Check 5: the source is optional ----------------------------------------------------------------------------
run_tagged 5 functions "S105 AC 5"

# --- Check 6: Status done, inside the fence ---------------------------------------------------------------------
[ "$(story_snapshot_status S105)" = "done" ] || bad 6 "S105's snapshot does not record Status done"
story_own_changed_files S105 "$BASE" . >"$TMP/changed.txt"
grep -vE '^(fixtures/|packages/mlb-api/src/|packages/ports/src/|packages/domain/src/|functions/src/|functions/vitest\.config\.ts$|openapi/|docs/v3/backlog/|docs/v3/AUDIT\.md$|CHANGELOG\.md$|web/src/api/|docs/v3/audit/[^/]+/[^/]+-S105-[a-z-]+\.md$|changelog\.d/S105\.md$|scripts/verify-S105\.sh$)' "$TMP/changed.txt" >"$TMP/fence.txt"
[ -s "$TMP/fence.txt" ] && bad 6 "the story changes files outside its scope: $(tr '\n' ' ' <"$TMP/fence.txt")"
grep -E '^(scripts/|test/)' "$TMP/changed.txt" | grep -vE '^scripts/verify-S105\.sh$' >"$TMP/scripts.txt"
[ -s "$TMP/scripts.txt" ] && bad 6 "the story changes files under scripts/ or test/: $(tr '\n' ' ' <"$TMP/scripts.txt")"

report "verify-S105"
exit $?
