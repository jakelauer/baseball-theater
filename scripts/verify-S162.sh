#!/usr/bin/env bash
# Grader for story S162: a design chore that makes Figma's shared scoreboard module agree with
# shell-scoreboard A7 (a scheduled row draws no slot box), recorded as a shell-scoreboard amendment
# headed "(S162)" and ratified by the owner (rule 18). A design story writes no code.
# Contract: frame note 00, "Verify-script contract". No network. No writes outside /tmp. Does its own
# checking (never `pnpm verify`).

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "a shell-scoreboard amendment headed '(S162)' records the edit to the shared components (Rich Scoreboard Module State=Scheduled 163:1612 with no slot box, probable pitchers beside each team as A7 draws them, the box's space empty; Modular Block State=Pre-Game, Occupant=Win Probability 71:17 and the Status pre-game variant removed or marked unused; the Room Menu pre-game variant keeping Videos · Plays · Box with no recap, quoting the owner), lists every frame its instances reach, exports one scheduled row at mobile and at desktop, and says the edit is a draft until ratified"
check 2 "the amendment says whether any scheduled row was drawn as a copy, that every such copy is now an instance, and asks the owner (an open question) if copies differed"
check 3 "the owner ratified it, quoted (Ratified by, Date, Go-ahead), it no longer calls itself a draft, every open question is answered and quoted, and its ## Manifest hashes exactly its own PNGs"
check 4 "S162's snapshot records Status done (story_snapshot_status)"
check 5 "no sealed shell-scoreboard file changed: RATIFIED.md and its PNGs, the other amendments and the PNGs their manifests seal"
check 6 "S162 changed no file outside its fence (shell-scoreboard amendments, docs/v3/backlog/, docs/v3/audit/, changelog.d/, plus creating scripts/verify-S162.sh) and nothing else under scripts/ or test/"

V="docs/v3/visual/shell-scoreboard"
DIR="$V/amendments"
# The commit S162 started from (origin/stage when its grader was written).
BASE=dc4f33df
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Lines of section "## <name>" in a file.
section() {
	awk -v h="## $2" '$0==h{f=1;next} /^## /{f=0} f' "$1"
}

