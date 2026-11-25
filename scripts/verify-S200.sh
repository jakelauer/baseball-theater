#!/usr/bin/env bash
# Grader for story S200 — the Videos room groups by team as well as by kind (one domain grouping,
# `groupHighlightsByTeam`), a `Group by` switch beside the Grid / List toggle that swaps the team
# filter for a kind filter, and the list view's rows drawn as Best of rows (shell-scoreboard A10's
# digest row, no rank) in 1 / 2 / 3 columns, shared with Search's list mode.
# A commit-time proof of this story (S84).
# Contract: frame note 00, "Verify-script contract" (docs/v3/backlog/frame/).
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`); runs only the
# story-scoped Vitest files named below and reads each test's result by name.

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "AC 1: groupHighlightsByTeam(highlights, game) in packages/domain/src/highlights.ts groups by team (away, home, then Other; both-team clips in both; empty groups left out), unit-tested (vitest 'S200 AC 1'); nothing under web/src/components/videos/ or web/src/components/scoreboard/ reads .teamIds outside tests"
check 2 "AC 2: a 'Group by' SegmentedControl (Kind default, Team) beside the Layout toggle; grouped by team the team filter gives way to a kind filter (All + each kind with a clip, with counts) through filterHighlights; the choice is not a setting (RTL 'S200 AC 2')"
check 3 "AC 3: list mode draws each clip as a Best of row (thumbnail, title, meta; no rank) in VideoCard, one copy of its markup, in 1 / 2 / 3 columns at mobile / medium / desktop (RTL 'S200 AC 3 mobile|medium|desktop'), and Search's list mode uses the same rows (RTL 'S200 AC 3 search')"
check 4 "AC 4: Hide Scores leaves both groupings' titles as highlightTitle gives them (RTL 'S200 AC 4')"
check 5 "AC 5: no design match: the story's newest text keeps the owner's design exemption, and no S200 capture spec is required"
check 6 "AC 6: S200's Status is done: its snapshot fragment records done"
check 7 "S200 changed no file outside its fence (plus creating scripts/verify-S200.sh and its own records)"

# The commit S200's own changes start from: `git merge-base origin/stage HEAD` when this grader was written.
BASE=6823370945135e843676685e32ca850c696afcfa

TMP="$(mktemp -d /tmp/verify-S200.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

H=packages/domain/src/highlights.ts
(cd packages/domain && pnpm exec vitest run src/highlights.test.ts --reporter=json --outputFile="$TMP/domain.json" >"$TMP/domain.log" 2>&1)
WEB_TESTS=(src/components/videos/VideosRoom.test.tsx src/pages/SearchPage.test.tsx)
(cd web && pnpm exec vitest run "${WEB_TESTS[@]}" --reporter=json --outputFile="$TMP/web.json" >"$TMP/web.log" 2>&1)

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

# --- Check 1: one grouping by team, in the domain ---
grep -qE '^export function groupHighlightsByTeam\(' "$H" || bad 1 "$H does not export groupHighlightsByTeam"
for name in "S200 AC 1 each team" "S200 AC 1 both" "S200 AC 1 neither" "S200 AC 1 no clips"; do
	passed "$TMP/domain.json" "$name" || bad 1 "no passing domain test named '$name'"
done
reads="$(grep -rnE '\bteamIds\b' web/src/components/videos web/src/components/scoreboard --include='*.ts' --include='*.tsx' | grep -vE '\.test\.tsx?:')"
[ -z "$reads" ] || bad 1 "a highlight's teamIds is read outside classifyHighlight / groupHighlightsByTeam: $reads"

# --- Check 2: the switch ---
R=web/src/components/videos/VideosRoom.tsx
grep -qF 'aria-label="Group by"' "$R" || bad 2 "$R has no control labelled 'Group by'"
grep -B4 -F 'aria-label="Group by"' "$R" | grep -qF '<SegmentedControl' || bad 2 "the Group by control is not a SegmentedControl (the Layout toggle's control)"
grep -qF 'groupHighlightsByTeam' "$R" || bad 2 "$R does not group through groupHighlightsByTeam"
[ "$(grep -cE '^export function filterHighlights\(' "$H")" = "1" ] || bad 2 "filterHighlights is not the one filter"
grep -rnqiE 'groupBy|groupHighlightsBy' web/src/settings 2>/dev/null && bad 2 "the grouping became a setting under web/src/settings/"
for name in "S200 AC 2 switch" "S200 AC 2 kind filter"; do
	passed "$TMP/web.json" "$name" || bad 2 "no passing web test named '$name'"
done

# --- Check 3: the list rows ---
for v in mobile medium desktop; do
	passed "$TMP/web.json" "S200 AC 3 $v\\b" || bad 3 "no passing web test named 'S200 AC 3 $v'"
done
passed "$TMP/web.json" "S200 AC 3 search" || bad 3 "no passing web test named 'S200 AC 3 search'"
stills="$(grep -rlE '<VideoStill\b' web/src --include='*.tsx' | grep -vE '\.test\.tsx$')"
[ "$stills" = "web/src/components/videos/VideoCard.tsx" ] || bad 3 "the video row's still is drawn outside VideoCard.tsx: $stills"
grep -rlE 'digest-rank|DigestRow' web/src --include='*.tsx' | grep -qvE '\.test\.tsx$' && bad 3 "a ranked digest row is back under web/src/"

# --- Check 4: Hide Scores ---
passed "$TMP/web.json" "S200 AC 4" || bad 4 "no passing web test named 'S200 AC 4'"

# --- Check 5: no design match ---
node scripts/backlog-vault/text-records.ts newest S200 >"$TMP/story.md" 2>/dev/null || bad 5 "can't read S200's newest text record"
grep -E '^\*\*Design exemption \(rule 18\):\*\*' "$TMP/story.md" | grep -qF 'owner' || bad 5 "S200's text lost the owner's design exemption"

# --- Check 6: Status done ---
[ "$(story_snapshot_status S200)" = "done" ] || bad 6 "S200's snapshot does not record Status done"

# --- Check 7: fence ---
fence='^(packages/domain/|web/src/|web/vitest\.config\.ts$|e2e/design/|docs/v3/design-checks/|docs/v3/backlog/|docs/v3/audit/|changelog\.d/S200\.md$|scripts/verify-S200\.sh$)'
while IFS= read -r f; do
	[ -z "$f" ] && continue
	grep -qE "$fence" <<<"$f" || bad 7 "outside the fence: $f"
done < <(story_own_changed_files S200 "$BASE" .)
own_added="$(story_own_diff S200 "$BASE" --name-status --diff-filter=A -- scripts/verify-S200.sh)"
[ -n "$own_added" ] || [ -n "$(git ls-files --others --exclude-standard -- scripts/verify-S200.sh)" ] || bad 7 "scripts/verify-S200.sh was not created by S200"

report "verify-S200"
exit $?
