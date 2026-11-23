#!/usr/bin/env bash
# Grader for story S142 — the site footer of links (shell-scoreboard A14, ratified 2026-11-19 by S141):
# one `SiteFooter`, drawn by the shell after `<main>` on every page (not the account-deleted page, the
# nav drawer or a dialog), opening with A13's Live strip on a page whose live socket is open, then the
# ratified link columns and a centred "© {year} Baseball Theater" whose year is `copyrightYear`.
# A commit-time proof of this story (S84).
# Contract: frame note 00, "Verify-script contract" (docs/v3/backlog/frame/).
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`); runs only the
# story-scoped Vitest files named below, once per package, and reads each test's result by name.

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "AC 1: one footer, SiteFooter in web/src/layout/, drawn by AppShellLayout after <main> (no page draws it); RTL 'S142 AC 1' on the scoreboard, a game page, Standings, Search, Settings and the change log (each by contentinfo, outside main), none on the deleted page or in the drawer, the page's state through children(variant, …) cleared on unmount; copyrightYear(instant) in packages/domain from mlbToday, unit-tested (2027-01-01T03:00Z → 2026, T05:00Z → 2027)"
check 2 "AC 2: no 'Fetched … ago' (FooterMeta gone, no 'Fetched \${' built under web/src); fetchedAgo and its test kept and passing; no footer reads 'baseball.theater'; the Live marker shows on a live game page with its socket open and not on the other pages (RTL 'S142 AC 2')"
check 3 "AC 3: the links' words, href, target and rel as A14 lists them (Changelog → /changelog, Support & Community → the r/BaseballTheater address in a new tab with rel noopener noreferrer, Your data → /settings), each BT link served by a route, none to /about, /privacy or /terms, each an Anchor or bt-hover (RTL 'S142 AC 3')"
check 4 "AC 4: the footer's text is exactly the headings, the links and the copyright line, plus 'Live Data · Active' when live (RTL 'S142 AC 4')"
check 5 "AC 5: 'Your data' goes to /settings exactly and shows signed in only (not signed out, not while loading); signed out the 'Legal' heading stands alone (RTL 'S142 AC 5' signed in, signed out, loading)"
check 6 "AC 6: files this story adds or edits don't call useMediaQuery, hiddenFrom or visibleFrom outside web/src/layout/"
check 7 "AC 7: the seven A14 captures from e2e/design/S142.spec.ts under docs/v3/design-checks/S142/ at their pairing widths (390/768/1200); the spec emulates the standalone display mode"
check 8 "AC 8: S142's Status is done: its snapshot fragment records done"
check 9 "S142 changed no file outside its fence (plus creating scripts/verify-S142.sh and its own records)"

# The commit S142's own changes start from: `git merge-base origin/stage HEAD` when this grader was written.
BASE=b47be925dfda2dcce2b88ac7e55b7694f4d5f7a7

TMP="$(mktemp -d /tmp/verify-S142.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

L=web/src/layout
F="$L/SiteFooter.tsx"
WEB_TESTS=(src/layout/SiteFooter.test.tsx src/layout/SiteFooter.shell.test.tsx)
present=()
for t in "${WEB_TESTS[@]}"; do [ -f "web/$t" ] && present+=("$t"); done
if [ "${#present[@]}" -gt 0 ]; then
	(cd web && pnpm exec vitest run "${present[@]}" --reporter=json --outputFile="$TMP/web.json" >"$TMP/web.log" 2>&1)
fi
DOMAIN_TESTS=(src/fetched-ago.test.ts)
[ -f packages/domain/src/copyright-year.test.ts ] && DOMAIN_TESTS+=(src/copyright-year.test.ts)
(cd packages/domain && pnpm exec vitest run "${DOMAIN_TESTS[@]}" --reporter=json --outputFile="$TMP/domain.json" >"$TMP/domain.log" 2>&1)

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
src_files() { grep -rlF --exclude='*.test.*' --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=coverage -- "$1" "${@:2}" 2>/dev/null; }

for n in 1 2 3 4 5; do passed "$TMP/web.json" "S142 AC $n\\b" || bad "$n" "no passing web test named 'S142 AC $n' (or one failed)"; done
# Each page and state the ACs name has its own passing test, so one passing test can't stand for all of them.
for name in "S142 AC 1 scoreboard" "S142 AC 1 game page" "S142 AC 1 Standings" "S142 AC 1 Search" "S142 AC 1 Settings" "S142 AC 1 change log" \
	"S142 AC 1 deleted page" "S142 AC 1 drawer" "S142 AC 1 state channel" "S142 AC 1 copyright year"; do
	passed "$TMP/web.json" "$name\\b" || bad 1 "no passing web test named '$name'"
done
for name in "S142 AC 5 signed in" "S142 AC 5 signed out" "S142 AC 5 loading"; do
	passed "$TMP/web.json" "$name\\b" || bad 5 "no passing web test named '$name'"
done

# --- Check 1: one footer, drawn by the shell ---
[ -f "$F" ] || bad 1 "$F missing"
footers="$(src_files 'component="footer"' web/src; grep -rlE --exclude='*.test.*' '<footer[ >]' web/src 2>/dev/null)"
[ "$(sort -u <<<"$footers" | grep -v '^$')" = "$F" ] || bad 1 "a <footer> is drawn outside SiteFooter.tsx: $(tr '\n' ' ' <<<"$footers")"
users="$(src_files 'SiteFooter' web/src | grep -v "^$F$" | sort)"
[ "$users" = "$L/AppShellLayout.tsx" ] || bad 1 "SiteFooter is drawn by: ${users:-nothing}, not AppShellLayout alone"
if [ -f "$L/AppShellLayout.tsx" ]; then
	# The footer comes after </main>'s Box, so it sits outside <main>.
	node -e '
		const s = require("fs").readFileSync(process.argv[1], "utf8");
		const main = s.indexOf("component=\"main\"");
		const foot = s.indexOf("<SiteFooter");
		const close = main < 0 ? -1 : s.indexOf("</Box>", s.indexOf("children(variant", main));
		process.exit(main >= 0 && foot > close && close > 0 ? 0 : 1);
	' "$L/AppShellLayout.tsx" || bad 1 "AppShellLayout does not draw SiteFooter after <main>"
	grep -qE 'children\(variant, ' "$L/AppShellLayout.tsx" || bad 1 "AppShellLayout's render prop does not pass the footer's setter beside variant"
	grep -qE 'useState' "$L/AppShellLayout.tsx" || bad 1 "AppShellLayout holds no useState for the page's footer state"
fi
grep -qE '\(variant, [A-Za-z]+\) =>' web/src/App.tsx || bad 1 "App.tsx's render prop does not take the footer's setter"
grep -lE 'createContext|zustand|useSettings' "$F" "$L/AppShellLayout.tsx" 2>/dev/null | grep -q . && bad 1 "the footer's state goes through a context or store (ADR-024)"
cy=packages/domain/src/copyright-year.ts
if [ ! -f "$cy" ]; then
	bad 1 "$cy missing"
else
	grep -qE 'export function copyrightYear\(instant: Date\): number' "$cy" || bad 1 "copyrightYear(instant: Date): number is not exported from $cy"
	grep -q 'mlbToday' "$cy" || bad 1 "copyrightYear does not use mlbToday"
	grep -qF './copyright-year.js' packages/domain/src/index.ts || bad 1 "packages/domain/src/index.ts does not export copyright-year"
	passed "$TMP/domain.json" "S142 AC 1 copyrightYear" || bad 1 "no passing domain test named 'S142 AC 1 copyrightYear'"
	grep -q '2027-01-01T03:00' packages/domain/src/copyright-year.test.ts && grep -q '2027-01-01T05:00' packages/domain/src/copyright-year.test.ts ||
		bad 1 "copyright-year.test.ts does not test 2027-01-01T03:00Z and T05:00Z"
	grep -q 'copyrightYear' "$F" 2>/dev/null || bad 1 "SiteFooter does not take its year from copyrightYear"
fi

# --- Check 2: the fetched line goes, the marker stays ---
[ -e "$L/FooterMeta.tsx" ] && bad 2 "$L/FooterMeta.tsx exists"
[ -z "$(grep -rl 'FooterMeta' web/src 2>/dev/null)" ] || bad 2 "FooterMeta is named in: $(grep -rl 'FooterMeta' web/src | tr '\n' ' ')"
[ -z "$(src_files 'Fetched ${' web/src)" ] || bad 2 "a 'Fetched \${…}' label is built in: $(src_files 'Fetched ${' web/src | tr '\n' ' ')"
if [ ! -f packages/domain/src/fetched-ago.ts ] || [ ! -f packages/domain/src/fetched-ago.test.ts ]; then
	bad 2 "fetchedAgo or its test is gone (S74's offline banner uses it)"
else
	file_passed "$TMP/domain.json" "fetched-ago.test.ts" || bad 2 "packages/domain/src/fetched-ago.test.ts did not pass"
fi
grep -qF 'baseball.theater' "$F" 2>/dev/null && bad 2 "SiteFooter.tsx names baseball.theater"
grep -qF '<LiveMarker' "$F" 2>/dev/null || bad 2 "SiteFooter does not draw LiveMarker"

# --- Check 3: the links ---
if [ -f "$F" ]; then
	grep -qF 'https://www.reddit.com/r/BaseballTheater/' "$F" || bad 3 "SiteFooter has no Support & Community address"
	grep -qF 'noopener noreferrer' "$F" || bad 3 "SiteFooter's outside link has no rel=\"noopener noreferrer\""
	grep -qE '"/(about|privacy|terms)"' "$F" && bad 3 "SiteFooter links a page BT doesn't serve yet (S154's)"
	grep -qE 'Anchor|bt-hover' "$F" || bad 3 "SiteFooter's links are neither Anchors nor bt-hover"
fi
grep -qE 'path="/changelog"' web/src/routes.tsx || bad 3 "web/src/routes.tsx serves no /changelog"
grep -qE 'path="/settings"' web/src/routes.tsx || bad 3 "web/src/routes.tsx serves no /settings"

# --- Check 4 and 5: the tests above ---

# --- Check 6: no viewport queries outside web/src/layout/ ---
story_own_changed_files S142 "$BASE" web/src | grep -v '^web/src/layout/' | while read -r f; do
	[ -f "$f" ] && grep -lE 'useMediaQuery|hiddenFrom|visibleFrom' "$f"
done >"$TMP/mq.txt"
[ -s "$TMP/mq.txt" ] && bad 6 "viewport queries outside web/src/layout/: $(tr '\n' ' ' <"$TMP/mq.txt")"

# --- Check 7: the captures at their pairing widths ---
spec=e2e/design/S142.spec.ts
if [ ! -f "$spec" ]; then
	bad 7 "$spec missing"
else
	grep -qF 'display-mode' "$spec" && grep -qF 'standalone' "$spec" || bad 7 "$spec does not emulate the standalone display mode"
fi
for frame in site-footer-mobile site-footer-medium site-footer-desktop site-footer-game-mobile site-footer-short-desktop \
	site-footer-standalone-mobile site-footer-signed-out-mobile; do
	case "$frame" in *-mobile) want=390 ;; *-medium) want=768 ;; *-desktop) want=1200 ;; esac
	f="docs/v3/design-checks/S142/$frame.png"
	if [ ! -f "$f" ]; then
		bad 7 "$f missing"
	else
		w=$(node -e 'const b=require("fs").readFileSync(process.argv[1]);process.stdout.write(String(b.readUInt32BE(16)))' "$f")
		[ "$w" = "$want" ] || bad 7 "$f is ${w}px wide, not $want"
	fi
done

# --- Check 8: Status done ---
[ "$(story_snapshot_status S142)" = "done" ] || bad 8 "S142's snapshot does not record Status done"

# --- Check 9: fence ---
fence='^(web/src/|web/vitest\.config\.ts$|packages/domain/|docs/v3/backlog/|docs/v3/AUDIT\.md$|docs/v3/audit\.jsonl$|docs/v3/INDEX\.md$|CHANGELOG\.md$|e2e/design/|e2e/flows/|docs/v3/design-checks/|docs/v3/audit/[^/]+/[^/]*-S142-[^/]*\.md$|changelog\.d/S142\.md$|scripts/verify-S142\.sh$)'
while IFS= read -r f; do
	[ -z "$f" ] && continue
	grep -qE "$fence" <<<"$f" || bad 9 "outside the fence: $f"
done < <(story_own_changed_files S142 "$BASE" .)
own_added="$(story_own_diff S142 "$BASE" --name-status --diff-filter=A -- scripts/verify-S142.sh)"
[ -n "$own_added" ] || [ -n "$(git ls-files --others --exclude-standard -- scripts/verify-S142.sh)" ] || bad 9 "scripts/verify-S142.sh was not created by S142"

report "verify-S142"
exit $?
