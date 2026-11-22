#!/usr/bin/env bash
# Grader for backlog story S134 — the change log page at /changelog (shell-scoreboard A9, ratified by
# S133 on 2026-11-19): every release from GET /api/v1/releases newest first through one named
# TanStack Query hook, its empty, loading and error states, and the "Changelog" link at the foot of
# the rail and the drawer, plain or current.
# Contract: frame note 00, "Verify-script contract" (docs/v3/backlog/frame/).
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`); runs only the
# story-scoped Vitest files named below, once, and reads each test's result by name.

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "AC 1: /changelog (routes.tsx) draws every release newest first, titled 'Change log', version and formatDate'd date (version alone when none), a gold 'Major Feature' header per headline addition, FEATURE/ENHANCEMENT/PERFORMANCE/BUG FIX labels in one neutral style, the 'Fixes and polish' line, through one named TanStack Query hook (RTL named 'S134 AC 1')"
check 2 "AC 2: the empty, loading and error states as S133 draws them (RTL named 'S134 AC 2')"
check 3 "AC 3: a 'Changelog' link above the version line in the rail and the drawer, closing the drawer; current (aria-current=page, Primary fill) on /changelog and /changelog?x=1 with no nav item active; plain on /standings; not in the nav list; the version line not a link; signed out too (RTL named 'S134 AC 3')"
check 4 "AC 4: files S134 adds or edits outside web/src/layout/ don't call useMediaQuery, hiddenFrom or visibleFrom"
check 5 "AC 5: the 15 design captures from e2e/design/S134.spec.ts under docs/v3/design-checks/S134/ at their pairing widths"
check 6 "AC 6: S134's Status is done: its snapshot fragment records done"
check 7 "S134 changed no file outside its fence (plus creating scripts/verify-S134.sh)"

# The commit S134's own changes start from: `git merge-base origin/stage HEAD` when this grader was written.
BASE=0db18d3f17a432e62b544a344573055e87c04ee4

TMP="$(mktemp -d /tmp/verify-S134.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

WEB_TESTS=(src/pages/ChangelogPage.test.tsx src/layout/NavRail.test.tsx src/layout/AppShellLayout.test.tsx src/routes.test.tsx)
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

for n in 1 2 3; do passed "$TMP/web.json" "S134 AC $n\\b" || bad "$n" "no passing RTL test named 'S134 AC $n' (or one failed)"; done

# --- Check 1: the route and the one named hook ---
PAGE=web/src/pages/ChangelogPage.tsx
grep -qE 'path="/changelog"' web/src/routes.tsx || bad 1 "web/src/routes.tsx has no /changelog route"
if [ ! -f "$PAGE" ]; then
	bad 1 "$PAGE missing"
else
	grep -qE '^export function useReleases\(' web/src/api/releases.ts 2>/dev/null || bad 1 "web/src/api/releases.ts exports no useReleases hook"
	grep -qE 'useQuery\(' web/src/api/releases.ts 2>/dev/null || bad 1 "useReleases does not call TanStack Query's useQuery"
	grep -qE 'useReleases\(' "$PAGE" || bad 1 "$PAGE does not read the releases through useReleases"
	grep -qE 'useQuery|fetchReleases' "$PAGE" && bad 1 "$PAGE queries the releases itself instead of through the named hook"
	grep -qE 'formatDate\(' "$PAGE" || bad 1 "$PAGE does not write dates with formatDate"
fi
# The files the story's tests share keep passing whole: the page's, the route table's, and the rail's and shell's.
file_passed "$TMP/web.json" "ChangelogPage.test.tsx" || bad 1 "web/src/pages/ChangelogPage.test.tsx did not pass"
file_passed "$TMP/web.json" "routes.test.tsx" || bad 1 "web/src/routes.test.tsx did not pass"
for t in NavRail.test.tsx AppShellLayout.test.tsx; do
	file_passed "$TMP/web.json" "$t" || bad 3 "web/src/layout/$t did not pass"
done

# --- Check 4: no viewport reads outside the layout host ---
while IFS= read -r f; do
	[ -z "$f" ] && continue
	case "$f" in web/src/layout/*) continue ;; esac
	[ -f "$f" ] || continue
	grep -qE 'useMediaQuery|hiddenFrom|visibleFrom' "$f" && bad 4 "$f calls useMediaQuery, hiddenFrom or visibleFrom"
done < <(story_own_changed_files S134 "$BASE" web/src)

# --- Check 5: the 15 captures at their pairing widths ---
[ -f e2e/design/S134.spec.ts ] || bad 5 "e2e/design/S134.spec.ts missing"
frames=()
for p in mobile medium desktop; do
	frames+=("changelog-$p" "changelog-empty-$p" "changelog-loading-$p" "changelog-error-$p")
done
frames+=(drawer-changelog-link-mobile drawer-changelog-link-medium rail-version-release-desktop)
for frame in "${frames[@]}"; do
	case "$frame" in *-mobile) want=390 ;; *-medium) want=768 ;; *-desktop) want=1200 ;; esac
	f="docs/v3/design-checks/S134/$frame.png"
	if [ ! -f "$f" ]; then
		bad 5 "$f missing"
	else
		w=$(node -e 'const b=require("fs").readFileSync(process.argv[1]);process.stdout.write(String(b.readUInt32BE(16)))' "$f")
		[ "$w" = "$want" ] || bad 5 "$f is ${w}px wide, not $want"
	fi
done

# --- Check 6: Status done ---
[ "$(story_snapshot_status S134)" = "done" ] || bad 6 "S134's snapshot does not record Status done"

# --- Check 7: fence ---
fence='^(web/src/|web/vitest\.config\.ts$|docs/v3/backlog/|docs/v3/AUDIT\.md$|docs/v3/audit\.jsonl$|docs/v3/INDEX\.md$|CHANGELOG\.md$|e2e/design/|docs/v3/design-checks/|docs/v3/audit/[^/]+/[^/]*-S134-[^/]*\.md$|changelog\.d/S134\.md$|scripts/verify-S134\.sh$)'
while IFS= read -r f; do
	[ -z "$f" ] && continue
	grep -qE "$fence" <<<"$f" || bad 7 "outside the fence: $f"
done < <(story_own_changed_files S134 "$BASE" .)
own_added="$(story_own_diff S134 "$BASE" --name-status --diff-filter=A -- scripts/verify-S134.sh)"
[ -n "$own_added" ] || [ -n "$(git ls-files --others --exclude-standard -- scripts/verify-S134.sh)" ] || bad 7 "scripts/verify-S134.sh was not created by S134"

report "verify-S134"
exit $?
