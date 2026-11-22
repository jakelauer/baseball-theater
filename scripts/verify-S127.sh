#!/usr/bin/env bash
# Grader for backlog story S127 — design amendment: every video player outside the game's own
# Videos room links to its game and its play as two pills, `More from game →` then game-shell A6's
# inning pill (`Top 6 →`), and every player shows the inning pill (owner, 2026-11-07 and 2026-11-19;
# rule 18). A commit-time proof of this story (S84).
# Contract: docs/v3/backlog/frame/00 (Verify-script contract).
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`).

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "standings-search-settings has its next free amendments/A<N>.md headed '(S127)' (Adds/Overrides/Repeals lines, ## Frames, ## Decisions quoting the owner's 2026-11-07 and 2026-11-19 words, ## Open questions, ## Manifest hashing exactly its own frames) drawing Search's floating player at mobile, medium and desktop with a play (More from game → then the inning pill) and without one, and a clip with no game; no '->' and no 'Go to:' label in its frames; the inning pill named as game-shell A6's play-inning-pill (724:10189), the game pill drawn from it"
check 2 "the same amendment draws the day digest's player at mobile, medium and desktop and the stage-mode player at mobile and medium, each with a play and without one, and says the game's Videos room player keeps only the inning pill"
check 3 "## Decisions says what each pill opens (More from game → the game's Videos tab, /game/:gamePk/videos; the inning pill the Plays room on that play), that each closes the player, and names each pill's accessible name (the inning pill's 'Open play - Top of 6th inning', the game pill's 'More videos from <game label>')"
check 4 "the amendment's ratification record names who ratified, the date, and quotes the owner's in-session go-ahead ('Ratify A10', 2026-11-22)"
check 5 "no sealed standings-search-settings file changed (RATIFIED.md's manifest and every earlier amendment's manifest still verify; S127 changed neither RATIFIED.md nor A1–A9)"
check 6 "S127's snapshot records Status done (story_snapshot_status), and the story stays inside its scope files (plus its own records and scripts/verify-S127.sh), touching nothing under scripts/ or test/ but its grader"

V="docs/v3/visual"
S="standings-search-settings"
DIR="$V/$S/amendments"
# The commit S127's own changes start from (origin/stage when the story started, 2026-11-21). The fence
# (check 6) reads only S127's own commits from here through story_own_changed_files (scripts/lib/checks.sh).
BASE=dc4f33df2471c9022ede95b4b652bcf4dfa24496

# Lines of section "## <name>" in a file.
section()
{
	awk -v h="## $2" '$0==h{f=1;next} /^## /{f=0} f' "$1"
}

# The body of the bullet "- **<label>:** …" in ## Decisions (empty when absent).
decision()
{
	section "$A" Decisions | awk -v l="- **$1:**" 'index($0, l)==1{print substr($0, length(l)+1)}' | sed 's/^[[:space:]]*//'
}

# Frames in amendments/ not claimed by another amendment's manifest.
own_frames()
{
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

# The ## Frames row of frame $1 (empty when absent).
row()
{
	section "$A" Frames | grep -F "\`$1\`"
}

A=$(grep -lE '^# A[0-9]+ .*\(S127\)$' "$DIR"/A[0-9]*.md 2>/dev/null | head -1)

if [ -z "$A" ]; then
	bad 1 "no $DIR/A<N>.md headed (S127)"
	bad 2 "no amendment, so no digest or stage frames"
	bad 3 "no amendment, so no decisions"
	bad 4 "no amendment, so no ratification record"
else
	# --- Check 1: the amendment, its sections and Search's frames -------------------
	n=$(basename "$A" .md | tr -d 'A')
	for ((i = 1; i < n; i++)); do [ -f "$DIR/A$i.md" ] || bad 1 "$A is not the next free number (A$i.md missing)"; done
	[ -f "$DIR/A$((n + 1)).md" ] && bad 1 "$A is not the newest amendment (A$((n + 1)).md exists)"
	for l in Adds Overrides Repeals; do
		grep -qE "^\*\*$l:\*\*" "$A" || bad 1 "$A has no **$l:** line"
	done
	for h in Frames Decisions "Open questions" Ratification Manifest; do
		grep -qx "## $h" "$A" || bad 1 "$A has no ## $h"
	done
	dec=$(section "$A" Decisions)
	echo "$dec" | grep -qF 'make it “Go to: Game ->  •  At-Bat ->”' || bad 1 "## Decisions does not quote the owner's 2026-11-07 words"
	echo "$dec" | grep -qF 'change the label to \"More from game ->\"' || echo "$dec" | grep -qF 'change the label to "More from game ->"' ||
		bad 1 "## Decisions does not quote the owner's 2026-11-19 'More from game ->' words"
	echo "$dec" | grep -qF 'Game link + pill' || bad 1 "## Decisions does not quote the owner's 'Game link + pill'"
	echo "$dec" | grep -qF 'all players always' || bad 1 "## Decisions does not quote the owner's 'all players always'"
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
	for f in $(own_frames); do
		echo "$f" | grep -qE '^[a-z]+(-[a-z]+)*-(mobile|medium|desktop)\.png$' || bad 1 "$f breaks <screen>[-<state>]-<pairing>.png"
		[ -n "$(row "$f")" ] || bad 1 "$f not in ## Frames"
	done
	frames=$(section "$A" Frames)
	echo "$frames" | grep -qF -- '->' && bad 1 "## Frames writes an arrow as '->', not '→' (U+2192)"
	echo "$frames" | grep -qF 'Go to:' && bad 1 "## Frames still draws a 'Go to:' label"
	for p in mobile medium desktop; do
		for f in "search-playing-pills-$p.png" "search-playing-pills-noplay-$p.png"; do
			[ -f "$DIR/$f" ] || bad 1 "frame $f missing"
			[ -n "$(row "$f")" ] || bad 1 "$f not in ## Frames"
		done
		row "search-playing-pills-$p.png" | grep -qE 'More from game →.*(Top|Bot) [0-9]+ →' ||
			bad 1 "search-playing-pills-$p.png's row does not show 'More from game →' then the inning pill"
		row "search-playing-pills-noplay-$p.png" | grep -qF 'More from game →' ||
			bad 1 "search-playing-pills-noplay-$p.png's row does not show 'More from game →'"
		row "search-playing-pills-noplay-$p.png" | grep -qiE 'no play' ||
			bad 1 "search-playing-pills-noplay-$p.png's row does not say the clip has no play"
	done
	[ -f "$DIR/search-playing-pills-nogame-mobile.png" ] || bad 1 "frame search-playing-pills-nogame-mobile.png missing"
	row "search-playing-pills-nogame-mobile.png" | grep -qiE 'no game' || bad 1 "the no-game frame's row does not say the clip has no game"
	decision "Inning pill" | grep -qF 'play-inning-pill' || bad 1 "Inning pill: does not name game-shell A6's play-inning-pill"
	decision "Inning pill" | grep -qF '724:10189' || bad 1 "Inning pill: does not name its component, 724:10189"
	decision "Game pill" | grep -qF 'More from game →' || bad 1 "Game pill: does not give its label, 'More from game →'"
	decision "Game pill" | grep -qiE 'instance|variant' || bad 1 "Game pill: does not say it is an instance or variant of the inning pill's component"
	decision "No game" | grep -qiE 'gamePk: -1|no game' || bad 1 "No game: does not settle a clip with no game"

	# --- Check 2: the day digest's and stage players --------------------------------
	for p in mobile medium desktop; do
		for f in "digest-playing-pills-$p.png" "digest-playing-pills-noplay-$p.png"; do
			[ -f "$DIR/$f" ] || bad 2 "frame $f missing"
			[ -n "$(row "$f")" ] || bad 2 "$f not in ## Frames"
		done
		row "digest-playing-pills-$p.png" | grep -qE 'More from game →.*(Top|Bot) [0-9]+ →' ||
			bad 2 "digest-playing-pills-$p.png's row does not show 'More from game →' then the inning pill"
	done
	for p in mobile medium; do
		for f in "video-player-stage-pill-$p.png" "video-player-stage-pill-noplay-$p.png"; do
			[ -f "$DIR/$f" ] || bad 2 "frame $f missing"
			[ -n "$(row "$f")" ] || bad 2 "$f not in ## Frames"
		done
		row "video-player-stage-pill-$p.png" | grep -qE '(Top|Bot) [0-9]+ →' ||
			bad 2 "video-player-stage-pill-$p.png's row does not show the inning pill"
	done
	decision "Videos room" | grep -qiE 'only the inning pill|inning pill alone' ||
		bad 2 "Videos room: does not say the game's Videos room player keeps only the inning pill"
	decision "Stage player" | grep -qiE 'context|Videos room' || bad 2 "Stage player: does not say it follows the context it plays in"

	# --- Check 3: what each pill opens, closing, accessible names --------------------
	decision "Opens" | grep -qF '/game/:gamePk/videos' || bad 3 "Opens: does not send More from game → to /game/:gamePk/videos"
	decision "Opens" | grep -qi 'Plays room' || bad 3 "Opens: does not send the inning pill to the Plays room"
	decision "Opens" | grep -qiE 'closes? the player' || bad 3 "Opens: does not say each pill closes the player"
	decision "Accessible names" | grep -qF 'Open play - Top of 6th inning' || bad 3 "Accessible names: does not give the inning pill's 'Open play - Top of 6th inning'"
	decision "Accessible names" | grep -qiE 'game pill|More from game' || bad 3 "Accessible names: does not name the game pill's"
	decision "Accessible names" | grep -qF 'More videos from' || bad 3 "Accessible names: does not give the game pill's 'More videos from <game label>' (owner, 2026-11-22)"

	# --- Check 4: ratification record ------------------------------------------------
	grep -qE '^Ratified by:[[:space:]]*[^[:space:]]' "$A" || bad 4 "no 'Ratified by:' line"
	grep -qE '^Date:[[:space:]]*[0-9]{4}-[0-9]{2}-[0-9]{2}[[:space:]]*$' "$A" || bad 4 "no 'Date: YYYY-MM-DD' line"
	grep -qE '^Go-ahead:[[:space:]]*".+"' "$A" || bad 4 "no quoted 'Go-ahead: \"…\"' line"
	grep -qE '^Go-ahead:[[:space:]]*".*Ratify A10.*"' "$A" || bad 4 "Go-ahead does not quote the owner's 2026-11-22 'Ratify A10'"
fi

# --- Check 5: sealed files untouched -------------------------------------------------
changed=$(story_own_changed_files S127 "$BASE" .)
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
	printf '%s\n' "$changed" | grep -qxF "$a" && bad 5 "S127 changed an earlier amendment, $a"
	while IFS= read -r line; do
		[ -z "$line" ] && continue
		sum=${line%%  *}
		f=${line#*  }
		[ -f "$DIR/$f" ] && [ "$(shasum -a 256 "$DIR/$f" | cut -d' ' -f1)" != "$sum" ] &&
			bad 5 "$f sealed by $(basename "$a") changed"
	done <<< "$(section "$a" Manifest | grep -E '^[0-9a-f]{64}  ')"
done
printf '%s\n' "$changed" | grep -qxF "$RAT" && bad 5 "S127 changed $RAT"

# --- Check 6: status and fence ---------------------------------------------------------
[ "$(story_snapshot_status S127)" = "done" ] || bad 6 "S127's snapshot does not record Status done"
while IFS= read -r f; do
	[ -z "$f" ] && continue
	case "$f" in
		docs/v3/visual/standings-search-settings/amendments/* | docs/v3/VISUAL-DESIGN.md | docs/v3/backlog/* | \
			docs/v3/AUDIT.md | docs/v3/audit.jsonl | docs/v3/INDEX.md | CHANGELOG.md | \
			docs/v3/audit/*-S127-* | changelog.d/S127.md | scripts/verify-S127.sh) ;;
		*) bad 6 "outside the fence: $f" ;;
	esac
done <<< "$changed"
git cat-file -e "$BASE:scripts/verify-S127.sh" 2>/dev/null && bad 6 "scripts/verify-S127.sh existed before S127 (it may only be created)"

report "verify-S127"
exit $?
