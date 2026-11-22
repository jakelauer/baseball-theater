#!/usr/bin/env bash
# Grader for backlog story S130 — Standings' three views (spring training, the regular season, the
# playoffs): which views a day offers and which opens first, the switch, each view's table with the
# clinch marks and legend, the "as of" line, the World Series box and the title, built to A9.
# A commit-time proof of this story (S84). Contract: docs/v3/backlog/frame/00 (Verify-script contract).
# No network. Never deploys. No writes outside /tmp. Does its own checking (story-scoped Vitest files
# only, found by the tag each AC's tests carry: "S130 AC <n>").

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "AC 1: one domain function beside standingsPhase (standingsViews) answers the views a day offers, in spring/regularSeason/playoffs order, and the one that opens first, from the day and the answer only (domain tests 'S130 AC 1'); the page asks through useStandings with includePhases naming regularSeason plus the shown view's phase, draws the switch from that function, keeps ?date= when switching, corrects an address naming a view not offered without a history entry, and never shows the loading state once a table is drawn (RTL 'S130 AC 1')"
check 2 "AC 2: spring tables have no GB column, the regular season keeps it, the playoffs list has no numbers, the empty first spring morning draws S129's text with the switch; clinched teams are bold with their letter and a hyphen, and a legend from clinchLegend (packages/domain, beside standingsPhase) lists z, y, w, x once each, strongest first; no switch or box on loading and error (domain and RTL tests 'S130 AC 2')"
check 3 "AC 3: a day in the address that isn't MLB's today shows 'Standings as of <Month D, YYYY>' written by formatLongDate in web/src/format/datetime.ts (full month, a calendar day in any zone, a non-date unchanged); none for today or no date (tests 'S130 AC 3')"
check 4 "AC 4: the World Series box shows by one domain function (championBoxShows, beside standingsPhase) from the day after wonOn through January 31 after it, with a link to the playoffs view (keeping ?date=) only on a day standingsViews offers playoffs and it isn't the view shown, its line written by formatLongDate, its sheen off under reduced motion (domain and RTL tests 'S130 AC 4')"
check 5 "AC 5: the heading and the browser tab's title read as A9 gives them for each view and a past day; leaving Standings puts back the app's title (RTL 'S130 AC 5')"
check 6 "AC 6: files this story adds or edits don't call useMediaQuery, hiddenFrom or visibleFrom outside web/src/layout/"
check 7 "AC 7: the 18 design captures from e2e/design/S130.spec.ts under docs/v3/design-checks/S130/ at their pairing widths (390, 768, 1200)"
check 8 "AC 8: S130's snapshot records Status done, and the story stays inside its scope files (plus its own records and scripts/verify-S130.sh), touching nothing under scripts/ or test/ but its grader"

# The commit S130's own changes start from (origin/stage when the story started, 2026-11-21).
BASE=cb0dc7fa
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# run_tagged <check> <package dir> <tag> — runs every test file under the package's src/ that names
# <tag>, filtered to the tests carrying it; fails when none exists or none passes.
run_tagged() {
  local id="$1" dir="$2" tag="$3" files
  files="$(cd "$dir" && grep -rlF --include='*.test.ts' --include='*.test.tsx' -- "$tag" src 2>/dev/null)"
  if [ -z "$files" ]; then
    bad "$id" "no test in $dir/src names '$tag'"
    return
  fi
  # shellcheck disable=SC2086
  if ! (cd "$dir" && pnpm exec vitest run $files -t "$tag" --reporter=json --outputFile="$TMP/r.json" >"$TMP/r.log" 2>&1); then
    bad "$id" "$dir '$tag' failed:"; tail -15 "$TMP/r.log" | sed 's/^/        /'
  elif ! node -e 'const r = require(process.argv[1]); process.exit(r.numPassedTests > 0 && r.numFailedTests === 0 ? 0 : 1)' "$TMP/r.json"; then
    bad "$id" "$dir '$tag' ran no passing test"
  fi
}

# fn_in <file> <name> — the file exports a function of that name.
fn_in() {
  grep -qE "^export function $2\(" "$1"
}

# --- Check 1: the views, the requests, the switch ------------------------------------------------------------
fn_in packages/domain/src/standings-phase.ts standingsViews || bad 1 "packages/domain/src/standings-phase.ts exports no standingsViews"
awk '/^export function standingsViews\(/{f=1} f{print} f&&/^}/{exit}' packages/domain/src/standings-phase.ts | grep -qE 'new Date|Date\.now|mlbToday' &&
  bad 1 "standingsViews reads the clock"
