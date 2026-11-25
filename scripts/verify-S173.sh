#!/usr/bin/env bash
# Grader for backlog story S173 — every floating player opened from Search or the scoreboard's day
# digest draws standings-search-settings A10's pill row at its top left: `More from game →` (to the
# game's Videos tab) and then, 8px after it, the clip's inning pill (`Top 6 →`), both S145's
# `PlayInningPill`; the "Go to game: … →" text link is gone. The digest's items carry their play.
# Contract: frame note 00, "Verify-script contract" (docs/v3/backlog/frame/).
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`); runs only the
# story-scoped Vitest files named below, once each, and reads each test's result by name.

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "AC 1: dayDigest gives each item play { playId, halfInning, inning } | null through atBatOfPlay (domain test named 'S173 AC 1' over game 823823); openapi and the generated types carry the item's play; S29's digest fidelity entry stands; pnpm api:breaking exits 0"
check 2 "AC 2: web/src/components/videos/playLink.ts exports gameVideosLink (label 'More from game →', spoken 'More from game: <gameLabel>', to /game/<pk>/videos; unit test named 'S173 AC 2'); outside tests under web/src 'More from game' is only in playLink.ts and 'More videos from' is nowhere"
check 3 "AC 3: PlayerDialog draws the game pill then the inning pill, both PlayInningPill, each closing the player; no 'Go to game' under web/src or packages/domain/src outside tests (RTL named 'S173 AC 3')"
check 4 "AC 4: Search's player shows both pills, the game pill alone, or none, over S5's walk-off recording (RTL named 'S173 AC 4')"
check 5 "AC 5: the digest's player passes the item's game and playInningLink of its play (RTL named 'S173 AC 5')"
check 6 "AC 6: Hide Scores changes neither pill (RTL named 'S173 AC 6')"
check 7 "AC 7: files S173 adds or edits call no useMediaQuery, hiddenFrom or visibleFrom outside web/src/layout/"
check 8 "AC 8: the 13 design captures from e2e/design/S173.spec.ts under docs/v3/design-checks/S173/ at their pairing widths (390, 768, 1200)"
check 9 "AC 9: S173's Status is done: its snapshot fragment records done"
check 10 "S173 changed no file outside its fence (plus creating scripts/verify-S173.sh and its own records)"

# The commit S173's own changes start from: S153's checkpoint, the branch it is stacked on, when this grader was written.
BASE=54ca9259cda29ffb0b844e77920cee7c8c124c59

TMP="$(mktemp -d /tmp/verify-S173.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

# run_vitest <dir> <report> <test files…> — runs the files that exist, once, writing a JSON report.
run_vitest() {
	local dir="$1" out="$2"
	shift 2
	local present=()
	for t in "$@"; do [ -f "$dir/$t" ] && present+=("$t"); done
	[ "${#present[@]}" -gt 0 ] && (cd "$dir" && pnpm exec vitest run "${present[@]}" --reporter=json --outputFile="$out" >"$out.log" 2>&1)
}
run_vitest packages/domain "$TMP/domain.json" src/digest.test.ts
run_vitest web "$TMP/web.json" src/components/videos/playLink.test.ts src/components/videos/PlayerDialog.test.tsx src/pages/SearchPage.test.tsx src/components/scoreboard/DayDigest.test.tsx src/components/videos/VideosRoom.test.tsx

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

src_files() { grep -rlF --exclude='*.test.*' --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=coverage -- "$1" "${@:2}" 2>/dev/null; }

# --- Check 1: the digest's plays, the spec ---
passed "$TMP/domain.json" "S173 AC 1\\b" || bad 1 "no passing domain test named 'S173 AC 1' (or one failed)"
D=packages/domain/src/digest.ts
grep -qE '^\s*play: \{' "$D" || grep -qE '^\s*play: DigestPlay \| null;' "$D" || bad 1 "$D's DigestItem has no play field"
grep -qE '\batBatOfPlay\(' "$D" || bad 1 "$D doesn't find the play through atBatOfPlay"
node -e '
	const s = require("./openapi/bt-api.v1.json");
	const txt = JSON.stringify(s.components?.schemas ?? s);
	const item = Object.entries(s.components?.schemas ?? {}).find(([n]) => /DigestItem/.test(n));
	const props = item ? JSON.stringify(item[1]) : "";
	process.exit(/"play"/.test(props) && /"playId"/.test(txt) ? 0 : 1);
' 2>/dev/null || bad 1 "openapi/bt-api.v1.json's DigestItem has no play"
node -e '
	const t = require("fs").readFileSync("web/src/api/generated/bt-api.v1.ts", "utf8");
	const m = t.match(/DigestItem: \{[\s\S]*?\n {8}\};/);
	process.exit(m && /\bplay: /.test(m[0]) ? 0 : 1);
' 2>/dev/null || bad 1 "web/src/api/generated/bt-api.v1.ts's DigestItem has no play"
grep -qF '"GET /api/v1/digest"' web/src/api/generated.types.test.ts || bad 1 "S29's fidelity entry for the digest route is missing"
pnpm --silent api:breaking >"$TMP/breaking.log" 2>&1 || bad 1 "pnpm api:breaking failed: $(tail -3 "$TMP/breaking.log" | tr '\n' ' ')"

# --- Check 2: one game link ---
passed "$TMP/web.json" "S173 AC 2\\b" || bad 2 "no passing unit test named 'S173 AC 2' (or one failed)"
L=web/src/components/videos/playLink.ts
grep -qE '^export function gameVideosLink\(' "$L" || bad 2 "$L exports no gameVideosLink"
[ "$(src_files 'More from game' web/src)" = "$L" ] || bad 2 "'More from game' is in: $(src_files 'More from game' web/src | tr '\n' ' ')"
[ -z "$(src_files 'More videos from' web/src)" ] || bad 2 "'More videos from' is in: $(src_files 'More videos from' web/src | tr '\n' ' ')"

# --- Check 3: the player's pill row ---
passed "$TMP/web.json" "S173 AC 3\\b" || bad 3 "no passing RTL test named 'S173 AC 3' (or one failed)"
P=web/src/components/videos/PlayerDialog.tsx
grep -qE '\bgameVideosLink\(' "$P" || bad 3 "$P doesn't build the game pill with gameVideosLink"
[ "$(grep -cE '<PlayInningPill\b' "$P")" -ge 2 ] || bad 3 "$P doesn't draw both pills as PlayInningPill"
grep -qE '<Anchor\b' "$P" && bad 3 "$P still draws an Anchor link"
[ -z "$(src_files 'Go to game' web/src packages/domain/src)" ] || bad 3 "'Go to game' is in: $(src_files 'Go to game' web/src packages/domain/src | tr '\n' ' ')"

# --- Checks 4, 5, 6: the callers ---
for n in 4 5 6; do passed "$TMP/web.json" "S173 AC $n\\b" || bad "$n" "no passing RTL test named 'S173 AC $n' (or one failed)"; done
grep -qE '\bplayInningLink\(' web/src/components/scoreboard/DayDigest.tsx || bad 5 "DayDigest.tsx doesn't build the play link with playInningLink"

# --- Check 7: no breakpoint hooks in S173's files ---
while IFS= read -r f; do
	[ -z "$f" ] && continue
	case "$f" in web/src/layout/*|*.test.*) continue ;; esac
	case "$f" in *.ts|*.tsx) ;; *) continue ;; esac
	[ -f "$f" ] && grep -qE '\b(useMediaQuery|hiddenFrom|visibleFrom)\b' "$f" && bad 7 "$f calls useMediaQuery / hiddenFrom / visibleFrom"
done < <(story_own_changed_files S173 "$BASE" web/src packages/domain/src)

# --- Check 8: the 13 captures at their pairing widths ---
[ -f e2e/design/S173.spec.ts ] || bad 8 "e2e/design/S173.spec.ts missing"
for frame in search-playing-pills-mobile search-playing-pills-medium search-playing-pills-desktop \
	search-playing-pills-noplay-mobile search-playing-pills-noplay-medium search-playing-pills-noplay-desktop \
	search-playing-pills-nogame-mobile \
	digest-playing-pills-mobile digest-playing-pills-medium digest-playing-pills-desktop \
	digest-playing-pills-noplay-mobile digest-playing-pills-noplay-medium digest-playing-pills-noplay-desktop; do
	case "$frame" in *-mobile) want=390 ;; *-medium) want=768 ;; *-desktop) want=1200 ;; esac
	f="docs/v3/design-checks/S173/$frame.png"
	if [ ! -f "$f" ]; then
		bad 8 "$f missing"
	else
		w=$(node -e 'const b=require("fs").readFileSync(process.argv[1]);process.stdout.write(String(b.readUInt32BE(16)))' "$f")
		[ "$w" = "$want" ] || bad 8 "$f is ${w}px wide, not $want"
	fi
done

# --- Check 9: Status done ---
[ "$(story_snapshot_status S173)" = "done" ] || bad 9 "S173's snapshot does not record Status done"

# --- Check 10: fence ---
fence='^(packages/domain/|functions/src/services/|openapi/|web/src/|web/vitest\.config\.ts$|e2e/design/|docs/v3/design-checks/|docs/v3/backlog/|docs/v3/audit/[^/]+/[^/]*-S173-[^/]*\.md$|changelog\.d/S173\.md$|scripts/verify-S173\.sh$)'
while IFS= read -r f; do
	[ -z "$f" ] && continue
	grep -qE "$fence" <<<"$f" || bad 10 "outside the fence: $f"
done < <(story_own_changed_files S173 "$BASE" .)
own_added="$(story_own_diff S173 "$BASE" --name-status --diff-filter=A -- scripts/verify-S173.sh)"
[ -n "$own_added" ] || [ -n "$(git ls-files --others --exclude-standard -- scripts/verify-S173.sh)" ] || bad 10 "scripts/verify-S173.sh was not created by S173"

report "verify-S173"
exit $?
