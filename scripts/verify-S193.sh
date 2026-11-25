#!/usr/bin/env bash
# Grader for backlog story S193 — after updating on a game page at a phone or tablet width, the
# "Update complete" notice (shell-scoreboard A17, ratified 2026-11-23 by S192) shows in place of S135's
# pointer, which has no menu button to aim at there, and a tap on it opens the change log in a modal over
# the game page. A9's other rules hold (never with the update notice, 10 seconds, once per release), the
# notice and the pointer hand over to each other when the fan moves between pages, and the modal closes
# on its ✕, the scrim, Escape and the phone's Back.
# Contract: frame note 00, "Verify-script contract" (docs/v3/backlog/frame/).
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`); runs only the
# story-scoped Vitest files named below, once, and reads each test's result by name.

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "AC 1: on a game page at mobile and medium the notice shows instead of the pointer; a page with a menu button keeps the pointer; the update notice suppresses both and ends a showing notice while an opened modal stays; the hand-over between pages carries the time left and records the release once (RTL named 'S193 AC 1')"
check 2 "AC 2: the notice opens the change log in a Mantine Modal reusing S134's ChangelogPage (one component, no second copy); ✕, scrim, Escape and Back each close it (RTL named 'S193 AC 2'); e2e/flows/ has the phone-width Back/✕ flow, never asserting history.length"
check 3 "AC 3: the notice records the release through checkAfterUpdate/startAfterUpdate only, once per release whether shown as the notice, the pointer or both (RTL named 'S193 AC 3')"
check 4 "AC 4: the 10 design captures of A17's frames from e2e/design/S193.spec.ts under docs/v3/design-checks/S193/ at their pairing widths (390 mobile, 768 medium)"
check 5 "AC 5: S193's Status is done: its snapshot records done"
check 6 "S193 changed no file outside its fence, and nothing under scripts/ or test/ but creating scripts/verify-S193.sh"

# The commit S193's own changes start from: `git merge-base origin/stage HEAD` when this grader was written.
BASE=da8dfb6d95b14e93c7439443e44b15b059144c9d

TMP="$(mktemp -d /tmp/verify-S193.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

WEB_TESTS=(src/pwa/afterUpdate.test.tsx src/layout/AppShellLayout.test.tsx src/pages/ChangelogPage.test.tsx src/pwa/UpdatedNotice.test.tsx)
present=()
for t in "${WEB_TESTS[@]}"; do [ -f "web/$t" ] && present+=("$t"); done
if [ "${#present[@]}" -gt 0 ]; then
	(cd web && pnpm exec vitest run "${present[@]}" --reporter=json --outputFile="$TMP/web.json" >"$TMP/web.log" 2>&1)
fi

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
# count <report> <regex> — how many tests whose full name matches ran.
count() {
	[ -f "$1" ] || { echo 0; return; }
	node -e '
		const r = require(process.argv[1]);
		const re = new RegExp(process.argv[2]);
		process.stdout.write(String(r.testResults.flatMap((f) => f.assertionResults).filter((t) => re.test(t.fullName)).length));
	' "$1" "$2"
}

for n in 1 2 3; do passed "$TMP/web.json" "S193 AC $n\\b" || bad "$n" "no passing test named 'S193 AC $n' (or one failed)"; done
for t in afterUpdate.test.tsx AppShellLayout.test.tsx ChangelogPage.test.tsx; do
	file_passed "$TMP/web.json" "$t" || bad 1 "web/src/**/$t did not pass whole"
done

# --- Check 1: the cases AC 1 names, each its own test, and the shell choosing by its LayoutVariant ---
for c in "phone width" "menu button" "update notice" "modal.*stays open" "leaving the game page" "opening a game page"; do
	[ "$(count "$TMP/web.json" "S193 AC 1.*$c")" -gt 0 ] || bad 1 "no 'S193 AC 1' test about '$c'"
done
L=web/src/layout/AppShellLayout.tsx
grep -qE 'UpdatedNotice' "$L" || bad 1 "$L does not draw the after-update notice (UpdatedNotice)"
grep -qE 'gameRoute' "$L" || bad 1 "$L no longer tells game routes apart"
N=web/src/pwa/UpdatedNotice.tsx
if [ ! -f "$N" ]; then
	bad 1 "$N missing"
else
	grep -qE 'PointerBody' "$N" || bad 1 "$N does not reuse the pointer's PointerBody (A17: 'nothing is designed in code')"
	grep -qE 'useMediaQuery|hiddenFrom|visibleFrom' "$N" && bad 1 "$N reads the viewport itself (only web/src/layout/ may)"
fi

# --- Check 2: one change log, in a Mantine Modal; four ways to close; the flow ---
if [ -f "$N" ]; then
	grep -qE '\bModal\b' "$N" || bad 2 "$N does not open the change log in Mantine's Modal"
	grep -qE 'ChangelogPage' "$N" || bad 2 "$N does not reuse S134's ChangelogPage"
	grep -qE 'pushState' "$N" || bad 2 "$N adds no history entry for Back to close the modal"
	grep -qE 'popstate' "$N" || bad 2 "$N does not close the modal on Back (popstate)"
fi
copies=$(grep -rlF "Couldn't load the change log" web/src --include='*.tsx' --include='*.ts' | grep -v '\.test\.' | grep -vc '^web/src/pages/ChangelogPage\.tsx$')
[ "$copies" = "0" ] || bad 2 "the change log's words are copied outside ChangelogPage.tsx ($copies file(s))"
for c in "✕|close button" "scrim|outside" "Escape" "Back"; do
	[ "$(count "$TMP/web.json" "S193 AC 2.*($c)")" -gt 0 ] || bad 2 "no 'S193 AC 2' test closing by '$c'"
done
F=e2e/flows/changelog-modal.spec.ts
if [ ! -f "$F" ]; then
	bad 2 "$F missing"
else
	grep -qE 'goBack' "$F" || bad 2 "$F never presses Back"
	grep -qE 'toHaveURL' "$F" || bad 2 "$F never checks the URL"
	grep -qE 'history\.length' "$F" && bad 2 "$F asserts history.length (AC 2 says not to)"
	grep -qE 'width: 390|390' "$F" || bad 2 "$F does not run at a phone width (390)"
fi

# --- Check 3: one record of the release ---
P=web/src/pwa/afterUpdate.tsx
writers=$(grep -rlE 'writeStored\("bt\.lastRelease"' web/src | grep -v '\.test\.' || true)
[ "$writers" = "$P" ] || bad 3 "the release is recorded somewhere other than $P's checkAfterUpdate: ${writers:-nowhere}"
grep -qE '^export function checkAfterUpdate\(' "$P" || bad 3 "$P no longer exports checkAfterUpdate"
grep -qE '^export function startAfterUpdate\(' "$P" || bad 3 "$P no longer exports startAfterUpdate"
[ "$(count "$TMP/web.json" "S193 AC 3.*reload")" -gt 0 ] || bad 3 "no 'S193 AC 3' test of a reload after the notice"

# --- Check 4: the 10 captures at their pairing widths ---
[ -f e2e/design/S193.spec.ts ] || bad 4 "e2e/design/S193.spec.ts missing"
for p in mobile medium; do
	for frame in "game-updated-notice-$p" "game-updated-changelog-$p" "game-updated-changelog-loading-$p" "game-updated-changelog-empty-$p" "game-updated-changelog-error-$p"; do
		case "$frame" in *-mobile) want=390 ;; *-medium) want=768 ;; esac
		f="docs/v3/design-checks/S193/$frame.png"
		if [ ! -f "$f" ]; then
			bad 4 "$f missing"
		else
			w=$(node -e 'const b=require("fs").readFileSync(process.argv[1]);process.stdout.write(String(b.readUInt32BE(16)))' "$f")
			[ "$w" = "$want" ] || bad 4 "$f is ${w}px wide, not $want"
		fi
	done
done

# --- Check 5: Status done ---
[ "$(story_snapshot_status S193)" = "done" ] || bad 5 "S193's snapshot does not record Status done"

# --- Check 6: fence ---
fence='^(web/src/|web/vitest\.config\.ts$|e2e/design/|e2e/flows/|docs/v3/design-checks/|docs/v3/backlog/|docs/v3/audit/|changelog\.d/|scripts/verify-S193\.sh$)'
while IFS= read -r f; do
	[ -z "$f" ] && continue
	grep -qE "$fence" <<<"$f" || bad 6 "outside the fence: $f"
done < <(story_own_changed_files S193 "$BASE" .)
own_added="$(story_own_diff S193 "$BASE" --name-status --diff-filter=A -- scripts/verify-S193.sh)"
[ -n "$own_added" ] || [ -n "$(git ls-files --others --exclude-standard -- scripts/verify-S193.sh)" ] || bad 6 "scripts/verify-S193.sh was not created by S193"

report "verify-S193"
exit $?
