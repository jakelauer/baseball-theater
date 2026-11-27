#!/usr/bin/env bash
# Grader for backlog story S103 — BT ingests Baseball Savant's per-pitch game feed (gf?game_pk=), keeping only
# what MLB's own feeds lack, on its own cadence inside S48's ingest object. A commit-time proof of this story (S84).
# Contract: docs/v3/backlog/frame/00 (Verify-script contract).
# No network. Never deploys. No writes outside /tmp. Does its own checking (story-scoped Vitest
# files only, found by the tag each AC's tests carry: "S103 AC <n>").

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "fixtures/raw/savant-gf-823823.json is Savant's gf answer for 823823 (340 pitches, each with a play_id), committed; the fixture client serves it from disk; tests 'S103 AC 1'"
check 2 "packages/mlb-api types Savant's pitch rows as named interfaces and parses them with zod (packages/mlb-api/src/savant.ts), the coverage gate lists the recording, pnpm mlb:scan-drift scans it with no drift; tests 'S103 AC 2'"
check 3 "MlbStatsClient has fetchSavantGameFeed(gamePk), in the fixture and HTTP adapters, the HTTP one on Savant's own base URL (https://baseballsavant.mlb.com); no web code reaches Savant; tests 'S103 AC 3'"
check 4 "functions/src/mappers/savant.ts projects each pitch by playId into GameSnapshot.savant with exactly xba, isBarrel, x/y feet, homeRunBallparks, batSpeed, isSword, savantInZone, timesThroughOrder, isAbsChallenge, plateXPoly/plateZPoly, and copies no trajectory, zone, box-score or season field; savant is optional in the spec (fresh, pnpm api:breaking 0, generated client rendered); tests 'S103 AC 4' (52 xba, 150 batSpeed, 2 swords, ABS at atBatIndex 34, 39, 69, 82, 83)"
check 5 "Savant is pulled on its own cadence inside the ingest object, never in the live feed's fetch; fields merge by playId, newer by version, absent means not yet; first-seen times beside playEndTime; polling bounded (N seconds in config, once after the final); tests 'S103 AC 5'"
check 6 "the source is optional: a failing or empty Savant leaves savant absent and the game served as before; tests 'S103 AC 6'"
check 7 "docs/v3/SAVANT-DATA.md § Terms of use no longer says 'Not yet checked', and quotes the terms with at least one https:// link and a date read"
check 8 "S103's snapshot records Status done (story_snapshot_status), and the story stays inside its scope files (plus its own records and scripts/verify-S103.sh), touching nothing under scripts/ or test/ but its grader"

# The commit S103's own changes start from (origin/stage when the story started, 2026-11-27). The fence
# (check 8) reads only S103's own commits from here through story_own_changed_files (scripts/lib/checks.sh).
BASE=188452e5
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
RECORDING=fixtures/raw/savant-gf-823823.json
MAPPER=functions/src/mappers/savant.ts
PARSER=packages/mlb-api/src/savant.ts

