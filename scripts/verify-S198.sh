#!/usr/bin/env bash
# Grader for backlog story S198 — a playing clip keeps playing in a corner mini-player while the fan
# browses the site, the way YouTube's mini-player does: leaving the page (or the tool row's mini-player
# button) moves the same <video> element to the bottom right; expand, close and replace behave as on
# YouTube; the one player lives in a provider above the routes, moved between hosts, never re-created;
# and the corner stays clear of the update notice, the after-update notice and the footer's Live strip.
# No design governs it (the owner's 2026-11-25 exemption in the story text): no captures.
# Contract: frame note 00, "Verify-script contract" (docs/v3/backlog/frame/).
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`); runs only the
# story-scoped Vitest files named below, once, and reads each test's result by name. The Playwright
# flow needs a browser and the dev server, so the grader reads it rather than runs it.

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "AC 1: from each of the four hosts (Videos room, Plays room's play row, Search, day digest) a playing clip and a route change leave the same HTMLVideoElement in the corner player, currentTime no earlier (RTL named 'S198 AC 1' in each host's test); the mini-player button does it without a route change; a paused clip leaves no corner player (PlayerProvider.test.tsx); e2e/flows/mini-player.spec.ts plays a Videos-room clip, goes to the Box room and the scoreboard, checking paused false and currentTime advancing"
check 2 "AC 2: the corner player has play / pause, expand and close controls and the clip's title as its name; expand goes to the video's page with the same element in the modal; Back to that page expands it; close pauses and removes it; another video replaces it; one corner player at a time (RTL named 'S198 AC 2' in PlayerProvider.test.tsx)"
check 3 "AC 3: one site under web/src outside tests renders <VideoPlayer, the provider (PlayerProvider.tsx), through createPortal into one node moved with appendChild, keyed by the clip's id alone; PlayerDialog, PlayerStage and the corner player render none; no second Zustand store; S196's PlayerDialog tests render inside the provider and pass"
check 4 "AC 4: the corner player sits at the bottom right, a third of the width at mobile and 400px otherwise, above the update notice, the after-update notice and the footer's Live strip without overlapping them (e2e/flows/mini-player.spec.ts compares their boxes; RTL named 'S198 AC 4' passes)"
check 5 "AC 5: no design match: S198 adds no design spec or captures (e2e/design/S198.spec.ts, docs/v3/design-checks/S198/)"
check 6 "AC 6: S198's Status is done: its snapshot fragment records done"
check 7 "S198 changed no file outside its fence (plus creating scripts/verify-S198.sh and its own records)"

# The commit S198's own changes start from: origin/stage when this grader was written.
BASE=f0a6b3e2902fca30e9b98ae19a8c701ad93a862d

TMP="$(mktemp -d /tmp/verify-S198.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

P=web/src/components/videos/PlayerProvider.tsx
PT=components/videos/PlayerProvider.test.tsx
TESTS=(src/components/videos/PlayerProvider.test.tsx src/components/videos/VideosRoom.test.tsx src/components/pitch/PlaysPanel.test.tsx
	src/pages/SearchPage.test.tsx src/components/scoreboard/DayDigest.test.tsx src/components/videos/PlayerDialog.test.tsx src/components/videos/PlayerStage.test.tsx)
present=()
for t in "${TESTS[@]}"; do [ -f "web/$t" ] && present+=("$t"); done
(cd web && pnpm exec vitest run "${present[@]}" --reporter=json --outputFile="$TMP/web.json" >"$TMP/web.log" 2>&1)

# passed_in <file-suffix> <regex> — at least one test in a file ending <file-suffix> whose full name matches ran, and all such passed.
passed_in() {
	[ -f "$TMP/web.json" ] || return 1
	node -e '
		const r = require(process.argv[1]);
		const re = new RegExp(process.argv[3]);
		const hit = r.testResults.filter((f) => f.name.endsWith(process.argv[2])).flatMap((f) => f.assertionResults).filter((t) => re.test(t.fullName));
		process.exit(hit.length > 0 && hit.every((t) => t.status === "passed") ? 0 : 1);
	' "$TMP/web.json" "$1" "$2"
}

F=e2e/flows/mini-player.spec.ts

# --- Check 1: leaving a playing clip moves it to the corner ---
for f in components/videos/VideosRoom.test.tsx components/pitch/PlaysPanel.test.tsx pages/SearchPage.test.tsx components/scoreboard/DayDigest.test.tsx; do
	passed_in "$f" "S198 AC 1\\b" || bad 1 "no passing test named 'S198 AC 1' in web/src/$f (or one failed)"
done
passed_in "$PT" "S198 AC 1.*mini-player button" || bad 1 "no passing 'S198 AC 1' test of the mini-player button in web/src/$PT"
passed_in "$PT" "S198 AC 1.*paused" || bad 1 "no passing 'S198 AC 1' test that a paused clip leaves no corner player in web/src/$PT"
if [ ! -f "$F" ]; then
	bad 1 "$F missing"
else
	grep -qE '/box\b' "$F" || bad 1 "$F never goes to the Box room"
	grep -qE 'goto\("/games' "$F" || bad 1 "$F never opens the scoreboard"
	grep -qE '\.paused\b' "$F" || bad 1 "$F never reads the clip's paused"
	grep -qE '\.currentTime\b' "$F" || bad 1 "$F never reads the clip's currentTime"
fi

# --- Check 2: the corner player's controls ---
for c in "expand" "Back" "close" "another video" "one corner player"; do
	passed_in "$PT" "S198 AC 2.*$c" || bad 2 "no passing 'S198 AC 2' test of '$c' in web/src/$PT"
done

# --- Check 3: one player above the routes ---
sites="$(git grep --untracked -lE '<VideoPlayer\b' -- web/src | grep -v '\.test\.' || true)"
[ "$sites" = "$P" ] || bad 3 "<VideoPlayer is rendered from ${sites:-nowhere}, not only $P"
if [ -f "$P" ]; then
	grep -qF 'createPortal' "$P" || bad 3 "$P renders no createPortal"
	grep -qF 'appendChild' "$P" || bad 3 "$P never moves its node with appendChild"
	tr '\n\t' '  ' <"$P" | grep -qE '<VideoPlayer +key=\{[a-zA-Z.]*video\.id\}' || bad 3 "$P's VideoPlayer is not keyed by the clip's id alone"
fi
for f in web/src/components/videos/PlayerDialog.tsx web/src/components/videos/PlayerStage.tsx web/src/components/videos/CornerPlayer.tsx; do
	[ -f "$f" ] && grep -qE '<VideoPlayer\b' "$f" && bad 3 "$f renders a VideoPlayer"
done
[ -f web/src/components/videos/CornerPlayer.tsx ] || bad 3 "web/src/components/videos/CornerPlayer.tsx (the corner player) missing"
story_own_diff S198 "$BASE" -U0 -- web/src | grep -E '^\+.*from "zustand"' >/dev/null && bad 3 "S198 imports zustand (a second store)"
grep -qF 'PlayerProvider' web/src/components/videos/PlayerDialog.test.tsx || bad 3 "PlayerDialog.test.tsx does not render inside PlayerProvider"
for c in "S196 AC 1" "S196 AC 2" "S196 AC 3"; do
	passed_in components/videos/PlayerDialog.test.tsx "$c\\b" || bad 3 "PlayerDialog.test.tsx's '$c' tests do not all pass"
done
passed_in components/videos/PlayerStage.test.tsx "S196 AC 4\\b" || bad 3 "PlayerStage.test.tsx's 'S196 AC 4' tests do not all pass"

# --- Check 4: out of the way ---
passed_in "$PT" "S198 AC 4\\b" || bad 4 "no passing test named 'S198 AC 4' in web/src/$PT"
if [ -f "$F" ]; then
	for t in notice-float after-update-notice footer-live-strip; do
		grep -qF "$t" "$F" || bad 4 "$F never shows $t beside the corner player"
	done
	grep -qF 'boundingBox' "$F" || bad 4 "$F compares no boxes"
	grep -qE 'S198 AC 4' "$F" || bad 4 "$F has no test named 'S198 AC 4'"
fi

# --- Check 5: no design match ---
[ -e e2e/design/S198.spec.ts ] && bad 5 "e2e/design/S198.spec.ts exists (the design was waived)"
[ -e docs/v3/design-checks/S198 ] && bad 5 "docs/v3/design-checks/S198/ exists (the design was waived)"

# --- Check 6: Status done ---
[ "$(story_snapshot_status S198)" = "done" ] || bad 6 "S198's snapshot does not record Status done"

# --- Check 7: fence ---
fence='^(web/src/|web/vitest\.config\.ts$|e2e/design/|e2e/flows/|docs/v3/design-checks/|docs/v3/backlog/|docs/v3/audit/|changelog\.d/S198\.md$|scripts/verify-S198\.sh$)'
while IFS= read -r f; do
	[ -z "$f" ] && continue
	grep -qE "$fence" <<<"$f" || bad 7 "outside the fence: $f"
done < <(story_own_changed_files S198 "$BASE" .)
own_added="$(story_own_diff S198 "$BASE" --name-status --diff-filter=A -- scripts/verify-S198.sh)"
[ -n "$own_added" ] || [ -n "$(git ls-files --others --exclude-standard -- scripts/verify-S198.sh)" ] || bad 7 "scripts/verify-S198.sh was not created by S198"

report "verify-S198"
exit $?
