#!/usr/bin/env bash
# Grader for story S192: a design story that amends shell-scoreboard A9's after-update pointer on game
# pages at mobile and medium widths, where there is no menu button to aim at: the "Update complete"
# notice is tappable and opens the change log in a modal over the game page (owner, 2026-11-23: "Open
# the changelog in a modal on click", confirmed "Yes, that reading"). Recorded as a shell-scoreboard
# amendment headed "(S192)" and ratified by the owner (rule 18). A design story writes no code.
# Contract: frame note 00, "Verify-script contract". No network. No writes outside /tmp. Does its own
# checking (never `pnpm verify`).

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "S192's story text carries the **Owner answer:** line quoting the owner's 2026-11-23 confirmation ('Yes, that reading'), and the amendment quotes it and the answer it confirms ('Open the changelog in a modal on click')"
check 2 "a shell-scoreboard amendment headed '(S192)' draws, at mobile and medium on a game page, the notice shown, the change log open in a modal over the game page, and the modal's loading, empty and error states (each frame exported and listed), and says how the modal closes"
check 3 "the amendment says it applies to game pages at mobile and medium widths only, that every other page, desktop included, keeps A9's pointer as built, and which of A9's other rules (never with the update notice, ten seconds, once per release) hold or change"
check 4 "shared pieces are components: the amendment names the notice and the modal as Figma components placed as instances, and the modal reuses A9's change log page components (changelog-body 763:17115, changelog-heading 763:17006) rather than redrawing them"
check 5 "the owner ratified it, quoted (Ratified by, Date, Go-ahead), it no longer calls itself a draft, every open question is answered and quoted, and its ## Manifest hashes exactly its own PNGs"
check 6 "S192's snapshot records Status done (story_snapshot_status)"
check 7 "no sealed shell-scoreboard file changed: RATIFIED.md and its PNGs, the other amendments and the PNGs their manifests seal"
check 8 "S192 changed no file outside its fence (shell-scoreboard amendments, docs/v3/VISUAL-DESIGN.md, docs/v3/FEATURES.md, docs/v3/backlog/, docs/v3/audit/, changelog.d/, plus creating scripts/verify-S192.sh) and nothing else under scripts/ or test/"

V="docs/v3/visual/shell-scoreboard"
DIR="$V/amendments"
# The commit S192 started from (origin/stage when its grader was written).
BASE=30cf9561
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Lines of section "## <name>" in a file.
section() {
	awk -v h="## $2" '$0==h{f=1;next} /^## /{f=0} f' "$1"
}

# The body of the bullet "- **<label>:** …" in the amendment's ## Rules (empty when absent).
rule() {
	section "$A" Rules | awk -v l="- **$1:**" 'index($0, l)==1{print substr($0, length(l)+1)}' | sed 's/^[[:space:]]*//'
}

