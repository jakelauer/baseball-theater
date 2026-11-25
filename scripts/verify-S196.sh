#!/usr/bin/env bash
# Grader for backlog story S196 — the dialog video player becomes an inset modal: the title above
# the clip, BT's tools below it, the disclaimer at the bottom, the site dimmed but visible behind a
# slightly rounded border, and the close button, Escape or a press outside the border closing it.
# The `<video>` keeps the browser's built-in controls (B579) and no custom mute or full-screen button
# is added; the persistent stage keeps its own layout (pill row above, title under the clip).
# No design governs it (the owner's 2026-11-25 exemption in the story text): no captures.
# Contract: frame note 00, "Verify-script contract" (docs/v3/backlog/frame/).
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`); runs only the
# story-scoped Vitest files named below, once, and reads each test's result by name.

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "AC 1: PlayerDialog is an inset Mantine Modal (not fullScreen) held to about 90% of the viewport (90vw / 90dvh), rounded, over a dimmed overlay of opacity below 1; title (one size up from sm) above the <video>, tool row after it, disclaimer last; the disclaimer text once under web/src outside tests; RTL named 'S196 AC 1' passing in PlayerDialog, SearchPage and DayDigest tests"
check 2 "AC 2: the close control, Escape and a press outside the border each close it, a press on the clip, a tool or the title does not (RTL named 'S196 AC 2'); e2e/flows/player-modal.spec.ts opens a clip, clicks the dimmed site and sees the player gone"
check 3 "AC 3: the <video> keeps controls and playsInline and the dialog renders no button named mute / full screen (RTL named 'S196 AC 3')"
check 4 "AC 4: one VideoPlayer under web/src/components/videos (no second <video>); PlayerStage keeps its pill row above the <video> and its title under it (RTL named 'S196 AC 4' in PlayerStage.test.tsx)"
check 5 "AC 5: no design match: S196 adds no design spec or captures (e2e/design/S196.spec.ts, docs/v3/design-checks/S196/)"
check 6 "AC 6: S196's Status is done: its snapshot fragment records done"
check 7 "S196 changed no file outside its fence (plus creating scripts/verify-S196.sh and its own records)"

# The commit S196's own changes start from: origin/stage when this grader was written.
BASE=93852082aa6fa3c35f72a7cd1efd7d5272904ad0

TMP="$(mktemp -d /tmp/verify-S196.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

(cd web && pnpm exec vitest run src/components/videos/PlayerDialog.test.tsx src/components/videos/PlayerStage.test.tsx src/pages/SearchPage.test.tsx src/components/scoreboard/DayDigest.test.tsx \
	--reporter=json --outputFile="$TMP/web.json" >"$TMP/web.log" 2>&1)

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

D=web/src/components/videos/PlayerDialog.tsx
V=web/src/components/videos/VideoPlayer.tsx
S=web/src/styles.css

# --- Check 1: the modal ---
for f in components/videos/PlayerDialog.test.tsx pages/SearchPage.test.tsx components/scoreboard/DayDigest.test.tsx; do
	passed_in "$f" "S196 AC 1\\b" || bad 1 "no passing test named 'S196 AC 1' in web/src/$f (or one failed)"
done
grep -qE '\bfullScreen\b' "$D" && bad 1 "$D still passes fullScreen"
grep -qE '<Modal\b' "$D" || bad 1 "$D renders no Mantine Modal"
grep -qE 'radius=' "$D" || bad 1 "$D gives the modal no radius"
{ grep -qF '90vw' "$D" || grep -qF '90vw' "$S"; } || bad 1 "neither $D nor $S holds the modal to 90vw"
{ grep -qF '90dvh' "$D" || grep -qF '90dvh' "$S"; } || bad 1 "neither $D nor $S holds the modal to 90dvh"
grep -qE 'Text size="md"[^>]*>\{title\}' "$V" || bad 1 "$V draws no title at size md"
copies=$(grep -rlF "has no affiliation with or connection to Baseball Theater" web/src | grep -cv '\.test\.')
[ "$copies" = "1" ] || bad 1 "the disclaimer text is in $copies files under web/src outside tests, not 1"

# --- Check 2: three ways to close ---
for c in "close (button|control)" "Escape" "outside"; do
	passed_in components/videos/PlayerDialog.test.tsx "S196 AC 2.*$c" || bad 2 "no passing 'S196 AC 2' test closing by '$c'"
done
passed_in components/videos/PlayerDialog.test.tsx "S196 AC 2.*inside" || bad 2 "no passing 'S196 AC 2' test that a press inside does not close"
F=e2e/flows/player-modal.spec.ts
if [ ! -f "$F" ]; then
	bad 2 "$F missing"
else
	grep -qE '\.click\(' "$F" || bad 2 "$F clicks nothing"
	grep -qE 'toBeHidden|not\.toBeVisible|toHaveCount\(0\)' "$F" || bad 2 "$F never sees the player gone"
	grep -qE 'position' "$F" || bad 2 "$F never clicks a point outside the modal (position)"
fi

# --- Check 3: built-in controls kept, no custom mute / full screen ---
passed_in components/videos/PlayerDialog.test.tsx "S196 AC 3\\b" || bad 3 "no passing test named 'S196 AC 3' (or one failed)"
grep -qE '^\s*controls$' "$V" || bad 3 "$V's <video> lost controls"
grep -qE '^\s*playsInline$' "$V" || bad 3 "$V's <video> lost playsInline"

# --- Check 4: the stage keeps its layout; one player ---
passed_in components/videos/PlayerStage.test.tsx "S196 AC 4\\b" || bad 4 "no passing test named 'S196 AC 4' in PlayerStage.test.tsx (or one failed)"
players=$(grep -rlE 'component="video"|^\s*<video\b' web/src/components/videos --include='*.tsx' | grep -v '\.test\.' || true)
[ "$players" = "$V" ] || bad 4 "a <video> is rendered outside $V: ${players:-none}"

# --- Check 5: no design match ---
[ -e e2e/design/S196.spec.ts ] && bad 5 "e2e/design/S196.spec.ts exists (the design was waived)"
[ -e docs/v3/design-checks/S196 ] && bad 5 "docs/v3/design-checks/S196/ exists (the design was waived)"

# --- Check 6: Status done ---
[ "$(story_snapshot_status S196)" = "done" ] || bad 6 "S196's snapshot does not record Status done"

# --- Check 7: fence ---
fence='^(web/src/|web/vitest\.config\.ts$|e2e/design/|e2e/flows/|docs/v3/design-checks/|docs/v3/backlog/|docs/v3/audit/|changelog\.d/S196\.md$|scripts/verify-S196\.sh$)'
while IFS= read -r f; do
	[ -z "$f" ] && continue
	grep -qE "$fence" <<<"$f" || bad 7 "outside the fence: $f"
done < <(story_own_changed_files S196 "$BASE" .)
own_added="$(story_own_diff S196 "$BASE" --name-status --diff-filter=A -- scripts/verify-S196.sh)"
[ -n "$own_added" ] || [ -n "$(git ls-files --others --exclude-standard -- scripts/verify-S196.sh)" ] || bad 7 "scripts/verify-S196.sh was not created by S196"

report "verify-S196"
exit $?
