#!/usr/bin/env bash
# Grader for story S207 — the Box room shows each team's pitching table and MLB's box score details (the
# BATTING / BASERUNNING / FIELDING groups and the lettered notes), from the game feed BT already stores, laid
# out as the live baseball.theater (v2) box score is, in v3's look, with both teams still side by side; the
# differences from v2 are listed, game by game, in docs/v3/design-checks/S207/v2-differences.md and each is
# proved by a test on a recorded game. A commit-time proof of this story (S84).
# Contract: frame note 00, "Verify-script contract" (docs/v3/backlog/frame/).
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`); runs only the
# story-scoped Vitest files named below.

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "AC 1: the pitching table (IP H R ER BB K HR ERA) from MLB's pitchers, through projectGameBoxscore / BoxscorePitchingRow extended and mapBoxscore keeping the feed's fields; Javier Assad 4.2 IP 3 H 3 R 3 ER 5 BB 3 K 0 HR 3.58 ('S207 AC 1' projection, mapper and RTL tests); optional GameBoxscore fields; spec and generated types regenerated, baseline untouched, pnpm api:breaking 0; 823823's fixtures regenerated; no migration"
check 2 "AC 2: each team's detail groups as MLB groups them (title and every line), the lettered notes, a group MLB doesn't send not drawn, every Game info line MLB sends; a game stored without them renders its batting table and Game info with no empty sections ('S207 AC 2' RTL tests)"
check 3 "AC 3: docs/v3/design-checks/S207/v2-differences.md lists at least five compared games, each recorded into fixtures/ and bundled in bundled.ts; every difference row names a test file that exists and a test in it (the one B586 heading row excepted); the box room keeps both teams side by side"
check 4 "AC 4: the batting and pitching tables render through one stat table component under web/src/components/game/; no stat is computed in the web components (derived values live in packages/domain)"
check 5 "AC 5: Hide Scores leaves the Box room's existing parts as A3 draws them and masks the new runs-bearing values (pitching R, ER, ERA; RBI, 2-out RBI, Team RISP, Inherited runners-scored) through HiddenValue ('S207 AC 5' RTL test)"
check 6 "AC 6: no design match: no captures for S207 under docs/v3/design-checks/ or e2e/design/"
check 7 "AC 7: S207's Status is done: its snapshot fragment records done"
check 8 "S207 changed no file outside its fence (plus creating scripts/verify-S207.sh and its own records)"

# The commit S207's own changes start from: `git merge-base origin/stage HEAD` when this grader was written.
BASE=f0a6b3e2902fca30e9b98ae19a8c701ad93a862d

TMP="$(mktemp -d /tmp/verify-S207.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT
BOX="web/src/components/game/BoxRoom.tsx"
BOX_TEST="src/components/game/BoxRoom.test.tsx"
DIFFS="docs/v3/design-checks/S207/v2-differences.md"

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

story_own_changed_files S207 "$BASE" . >"$TMP/changed" 2>/dev/null || true

# --- Check 1: AC 1: the pitching table ---
grep -qE 'pitching\?: BoxscorePitcher\[\]' packages/domain/src/types.ts || bad 1 "GameBoxscore's teams carry no optional pitching: BoxscorePitcher[]"
grep -qE '^export type BoxscorePitcher = ' packages/domain/src/types.ts || bad 1 "packages/domain/src/types.ts has no BoxscorePitcher"
grep -qE 'BoxscorePitchingRow = ' packages/domain/src/store.ts && grep -qE 'inningsPitched' packages/domain/src/store.ts \
	|| bad 1 "BoxscorePitchingRow (store.ts) is not extended with the pitching line"
grep -qE 'projectGameBoxscore' packages/domain/src/projections.ts || bad 1 "projectGameBoxscore is gone"
grep -qE 'export function (projectBoxscorePitching|projectGameBoxscorePitching)' packages/domain/src/*.ts && bad 1 "a second pitching projection exists beside projectGameBoxscore"
grep -qE 'pitchers' functions/src/mappers/live.ts || bad 1 "mapBoxscore does not read MLB's pitchers"
run_vitest 1 packages/domain src/projections.test.ts "S207 AC 1"
run_vitest 1 functions src/mappers/live.test.ts "S207 AC 1"
run_vitest 1 web "$BOX_TEST" "S207 AC 1"
run_vitest 1 functions src/services/fixture-823823.test.ts "regenerates game-823823.json"
run_vitest 1 functions src/services/openapi.test.ts ""
run_vitest 1 web src/api/codegen.test.ts ""
grep -qF '"BoxscorePitcher"' openapi/bt-api.v1.json || bad 1 "openapi/bt-api.v1.json has no BoxscorePitcher schema"
grep -qF 'inningsPitched' web/src/api/generated/bt-api.v1.ts || bad 1 "the generated web types have no inningsPitched"
grep -qxF 'openapi/bt-api.v1.baseline.json' "$TMP/changed" && bad 1 "the frozen baseline openapi/bt-api.v1.baseline.json was changed"
grep -E 'migrations?/' "$TMP/changed" | grep -q . && bad 1 "S207 adds or changes a migration: $(grep -E 'migrations?/' "$TMP/changed" | head -1)"
pnpm -s api:breaking >"$TMP/b.log" 2>&1 || { bad 1 "pnpm api:breaking fails:"; tail -8 "$TMP/b.log" | sed 's/^/        /'; }

# --- Check 2: AC 2: the details ---
grep -qE 'details\?: BoxscoreInfoGroup\[\]' packages/domain/src/types.ts || bad 2 "GameBoxscore's teams carry no optional details: BoxscoreInfoGroup[]"
grep -qE 'notes\?: BoxscoreInfoLine\[\]' packages/domain/src/types.ts || bad 2 "GameBoxscore's teams carry no optional notes: BoxscoreInfoLine[]"
run_vitest 2 functions src/mappers/live.test.ts "S207 AC 2"
run_vitest 2 web "$BOX_TEST" "S207 AC 2"

# --- Check 3: AC 3: the comparison with the live site ---
if [ ! -f "$DIFFS" ]; then
	bad 3 "$DIFFS missing"
else
	# The games compared: the `## Games compared` section's bullets, each naming its gamePk in backticks.
	awk '/^## Games compared/{on=1; next} /^## /{on=0} on' "$DIFFS" | grep -oE '^- `[0-9]{5,7}`' | grep -oE '[0-9]+' | sort -u >"$TMP/games"
	[ "$(wc -l <"$TMP/games")" -ge 5 ] || bad 3 "$DIFFS lists $(wc -l <"$TMP/games") games compared (want at least 5)"
	while IFS= read -r pk; do
		[ -f "fixtures/game-$pk.json" ] || bad 3 "game $pk is not recorded (fixtures/game-$pk.json missing)"
		[ -f "fixtures/plays-$pk.json" ] || bad 3 "game $pk's plays are not recorded (fixtures/plays-$pk.json missing)"
		grep -qF "\"game-$pk.json\"" functions/src/adapters/fixtures/bundled.ts || bad 3 "bundled.ts does not bundle game-$pk.json"
		grep -qF "\"plays-$pk.json\"" functions/src/adapters/fixtures/bundled.ts || bad 3 "bundled.ts does not bundle plays-$pk.json"
	done <"$TMP/games"
	# The difference rows: table rows whose first cell is a number.
	grep -E '^\| *[0-9]+ *\|' "$DIFFS" >"$TMP/rows" || true
	[ "$(wc -l <"$TMP/rows")" -ge 5 ] || bad 3 "$DIFFS lists $(wc -l <"$TMP/rows") differences (want a row per difference, at least 5)"
	b586=0
	while IFS= read -r row; do
		n="$(sed -E 's/^\| *([0-9]+).*/\1/' <<<"$row")"
		if grep -qF 'done by B586' <<<"$row"; then b586=$((b586 + 1)); continue; fi
		# Each row names at least one game compared.
		grep -oE '`[0-9]{5,7}`' <<<"$row" | grep -oE '[0-9]+' | grep -qxFf "$TMP/games" || bad 3 "row $n names no game from the Games compared list"
		file="$(grep -oE '`[a-z][A-Za-z0-9/._-]*\.test\.tsx?`' <<<"$row" | head -1 | tr -d '`')"
		test_name="$(grep -oE '"S207 AC [^"]*"' <<<"$row" | head -1 | tr -d '"')"
		if [ -z "$file" ]; then bad 3 "row $n names no test file"; continue; fi
		[ -f "$file" ] || { bad 3 "row $n's test file $file does not exist"; continue; }
		[ -n "$test_name" ] || { bad 3 "row $n names no test (\"S207 AC …\")"; continue; }
		grep -qF "$test_name" "$file" || bad 3 "row $n's test \"$test_name\" is not in $file"
	done <"$TMP/rows"
	[ "$b586" -le 1 ] || bad 3 "$b586 rows are marked done by B586 (the grader accepts one)"
fi
run_vitest 3 web "$BOX_TEST" "S207 AC 3"
run_vitest 3 functions src/adapters/fixtures/bundled.test.ts "bundles exactly"
grep -qE 'SimpleGrid cols=\{2\}' "$BOX" || bad 3 "the Box room no longer lays both teams side by side"

# --- Check 4: AC 4: one table component ---
tables="$(grep -lE '^export function [A-Z][A-Za-z]*Table[<(]' web/src/components/game/*.tsx 2>/dev/null | grep -v '\.test\.' || true)"
if [ "$(wc -w <<<"$tables")" -ne 1 ]; then
	bad 4 "want exactly one table component (export function …Table) under web/src/components/game/, found: ${tables:-none}"
else
	name="$(grep -oE '^export function [A-Z][A-Za-z]*Table' "$tables" | head -1 | sed 's/export function //')"
	uses="$(grep -cE "<$name([ >]|$)" "$BOX" || true)"
	[ "$uses" -ge 2 ] || bad 4 "$BOX renders <$name> $uses time(s) (want the batting and the pitching table through it)"
	grep -qE '^function (BattingTable|PitchingTable)\(' "$BOX" && grep -qE '<Table[ >]' "$BOX" && bad 4 "$BOX still draws its own Mantine Table beside $name"
fi
# No stat arithmetic in the views: ERA, WHIP and innings come from MLB's own strings.
grep -nE '(earnedRuns|inningsPitched|outs)[^;]*[*/] *[0-9]' web/src/components/game/*.tsx 2>/dev/null | grep -v '\.test\.' | grep -q . && bad 4 "a web game component computes a pitching rate"

# --- Check 5: AC 5: Hide Scores ---
run_vitest 5 web "$BOX_TEST" "S207 AC 5"
grep -qE 'HiddenValue' "$BOX" web/src/components/game/*Table*.tsx 2>/dev/null || bad 5 "the Box room's new parts do not mask through HiddenValue"

# --- Check 6: AC 6: no design match ---
grep -E '^(docs/v3/design-checks/S207/.*\.png|e2e/design/S207)' "$TMP/changed" | grep -q . && bad 6 "S207 adds design captures; the owner waived its design match"

# --- Check 7: AC 7: Status done ---
[ "$(story_snapshot_status S207)" = "done" ] || bad 7 "S207's snapshot does not record Status done"

# --- Check 8: fence ---
fence='^(packages/domain/|functions/src/mappers/|functions/src/adapters/fixtures/bundled\.ts$|fixtures/|openapi/bt-api\.v1\.json$|web/src/|web/vitest\.config\.ts$|e2e/design/|docs/v3/design-checks/|docs/v3/backlog/|docs/v3/audit/|changelog\.d/S207\.md$|scripts/verify-S207\.sh$)'
while IFS= read -r f; do
	[ -z "$f" ] && continue
	grep -qE "$fence" <<<"$f" || bad 8 "outside the fence: $f"
done <"$TMP/changed"

report "verify-S207"
exit $?
