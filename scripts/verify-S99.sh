#!/usr/bin/env bash
# Grader for story S99 — MLB's player of the game (the media pick and the fan pick, each a
# player, his team, his line and the win probability he added), recorded once for 823823,
# typed and parsed in packages/mlb-api, fetched by ingest through
# MlbStatsClient.fetchPlayerOfTheGame and projected onto GameSnapshot.playerOfTheGame
# additively; optional when the feed fails. A commit-time proof of this story (S84).
# Contract: frame note 00, "Verify-script contract" (docs/v3/backlog/frame/).
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`); runs only the
# story-scoped Vitest files named below.

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "AC 1: fixtures/raw/potg-823823.json is MLB's recorded player-of-the-game answer for 823823 (www.mlb.com/apps/player-of-the-game/game/json/winners/{gamePk}.json); the recorder and the HTTP adapter ask that URL; local dev bundles it; tests read it, never the network"
check 2 "AC 2: packages/mlb-api types the payload as named interfaces split by purpose and parses it with zod (test named 'S99 AC 2' on the recording); the coverage gate and pnpm mlb:scan-drift cover potg-823823.json with no drift"
check 3 "AC 3: MlbStatsClient.fetchPlayerOfTheGame(gamePk: number), in the fixture and HTTP adapters (tests named 'S99 AC 3'); no web code fetches the feed"
check 4 "AC 4: a functions/src/mappers mapper projects GameSnapshot.playerOfTheGame: on 823823 the media pick is 666171 (Ryan Zeferjahn), team 112, '1.2 IP, 0 ER, K, BB', 40.7, and the fan pick is absent (tests named 'S99 AC 4'); spec and generated web types carry it; pnpm api:breaking exits 0"
check 5 "AC 5: the source is optional: when the call fails or returns nothing the field is absent and the game is served as before; when it hangs, fetchGame still answers within PLAY_METRICS_LIMIT_MS with the field absent (tests named 'S99 AC 5', the hang 'S99 AC 5 hung')"
check 6 "AC 6: S99's Status is done: its snapshot fragment records done"
check 7 "S99 changed no file outside its fence (plus creating scripts/verify-S99.sh and its own records)"

# The commit S99's own changes start from: `git merge-base origin/stage HEAD` when this grader was last updated
# (2026-11-25, the branch rebased onto stage 7099883e for the amended text).
BASE=7099883ec193c367f10cac459244fe2bc6c3d4e0

TMP="$(mktemp -d /tmp/verify-S99.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT
FX="fixtures/raw/potg-823823.json"
HTTP="functions/src/adapters/http/mlb.ts"

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
	if (d.gamePK !== "823823") { console.log("gamePK is not 823823"); process.exit(1); }
	if (!d.mediaWinner || d.mediaWinner.feedId !== "666171" || d.mediaWinner.WPA !== 40.7) { console.log("mediaWinner is not the recorded Zeferjahn pick"); process.exit(1); }
	if (!d.fanWinner || d.fanWinner.feedId !== null) { console.log("fanWinner is not the recorded empty pick"); process.exit(1); }
' "$FX" >"$TMP/fx.log" 2>&1 || bad 1 "$FX: $(cat "$TMP/fx.log" 2>/dev/null || echo missing)"
grep -qF 'www.mlb.com/apps/player-of-the-game/game/json/winners/' "$HTTP" 2>/dev/null || bad 1 "the HTTP adapter does not name the player-of-the-game feed"
grep -qE 'playerOfTheGameUrl' functions/src/services/recorder.ts || bad 1 "the recorder does not record the feed's URL (playerOfTheGameUrl)"
grep -qE 'potg-' functions/src/services/recorder.ts || bad 1 "the recorder does not write raw/potg-<gamePk>.json"
grep -qF 'raw/potg-823823.json' functions/src/adapters/fixtures/bundled.ts || bad 1 "bundled.ts does not bundle raw/potg-823823.json (pnpm dev reads only bundled fixtures)"
grep -qF 'potg-823823.json' functions/src/test/recorded-mlb.ts || bad 1 "functions/src/test/recorded-mlb.ts does not answer the feed's URL from the recording"

# --- Check 2: AC 2: types and parser ---
P="packages/mlb-api/src/player-of-the-game.ts"
n="$(grep -cE '^export interface ' "$P" 2>/dev/null || echo 0)"
[ "$n" -ge 2 ] || bad 2 "$P declares $n named interfaces (want at least 2, split by purpose)"
grep -qE 'player-of-the-game\.js' packages/mlb-api/src/index.ts || bad 2 "packages/mlb-api/src/index.ts does not export the player-of-the-game types"
grep -qE 'export function parsePlayerOfTheGameResponse' packages/mlb-api/src/parse.ts || bad 2 "parse.ts has no parsePlayerOfTheGameResponse"
grep -qF '"potg-823823.json"' packages/mlb-api/src/coverage.test.ts || bad 2 "the coverage gate does not list potg-823823.json"
run_vitest 2 packages/mlb-api src/parse.test.ts "S99 AC 2"
run_vitest 2 packages/mlb-api src/coverage.test.ts "potg-823823"
grep -qE 'potg-' functions/src/services/scan-drift.ts || bad 2 "scan-drift has no parser for potg-*.json"
if pnpm -s mlb:scan-drift >"$TMP/drift.log" 2>&1; then
	grep -q 'potg-823823.json' "$TMP/drift.log" || bad 2 "pnpm mlb:scan-drift did not scan potg-823823.json"
else
	bad 2 "pnpm mlb:scan-drift reports drift:"; tail -8 "$TMP/drift.log" | sed 's/^/        /'
fi

# --- Check 3: AC 3: the port and its adapters ---
grep -qE 'fetchPlayerOfTheGame\(gamePk: number\)' packages/ports/src/mlb.ts || bad 3 "MlbStatsClient has no fetchPlayerOfTheGame(gamePk: number)"
grep -qE 'async fetchPlayerOfTheGame\(' functions/src/adapters/fixtures/fixture-client.ts || bad 3 "the fixture client does not implement fetchPlayerOfTheGame"
grep -qE 'async fetchPlayerOfTheGame\(' "$HTTP" || bad 3 "the HTTP client does not implement fetchPlayerOfTheGame"
run_vitest 3 functions src/adapters/http/mlb.test.ts "S99 AC 3"
run_vitest 3 functions src/mappers/player-of-the-game.test.ts "S99 AC 3"
grep -rqiE 'player-of-the-game/game|fetchPlayerOfTheGame' web/src && bad 3 "web/src names the player-of-the-game feed or calls fetchPlayerOfTheGame"

# --- Check 4: AC 4: the projection ---
grep -qE 'playerOfTheGame\?:' packages/domain/src/types.ts || bad 4 "GameSnapshot has no optional playerOfTheGame"
[ -f functions/src/mappers/player-of-the-game.ts ] || bad 4 "functions/src/mappers/player-of-the-game.ts missing"
grep -qF '"playerOfTheGame"' openapi/bt-api.v1.json || bad 4 "the spec has no playerOfTheGame"
grep -qF 'playerOfTheGame?' web/src/api/generated/bt-api.v1.ts || bad 4 "the generated web types have no playerOfTheGame"
run_vitest 4 functions src/mappers/player-of-the-game.test.ts "S99 AC 4"
pnpm -s api:breaking >"$TMP/b.log" 2>&1 || { bad 4 "pnpm api:breaking fails:"; tail -8 "$TMP/b.log" | sed 's/^/        /'; }

# --- Check 5: AC 5: optional ---
run_vitest 5 functions src/mappers/player-of-the-game.test.ts "S99 AC 5"
run_vitest 5 functions src/adapters/http/mlb.test.ts "S99 AC 5"
# The 2026-11-25 amendment (after S216): a request that never resolves leaves fetchGame answering within the limit.
run_vitest 5 functions src/adapters/http/mlb.test.ts "S99 AC 5 hung"
grep -qE 'PLAY_METRICS_LIMIT_MS' functions/src/adapters/http/mlb.test.ts || bad 5 "the hung-call test does not measure against PLAY_METRICS_LIMIT_MS"

# --- Check 6: AC 6: Status done ---
[ "$(story_snapshot_status S99)" = "done" ] || bad 6 "S99's snapshot does not record Status done"

# --- Check 7: fence ---
fence='^(fixtures/|packages/mlb-api/src/|packages/ports/src/|packages/domain/src/|functions/src/|functions/vitest\.config\.ts$|openapi/|web/src/api/generated/|docs/v3/backlog/|docs/v3/AUDIT\.md$|CHANGELOG\.md$|docs/v3/audit/[^/]+/[^/]*-S99-[^/]*\.md$|changelog\.d/S99\.md$|scripts/verify-S99\.sh$)'
while IFS= read -r f; do
	[ -z "$f" ] && continue
	grep -qE "$fence" <<<"$f" || bad 7 "outside the fence: $f"
done < <(story_own_changed_files S99 "$BASE" .)
own_added="$(story_own_diff S99 "$BASE" --name-status --diff-filter=A -- scripts/verify-S99.sh)"
[ -n "$own_added" ] || [ -n "$(git ls-files --others --exclude-standard -- scripts/verify-S99.sh)" ] || bad 7 "scripts/verify-S99.sh was not created by S99"

report "verify-S99"
exit $?
