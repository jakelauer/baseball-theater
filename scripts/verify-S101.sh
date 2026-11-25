#!/usr/bin/env bash
# Grader for story S101 — the uniforms each team wore in a game (MLB's /api/v1/uniforms/game), recorded
# once for 823823, typed and parsed in packages/mlb-api, fetched by ingest through
# MlbStatsClient.fetchGameUniforms off the game fetch, projected onto GameSnapshot.uniforms additively,
# optional when the call fails or hangs, and kept across refreshes through the keep / bounded-ask
# helper S99 wrote, generalized. A commit-time proof of this story (S84).
# Contract: frame note 00, "Verify-script contract" (docs/v3/backlog/frame/).
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`); runs only the
# story-scoped Vitest files named below.

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "AC 1: fixtures/raw/uniforms-823823.json is MLB's recorded uniforms answer for 823823 (/api/v1/uniforms/game?gamePks=); the recorder and the HTTP adapter ask that URL; local dev bundles it; tests read it, never the network"
check 2 "AC 2: packages/mlb-api types the payload as named interfaces split by purpose and parses it with zod (test named 'S101 AC 2' on the recording); the coverage gate and pnpm mlb:scan-drift cover uniforms-823823.json with no drift"
check 3 "AC 3: MlbStatsClient.fetchGameUniforms(gamePk: number), in the fixture and HTTP adapters (tests named 'S101 AC 3'); no web code fetches the feed"
check 4 "AC 4: a functions/src/mappers mapper projects GameSnapshot.uniforms per side (code, text, type); on 823823 the home side includes 'Marlins Home White Jersey' (tests named 'S101 AC 4'); spec and generated web types carry it; pnpm api:breaking exits 0"
check 5 "AC 5: optional (fails/empty -> absent, 'S101 AC 5'); a hung call leaves fetchGame answering within PLAY_METRICS_LIMIT_MS ('S101 AC 5 hung'); kept through storeGames with no new version ('S101 AC 5 keep'), through S99's keep and bounded-ask helpers generalized, not copied"
check 6 "AC 6: S101's Status is done: its snapshot fragment records done"
check 7 "S101 changed no file outside its fence (plus creating scripts/verify-S101.sh and its own records)"

# The commit S101's own changes start from: `git merge-base origin/stage HEAD` when this grader was written.
BASE=93852082aa6fa3c35f72a7cd1efd7d5272904ad0

TMP="$(mktemp -d /tmp/verify-S101.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT
FX="fixtures/raw/uniforms-823823.json"
HTTP="functions/src/adapters/http/mlb.ts"
DOMAIN_KEEP="packages/domain/src/player-of-the-game.ts"
ASK="functions/src/services/player-of-the-game.ts"

# run_vitest <check> <package dir> <file> <name pattern>: the file's tests matching the pattern pass, at least one.
run_vitest() {
	local id="$1" dir="$2" file="$3" pattern="$4"
	if [ ! -f "$dir/$file" ]; then
		bad "$id" "$dir/$file missing"
	elif ! (cd "$dir" && pnpm exec vitest run "$file" -t "$pattern" --reporter=json --outputFile="$TMP/r.json" >"$TMP/r.log" 2>&1); then
		bad "$id" "$dir/$file -t '$pattern' failed:"; tail -15 "$TMP/r.log" | sed 's/^/        /'
	elif ! node -e 'process.exit(require(process.argv[1]).numPassedTests > 0 ? 0 : 1)' "$TMP/r.json"; then
		bad "$id" "$dir/$file -t '$pattern' ran no passing test"
	fi
}

# --- Check 1: AC 1: the recording ---
node -e '
	const d = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
	const u = (d.uniforms || [])[0];
	if (!u || u.gamePk !== 823823) { console.log("uniforms[0].gamePk is not 823823"); process.exit(1); }
	const home = ((u.home || {}).uniformAssets || []).map((a) => a.uniformAssetText);
	if (!home.includes("Marlins Home White Jersey")) { console.log("home side lacks Marlins Home White Jersey"); process.exit(1); }
' "$FX" >"$TMP/fx.log" 2>&1 || bad 1 "$FX: $(cat "$TMP/fx.log" 2>/dev/null || echo missing)"
grep -qF '/api/v1/uniforms/game?gamePks=' "$HTTP" 2>/dev/null || bad 1 "the HTTP adapter does not name the uniforms URL"
grep -qE 'gameUniformsUrl' functions/src/services/recorder.ts || bad 1 "the recorder does not record the uniforms URL (gameUniformsUrl)"
grep -qE 'uniforms-' functions/src/services/recorder.ts || bad 1 "the recorder does not write raw/uniforms-<gamePk>.json"
grep -qF 'raw/uniforms-823823.json' functions/src/adapters/fixtures/bundled.ts || bad 1 "bundled.ts does not bundle raw/uniforms-823823.json (pnpm dev reads only bundled fixtures)"
grep -qF 'uniforms-823823.json' functions/src/test/recorded-mlb.ts || bad 1 "functions/src/test/recorded-mlb.ts does not answer the uniforms URL from the recording"

# --- Check 2: AC 2: types and parser ---
P="packages/mlb-api/src/uniforms.ts"
n="$(grep -cE '^export interface ' "$P" 2>/dev/null || echo 0)"
[ "$n" -ge 2 ] || bad 2 "$P declares $n named interfaces (want at least 2, split by purpose)"
grep -qE 'uniforms\.js' packages/mlb-api/src/index.ts || bad 2 "packages/mlb-api/src/index.ts does not export the uniforms types"
grep -qE 'export function parseGameUniformsResponse' packages/mlb-api/src/parse.ts || bad 2 "parse.ts has no parseGameUniformsResponse"
grep -qF '"uniforms-823823.json"' packages/mlb-api/src/coverage.test.ts || bad 2 "the coverage gate does not list uniforms-823823.json"
run_vitest 2 packages/mlb-api src/parse.test.ts "S101 AC 2"
run_vitest 2 packages/mlb-api src/coverage.test.ts "uniforms-823823"
grep -qE 'uniforms-' functions/src/services/scan-drift.ts || bad 2 "scan-drift has no parser for uniforms-*.json"
if pnpm -s mlb:scan-drift >"$TMP/drift.log" 2>&1; then
	grep -q 'uniforms-823823.json' "$TMP/drift.log" || bad 2 "pnpm mlb:scan-drift did not scan uniforms-823823.json"
else
	bad 2 "pnpm mlb:scan-drift reports drift:"; tail -8 "$TMP/drift.log" | sed 's/^/        /'
fi

# --- Check 3: AC 3: the port and its adapters ---
grep -qE 'fetchGameUniforms\(gamePk: number\)' packages/ports/src/mlb.ts || bad 3 "MlbStatsClient has no fetchGameUniforms(gamePk: number)"
grep -qE 'async fetchGameUniforms\(' functions/src/adapters/fixtures/fixture-client.ts || bad 3 "the fixture client does not implement fetchGameUniforms"
grep -qE 'async fetchGameUniforms\(' "$HTTP" || bad 3 "the HTTP client does not implement fetchGameUniforms"
run_vitest 3 functions src/adapters/http/mlb.test.ts "S101 AC 3"
run_vitest 3 functions src/mappers/uniforms.test.ts "S101 AC 3"
grep -rqiE 'uniforms/game|fetchGameUniforms' web/src && bad 3 "web/src names the uniforms URL or calls fetchGameUniforms"

# --- Check 4: AC 4: the projection ---
grep -qE 'uniforms\?:' packages/domain/src/types.ts || bad 4 "GameSnapshot has no optional uniforms"
[ -f functions/src/mappers/uniforms.ts ] || bad 4 "functions/src/mappers/uniforms.ts missing"
grep -qF '"uniforms"' openapi/bt-api.v1.json || bad 4 "the spec has no uniforms"
grep -qF 'uniforms?' web/src/api/generated/bt-api.v1.ts || bad 4 "the generated web types have no uniforms"
run_vitest 4 functions src/mappers/uniforms.test.ts "S101 AC 4"
pnpm -s api:breaking >"$TMP/b.log" 2>&1 || { bad 4 "pnpm api:breaking fails:"; tail -8 "$TMP/b.log" | sed 's/^/        /'; }

# --- Check 5: AC 5: optional, bounded, kept through S99's helpers generalized ---
run_vitest 5 functions src/mappers/uniforms.test.ts "S101 AC 5"
run_vitest 5 functions src/adapters/http/mlb.test.ts "S101 AC 5 hung"
grep -qE 'PLAY_METRICS_LIMIT_MS' functions/src/adapters/http/mlb.test.ts || bad 5 "the hung-call test does not measure against PLAY_METRICS_LIMIT_MS"
run_vitest 5 functions src/services/ingest.uniforms.test.ts "S101 AC 5 keep"
# One keep helper for every stored extra (ADR-025): the game writes call it, never keepPlayerOfTheGame alone.
grep -qE 'export function keepStoredExtras' "$DOMAIN_KEEP" || bad 5 "$DOMAIN_KEEP has no shared keepStoredExtras"
grep -qE 'uniforms' "$DOMAIN_KEEP" || bad 5 "keepStoredExtras does not keep uniforms"
[ "$(grep -cE 'keepStoredExtras\(' functions/src/services/ingest.ts)" -ge 2 ] || bad 5 "storeGames and the late playMetrics write do not both call keepStoredExtras"
grep -qE 'keepPlayerOfTheGame\(' functions/src/services/ingest.ts && bad 5 "ingest.ts still calls keepPlayerOfTheGame directly (a per-field copy of the keep)"
# One bounded ask (ADR-025): the player of the game and the uniforms both go through it.
grep -qE 'export (async )?function askWithinLimit' "$ASK" || bad 5 "$ASK has no shared askWithinLimit"
grep -qE 'askWithinLimit\(.*fetchPlayerOfTheGame' "$ASK" || bad 5 "askPlayerOfTheGame does not go through askWithinLimit"
grep -qE 'askWithinLimit\(.*fetchGameUniforms' "$ASK" || bad 5 "the uniforms ask does not go through askWithinLimit"
# The ask stays off the game fetch (the 2026-11-25 note after S216): fetchGame's body never names it.
awk '/async fetchGame\(gamePk/,/^\t}/' "$HTTP" | grep -q 'fetchGameUniforms\|gameUniformsUrl' && bad 5 "fetchGame asks the uniforms on the fetch path"

# --- Check 6: AC 6: Status done ---
[ "$(story_snapshot_status S101)" = "done" ] || bad 6 "S101's snapshot does not record Status done"

# --- Check 7: fence ---
fence='^(fixtures/|packages/mlb-api/src/|packages/ports/src/|packages/domain/src/|functions/src/|functions/vitest\.config\.ts$|openapi/|web/src/api/generated/|docs/v3/backlog/|docs/v3/AUDIT\.md$|CHANGELOG\.md$|docs/v3/audit/[^/]+/[^/]*-S101-[^/]*\.md$|changelog\.d/S101\.md$|scripts/verify-S101\.sh$)'
while IFS= read -r f; do
	[ -z "$f" ] && continue
	grep -qE "$fence" <<<"$f" || bad 7 "outside the fence: $f"
done < <(story_own_changed_files S101 "$BASE" .)
own_added="$(story_own_diff S101 "$BASE" --name-status --diff-filter=A -- scripts/verify-S101.sh)"
[ -n "$own_added" ] || [ -n "$(git ls-files --others --exclude-standard -- scripts/verify-S101.sh)" ] || bad 7 "scripts/verify-S101.sh was not created by S101"

report "verify-S101"
exit $?
