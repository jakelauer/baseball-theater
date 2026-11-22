#!/usr/bin/env bash
# Grader for backlog story S160 — the standings answer carries MLB's clinch letter (`clinchIndicator`)
# on every clinched team, in every table the answer holds. A commit-time proof of this story (S84).
# Contract: docs/v3/backlog/frame/00 (Verify-script contract).
# No network. Never deploys. No writes outside /tmp. Does its own checking (story-scoped Vitest
# files only, found by the tag each AC's tests carry: "S160 AC <n>").

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "StandingsTeamRecord gains an optional clinchIndicator?: string | null: MLB's letter as sent on a clinched team (z, y, w, x, or any other such as e), null on an unclinched team and when MLB sends none or \"\"; clinched unchanged (mapper tests 'S160 AC 1' on standings-2026-final.json and standings-2026-09-12.json, plus hand-built rows)"
check 2 "the field is additive: openapi/bt-api.v1.json's StandingsTeamRecord has clinchIndicator, not required and nullable; the spec is up to date (pnpm api:spec), pnpm api:breaking exits 0, web/src/api/generated/ is rendered from it again with clinchIndicator optional; a record without the field still parses through the generated schema (tests 'S160 AC 2')"
check 3 "every table the answer carries holds the field, a letter or null: the top-level table and phases.spring, phases.regularSeason and phases.playoffs on the 2026 final fixture asking every phase, and blank rows null (service tests 'S160 AC 3')"
check 4 "S160's snapshot records Status done (story_snapshot_status), and the story stays inside its scope files (plus its own records and scripts/verify-S160.sh), touching nothing under scripts/ or test/ but its grader"

# The commit S160's own changes start from (origin/stage when the story started, 2026-11-21). The fence
# (check 4) reads only S160's own commits from here through story_own_changed_files (scripts/lib/checks.sh).
BASE=588b5c78
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

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

# --- Check 1: the type and the mapper -----------------------------------------------------------------------
awk '/^export type StandingsTeamRecord = \{/{f=1} f{print} f&&/^\};/{exit}' packages/domain/src/types.ts >"$TMP/type.txt"
grep -qE '^\s*clinchIndicator\?: string \| null;' "$TMP/type.txt" ||
  bad 1 "StandingsTeamRecord (packages/domain/src/types.ts) has no optional clinchIndicator?: string | null"
grep -qE '^\s*clinched: boolean;' "$TMP/type.txt" || bad 1 "StandingsTeamRecord's clinched: boolean changed"
awk '/^export function mapStandingsTeam\(/{f=1} f{print} f&&/^}/{exit}' functions/src/mappers/standings.ts | grep -qF 'clinchIndicator' ||
  bad 1 "mapStandingsTeam (functions/src/mappers/standings.ts) does not map clinchIndicator"
run_tagged 1 functions "S160 AC 1"

# --- Check 2: the spec, the generated client, the old answer ------------------------------------------------
node -e '
  const spec = require("./openapi/bt-api.v1.json");
  const s = spec.components?.schemas?.StandingsTeamRecord;
  if (!s) { console.log("no StandingsTeamRecord schema"); process.exit(1); }
  const p = s.properties?.clinchIndicator;
  if (!p) { console.log("StandingsTeamRecord has no clinchIndicator property"); process.exit(1); }
  if ((s.required ?? []).includes("clinchIndicator")) { console.log("clinchIndicator is required, so an answer from before S160 would not parse"); process.exit(1); }
  const text = JSON.stringify(p);
  if (!/null/.test(text) || !/string/.test(text)) { console.log("clinchIndicator is not a nullable string: " + text); process.exit(1); }
  if (!(s.required ?? []).includes("clinched")) { console.log("clinched is no longer required"); process.exit(1); }
