#!/usr/bin/env bash
# Grader for story S161 — each live or final game the schedule serves carries its win-probability line
# (`scoreboardWinProbability`, built on `winProbabilitySeries`), worked out when the game's play metrics are written and
# stored on its `game_states` row, so a schedule read loads no game's plays; games stored before S161 get theirs from a
# separate, batched, idempotent and resumable fill step.
# A commit-time proof of this story (S84).
# Contract: frame note 00, "Verify-script contract" (docs/v3/backlog/frame/).
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`); runs only the story-scoped Vitest
# files named below, once each package, and reads each test's result by name.

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "AC 1: scoreboardWinProbability in packages/domain/src/win-probability.ts is built only on winProbabilitySeries and returns { points, current } or null; tests named 'S161 AC 1' pass (the 823823 final game, the same game cut to its first half as live, the game with its play metrics removed)"
check 2 "AC 2: the served schedule game gains winProbability additively: openapi/bt-api.v1.json and web/src/api/generated/bt-api.v1.ts carry it and are current (api:spec --check, api:types regenerated equal), api:breaking exits 0; a pregame game serves null whatever is stored (test named 'S161 AC 2' passes)"
check 3 "AC 3: the line is stored on game_states (a win_probability column), written by the game's feed write (storeGames passes scoreboardWinProbability) whichever source holds the row, never cleared by a schedule write, and a line change alone stamps a new row version; tests named 'S161 AC 3' pass (schedule write keeps the line, first ingested after its window, one new play metric raises the day's version and lastChangedAt, a schedule read reads no game snapshot, the route serves 823823's line); S216's round-trip bounds still pass"
check 4 "AC 4: the S161 migration only adds the column; a separate TypeScript fill step (run by migrateDatabaseAt or a functions/src/scripts/ script) fills rows still null whose game has play metrics, in batches; tests named 'S161 AC 4' pass on PGlite (fills a stored game, no play metrics stays null, a second run writes nothing and reads no checked row, a run stopped after its first batch resumes, recent filled games owe their edge purges as paths the cron sends under its origin, a failing fill never fails the migration)"
check 5 "AC 5: functions/src/services/schedule-fixture.test.ts still passes (fixtures regenerated in the same change if recordNormalized's output changed)"
check 6 "AC 6: S161 changed no file outside its fence (plus creating scripts/verify-S161.sh and its own records); its snapshot records Status done"

# The commit S161's own changes start from: `git merge-base origin/stage HEAD` when this grader was written.
BASE=f152a44de94144661095f21230e5fda41e4c132c

TMP="$(mktemp -d /tmp/verify-S161.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

# run_tests <package dir> <report> <test files…> — runs the files that exist, in one Vitest run.
run_tests() {
	local dir="$1" out="$2"
	shift 2
	local present=()
	for t in "$@"; do [ -f "$dir/$t" ] && present+=("$t"); done
	[ "${#present[@]}" -gt 0 ] || return 0
	(cd "$dir" && pnpm exec vitest run "${present[@]}" --reporter=json --outputFile="$out" >"$out.log" 2>&1)
}
# in_file <report> <file suffix> <regex> — a test whose full name matches ran in that file, and every such test passed.
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
# file_passed <report> <file suffix> — the file ran and every test in it passed.
file_passed() {
	[ -f "$1" ] || return 1
	node -e '
		const r = require(process.argv[1]);
		const f = r.testResults.find((x) => x.name.endsWith(process.argv[2]));
		process.exit(f && f.assertionResults.length > 0 && f.assertionResults.every((t) => t.status === "passed") ? 0 : 1);
	' "$1" "$2"
}
# body_of <file> <declaration text> — the declaration through its closing brace at column 0.
body_of() {
	awk -v pat="$2" 'index($0, pat) {on=1} on {print} on && /^}/ {exit}' "$1" 2>/dev/null
}

DOM="$TMP/domain.json"
FN="$TMP/functions.json"
run_tests packages/domain "$DOM" src/win-probability.test.ts src/game-state.test.ts
FILL_TEST=src/adapters/postgres/win-probability-fill.test.ts
LINE_TEST=src/services/win-probability-line.test.ts
RT=src/services/ingest.round-trips.test.ts
SF=src/services/schedule-fixture.test.ts
MIG_TEST=src/adapters/postgres/migrate.test.ts
EP_TEST=src/services/edge-purge.test.ts
run_tests functions "$FN" "$LINE_TEST" "$FILL_TEST" "$RT" "$SF" "$MIG_TEST" "$EP_TEST"

WP=packages/domain/src/win-probability.ts

# --- Check 1: the domain function ---
fn="$(body_of "$WP" 'export function scoreboardWinProbability(')"
if [ -z "$fn" ]; then
	bad 1 "no exported scoreboardWinProbability in $WP"
else
	grep -qF 'winProbabilitySeries(' <<<"$fn" || bad 1 "scoreboardWinProbability does not call winProbabilitySeries"
	grep -qE 'homeWinProbability|playMetrics' <<<"$fn" && bad 1 "scoreboardWinProbability reads play metrics itself instead of only through winProbabilitySeries"
fi
grep -qE 'points: number\[\];?' "$WP" && grep -qE 'current: number;?' "$WP" || bad 1 "$WP declares no { points: number[]; current: number } type for the scoreboard line"
for name in "S161 AC 1 final game" "S161 AC 1 live first half" "S161 AC 1 no play metrics"; do
	in_file "$DOM" src/win-probability.test.ts "$name" || bad 1 "test '$name' did not pass"
done

# --- Check 2: the served field, the spec and the client ---
SPEC=openapi/bt-api.v1.json
node -e '
	const s = require(process.argv[1]);
	const g = s.components.schemas.ScheduleGameSummary;
	process.exit(g && g.properties && g.properties.winProbability ? 0 : 1);
' "$PWD/$SPEC" 2>/dev/null || bad 2 "$SPEC: ScheduleGameSummary has no winProbability property"
grep -qE 'winProbability\??:' web/src/api/generated/bt-api.v1.ts || bad 2 "web/src/api/generated/bt-api.v1.ts has no winProbability"
(cd functions && pnpm exec tsx src/scripts/generate-openapi.ts --check >"$TMP/spec.log" 2>&1) || bad 2 "$SPEC is stale (api:spec --check): $(tail -1 "$TMP/spec.log")"
mkdir -p "$TMP/gen"
if (cd web && node src/api/codegen.ts "$TMP/gen" >"$TMP/gen.log" 2>&1); then
	cmp -s "$TMP/gen/bt-api.v1.ts" web/src/api/generated/bt-api.v1.ts || bad 2 "web/src/api/generated/bt-api.v1.ts is not what api:types makes of the spec"
else
	bad 2 "api:types failed: $(tail -1 "$TMP/gen.log")"
fi
(cd functions && pnpm exec tsx src/scripts/api-breaking.ts >"$TMP/breaking.log" 2>&1) || bad 2 "api:breaking exited nonzero: $(tail -3 "$TMP/breaking.log" | tr '\n' ' ')"
in_file "$DOM" src/game-state.test.ts "S161 AC 2 pregame" || bad 2 "test 'S161 AC 2 pregame' did not pass"

# --- Check 3: worked out at write time, stored on game_states ---
grep -A12 'pgTable("game_states"' functions/src/adapters/postgres/schema.ts 2>/dev/null | grep -q '"win_probability"' || bad 3 "game_states has no win_probability column"
grep -qE 'winProbability' packages/domain/src/game-state.ts || bad 3 "GameStateRow carries no winProbability"
grep -qF 'scoreboardWinProbability(' <<<"$(body_of functions/src/services/ingest.ts 'async function storeGames(')" || bad 3 "storeGames does not hand the switch scoreboardWinProbability of the fetched game"
for name in "S161 AC 3 schedule write keeps the line" "S161 AC 3 first ingested after its window" "S161 AC 3 line change raises the day version" "S161 AC 3 schedule read reads no game snapshot" "S161 AC 3 route serves the line"; do
	in_file "$FN" "$LINE_TEST" "$name" || bad 3 "test '$name' did not pass"
done
file_passed "$FN" "$RT" || bad 3 "S216's round-trip tests ($RT) did not all pass"

# --- Check 4: the migration and the fill ---
mig="$(story_own_changed_files S161 "$BASE" . | grep -E '^functions/src/adapters/postgres/migrations/[0-9]{4}_.*\.sql$' || true)"
if [ -z "$mig" ]; then
	bad 4 "S161 adds no migration"
else
	while IFS= read -r m; do
		grep -qiE 'ADD COLUMN "win_probability" jsonb' "$m" || bad 4 "$m does not add game_states.win_probability"
		grep -qiE '^\s*(UPDATE|INSERT|DELETE)\b' "$m" && bad 4 "$m writes rows; the fill must be a separate TypeScript step"
	done <<<"$mig"
fi
grep -qE 'fillWinProbability|WinProbabilityFill' functions/src/adapters/postgres/migrate.ts functions/src/scripts/*.ts 2>/dev/null || bad 4 "neither migrateDatabaseAt nor a functions/src/scripts/ script runs the fill"
for name in "S161 AC 4 fills a stored game" "S161 AC 4 no play metrics stays null" "S161 AC 4 second run writes nothing" "S161 AC 4 resumes after a stop" \
	"S161 AC 4 second run reads no checked row" "S161 AC 4 owes recent edge paths" "S161 AC 4 owe failure retried"; do
	in_file "$FN" "$FILL_TEST" "$name" || bad 4 "test '$name' did not pass"
done
# Pre-PR review round (rule 7): a filled past game's edge copy is owed its purge, sent under the origin by the cron,
# and a failing fill never fails the deploy's migration.
in_file "$FN" "$EP_TEST" "S161 AC 4 owed path" || bad 4 "test 'S161 AC 4 owed path' did not pass"
in_file "$FN" "$MIG_TEST" "S161 AC 4 fill failure" || bad 4 "test 'S161 AC 4 fill failure' did not pass"

# --- Check 5: the schedule fixtures ---
file_passed "$FN" "$SF" || bad 5 "$SF did not pass"

# --- Check 6: fence and status ---
fence='^(packages/domain/|packages/ports/|functions/src/|functions/vitest\.config\.ts$|openapi/|fixtures/|web/src/api/generated/|docs/v3/backlog/|docs/v3/audit/|changelog\.d/S161\.md$|scripts/verify-S161\.sh$)'
while IFS= read -r f; do
	[ -z "$f" ] && continue
	grep -qE "$fence" <<<"$f" || bad 6 "outside the fence: $f"
done < <(story_own_changed_files S161 "$BASE" .)
own_added="$(story_own_diff S161 "$BASE" --name-status --diff-filter=A -- scripts/verify-S161.sh)"
[ -n "$own_added" ] || [ -n "$(git ls-files --others --exclude-standard -- scripts/verify-S161.sh)" ] || bad 6 "scripts/verify-S161.sh was not created by S161"
[ "$(story_snapshot_status S161)" = "done" ] || bad 6 "S161's snapshot does not record Status done"

report "verify-S161"
exit $?
