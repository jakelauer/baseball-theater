#!/usr/bin/env bash
# Grader for story S218 — design capture specs pick scoreboard modules by the game they mean (data-game-pk), never by
# where the module sits on the page.
# A commit-time proof of this story (S84).
# Contract: frame note 00, "Verify-script contract" (docs/v3/backlog/frame/).
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`); runs only the story-scoped Vitest
# file named below, once, and reads each test's result by name. AC 3's captures (`pnpm design:capture`) need a browser
# and dev servers, so they are run by the story's worker and reported in its commit body; this grader checks what of
# AC 3 the tree shows: only S20's, S170's and S74's design checks may change.

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "AC 1: ScoreboardModule carries data-game-pk={game.gamePk} on its data-testid=\"scoreboard-module\" element; the RTL test named 'S218 AC 1' (a module rendered for a fixture game has its gamePk) passes"
check 2 "AC 2: S20.spec.ts, S170.spec.ts and S74.spec.ts pick each module they act on by data-game-pk; no spec under e2e/design/ picks a scoreboard module by position (getByTestId(\"scoreboard-module\") then .nth( / .last() / .first() not followed by .waitFor(), or the selector string '[data-testid=scoreboard-module] >> nth=')"
check 3 "AC 3: the only design checks S218 changes are S20's, S170's and S74's (a capture re-taken for the intended game); the captures' exits and games are in the commit body"
check 4 "AC 4: S218 changed no file outside its fence (plus creating scripts/verify-S218.sh and its own records); its snapshot records Status done"

# The commit S218's own changes start from: `git merge-base origin/stage HEAD` when this grader was written.
BASE=9c99f6ad48c6a964cf5999693628d91386b66e81

TMP="$(mktemp -d /tmp/verify-S218.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

MOD=web/src/components/scoreboard/ScoreboardModule.tsx
MOD_TEST=src/components/scoreboard/ScoreboardModule.test.tsx
(cd web && pnpm exec vitest run "$MOD_TEST" --reporter=json --outputFile="$TMP/web.json" >"$TMP/web.log" 2>&1)
WEB="$TMP/web.json"

# passed <report> <regex> — at least one test whose full name matches ran, and every such test passed.
passed() {
	[ -f "$1" ] || return 1
	node -e '
		const r = require(process.argv[1]);
		const re = new RegExp(process.argv[2]);
		const hit = r.testResults.flatMap((f) => f.assertionResults).filter((t) => re.test(t.fullName));
		process.exit(hit.length > 0 && hit.every((t) => t.status === "passed") ? 0 : 1);
	' "$1" "$2"
}

# --- Check 1: the module says which game it is ---
# The attribute sits in the same JSX element as the test id: within the few lines around it.
grep -B6 -A6 'data-testid="scoreboard-module"' "$MOD" | grep -qE 'data-game-pk=\{game\.gamePk\}' \
	|| bad 1 "$MOD: the scoreboard-module element carries no data-game-pk={game.gamePk}"
passed "$WEB" "S218 AC 1" || bad 1 "test 'S218 AC 1' in web/$MOD_TEST did not pass"

# --- Check 2: picks by game, never by position ---
positional() {
	grep -nE 'getByTestId\("scoreboard-module"\)[[:space:]]*\.(nth\(|last\(\))' "$@"
	grep -nE 'getByTestId\("scoreboard-module"\)[[:space:]]*\.first\(\)' "$@" | grep -vE 'getByTestId\("scoreboard-module"\)[[:space:]]*\.first\(\)\.waitFor\(\)'
	grep -nE 'scoreboard-module"?\][[:space:]]*>>[[:space:]]*nth=' "$@"
}
hits="$(positional -r e2e/design/ 2>/dev/null)"
[ -z "$hits" ] || bad 2 "positional scoreboard-module picks remain: $(tr '\n' ' ' <<<"$hits")"
for spec in S20 S170 S74; do
	grep -qE 'data-game-pk=' "e2e/design/$spec.spec.ts" || bad 2 "e2e/design/$spec.spec.ts picks no module by data-game-pk"
done

# --- Check 3: only the three stories' design checks change ---
while IFS= read -r f; do
	[ -z "$f" ] && continue
	case "$f" in
		docs/v3/design-checks/S20/* | docs/v3/design-checks/S170/* | docs/v3/design-checks/S74/*) ;;
		docs/v3/design-checks/*) bad 3 "a design check outside S20, S170 and S74 changed: $f" ;;
	esac
done < <(story_own_changed_files S218 "$BASE" .)

# --- Check 4: fence and status ---
fence='^(e2e/design/|web/src/components/scoreboard/|web/vitest\.config\.ts$|docs/v3/design-checks/|docs/v3/backlog/|docs/v3/audit/|changelog\.d/S218\.md$|scripts/verify-S218\.sh$)'
while IFS= read -r f; do
	[ -z "$f" ] && continue
	grep -qE "$fence" <<<"$f" || bad 4 "outside the fence: $f"
done < <(story_own_changed_files S218 "$BASE" .)
own_added="$(story_own_diff S218 "$BASE" --name-status --diff-filter=A -- scripts/verify-S218.sh)"
[ -n "$own_added" ] || [ -n "$(git ls-files --others --exclude-standard -- scripts/verify-S218.sh)" ] || bad 4 "scripts/verify-S218.sh was not created by S218"
[ "$(story_snapshot_status S218)" = "done" ] || bad 4 "S218's snapshot does not record Status done"

report "verify-S218"
exit $?
