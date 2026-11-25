#!/usr/bin/env bash
# Grader for story S100 — the strike zone and other rules a game was played under (MLB's live feed with
# hydrate=ruleSettings), recorded once for 823823, typed and parsed in packages/mlb-api, fetched by ingest through
# MlbStatsClient.fetchGameRuleSettings off the game fetch, projected onto GameSnapshot.ruleSettings additively,
# optional when the call fails or hangs, and kept across refreshes through the keep / bounded-ask helpers S99 wrote
# and S101 generalized, extended rather than copied. A commit-time proof of this story (S84).
# Contract: frame note 00, "Verify-script contract" (docs/v3/backlog/frame/).
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`); runs only the
# story-scoped Vitest files named below.

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "AC 1: fixtures/raw/rulesettings-823823.json is MLB's recorded live feed with hydrate=ruleSettings for 823823; the recorder and the HTTP adapter ask that URL; local dev bundles it; tests read it, never the network"
check 2 "AC 2: packages/mlb-api types the payload as named interfaces split by purpose and parses it with zod (test named 'S100 AC 2' on the recording); the coverage gate and pnpm mlb:scan-drift cover rulesettings-823823.json with no drift"
check 3 "AC 3: MlbStatsClient.fetchGameRuleSettings(gamePk: number), in the fixture and HTTP adapters (tests named 'S100 AC 3'); no web code fetches it"
check 4 "AC 4: a functions/src/mappers mapper projects GameSnapshot.ruleSettings, each setting by name with value and unit; on 823823 strikeZoneTopFactor 53.5% and strikeZoneBottomFactor 27% ('S100 AC 4'); spec and generated web types carry it; pnpm api:breaking exits 0"
check 5 "AC 5: optional (fails/empty -> absent, 'S100 AC 5'); a hung call leaves fetchGame answering within PLAY_METRICS_LIMIT_MS ('S100 AC 5 hung'); kept through storeGames with no new version ('S100 AC 5 keep'), through S101's keep, bounded ask and due decision extended, not copied; the backfill asks it as an extra source ('S100 AC 5 backfill')"
check 6 "AC 6: S100's Status is done: its snapshot fragment records done"
check 7 "S100 changed no file outside its fence (plus creating scripts/verify-S100.sh and its own records)"

# The commit S100's own changes start from: `git merge-base origin/stage HEAD` when this grader was written.
BASE=cbe14f9121127dbd41db6d4bd1bd5f09bed0b19f

TMP="$(mktemp -d /tmp/verify-S100.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT
FX="fixtures/raw/rulesettings-823823.json"
HTTP="functions/src/adapters/http/mlb.ts"
DOMAIN_KEEP="packages/domain/src/player-of-the-game.ts"
ASK="functions/src/services/player-of-the-game.ts"
MAPPER_TEST="src/mappers/rule-settings.test.ts"

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
	const s = ((d.gameData || {}).ruleSettings || []);
	const top = s.find((x) => x.settingName === "strikeZoneTopFactor");
	const bottom = s.find((x) => x.settingName === "strikeZoneBottomFactor");
	if (!top || top.settingValue !== 53.5) { console.log("strikeZoneTopFactor is not 53.5"); process.exit(1); }
	if (!bottom || bottom.settingValue !== 27) { console.log("strikeZoneBottomFactor is not 27"); process.exit(1); }
' "$FX" >"$TMP/fx.log" 2>&1 || bad 1 "$FX: $(cat "$TMP/fx.log" 2>/dev/null || echo missing)"
grep -qF 'feed/live?language=en&hydrate=ruleSettings&fields=gameData,ruleSettings' "$HTTP" 2>/dev/null || bad 1 "the HTTP adapter does not name the rule-settings URL"
grep -qE 'gameRuleSettingsUrl' functions/src/services/recorder.ts || bad 1 "the recorder does not record the rule-settings URL (gameRuleSettingsUrl)"
grep -qE 'rulesettings-' functions/src/services/recorder.ts || bad 1 "the recorder does not write raw/rulesettings-<gamePk>.json"
grep -qF 'raw/rulesettings-823823.json' functions/src/adapters/fixtures/bundled.ts || bad 1 "bundled.ts does not bundle raw/rulesettings-823823.json (pnpm dev reads only bundled fixtures)"
grep -qF 'rulesettings-823823.json' functions/src/test/recorded-mlb.ts || bad 1 "functions/src/test/recorded-mlb.ts does not answer the rule-settings URL from the recording"

# --- Check 2: AC 2: types and parser ---
P="packages/mlb-api/src/rule-settings.ts"
n="$(grep -cE '^export interface ' "$P" 2>/dev/null || echo 0)"
[ "$n" -ge 2 ] || bad 2 "$P declares $n named interfaces (want at least 2, split by purpose)"
grep -qE 'rule-settings\.js' packages/mlb-api/src/index.ts || bad 2 "packages/mlb-api/src/index.ts does not export the rule-settings types"
grep -qE 'export function parseGameRuleSettingsResponse' packages/mlb-api/src/parse.ts || bad 2 "parse.ts has no parseGameRuleSettingsResponse"
grep -qF '"rulesettings-823823.json"' packages/mlb-api/src/coverage.test.ts || bad 2 "the coverage gate does not list rulesettings-823823.json"
run_vitest 2 packages/mlb-api src/parse.test.ts "S100 AC 2"
run_vitest 2 packages/mlb-api src/coverage.test.ts "rulesettings-823823"
grep -qE 'rulesettings-' functions/src/services/scan-drift.ts || bad 2 "scan-drift has no parser for rulesettings-*.json"
if pnpm -s mlb:scan-drift >"$TMP/drift.log" 2>&1; then
	grep -q 'rulesettings-823823.json' "$TMP/drift.log" || bad 2 "pnpm mlb:scan-drift did not scan rulesettings-823823.json"
else
	bad 2 "pnpm mlb:scan-drift reports drift:"; tail -8 "$TMP/drift.log" | sed 's/^/        /'
fi

# --- Check 3: AC 3: the port and its adapters ---
grep -qE 'fetchGameRuleSettings\(gamePk: number\)' packages/ports/src/mlb.ts || bad 3 "MlbStatsClient has no fetchGameRuleSettings(gamePk: number)"
grep -qE 'async fetchGameRuleSettings\(' functions/src/adapters/fixtures/fixture-client.ts || bad 3 "the fixture client does not implement fetchGameRuleSettings"
grep -qE 'async fetchGameRuleSettings\(' "$HTTP" || bad 3 "the HTTP client does not implement fetchGameRuleSettings"
run_vitest 3 functions src/adapters/http/mlb.test.ts "S100 AC 3"
run_vitest 3 functions "$MAPPER_TEST" "S100 AC 3"
grep -rqiE 'hydrate=ruleSettings|fetchGameRuleSettings' web/src && bad 3 "web/src names the rule-settings URL or calls fetchGameRuleSettings"

# --- Check 4: AC 4: the projection ---
grep -qE 'ruleSettings\?:' packages/domain/src/types.ts || bad 4 "GameSnapshot has no optional ruleSettings"
[ -f functions/src/mappers/rule-settings.ts ] || bad 4 "functions/src/mappers/rule-settings.ts missing"
grep -qF '"ruleSettings"' openapi/bt-api.v1.json || bad 4 "the spec has no ruleSettings"
grep -qF 'ruleSettings?' web/src/api/generated/bt-api.v1.ts || bad 4 "the generated web types have no ruleSettings"
run_vitest 4 functions "$MAPPER_TEST" "S100 AC 4"
pnpm -s api:breaking >"$TMP/b.log" 2>&1 || { bad 4 "pnpm api:breaking fails:"; tail -8 "$TMP/b.log" | sed 's/^/        /'; }

# --- Check 5: AC 5: optional, bounded, kept through S101's helpers extended ---
run_vitest 5 functions "$MAPPER_TEST" "S100 AC 5"
run_vitest 5 functions src/adapters/http/mlb.test.ts "S100 AC 5 hung"
run_vitest 5 functions src/services/ingest.rule-settings.test.ts "S100 AC 5 keep"
run_vitest 5 functions src/services/backfill.test.ts "S100 AC 5 backfill"
# One keep (ADR-025): ruleSettings joins S101's KEPT_WHOLE list in keepStoredExtras, not a keep of its own.
grep -qE 'const KEPT_WHOLE = \[[^]]*"ruleSettings"' "$DOMAIN_KEEP" || bad 5 "ruleSettings is not in keepStoredExtras' KEPT_WHOLE list"
grep -qE 'export function keepRuleSettings' "$DOMAIN_KEEP" packages/domain/src/*.ts && bad 5 "a per-field keepRuleSettings copies the keep"
# One due decision naming the extra (the 2026-11-25 note): no second function with uniformsDue's body.
grep -qE 'export function (uniformsDue|ruleSettingsDue)\(' packages/domain/src/*.ts && bad 5 "a per-extra due function (uniformsDue / ruleSettingsDue) remains; the decision names the extra"
# One bounded ask (ADR-025).
grep -qE 'askWithinLimit\(.*fetchGameRuleSettings' "$ASK" || bad 5 "the rule-settings ask does not go through askWithinLimit"
# The backfill asks it as an extra source it can give up.
grep -qE 'EXTRA_SOURCES = \[[^]]*"ruleSettings"' functions/src/services/backfill.ts || bad 5 "ruleSettings is not one of the backfill's EXTRA_SOURCES"
# The ask stays off the game fetch (the 2026-11-25 note after S216): fetchGame's body never names it.
awk '/async fetchGame\(gamePk/,/^\t}/' "$HTTP" | grep -q 'fetchGameRuleSettings\|gameRuleSettingsUrl' && bad 5 "fetchGame asks the rule settings on the fetch path"

# --- Check 6: AC 6: Status done ---
[ "$(story_snapshot_status S100)" = "done" ] || bad 6 "S100's snapshot does not record Status done"

# --- Check 7: fence ---
fence='^(fixtures/|packages/mlb-api/src/|packages/ports/src/|packages/domain/src/|functions/src/|functions/vitest\.config\.ts$|openapi/|web/src/api/generated/|docs/v3/backlog/|docs/v3/AUDIT\.md$|CHANGELOG\.md$|docs/v3/audit/[^/]+/[^/]*-S100-[^/]*\.md$|changelog\.d/S100\.md$|scripts/verify-S100\.sh$)'
while IFS= read -r f; do
	[ -z "$f" ] && continue
	grep -qE "$fence" <<<"$f" || bad 7 "outside the fence: $f"
done < <(story_own_changed_files S100 "$BASE" .)
own_added="$(story_own_diff S100 "$BASE" --name-status --diff-filter=A -- scripts/verify-S100.sh)"
[ -n "$own_added" ] || [ -n "$(git ls-files --others --exclude-standard -- scripts/verify-S100.sh)" ] || bad 7 "scripts/verify-S100.sh was not created by S100"

report "verify-S100"
exit $?
