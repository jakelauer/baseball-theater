#!/usr/bin/env bash
# Grader for backlog story S5 — highlight search: `GET /api/v1/search/highlights?q=` asks MLB's free-text
# search (ADR-029; offline from the recorded `fixtures/search-*.json`), and the Search page lists the
# results as typographic rows (title, kind · date, matchup) that play in S70's floating player.
# Contract: frame note 00, "Verify-script contract" (docs/v3/backlog/frame/).
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`); runs only the
# story-scoped Vitest files named below, once each package, and reads each test's result by name.

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "AC 1: in-process GET /api/v1/search/highlights?q=walk-off answers 200 with >= 1 highlight (functions test named 'S5 AC 1'); the route is in the S26 route table (api-routes.ts) and the committed spec"
check 2 "AC 2: a returned highlight's title or blurb matches /walk-off/i (functions test named 'S5 AC 2')"
check 3 "AC 3: empty or missing q answers 400 with error exactly query_required (functions test named 'S5 AC 3')"
check 4 "AC 4: web/src/pages/SearchPage.test.tsx drives Search with 'walk-off' and sees a result's title (RTL named 'S5 AC 4')"
check 5 "AC 5: the web test file and the functions test file each exit 0 as named Vitest files"
check 6 "AC 6: the search UI files render no <img, Image, VideoStill or thumbnail in the results"
check 7 "AC 7: the search UI files use no useMediaQuery, hiddenFrom or visibleFrom"
check 8 "AC 8: 'N results found' and rows with kind · date and MatchupAbbr for both teams (RTL named 'S5 AC 8'); the route returns gamePk, teams and date (functions test named 'S5 AC 8'); the search request names guid and playInfo, and a recorded fixtures/search-*.json carries them"
check 9 "AC 9: a tapped result opens LazyPlayerDialog with 'Go to game: AWY @ HOM, Mon D →' to /game/:pk; Close or Esc returns to the same results and query; title 'Search Highlights', hint 'Search highlights…' (RTL named 'S5 AC 9'); one exported gameLabel used by DayDigest and Search"
check 10 "AC 10: no results, loading and error each drawn through ViewState, a test per state (RTL named 'S5 AC 10 … no results|loading|error')"
check 11 "AC 11: with Hide Scores on, results keep MLB's title and blurb (RTL named 'S5 AC 11'); the search UI files call neither useScoresHidden nor highlightTitle"
check 12 "AC 12: the 4 design captures from e2e/design/S5.spec.ts under docs/v3/design-checks/S5/ at their pairing widths"
check 13 "AC 13: S5's Status is done: its snapshot fragment records done"
check 14 "S5 changed no file outside its fence (plus creating scripts/verify-S5.sh)"

# The commit S5's own changes start from: `git merge-base origin/stage HEAD` when this grader was written.
BASE=dc4f33df2471c9022ede95b4b652bcf4dfa24496

TMP="$(mktemp -d /tmp/verify-S5.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

FN_TEST=src/handlers/search.test.ts
WEB_TEST=src/pages/SearchPage.test.tsx
[ -f "functions/$FN_TEST" ] && (cd functions && pnpm exec vitest run "$FN_TEST" --reporter=json --outputFile="$TMP/fn.json" >"$TMP/fn.log" 2>&1)
fn_exit=$?
[ -f "web/$WEB_TEST" ] && (cd web && pnpm exec vitest run "$WEB_TEST" --reporter=json --outputFile="$TMP/web.json" >"$TMP/web.log" 2>&1)
web_exit=$?

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

# The search UI files: the page and any search components under web/src (tests excluded).
UI_FILES=()
[ -f web/src/pages/SearchPage.tsx ] && UI_FILES+=(web/src/pages/SearchPage.tsx)
if [ -d web/src/components/search ]; then
	while IFS= read -r f; do UI_FILES+=("$f"); done < <(find web/src/components/search -type f \( -name '*.ts' -o -name '*.tsx' \) ! -name '*.test.*')
fi
ui="$(cat "${UI_FILES[@]}" 2>/dev/null)"

# --- Check 1: the route answers, and is in the route table and the spec ---
passed "$TMP/fn.json" "S5 AC 1\\b" || bad 1 "no passing functions test named 'S5 AC 1' (or one failed)"
grep -qF '"GET /api/v1/search/highlights"' packages/domain/src/api-routes.ts || bad 1 "GET /api/v1/search/highlights is not in packages/domain/src/api-routes.ts"
grep -qF '"/api/v1/search/highlights"' openapi/bt-api.v1.json || bad 1 "openapi/bt-api.v1.json has no /api/v1/search/highlights"
grep -qF '"/api/v1/search/highlights"' web/src/api/generated/bt-api.v1.ts || bad 1 "web/src/api/generated/bt-api.v1.ts has no /api/v1/search/highlights"

# --- Check 2: a walk-off highlight comes back ---
passed "$TMP/fn.json" "S5 AC 2\\b" || bad 2 "no passing functions test named 'S5 AC 2' (or one failed)"

# --- Check 3: a query is required ---
passed "$TMP/fn.json" "S5 AC 3\\b" || bad 3 "no passing functions test named 'S5 AC 3' (or one failed)"
grep -qF 'query_required' functions/src/handlers/api.ts || bad 3 "functions/src/handlers/api.ts never answers query_required"

# --- Check 4: the web test drives a walk-off search ---
if [ -f "web/$WEB_TEST" ]; then
	grep -qF 'walk-off' "web/$WEB_TEST" || bad 4 "web/$WEB_TEST never types walk-off"
else
	bad 4 "web/$WEB_TEST missing"
fi
passed "$TMP/web.json" "S5 AC 4\\b" || bad 4 "no passing RTL test named 'S5 AC 4' (or one failed)"

# --- Check 5: both story-scoped files exit 0 ---
[ -f "functions/$FN_TEST" ] && [ "$fn_exit" = 0 ] || bad 5 "functions/$FN_TEST missing or did not exit 0 (see its run)"
[ -f "web/$WEB_TEST" ] && [ "$web_exit" = 0 ] || bad 5 "web/$WEB_TEST missing or did not exit 0 (see its run)"

# --- Check 6: typographic results ---
[ "${#UI_FILES[@]}" -gt 0 ] || bad 6 "no search UI files"
grep -nE '<img|<Image\b|VideoStill|thumbnail|imageUrl' <<<"$ui" >/dev/null && bad 6 "a search UI file draws an image: $(grep -nE '<img|<Image\b|VideoStill|thumbnail|imageUrl' <<<"$ui" | head -3 | tr '\n' ' ')"

# --- Check 7: no layout by media query ---
grep -nE 'useMediaQuery|hiddenFrom|visibleFrom' <<<"$ui" >/dev/null && bad 7 "a search UI file chooses layout by media query"

# --- Check 8: count, rows, play fields ---
passed "$TMP/web.json" "S5 AC 8\\b" || bad 8 "no passing RTL test named 'S5 AC 8' (or one failed)"
passed "$TMP/fn.json" "S5 AC 8\\b" || bad 8 "no passing functions test named 'S5 AC 8' (or one failed)"
grep -qE 'results found' <<<"$ui" || bad 8 "no search UI file writes 'results found'"
grep -qE 'MatchupAbbr' <<<"$ui" || bad 8 "no search UI file uses MatchupAbbr"
req="$(sed -n '/export function searchHighlightsRequest/,/^}/p' functions/src/adapters/http/mlb.ts)"
[ -n "$req" ] || bad 8 "functions/src/adapters/http/mlb.ts has no searchHighlightsRequest"
grep -qF 'guid' <<<"$req" || bad 8 "the search request does not name guid"
grep -qF 'playInfo' <<<"$req" || bad 8 "the search request does not name playInfo"
rec="$(ls fixtures/search-*.json 2>/dev/null | head -1)"
if [ -z "$rec" ]; then
	bad 8 "no recorded fixtures/search-*.json"
else
	grep -qF '"playInfo"' "$rec" && grep -qF '"guid"' "$rec" || bad 8 "$rec does not carry guid and playInfo"
fi

# --- Check 9: the player, the link, the title ---
passed "$TMP/web.json" "S5 AC 9\\b" || bad 9 "no passing RTL test named 'S5 AC 9' (or one failed)"
grep -qF 'Search Highlights' <<<"$ui" || bad 9 "no search UI file titles the page 'Search Highlights'"
grep -qF 'Search highlights…' <<<"$ui" || bad 9 "no search UI file hints 'Search highlights…'"
grep -qE 'LazyPlayerDialog' <<<"$ui" || bad 9 "the search UI does not open LazyPlayerDialog"
grep -qE 'lazy\(' <<<"$ui" && bad 9 "a search UI file lazy-loads a second copy of the dialog"
gl="$(grep -rlE '^export function gameLabel\(' web/src --include='*.ts' --include='*.tsx' 2>/dev/null)"
[ -n "$gl" ] && [ "$(wc -l <<<"$gl" | tr -d ' ')" = 1 ] || bad 9 "gameLabel is not exported from exactly one file"
grep -qE '^function gameLabel' web/src/components/scoreboard/DayDigest.tsx && bad 9 "DayDigest.tsx still has its private gameLabel"
grep -qE 'gameLabel' <<<"$ui" || bad 9 "the search UI does not use gameLabel"

# --- Check 10: ViewState per state ---
for state in "no results" "loading" "error"; do
	passed "$TMP/web.json" "S5 AC 10\\b.*$state" || bad 10 "no passing RTL test named 'S5 AC 10 … $state'"
done
grep -qE 'ViewState|queryScreen' <<<"$ui" || bad 10 "the search UI uses neither ViewState nor queryScreen"

# --- Check 11: Hide Scores leaves Search alone ---
passed "$TMP/web.json" "S5 AC 11\\b" || bad 11 "no passing RTL test named 'S5 AC 11' (or one failed)"
grep -nE 'useScoresHidden|highlightTitle' <<<"$ui" >/dev/null && bad 11 "a search UI file calls useScoresHidden or highlightTitle"

# --- Check 12: the 4 captures at their pairing widths ---
[ -f e2e/design/S5.spec.ts ] || bad 12 "e2e/design/S5.spec.ts missing"
for frame in search-retitled-mobile search-medium search-desktop search-playing-floating-mobile; do
	case "$frame" in *-mobile) want=390 ;; *-medium) want=768 ;; *-desktop) want=1200 ;; esac
	f="docs/v3/design-checks/S5/$frame.png"
	if [ ! -f "$f" ]; then
		bad 12 "$f missing"
	else
		w=$(node -e 'const b=require("fs").readFileSync(process.argv[1]);process.stdout.write(String(b.readUInt32BE(16)))' "$f")
		[ "$w" = "$want" ] || bad 12 "$f is ${w}px wide, not $want"
	fi
done

# --- Check 13: Status done ---
[ "$(story_snapshot_status S5)" = "done" ] || bad 13 "S5's snapshot does not record Status done"

# --- Check 14: fence ---
fence='^(fixtures/|packages/domain/|packages/ports/|functions/src/|functions/vitest\.config\.ts$|openapi/|web/src/|web/vitest\.config\.ts$|docs/v3/backlog/|docs/v3/AUDIT\.md$|CHANGELOG\.md$|e2e/design/|docs/v3/design-checks/|docs/v3/audit/[^/]+/[^/]*-S5-[^/]*\.md$|changelog\.d/S5\.md$|scripts/verify-S5\.sh$)'
while IFS= read -r f; do
	[ -z "$f" ] && continue
	grep -qE "$fence" <<<"$f" || bad 14 "outside the fence: $f"
done < <(story_own_changed_files S5 "$BASE" .)
own_added="$(story_own_diff S5 "$BASE" --name-status --diff-filter=A -- scripts/verify-S5.sh)"
[ -n "$own_added" ] || [ -n "$(git ls-files --others --exclude-standard -- scripts/verify-S5.sh)" ] || bad 14 "scripts/verify-S5.sh was not created by S5"

report "verify-S5"
exit $?
