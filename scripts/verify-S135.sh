#!/usr/bin/env bash
# Grader for backlog story S135 — the update notice's "See the changelog" link and, after updating,
# the pointer at the menu that says the update is complete (shell-scoreboard A9, ratified by S133 on
# 2026-11-19), with the build's known release (#47's `__BT_RELEASE__`, `knownRelease`) and the rail's
# version line kept as #47 built it.
# Contract: frame note 00, "Verify-script contract" (docs/v3/backlog/frame/).
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`); runs only the
# story-scoped Vitest files named below, once, and reads each test's result by name.

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "AC 1: knownRelease in web/src/layout/version.ts, a function over __BT_RELEASE__ through S131's parseReleaseVersion: v3.2.0 kept; unreleased, dev, blank, v3.2 and 'Next release' null; buildInfo with BT_RELEASE=v3.2.0 feeds it (test named 'S135 AC 1')"
check 2 "AC 2: the update notice carries 'See the changelog' at the left of its button row, opening /changelog, no addition, no /api/v1/releases request, Snooze and Update Now kept, the retired case the same, and no link on /changelog (RTL named 'S135 AC 2')"
check 3 "AC 3: the after-update pointer: its own non-personal STORAGE_KEYS key (not bt.updateSnoozedUntil), compareReleaseVersions/parseReleaseVersion, a Mantine Popover placed by LayoutVariant, its words, 10 s countdown that never pauses, click and drawer dismissal, reduced motion, never with A6's box, the marker case, and the storage edge cases (RTL named 'S135 AC 3')"
check 4 "AC 4: the rail's version line stays '<release> (<commit>)', 'unreleased (<commit>)' or 'dev (<commit>)' (test named 'S135 AC 4'; version.test.ts passes whole)"
check 5 "AC 5: files S135 adds or edits outside web/src/layout/ don't call useMediaQuery, hiddenFrom or visibleFrom"
check 6 "AC 6: the 14 design captures from e2e/design/S135.spec.ts under docs/v3/design-checks/S135/ at their pairing widths, and e2e/flows/update.spec.ts asserts the notice's link"
check 7 "AC 7: S135's Status is done: its snapshot fragment records done"
check 8 "S135 changed no file outside its fence (plus creating scripts/verify-S135.sh)"

# The commit S135's own changes start from: `git merge-base origin/stage HEAD` when this grader was written.
BASE=b47be925dfda2dcce2b88ac7e55b7694f4d5f7a7

TMP="$(mktemp -d /tmp/verify-S135.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

WEB_TESTS=(src/layout/version.test.ts src/pwa/UpdateNotice.test.tsx src/pwa/afterUpdate.test.tsx src/layout/NoticeSlot.test.tsx src/layout/NavRail.test.tsx src/layout/AppShellLayout.test.tsx src/storage/storage.test.ts)
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

for n in 1 2 3 4; do passed "$TMP/web.json" "S135 AC $n\\b" || bad "$n" "no passing test named 'S135 AC $n' (or one failed)"; done

# --- Check 1: knownRelease, one function over the build's release, through S131's parser ---
V=web/src/layout/version.ts
grep -qE '^export function knownRelease\(' "$V" || bad 1 "$V exports no knownRelease function"
grep -qE 'parseReleaseVersion' "$V" || bad 1 "knownRelease does not use S131's parseReleaseVersion"
grep -qE '__BT_RELEASE__' "$V" || bad 1 "$V no longer reads __BT_RELEASE__"

# --- Check 2: the notice's link ---
grep -rqF 'See the changelog' web/src --include=*.tsx --include=*.ts --exclude=*.test.* || bad 2 "no 'See the changelog' link in web/src"
file_passed "$TMP/web.json" "UpdateNotice.test.tsx" || bad 2 "web/src/pwa/UpdateNotice.test.tsx did not pass"
file_passed "$TMP/web.json" "NoticeSlot.test.tsx" || bad 2 "web/src/layout/NoticeSlot.test.tsx did not pass"

# --- Check 3: the pointer's pieces ---
S=web/src/storage/storage.ts
node -e '
	const src = require("fs").readFileSync(process.argv[1], "utf8");
	const block = src.slice(src.indexOf("export const STORAGE_KEYS"), src.indexOf("} as const"));
	const keys = [...block.matchAll(/"([\w.]+)":\s*\{\s*personal:\s*(true|false)/g)].map((m) => [m[1], m[2]]);
	const extra = keys.filter(([k, p]) => p === "false" && /release/i.test(k));
	process.exit(extra.length > 0 ? 0 : 1);
' "$S" || bad 3 "$S lists no non-personal key for the recorded release"
P=web/src/pwa/afterUpdate.tsx
if [ ! -f "$P" ]; then
	bad 3 "$P missing"
else
	grep -qE 'compareReleaseVersions' "$P" || bad 3 "$P does not compare releases with S131's compareReleaseVersions"
	grep -qE 'parseReleaseVersion' "$P" || bad 3 "$P does not check the recorded value with S131's parseReleaseVersion"
	grep -qE 'bt\.updateSnoozedUntil' "$P" && bad 3 "$P uses the update notice's snooze key"
	grep -qE 'useReducedMotion' "$P" || bad 3 "$P does not read reduced motion through Mantine's useReducedMotion"
	grep -qE 'Popover' "$P" || bad 3 "$P does not draw the pointer with Mantine's Popover"
	grep -qE 'api/v1/releases|fetchReleases|useReleases' "$P" && bad 3 "$P asks the server for releases"
fi
grep -qE 'LayoutVariant|variant' web/src/layout/AppShellLayout.tsx || bad 3 "the shell no longer places by LayoutVariant"
for t in afterUpdate.test.tsx NavRail.test.tsx AppShellLayout.test.tsx storage.test.ts; do
	file_passed "$TMP/web.json" "$t" || bad 3 "$t did not pass"
done

# --- Check 4: the version line ---
file_passed "$TMP/web.json" "version.test.ts" || bad 4 "web/src/layout/version.test.ts did not pass"
grep -qE 'return `\$\{release\} \(\$\{commit\.slice\(0, 7\)\}\)`' "$V" || bad 4 "versionLine no longer prints '<release> (<commit>)'"

# --- Check 5: no viewport reads outside the layout host ---
while IFS= read -r f; do
	[ -z "$f" ] && continue
	case "$f" in web/src/layout/*) continue ;; esac
	[ -f "$f" ] || continue
	grep -qE 'useMediaQuery|hiddenFrom|visibleFrom' "$f" && bad 5 "$f calls useMediaQuery, hiddenFrom or visibleFrom"
done < <(story_own_changed_files S135 "$BASE" web/src)

# --- Check 6: the 14 captures at their pairing widths (S74 hasn't shipped: no marker frames), and the flow ---
[ -f e2e/design/S135.spec.ts ] || bad 6 "e2e/design/S135.spec.ts missing"
grep -qF 'See the changelog' e2e/flows/update.spec.ts || bad 6 "e2e/flows/update.spec.ts does not assert the notice's link"
frames=()
for p in mobile medium desktop; do
	frames+=("update-notice-link-$p" "update-notice-on-changelog-$p" "updated-pointer-$p" "updated-pointer-on-changelog-$p")
done
frames+=(updated-pointer-menu-open-mobile updated-pointer-menu-open-medium)
for frame in "${frames[@]}"; do
	case "$frame" in *-mobile) want=390 ;; *-medium) want=768 ;; *-desktop) want=1200 ;; esac
	f="docs/v3/design-checks/S135/$frame.png"
	if [ ! -f "$f" ]; then
		bad 6 "$f missing"
	else
		w=$(node -e 'const b=require("fs").readFileSync(process.argv[1]);process.stdout.write(String(b.readUInt32BE(16)))' "$f")
		[ "$w" = "$want" ] || bad 6 "$f is ${w}px wide, not $want"
	fi
done

# --- Check 7: Status done ---
[ "$(story_snapshot_status S135)" = "done" ] || bad 7 "S135's snapshot does not record Status done"

# --- Check 8: fence ---
fence='^(web/src/|web/vite\.config\.ts$|web/vitest\.config\.ts$|docs/v3/backlog/|docs/v3/AUDIT\.md$|docs/v3/audit\.jsonl$|docs/v3/INDEX\.md$|CHANGELOG\.md$|e2e/design/|e2e/flows/|docs/v3/design-checks/|docs/v3/audit/[^/]+/[^/]*-S135-[^/]*\.md$|changelog\.d/S135\.md$|scripts/verify-S135\.sh$)'
while IFS= read -r f; do
	[ -z "$f" ] && continue
	grep -qE "$fence" <<<"$f" || bad 8 "outside the fence: $f"
done < <(story_own_changed_files S135 "$BASE" .)
own_added="$(story_own_diff S135 "$BASE" --name-status --diff-filter=A -- scripts/verify-S135.sh)"
[ -n "$own_added" ] || [ -n "$(git ls-files --others --exclude-standard -- scripts/verify-S135.sh)" ] || bad 8 "scripts/verify-S135.sh was not created by S135"

report "verify-S135"
exit $?
