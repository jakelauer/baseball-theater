#!/usr/bin/env bash
# Grader for backlog story S72 — Search's active filter chips: `GET /api/v1/search/highlights` takes
# optional `date`, `team` and `tag` (additive), sent to MLB as its own filters, and the Search page
# draws each active one as a removable chip that re-asks the search when removed.
# Contract: frame note 00, "Verify-script contract" (docs/v3/backlog/frame/).
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`); runs only the
# story-scoped Vitest files named below, once each package, and reads each test's result by name.

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "AC 1: the search route accepts optional date, team and tag (functions test named 'S72 AC 1'); the spec and web types name them; pnpm api:breaking exits 0"
check 2 "AC 2: active chips render with a remove button; removing one re-queries and the results update (RTL named 'S72 AC 2')"
check 3 "AC 3: files S72 adds or edits hold no team-logo <img> or /logos/ reference, and none outside web/src/layout/ calls useMediaQuery, hiddenFrom or visibleFrom"
check 4 "AC 4: the design captures from e2e/design/S72.spec.ts under docs/v3/design-checks/S72/ at their pairing widths"
check 5 "AC 5: S72's Status is done: its snapshot fragment records done"
check 6 "S72 changed no file outside its fence (plus creating scripts/verify-S72.sh)"

# The commit S72's own changes start from: `git merge-base origin/stage HEAD` when this grader was written.
BASE=28d432a534a732e00baa219c517b3a142b5f22cb

TMP="$(mktemp -d /tmp/verify-S72.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

FN_TEST=src/handlers/search.test.ts
WEB_TEST=src/pages/SearchPage.test.tsx
[ -f "functions/$FN_TEST" ] && (cd functions && pnpm exec vitest run "$FN_TEST" --reporter=json --outputFile="$TMP/fn.json" >"$TMP/fn.log" 2>&1)
[ -f "web/$WEB_TEST" ] && (cd web && pnpm exec vitest run "$WEB_TEST" --reporter=json --outputFile="$TMP/web.json" >"$TMP/web.log" 2>&1)

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

# --- Check 1: the route's filters, the spec, additive ---
passed "$TMP/fn.json" "S72 AC 1\\b" || bad 1 "no passing functions test named 'S72 AC 1' (or one failed)"
spec_params="$(node -e '
	const s = require(process.argv[1]);
	const op = s.paths?.["/api/v1/search/highlights"]?.get;
	process.stdout.write((op?.parameters ?? []).map((p) => `${p.name}:${p.required === true}`).join(" "));
' "$PWD/openapi/bt-api.v1.json" 2>/dev/null)"
for p in date team tag; do
	grep -qE "(^| )$p:false( |$)" <<<"$spec_params" || bad 1 "openapi/bt-api.v1.json's search route has no optional '$p' parameter (has: $spec_params)"
	grep -qE "^\s*$p\?:" web/src/api/generated/bt-api.v1.ts || bad 1 "web/src/api/generated/bt-api.v1.ts names no optional '$p'"
done
pnpm -s api:breaking >"$TMP/breaking.log" 2>&1 || bad 1 "pnpm api:breaking did not exit 0: $(tail -3 "$TMP/breaking.log" | tr '\n' ' ')"

# --- Check 2: chips with remove, re-query ---
passed "$TMP/web.json" "S72 AC 2\\b" || bad 2 "no passing RTL test named 'S72 AC 2' (or one failed)"

# --- Check 3: no logos, no media-query layout in S72's files ---
own="$(story_own_changed_files S72 "$BASE" .; git ls-files --others --exclude-standard -- web/src functions/src packages)"
while IFS= read -r f; do
	[ -z "$f" ] || [ ! -f "$f" ] && continue
	case "$f" in *.ts|*.tsx|*.js|*.jsx|*.css) ;; *) continue ;; esac
	case "$f" in web/src/api/generated/*) continue ;; esac
	grep -nE '/logos/' "$f" >/dev/null && bad 3 "$f references /logos/"
	grep -nE '<img[^>]*(logo|team)' "$f" >/dev/null && bad 3 "$f draws a team-logo <img>"
	case "$f" in web/src/layout/*) ;; *)
		grep -nE 'useMediaQuery|hiddenFrom|visibleFrom' "$f" >/dev/null && bad 3 "$f chooses layout by media query" ;;
	esac
done <<<"$own"
grep -qE 'web/src/' <<<"$own" || bad 3 "S72 changed no file under web/src/"

# --- Check 4: the captures at their pairing widths ---
[ -f e2e/design/S72.spec.ts ] || bad 4 "e2e/design/S72.spec.ts missing"
for frame in search-retitled-mobile search-medium search-desktop; do
	case "$frame" in *-mobile) want=390 ;; *-medium) want=768 ;; *-desktop) want=1200 ;; esac
	f="docs/v3/design-checks/S72/$frame.png"
	if [ ! -f "$f" ]; then
		bad 4 "$f missing"
	else
		w=$(node -e 'const b=require("fs").readFileSync(process.argv[1]);process.stdout.write(String(b.readUInt32BE(16)))' "$f")
		[ "$w" = "$want" ] || bad 4 "$f is ${w}px wide, not $want"
	fi
done

# --- Check 5: Status done ---
[ "$(story_snapshot_status S72)" = "done" ] || bad 5 "S72's snapshot does not record Status done"

# --- Check 6: fence ---
fence='^(fixtures/|packages/domain/|packages/ports/|functions/src/|functions/vitest\.config\.ts$|openapi/|web/src/|web/vitest\.config\.ts$|docs/v3/backlog/|docs/v3/AUDIT\.md$|CHANGELOG\.md$|e2e/design/|docs/v3/design-checks/|docs/v3/audit/[^/]+/[^/]*-S72-[^/]*\.md$|changelog\.d/S72\.md$|scripts/verify-S72\.sh$)'
while IFS= read -r f; do
	[ -z "$f" ] && continue
	grep -qE "$fence" <<<"$f" || bad 6 "outside the fence: $f"
done < <(story_own_changed_files S72 "$BASE" .)
own_added="$(story_own_diff S72 "$BASE" --name-status --diff-filter=A -- scripts/verify-S72.sh)"
[ -n "$own_added" ] || [ -n "$(git ls-files --others --exclude-standard -- scripts/verify-S72.sh)" ] || bad 6 "scripts/verify-S72.sh was not created by S72"

report "verify-S72"
exit $?
