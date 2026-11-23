#!/usr/bin/env bash
# Grader for backlog story S138 — the scoreboard's date control and calendar on Standings: the page
# shows S125's control first under the header, a pick, a typed date or an arrow goes to
# /standings?date=<day> (dropping ?view=), Standings' own Today goes to /standings, and the control and
# the "as of" words read one check of "a real date from 1901-04-18 on".
# A commit-time proof of this story (S84). Contract: docs/v3/backlog/frame/00 (Verify-script contract).
# No network. Never deploys. No writes outside /tmp. Does its own checking (story-scoped Vitest files
# only, found by the tag each AC's tests carry: "S138 AC <n>").

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "AC 1: the Standings page imports S125's DateControl (and through it CalendarPanel), no file this story adds imports @mantine/dates, and the control comes before the heading and the view switch (RTL 'S138 AC 1')"
check 2 "AC 2: a pick, a typed date and the ‹ › arrows go to /standings?date=<day> without ?view=; invalid and too-early typed dates stay put; back/forward; open-close changes nothing; a day after today; Standings' own Today on and off today's month and in the off-season (RTL 'S138 AC 2'); the page still reads through useStandings"
check 3 "AC 3: the control reads the address's date when it is a real date from 1901-04-18 on, else MLB's today, never the table's date; the heading's 'as of' words take the same check through BACKFILL_EARLIEST_DATE (RTL 'S138 AC 3')"
check 4 "AC 4: files this story adds or edits don't call useMediaQuery, hiddenFrom or visibleFrom outside web/src/layout/"
check 5 "AC 5: the six design captures from e2e/design/S138.spec.ts under docs/v3/design-checks/S138/ at their pairing widths (390, 768, 1200)"
check 6 "AC 6: S138's snapshot records Status done, and the story stays inside its scope files (plus its own records and scripts/verify-S138.sh), touching nothing under scripts/ or test/ but its grader"

# The commit S138's own changes start from (origin/stage when the story started, 2026-11-23).
BASE=25527d80
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

PAGE=web/src/pages/StandingsPage.tsx
story_own_changed_files S138 "$BASE" . >"$TMP/changed.txt"

# --- Check 1: S125's control, no second calendar, first under the header -----------------------------------
grep -qE '^import \{[^}]*\bDateControl\b[^}]*\} from "\.\./components/scoreboard/DateControl\.js";' "$PAGE" ||
  bad 1 "$PAGE does not import DateControl from ../components/scoreboard/DateControl.js"
grep -qE '<DateControl\b' "$PAGE" || bad 1 "$PAGE does not render <DateControl>"
grep -qF 'CalendarPanel' web/src/components/scoreboard/DateControl.tsx || bad 1 "DateControl no longer opens S125's CalendarPanel"
while IFS= read -r f; do
  case "$f" in web/src/components/scoreboard/CalendarPanel.tsx) continue ;; esac
  [ -f "$f" ] || continue
  grep -qF '@mantine/dates' "$f" && bad 1 "$f imports @mantine/dates (a second calendar)"
done < <(grep -E '^web/src/.*\.(ts|tsx)$' "$TMP/changed.txt")
run_tagged 1 web "S138 AC 1"

# --- Check 2: navigation ---------------------------------------------------------------------------------------
grep -qE 'useStandings\(' "$PAGE" || bad 2 "$PAGE does not ask through useStandings"
run_tagged 2 web "S138 AC 2"

# --- Check 3: the day the control reads, one check shared with the "as of" words ---------------------------------
grep -qF 'BACKFILL_EARLIEST_DATE' "$PAGE" || bad 3 "$PAGE does not bound the day with BACKFILL_EARLIEST_DATE from @bt/domain"
grep -qE 'BACKFILL_EARLIEST_DATE *= *"' "$PAGE" && bad 3 "$PAGE declares its own copy of the 1901-04-18 bound"
run_tagged 3 web "S138 AC 3"

# --- Check 4: no breakpoint hooks outside web/src/layout/ ----------------------------------------------------
while IFS= read -r f; do
  case "$f" in web/src/layout/*) continue ;; esac
  [ -f "$f" ] || continue
  grep -qE 'useMediaQuery|hiddenFrom|visibleFrom' "$f" && bad 4 "$f calls useMediaQuery, hiddenFrom or visibleFrom"
done < <(grep -E '^web/src/.*\.(ts|tsx)$' "$TMP/changed.txt")

# --- Check 5: the six captures at their pairing widths ---------------------------------------------------------
[ -f e2e/design/S138.spec.ts ] || bad 5 "e2e/design/S138.spec.ts missing"
for state in closed open; do
  for pairing in mobile medium desktop; do
    case "$pairing" in mobile) want=390 ;; medium) want=768 ;; desktop) want=1200 ;; esac
    f="docs/v3/design-checks/S138/standings-calendar-$state-$pairing.png"
    if [ ! -f "$f" ]; then
      bad 5 "$f missing"
    else
      w=$(node -e 'const b=require("fs").readFileSync(process.argv[1]);process.stdout.write(String(b.readUInt32BE(16)))' "$f")
      [ "$w" = "$want" ] || bad 5 "$f is ${w}px wide, not $want"
    fi
  done
done

# --- Check 6: Status done, inside the fence ------------------------------------------------------------------
[ "$(story_snapshot_status S138)" = "done" ] || bad 6 "S138's snapshot does not record Status done"
fence='^(web/src/|web/vitest\.config\.ts$|docs/v3/backlog/|docs/v3/audit/|changelog\.d/S138\.md$|e2e/design/|docs/v3/design-checks/|scripts/verify-S138\.sh$)'
while IFS= read -r f; do
  [ -z "$f" ] && continue
  grep -qE "$fence" <<<"$f" || bad 6 "outside the fence: $f"
done <"$TMP/changed.txt"

report "verify-S138"
exit $?
