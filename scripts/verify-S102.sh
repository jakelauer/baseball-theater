#!/usr/bin/env bash
# Grader for backlog story S102 — the standings carry each division's name from MLB (`hydrate=division`),
# not a lookup table BT keeps. A commit-time proof of this story (S84).
# Contract: docs/v3/backlog/frame/00 (Verify-script contract).
# No network. Never deploys. No writes outside /tmp. Does its own checking (story-scoped Vitest
# files only, found by the tag each AC's tests carry: "S102 AC <n>").

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "the standings request adds hydrate=division (standingsUrl asks hydrate=team,division); fixtures/raw/standings-2026-09-05-division.json is MLB's answer to that request for both leagues (AL 103 and NL 104), each record's division named (name, nameShort, abbreviation); tests 'S102 AC 1'"
check 2 "packages/mlb-api parses the division (id, name, abbreviation, nameShort) with zod, the coverage gate lists the new recording, and pnpm mlb:scan-drift scans it with no drift; tests 'S102 AC 2'"
check 3 "the mapper carries each division's name and abbreviation into StandingsDivision additively (optional nameShort/abbreviation, spec fresh, pnpm api:breaking 0, generated client rendered, fixtures/standings-2026-09-05.json regenerated from the recording); no divisionName and no hand-written division-name map left in BT; the Standings heading reads nameShort and RTL still finds \"AL East\"; tests 'S102 AC 3'"
check 4 "S102's snapshot records Status done (story_snapshot_status), and the story stays inside its scope files (plus its own records and scripts/verify-S102.sh), touching nothing under scripts/ or test/ but its grader"

# The commit S102's own changes start from (origin/stage when the story started, 2026-11-23). The fence
# (check 4) reads only S102's own commits from here through story_own_changed_files (scripts/lib/checks.sh).
BASE=1f0261e7
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
RECORDING=fixtures/raw/standings-2026-09-05-division.json

