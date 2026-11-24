#!/usr/bin/env bash
# Grader for story S171 — a scheduled scoreboard row draws no slot box: each probable pitcher,
# with his throwing hand (`J. Steele (L)`), sits beside his team in the row's body, as
# shell-scoreboard A16 (ratified 2026-11-22) draws it; Room Menu keeps its pre-game box.
# A commit-time proof of this story (S84).
# Contract: frame note 00, "Verify-script contract" (docs/v3/backlog/frame/).
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`); runs only the
# story-scoped Vitest files named below, once per package, and reads each test's result by name.

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "AC 1: slotOccupant gives null for Status before first pitch, the count / pitchers of record otherwise, roomMenu in every phase; no 'probables' occupant under packages/domain/src or web/src outside tests; GameRowSlot renders nothing for null (tests named 'S171 AC 1' passing in the domain and web suites)"
check 2 "AC 2: ProbablePitcher has 'pitchHand?: string | null', mapProbable maps pitchHand.code (null when MLB sends none; tests named 'S171 AC 2'); both schedule fixtures carry pitchHand and equal their regeneration (schedule-fixture.test.ts); openapi spec up to date with pitchHand on ProbablePitcher; generated web types carry it; S29's fidelity pairs ProbablePitcher; pnpm api:breaking exits 0"
check 3 "AC 3: one exported probableLabel in web/src/components/game/format.ts reusing shortPlayerName; no other non-test file under web/src builds the (L)/(R) suffix; tests named 'S171 AC 3' (left, right, null, undefined) pass"
check 4 "AC 4: the scheduled row draws each probable beside its team (label over season line, TBD when none) for every slot setting; no game-row-slot with Status, Room Menu box with Videos/Plays/Box and no Recap; the left area keeps its width (RTL named 'S171 AC 4 Status', 'S171 AC 4 Room Menu', 'S171 AC 4 TBD', 'S171 AC 4 no hand', 'S171 AC 4 width', each passing)"
check 5 "AC 5: Hide Scores leaves the probables and their lines (RTL named 'S171 AC 5' passing)"
check 6 "AC 6: web/src/pages/ScoreboardPage.test.tsx passes and S171 changed none of it (the render-count baseline holds)"
check 7 "AC 7: files S171 adds or edits under web/src have no team logo and don't call useMediaQuery, hiddenFrom or visibleFrom outside web/src/layout/"
check 8 "AC 8: e2e/design/S171.spec.ts captures docs/v3/design-checks/S171/scoreboard-scheduled-row-mobile.png (390 wide) and -desktop.png (1200 wide)"
check 9 "AC 9: S171's Status is done: its snapshot fragment records done"
check 10 "S171 changed no file outside its fence (plus creating scripts/verify-S171.sh and its own records)"

# The commit S171's own changes start from: `git merge-base origin/stage HEAD` when this grader was written.
BASE=c751d6d9a7a5547b586f9f9a517e8df6610603df

TMP="$(mktemp -d /tmp/verify-S171.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

WEB_TESTS=(src/components/scoreboard/GameRowSlot.test.tsx src/components/scoreboard/ScoreboardModule.test.tsx src/components/scoreboard/CollapseHide.test.tsx
	src/components/game/format.test.ts src/pages/ScoreboardPage.test.tsx src/api/generated.types.test.ts)
present=()
for t in "${WEB_TESTS[@]}"; do [ -f "web/$t" ] && present+=("$t"); done
# The three suites, the spec check and the breaking-change gate run side by side to stay under 60 seconds.
(cd web && pnpm exec vitest run "${present[@]}" --reporter=json --outputFile="$TMP/web.json" >"$TMP/web.log" 2>&1) &
(cd packages/domain && pnpm exec vitest run src/slot-occupant.test.ts --reporter=json --outputFile="$TMP/domain.json" >"$TMP/domain.log" 2>&1) &
(cd functions && pnpm exec vitest run src/mappers/schedule.test.ts src/services/schedule-fixture.test.ts --reporter=json --outputFile="$TMP/functions.json" >"$TMP/functions.log" 2>&1) &
(cd functions && pnpm exec tsx src/scripts/generate-openapi.ts --check >"$TMP/spec.log" 2>&1; echo $? >"$TMP/spec.rc") &
(pnpm -s api:breaking >"$TMP/breaking.log" 2>&1; echo $? >"$TMP/breaking.rc") &
wait

# passed <report> <regex> — at least one test whose full name matches ran, and every one that matches passed.
passed() {
	[ -f "$1" ] || return 1
	node -e '
		const r = require(process.argv[1]);
		const re = new RegExp(process.argv[2]);
		const all = r.testResults.flatMap((f) => f.assertionResults);
		const hit = all.filter((t) => re.test(t.fullName));
		process.exit(hit.length > 0 && hit.every((t) => t.status === "passed") ? 0 : 1);
	' "$1" "$2"
}
# file_passed <report> <file suffix> — the file ran, and every test in it passed.
file_passed() {
	[ -f "$1" ] || return 1
	node -e '
		const r = require(process.argv[1]);
		const f = r.testResults.find((x) => x.name.endsWith(process.argv[2]));
		process.exit(f && f.assertionResults.length > 0 && f.assertionResults.every((t) => t.status === "passed") ? 0 : 1);
	' "$1" "$2"
}
# Non-test source files under the given roots that contain the fixed string.
src_files() { grep -rlF --exclude='*.test.*' --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=coverage --exclude-dir=generated -- "$1" "${@:2}" 2>/dev/null; }

# --- Check 1: no box on a scheduled row ---
passed "$TMP/domain.json" "S171 AC 1\\b" || bad 1 "no passing domain test named 'S171 AC 1' (packages/domain/src/slot-occupant.test.ts)"
passed "$TMP/web.json" "S171 AC 1\\b" || bad 1 "no passing web test named 'S171 AC 1' (GameRowSlot renders nothing for null)"
file_passed "$TMP/domain.json" "slot-occupant.test.ts" || bad 1 "packages/domain/src/slot-occupant.test.ts did not pass"
occ="$(src_files '"probables"' packages/domain/src web/src)"
[ -z "$occ" ] || bad 1 "a \"probables\" occupant is still named in: $(tr '\n' ' ' <<<"$occ")"
grep -qE 'SlotOccupant \| null|: SlotOccupant \| null' packages/domain/src/slot-occupant.ts || bad 1 "slotOccupant does not return SlotOccupant | null"

# --- Check 2: the throwing hand ---
awk '/^export type ProbablePitcher/,/^};/' packages/domain/src/types.ts | grep -qF 'pitchHand?: string | null;' ||
	bad 2 "ProbablePitcher in packages/domain/src/types.ts has no 'pitchHand?: string | null'"
awk '/^export function mapProbable/,/^}/' functions/src/mappers/schedule.ts | grep -qF 'pitchHand' || bad 2 "mapProbable does not map pitchHand"
passed "$TMP/functions.json" "S171 AC 2\\b" || bad 2 "no passing functions test named 'S171 AC 2' (functions/src/mappers/schedule.test.ts)"
passed "$TMP/functions.json" "regenerates fixtures/schedule-2026-09-05.json" || bad 2 "fixtures/schedule-2026-09-05.json does not equal its regeneration"
passed "$TMP/functions.json" "moments: regenerates fixtures/schedule-823823-moments.json" || bad 2 "fixtures/schedule-823823-moments.json does not equal its regeneration"
for f in fixtures/schedule-2026-09-05.json fixtures/schedule-823823-moments.json; do
	grep -qE '"pitchHand": "(L|R)"' "$f" || bad 2 "$f has no probable with a pitchHand"
done
node -e '
	const s = require(process.argv[1]).components.schemas.ProbablePitcher;
	process.exit(s && s.properties && s.properties.pitchHand && !(s.required || []).includes("pitchHand") ? 0 : 1);
' "$PWD/openapi/bt-api.v1.json" || bad 2 "openapi/bt-api.v1.json's ProbablePitcher has no optional pitchHand"
[ "$(cat "$TMP/spec.rc" 2>/dev/null)" = "0" ] || bad 2 "openapi/bt-api.v1.json is stale (pnpm api:spec)"
awk '/ProbablePitcher: \{/,/\};/' web/src/api/generated/bt-api.v1.ts | grep -q 'pitchHand?:' || bad 2 "web/src/api/generated/bt-api.v1.ts's ProbablePitcher has no pitchHand"
grep -qE 'ProbablePitcher: true as MutuallyAssignable<components\["schemas"\]\["ProbablePitcher"\], ProbablePitcher>' web/src/api/generated.types.test.ts ||
	bad 2 "S29's fidelity (web/src/api/generated.types.test.ts) does not pair ProbablePitcher"
file_passed "$TMP/web.json" "api/generated.types.test.ts" || bad 2 "web/src/api/generated.types.test.ts did not pass"
[ "$(cat "$TMP/breaking.rc" 2>/dev/null)" = "0" ] || { bad 2 "pnpm api:breaking fails:"; tail -5 "$TMP/breaking.log" | sed 's/^/        /'; }

# --- Check 3: one name label ---
F=web/src/components/game/format.ts
grep -qE '^export function probableLabel\(' "$F" || bad 3 "$F exports no probableLabel"
awk '/^export function probableLabel/,/^}/' "$F" | grep -q 'shortPlayerName(' || bad 3 "probableLabel does not reuse shortPlayerName"
suffix="$(grep -rlE --exclude='*.test.*' --exclude-dir=generated '\(\$\{[^}]*[hH]and[^}]*\}\)|\((L|R)\)' web/src 2>/dev/null | grep -vx "$F")"
[ -z "$suffix" ] || bad 3 "another file builds the (L)/(R) suffix: $(tr '\n' ' ' <<<"$suffix")"
passed "$TMP/web.json" "S171 AC 3\\b" || bad 3 "no passing web test named 'S171 AC 3'"
for name in "S171 AC 3 left" "S171 AC 3 right" "S171 AC 3 null" "S171 AC 3 undefined"; do
	passed "$TMP/web.json" "$name\\b" || bad 3 "no passing web test named '$name'"
done

# --- Check 4: the scheduled row ---
for name in "S171 AC 4 Status" "S171 AC 4 Room Menu" "S171 AC 4 TBD" "S171 AC 4 no hand" "S171 AC 4 width"; do
	passed "$TMP/web.json" "$name\\b" || bad 4 "no passing web test named '$name'"
done
grep -q 'probableLabel' web/src/components/scoreboard/ScoreboardModule.tsx || bad 4 "ScoreboardModule does not draw probableLabel"
grep -q 'probableLine' web/src/components/scoreboard/ScoreboardModule.tsx || bad 4 "ScoreboardModule does not draw probableLine"

# --- Check 5: Hide Scores ---
passed "$TMP/web.json" "S171 AC 5\\b" || bad 5 "no passing web test named 'S171 AC 5'"

# --- Check 6: render-count baseline ---
file_passed "$TMP/web.json" "pages/ScoreboardPage.test.tsx" || bad 6 "web/src/pages/ScoreboardPage.test.tsx did not pass"
[ -z "$(story_own_diff S171 "$BASE" -- web/src/pages/ScoreboardPage.test.tsx)" ] || bad 6 "S171 edited web/src/pages/ScoreboardPage.test.tsx (the render-count baseline)"

# --- Check 7: no logo, no viewport queries outside web/src/layout/ ---
story_own_changed_files S171 "$BASE" web/src | while read -r f; do
	[ -f "$f" ] || continue
	grep -liE 'TeamLogo|team-logo|logo\.(svg|png)' "$f"
	case "$f" in web/src/layout/*) ;; *) grep -lE 'useMediaQuery|hiddenFrom|visibleFrom' "$f" ;; esac
done >"$TMP/q.txt"
[ -s "$TMP/q.txt" ] && bad 7 "a team logo or a viewport query in: $(tr '\n' ' ' <"$TMP/q.txt")"

# --- Check 8: the captures at their pairing widths ---
[ -f e2e/design/S171.spec.ts ] || bad 8 "e2e/design/S171.spec.ts missing"
for frame in scoreboard-scheduled-row-mobile scoreboard-scheduled-row-desktop; do
	case "$frame" in *-mobile) want=390 ;; *-desktop) want=1200 ;; esac
	f="docs/v3/design-checks/S171/$frame.png"
	if [ ! -f "$f" ]; then
		bad 8 "$f missing"
	else
		w=$(node -e 'const b=require("fs").readFileSync(process.argv[1]);process.stdout.write(String(b.readUInt32BE(16)))' "$f")
		[ "$w" = "$want" ] || bad 8 "$f is ${w}px wide, not $want"
	fi
done

# --- Check 9: Status done ---
[ "$(story_snapshot_status S171)" = "done" ] || bad 9 "S171's snapshot does not record Status done"

# --- Check 10: fence ---
fence='^(packages/domain/|functions/src/mappers/|fixtures/|openapi/|web/src/|web/vitest\.config\.ts$|e2e/design/|docs/v3/design-checks/|docs/v3/backlog/|docs/v3/audit/[^/]+/[^/]*-S171-[^/]*\.md$|changelog\.d/S171\.md$|scripts/verify-S171\.sh$)'
while IFS= read -r f; do
	[ -z "$f" ] && continue
	grep -qE "$fence" <<<"$f" || bad 10 "outside the fence: $f"
done < <(story_own_changed_files S171 "$BASE" .)
own_added="$(story_own_diff S171 "$BASE" --name-status --diff-filter=A -- scripts/verify-S171.sh)"
[ -n "$own_added" ] || [ -n "$(git ls-files --others --exclude-standard -- scripts/verify-S171.sh)" ] || bad 10 "scripts/verify-S171.sh was not created by S171"

report "verify-S171"
exit $?