# The body of the bullet "- **<label>:** …" in the amendment's ## Decisions (empty when absent).
decision() {
	section "$A" Decisions | awk -v l="- **$1:**" 'index($0, l)==1{print substr($0, length(l)+1)}' | sed 's/^[[:space:]]*//'
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

A=$(grep -lE '^# A[0-9]+ .*\(S162\)$' "$DIR"/A[0-9]*.md 2>/dev/null | head -1)

if [ -z "$A" ]; then
	bad 1 "no amendment in $DIR headed '(S162)'"
	bad 2 "no amendment, so no record of copies"
	bad 3 "no amendment, so no ratification record"
else
	# --- Check 1: the component edit, the frames it reaches, the exports, draft until ratified ---
	for l in Adds Overrides Repeals; do
		grep -qE "^\*\*$l:\*\*" "$A" || bad 1 "$A has no **$l:** line"
	done
	for h in Frames Decisions "Open questions" Ratification Manifest; do
		grep -qx "## $h" "$A" || bad 1 "$A has no ## $h"
	done
	grep -qF 'wqGKEFlvyxq0ObWZhRJdPF' "$A" || bad 1 "$A does not name the Figma file"

	sch=$(decision "Scheduled row")
	[ -n "$sch" ] || bad 1 "## Decisions has no '- **Scheduled row:**' bullet"
	echo "$sch" | grep -qF 'Rich Scoreboard Module' && echo "$sch" | grep -qF '163:1612' ||
		bad 1 "Scheduled row: does not name the Rich Scoreboard Module component (163:1612)"
	echo "$sch" | grep -qiE 'no slot box' || bad 1 "Scheduled row: does not say the scheduled row draws no slot box"
	echo "$sch" | grep -qF 'J. Steele (L)' && echo "$sch" | grep -qF '11-5, 3.12' ||
		bad 1 "Scheduled row: does not draw the probable pitchers as A7 does ('J. Steele (L)' over '11-5, 3.12')"
	echo "$sch" | grep -qiE "space .*(stays|left) empty|empty space" || bad 1 "Scheduled row: does not leave the box's space empty"
	echo "$sch" | grep -qiE 'instance' && echo "$sch" | grep -qiE 'not (the|any) frames?|never (a|the) frames?' ||
		bad 1 "Scheduled row: does not say the edit is to the component, not to frames"

	pg=$(decision "Pre-game slot variants")
	[ -n "$pg" ] || bad 1 "## Decisions has no '- **Pre-game slot variants:**' bullet"
	echo "$pg" | grep -qF 'Modular Block' && echo "$pg" | grep -qF '71:17' ||
		bad 1 "Pre-game slot variants: does not name Modular Block State=Pre-Game, Occupant=Win Probability (71:17)"
	echo "$pg" | grep -qiE 'Occupant=Status' || bad 1 "Pre-game slot variants: does not name the Status pre-game variant"
	echo "$pg" | grep -qiE 'removed|marked unused|unused' || bad 1 "Pre-game slot variants: does not say they are removed or marked unused"

	rm=$(decision "Room Menu")
	[ -n "$rm" ] || bad 1 "## Decisions has no '- **Room Menu:**' bullet"
	echo "$rm" | grep -qF 'Videos' && echo "$rm" | grep -qF 'Plays' && echo "$rm" | grep -qF 'Box' ||
		bad 1 "Room Menu: does not keep Videos · Plays · Box on the pre-game variant"
	echo "$rm" | grep -qiE 'no recap|recap .*hidden|hide recap' || bad 1 "Room Menu: does not keep the recap hidden"
	echo "$rm" | grep -qF 'Keep the links, but continue to hide recap' || bad 1 "Room Menu: does not quote the owner"

	fr=$(decision "Frames reached")
	[ -n "$fr" ] || bad 1 "## Decisions has no '- **Frames reached:**' bullet"
	for a in A7 A8 A9; do
		echo "$fr" | grep -qF "$a" || bad 1 "Frames reached: does not name $a's frames"
	done
	echo "$fr" | grep -qiE "agent's reading" || bad 1 "Frames reached: does not say it is the agent's reading"

	frames_table=$(section "$A" Frames)
	for w in mobile desktop; do
		f=$(echo "$frames_table" | grep -E "^\| \`[^\`]+-$w\.png\` \| $w \|" | head -1 | sed -E 's/^\| `([^`]+)`.*/\1/')
		if [ -z "$f" ]; then
			bad 1 "## Frames has no scheduled-row export paired with $w"
		else
			[ -f "$DIR/$f" ] || bad 1 "frame $f is listed but missing"
		fi
	done
	for f in $(own_frames); do
		echo "$frames_table" | grep -qF "\`$f\`" || bad 1 "$f is not listed in ## Frames"
	done

	grep -qiE 'draft until (it is )?ratified|a draft until' "$A" || bad 1 "$A does not say the edit is a draft until ratified"
	grep -qiE 'live (Figma )?file is (never|not) evidence' "$A" || bad 1 "$A does not say the live file is never evidence of what is ratified"

	# --- Check 2: copies made instances, differing copies asked ---------------------------------
	cp=$(decision "Copies")
	[ -n "$cp" ] || bad 2 "## Decisions has no '- **Copies:**' bullet"
	echo "$cp" | grep -qiE 'instance' || bad 2 "Copies: does not say the scheduled rows are instances"
	if echo "$cp" | grep -qiE 'copies differ(ed)?([^ ]| [^n])' && ! echo "$cp" | grep -qiE 'no copies differ|none differ|did not differ'; then
		section "$A" "Open questions" | grep -qiE 'cop(y|ies)' || bad 2 "Copies: copies differ but no open question asks the owner which stands"
	fi

	# --- Check 3: ratified, quoted, manifest ------------------------------------------------------
	grep -qE '^Ratified by:[[:space:]]*[^[:space:]]' "$A" || bad 3 "no 'Ratified by:' line"
	grep -qE '^Date:[[:space:]]*[0-9]{4}-[0-9]{2}-[0-9]{2}[[:space:]]*$' "$A" || bad 3 "no 'Date: YYYY-MM-DD' line"
	grep -qE '^Go-ahead:[[:space:]]*".+"' "$A" || bad 3 "no quoted 'Go-ahead: \"…\"' line"
	grep -qiE 'Draft, not ratified|awaiting ratification' "$A" && bad 3 "$A still calls itself a draft"
	oq=$(section "$A" "Open questions" | sed '/^[[:space:]]*$/d')
	if [ "$oq" != "None." ]; then
		[ "$(echo "$oq" | grep -cE '^[0-9]+\. ')" -gt 0 ] || bad 3 "## Open questions is neither 'None.' nor a numbered list"
		while IFS= read -r q; do
			[ -z "$q" ] && continue
			echo "$q" | grep -qE '\*\*Answered [0-9]{4}-[0-9]{2}-[0-9]{2}:\*\* \*".+"\*' ||
				bad 3 "unanswered or unquoted: $(echo "$q" | cut -c1-60)…"
		done <<<"$(echo "$oq" | grep -E '^[0-9]+\. ')"
	fi
	manifest=$(section "$A" Manifest | grep -E '^[0-9a-f]{64}  ')
	want=$(own_frames | sort)
	got=$(printf '%s\n' "$manifest" | sed -E 's/^[0-9a-f]{64}  //' | sed '/^$/d' | sort)
	[ -n "$want" ] && [ "$want" = "$got" ] || bad 3 "## Manifest does not list every frame of this amendment exactly once"
	while IFS= read -r line; do
		[ -z "$line" ] && continue
		sum=${line%%  *}
		f=${line#*  }
		[ -f "$DIR/$f" ] || {
			bad 3 "manifest names missing $f"
			continue
		}
		[ "$(shasum -a 256 "$DIR/$f" | cut -d' ' -f1)" = "$sum" ] || bad 3 "SHA-256 mismatch: $f"
	done <<<"$manifest"
fi

# --- Check 4: Status done ---------------------------------------------------------------------------
[ "$(story_snapshot_status S162)" = "done" ] || bad 4 "S162's snapshot does not record Status done"

# --- Check 5: sealed files untouched ----------------------------------------------------------------
story_own_changed_files S162 "$BASE" . >"$TMP/changed.txt"
grep -qxF "$V/RATIFIED.md" "$TMP/changed.txt" && bad 5 "S162 changed $V/RATIFIED.md"
while IFS= read -r line; do
	[ -z "$line" ] && continue
	sum=${line%%  *}
	f=${line#*  }
	[ -f "$V/$f" ] && [ "$(shasum -a 256 "$V/$f" | cut -d' ' -f1)" != "$sum" ] && bad 5 "sealed $f changed"
done <<<"$(section "$V/RATIFIED.md" Manifest | grep -E '^[0-9a-f]{64}  ')"
for a in "$DIR"/A[0-9]*.md; do
	[ -n "$A" ] && [ "$a" = "$A" ] && continue
	grep -qxF "$a" "$TMP/changed.txt" && bad 5 "S162 changed another amendment, $a"
	while IFS= read -r line; do
		[ -z "$line" ] && continue
		sum=${line%%  *}
		f=${line#*  }
		[ -f "$DIR/$f" ] && [ "$(shasum -a 256 "$DIR/$f" | cut -d' ' -f1)" != "$sum" ] &&
			bad 5 "$f sealed by $(basename "$a") changed"
	done <<<"$(section "$a" Manifest | grep -E '^[0-9a-f]{64}  ')"
done

# --- Check 6: fence -----------------------------------------------------------------------------------
grep -vE '^(docs/v3/visual/shell-scoreboard/amendments/|docs/v3/backlog/|docs/v3/audit/|changelog\.d/|scripts/verify-S162\.sh$)' "$TMP/changed.txt" >"$TMP/fence.txt"
[ -s "$TMP/fence.txt" ] && bad 6 "outside the fence: $(tr '\n' ' ' <"$TMP/fence.txt")"
grep -E '^(test/|scripts/)' "$TMP/changed.txt" | grep -vE '^scripts/verify-S162\.sh$' >"$TMP/test-dir.txt"
[ -s "$TMP/test-dir.txt" ] && bad 6 "changes under scripts/ or test/: $(tr '\n' ' ' <"$TMP/test-dir.txt")"
git cat-file -e "$BASE:scripts/verify-S162.sh" 2>/dev/null && bad 6 "scripts/verify-S162.sh existed before S162 (it may only be created)"

report "verify-S162"
exit $?
