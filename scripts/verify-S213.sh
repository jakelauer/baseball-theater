#!/usr/bin/env bash
# Grader for story S213 — one rule for "this is a favorite team's game": isFavoriteGame in
# packages/domain, called by scoreboardRows and by the open-time prefetch.
# A commit-time proof of this story (S84).
# Contract: frame note 00, "Verify-script contract" (docs/v3/backlog/frame/).
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`); runs only the
# story-scoped Vitest files named below, once per package, and reads each test's result by name.

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "AC 1: packages/domain/src/scoreboard-rows.ts exports isFavoriteGame(game, favoriteTeamIds), its comment says why and names its callers; tests named 'S213 AC 1' pass (away, home, both, neither, empty)"
check 2 "AC 2: scoreboardRows and prefetchOnOpen call isFavoriteGame (the prefetch imports it from @bt/domain); outside tests and isFavoriteGame's own body no expression tests a game's teams.away.id/teams.home.id against a favorites list"
check 3 "AC 3: scoreboard-rows.test.ts and prefetch.test.tsx keep their existing cases unchanged and pass; new cases 'S213 AC 3 home only' and prefetchOnOpen called directly ('S213 AC 3 null', 'S213 AC 3 empty', 'S213 AC 3 favorites') pass"
check 4 "AC 4: S213's Status is done (its snapshot records done)"
check 5 "S213 changed no file outside its fence (plus creating scripts/verify-S213.sh and its own records)"

# The commit S213's own changes start from: `git merge-base origin/stage HEAD` when this grader was written.
BASE=38de7d2ef771d617ed1b2fb0298551d2610d9c1e

TMP="$(mktemp -d /tmp/verify-S213.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

(cd packages/domain && pnpm exec vitest run src/scoreboard-rows.test.ts --reporter=json --outputFile="$TMP/domain.json" >"$TMP/domain.log" 2>&1) &
(cd web && pnpm exec vitest run src/pwa/prefetch.test.tsx --reporter=json --outputFile="$TMP/web.json" >"$TMP/web.log" 2>&1) &
wait

# in_file <report> <file suffix> <regex> — a test whose full name matches ran in that file, and every such test passed.
in_file() {
	[ -f "$1" ] || return 1
	node -e '
		const r = require(process.argv[1]);
		const f = r.testResults.find((x) => x.name.endsWith(process.argv[2]));
		const re = new RegExp(process.argv[3]);
		const hit = f ? f.assertionResults.filter((t) => re.test(t.fullName)) : [];
		process.exit(hit.length > 0 && hit.every((t) => t.status === "passed") ? 0 : 1);
	' "$1" "$2" "$3"
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
# doc_of <file> <text the declaration line contains> — the comment block right above the declaration.
doc_of() {
	awk -v pat="$2" '/\/\*\*/{buf=""} {buf=buf"\n"$0} index($0, pat) {print buf; exit}' "$1" 2>/dev/null
}
DOM="$TMP/domain.json"
WEB="$TMP/web.json"
SR=packages/domain/src/scoreboard-rows.ts
PF=web/src/pwa/prefetch.ts

# --- Check 1: one named function ---
grep -qE '^export function isFavoriteGame\(game: [A-Za-z<>"|, ]+, favoriteTeamIds: ' "$SR" || bad 1 "$SR exports no isFavoriteGame(game, favoriteTeamIds)"
doc="$(doc_of "$SR" 'export function isFavoriteGame(')"
grep -q 'scoreboardRows' <<<"$doc" || bad 1 "isFavoriteGame's comment does not name scoreboardRows"
grep -q 'prefetchOnOpen' <<<"$doc" || bad 1 "isFavoriteGame's comment does not name prefetchOnOpen"
grep -qE 'ADR-025|one rule|once' <<<"$doc" || bad 1 "isFavoriteGame's comment does not say why it exists (ADR-025)"
for name in away home both neither empty; do
	in_file "$DOM" "src/scoreboard-rows.test.ts" "S213 AC 1 $name\\b" || bad 1 "no passing test named 'S213 AC 1 $name' in packages/domain/src/scoreboard-rows.test.ts"
done

# --- Check 2: both callers use it, and no other copy ---
awk '/^export function scoreboardRows\(/,/^}/' "$SR" | grep -q 'isFavoriteGame(' || bad 2 "scoreboardRows does not call isFavoriteGame"
awk '/^export async function prefetchOnOpen\(/,/^}/' "$PF" | grep -q 'isFavoriteGame(' || bad 2 "prefetchOnOpen does not call isFavoriteGame"
grep -qE '^import \{[^}]*\bisFavoriteGame\b[^}]*\} from "@bt/domain";' "$PF" || bad 2 "$PF does not import isFavoriteGame from @bt/domain"
copies="$(
	{
		awk '/^export function isFavoriteGame\(/{skip=1} !skip{print FILENAME":"FNR": "$0} skip&&/^}/{skip=0}' "$SR"
		grep -rnE --include='*.ts' --include='*.tsx' '' packages web/src 2>/dev/null |
			grep -vE '^[^:]*(node_modules|/dist/|\.test\.)' | grep -v "^$SR:"
	} | grep -E 'favorite[A-Za-z]*\.(has|includes)\([a-z]+\.teams\.(away|home)\.id'
)"
[ -z "$copies" ] || bad 2 "a favorites test on a game's team outside isFavoriteGame: $(head -3 <<<"$copies")"

# --- Check 3: behaviour unchanged ---
file_passed "$DOM" "src/scoreboard-rows.test.ts" || bad 3 "packages/domain/src/scoreboard-rows.test.ts did not pass"
file_passed "$WEB" "src/pwa/prefetch.test.tsx" || bad 3 "web/src/pwa/prefetch.test.tsx did not pass"
in_file "$DOM" "src/scoreboard-rows.test.ts" "S213 AC 3 home only\\b" || bad 3 "no passing test named 'S213 AC 3 home only' in scoreboard-rows.test.ts"
for name in null empty favorites; do
	in_file "$WEB" "src/pwa/prefetch.test.tsx" "S213 AC 3 $name\\b" || bad 3 "no passing test named 'S213 AC 3 $name' in prefetch.test.tsx"
done
for name in "collapses every game without a favorite team and puts favorites first" "with no favorites nothing collapses and the order is kept" "with Collapse Non-Favorites off nothing collapses, favorites or not"; do
	in_file "$DOM" "src/scoreboard-rows.test.ts" "$name" || bad 3 "the existing case '$name' no longer passes"
done
for name in "S74 AC 4 signed in" "S74 AC 4 signed out: today" "S74 AC 4 signed out: a wake" "S74 AC 5 supported: registers" "S74 AC 5 supported: a refused" "S74 AC 5 unsupported"; do
	in_file "$WEB" "src/pwa/prefetch.test.tsx" "$name" || bad 3 "the existing case '$name' no longer passes"
done
# Existing cases unchanged: the story removes no line from either test file but an import's.
removed="$(story_own_diff S213 "$BASE" -p -- packages/domain/src/scoreboard-rows.test.ts web/src/pwa/prefetch.test.tsx |
	grep -E '^-' | grep -vE '^---' | grep -vE '^-(import |\s*[A-Za-z_]+(, [A-Za-z_]+)*,?$|\} from |\s*$)')"
[ -z "$removed" ] || bad 3 "an existing test line was changed or removed: $(head -3 <<<"$removed")"
# The prefetch's new cases call prefetchOnOpen directly.
grep -q 'prefetchOnOpen(' web/src/pwa/prefetch.test.tsx || bad 3 "prefetch.test.tsx never calls prefetchOnOpen directly"

# --- Check 4: Status done ---
[ "$(story_snapshot_status S213)" = "done" ] || bad 4 "S213's snapshot does not record Status done"

# --- Check 5: fence ---
fence='^(packages/domain/src/scoreboard-rows(\.test)?\.ts$|web/src/pwa/prefetch\.ts$|web/src/pwa/prefetch\.test\.tsx$|docs/v3/backlog/|docs/v3/audit/|changelog\.d/S213\.md$|scripts/verify-S213\.sh$)'
while IFS= read -r f; do
	[ -z "$f" ] && continue
	grep -qE "$fence" <<<"$f" || bad 5 "outside the fence: $f"
done < <(story_own_changed_files S213 "$BASE" .)
own_added="$(story_own_diff S213 "$BASE" --name-status --diff-filter=A -- scripts/verify-S213.sh)"
[ -n "$own_added" ] || [ -n "$(git ls-files --others --exclude-standard -- scripts/verify-S213.sh)" ] || bad 5 "scripts/verify-S213.sh was not created by S213"

report "verify-S213"
exit $?
