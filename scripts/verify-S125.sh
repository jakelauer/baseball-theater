#!/usr/bin/env bash
# Grader for backlog story S125 — the scoreboard's calendar date picker (shell-scoreboard A8,
# ratified by S123 on 2026-11-19): the date button opens a calendar (a sheet on mobile, a dropdown
# on medium and desktop) with a typed date field read on Enter or blur by one strict parser, native
# month and year pickers, the month grid with S124's game counts through one named TanStack Query
# hook, dimmed and disabled days, S159's favorite-team off-day mark and its tooltip, S136's
# off-season and unknown months, `Today`, the month arrows, the month asked for ahead, and the
# short-screen rule.
# Contract: frame note 00, "Verify-script contract" (docs/v3/backlog/frame/).
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`); runs only the
# story-scoped Vitest files named below, once, and reads each test's result by name.

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "AC 1: the date button (date-selector, Raised while open) opens the calendar; a typed date is read only on Enter or blur by one strict parser; valid dates from 1901-04-18 navigate once, unchanged ones not at all; 'Not a date.' and 'No data before Apr 18, 1901.' without navigating, kept on blur (RTL named 'S125 AC 1')"
check 2 "AC 2: weekday row and S124's counts through one named TanStack Query hook; dimmed, disabled, loading, failed and unknown months; picking navigates; S159's red/yellow off-day mark, its 'Off day: …' tooltip and long press; the off-season line from S136's monthGamesState (RTL named 'S125 AC 2')"
check 3 "AC 3: native month and year <select>s; years 1901 through latestScheduleMonth's year from mlbToday; a choice before April 1901; a month after latestScheduleMonth (400 month_too_late) (RTL named 'S125 AC 3')"
check 4 "AC 4: @mantine/dates (major 7, matching @mantine/core) and dayjs in web/package.json and pnpm-lock.yaml"
check 5 "AC 5: files S125 adds or edits outside web/src/layout/ don't call useMediaQuery, hiddenFrom or visibleFrom"
check 6 "AC 6: the 29 design captures from e2e/design/S125.spec.ts under docs/v3/design-checks/S125/ at their pairing widths"
check 7 "AC 7: sheet on mobile (200ms, reduced motion in place via useReducedMotion), dropdown otherwise, via the layout variant; outside click, Esc, Back, Today and the month arrows (RTL named 'S125 AC 7')"
check 8 "AC 8: the shown month asked ahead (only April 1901 to latestScheduleMonth), filled in the first render, six week rows, the short-screen rule read in web/src/layout/ (RTL named 'S125 AC 8')"
check 9 "AC 9: S125's Status is done: its snapshot records done"
check 10 "S125 changed no file outside its fence (plus creating scripts/verify-S125.sh)"

# The commit S125's own changes start from: story/S159's tip, the branch S125 is stacked on, when this grader was written.
BASE=8febc465beefdefbc2f6fb8c66bbb0320100ce57

TMP="$(mktemp -d /tmp/verify-S125.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

WEB_TESTS=(
	src/components/scoreboard/DateControl.test.tsx
	src/components/scoreboard/CalendarPanel.test.tsx
	src/components/scoreboard/dateParser.test.ts
	src/api/scheduleMonth.test.tsx
	src/layout/screenHeight.test.tsx
	src/pages/ScoreboardPage.test.tsx
)
present=()
for t in "${WEB_TESTS[@]}"; do [ -f "web/$t" ] && present+=("$t"); done
if [ "${#present[@]}" -gt 0 ]; then
	(cd web && pnpm exec vitest run "${present[@]}" --reporter=json --outputFile="$TMP/web.json" >"$TMP/web.log" 2>&1)
fi

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
# file_passed <report> <file suffix> — the file ran, and every test in it passed.
file_passed() {
	[ -f "$1" ] || return 1
	node -e '
		const r = require(process.argv[1]);
		const f = r.testResults.find((x) => x.name.endsWith(process.argv[2]));
		process.exit(f && f.assertionResults.length > 0 && f.assertionResults.every((t) => t.status === "passed") ? 0 : 1);
	' "$1" "$2"
}

for n in 1 2 3 7 8; do passed "$TMP/web.json" "S125 AC $n\\b" || bad "$n" "no passing RTL test named 'S125 AC $n' (or one failed)"; done
for t in "${WEB_TESTS[@]}"; do
	[ -f "web/$t" ] || continue
	file_passed "$TMP/web.json" "${t#src/}" || bad 1 "web/$t did not pass whole"
done

CONTROL=web/src/components/scoreboard/DateControl.tsx
PANEL=web/src/components/scoreboard/CalendarPanel.tsx
HOOK=web/src/api/scheduleMonth.ts
PARSER=web/src/components/scoreboard/dateParser.ts

# --- Check 1: the button, the one strict parser ---
grep -q 'date-selector' "$CONTROL" || bad 1 "$CONTROL draws no date-selector button"
if [ ! -f "$PARSER" ]; then
	bad 1 "$PARSER missing (the one strict date parser)"
else
	grep -qE '^export function parseTypedDate\(' "$PARSER" || bad 1 "$PARSER exports no parseTypedDate"
	grep -q 'isCalendarDate' "$PARSER" || bad 1 "$PARSER does not check the date with @bt/domain's isCalendarDate"
fi

# --- Check 2: the one named hook, S159's and S136's functions ---
if [ ! -f "$HOOK" ]; then
	bad 2 "$HOOK missing"
else
	grep -qE '^export function useScheduleMonth\(' "$HOOK" || bad 2 "$HOOK exports no useScheduleMonth hook"
	grep -qE 'useQuery\(' "$HOOK" || bad 2 "useScheduleMonth does not call TanStack Query's useQuery"
	grep -q 'fetchScheduleMonth' "$HOOK" || bad 2 "$HOOK does not read S124's route through fetchScheduleMonth"
fi
if [ ! -f "$PANEL" ]; then
	bad 2 "$PANEL missing"
else
	grep -q 'favoriteTeamsOff' "$PANEL" || bad 2 "$PANEL does not mark off days through S159's favoriteTeamsOff"
	grep -q 'monthGamesState' "$PANEL" || bad 2 "$PANEL does not read the month through S136's monthGamesState"
	grep -q 'MLB_TEAMS' "$PANEL" || bad 2 "$PANEL does not name the teams from MLB_TEAMS"
	grep -qE 'useScheduleMonth\(' "$PANEL" || bad 2 "$PANEL does not read the counts through useScheduleMonth"
	grep -qE 'fetchScheduleMonth|useQuery\(' "$PANEL" && bad 2 "$PANEL queries the month itself instead of through the named hook"
fi

# --- Check 3: native pickers and the range ---
if [ -f "$PANEL" ]; then
	grep -q 'NativeSelect' "$PANEL" || bad 3 "$PANEL has no native month and year selects (NativeSelect)"
	grep -q 'latestScheduleMonth' "$PANEL" || bad 3 "$PANEL does not bound the years with latestScheduleMonth"
	grep -q 'mlbToday' "$PANEL" || bad 3 "$PANEL does not call latestScheduleMonth with mlbToday's day"
fi

# --- Check 4: the dependency and the lockfile ---
core=$(node -e 'const p=require("./web/package.json");process.stdout.write(String((p.dependencies||{})["@mantine/core"]||""))')
dates=$(node -e 'const p=require("./web/package.json");process.stdout.write(String((p.dependencies||{})["@mantine/dates"]||""))')
dayjs=$(node -e 'const p=require("./web/package.json");process.stdout.write(String((p.dependencies||{})["dayjs"]||""))')
[ -n "$dates" ] || bad 4 "web/package.json has no @mantine/dates dependency"
[ -n "$dayjs" ] || bad 4 "web/package.json has no dayjs dependency"
if [ -n "$dates" ]; then
	[ "$(sed -E 's/^[^0-9]*([0-9]+).*/\1/' <<<"$dates")" = "$(sed -E 's/^[^0-9]*([0-9]+).*/\1/' <<<"$core")" ] || bad 4 "@mantine/dates $dates does not match @mantine/core $core's major"
fi
grep -qE "^  '?@mantine/dates@7\." pnpm-lock.yaml || bad 4 "pnpm-lock.yaml has no @mantine/dates 7.x package"
grep -qE "^  '?dayjs@" pnpm-lock.yaml || bad 4 "pnpm-lock.yaml has no dayjs package"
# Every web dependency's specifier in package.json is the one the lockfile's `web` importer records,
# so CI's `pnpm install --frozen-lockfile` accepts it (read offline, no install).
node -e '
	const fs = require("fs");
	const pkg = require("./web/package.json");
	const want = { ...pkg.dependencies, ...pkg.devDependencies };
	const lines = fs.readFileSync("pnpm-lock.yaml", "utf8").split("\n");
	const start = lines.indexOf("  web:");
	const got = {};
	let name;
	for (let i = start + 1; i < lines.length && (lines[i].startsWith("    ") || lines[i] === ""); i++) {
		const dep = /^      (\S.*):$/.exec(lines[i]);
		if (dep) name = dep[1].replace(/^\x27|\x27$/g, "");
		const spec = /^        specifier: (.*)$/.exec(lines[i]);
		if (spec && name) got[name] = spec[1].replace(/^\x27|\x27$/g, "");
	}
	const off = Object.keys(want).filter((d) => got[d] !== want[d]);
	if (start < 0 || off.length) { console.error(off.map((d) => `${d}: package.json ${want[d]}, lockfile ${got[d]}`).join("; ")); process.exit(1); }
' 2>"$TMP/lock.err" || bad 4 "pnpm-lock.yaml's web importer doesn't match web/package.json ($(cat "$TMP/lock.err")), so pnpm install --frozen-lockfile fails"
grep -q '@mantine/dates/styles.css' web/src/main.tsx || bad 4 "web/src/main.tsx does not load @mantine/dates/styles.css"

# --- Check 5: no viewport reads outside the layout host ---
while IFS= read -r f; do
	[ -z "$f" ] && continue
	case "$f" in web/src/layout/*) continue ;; esac
	[ -f "$f" ] || continue
	grep -qE 'useMediaQuery|hiddenFrom|visibleFrom' "$f" && bad 5 "$f calls useMediaQuery, hiddenFrom or visibleFrom"
done < <(story_own_changed_files S125 "$BASE" web/src)

# --- Check 6: the 29 captures at their pairing widths ---
[ -f e2e/design/S125.spec.ts ] || bad 6 "e2e/design/S125.spec.ts missing"
frames=()
for s in closed open offday invalid tooearly loading failed offseason earliest; do
	for p in mobile medium desktop; do frames+=("scoreboard-calendar-$s-$p"); done
done
frames+=(scoreboard-calendar-offday-hold-mobile scoreboard-calendar-short-mobile)
for frame in "${frames[@]}"; do
	case "$frame" in *-mobile) want=390 ;; *-medium) want=768 ;; *-desktop) want=1200 ;; esac
	f="docs/v3/design-checks/S125/$frame.png"
	if [ ! -f "$f" ]; then
		bad 6 "$f missing"
	else
		w=$(node -e 'const b=require("fs").readFileSync(process.argv[1]);process.stdout.write(String(b.readUInt32BE(16)))' "$f")
		[ "$w" = "$want" ] || bad 6 "$f is ${w}px wide, not $want"
	fi
done

# --- Check 7: container, reduced motion ---
if [ -f "$CONTROL" ]; then
	grep -q 'useReducedMotion' "$CONTROL" || bad 7 "$CONTROL does not read reduced motion through Mantine's useReducedMotion"
	grep -q 'Drawer' "$CONTROL" || bad 7 "$CONTROL has no bottom-sheet Drawer for mobile"
	grep -q 'Popover' "$CONTROL" || bad 7 "$CONTROL has no Popover dropdown for medium and desktop"
	grep -qE 'variant === "mobile"' "$CONTROL" || bad 7 "$CONTROL does not choose its container from the layout variant"
	grep -qE '<DateControl key=\{date\}[^>]*variant=\{variant\}' web/src/pages/ScoreboardPage.tsx || bad 7 "ScoreboardPage does not key DateControl by the day and pass it the host's variant"
fi
grep -q 'useLayoutVariant()' web/src/layout/AppShellLayout.tsx || bad 7 "the layout host no longer reads useLayoutVariant()"

# --- Check 8: the short-screen read lives in web/src/layout/ ---
[ -f web/src/layout/screenHeight.ts ] || bad 8 "web/src/layout/screenHeight.ts missing (the screen-height read)"
grep -qE 'useShortScreen' "$CONTROL" "$PANEL" 2>/dev/null || bad 8 "the calendar does not read the short-screen rule through web/src/layout/"

# --- Check 9: Status done ---
[ "$(story_snapshot_status S125)" = "done" ] || bad 9 "S125's snapshot does not record Status done"

# --- Check 10: fence ---
fence='^(web/src/|web/package\.json$|web/vitest\.config\.ts$|pnpm-lock\.yaml$|docs/v3/backlog/|docs/v3/AUDIT\.md$|docs/v3/audit\.jsonl$|docs/v3/INDEX\.md$|CHANGELOG\.md$|e2e/design/|docs/v3/design-checks/|docs/v3/audit/[^/]+/[^/]*-S125-[^/]*\.md$|changelog\.d/S125\.md$|scripts/verify-S125\.sh$)'
while IFS= read -r f; do
	[ -z "$f" ] && continue
	grep -qE "$fence" <<<"$f" || bad 10 "outside the fence: $f"
done < <(story_own_changed_files S125 "$BASE" .)
own_added="$(story_own_diff S125 "$BASE" --name-status --diff-filter=A -- scripts/verify-S125.sh)"
[ -n "$own_added" ] || [ -n "$(git ls-files --others --exclude-standard -- scripts/verify-S125.sh)" ] || bad 10 "scripts/verify-S125.sh was not created by S125"

report "verify-S125"
exit $?