# PNGs in the amendments folder that no other amendment's manifest seals.
own_frames() {
	local f a other
	for f in $(cd "$DIR" && ls ./*.png 2>/dev/null | sed 's|^\./||'); do
		other=0
		for a in "$DIR"/A[0-9]*.md; do
			[ "$a" = "$A" ] && continue
			section "$a" Manifest | grep -qE "^[0-9a-f]{64}  $f\$" && other=1
		done
		[ "$other" = 0 ] && echo "$f"
	done
}

# --- Check 1: the owner's reading is settled ---------------------------------------------------------
node scripts/backlog-vault/text-records.ts newest S192 >"$TMP/story.md" 2>/dev/null || bad 1 "no text record for S192"
grep -E '^\*\*Owner answer:\*\*' "$TMP/story.md" | grep -qF 'Yes, that reading' ||
	bad 1 "S192's story text has no **Owner answer:** line quoting 'Yes, that reading'"

A=$(grep -lE '^# A[0-9]+ .*\(S192\)$' "$DIR"/A[0-9]*.md 2>/dev/null | head -1)

if [ -z "$A" ]; then
	bad 1 "no amendment in $DIR headed '(S192)'"
	bad 2 "no amendment, so no frames"
	bad 3 "no amendment, so no scope"
	bad 4 "no amendment, so no components"
	bad 5 "no amendment, so no ratification record"
else
	grep -qF 'Yes, that reading' "$A" || bad 1 "$A does not quote the owner's confirmation 'Yes, that reading'"
	grep -qF 'Open the changelog in a modal on click' "$A" || bad 1 "$A does not quote the answer 'Open the changelog in a modal on click'"

	# --- Check 2: the frames, at mobile and medium, in each state ------------------------------------
	for l in Adds Overrides Repeals; do
		grep -qE "^\*\*$l:\*\*" "$A" || bad 2 "$A has no **$l:** line"
	done
	for h in Frames Rules Components Decisions "Open questions" Ratification Manifest; do
		grep -qx "## $h" "$A" || bad 2 "$A has no ## $h"
	done
	grep -qF 'wqGKEFlvyxq0ObWZhRJdPF' "$A" || bad 2 "$A does not name the Figma file"
	frames_table=$(section "$A" Frames)
	for state in notice changelog changelog-loading changelog-empty changelog-error; do
		for w in mobile medium; do
			f="game-updated-$state-$w.png"
			echo "$frames_table" | grep -qE "^\| \`$f\` \| $w \|" || bad 2 "## Frames has no \`$f\` row paired with $w"
			[ -f "$DIR/$f" ] || bad 2 "frame $f is missing"
		done
	done
	for f in $(own_frames); do
		echo "$frames_table" | grep -qF "\`$f\`" || bad 2 "$f is not listed in ## Frames"
	done
	for l in "The notice" "The modal" "How it closes"; do
		[ -n "$(rule "$l")" ] || bad 2 "## Rules has no '- **$l:**' bullet"
	done
	rule "The notice" | grep -qiE 'tap' || bad 2 "The notice: does not say the notice is tapped to open the change log"
	rule "The modal" | grep -qiE 'over the game page' || bad 2 "The modal: does not say the change log opens over the game page"
	rule "How it closes" | grep -qF '✕' && rule "How it closes" | grep -qiE 'back' ||
		bad 2 "How it closes: does not say how the modal closes (its ✕, and Back)"

	# --- Check 3: where it applies, and A9's other rules ---------------------------------------------
	wh=$(rule "Where it applies")
	[ -n "$wh" ] || bad 3 "## Rules has no '- **Where it applies:**' bullet"
	echo "$wh" | grep -qiE 'game page' && echo "$wh" | grep -qiE 'mobile' && echo "$wh" | grep -qiE 'medium' ||
		bad 3 "Where it applies: does not name game pages at mobile and medium"
	echo "$wh" | grep -qiE 'every other page' && echo "$wh" | grep -qiE 'desktop' && echo "$wh" | grep -qF "A9" ||
		bad 3 "Where it applies: does not say every other page, desktop included, keeps A9's pointer"
	echo "$wh" | grep -qF 'On game pages (phone/tablet)' || bad 3 "Where it applies: does not quote the owner's 'On game pages (phone/tablet)'"
	ar=$(rule "A9's other rules")
	[ -n "$ar" ] || bad 3 "## Rules has no \"- **A9's other rules:**\" bullet"
	echo "$ar" | grep -qiE 'update notice' || bad 3 "A9's other rules: does not say whether 'never with the update notice' holds"
	echo "$ar" | grep -qiE '10 seconds|ten seconds' || bad 3 "A9's other rules: does not say whether the ten seconds hold"
	echo "$ar" | grep -qiE 'once (per|a|for that) release|per release' || bad 3 "A9's other rules: does not say whether 'once per release' holds"

	# --- Check 4: components -------------------------------------------------------------------------
	cs=$(section "$A" Components)
	echo "$cs" | grep -qiE 'instance' || bad 4 "## Components does not say the shared pieces are placed as instances"
	echo "$cs" | grep -qF 'after-update-pointer' || bad 4 "## Components does not name the notice's component (after-update-pointer)"
	echo "$cs" | grep -qiE '`changelog-modal`' || bad 4 "## Components does not name the modal's component (changelog-modal)"
	echo "$cs" | grep -qF 'changelog-body' && echo "$cs" | grep -qF '763:17115' ||
		bad 4 "## Components does not reuse A9's changelog-body (763:17115) inside the modal"
	echo "$cs" | grep -qF 'changelog-heading' && echo "$cs" | grep -qF '763:17006' ||
		bad 4 "## Components does not reuse A9's changelog-heading (763:17006)"
	grep -qiE 'live (Figma )?file is (never|not) evidence' "$A" || bad 4 "$A does not say the live file is never evidence of what is ratified"

	# --- Check 5: ratified, quoted, manifest ---------------------------------------------------------
	grep -qE '^Ratified by:[[:space:]]*[^[:space:]]' "$A" || bad 5 "no 'Ratified by:' line"
	grep -qE '^Date:[[:space:]]*[0-9]{4}-[0-9]{2}-[0-9]{2}[[:space:]]*$' "$A" || bad 5 "no 'Date: YYYY-MM-DD' line"
	grep -qE '^Go-ahead:[[:space:]]*".+"' "$A" || bad 5 "no quoted 'Go-ahead: \"…\"' line"
	grep -qiE 'Draft, not ratified|awaiting ratification' "$A" && bad 5 "$A still calls itself a draft"
	oq=$(section "$A" "Open questions" | sed '/^[[:space:]]*$/d')
	if [ "$oq" != "None." ]; then
		[ "$(echo "$oq" | grep -cE '^[0-9]+\. ')" -gt 0 ] || bad 5 "## Open questions is neither 'None.' nor a numbered list"
		while IFS= read -r q; do
			[ -z "$q" ] && continue
			echo "$q" | grep -qE '\*\*Answered [0-9]{4}-[0-9]{2}-[0-9]{2}:\*\* \*".+"\*' ||
				bad 5 "unanswered or unquoted: $(echo "$q" | cut -c1-60)…"
		done <<<"$(echo "$oq" | grep -E '^[0-9]+\. ')"
	fi
	manifest=$(section "$A" Manifest | grep -E '^[0-9a-f]{64}  ')
	want=$(own_frames | sort)
	got=$(printf '%s\n' "$manifest" | sed -E 's/^[0-9a-f]{64}  //' | sed '/^$/d' | sort)
	[ -n "$want" ] && [ "$want" = "$got" ] || bad 5 "## Manifest does not list every frame of this amendment exactly once"
	while IFS= read -r line; do
		[ -z "$line" ] && continue
		sum=${line%%  *}
		f=${line#*  }
		[ -f "$DIR/$f" ] || {
			bad 5 "manifest names missing $f"
			continue
		}
		[ "$(shasum -a 256 "$DIR/$f" | cut -d' ' -f1)" = "$sum" ] || bad 5 "SHA-256 mismatch: $f"
	done <<<"$manifest"
fi

# --- Check 6: Status done ---------------------------------------------------------------------------
[ "$(story_snapshot_status S192)" = "done" ] || bad 6 "S192's snapshot does not record Status done"

# --- Check 7: sealed files untouched ----------------------------------------------------------------
story_own_changed_files S192 "$BASE" . >"$TMP/changed.txt"
grep -qxF "$V/RATIFIED.md" "$TMP/changed.txt" && bad 7 "S192 changed $V/RATIFIED.md"
while IFS= read -r line; do
	[ -z "$line" ] && continue
	sum=${line%%  *}
	f=${line#*  }
	[ -f "$V/$f" ] && [ "$(shasum -a 256 "$V/$f" | cut -d' ' -f1)" != "$sum" ] && bad 7 "sealed $f changed"
done <<<"$(section "$V/RATIFIED.md" Manifest | grep -E '^[0-9a-f]{64}  ')"
for a in "$DIR"/A[0-9]*.md; do
	[ -n "${A:-}" ] && [ "$a" = "$A" ] && continue
	grep -qxF "$a" "$TMP/changed.txt" && bad 7 "S192 changed another amendment, $a"
	while IFS= read -r line; do
		[ -z "$line" ] && continue
		sum=${line%%  *}
		f=${line#*  }
		[ -f "$DIR/$f" ] && [ "$(shasum -a 256 "$DIR/$f" | cut -d' ' -f1)" != "$sum" ] &&
			bad 7 "$f sealed by $(basename "$a") changed"
	done <<<"$(section "$a" Manifest | grep -E '^[0-9a-f]{64}  ')"
done

# --- Check 8: fence -----------------------------------------------------------------------------------
grep -vE '^(docs/v3/visual/shell-scoreboard/amendments/|docs/v3/VISUAL-DESIGN\.md$|docs/v3/FEATURES\.md$|docs/v3/backlog/|docs/v3/audit/|changelog\.d/|scripts/verify-S192\.sh$)' "$TMP/changed.txt" >"$TMP/fence.txt"
[ -s "$TMP/fence.txt" ] && bad 8 "outside the fence: $(tr '\n' ' ' <"$TMP/fence.txt")"
grep -E '^(test/|scripts/)' "$TMP/changed.txt" | grep -vE '^scripts/verify-S192\.sh$' >"$TMP/test-dir.txt"
[ -s "$TMP/test-dir.txt" ] && bad 8 "changes under scripts/ or test/: $(tr '\n' ' ' <"$TMP/test-dir.txt")"
git cat-file -e "$BASE:scripts/verify-S192.sh" 2>/dev/null && bad 8 "scripts/verify-S192.sh existed before S192 (it may only be created)"

report "verify-S192"
exit $?