# run_tagged <check> <package dir> <tag> — runs every test file under the package's src/ that names <tag>,
# filtered to the tests carrying it; fails when none exists or none passes.
run_tagged() {
  local id="$1" dir="$2" tag="$3" files
  files="$(cd "$dir" && grep -rlF --include="*.test.ts" --include="*.test.tsx" -- "$tag" src 2>/dev/null | grep -v '\.workerd\.test\.ts$')"
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

# --- Check 1: the recording, read from disk ------------------------------------------------------------------
if [ ! -f "$RECORDING" ]; then
  bad 1 "$RECORDING is missing"
else
  # Every pitch row anywhere in the answer carries Savant's play_id; 823823 has 340 (the Gap).
  node -e '
    const j = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const ids = new Set();
    const walk = (v) => {
      if (Array.isArray(v)) { v.forEach(walk); return; }
      if (v && typeof v === "object") { if (typeof v.play_id === "string") { ids.add(v.play_id); return; } Object.values(v).forEach(walk); }
    };
    walk(j);
    if (ids.size !== 340) { console.log("expected 340 pitches with a play_id, found " + ids.size); process.exit(1); }
  ' "$RECORDING" >"$TMP/rec.txt" 2>&1 || bad 1 "$RECORDING: $(cat "$TMP/rec.txt")"
  git ls-files --error-unmatch "$RECORDING" >/dev/null 2>&1 || bad 1 "$RECORDING is not committed"
fi
grep -rlF 'fetchSavantGameFeed' functions/src/adapters/fixtures >/dev/null 2>&1 || bad 1 "the fixture client (functions/src/adapters/fixtures/) has no fetchSavantGameFeed"
run_tagged 1 functions "S103 AC 1"

# --- Check 2: the parser and the drift scan ------------------------------------------------------------------
if [ ! -f "$PARSER" ]; then
  bad 2 "$PARSER is missing"
else
  grep -qE '^export interface Savant[A-Za-z]*Pitch' "$PARSER" || bad 2 "$PARSER exports no named Savant…Pitch interface"
  grep -qE 'from "zod"' "$PARSER" "packages/mlb-api/src/parse.ts" || bad 2 "no zod parser for the Savant feed"
fi
grep -qF '"savant-gf-823823.json"' packages/mlb-api/src/coverage.test.ts || bad 2 "packages/mlb-api/src/coverage.test.ts does not gate the Savant recording"
pnpm -s mlb:scan-drift >"$TMP/drift.txt" 2>&1 || { bad 2 "pnpm mlb:scan-drift found drift:"; tail -15 "$TMP/drift.txt" | sed 's/^/        /'; }
grep -qE '^ +savant-gf-823823\.json$' "$TMP/drift.txt" || bad 2 "pnpm mlb:scan-drift did not scan savant-gf-823823.json"
run_tagged 2 packages/mlb-api "S103 AC 2"

# --- Check 3: the port, two adapters, Savant's own base URL, no web fetch -------------------------------------
awk '/^export interface MlbStatsClient/{f=1} f{print} f&&/^}/{exit}' packages/ports/src/mlb.ts | grep -qE 'fetchSavantGameFeed\(gamePk: number\)' ||
  bad 3 "MlbStatsClient (packages/ports/src/mlb.ts) has no fetchSavantGameFeed(gamePk: number)"
grep -qF 'fetchSavantGameFeed' functions/src/adapters/http/mlb.ts || bad 3 "the HTTP client has no fetchSavantGameFeed"
grep -qE '"https://baseballsavant\.mlb\.com"' functions/src/adapters/http/mlb.ts || bad 3 "the HTTP client names no Savant base URL (\"https://baseballsavant.mlb.com\")"
grep -rnE --include='*.ts' --include='*.tsx' 'baseballsavant|fetchSavantGameFeed|/gf\?game_pk' web/src >"$TMP/web.txt" 2>/dev/null
[ -s "$TMP/web.txt" ] && bad 3 "web code reaches Savant: $(cut -d: -f1,2 "$TMP/web.txt" | tr '\n' ' ')"
run_tagged 3 functions "S103 AC 3"

# --- Check 4: only what MLB's feeds lack, additive -----------------------------------------------------------
if [ ! -f "$MAPPER" ]; then
  bad 4 "$MAPPER is missing"
else
  for f in xba isBarrel homeRunBallparks batSpeed isSword savantInZone timesThroughOrder isAbsChallenge plateXPoly plateZPoly playId; do
    grep -qw "$f" "$MAPPER" || bad 4 "$MAPPER does not set $f"
  done
  # Fields MLB's live feed, box score or season lines already carry: trajectory, spin, breaks, extension, plate
  # time, zone, counts and season stats. One source per value (ADR-025).
  grep -nwE 'vx0|vy0|vz0|ax|ay|az|x0|y0|z0|pfx_x|pfx_z|spin_rate|release_spin_rate|spin_axis|release_speed|start_speed|end_speed|release_extension|extension|plate_time|sz_top|sz_bot|zone|breakX|breakZ|induced_break_z|launch_speed|launch_angle|hit_distance|avg|obp|slg|ops|era|whip|boxscore|season' "$MAPPER" |
    grep -vE '^\s*[0-9]+:\s*(//|\*|/\*)' >"$TMP/copied.txt"
  [ -s "$TMP/copied.txt" ] && bad 4 "$MAPPER copies a field MLB's feeds already carry: $(cut -c1-120 "$TMP/copied.txt" | tr '\n' ' ')"
fi
awk '/^export type GameSnapshot = /{f=1} f{print} f&&/^};/{exit}' packages/domain/src/types.ts | grep -qE '^\s*savant\?:' ||
  bad 4 "GameSnapshot (packages/domain/src/types.ts) has no optional savant?"
node -e '
  const spec = require("./openapi/bt-api.v1.json");
  const s = spec.components?.schemas ?? {};
  const game = s.GameSnapshot ?? Object.values(s).find((x) => x?.properties?.plays && x?.properties?.gamePk);
  if (!game?.properties?.savant) { console.log("the game schema has no savant"); process.exit(1); }
  if ((game.required ?? []).includes("savant")) { console.log("savant is required, so a game from before S103 would not parse"); process.exit(1); }
' >"$TMP/spec-shape.txt" 2>&1 || bad 4 "openapi/bt-api.v1.json: $(cat "$TMP/spec-shape.txt")"
if ! (cd functions && pnpm exec tsx src/scripts/generate-openapi.ts --check >"$TMP/spec.log" 2>&1); then
  bad 4 "openapi/bt-api.v1.json is stale (pnpm api:spec):"; tail -5 "$TMP/spec.log" | sed 's/^/        /'
fi
pnpm -s api:breaking >"$TMP/brk.log" 2>&1 || { bad 4 "pnpm api:breaking failed:"; tail -8 "$TMP/brk.log" | sed 's/^/        /'; }
if ! (cd web && pnpm exec vitest run src/api/codegen.test.ts >"$TMP/codegen.log" 2>&1); then
  bad 4 "web/src/api/generated/ is not rendered from the current spec (web/src/api/codegen.test.ts):"; tail -8 "$TMP/codegen.log" | sed 's/^/        /'
fi
run_tagged 4 functions "S103 AC 4"

# --- Check 5: arrival time — own cadence, merge by version, first-seen log, bounded polling --------------------
# The live feed's fetch (the HTTP client's fetchGame) never asks Savant, so a slow Savant can't delay a pitch.
awk '/^[[:space:]]*async fetchGame\(/{f=1} f{print} f&&/^\t\}$/{exit}' functions/src/adapters/http/mlb.ts | grep -qiE 'savant' &&
  bad 5 "the HTTP client's fetchGame asks Savant in the live feed's call"
grep -qF 'fetchSavantGameFeed' functions/src/game-ingest-object.ts || bad 5 "the ingest object (functions/src/game-ingest-object.ts) never calls fetchSavantGameFeed"
run_tagged 5 functions "S103 AC 5"
run_tagged 5 packages/domain "S103 AC 5"

# --- Check 6: the source is optional --------------------------------------------------------------------------
run_tagged 6 functions "S103 AC 6"

# --- Check 7: the terms of use, checked and quoted ------------------------------------------------------------
awk '/^## Terms of use/{f=1; next} f&&/^## /{exit} f{print}' docs/v3/SAVANT-DATA.md >"$TMP/terms.txt"
if [ ! -s "$TMP/terms.txt" ]; then
  bad 7 "docs/v3/SAVANT-DATA.md has no § Terms of use"
else
  grep -qF 'Not yet checked' "$TMP/terms.txt" && bad 7 "§ Terms of use still says 'Not yet checked'"
  grep -qF 'https://' "$TMP/terms.txt" || bad 7 "§ Terms of use links no https:// page"
  grep -qE '20[0-9]{2}-[0-9]{2}-[0-9]{2}' "$TMP/terms.txt" || bad 7 "§ Terms of use gives no date read (YYYY-MM-DD)"
fi

# --- Check 8: Status done, inside the fence -------------------------------------------------------------------
[ "$(story_snapshot_status S103)" = "done" ] || bad 8 "S103's snapshot does not record Status done"
story_own_changed_files S103 "$BASE" . >"$TMP/changed.txt"
grep -vE '^(fixtures/|packages/mlb-api/src/|packages/ports/src/|packages/domain/src/|functions/src/|functions/vitest\.config\.ts$|openapi/|web/src/api/generated/|docs/v3/backlog/|docs/v3/SAVANT-DATA\.md$|docs/v3/AUDIT\.md$|CHANGELOG\.md$|docs/v3/audit/[^/]+/[^/]+-S103-[a-z-]+\.md$|changelog\.d/S103\.md$|scripts/verify-S103\.sh$)' "$TMP/changed.txt" >"$TMP/fence.txt"
[ -s "$TMP/fence.txt" ] && bad 8 "the story changes files outside its scope: $(tr '\n' ' ' <"$TMP/fence.txt")"
grep -E '^(scripts/|test/)' "$TMP/changed.txt" | grep -vE '^scripts/verify-S103\.sh$' >"$TMP/scripts.txt"
[ -s "$TMP/scripts.txt" ] && bad 8 "the story changes files under scripts/ or test/: $(tr '\n' ' ' <"$TMP/scripts.txt")"

report "verify-S103"
exit $?
