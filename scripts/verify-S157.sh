#!/usr/bin/env bash
# Grader for story S157 — design amendment: a status marker that says a game is suspended
# (MLB `T`/`U`) or in an in-game delay (MLB `I`, e.g. `IR` "Delayed: Rain"), on the game
# page's top bar and as a scoreboard row (rule 18; a build story builds it).
# Contract: docs/v3/backlog/frame/00 (Verify-script contract).
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`).

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "AC 1: game-shell A7 headed '(S157)' draws, at mobile and desktop, a suspended and a delayed game on the top bar and as scoreboard rows beside an in-progress game, and (owner, 2026-11-22, Q1) a delayed start pre-game, from one component set with a variant per state placed as instances; it names the MLB codes each state covers, what the marker shows once a suspended game resumes, and asks whether a delayed start (MLB P) gets the marker"
check 2 "AC 2: every open question in A7 is answered by the owner, quoted"
check 3 "AC 3: A7's ratification record names who ratified, the date and quotes the owner's go-ahead; its ## Manifest hashes exactly its own PNGs; a build story created by S157 names S157 as its design, and FEATURES' Game status marker row names it"
check 4 "AC 4: S157's snapshot records the status done"
check 5 "no sealed game-shell or shell-scoreboard file changed (RATIFIED.md and the ratified amendments with their manifests)"
check 6 "S157 changed no file outside its fence (plus creating scripts/verify-S157.sh, its own records and the build story's create record)"

V="docs/v3/visual"
DIR="$V/game-shell/amendments"
A="$DIR/A7.md"
# The commit S157 started from (HEAD when its grader was written).
BASE=dc4f33df

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
	for f in $(cd "$DIR" && ls ./*.png 2>/dev/null | sed 's|^\./||'); do
		other=0
		for a in "$DIR"/A[0-9]*.md; do
			[ "$a" = "$A" ] && continue
			section "$a" Manifest | grep -qE "^[0-9a-f]{64}  $f\$" && other=1
		done
		[ "$other" = 0 ] && echo "$f"
	done
}

FRAMES=(status-marker-states.png
	status-marker-game-live-mobile.png status-marker-game-live-desktop.png
	status-marker-game-suspended-mobile.png status-marker-game-suspended-desktop.png
	status-marker-game-delayed-mobile.png status-marker-game-delayed-desktop.png
	status-marker-game-delayed-start-mobile.png status-marker-game-delayed-start-desktop.png
	status-marker-scoreboard-mobile.png status-marker-scoreboard-desktop.png)

if ! grep -qE '^# A7 .*\(S157\)$' "$A" 2>/dev/null; then
	bad 1 "no $A headed (S157)"
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
	grep -qF 'it should be clear to the user that the game is suspended' "$A" || bad 1 "$A does not quote the owner's 2026-11-20 words"
	grep -qE '^Source: https://www\.figma\.com/design/[A-Za-z0-9]+\?node-id=[0-9]+-[0-9]+' "$A" || bad 1 "$A has no Figma Source: line with a node id"
	frames_table=$(section "$A" Frames)
	for f in "${FRAMES[@]}"; do
		[ -f "$DIR/$f" ] || bad 1 "frame $f missing"
		echo "$frames_table" | grep -qF "\`$f\`" || bad 1 "$f not in ## Frames"
	done
	for f in $(own_frames); do
		echo "$frames_table" | grep -qF "\`$f\`" || bad 1 "$f is not listed in ## Frames"
	done
	row() { echo "$frames_table" | grep -F "\`$1\`"; }
	for s in Live Suspended Delayed "Delayed start"; do
		row status-marker-states.png | grep -qF "State=$s" || bad 1 "the component frame's row does not name its State=$s variant"
	done
	for p in mobile desktop; do
		row "status-marker-game-suspended-$p.png" | grep -qi 'suspended' || bad 1 "the suspended $p game frame's row does not say Suspended"
		row "status-marker-game-delayed-$p.png" | grep -qi 'delayed' || bad 1 "the delayed $p game frame's row does not say Delayed"
		row "status-marker-game-live-$p.png" | grep -qi 'in progress' || bad 1 "the live $p game frame's row does not say the game is in progress"
		row "status-marker-game-delayed-start-$p.png" | grep -qi 'delayed start' || bad 1 "the delayed-start $p game frame's row does not say Delayed start"
		for s in suspended delayed 'in progress' 'delayed start'; do
			row "status-marker-scoreboard-$p.png" | grep -qi "$s" || bad 1 "the $p scoreboard frame's row has no $s game"
		done
	done
	for l in "Marker" "One component" "Codes" "Resumed" "Top bar" "Scoreboard row"; do
		[ -n "$(decision "$l")" ] || bad 1 "## Decisions has no '- **$l:**' bullet"
	done
	decision "One component" | grep -qiE 'instance' || bad 1 "One component: does not say every frame places an instance"
	codes=$(decision "Codes")
	for c in '`T`' '`U`' '`I`' '`IR`' '`P`' '`PR`'; do
		echo "$codes" | grep -qF "$c" || bad 1 "Codes: does not name MLB's $c"
	done
	decision "Resumed" | grep -qiE 'resume' || bad 1 "Resumed: does not say what the marker shows once a suspended game resumes"
	section "$A" "Open questions" | grep -qE '`P`' || bad 1 "## Open questions does not ask whether a delayed start (MLB \`P\`) gets the marker"

	# --- Check 2: open questions answered, quoted ----------------------------------------
	oq=$(section "$A" "Open questions" | sed '/^[[:space:]]*$/d')
	if [ "$oq" != "None." ]; then
		qs=$(echo "$oq" | grep -cE '^[0-9]+\. ')
		[ "$qs" -gt 0 ] || bad 2 "## Open questions is neither 'None.' nor a numbered list"
		while IFS= read -r q; do
			[ -z "$q" ] && continue
			echo "$q" | grep -qE '\*\*Answered [0-9]{4}-[0-9]{2}-[0-9]{2}:\*\* \*"[^"]+"\*' ||
				bad 2 "unanswered or unquoted: $(echo "$q" | cut -c1-60)…"
		done <<<"$(echo "$oq" | grep -E '^[0-9]+\. ')"
	fi

	# --- Check 3: ratification record, manifest, build story, FEATURES ------------------------
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
	done <<<"$manifest"
fi
# The build story: a create record S157's own commits added for another story, whose body
# names S157 as its design (a **Design:** line or the fields block's design list).
build=""
while IFS= read -r f; do
	[ -z "$f" ] && continue
	id=$(basename "$f" | sed -E 's/^[0-9TZ]+-(S[0-9]+)-create\.md$/\1/')
	[ "$id" = "S157" ] && continue
	if grep -qE '^\*\*Design:\*\*.*\bS157\b' "$f" || grep -qE '^design:.*\bS157\b' "$f" || grep -qE '^  - "?S157"?$' "$f"; then
		build="$id"
	fi
done <<<"$(story_own_changed_files S157 "$BASE" docs/v3/audit | grep -E '/[0-9TZ]+-S[0-9]+-create\.md$')"
if [ -z "$build" ]; then
	bad 3 "no build story created by S157 names S157 as its design"
else
	grep -E '^\| \*\*Game status marker\*\* \|' docs/v3/FEATURES.md | grep -qE "\\b$build\\b" ||
		bad 3 "FEATURES' Game status marker row does not name the build story $build"
fi

# --- Check 4: status done ------------------------------------------------------------------
[ "$(story_snapshot_status S157)" = "done" ] || bad 4 "S157's snapshot does not record \`done\`"

# --- Check 5: sealed files untouched --------------------------------------------------------
changed=$(story_own_changed_files S157 "$BASE" .)
for S in game-shell shell-scoreboard; do
	RAT="$V/$S/RATIFIED.md"
	if [ -f "$RAT" ]; then
		while IFS= read -r line; do
			[ -z "$line" ] && continue
			sum=${line%%  *}
			f=${line#*  }
			[ -f "$V/$S/$f" ] || {
				bad 5 "sealed $S/$f missing"
				continue
			}
			[ "$(shasum -a 256 "$V/$S/$f" | cut -d' ' -f1)" = "$sum" ] || bad 5 "sealed $S/$f changed"
		done <<<"$(section "$RAT" Manifest | grep -E '^[0-9a-f]{64}  ')"
	else
		bad 5 "$RAT missing"
	fi
	printf '%s\n' "$changed" | grep -qxF "$RAT" && bad 5 "S157 changed $RAT"
	for a in "$V/$S"/amendments/A[0-9]*.md; do
		[ "$a" = "$A" ] && continue
		# Only a ratified amendment is sealed (a draft, such as shell-scoreboard A15, is not).
		grep -qE '^Ratified by:' "$a" || continue
		printf '%s\n' "$changed" | grep -qxF "$a" && bad 5 "S157 changed a ratified amendment, $a"
		while IFS= read -r line; do
			[ -z "$line" ] && continue
			sum=${line%%  *}
			f=${line#*  }
			[ -f "$V/$S/amendments/$f" ] && [ "$(shasum -a 256 "$V/$S/amendments/$f" | cut -d' ' -f1)" != "$sum" ] &&
				bad 5 "$f sealed by $S/$(basename "$a") changed"
		done <<<"$(section "$a" Manifest | grep -E '^[0-9a-f]{64}  ')"
	done
done

# --- Check 6: fence -------------------------------------------------------------------------
# The fence, plus S157's own records (rule 13) and the create record of the build story AC 3 adds.
while IFS= read -r f; do
	[ -z "$f" ] && continue
	case "$f" in
		docs/v3/visual/game-shell/amendments/* | docs/v3/visual/shell-scoreboard/amendments/* | docs/v3/VISUAL-DESIGN.md | \
			docs/v3/FEATURES.md | docs/v3/backlog/* | changelog.d/S157.md | scripts/verify-S157.sh) ;;
		docs/v3/audit/*/*-S157-*.md) ;;
		docs/v3/audit/*/*-S[0-9]*-create.md) ;;
		*) bad 6 "outside the fence: $f" ;;
	esac
done <<<"$changed"
git cat-file -e "$BASE:scripts/verify-S157.sh" 2>/dev/null && bad 6 "scripts/verify-S157.sh existed before S157 (it may only be created)"

report "verify-S157"
exit $?
