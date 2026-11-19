#!/usr/bin/env bash
# Grader for BACKLOG story S141 — design amendment: the site footer and its ratified list of
# links and destinations (rule 18; S142 builds it). The amendment is shell-scoreboard A14.
# Contract: docs/v3/BACKLOG.md#verify-script-contract
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`).

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "shell-scoreboard A14 headed '(S141)' draws the footer at mobile, medium and desktop, on a game page, a short page, in the installed app and offline, and decides its columns, how they fold at mobile, that nothing but links is in it, every kind of page it shows on, the installed app, a short page, the 'Fetched' line gone, the Live marker at the start of the bottom line before 'baseball.theater' (agreeing with A13), the mark, the recap's 'Source: MLB', the offline footer and the other surfaces' frames"
check 2 "A14's ## Decisions holds the list of links (column, words, destination: a BT path, an https address or a mailto), the data link for a signed-in fan and a signed-out visitor, no 'how the site is made' link, and no dead links (each unbuilt BT path's story is on S142's Depends on, or that story's ACs add the link); FEATURES' Site footer row records the ratified list with the owner's words"
check 3 "every open question in A14 is answered by the owner, quoted"
check 4 "A14's ratification record names who ratified, the date and quotes the owner's go-ahead; its ## Manifest hashes exactly its own PNGs; VISUAL-DESIGN's old footer line is gone, the new one names A14, and the quiet-meta line no longer lists 'last fetched'"
check 5 "backlog Status is done (story heading and Story status table)"
check 6 "no sealed file changed on the four surfaces (RATIFIED.md and earlier amendments with their manifests)"
check 7 "S141 changed no file outside its fence (plus creating scripts/verify-S141.sh)"

V="docs/v3/visual"
DIR="$V/shell-scoreboard/amendments"
A="$DIR/A14.md"
A13="$DIR/A13.md"
FEATURES="docs/v3/FEATURES.md"
VD="docs/v3/VISUAL-DESIGN.md"
ROUTES="web/src/routes.tsx"
S142=$(ls docs/v3/backlog/stories/*/S142.md 2>/dev/null | head -1)
# The commit S141 started from (HEAD when its grader was written).
BASE=6c8bcb0

# Lines of section "## <name>" in a file.
section() {
	awk -v h="## $2" '$0==h{f=1;next} /^## /{f=0} f' "$1"
}

# The body of the bullet "- **<label>:** …" in a file's ## Decisions (empty when absent).
decision_in() {
	section "$1" Decisions | awk -v l="- **$2:**" 'index($0, l)==1{print substr($0, length(l)+1)}' | sed 's/^[[:space:]]*//'
}
decision() { decision_in "$A" "$1"; }

# Frames in shell-scoreboard amendments/ not claimed by another amendment's manifest.
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

# The link rows of the ## Decisions links table: "| Column | Link | Destination | … |" rows.
link_rows() {
	section "$A" Decisions | awk '/^\| Column \| Link \| Destination \|/{f=1;next} f && /^\|/{print;next} f{f=0}' | grep -vE '^\| *-+ *\|'
}

FRAMES="site-footer-mobile.png site-footer-medium.png site-footer-desktop.png site-footer-game-mobile.png site-footer-short-desktop.png site-footer-standalone-mobile.png site-footer-offline-mobile.png"

if ! grep -qE '^# A14 .*\(S141\)$' "$A" 2>/dev/null; then
	bad 1 "no $A headed (S141)"
	bad 2 "no amendment, so no list of links"
	bad 3 "no amendment, so no questions"
	bad 4 "no amendment, so no ratification record"
else
	# --- Check 1: the amendment's footer, where it shows, what goes ----------------------------
	for l in Adds Overrides Repeals; do
		grep -qE "^\*\*$l:\*\*" "$A" || bad 1 "$A has no **$l:** line"
	done
	for h in Frames Decisions "Open questions" Ratification Manifest; do
		grep -qx "## $h" "$A" || bad 1 "$A has no ## $h"
	done
	section "$A" Decisions | grep -qF 'just links - the story for this just needs to require a ratified list of links and destinations before it can be completed.' ||
		bad 1 "## Decisions does not quote the owner's 'just links' answer"
	frames_table=$(section "$A" Frames)
	for f in $FRAMES; do
		[ -f "$DIR/$f" ] || bad 1 "frame $f missing"
		echo "$frames_table" | grep -qF "\`$f\`" || bad 1 "$f not in ## Frames"
	done
	for f in $(own_frames); do
		echo "$frames_table" | grep -qF "\`$f\`" || bad 1 "$f is not listed in ## Frames"
	done
	row() { echo "$frames_table" | grep -F "\`$1\`"; }
	for w in mobile medium desktop; do
		row "site-footer-$w.png" | grep -qF "| $w |" || bad 1 "site-footer-$w.png is not paired with $w"
	done
	for l in "Columns" "Mobile" "Nothing else" "Where it shows" "Installed app" "Short page" "Fetched" "Live marker" "Mark" "Source: MLB" "Offline" "Other surfaces" "Your data"; do
		[ -n "$(decision "$l")" ] || bad 1 "## Decisions has no '- **$l:**' bullet"
	done
	decision "Mobile" | grep -qiE 'stack|one column|two columns|side by side' || bad 1 "Mobile: does not say how the columns fold"
	decision "Nothing else" | grep -qiE 'no copyright' || bad 1 "Nothing else: does not say there is no copyright line"
	for p in scoreboard "game page" Standings Search Settings "change log"; do
		decision "Where it shows" | grep -qiF "$p" || bad 1 "Where it shows: does not name the $p"
	done
	decision "Installed app" | grep -qiE 'shows|does not show|hidden' || bad 1 "Installed app: does not say whether it shows"
	decision "Short page" | grep -qiE 'bottom of the (screen|window)' || bad 1 "Short page: does not say it sits at the bottom of the screen"
	decision "Fetched" | grep -qiE 'every page' && decision "Fetched" | grep -qiE 'no age' ||
		bad 1 "Fetched: does not say the line goes from every page and no age is shown"
	# The marker sits first on the bottom line, before the mark — never after it (A13's Site footer).
	lm=$(decision "Live marker")
	echo "$lm" | grep -qF '● Live · baseball.theater' || bad 1 "Live marker: the bottom line is not '● Live · baseball.theater'"
	echo "$lm" | grep -qF 'baseball.theater · ● Live' && bad 1 "Live marker: puts the marker after the mark"
	echo "$lm" | grep -qF 'A13' || bad 1 "Live marker: does not name A13"
	if [ -f "$A13" ]; then
		decision_in "$A13" "Site footer" | grep -qiE "start of .*bottom line.*(in front of|before) the \"baseball.theater\"" ||
			bad 1 "A13's Site footer decision no longer puts the marker at the start of the bottom line, so A14 and A13 disagree"
	fi
	row site-footer-mobile.png | grep -qF '● Live · baseball.theater' || bad 1 "the mobile footer frame's bottom line is not '● Live · baseball.theater'"
	decision "Mark" | grep -qF 'baseball.theater' || bad 1 "Mark: does not say what happens to 'baseball.theater'"
	decision "Source: MLB" | grep -qiE 'recap' || bad 1 "Source: MLB: does not say what happens to the recap's source line"
	off=$(decision "Offline")
	echo "$off" | grep -qiE 'banner' || bad 1 "Offline: does not weigh the banner that already names the saved copy's time and age"
	# The verdict is the decision's first clause (up to its first ': ' or '. '); later sentences
	# may quote what another draft did. Keep-words are tested first, so "kept, no longer …" is a keep.
	off_verdict=$(echo "$off" | head -1 | sed -E 's/(: |\. ).*//')
	if echo "$off_verdict" | grep -qiE 'stays|kept|keeps'; then
		row site-footer-offline-mobile.png | grep -qF 'Offline · saved' || bad 1 "Offline keeps the 'saved … ago' line, but its frame does not draw it"
	elif echo "$off_verdict" | grep -qiE 'no longer|goes|dropped|removed'; then
		row site-footer-offline-mobile.png | grep -qF 'Offline · saved' && bad 1 "Offline drops the 'saved … ago' line, but its frame still draws it"
	else
		bad 1 "Offline: does not say whether the 'Offline · saved … ago' line stays or goes"
	fi
	decision "Other surfaces" | grep -qiE 'game-shell' && decision "Other surfaces" | grep -qiE 'game-rooms' &&
		decision "Other surfaces" | grep -qiE 'standings-search-settings' ||
		bad 1 "Other surfaces: does not say what happens to the game-shell, game-rooms and standings-search-settings footers"

	# --- Check 2: the list of links and destinations ------------------------------------------
	rows=$(link_rows)
	[ -n "$rows" ] || bad 2 "## Decisions has no '| Column | Link | Destination |' table of links"
	data_rows=0
	while IFS= read -r r; do
		[ -z "$r" ] && continue
		col=$(echo "$r" | awk -F'|' '{print $2}' | sed 's/^ *//;s/ *$//')
		words=$(echo "$r" | awk -F'|' '{print $3}' | sed 's/^ *//;s/ *$//')
		dest=$(echo "$r" | awk -F'|' '{print $4}' | sed 's/^ *//;s/ *$//' | tr -d '`')
		[ -n "$col" ] && [ -n "$words" ] || bad 2 "a link row has no column or words: $r"
		echo "$words" | grep -qiE 'technolog|how .* (made|built)|API' && bad 2 "the list holds a deferred 'how the site is made' link: $words"
		[ "$words" = "Your data" ] && data_rows=$((data_rows + 1))
		case "$dest" in
			/*)
				path=${dest%%#*}
				path=${path%%\?*}
				if grep -qF "path=\"$path\"" "$ROUTES"; then
					:
				else
					story=$(echo "$r" | grep -oE 'S[0-9]+' | head -1)
					if [ -z "$story" ]; then
						bad 2 "$words → $path is not a route BT serves and names no story that builds it"
					else
						note=$(ls docs/v3/backlog/stories/*/"$story".md 2>/dev/null | head -1)
						on_dep=0
						[ -n "$S142" ] && awk '/^depends_on:/{f=1;next} /^[a-z_]+:/{f=0} f' "$S142" | grep -qE "^ *- *(\"?\[\[$story\]\]\"?|$story)\$" && on_dep=1
						adds=0
						[ -n "$note" ] && awk '/^\*\*Acceptance criteria\*\*/{f=1;next} /^\*\*Notes/{f=0} f' "$note" | grep -qiE 'footer' && adds=1
						[ "$on_dep" = 1 ] || [ "$adds" = 1 ] ||
							bad 2 "$words → $path: $story is neither on S142's depends_on nor adds the footer link in its ACs (a dead link)"
					fi
				fi
				;;
			https://*) ;;
			mailto:*@*.*) ;;
			*) bad 2 "$words has no destination (a BT path, an https address or a mailto): '$dest'" ;;
		esac
	done <<< "$rows"
	[ "$data_rows" = 1 ] || bad 2 "the list has no single 'Your data' link"
	yd=$(decision "Your data")
	echo "$yd" | grep -qiE 'signed-in' && echo "$yd" | grep -qiE 'signed-out' ||
		bad 2 "Your data: does not say where it goes for a signed-in fan and for a signed-out visitor"
	frow=$(grep -E '^\| \*\*Site footer\*\* \|' "$FEATURES")
	echo "$frow" | grep -qF 'A14' || bad 2 "FEATURES' Site footer row does not name A14"
	goahead=$(grep -E '^Go-ahead:' "$A" | sed -E 's/^Go-ahead:[[:space:]]*"(.*)".*/\1/')
	[ -n "$goahead" ] && echo "$frow" | grep -qF "$goahead" || bad 2 "FEATURES' Site footer row does not quote the owner's ratification of the list"
	while IFS= read -r r; do
		[ -z "$r" ] && continue
		words=$(echo "$r" | awk -F'|' '{print $3}' | sed 's/^ *//;s/ *$//')
		echo "$frow" | grep -qF "$words" || bad 2 "FEATURES' Site footer row does not record the link '$words'"
	done <<< "$rows"

	# --- Check 3: open questions answered, quoted --------------------------------------------
	oq=$(section "$A" "Open questions" | sed '/^[[:space:]]*$/d')
	if [ "$oq" != "None." ]; then
		qs=$(echo "$oq" | grep -cE '^[0-9]+\. ')
		[ "$qs" -gt 0 ] || bad 3 "## Open questions is neither 'None.' nor a numbered list"
		while IFS= read -r q; do
			[ -z "$q" ] && continue
			echo "$q" | grep -qE '\*\*Answered [0-9]{4}-[0-9]{2}-[0-9]{2}:\*\* \*"[^"]+"\*' ||
				bad 3 "unanswered or unquoted: $(echo "$q" | cut -c1-60)…"
		done <<< "$(echo "$oq" | grep -E '^[0-9]+\. ')"
	fi

	# --- Check 4: ratification record, manifest, VISUAL-DESIGN ---------------------------------
	grep -qE '^Ratified by:[[:space:]]*[^[:space:]]' "$A" || bad 4 "no 'Ratified by:' line"
	grep -qE '^Date:[[:space:]]*[0-9]{4}-[0-9]{2}-[0-9]{2}[[:space:]]*$' "$A" || bad 4 "no 'Date: YYYY-MM-DD' line"
	grep -qE '^Go-ahead:[[:space:]]*".+"' "$A" || bad 4 "no quoted 'Go-ahead: \"…\"' line"
	grep -qiE 'Draft, not ratified|awaiting ratification' "$A" && bad 4 "$A still calls itself a draft"
	manifest=$(section "$A" Manifest | grep -E '^[0-9a-f]{64}  ')
	want=$(own_frames | sort)
	got=$(printf '%s\n' "$manifest" | sed -E 's/^[0-9a-f]{64}  //' | sed '/^$/d' | sort)
	[ -n "$want" ] && [ "$want" = "$got" ] || bad 4 "## Manifest does not list every frame of this amendment exactly once"
	while IFS= read -r line; do
		[ -z "$line" ] && continue
		sum=${line%%  *}
		f=${line#*  }
		[ -f "$DIR/$f" ] || {
			bad 4 "manifest names missing $f"
			continue
		}
		[ "$(shasum -a 256 "$DIR/$f" | cut -d' ' -f1)" = "$sum" ] || bad 4 "SHA-256 mismatch: $f"
	done <<< "$manifest"
fi
grep -qF '**Footer:** optional, quiet — copyright / report a problem. Not a second nav, not headlines.' "$VD" &&
	bad 4 "VISUAL-DESIGN still has the old footer line"
grep -E '^\*\*Footer:\*\*' "$VD" | grep -qF 'shell-scoreboard/amendments/A14.md' || bad 4 "VISUAL-DESIGN's footer line does not link A14"
qm=$(grep -E '^- Quiet meta:' "$VD")
[ -n "$qm" ] || bad 4 "VISUAL-DESIGN has no quiet-meta line"
echo "$qm" | grep -qi 'fetched' && bad 4 "VISUAL-DESIGN's quiet-meta line still lists 'last fetched', but A14 shows no age"

# --- Check 5: backlog Status is done -----------------------------------------------------
grep -qE '^\| [0-9]+ \| \[S141\].*\| `done` \|' docs/v3/BACKLOG.md ||
	bad 5 "S141 row in the Story status table is not \`done\`"
awk '/^### S141 —/{f=1;next} /^### S[0-9]/{f=0} f' docs/v3/BACKLOG.md |
	grep -qE '^\*\*Status:\*\* `done`$' ||
	bad 5 "S141 story heading Status is not \`done\`"

# --- Check 6: sealed files untouched ------------------------------------------------------
# core.quotepath=false: git otherwise prints a name with a non-ASCII character quoted
# and escaped, so it would never match a fence prefix (bug #87).
changed=$(GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.quotepath GIT_CONFIG_VALUE_0=false story_changed_files S141 "$BASE" .)
for s in shell-scoreboard game-shell game-rooms standings-search-settings; do
	RAT="$V/$s/RATIFIED.md"
	if [ -f "$RAT" ]; then
		while IFS= read -r line; do
			[ -z "$line" ] && continue
			sum=${line%%  *}
			f=${line#*  }
			[ -f "$V/$s/$f" ] || {
				bad 6 "sealed $s/$f missing"
				continue
			}
			[ "$(shasum -a 256 "$V/$s/$f" | cut -d' ' -f1)" = "$sum" ] || bad 6 "sealed $s/$f changed"
		done <<< "$(section "$RAT" Manifest | grep -E '^[0-9a-f]{64}  ')"
	else
		bad 6 "$RAT missing"
	fi
	printf '%s\n' "$changed" | grep -qxF "$RAT" && bad 6 "S141 changed $RAT"
	for a in "$V/$s/amendments"/A[0-9]*.md; do
		[ "$a" = "$A" ] && continue
		# A13 is S147's draft, not sealed until it is ratified; S141 still leaves it to S147.
		printf '%s\n' "$changed" | grep -qxF "$a" && bad 6 "S141 changed another amendment, $a"
		while IFS= read -r line; do
			[ -z "$line" ] && continue
			sum=${line%%  *}
			f=${line#*  }
			[ -f "$V/$s/amendments/$f" ] && [ "$(shasum -a 256 "$V/$s/amendments/$f" | cut -d' ' -f1)" != "$sum" ] &&
				bad 6 "$s/amendments/$f sealed by $(basename "$a") changed"
		done <<< "$(section "$a" Manifest | grep -E '^[0-9a-f]{64}  ')"
	done
done

# --- Check 7: fence -------------------------------------------------------------------------
while IFS= read -r f; do
	[ -z "$f" ] && continue
	case "$f" in
		docs/v3/visual/shell-scoreboard/amendments/* | docs/v3/visual/game-shell/amendments/* | docs/v3/visual/game-rooms/amendments/* | \
			docs/v3/visual/standings-search-settings/amendments/* | docs/v3/VISUAL-DESIGN.md | docs/v3/FEATURES.md | \
			docs/v3/BACKLOG.md | docs/v3/backlog/* | docs/v3/AUDIT.md | docs/v3/audit.jsonl | docs/v3/INDEX.md | CHANGELOG.md | \
			scripts/verify-S141.sh) ;;
		*) bad 7 "outside the fence: $f" ;;
	esac
done <<< "$changed"
git cat-file -e "$BASE:scripts/verify-S141.sh" 2>/dev/null && bad 7 "scripts/verify-S141.sh existed before S141 (it may only be created)"

report "verify-S141"
exit $?
