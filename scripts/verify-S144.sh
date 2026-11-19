#!/usr/bin/env bash
# Grader for BACKLOG story S144 — design amendment: a video's play link moves onto
# the card's meta line, as a red "Play" (rule 18; S145 builds it).
# Contract: docs/v3/BACKLOG.md#verify-script-contract
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`).

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "game-shell has its next free amendments/A<N>.md headed '(S144)', naming what it adds/overrides/repeals, with ## Frames, ## Decisions (the owner's 2026-11-10 words quoted), ## Open questions = None., and a SHA-256 manifest of exactly its own frames"
check 2 "frames of the Videos room's cards in grid and list at mobile, medium and desktop, named <screen>[-<state>]-<pairing>.png and listed in ## Frames, which says each shows a clip with a play and one without"
check 3 "## Decisions says which part of the meta line is the link, what the rest of the line reads, names the red as a VISUAL-DESIGN colour token, the link's hover and focus look, the line for another or missing kind and for no date, that a clip with no play keeps 'Highlight · Sep 5, 2026' (recap and condensed keep their word), that the rest of the card is unchanged, how a touch screen chooses the play, and where else the change applies (the player's overlay row, Search)"
check 4 "the amendment's ratification record names who ratified, the date, and quotes the owner's in-session go-ahead"
check 5 "no sealed game-shell file changed (RATIFIED.md's manifest and every earlier amendment's manifest still verify; S144 changed neither RATIFIED.md nor A1–A5)"
check 6 "S144 changed no file outside its fence (docs/v3/visual/game-shell/amendments/, docs/v3/VISUAL-DESIGN.md, docs/v3/BACKLOG.md, docs/v3/backlog/, docs/v3/AUDIT.md, docs/v3/audit.jsonl, docs/v3/INDEX.md, CHANGELOG.md, plus creating scripts/verify-S144.sh)"
check 7 "backlog Status is done (story heading and Story status table)"

V="docs/v3/visual"
S="game-shell"
DIR="$V/$S/amendments"
# The commit S144 started from (HEAD when its grader was written).
BASE=701e5db

# Lines of section "## <name>" in a file.
section() {
	awk -v h="## $2" '$0==h{f=1;next} /^## /{f=0} f' "$1"
}

# The body of the bullet "- **<label>:** …" in ## Decisions (empty when absent).
decision() {
	section "$A" Decisions | awk -v l="- **$1:**" 'index($0, l)==1{print substr($0, length(l)+1)}' | sed 's/^[[:space:]]*//'
}

# Frames in amendments/ not claimed by another amendment's manifest.
own_frames() {
	local f a other
	for f in $(cd "$DIR" && ls *.png 2>/dev/null); do
		other=0
		for a in "$DIR"/A[0-9]*.md; do
			[ "$a" = "$A" ] && continue
			section "$a" Manifest | grep -qE "^[0-9a-f]{64}  $f\$" && other=1
		done
		[ "$other" = 0 ] && echo "$f"
	done
}

A=$(grep -lE '^# A[0-9]+ .*\(S144\)$' "$DIR"/A[0-9]*.md 2>/dev/null | head -1)

if [ -z "$A" ]; then
	bad 1 "no $DIR/A<N>.md headed (S144)"
	bad 2 "no amendment, so no frames"
	bad 3 "no amendment, so no decisions"
	bad 4 "no amendment, so no ratification record"
else
	# --- Check 1: the amendment file and its sections -------------------------------
	n=$(basename "$A" .md | tr -d 'A')
	for ((i = 1; i < n; i++)); do [ -f "$DIR/A$i.md" ] || bad 1 "$A is not the next free number (A$i.md missing)"; done
	[ -f "$DIR/A$((n + 1)).md" ] && bad 1 "$A is not the newest amendment (A$((n + 1)).md exists)"
	grep -qiE '^\*\*(Adds|Overrides|Repeals)' "$A" ||
		bad 1 "$A does not name what it adds, overrides or repeals (**Adds** / **Overrides** / **Repeals** lines)"
	for h in Frames Decisions "Open questions" Manifest; do
		grep -qx "## $h" "$A" || bad 1 "$A has no ## $h"
	done
	section "$A" Decisions | grep -qF 'Move hte play link to the 2nd line' ||
		bad 1 "## Decisions does not quote the owner's 2026-11-10 words"
	oq=$(section "$A" "Open questions" | sed '/^[[:space:]]*$/d')
	[ "$oq" = "None." ] || bad 1 "## Open questions body is not exactly 'None.'"
	manifest=$(section "$A" Manifest | grep -E '^[0-9a-f]{64}  ')
	want=$(own_frames | sort)
	got=$(printf '%s\n' "$manifest" | sed -E 's/^[0-9a-f]{64}  //' | sed '/^$/d' | sort)
	[ -n "$want" ] && [ "$want" = "$got" ] || bad 1 "## Manifest does not list every frame of this amendment exactly once"
	while IFS= read -r line; do
		[ -z "$line" ] && continue
		sum=${line%%  *}
		f=${line#*  }
		[ -f "$DIR/$f" ] || {
			bad 1 "manifest names missing $f"
			continue
		}
		[ "$(shasum -a 256 "$DIR/$f" | cut -d' ' -f1)" = "$sum" ] || bad 1 "SHA-256 mismatch: $f"
	done <<< "$manifest"

	# --- Check 2: required frames, naming, Frames table ------------------------------
	frames_table=$(section "$A" Frames)
	for mode in grid list; do
		for p in mobile medium desktop; do
			f="game-videos-$mode-playmeta-$p.png"
			[ -f "$DIR/$f" ] || bad 2 "frame $f missing"
			row=$(echo "$frames_table" | grep -F "\`$f\`")
			[ -n "$row" ] || bad 2 "$f not in ## Frames"
		done
	done
	for f in $(own_frames); do
		echo "$f" | grep -qE '^[a-z]+(-[a-z]+)*-(mobile|medium|desktop)\.png$' || bad 2 "$f breaks <screen>[-<state>]-<pairing>.png"
		echo "$frames_table" | grep -qF "\`$f\`" || bad 2 "$f not in ## Frames"
	done
	echo "$frames_table" | grep -qiE 'no play' || bad 2 "## Frames does not say the frames show a clip with no play"
	echo "$frames_table" | grep -qF 'Play ·' || bad 2 "## Frames does not show a clip with a play's 'Play ·' meta line"

	# --- Check 3: the decisions AC 1 asks the amendment to make ------------------------
	for l in "Link" "Rest of the line" "Red" "Hover and focus" "Other kinds" "No date" "No play" "Rest of the card" "Touch" "Where else"; do
		[ -n "$(decision "$l")" ] || bad 3 "## Decisions has no '- **$l:**' bullet"
	done
	decision "Link" | grep -qiE 'word|whole line|the line' || bad 3 "Link: does not say whether the word or the line is the link"
	red=$(decision "Red")
	tok_ok=0
	for t in "Primary Light" "Primary"; do
		if echo "$red" | grep -qF "$t" && grep -qF "**$t**" docs/v3/VISUAL-DESIGN.md; then tok_ok=1; break; fi
	done
	[ "$tok_ok" = 1 ] || bad 3 "Red: does not name a red colour token from VISUAL-DESIGN (Primary Light or Primary)"
	decision "Hover and focus" | grep -qi hover || bad 3 "Hover and focus: does not describe hover"
	decision "Hover and focus" | grep -qi focus || bad 3 "Hover and focus: does not describe focus"
	decision "Other kinds" | grep -qF 'Video' || bad 3 "Other kinds: does not say what a 'Video'-kind clip with a play reads"
	decision "Other kinds" | grep -qiE 'missing|no kind' || bad 3 "Other kinds: does not say what a clip with a play and no kind reads"
	decision "No date" | grep -qiE 'date' || bad 3 "No date: does not cover a clip with no date"
	decision "No play" | grep -qF 'Highlight · Sep 5, 2026' || bad 3 "No play: does not keep 'Highlight · Sep 5, 2026'"
	decision "No play" | grep -qiE 'recap|condensed' || bad 3 "No play: does not say a recap or condensed game keeps its word"
	for w in still duration title; do
		decision "Rest of the card" | grep -qi "$w" || bad 3 "Rest of the card: does not keep the $w"
	done
	decision "Touch" | grep -qiE 'tap|touch' || bad 3 "Touch: does not say how a touch screen chooses the play"
	decision "Where else" | grep -qiE 'player|overlay' || bad 3 "Where else: does not settle the floating player's overlay row"
	decision "Where else" | grep -qi 'search' || bad 3 "Where else: does not settle Search's cards"

	# --- Check 4: ratification record ---------------------------------------------------
	grep -qE '^Ratified by:[[:space:]]*[^[:space:]]' "$A" || bad 4 "no 'Ratified by:' line"
	grep -qE '^Date:[[:space:]]*[0-9]{4}-[0-9]{2}-[0-9]{2}[[:space:]]*$' "$A" || bad 4 "no 'Date: YYYY-MM-DD' line"
	grep -qE '^Go-ahead:[[:space:]]*".+"' "$A" || bad 4 "no quoted 'Go-ahead: \"…\"' line"
fi

# --- Check 5: sealed files untouched --------------------------------------------------
# core.quotepath=false: git otherwise prints a name with a non-ASCII character quoted
# and escaped, so it would never match a fence prefix (bug #87).
changed=$(GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.quotepath GIT_CONFIG_VALUE_0=false story_changed_files S144 "$BASE" .)
RAT="$V/$S/RATIFIED.md"
if [ -f "$RAT" ]; then
	while IFS= read -r line; do
		[ -z "$line" ] && continue
		sum=${line%%  *}
		f=${line#*  }
		[ -f "$V/$S/$f" ] || {
			bad 5 "sealed $f missing"
			continue
		}
		[ "$(shasum -a 256 "$V/$S/$f" | cut -d' ' -f1)" = "$sum" ] || bad 5 "sealed $f changed"
	done <<< "$(section "$RAT" Manifest | grep -E '^[0-9a-f]{64}  ')"
else
	bad 5 "$RAT missing"
fi
for a in "$DIR"/A[0-9]*.md; do
	[ "$a" = "${A:-}" ] && continue
	printf '%s\n' "$changed" | grep -qxF "$a" && bad 5 "S144 changed an earlier amendment, $a"
	while IFS= read -r line; do
		[ -z "$line" ] && continue
		sum=${line%%  *}
		f=${line#*  }
		[ -f "$DIR/$f" ] && [ "$(shasum -a 256 "$DIR/$f" | cut -d' ' -f1)" != "$sum" ] &&
			bad 5 "$f sealed by $(basename "$a") changed"
	done <<< "$(section "$a" Manifest | grep -E '^[0-9a-f]{64}  ')"
done
printf '%s\n' "$changed" | grep -qxF "$RAT" && bad 5 "S144 changed $RAT"

# --- Check 6: fence ---------------------------------------------------------------------
while IFS= read -r f; do
	[ -z "$f" ] && continue
	case "$f" in
		docs/v3/visual/game-shell/amendments/* | docs/v3/VISUAL-DESIGN.md | docs/v3/BACKLOG.md | docs/v3/backlog/* | \
			docs/v3/AUDIT.md | docs/v3/audit.jsonl | docs/v3/INDEX.md | CHANGELOG.md | scripts/verify-S144.sh) ;;
		*) bad 6 "outside the fence: $f" ;;
	esac
done <<< "$changed"
git cat-file -e "$BASE:scripts/verify-S144.sh" 2>/dev/null && bad 6 "scripts/verify-S144.sh existed before S144 (it may only be created)"

# --- Check 7: backlog Status is done ---------------------------------------------------
grep -qE '^\| [0-9]+ \| \[S144\].*\| `done` \|' docs/v3/BACKLOG.md ||
	bad 7 "S144 row in the Story status table is not \`done\`"
awk '/^### S144 —/{f=1;next} /^### S[0-9]/{f=0} f' docs/v3/BACKLOG.md |
	grep -qE '^\*\*Status:\*\* `done`$' ||
	bad 7 "S144 story heading Status is not \`done\`"

report "verify-S144"
exit $?