' >"$TMP/spec-shape.txt" 2>&1 || bad 2 "openapi/bt-api.v1.json: $(cat "$TMP/spec-shape.txt")"
if ! (cd functions && pnpm exec tsx src/scripts/generate-openapi.ts --check >"$TMP/spec.log" 2>&1); then
  bad 2 "openapi/bt-api.v1.json is stale (pnpm api:spec):"; tail -5 "$TMP/spec.log" | sed 's/^/        /'
fi
if ! pnpm -s api:breaking >"$TMP/brk.log" 2>&1; then
  bad 2 "pnpm api:breaking failed:"; tail -8 "$TMP/brk.log" | sed 's/^/        /'
fi
grep -qE '^ +clinchIndicator\?: ' web/src/api/generated/bt-api.v1.ts ||
  bad 2 "web/src/api/generated/bt-api.v1.ts has no optional clinchIndicator"
if ! (cd web && pnpm exec vitest run src/api/codegen.test.ts >"$TMP/codegen.log" 2>&1); then
  bad 2 "web/src/api/generated/ is not rendered from the current spec (web/src/api/codegen.test.ts):"; tail -8 "$TMP/codegen.log" | sed 's/^/        /'
fi
run_tagged 2 functions "S160 AC 2"

# --- Check 3: every table carries it ------------------------------------------------------------------------
grep -qF 'clinchIndicator: null' packages/domain/src/standings-phase.ts ||
  bad 3 "the blank regular-season row (packages/domain/src/standings-phase.ts) does not carry clinchIndicator: null"
run_tagged 3 functions "S160 AC 3"

# --- Check 4: Status done, inside the fence -----------------------------------------------------------------
[ "$(story_snapshot_status S160)" = "done" ] || bad 4 "S160's snapshot does not record Status done"
story_own_changed_files S160 "$BASE" . >"$TMP/changed.txt"
grep -vE '^(packages/domain/|functions/src/|functions/vitest\.config\.ts$|openapi/|web/src/api/generated/|docs/v3/backlog/|docs/v3/audit/|changelog\.d/S160\.md$|scripts/verify-S160\.sh$)' "$TMP/changed.txt" >"$TMP/fence.txt"
[ -s "$TMP/fence.txt" ] && bad 4 "the story changes files outside its scope: $(tr '\n' ' ' <"$TMP/fence.txt")"
grep -E '^changelog\.d/' "$TMP/changed.txt" | grep -vE '^changelog\.d/S160\.md$' >"$TMP/cl.txt"
[ -s "$TMP/cl.txt" ] && bad 4 "the story changes another item's changelog fragment: $(tr '\n' ' ' <"$TMP/cl.txt")"
grep -E '^(scripts/|test/)' "$TMP/changed.txt" | grep -vE '^scripts/verify-S160\.sh$' >"$TMP/scripts.txt"
[ -s "$TMP/scripts.txt" ] && bad 4 "the story changes files under scripts/ or test/: $(tr '\n' ' ' <"$TMP/scripts.txt")"

# --- Ledger notes (the reuse check), printed so audit.sh captures them ---------------------------------------
cat <<'NOTES'
S160 notes (design reasoning, not checked by this grader beyond checks 1-3) —
Reuse check (ADR-025): MLB's letter was already modelled and parsed (StandingsRecordEntry.clinchIndicator,
  packages/mlb-api/src/standings.ts; its zod field in parse.ts), so nothing new is modelled upstream; the one
  mapper, mapStandingsTeam, gains the field beside clinched, so every table the service builds (the top-level
  table and each phase's, all through mapStandings) carries it with no new code path; the playoffs list
  (playoffsTable in packages/domain/src/standings-phase.ts) filters the regular season's mapped rows, so it
  keeps their letters; the blank row (blankRecord, same file) gains clinchIndicator: null beside clinched: false.
  The spec, generated client and api:breaking gate follow S140's champion path (pnpm api:spec, pnpm api:types,
  pnpm api:breaking), and the old-answer parse test reads the spec's schema from generateComponentSchemas, the
  generator the spec is built from.
NOTES

report "verify-S160"
exit $?
