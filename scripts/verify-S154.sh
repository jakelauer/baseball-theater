#!/usr/bin/env bash
# Grader for story S154 — the About, Privacy policy and Terms of use pages, each served by its own
# route and drawn by the shell with the site footer at its end, their text committed beside the page
# as the owner approved it, the privacy policy naming every place BT keeps personal data, and the three
# links added to S142's one footer list where shell-scoreboard A14 puts them.
# A commit-time proof of this story (S84).
# Contract: frame note 00, "Verify-script contract" (docs/v3/backlog/frame/).
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`); runs only the
# story-scoped Vitest files named below and reads each test's result by name.

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "AC 1: web/src/routes.tsx serves /about, /privacy and /terms, each by its own Route (no catch-all); each path renders its page's heading inside the shell with the site footer after <main> (RTL 'S154 AC 1 about|privacy|terms')"
check 2 "AC 2: each page's text is committed beside it (web/src/pages/legal/{about,privacy,terms}.md); each rendered page's text equals its committed text (RTL 'S154 AC 2 about|privacy|terms'); the story's newest text has one '**Approved:**' line per page, each quoting the owner"
check 3 "AC 3: the privacy policy's committed text names every registered personal data store (functions/src/services/personal-data.ts's *_STORE names, verbatim) and ADR-028's live Logto and Browser rows"
check 4 "AC 4: SiteFooter adds About (/about), Privacy policy (/privacy) and Terms of use (/terms) to its one list: 'Baseball Theater' reads About, Changelog, Support & Community; 'Legal' reads Privacy policy, Terms of use, then Your data signed in, the two alone signed out (RTL 'S154 AC 4 signed in|signed out')"
check 5 "AC 5: e2e/design/S154.spec.ts saves A14's site-footer-mobile, -desktop and -signed-out-mobile, and each page at each of those frames' widths (390/1200/390), under docs/v3/design-checks/S154/"
check 6 "AC 6: S154's Status is done: its snapshot fragment records done"
check 7 "S154 changed no file outside its fence (plus creating scripts/verify-S154.sh and its own records)"

# The commit S154's own changes start from: `git merge-base origin/stage HEAD` when this grader was written.
BASE=78630f0bb94c941641e2c3c2dd977ed42cfe6621

TMP="$(mktemp -d /tmp/verify-S154.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

PAGES=(about privacy terms)
LEGAL=web/src/pages/legal
F=web/src/layout/SiteFooter.tsx
WEB_TESTS=(src/pages/LegalPage.test.tsx src/layout/SiteFooter.test.tsx src/layout/SiteFooter.shell.test.tsx)
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

# --- Check 1: three routes ---
for p in "${PAGES[@]}"; do
	[ "$(grep -cE "<Route path=\"/$p\" " web/src/routes.tsx)" = "1" ] || bad 1 "web/src/routes.tsx has no single <Route path=\"/$p\">"
	passed "$TMP/web.json" "S154 AC 1 $p\\b" || bad 1 "no passing web test named 'S154 AC 1 $p'"
done
grep -qE 'path="\*"|path="/:' web/src/routes.tsx && bad 1 "web/src/routes.tsx has a catch-all or top-level param route"

# --- Check 2: approved words, committed ---
for p in "${PAGES[@]}"; do
	[ -s "$LEGAL/$p.md" ] || bad 2 "$LEGAL/$p.md missing or empty"
	passed "$TMP/web.json" "S154 AC 2 $p\\b" || bad 2 "no passing web test named 'S154 AC 2 $p'"
done
node scripts/backlog-vault/text-records.ts newest S154 >"$TMP/story.md" 2>/dev/null || bad 2 "can't read S154's newest text record"
for name in "About" "Privacy policy" "Terms of use"; do
	# One line, '**Approved:**', naming the page and quoting the owner (a quote mark and the word "owner").
	grep -E '^\s*-?\s*\*\*Approved:\*\*' "$TMP/story.md" | grep -F "$name" | grep -iq 'owner' &&
		grep -E '^\s*-?\s*\*\*Approved:\*\*' "$TMP/story.md" | grep -F "$name" | grep -qE '["“]' ||
		bad 2 "no '**Approved:**' line for $name quoting the owner in S154's text"
done

# --- Check 3: the privacy policy matches the product ---
stores="$(grep -oE 'export const [A-Z_]+_STORE = "[^"]+"' functions/src/services/personal-data.ts | sed -E 's/.*= "(.*)"/\1/')"
[ -n "$stores" ] || bad 3 "no *_STORE names found in functions/src/services/personal-data.ts"
while IFS= read -r s; do
	[ -z "$s" ] && continue
	grep -qF -- "$s" "$LEGAL/privacy.md" 2>/dev/null || bad 3 "the privacy policy does not name the store '$s'"
done <<<"$stores"
for s in "Logto" "Browser"; do
	grep -qF -- "$s" "$LEGAL/privacy.md" 2>/dev/null || bad 3 "the privacy policy does not name ADR-028's '$s' row"
done

# --- Check 4: the footer links them ---
for p in "${PAGES[@]}"; do
	[ "$(grep -cF "to=\"/$p\"" "$F" 2>/dev/null)" = "1" ] || bad 4 "SiteFooter has no single link to /$p"
done
others="$(grep -rlE --exclude='*.test.*' 'to="/(about|privacy|terms)"' web/src/layout 2>/dev/null | grep -v "^$F$")"
[ -z "$others" ] || bad 4 "a footer link to S154's pages is drawn outside SiteFooter: $others"
for name in "S154 AC 4 signed in" "S154 AC 4 signed out"; do
	passed "$TMP/web.json" "$name\\b" || bad 4 "no passing web test named '$name'"
done

# --- Check 5: the captures at their pairing widths ---
[ -f e2e/design/S154.spec.ts ] || bad 5 "e2e/design/S154.spec.ts missing"
for frame in site-footer-mobile site-footer-desktop site-footer-signed-out-mobile; do
	case "$frame" in *-mobile) want=390 ;; *-desktop) want=1200 ;; esac
	for f in "docs/v3/design-checks/S154/$frame.png" docs/v3/design-checks/S154/{about,privacy,terms}-"$frame".png; do
		if [ ! -f "$f" ]; then
			bad 5 "$f missing"
		else
			w=$(node -e 'const b=require("fs").readFileSync(process.argv[1]);process.stdout.write(String(b.readUInt32BE(16)))' "$f")
			[ "$w" = "$want" ] || bad 5 "$f is ${w}px wide, not $want"
		fi
	done
done

# --- Check 6: Status done ---
[ "$(story_snapshot_status S154)" = "done" ] || bad 6 "S154's snapshot does not record Status done"

# --- Check 7: fence ---
fence='^(web/src/|web/vitest\.config\.ts$|docs/v3/backlog/|docs/v3/AUDIT\.md$|docs/v3/audit\.jsonl$|docs/v3/INDEX\.md$|CHANGELOG\.md$|e2e/design/|docs/v3/design-checks/|docs/v3/audit/[^/]+/[^/]*-S154-[^/]*\.md$|changelog\.d/S154\.md$|scripts/verify-S154\.sh$)'
while IFS= read -r f; do
	[ -z "$f" ] && continue
	grep -qE "$fence" <<<"$f" || bad 7 "outside the fence: $f"
done < <(story_own_changed_files S154 "$BASE" .)
own_added="$(story_own_diff S154 "$BASE" --name-status --diff-filter=A -- scripts/verify-S154.sh)"
[ -n "$own_added" ] || [ -n "$(git ls-files --others --exclude-standard -- scripts/verify-S154.sh)" ] || bad 7 "scripts/verify-S154.sh was not created by S154"

report "verify-S154"
exit $?
