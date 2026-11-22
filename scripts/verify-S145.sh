#!/usr/bin/env bash
# Grader for backlog story S145 — a video's play link becomes an inning pill after the date on the
# card's meta line and in the floating player (game-shell A6, ratified by S144 on 2026-11-19):
# `Top 6 →`, spoken "Open play - Top of 6th inning", one pill component, one meta-line rule, one
# domain label replacing atBatInningLabel and PlaysPanel's private inningTag.
# Contract: frame note 00, "Verify-script contract" (docs/v3/backlog/frame/).
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`); runs only the
# story-scoped Vitest files named below, once each package, and reads each test's result by name.

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "AC 1: a card with a play reads its date then the pill (Top 6 →, no ordinal, S144's colours, linking to playLink.to), no kind word, no play-link line under the card, grid and list; the pill alone with no kind and no date; spoken names 'Open play - Top of 6th inning' / 'Open play - Bottom of 3rd inning' on the card and in the player; a video-kind clip, a recap and a no-kind clip with a play each read date + pill (RTL named 'S145 AC 1')"
check 2 "AC 2: a highlight, a recap and a condensed game with no play keep 'Kind · date', muted, no link (RTL named 'S145 AC 2'); VideosRoom's Kind · date test, S97's AC 1 card tests and HideScoresRooms pass"
check 3 "AC 3: the pill navigates without onPlay, the title and the date call onPlay, grid and list; the pill is in no button and no .bt-zoom-host, follows the card's button with no positive tabIndex (RTL named 'S145 AC 3'); a videos/ CSS rule gives the pill a 24px minimum hit area and a :hover fill of var(--bt-raised-current)"
check 4 "AC 4: the floating player shows the pill (words, destination) and choosing it closes the player (RTL named 'S145 AC 4'); S97's AC 2 player test passes"
check 5 "AC 5: PlayInningPill.tsx imported by VideoCard.tsx and PlayerDialog.tsx, neither drawing its own play link; the meta-line rule and playInningLink exported and unit-tested; the domain label and spoken name in inning.ts unit-tested (Top 6, Bot 3, Top 10; Top of 6th/Bottom of 3rd/Top of 1st/Bottom of 2nd/Top of 11th/Top of 12th inning); atBatInningLabel gone; '\"top\" ? \"Top\" : \"Bot\"' only in inning.ts; 'Bottom of' and 'Open play - ' each in one file and /plays?play= only in playLink.ts (web/src and packages, no tests); PlaysPanel.tsx calls the domain label and its tests pass (RTL/unit named 'S145 AC 5')"
check 6 "AC 6: the 8 design captures from e2e/design/S145.spec.ts under docs/v3/design-checks/S145/ at their pairing widths"
check 7 "AC 7: S145's Status is done: its snapshot fragment records done"
check 8 "S145 changed no file outside its fence (plus creating scripts/verify-S145.sh)"

# The commit S145's own changes start from: `git merge-base origin/stage HEAD` when this grader was written.
BASE=3fb98f9d803620c64d8d5e17d032315d1536b99d

TMP="$(mktemp -d /tmp/verify-S145.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

V=web/src/components/videos
WEB_TESTS=(src/components/videos/VideoCard.test.tsx src/components/videos/VideoPlayLinks.test.tsx src/components/videos/VideosRoom.test.tsx
	src/components/videos/playLink.test.ts src/components/game/HideScoresRooms.test.tsx src/components/pitch/PlaysPanel.test.tsx)
present=()
for t in "${WEB_TESTS[@]}"; do [ -f "web/$t" ] && present+=("$t"); done
(cd web && pnpm exec vitest run "${present[@]}" --reporter=json --outputFile="$TMP/web.json" >"$TMP/web.log" 2>&1)
(cd packages/domain && pnpm exec vitest run src/inning.test.ts src/video-play-context.test.ts --reporter=json --outputFile="$TMP/domain.json" >"$TMP/domain.log" 2>&1)

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

for n in 1 2 3 4; do passed "$TMP/web.json" "S145 AC $n\\b" || bad "$n" "no passing RTL test named 'S145 AC $n' (or one failed)"; done

# --- Check 2: the existing tests AC 2 moves keep passing ---
file_passed "$TMP/web.json" "VideosRoom.test.tsx" || bad 2 "VideosRoom.test.tsx did not pass"
passed "$TMP/web.json" "S97 AC 1" || bad 2 "S97's AC 1 card tests did not pass"
file_passed "$TMP/web.json" "HideScoresRooms.test.tsx" || bad 2 "HideScoresRooms.test.tsx did not pass"

# --- Check 3: the pill's hit area and hover fill, on its CSS rule ---
css="$(cat "$V"/*.css 2>/dev/null)"
grep -qE 'min-(height|block-size):[[:space:]]*(2[4-9]|[3-9][0-9])px' <<<"$css" || bad 3 "no videos/ CSS rule gives the pill a 24px minimum height"
grep -qE 'min-(width|inline-size):[[:space:]]*(2[4-9]|[3-9][0-9])px' <<<"$css" || bad 3 "no videos/ CSS rule gives the pill a 24px minimum width"
node -e '
	const css = process.argv[1];
	const ok = [...css.matchAll(/([^{}]*:hover[^{}]*)\{([^}]*)\}/g)].some(([, sel, body]) => /pill/.test(sel) && /background(-color)?:\s*var\(--bt-raised-current\)/.test(body));
	process.exit(ok ? 0 : 1);
' "$css" || bad 3 "no :hover rule on the pill sets its fill to var(--bt-raised-current)"

# --- Check 4: S97's player test ---
passed "$TMP/web.json" "S97 AC 2" || bad 4 "S97's AC 2 player test did not pass"

# --- Check 5: one pill, one label ---
[ -f "$V/PlayInningPill.tsx" ] || bad 5 "$V/PlayInningPill.tsx missing"
for f in VideoCard.tsx PlayerDialog.tsx; do
	grep -qE 'from "\./PlayInningPill\.js"' "$V/$f" || bad 5 "$f does not import PlayInningPill"
	grep -qE 'playLink\.(to|label)|data-testid="(player-)?play-link"' "$V/$f" && bad 5 "$f still renders a play link of its own"
done
passed "$TMP/web.json" "S145 AC 5" || bad 5 "no passing web test named 'S145 AC 5' (playInningLink, the meta-line rule)"
grep -qE '^export function playInningLink\(' "$V/playLink.ts" || bad 5 "playLink.ts exports no playInningLink"
passed "$TMP/domain.json" "S145 AC 5" || bad 5 "no passing domain test named 'S145 AC 5'"
dom_test="$(cat packages/domain/src/inning.test.ts 2>/dev/null)"
for want in '"Top 6"' '"Bot 3"' '"Top 10"' '"Top of 6th inning"' '"Bottom of 3rd inning"' '"Top of 1st inning"' '"Bottom of 2nd inning"' '"Top of 11th inning"' '"Top of 12th inning"'; do
	grep -qF "$want" <<<"$dom_test" || bad 5 "inning.test.ts has no case for $want"
done
src_files() { grep -rlF --exclude='*.test.*' --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=coverage -- "$1" web/src packages 2>/dev/null; }
[ -z "$(src_files atBatInningLabel)" ] || bad 5 "atBatInningLabel still in: $(src_files atBatInningLabel | tr '\n' ' ')"
[ "$(src_files '"top" ? "Top" : "Bot"')" = "packages/domain/src/inning.ts" ] || bad 5 "'\"top\" ? \"Top\" : \"Bot\"' is in: $(src_files '"top" ? "Top" : "Bot"' | tr '\n' ' ')"
[ "$(grep -cF '"top" ? "Top" : "Bot"' packages/domain/src/inning.ts)" = 1 ] || bad 5 "'\"top\" ? \"Top\" : \"Bot\"' is not on exactly one line of inning.ts"
[ "$(src_files 'Bottom of' | wc -l | tr -d ' ')" = 1 ] || bad 5 "'Bottom of' is in $(src_files 'Bottom of' | wc -l | tr -d ' ') files, not one"
[ "$(src_files 'Open play - ' | wc -l | tr -d ' ')" = 1 ] || bad 5 "'Open play - ' is in $(src_files 'Open play - ' | wc -l | tr -d ' ') files, not one"
[ "$(src_files '/plays?play=')" = "$V/playLink.ts" ] || bad 5 "'/plays?play=' is in: $(src_files '/plays?play=' | tr '\n' ' ')"
grep -qE '^function inningTag' web/src/components/pitch/PlaysPanel.tsx && ! sed -n '/^function inningTag/,/^}/p' web/src/components/pitch/PlaysPanel.tsx | grep -qE 'halfInningLabel\(' &&
	bad 5 "PlaysPanel.tsx's inningTag does not call the domain label"
grep -qE 'halfInningLabel' web/src/components/pitch/PlaysPanel.tsx || bad 5 "PlaysPanel.tsx does not use the domain label (halfInningLabel)"
file_passed "$TMP/web.json" "PlaysPanel.test.tsx" || bad 5 "PlaysPanel.test.tsx did not pass"
for f in inning.test.ts video-play-context.test.ts; do file_passed "$TMP/domain.json" "$f" || bad 5 "packages/domain/src/$f did not pass"; done

# --- Check 6: the 8 captures at their pairing widths ---
[ -f e2e/design/S145.spec.ts ] || bad 6 "e2e/design/S145.spec.ts missing"
for frame in game-videos-grid-playmeta-mobile game-videos-grid-playmeta-medium game-videos-grid-playmeta-desktop \
	game-videos-list-playmeta-mobile game-videos-list-playmeta-medium game-videos-list-playmeta-desktop \
	video-player-dialog-playmeta-mobile video-player-dialog-playmeta-medium; do
	case "$frame" in *-mobile) want=390 ;; *-medium) want=768 ;; *-desktop) want=1200 ;; esac
	f="docs/v3/design-checks/S145/$frame.png"
	if [ ! -f "$f" ]; then
		bad 6 "$f missing"
	else
		w=$(node -e 'const b=require("fs").readFileSync(process.argv[1]);process.stdout.write(String(b.readUInt32BE(16)))' "$f")
		[ "$w" = "$want" ] || bad 6 "$f is ${w}px wide, not $want"
	fi
done

# --- Check 7: Status done ---
[ "$(story_snapshot_status S145)" = "done" ] || bad 7 "S145's snapshot does not record Status done"

# --- Check 8: fence ---
fence='^(web/src/components/videos/|packages/domain/|web/src/components/pitch/PlaysPanel\.tsx$|web/vitest\.config\.ts$|docs/v3/backlog/|docs/v3/AUDIT\.md$|docs/v3/audit\.jsonl$|docs/v3/INDEX\.md$|CHANGELOG\.md$|e2e/design/|docs/v3/design-checks/|docs/v3/audit/[^/]+/[^/]*-S145-[^/]*\.md$|changelog\.d/S145\.md$|scripts/verify-S145\.sh$)'
while IFS= read -r f; do
	[ -z "$f" ] && continue
	grep -qE "$fence" <<<"$f" || bad 8 "outside the fence: $f"
done < <(story_own_changed_files S145 "$BASE" .)
own_added="$(story_own_diff S145 "$BASE" --name-status --diff-filter=A -- scripts/verify-S145.sh)"
[ -n "$own_added" ] || [ -n "$(git ls-files --others --exclude-standard -- scripts/verify-S145.sh)" ] || bad 8 "scripts/verify-S145.sh was not created by S145"

report "verify-S145"
exit $?
