#!/usr/bin/env bash
# Grader for story S170 — the game status marker (game-shell A7, ratified 2026-11-22): one
# `gameStatusMarker` in packages/domain sorts a game's status into live, delayed, delayed start or
# suspended with MLB's reason, and one marker component (`LiveIndicator`, with a `kind`) draws it
# in the game top bar and on the scoreboard row, gold and steady for the three stopped states.
# A commit-time proof of this story (S84).
# Contract: frame note 00, "Verify-script contract" (docs/v3/backlog/frame/).
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`); runs only the
# story-scoped Vitest files named below, once per package, and reads each test's result by name.

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "AC 1: one exported gameStatusMarker (packages/domain/src/game-status-marker.ts, exported from the index) reading normalizeStatusCode / isSuspendedStatus, no second code table; its Vitest file reads fixtures/raw/gamestatus.json and its tests named 'S170 AC 1' pass"
check 2 "AC 2: LiveIndicator is the one marker (kind prop), drawn by GameTopBar and ScoreboardModule, no text-transform in its file, no second blinking dot component; one exported short inning label in inning.ts sharing one private half resolver with inningLabel; tests named 'S170 AC 2' pass (domain and web)"
check 3 "AC 3: GameTopBar shows the marker per kind at mobile, medium and desktop, the three stopped states on their own line at mobile (tests named 'S170 AC 3' pass, statuses from fixtures/raw/gamestatus.json)"
check 4 "AC 4: ScoreboardModule's row marker per kind (tests named 'S170 AC 4' pass, statuses from fixtures/raw/gamestatus.json)"
check 5 "AC 5: only live blinks, steady under reduced motion (tests named 'S170 AC 5' pass)"
check 6 "AC 6: Live tab for T and IR, none for PR (tests named 'S170 AC 6' pass); game-phase.ts unchanged"
check 7 "AC 7: files S170 adds or edits don't call useMediaQuery, hiddenFrom or visibleFrom outside web/src/layout/"
check 8 "AC 8: e2e/design/S170.spec.ts captures A7's ten game and scoreboard frames into docs/v3/design-checks/S170/ (390 / 1200 wide)"
check 9 "AC 9: S170's Status is done: its snapshot fragment records done"
check 10 "S170 changed no file outside its fence (plus creating scripts/verify-S170.sh and its own records)"

# The commit S170's own changes start from: `git merge-base origin/stage HEAD` when this grader was written.
BASE=25527d80b9d3ee079334430de94ded98e3f85164

TMP="$(mktemp -d /tmp/verify-S170.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

WEB_TESTS=(src/components/game/LiveIndicator.test.tsx src/components/game/GameTopBar.test.tsx
	src/components/scoreboard/ScoreboardModule.status.test.tsx src/pages/GamePage.status.test.tsx)
present=()
for t in "${WEB_TESTS[@]}"; do [ -f "web/$t" ] && present+=("$t"); done
DOMAIN_TESTS=(src/game-status-marker.test.ts src/inning.test.ts)
dpresent=()
for t in "${DOMAIN_TESTS[@]}"; do [ -f "packages/domain/$t" ] && dpresent+=("$t"); done
if [ "${#present[@]}" -gt 0 ]; then
	(cd web && pnpm exec vitest run "${present[@]}" --reporter=json --outputFile="$TMP/web.json" >"$TMP/web.log" 2>&1) &
fi
(cd packages/domain && pnpm exec vitest run "${dpresent[@]}" --reporter=json --outputFile="$TMP/domain.json" >"$TMP/domain.log" 2>&1) &
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

# --- Check 1: one calculation ---
M=packages/domain/src/game-status-marker.ts
if [ ! -f "$M" ]; then
	bad 1 "$M missing"
else
	grep -qE '^export function gameStatusMarker\(' "$M" || bad 1 "$M exports no gameStatusMarker"
	grep -qE 'normalizeStatusCode|isSuspendedStatus' "$M" || bad 1 "gameStatusMarker reads neither normalizeStatusCode nor isSuspendedStatus"
	grep -nE '"[A-Z][A-Z0-9]"' "$M" >"$TMP/codes.txt" && bad 1 "$M lists two-letter status codes (a second code table): $(head -3 "$TMP/codes.txt" | tr '\n' ' ')"
fi
grep -qE '^export \* from "\./game-status-marker\.js";' packages/domain/src/index.ts || bad 1 "packages/domain/src/index.ts does not export ./game-status-marker.js"
grep -q 'raw/gamestatus.json' packages/domain/src/game-status-marker.test.ts 2>/dev/null || bad 1 "packages/domain/src/game-status-marker.test.ts does not read fixtures/raw/gamestatus.json"
passed "$TMP/domain.json" "S170 AC 1\\b" || bad 1 "no passing domain test named 'S170 AC 1'"
file_passed "$TMP/domain.json" "game-status-marker.test.ts" || bad 1 "packages/domain/src/game-status-marker.test.ts did not pass"

# --- Check 2: one marker component, one inning spelling ---
L=web/src/components/game/LiveIndicator.tsx
[ -f "$L" ] || bad 2 "$L missing"
grep -qE 'kind' "$L" || bad 2 "LiveIndicator takes no kind"
grep -nE 'tt=|textTransform|text-transform' "$L" >"$TMP/tt.txt" && bad 2 "the marker applies a text-transform: $(head -2 "$TMP/tt.txt" | tr '\n' ' ')"
grep -q 'LiveIndicator' web/src/components/game/GameTopBar.tsx || bad 2 "GameTopBar does not draw LiveIndicator"
grep -q 'LiveIndicator' web/src/components/scoreboard/ScoreboardModule.tsx || bad 2 "ScoreboardModule does not draw LiveIndicator"
blink="$(grep -rlE --include='*.tsx' --include='*.ts' --exclude='*.test.*' 'bt-blink' web/src | grep -vx "$L")"
[ -z "$blink" ] || bad 2 "another component draws the blinking dot: $(tr '\n' ' ' <<<"$blink")"
others="$(find web/src -name '*Marker*.tsx' ! -name '*.test.tsx' ! -path 'web/src/layout/LiveMarker.tsx')"
[ -z "$others" ] || bad 2 "a second marker component: $(tr '\n' ' ' <<<"$others")"
I=packages/domain/src/inning.ts
grep -qE '^export function inningShortLabel\(' "$I" || bad 2 "$I exports no inningShortLabel"
for fn in inningLabel inningShortLabel; do
	awk "/^export function $fn\\(/,/^}/" "$I" | grep -q 'inningHalf(' || bad 2 "$fn does not use the private inningHalf resolver"
done
grep -qE '^export function inningHalf' "$I" && bad 2 "inningHalf is exported (it is private)"
# Code lines only: a comment quoting a label (`Bot 7th`) is not a spelling.
spell="$(grep -rnE --exclude='*.test.*' --exclude-dir=generated '"(Bot|Mid|End) ?"|`(Bot|Mid) ' web/src 2>/dev/null | grep -vE '^[^:]+:[0-9]+:[[:space:]]*(\*|//|/\*)' | cut -d: -f1 | sort -u)"
[ -z "$spell" ] || bad 2 "a view spells the inning half itself: $(tr '\n' ' ' <<<"$spell")"
passed "$TMP/domain.json" "S170 AC 2\\b" || bad 2 "no passing domain test named 'S170 AC 2' (inning.test.ts)"
file_passed "$TMP/domain.json" "inning.test.ts" || bad 2 "packages/domain/src/inning.test.ts did not pass"
for name in "S170 AC 2 text-transform" "S170 AC 2 aria-hidden" "S170 AC 2 labels"; do
	passed "$TMP/web.json" "$name\\b" || bad 2 "no passing web test named '$name'"
done
file_passed "$TMP/web.json" "components/game/LiveIndicator.test.tsx" || bad 2 "LiveIndicator.test.tsx did not pass"

# --- Check 3: the top bar ---
for name in "S170 AC 3 mobile" "S170 AC 3 medium" "S170 AC 3 desktop" "S170 AC 3 none"; do
	passed "$TMP/web.json" "$name\\b" || bad 3 "no passing web test named '$name'"
done
grep -q 'raw/gamestatus.json' web/src/components/game/GameTopBar.test.tsx 2>/dev/null || bad 3 "GameTopBar.test.tsx does not build statuses from fixtures/raw/gamestatus.json"

# --- Check 4: the scoreboard row ---
for name in "S170 AC 4 live" "S170 AC 4 delayed" "S170 AC 4 delayed no inning" "S170 AC 4 suspended" "S170 AC 4 delayed start"; do
	passed "$TMP/web.json" "$name\\b" || bad 4 "no passing web test named '$name'"
done
grep -q 'raw/gamestatus.json' web/src/components/scoreboard/ScoreboardModule.status.test.tsx 2>/dev/null || bad 4 "ScoreboardModule.status.test.tsx does not build statuses from fixtures/raw/gamestatus.json"

# --- Check 5: motion ---
passed "$TMP/web.json" "S170 AC 5\\b" || bad 5 "no passing web test named 'S170 AC 5'"

# --- Check 6: the Live room ---
passed "$TMP/web.json" "S170 AC 6\\b" || bad 6 "no passing web test named 'S170 AC 6'"
grep -q 'raw/gamestatus.json' web/src/pages/GamePage.status.test.tsx 2>/dev/null || bad 6 "GamePage.status.test.tsx does not build statuses from fixtures/raw/gamestatus.json"
[ -z "$(story_own_diff S170 "$BASE" -- packages/domain/src/game-phase.ts)$(git diff HEAD -- packages/domain/src/game-phase.ts)" ] || bad 6 "S170 changed gamePhase (it is reused, not changed)"

# --- Check 7: no viewport queries outside web/src/layout/ ---
{ story_own_changed_files S170 "$BASE" web/src; git ls-files --others --exclude-standard -- web/src; } | sort -u | while read -r f; do
	[ -f "$f" ] || continue
	case "$f" in web/src/layout/*) ;; *) grep -lE 'useMediaQuery|hiddenFrom|visibleFrom' "$f" ;; esac
done >"$TMP/q.txt"
[ -s "$TMP/q.txt" ] && bad 7 "a viewport query in: $(tr '\n' ' ' <"$TMP/q.txt")"

# --- Check 8: the captures at their pairing widths ---
[ -f e2e/design/S170.spec.ts ] || bad 8 "e2e/design/S170.spec.ts missing"
for state in live delayed suspended delayed-start; do
	for p in mobile desktop; do frames+=("status-marker-game-$state-$p"); done
done
frames+=(status-marker-scoreboard-mobile status-marker-scoreboard-desktop)
for frame in "${frames[@]}"; do
	case "$frame" in *-mobile) want=390 ;; *-desktop) want=1200 ;; esac
	f="docs/v3/design-checks/S170/$frame.png"
	if [ ! -f "$f" ]; then
		bad 8 "$f missing"
	else
		w=$(node -e 'const b=require("fs").readFileSync(process.argv[1]);process.stdout.write(String(b.readUInt32BE(16)))' "$f")
		[ "$w" = "$want" ] || bad 8 "$f is ${w}px wide, not $want"
	fi
done

# --- Check 9: Status done ---
[ "$(story_snapshot_status S170)" = "done" ] || bad 9 "S170's snapshot does not record Status done"

# --- Check 10: fence ---
fence='^(packages/domain/|web/src/|web/vitest\.config\.ts$|e2e/design/|docs/v3/design-checks/|docs/v3/backlog/|docs/v3/audit/[^/]+/[^/]*-S170-[^/]*\.md$|changelog\.d/S170\.md$|scripts/verify-S170\.sh$)'
while IFS= read -r f; do
	[ -z "$f" ] && continue
	grep -qE "$fence" <<<"$f" || bad 10 "outside the fence: $f"
done < <(story_own_changed_files S170 "$BASE" .)
own_added="$(story_own_diff S170 "$BASE" --name-status --diff-filter=A -- scripts/verify-S170.sh)"
[ -n "$own_added" ] || [ -n "$(git ls-files --others --exclude-standard -- scripts/verify-S170.sh)" ] || bad 10 "scripts/verify-S170.sh was not created by S170"

report "verify-S170"
exit $?