# run_tagged <check> <package dir> <tag> <ext> — runs every test file under the package's src/ that names
# <tag>, filtered to the tests carrying it; fails when none exists or none passes.
run_tagged() {
  local id="$1" dir="$2" tag="$3" ext="${4:-ts}" files
  files="$(cd "$dir" && grep -rlF --include="*.test.$ext" -- "$tag" src 2>/dev/null | grep -v '\.workerd\.test\.ts$')"
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

# --- Check 1: the request and the recording -----------------------------------------------------------------
awk '/^export function standingsUrl\(/{f=1} f{print} f&&/^}/{exit}' functions/src/adapters/http/mlb.ts | grep -qF 'hydrate=team,division' ||
  bad 1 "standingsUrl (functions/src/adapters/http/mlb.ts) does not ask hydrate=team,division"
if [ ! -f "$RECORDING" ]; then
  bad 1 "$RECORDING is missing"
else
  node -e '
    const j = require(require("path").resolve(process.argv[1]));
    const recs = j.records ?? [];
    const leagues = new Set(recs.map((r) => r.league?.id));
    if (!leagues.has(103) || !leagues.has(104)) { console.log("not both leagues: " + [...leagues]); process.exit(1); }
    if (recs.length !== 6) { console.log("expected 6 division records, got " + recs.length); process.exit(1); }
    for (const r of recs) {
      const d = r.division ?? {};
      if (!d.name || !d.nameShort || !d.abbreviation) { console.log("division " + d.id + " is not named: " + JSON.stringify(d)); process.exit(1); }
    }
    const east = recs.find((r) => r.division.id === 201);
    if (east?.division.nameShort !== "AL East") { console.log("division 201 nameShort is not AL East"); process.exit(1); }
  ' "$RECORDING" >"$TMP/rec.txt" 2>&1 || bad 1 "$RECORDING: $(cat "$TMP/rec.txt")"
fi
run_tagged 1 functions "S102 AC 1"

# --- Check 2: the parser and the drift scan -----------------------------------------------------------------
grep -qF 'nameShort' packages/mlb-api/src/parse.ts || bad 2 "packages/mlb-api/src/parse.ts models no nameShort"
grep -qF 'nameShort' packages/mlb-api/src/standings.ts || bad 2 "packages/mlb-api/src/standings.ts types no nameShort"
grep -qF '"standings-2026-09-05-division.json"' packages/mlb-api/src/coverage.test.ts ||
  bad 2 "packages/mlb-api/src/coverage.test.ts does not gate the division recording"
pnpm -s mlb:scan-drift >"$TMP/drift.txt" 2>&1 || { bad 2 "pnpm mlb:scan-drift found drift:"; tail -15 "$TMP/drift.txt" | sed 's/^/        /'; }
grep -qE '^ +standings-2026-09-05-division\.json$' "$TMP/drift.txt" || bad 2 "pnpm mlb:scan-drift did not scan standings-2026-09-05-division.json"
run_tagged 2 packages/mlb-api "S102 AC 2"

# --- Check 3: the mapper, the spec, no hand map, the heading ------------------------------------------------
awk '/^export type StandingsDivision = \{/{f=1} f{print} f&&/^\};/{exit}' packages/domain/src/types.ts >"$TMP/type.txt"
grep -qE '^\s*nameShort\?: string \| null;' "$TMP/type.txt" || bad 3 "StandingsDivision has no optional nameShort?: string | null"
grep -qE '^\s*abbreviation\?: string \| null;' "$TMP/type.txt" || bad 3 "StandingsDivision has no optional abbreviation?: string | null"
node -e '
  const s = require("./openapi/bt-api.v1.json").components?.schemas?.StandingsDivision;
  if (!s) { console.log("no StandingsDivision schema"); process.exit(1); }
  for (const k of ["nameShort", "abbreviation"]) {
    if (!s.properties?.[k]) { console.log("StandingsDivision has no " + k); process.exit(1); }
    if ((s.required ?? []).includes(k)) { console.log(k + " is required, so an answer from before S102 would not parse"); process.exit(1); }
  }
' >"$TMP/spec-shape.txt" 2>&1 || bad 3 "openapi/bt-api.v1.json: $(cat "$TMP/spec-shape.txt")"
if ! (cd functions && pnpm exec tsx src/scripts/generate-openapi.ts --check >"$TMP/spec.log" 2>&1); then
  bad 3 "openapi/bt-api.v1.json is stale (pnpm api:spec):"; tail -5 "$TMP/spec.log" | sed 's/^/        /'
fi
if ! pnpm -s api:breaking >"$TMP/brk.log" 2>&1; then
  bad 3 "pnpm api:breaking failed:"; tail -8 "$TMP/brk.log" | sed 's/^/        /'
fi
if ! (cd web && pnpm exec vitest run src/api/codegen.test.ts >"$TMP/codegen.log" 2>&1); then
  bad 3 "web/src/api/generated/ is not rendered from the current spec (web/src/api/codegen.test.ts):"; tail -8 "$TMP/codegen.log" | sed 's/^/        /'
fi
node -e '
  const f = JSON.parse(require("fs").readFileSync("fixtures/standings-2026-09-05.json", "utf8"));
  const east = f.divisions.find((d) => d.divisionId === 201);
  if (east?.nameShort !== "AL East" || east?.abbreviation !== "ALE" || east?.name !== "American League East") {
    console.log("division 201 is " + JSON.stringify({ name: east?.name, nameShort: east?.nameShort, abbreviation: east?.abbreviation })); process.exit(1);
  }
' >"$TMP/fx.txt" 2>&1 || bad 3 "fixtures/standings-2026-09-05.json is not regenerated with the names: $(cat "$TMP/fx.txt")"
grep -rnw --include='*.ts' --include='*.tsx' 'divisionName' packages/domain/src packages/mlb-api/src packages/ports/src functions/src web/src >"$TMP/dn.txt" 2>/dev/null
[ -s "$TMP/dn.txt" ] && bad 3 "divisionName is still in BT: $(cut -d: -f1,2 "$TMP/dn.txt" | tr '\n' ' ')"
# A hand map names a division in source: any of the six short or full names as a string literal outside tests.
grep -rnE --include='*.ts' --include='*.tsx' '"(AL|NL) (East|Central|West)"|"(American|National) League (East|Central|West)"' \
  packages/domain/src packages/mlb-api/src packages/ports/src functions/src web/src 2>/dev/null |
  grep -vE '\.test\.tsx?:|/test/' >"$TMP/map.txt"
[ -s "$TMP/map.txt" ] && bad 3 "a division name is written by hand in BT source: $(cut -d: -f1,2 "$TMP/map.txt" | tr '\n' ' ')"
grep -qF 'nameShort' web/src/components/standings/DivisionTable.tsx || bad 3 "the Standings heading (DivisionTable.tsx) does not read nameShort"
run_tagged 3 functions "S102 AC 3"
run_tagged 3 web "S102 AC 3" tsx

# --- Check 4: Status done, inside the fence -----------------------------------------------------------------
[ "$(story_snapshot_status S102)" = "done" ] || bad 4 "S102's snapshot does not record Status done"
story_own_changed_files S102 "$BASE" . >"$TMP/changed.txt"
grep -vE '^(fixtures/|packages/mlb-api/src/|packages/ports/src/|packages/domain/src/|functions/src/|functions/vitest\.config\.ts$|openapi/|web/src/pages/|web/src/components/|docs/v3/backlog/|docs/v3/AUDIT\.md$|CHANGELOG\.md$|docs/v3/audit/[^/]+/[^/]+-S102-[a-z-]+\.md$|changelog\.d/S102\.md$|scripts/verify-S102\.sh$)' "$TMP/changed.txt" >"$TMP/fence.txt"
[ -s "$TMP/fence.txt" ] && bad 4 "the story changes files outside its scope: $(tr '\n' ' ' <"$TMP/fence.txt")"
grep -E '^(scripts/|test/)' "$TMP/changed.txt" | grep -vE '^scripts/verify-S102\.sh$' >"$TMP/scripts.txt"
[ -s "$TMP/scripts.txt" ] && bad 4 "the story changes files under scripts/ or test/: $(tr '\n' ' ' <"$TMP/scripts.txt")"

report "verify-S102"
exit $?
