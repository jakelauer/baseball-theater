#!/usr/bin/env bash
# Grader for story S148 — the "Fetched … ago" footer label goes, and a page whose live WebSocket is
# open shows a glowing, slowly blinking red dot and "Live Data · Active" in a strip at the top of its
# footer (shell-scoreboard A13, ratified 2026-11-19 by S147). One marker (`LiveMarker`), one footer
# (`SiteFooter`, replacing `FooterMeta`), and the stream reports whether its socket is open.
# A commit-time proof of this story (S84).
# Contract: frame note 00, "Verify-script contract" (docs/v3/backlog/frame/).
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`); runs only the
# story-scoped Vitest files named below, once per package, and reads each test's result by name.

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "AC 1: no page shows 'Fetched … ago' and no footer reads 'baseball.theater'; socket open the footer is the strip alone, no socket no footer line (one RTL test per page, each passing: 'S148 AC 1 scoreboard', 'S148 AC 1 game, socket open', 'S148 AC 1 game, socket closed', 'S148 AC 1 game, no socket', 'S148 AC 1 Standings'); FooterMeta.tsx gone, nothing in web/src/layout/ takes fetchedAt; fetchedAgo and its test stay, its comment names the offline banner, not the footer; no 'Offline · saved' under web/src"
check 2 "AC 2: LiveGameStream reports its socket open and not open (before onopen, open, close, reconnect wait, polling, reopened, back from polling with polling stopped, unmount), useLiveGame returns the in-window flag and the open state, GamePage feeds useGame the in-window flag, no refetch interval during a reconnect wait (tests named 'S148 AC 2')"
check 3 "AC 3: LiveMarker and SiteFooter in web/src/layout/ (the marker reads 'Live Data · Active', dot aria-hidden, a 2s blink keyframe; footer-live-strip drawn only by SiteFooter); the three pages render SiteFooter, none FooterMeta; the game page shows it on Live and Box while open, not closed, not on Standings; the scoreboard follows useLiveDay if it exists, else shows none; LiveIndicator's comment names it the game's in-progress marker and LiveMarker the connection marker (RTL named 'S148 AC 3', with 'S148 AC 3 Live room' and 'S148 AC 3 Box room' each passing)"
check 4 "AC 4: under prefers-reduced-motion: reduce the dot glows but doesn't blink (tests named 'S148 AC 4')"
check 5 "AC 5: files this story adds or edits don't call useMediaQuery, hiddenFrom or visibleFrom outside web/src/layout/"
check 6 "AC 6: the design captures from e2e/design/S148.spec.ts under docs/v3/design-checks/S148/ at their pairing widths (scoreboard-live only if useLiveDay exists); the spec emulates reduced motion and routes the WebSocket"
check 7 "AC 7: S148's Status is done: its snapshot fragment records done"
check 8 "S148 changed no file outside its fence (plus creating scripts/verify-S148.sh and its own records)"

# The commit S148's own changes start from: `git merge-base origin/stage HEAD` when this grader was written.
BASE=0db18d3f17a432e62b544a344573055e87c04ee4

TMP="$(mktemp -d /tmp/verify-S148.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

L=web/src/layout
WEB_TESTS=(src/layout/SiteFooter.test.tsx src/layout/LiveMarker.test.tsx src/api/live.test.ts src/api/useLiveGame.test.tsx
	src/pages/GamePage.live.test.tsx src/pages/GamePage.test.tsx src/pages/StandingsPage.test.tsx src/pages/ScoreboardPage.test.tsx
	src/components/game/LiveIndicator.test.tsx)
present=()
for t in "${WEB_TESTS[@]}"; do [ -f "web/$t" ] && present+=("$t"); done
(cd web && pnpm exec vitest run "${present[@]}" --reporter=json --outputFile="$TMP/web.json" >"$TMP/web.log" 2>&1)
(cd packages/domain && pnpm exec vitest run src/fetched-ago.test.ts --reporter=json --outputFile="$TMP/domain.json" >"$TMP/domain.log" 2>&1)

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
src_files() { grep -rlF --exclude='*.test.*' --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=coverage -- "$1" "${@:2}" 2>/dev/null; }

for n in 1 2 3 4; do passed "$TMP/web.json" "S148 AC $n\\b" || bad "$n" "no passing web test named 'S148 AC $n' (or one failed)"; done
# Each page and state the ACs name has its own passing test, so one passing test can't stand for all of them.
for name in "S148 AC 1 scoreboard" "S148 AC 1 game, socket open" "S148 AC 1 game, socket closed" "S148 AC 1 game, no socket" "S148 AC 1 Standings"; do
	passed "$TMP/web.json" "$name\\b" || bad 1 "no passing web test named '$name'"
done
for name in "S148 AC 3 Live room" "S148 AC 3 Box room"; do
	passed "$TMP/web.json" "$name\\b" || bad 3 "no passing web test named '$name'"
done

# --- Check 1: the label goes ---
[ -e "$L/FooterMeta.tsx" ] && bad 1 "$L/FooterMeta.tsx still exists"
[ -z "$(grep -rl 'fetchedAt' "$L" 2>/dev/null)" ] || bad 1 "web/src/layout/ still names fetchedAt: $(grep -rl 'fetchedAt' "$L" | tr '\n' ' ')"
[ -z "$(src_files 'Fetched ${' web/src)" ] || bad 1 "a 'Fetched \${…}' label is still built in: $(src_files 'Fetched ${' web/src | tr '\n' ' ')"
[ -z "$(grep -rlF 'Offline · saved' web/src 2>/dev/null)" ] || bad 1 "'Offline · saved' is under web/src: $(grep -rlF 'Offline · saved' web/src | tr '\n' ' ')"
if [ ! -f packages/domain/src/fetched-ago.ts ] || [ ! -f packages/domain/src/fetched-ago.test.ts ]; then
	bad 1 "fetchedAgo or its test is gone (S74 AC 2's offline banner uses it)"
else
	file_passed "$TMP/domain.json" "fetched-ago.test.ts" || bad 1 "packages/domain/src/fetched-ago.test.ts did not pass"
	comment="$(awk '/^export function fetchedAgo/{exit} {print}' packages/domain/src/fetched-ago.ts)"
	grep -qi 'banner' <<<"$comment" || bad 1 "fetchedAgo's doc comment does not name the offline banner"
	grep -qi 'footer' <<<"$comment" && bad 1 "fetchedAgo's doc comment still names the footer"
fi

# --- Check 2: whether the socket is open ---
file_passed "$TMP/web.json" "api/live.test.ts" || bad 2 "web/src/api/live.test.ts did not pass"
file_passed "$TMP/web.json" "GamePage.live.test.tsx" || bad 2 "GamePage.live.test.tsx did not pass"
grep -qE 'useGame\(.*\.inWindow\)' web/src/pages/GamePage.tsx || bad 2 "GamePage does not pass useLiveGame's in-window flag to useGame"

# --- Check 3: the marker ---
for f in LiveMarker.tsx SiteFooter.tsx; do [ -f "$L/$f" ] || bad 3 "$L/$f missing"; done
grep -qF 'Live Data · Active' "$L/LiveMarker.tsx" 2>/dev/null || bad 3 "LiveMarker.tsx does not read 'Live Data · Active' (U+00B7)"
strip="$(src_files 'footer-live-strip' web/src)"
[ "$strip" = "$L/SiteFooter.tsx" ] || bad 3 "footer-live-strip is drawn in: ${strip:-nothing}, not SiteFooter.tsx alone"
for p in ScoreboardPage GamePage StandingsPage; do
	grep -qE 'from "\.\./layout/SiteFooter\.js"' "web/src/pages/$p.tsx" || bad 3 "$p.tsx does not import SiteFooter"
	grep -q 'FooterMeta' "web/src/pages/$p.tsx" && bad 3 "$p.tsx still names FooterMeta"
done
[ -z "$(grep -rl 'FooterMeta' web/src 2>/dev/null)" ] || bad 3 "FooterMeta is still named in: $(grep -rl 'FooterMeta' web/src | tr '\n' ' ')"
grep -qE 'bt-live-marker 2s' "$L/LiveMarker.tsx" web/src/styles.css 2>/dev/null && grep -qE '@keyframes bt-live-marker' web/src/styles.css ||
	bad 3 "no 2s bt-live-marker keyframe for the marker's blink"
grep -qF 'One component for every live marker' web/src/components/game/LiveIndicator.tsx && bad 3 "LiveIndicator's comment still says it is every live marker"
grep -qF 'LiveMarker' web/src/components/game/LiveIndicator.tsx || bad 3 "LiveIndicator's comment does not name LiveMarker as the page's connection marker"
if grep -rqE 'export function useLiveDay' web/src/api 2>/dev/null; then
	grep -q 'useLiveDay' web/src/pages/ScoreboardPage.tsx || bad 3 "useLiveDay exists but the scoreboard does not follow it"
else
	grep -q 'useLiveDay' web/src/pages/ScoreboardPage.tsx && bad 3 "ScoreboardPage names useLiveDay, which does not exist"
fi

# --- Check 4: reduced motion (the tests above) ---

# --- Check 5: no viewport queries outside web/src/layout/ ---
story_own_changed_files S148 "$BASE" web/src | grep -v '^web/src/layout/' | while read -r f; do
	[ -f "$f" ] && grep -lE 'useMediaQuery|hiddenFrom|visibleFrom' "$f"
done >"$TMP/mq.txt"
[ -s "$TMP/mq.txt" ] && bad 5 "viewport queries outside web/src/layout/: $(tr '\n' ' ' <"$TMP/mq.txt")"

# --- Check 6: the captures at their pairing widths ---
spec=e2e/design/S148.spec.ts
if [ ! -f "$spec" ]; then
	bad 6 "$spec missing"
else
	grep -qE 'reducedMotion: "reduce"' "$spec" || bad 6 "$spec does not emulate reduced motion"
	grep -qF 'routeWebSocket' "$spec" || bad 6 "$spec does not open the game's socket with routeWebSocket"
fi
frames=(live-marker-game-mobile live-marker-game-desktop live-marker-scoreboard-quiet-mobile live-marker-scoreboard-quiet-desktop)
grep -rqE 'export function useLiveDay' web/src/api 2>/dev/null && frames+=(live-marker-scoreboard-live-mobile live-marker-scoreboard-live-desktop)
for frame in "${frames[@]}"; do
	case "$frame" in *-mobile) want=390 ;; *-desktop) want=1200 ;; esac
	f="docs/v3/design-checks/S148/$frame.png"
	if [ ! -f "$f" ]; then
		bad 6 "$f missing"
	else
		w=$(node -e 'const b=require("fs").readFileSync(process.argv[1]);process.stdout.write(String(b.readUInt32BE(16)))' "$f")
		[ "$w" = "$want" ] || bad 6 "$f is ${w}px wide, not $want"
	fi
done

# --- Check 7: Status done ---
[ "$(story_snapshot_status S148)" = "done" ] || bad 7 "S148's snapshot does not record Status done"

# --- Check 8: fence ---
fence='^(web/src/|web/vitest\.config\.ts$|packages/domain/|docs/v3/backlog/|docs/v3/AUDIT\.md$|docs/v3/audit\.jsonl$|docs/v3/INDEX\.md$|CHANGELOG\.md$|e2e/design/|docs/v3/design-checks/|docs/v3/audit/[^/]+/[^/]*-S148-[^/]*\.md$|changelog\.d/S148\.md$|scripts/verify-S148\.sh$)'
while IFS= read -r f; do
	[ -z "$f" ] && continue
	grep -qE "$fence" <<<"$f" || bad 8 "outside the fence: $f"
done < <(story_own_changed_files S148 "$BASE" .)
own_added="$(story_own_diff S148 "$BASE" --name-status --diff-filter=A -- scripts/verify-S148.sh)"
[ -n "$own_added" ] || [ -n "$(git ls-files --others --exclude-standard -- scripts/verify-S148.sh)" ] || bad 8 "scripts/verify-S148.sh was not created by S148"

report "verify-S148"
exit $?
