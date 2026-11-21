#!/usr/bin/env bash
# Grader for BACKLOG story S147 — design amendment: a Live marker (a glowing, slowly
# blinking red dot and "Live") replaces the "Fetched … ago" footer label (rule 18; S148 builds it).
# Contract: docs/v3/BACKLOG.md#verify-script-contract
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`).

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "shell-scoreboard A13 headed '(S147)' names what it adds/overrides/repeals, quotes the owner's 2026-11-16 words, draws the marker's two blink states, a live game page and the live scoreboard ending in it, and a page with no socket and no 'Fetched', at mobile and desktop, and says the blink's length, reduced motion, which pages open a socket, reconnecting and polling fallback, medium, and the marker's place in S141's footer of links"
check 2 "every open question in A13 is answered by the owner, quoted"
check 3 "A13's ratification record names who ratified, the date and quotes the owner's in-session go-ahead; its ## Manifest hashes exactly its own PNGs; D9 and the type table's meta row describe the ratified marker"
check 4 "backlog Status is done (story heading and Story status table)"
check 5 "no sealed shell-scoreboard file changed (RATIFIED.md and A1–A12 with their manifests)"
check 6 "S147 changed no file outside its fence (plus creating scripts/verify-S147.sh)"

V="docs/v3/visual"
S="shell-scoreboard"
DIR="$V/$S/amendments"
A="$DIR/A13.md"
# The commit S147 started from (HEAD when its grader was written).
BASE=dc399a3

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

if ! grep -qE '^# A13 .*\(S147\)$' "$A" 2>/dev/null; then
	bad 1 "no $A headed (S147)"
	bad 2 "no amendment, so no questions"
	bad 3 "no amendment, so no ratification record"
else
	# --- Check 1: the amendment's content ------------------------------------------------
	for l in Adds Overrides Repeals; do
		grep -qE "^\*\*$l:\*\*" "$A" || bad 1 "$A has no **$l:** line"
	done
	for h in Frames Decisions "Open questions" Ratification Manifest; do
		grep -qx "## $h" "$A" || bad 1 "$A has no ## $h"
	done
	section "$A" Decisions | grep -qF 'Remove the fetch label and replace it with a red dot and Live at the bottom of any page that has an active websocket' ||
		bad 1 "## Decisions does not quote the owner's 2026-11-16 words"
	frames_table=$(section "$A" Frames)
	for f in live-marker-scoreboard-live-mobile.png live-marker-scoreboard-live-desktop.png \
		live-marker-game-mobile.png live-marker-game-desktop.png \
		live-marker-scoreboard-quiet-mobile.png live-marker-scoreboard-quiet-desktop.png live-marker-states.png; do
		[ -f "$DIR/$f" ] || bad 1 "frame $f missing"
		echo "$frames_table" | grep -qF "\`$f\`" || bad 1 "$f not in ## Frames"
	done
	for f in $(own_frames); do
		echo "$frames_table" | grep -qF "\`$f\`" || bad 1 "$f is not listed in ## Frames"
	done
	row() { echo "$frames_table" | grep -F "\`$1\`"; }
	row live-marker-states.png | grep -qF 'Phase=Bright' && row live-marker-states.png | grep -qF 'Phase=Dim' ||
		bad 1 "the component frame's row does not name its Phase=Bright and Phase=Dim states"
	row live-marker-scoreboard-live-mobile.png | grep -qF '● Live' || bad 1 "the live scoreboard's row does not end in '● Live'"
	row live-marker-game-mobile.png | grep -qF '● Live' || bad 1 "the live game page's row does not end in '● Live'"
	row live-marker-scoreboard-live-desktop.png | grep -qF "● Live" || bad 1 "the live desktop scoreboard's row does not end in '● Live'"
	row live-marker-game-desktop.png | grep -qF "● Live" || bad 1 "the live desktop game page's row does not end in '● Live'"
	row live-marker-scoreboard-quiet-mobile.png | grep -qiE 'no (live )?websocket|no socket' ||
		bad 1 "the quiet scoreboard's row does not say the page has no live WebSocket"
	row live-marker-scoreboard-quiet-mobile.png | grep -qiE 'no .?Fetched' || bad 1 "the quiet scoreboard's row does not say its footer has no 'Fetched'"
	echo "$frames_table" | grep -qiE 'medium.*mobile footer|mobile footer.*medium' || bad 1 "## Frames does not say medium is the mobile footer"
	for l in "Marker" "Blink" "Reduced motion" "Which pages" "Reconnecting" "Polling" "Site footer" "No socket"; do
		[ -n "$(decision "$l")" ] || bad 1 "## Decisions has no '- **$l:**' bullet"
	done
	decision "Marker" | grep -qF 'Primary Light' && grep -qF '**Primary Light**' docs/v3/VISUAL-DESIGN.md || bad 1 "Marker: does not name the VISUAL-DESIGN red token (Primary Light)"
	decision "Blink" | grep -qE '[0-9.]+ ?(s|seconds?)\b' || bad 1 "Blink: does not say how long a blink takes"
	decision "Reduced motion" | grep -qiE 'not blink|no blink|does not blink|stays' || bad 1 "Reduced motion: does not say the marker stops blinking"
	decision "Which pages" | grep -qi 'game page' || bad 1 "Which pages: does not name a live game page"
	decision "Which pages" | grep -qi 'scoreboard' || bad 1 "Which pages: does not name the scoreboard"
	decision "Which pages" | grep -qi 'live window' || bad 1 "Which pages: does not tie the scoreboard's socket to a game in its live window"
	decision "Reconnecting" | grep -qiE 'hidden|hides|no marker|not shown' || bad 1 "Reconnecting: does not say what the marker does"
	decision "Polling" | grep -qiE 'hidden|hides|no marker|not shown' || bad 1 "Polling: does not say what the marker does once fallen back to polling"
	decision "Site footer" | grep -qF 'S141' || bad 1 "Site footer: does not name S141's footer of links"

	# --- Check 2: open questions answered, quoted ----------------------------------------
	oq=$(section "$A" "Open questions" | sed '/^[[:space:]]*$/d')
	if [ "$oq" != "None." ]; then
		qs=$(echo "$oq" | grep -cE '^[0-9]+\. ')
		[ "$qs" -gt 0 ] || bad 2 "## Open questions is neither 'None.' nor a numbered list"
		while IFS= read -r q; do
			[ -z "$q" ] && continue
			echo "$q" | grep -qE '\*\*Answered [0-9]{4}-[0-9]{2}-[0-9]{2}:\*\* \*"[^"]+"\*' ||
				bad 2 "unanswered or unquoted: $(echo "$q" | cut -c1-60)…"
		done <<< "$(echo "$oq" | grep -E '^[0-9]+\. ')"
	fi

	# --- Check 3: ratification record, manifest, VISUAL-DESIGN -----------------------------
	grep -qE '^Ratified by:[[:space:]]*[^[:space:]]' "$A" || bad 3 "no 'Ratified by:' line"
	grep -qE '^Date:[[:space:]]*[0-9]{4}-[0-9]{2}-[0-9]{2}[[:space:]]*$' "$A" || bad 3 "no 'Date: YYYY-MM-DD' line"
	grep -qE '^Go-ahead:[[:space:]]*".+"' "$A" || bad 3 "no quoted 'Go-ahead: \"…\"' line"
	grep -qiE 'Draft, not ratified|awaiting ratification' "$A" && bad 3 "$A still calls itself a draft"
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
	done <<< "$manifest"
	d9=$(grep -E '^\| D9 \|' docs/v3/VISUAL-DESIGN.md)
	echo "$d9" | grep -qF 'A13' || bad 3 "VISUAL-DESIGN D9 does not cite A13"
	echo "$d9" | grep -qE 'A13\]\([^)]*\), draft' && bad 3 "VISUAL-DESIGN D9 still cites A13 as a draft"
	grep -qF '| Meta (venue, date, fetched-at) |' docs/v3/VISUAL-DESIGN.md && bad 3 "VISUAL-DESIGN's type table still has 'Meta (venue, date, fetched-at)'"
fi

# --- Check 4: backlog Status is done -----------------------------------------------------
grep -qE '^\| [0-9]+ \| \[S147\].*\| `done` \|' docs/v3/BACKLOG.md ||
	bad 4 "S147 row in the Story status table is not \`done\`"
awk '/^### S147 —/{f=1;next} /^### S[0-9]/{f=0} f' docs/v3/BACKLOG.md |
	grep -qE '^\*\*Status:\*\* `done`$' ||
	bad 4 "S147 story heading Status is not \`done\`"

# --- Check 5: sealed files untouched ------------------------------------------------------
# core.quotepath=false: git otherwise prints a name with a non-ASCII character quoted
# and escaped, so it would never match a fence prefix (bug #87).
changed=$(GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.quotepath GIT_CONFIG_VALUE_0=false story_changed_files S147 "$BASE" .)
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
	[ "$a" = "$A" ] && continue
	printf '%s\n' "$changed" | grep -qxF "$a" && bad 5 "S147 changed an earlier amendment, $a"
	while IFS= read -r line; do
		[ -z "$line" ] && continue
		sum=${line%%  *}
		f=${line#*  }
		[ -f "$DIR/$f" ] && [ "$(shasum -a 256 "$DIR/$f" | cut -d' ' -f1)" != "$sum" ] &&
			bad 5 "$f sealed by $(basename "$a") changed"
	done <<< "$(section "$a" Manifest | grep -E '^[0-9a-f]{64}  ')"
done
printf '%s\n' "$changed" | grep -qxF "$RAT" && bad 5 "S147 changed $RAT"

# --- Check 6: fence -------------------------------------------------------------------------
while IFS= read -r f; do
	[ -z "$f" ] && continue
	case "$f" in
		docs/v3/visual/shell-scoreboard/amendments/* | docs/v3/VISUAL-DESIGN.md | docs/v3/FEATURES.md | docs/v3/ARCHITECTURE.md | \
			docs/v3/BACKLOG.md | docs/v3/backlog/* | docs/v3/AUDIT.md | docs/v3/audit.jsonl | docs/v3/INDEX.md | CHANGELOG.md | \
			scripts/verify-S147.sh) ;;
		*) bad 6 "outside the fence: $f" ;;
	esac
done <<< "$changed"
git cat-file -e "$BASE:scripts/verify-S147.sh" 2>/dev/null && bad 6 "scripts/verify-S147.sh existed before S147 (it may only be created)"

report "verify-S147"
exit $?
