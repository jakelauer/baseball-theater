#!/usr/bin/env bash
# Grader for backlog story S172 — the stage-mode player's inning row (standings-search-settings A10,
# ratified 2026-11-22): S145's `PlayInningPill` alone on a row above the stage's video for the clip
# it shows (chosen or the waiting first clip), no row for a clip with no play; and the inning pill's
# spoken name starting with its visible words, `Top 6: open play, top of 6th inning` (owner,
# 2026-11-22: "Start with the visible words (Recommended)").
# Contract: frame note 00, "Verify-script contract" (docs/v3/backlog/frame/).
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`); runs only the
# story-scoped Vitest files named below, once, and reads each test's result by name.

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "AC 1: on the stage a chosen clip with a play and the waiting first clip with a play each show PlayInningPill (videoPlayLink's words and destination) alone on a row above the video; a clip with no play shows no pill and no row (RTL named 'S172 AC 1')"
check 2 "AC 2: choosing the stage's pill navigates to /game/:gamePk/plays?play=<playId>, leaving the Videos room (RTL named 'S172 AC 2')"
check 3 "AC 3: no game pill in the stage: PlayerStage.tsx and PlayerHost.tsx don't contain 'More from game'"
check 4 "AC 4: PlayerStage.tsx imports PlayInningPill and videoPlayLink from ./ and renders no pill of its own; no stage file (PlayerStage.tsx, PlayerHost.tsx) builds 'Top '/'Bot ' with an inning, 'open play, ' or '/plays?play='; outside tests under web/src 'open play, ' and '/plays?play=' are only in playLink.ts"
check 5 "AC 5: playInningLink names the pill '<label>: open play, <half> of <ordinal> inning' from halfInningLabel and halfInningName (unit test named 'S172 AC 5': Top 6 and Bot 10); playLink.test.ts, VideoCard.test.tsx and VideoPlayLinks.test.tsx pass; no 'Open play - ' under web/src, packages or e2e; S172 did not touch scripts/verify-S145.sh"
check 6 "AC 6: Hide Scores leaves the stage's row unchanged (RTL named 'S172 AC 6')"
check 7 "AC 7: files S172 adds or edits under web/src (outside web/src/layout/) don't call useMediaQuery, hiddenFrom or visibleFrom"
check 8 "AC 8: the 4 design captures from e2e/design/S172.spec.ts under docs/v3/design-checks/S172/ at their pairing widths"
check 9 "AC 9: S172's Status is done: its snapshot fragment records done"
check 10 "S172 changed no file outside its fence (plus creating scripts/verify-S172.sh and its own records)"

# The commit S172's own changes start from: `git merge-base origin/stage HEAD` when this grader was written.
BASE=25527d80b9d3ee079334430de94ded98e3f85164

TMP="$(mktemp -d /tmp/verify-S172.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

V=web/src/components/videos
WEB_TESTS=(src/components/videos/PlayerStage.test.tsx src/components/videos/playLink.test.ts src/components/videos/VideoCard.test.tsx
	src/components/videos/VideoPlayLinks.test.tsx)
present=()
for t in "${WEB_TESTS[@]}"; do [ -f "web/$t" ] && present+=("$t"); done
[ "${#present[@]}" -gt 0 ] && (cd web && pnpm exec vitest run "${present[@]}" --reporter=json --outputFile="$TMP/web.json" >"$TMP/web.log" 2>&1)

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

for n in 1 2 6; do passed "$TMP/web.json" "S172 AC $n\\b" || bad "$n" "no passing RTL test named 'S172 AC $n' (or one failed)"; done

STAGE_FILES=("$V/PlayerStage.tsx" "$V/PlayerHost.tsx")

# --- Check 3: no game pill in the stage ---
for f in "${STAGE_FILES[@]}"; do
	grep -qF "More from game" "$f" 2>/dev/null && bad 3 "$f contains 'More from game'"
done

# --- Check 4: one pill ---
grep -qE '^import \{[^}]*\bPlayInningPill\b[^}]*\} from "\./PlayInningPill\.js";' "$V/PlayerStage.tsx" || bad 4 "PlayerStage.tsx does not import PlayInningPill from ./PlayInningPill.js"
grep -qE '^import \{[^}]*\bvideoPlayLink\b[^}]*\} from "\./playLink\.js";' "$V/PlayerStage.tsx" || bad 4 "PlayerStage.tsx does not import videoPlayLink from ./playLink.js"
grep -qE '<PlayInningPill\b' "$V/PlayerStage.tsx" || bad 4 "PlayerStage.tsx renders no PlayInningPill"
for f in "${STAGE_FILES[@]}"; do
	grep -qE '\.(to|label|name)\b.*</?(Link|Anchor|a)\b|<(Link|Anchor|a)\b[^>]*(to|href)=' "$f" && bad 4 "$f renders a link of its own"
	grep -qE '(Top|Bot) \$\{|"(Top|Bot) "|open play, |/plays\?play=' "$f" && bad 4 "$f builds an inning label, a spoken name or a play address"
done
src_files() { grep -rlF --exclude='*.test.*' --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=coverage -- "$1" web/src 2>/dev/null; }
[ "$(src_files 'open play, ')" = "$V/playLink.ts" ] || bad 4 "'open play, ' is in: $(src_files 'open play, ' | tr '\n' ' ')"
[ "$(src_files '/plays?play=')" = "$V/playLink.ts" ] || bad 4 "'/plays?play=' is in: $(src_files '/plays?play=' | tr '\n' ' ')"

# --- Check 5: the spoken name starts with the visible words ---
passed "$TMP/web.json" "S172 AC 5\\b" || bad 5 "no passing unit test named 'S172 AC 5'"
pt="$(cat "$V/playLink.test.ts" 2>/dev/null)"
for want in '"Top 6: open play, top of 6th inning"' '"Bot 10: open play, bottom of 10th inning"'; do
	grep -qF "$want" <<<"$pt" || bad 5 "playLink.test.ts asserts no $want"
done
fn="$(sed -n '/^export function playInningLink(/,/^}$/p' "$V/playLink.ts")"
grep -qF 'halfInningLabel(' <<<"$fn" || bad 5 "playInningLink does not call halfInningLabel"
grep -qF 'halfInningName(' <<<"$fn" || bad 5 "playInningLink does not call halfInningName"
grep -qF ': open play, ' <<<"$fn" || bad 5 "playInningLink's name is not '<label>: open play, …'"
grep -qE '"(top|bottom) of|(top|bottom) of \$' <<<"$fn" && bad 5 "playInningLink spells the half-inning itself"
for f in VideoCard.test.tsx VideoPlayLinks.test.tsx playLink.test.ts; do
	file_passed "$TMP/web.json" "$f" || bad 5 "$f did not pass"
done
old="$(grep -rlF --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=coverage -- 'Open play - ' web/src packages e2e 2>/dev/null)"
[ -z "$old" ] || bad 5 "'Open play - ' remains in: $(tr '\n' ' ' <<<"$old")"
grep -qxF 'scripts/verify-S145.sh' < <(story_own_changed_files S172 "$BASE" .) && bad 5 "S172 changed S145's frozen grader"

# --- Check 7: no breakpoint hooks in S172's own files ---
while IFS= read -r f; do
	case "$f" in web/src/layout/*) continue ;; web/src/*) ;; *) continue ;; esac
	[ -f "$f" ] || continue
	grep -qE '\b(useMediaQuery|hiddenFrom|visibleFrom)\b' "$f" && bad 7 "$f calls useMediaQuery, hiddenFrom or visibleFrom"
done < <(story_own_changed_files S172 "$BASE" .)

# --- Check 8: the 4 captures at their pairing widths ---
[ -f e2e/design/S172.spec.ts ] || bad 8 "e2e/design/S172.spec.ts missing"
for frame in video-player-stage-pill-mobile video-player-stage-pill-noplay-mobile video-player-stage-pill-medium video-player-stage-pill-noplay-medium; do
	case "$frame" in *-mobile) want=390 ;; *-medium) want=768 ;; *-desktop) want=1200 ;; esac
	f="docs/v3/design-checks/S172/$frame.png"
	if [ ! -f "$f" ]; then
		bad 8 "$f missing"
	else
		w=$(node -e 'const b=require("fs").readFileSync(process.argv[1]);process.stdout.write(String(b.readUInt32BE(16)))' "$f")
		[ "$w" = "$want" ] || bad 8 "$f is ${w}px wide, not $want"
	fi
done

# --- Check 9: Status done ---
[ "$(story_snapshot_status S172)" = "done" ] || bad 9 "S172's snapshot does not record Status done"

# --- Check 10: fence ---
fence='^(web/src/|web/vitest\.config\.ts$|e2e/design/|docs/v3/design-checks/|docs/v3/backlog/|docs/v3/audit/[^/]+/[^/]*-S172-[^/]*\.md$|changelog\.d/S172\.md$|scripts/verify-S172\.sh$)'
while IFS= read -r f; do
	[ -z "$f" ] && continue
	grep -qE "$fence" <<<"$f" || bad 10 "outside the fence: $f"
done < <(story_own_changed_files S172 "$BASE" .)
own_added="$(story_own_diff S172 "$BASE" --name-status --diff-filter=A -- scripts/verify-S172.sh)"
[ -n "$own_added" ] || [ -n "$(git ls-files --others --exclude-standard -- scripts/verify-S172.sh)" ] || bad 10 "scripts/verify-S172.sh was not created by S172"

report "verify-S172"
exit $?