grep -qF 'standingsViews' web/src/pages/StandingsPage.tsx || bad 1 "StandingsPage.tsx does not call standingsViews"
grep -qE 'useStandings\(' web/src/pages/StandingsPage.tsx || bad 1 "StandingsPage.tsx does not ask through useStandings"
run_tagged 1 packages/domain "S130 AC 1"
run_tagged 1 web "S130 AC 1"

# --- Check 2: each view, the clinch marks and legend ---------------------------------------------------------
fn_in packages/domain/src/standings-phase.ts clinchLegend || bad 2 "packages/domain/src/standings-phase.ts exports no clinchLegend"
grep -rqF 'clinchLegend' web/src/pages/StandingsPage.tsx web/src/components/standings/ || bad 2 "the page does not draw the legend from clinchLegend"
run_tagged 2 packages/domain "S130 AC 2"
run_tagged 2 web "S130 AC 2"

# --- Check 3: the "as of" line -------------------------------------------------------------------------------
fn_in web/src/format/datetime.ts formatLongDate || bad 3 "web/src/format/datetime.ts exports no formatLongDate"
grep -qF 'formatLongDate' web/src/pages/StandingsPage.tsx || bad 3 "StandingsPage.tsx does not write the day with formatLongDate"
grep -qF 'mlbToday' web/src/pages/StandingsPage.tsx || bad 3 "StandingsPage.tsx does not compare the day with mlbToday"
run_tagged 3 web "S130 AC 3"

# --- Check 4: the World Series box ---------------------------------------------------------------------------
fn_in packages/domain/src/standings-phase.ts championBoxShows || bad 4 "packages/domain/src/standings-phase.ts exports no championBoxShows"
grep -rqF 'championBoxShows' web/src/pages/StandingsPage.tsx web/src/components/standings/ || bad 4 "the page does not call championBoxShows"
grep -rqF 'useReducedMotion' web/src/components/standings/ || bad 4 "no component under web/src/components/standings/ reads useReducedMotion for the box's sheen"
grep -rqF 'formatLongDate' web/src/components/standings/ web/src/pages/StandingsPage.tsx || bad 4 "the box's line is not written with formatLongDate"
run_tagged 4 packages/domain "S130 AC 4"
run_tagged 4 web "S130 AC 4"

# --- Check 5: the title --------------------------------------------------------------------------------------
run_tagged 5 web "S130 AC 5"

# --- Check 6: no breakpoint hooks outside web/src/layout/ ----------------------------------------------------
story_own_changed_files S130 "$BASE" . >"$TMP/changed.txt"
while IFS= read -r f; do
  case "$f" in web/src/layout/*) continue ;; esac
  [ -f "$f" ] || continue
  grep -qE 'useMediaQuery|hiddenFrom|visibleFrom' "$f" && bad 6 "$f calls useMediaQuery, hiddenFrom or visibleFrom"
done < <(grep -E '^web/src/.*\.(ts|tsx)$' "$TMP/changed.txt")

# --- Check 7: the 18 captures at their pairing widths --------------------------------------------------------
[ -f e2e/design/S130.spec.ts ] || bad 7 "e2e/design/S130.spec.ts missing"
for view in spring spring-empty regular-blank playoffs-champion regular-champion offseason; do
  for pairing in mobile medium desktop; do
    case "$pairing" in mobile) want=390 ;; medium) want=768 ;; desktop) want=1200 ;; esac
    f="docs/v3/design-checks/S130/standings-$view-$pairing.png"
    if [ ! -f "$f" ]; then
      bad 7 "$f missing"
    else
      w=$(node -e 'const b=require("fs").readFileSync(process.argv[1]);process.stdout.write(String(b.readUInt32BE(16)))' "$f")
      [ "$w" = "$want" ] || bad 7 "$f is ${w}px wide, not $want"
    fi
  done
done

# --- Check 8: Status done, inside the fence ------------------------------------------------------------------
[ "$(story_snapshot_status S130)" = "done" ] || bad 8 "S130's snapshot does not record Status done"
fence='^(web/src/|web/vitest\.config\.ts$|packages/domain/|docs/v3/backlog/|docs/v3/AUDIT\.md$|docs/v3/audit\.jsonl$|docs/v3/INDEX\.md$|CHANGELOG\.md$|e2e/design/|docs/v3/design-checks/|docs/v3/audit/[^/]+/[^/]*-S130-[^/]*\.md$|changelog\.d/S130\.md$|scripts/verify-S130\.sh$)'
while IFS= read -r f; do
  [ -z "$f" ] && continue
  grep -qE "$fence" <<<"$f" || bad 8 "outside the fence: $f"
done <"$TMP/changed.txt"

report "verify-S130"
exit $?
