#!/usr/bin/env bash
# Grader for story S108 — the scoreboard's Game-Row Slot gains Win Probability: a live row
# shows the line so far with each team's chance, a final row the whole game's line, as
# shell-scoreboard A7 (ratified 2026-11-19) draws it; a scheduled row has no box, and a game
# with no line falls back to the Status occupant.
# A commit-time proof of this story (S84).
# Contract: frame note 00, "Verify-script contract" (docs/v3/backlog/frame/).
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`); runs only the
# story-scoped Vitest files named below, once per package, and reads each test's result by name.

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "AC 1: GAME_ROW_SLOTS is status, roomMenu, winProbability; Settings labels it 'Win Probability', offered third, and saves it to the account; older saved settings still parse; the openapi spec is up to date with the new value; pnpm api:breaking exits 0 (tests named 'S108 AC 1' passing in the domain and web suites)"
check 2 "AC 2: slotOccupant takes the game's line: winProbability on a live or final game with a line gives the Win Probability occupant, without one the Status occupant, on a pregame game null; status and roomMenu unchanged in every phase (table test named 'S108 AC 2' over every setting, phase and line); RTL 'S108 AC 2 scheduled' (both probables in the body, no game-row-slot)"
check 3 "AC 3: slotWinProbability in packages/domain/src/win-probability.ts (away line, labels that add to 100, null when absent or null; tests 'S108 AC 3 absent', '823823', '49.5', 'one point'); one shared WinProbabilityLine drawn by both the Live card and the slot; RTL 'S108 AC 3 live', 'final', 'hidden live', 'hidden final', 'null final', 'null live' passing; the card's tests pass; ScoreboardPage.test.tsx passes unchanged"
check 4 "AC 4: files S108 adds or edits under web/src have no team logo and don't call useMediaQuery, hiddenFrom or visibleFrom outside web/src/layout/"
check 5 "AC 5: e2e/design/S108.spec.ts picks rows by gamePk and captures A7's four frames into docs/v3/design-checks/S108/ at their pairing widths (390 / 768 / 1200)"
check 6 "AC 6: S108's Status is done: its snapshot fragment records done"
check 7 "S108 changed no file outside its fence (plus creating scripts/verify-S108.sh and its own records)"

# The commit S108's own changes start from: `git merge-base origin/stage HEAD` when this grader was written.
BASE=ebd1706dfb08b9454ee09d26feeccb7b7c833040

TMP="$(mktemp -d /tmp/verify-S108.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

WEB_TESTS=(src/components/scoreboard/GameRowSlot.test.tsx src/components/game/WinProbabilityCard.test.tsx src/pages/ScoreboardPage.test.tsx)
(cd web && pnpm exec vitest run "${WEB_TESTS[@]}" --reporter=json --outputFile="$TMP/web.json" >"$TMP/web.log" 2>&1) &
(cd packages/domain && pnpm exec vitest run src/slot-occupant.test.ts src/win-probability.test.ts src/settings.test.ts --reporter=json --outputFile="$TMP/domain.json" >"$TMP/domain.log" 2>&1) &
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

# --- Check 1: the setting ---
grep -qE 'GAME_ROW_SLOTS = \["status", "roomMenu", "winProbability"\] as const' packages/domain/src/settings.ts ||
	bad 1 "GAME_ROW_SLOTS is not [\"status\", \"roomMenu\", \"winProbability\"] (packages/domain/src/settings.ts)"
grep -qE 'winProbability: "Win Probability"' web/src/pages/SettingsPage.tsx || bad 1 "SettingsPage does not label winProbability 'Win Probability'"
passed "$TMP/domain.json" "S108 AC 1\\b" || bad 1 "no passing domain test named 'S108 AC 1' (settings.test.ts: older settings parse, winProbability accepted)"
passed "$TMP/web.json" "S108 AC 1\\b" || bad 1 "no passing web test named 'S108 AC 1' (offered third, saved to the account)"
node -e '
	const s = require(process.argv[1]).components.schemas.GameRowSlot;
	process.exit(s && JSON.stringify(s.enum) === JSON.stringify(["status", "roomMenu", "winProbability"]) ? 0 : 1);
' "$PWD/openapi/bt-api.v1.json" || bad 1 "openapi/bt-api.v1.json's GameRowSlot enum is not status, roomMenu, winProbability"
[ "$(cat "$TMP/spec.rc" 2>/dev/null)" = "0" ] || bad 1 "openapi/bt-api.v1.json is stale (pnpm api:spec)"
[ "$(cat "$TMP/breaking.rc" 2>/dev/null)" = "0" ] || { bad 1 "pnpm api:breaking fails:"; tail -5 "$TMP/breaking.log" | sed 's/^/        /'; }

# --- Check 2: the slot's occupant ---
passed "$TMP/domain.json" "S108 AC 2\\b" || bad 2 "no passing domain test named 'S108 AC 2' (packages/domain/src/slot-occupant.test.ts)"
file_passed "$TMP/domain.json" "slot-occupant.test.ts" || bad 2 "packages/domain/src/slot-occupant.test.ts did not pass"
grep -qE '"winProbability"' packages/domain/src/slot-occupant.ts || bad 2 "slot-occupant.ts names no \"winProbability\" occupant"
grep -qE '^export function slotOccupant\([^)]*,[^)]*,[^)]*\)' packages/domain/src/slot-occupant.ts || bad 2 "slotOccupant does not take the game's line as a third input"
passed "$TMP/web.json" "S108 AC 2 scheduled\\b" || bad 2 "no passing web test named 'S108 AC 2 scheduled'"

# --- Check 3: the occupant ---
WP=packages/domain/src/win-probability.ts
grep -qE '^export function slotWinProbability\(' "$WP" || bad 3 "$WP exports no slotWinProbability"
for name in "S108 AC 3 absent" "S108 AC 3 823823" "S108 AC 3 49.5" "S108 AC 3 one point"; do
	passed "$TMP/domain.json" "$name\\b" || bad 3 "no passing domain test named '$name'"
done
file_passed "$TMP/domain.json" "win-probability.test.ts" || bad 3 "packages/domain/src/win-probability.test.ts did not pass"
LINE=web/src/components/game/WinProbabilityLine.tsx
if [ ! -f "$LINE" ]; then
	bad 3 "$LINE (the shared line, extracted from WinProbabilityCard) missing"
else
	grep -qE '^export function WinProbabilityLine\(' "$LINE" || bad 3 "$LINE exports no WinProbabilityLine"
fi
grep -q 'WinProbabilityLine' web/src/components/game/WinProbabilityCard.tsx || bad 3 "WinProbabilityCard does not draw through WinProbabilityLine"
grep -q 'strokeDasharray' web/src/components/game/WinProbabilityCard.tsx && bad 3 "WinProbabilityCard still draws its own dashed 50% line"
# The slot's occupant may live in its own module beside GameRowSlot (loaded lazily to keep the entry bundle in ADR-026's budget).
grep -q 'WinProbabilityLine' web/src/components/scoreboard/GameRowSlot.tsx web/src/components/scoreboard/SlotWinProbability.tsx 2>/dev/null || bad 3 "the scoreboard slot does not draw through WinProbabilityLine"
grep -q 'slotWinProbability' web/src/components/scoreboard/GameRowSlot.tsx web/src/components/scoreboard/SlotWinProbability.tsx 2>/dev/null || bad 3 "the scoreboard slot does not read slotWinProbability"
for name in "S108 AC 3 live" "S108 AC 3 final" "S108 AC 3 hidden live" "S108 AC 3 hidden final" "S108 AC 3 null final" "S108 AC 3 null live"; do
	passed "$TMP/web.json" "$name\\b" || bad 3 "no passing web test named '$name'"
done
file_passed "$TMP/web.json" "game/WinProbabilityCard.test.tsx" || bad 3 "web/src/components/game/WinProbabilityCard.test.tsx did not pass"
file_passed "$TMP/web.json" "pages/ScoreboardPage.test.tsx" || bad 3 "web/src/pages/ScoreboardPage.test.tsx did not pass"
[ -z "$(story_own_diff S108 "$BASE" -- web/src/pages/ScoreboardPage.test.tsx)" ] || bad 3 "S108 edited web/src/pages/ScoreboardPage.test.tsx (the render-count baseline)"

# --- Check 4: no logo, no viewport queries outside web/src/layout/ ---
story_own_changed_files S108 "$BASE" web/src | while read -r f; do
	[ -f "$f" ] || continue
	grep -liE 'TeamLogo|team-logo|logo\.(svg|png)' "$f"
	case "$f" in web/src/layout/*) ;; *) grep -lE 'useMediaQuery|hiddenFrom|visibleFrom' "$f" ;; esac
done >"$TMP/q.txt"
[ -s "$TMP/q.txt" ] && bad 4 "a team logo or a viewport query in: $(tr '\n' ' ' <"$TMP/q.txt")"

# --- Check 5: the captures at their pairing widths ---
SPEC=e2e/design/S108.spec.ts
if [ ! -f "$SPEC" ]; then
	bad 5 "$SPEC missing"
else
	grep -q 'data-game-pk' "$SPEC" || bad 5 "$SPEC does not pick its rows by gamePk (data-game-pk)"
	grep -qE '\.(nth|first|last)\(' "$SPEC" && grep -qE 'scoreboard-module"\)\.(nth|first|last)\(' "$SPEC" && bad 5 "$SPEC picks a row by its position"
fi
for frame in scoreboard-slot-winprob-mobile scoreboard-slot-winprob-medium scoreboard-slot-winprob-desktop scoreboard-slot-winprob-hidden-mobile; do
	case "$frame" in *-mobile) want=390 ;; *-medium) want=768 ;; *-desktop) want=1200 ;; esac
	f="docs/v3/design-checks/S108/$frame.png"
	if [ ! -f "$f" ]; then
		bad 5 "$f missing"
	else
		w=$(node -e 'const b=require("fs").readFileSync(process.argv[1]);process.stdout.write(String(b.readUInt32BE(16)))' "$f")
		[ "$w" = "$want" ] || bad 5 "$f is ${w}px wide, not $want"
	fi
done

# --- Check 6: Status done ---
[ "$(story_snapshot_status S108)" = "done" ] || bad 6 "S108's snapshot does not record Status done"

# --- Check 7: fence ---
fence='^(web/src/|web/vitest\.config\.ts$|packages/domain/|functions/src/|functions/vitest\.config\.ts$|openapi/|docs/v3/backlog/|docs/v3/audit/|changelog\.d/S108\.md$|e2e/design/|docs/v3/design-checks/|scripts/verify-S108\.sh$)'
while IFS= read -r f; do
	[ -z "$f" ] && continue
	grep -qE "$fence" <<<"$f" || bad 7 "outside the fence: $f"
done < <(story_own_changed_files S108 "$BASE" .)
own_added="$(story_own_diff S108 "$BASE" --name-status --diff-filter=A -- scripts/verify-S108.sh)"
[ -n "$own_added" ] || [ -n "$(git ls-files --others --exclude-standard -- scripts/verify-S108.sh)" ] || bad 7 "scripts/verify-S108.sh was not created by S108"

report "verify-S108"
exit $?
