#!/usr/bin/env bash
# Grader for story S159 — A day's favorite teams off: one domain function, favoriteTeamsOff, says
# which of a fan's favorites (those with a game in the shown month) don't play on a regular-season
# day and whether the calendar marks it red (none plays) or yellow (some play); dayHasFavoriteTeam,
# the reverse yes/no it replaces, is removed with its tests.
# A commit-time proof of this story (S84).
# Contract: docs/v3/backlog/frame/00 (Verify-script contract)
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`).

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "favoriteTeamsOff(day, favoriteTeamIds, monthDays) in packages/domain/src/schedule-month.ts, exported from @bt/domain, days typed { teamIds?: readonly number[] | null; regularSeason?: boolean | null }, with every unit-test case AC 1 lists passing in schedule-month.test.ts (tagged \"S159 AC 1 <case>\")"
check 2 "dayHasFavoriteTeam is removed with its tests: no dayHasFavoriteTeam under packages/, web/src/ or functions/src/; ScheduleDayCount.teamIds' comment, and so the committed spec openapi/bt-api.v1.json, says the days a fan's favorites don't play"
check 3 "S159's snapshot records Status done (story_snapshot_status), and the story stays inside its scope files (packages/domain/, docs/v3/backlog/, docs/v3/audit/, changelog.d/, openapi/bt-api.v1.json since the owner's 2026-11-22 answer, plus its own records and scripts/verify-S159.sh), touching nothing else under scripts/ or test/"

# The fence (check 3) reads only S159's own commits from here, through story_own_changed_files.
BASE=b47be925
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
DOMAIN="packages/domain/src/schedule-month.ts"

# --- Check 1: favoriteTeamsOff and its table of cases ---------------------------------------------------
grep -qE '^export function favoriteTeamsOff\(' "$DOMAIN" || bad 1 "$DOMAIN has no exported favoriteTeamsOff"
SIG="$(awk '/^export function favoriteTeamsOff\(/,/^\{/' "$DOMAIN" | tr -d '\n\t')"
grep -qE 'favoriteTeamsOff\(day: [A-Za-z]+, favoriteTeamIds: readonly number\[\], monthDays: readonly [A-Za-z]+\[\]\)' <<<"$SIG" ||
  bad 1 "favoriteTeamsOff's parameters are not (day, favoriteTeamIds: readonly number[], monthDays: readonly <day type>[])"
grep -qE 'teamIds\?: readonly number\[\] \| null;' "$DOMAIN" && grep -qE 'regularSeason\?: boolean \| null;' "$DOMAIN" ||
  bad 1 "$DOMAIN has no day type with teamIds?: readonly number[] | null and regularSeason?: boolean | null"
grep -qE '^export \* from "\./schedule-month\.js";' packages/domain/src/index.ts || bad 1 "@bt/domain does not export schedule-month.ts"

if ! (cd packages/domain && pnpm exec vitest run src/schedule-month.test.ts --reporter=json --outputFile="$TMP/domain.json" >"$TMP/domain.log" 2>&1); then
  bad 1 "packages/domain/src/schedule-month.test.ts failed:"; tail -15 "$TMP/domain.log" | sed 's/^/        /'
fi
[ -f "$TMP/domain.json" ] || echo '{"testResults":[]}' >"$TMP/domain.json"
for t in "no favorites" "teamIds null" "teamIds missing" "no games" "one off" "two off" "one plays" "all play" "listed twice" \
  "empty month" "month unstored" "regularSeason false" "regularSeason null" "regularSeason missing" "october 2023" \
  "yankees off" "before 1998" "july all-star" "unstored favorite"; do
  node -e '
    const r = require(process.argv[1]);
    const tag = process.argv[2];
    const hits = r.testResults.flatMap((f) => f.assertionResults).filter((x) => x.fullName.includes(tag));
    process.exit(hits.length > 0 && hits.every((x) => x.status === "passed") ? 0 : 1);
  ' "$TMP/domain.json" "S159 AC 1 $t" || bad 1 "no passing test in packages/domain/src/schedule-month.test.ts named \"S159 AC 1 $t\""
done

# --- Check 2: dayHasFavoriteTeam is gone -----------------------------------------------------------------
LEFT="$(grep -rln 'dayHasFavoriteTeam' packages web/src functions/src --exclude-dir=node_modules --exclude-dir=dist 2>/dev/null)"
[ -n "$LEFT" ] && bad 2 "dayHasFavoriteTeam is still named in: $(tr '\n' ' ' <<<"$LEFT")"
# The teamIds comment is the spec's description of the field (owner, 2026-11-22: "Yes, add the spec (Recommended)").
SPEC="openapi/bt-api.v1.json"
grep -q "a fan's favorites play without" "$DOMAIN" "$SPEC" && bad 2 "teamIds' comment or $SPEC still says the days a fan's favorites play"
grep -q "favorites don't play" "$DOMAIN" || bad 2 "$DOMAIN's teamIds comment does not say the days a fan's favorites don't play"
grep -q "favorites don't play" "$SPEC" || bad 2 "$SPEC is not regenerated with teamIds' corrected description (pnpm api:spec)"
grep -q '{@link  *favoriteTeamsOff' "$SPEC" && bad 2 "$SPEC carries a {@link favoriteTeamsOff} tag"

# --- Check 3: Status done, inside the fence --------------------------------------------------------------
[ "$(story_snapshot_status S159)" = "done" ] || bad 3 "S159's snapshot does not record Status done"
story_own_changed_files S159 "$BASE" . >"$TMP/changed.txt"
grep -vE '^(packages/domain/|docs/v3/backlog/|docs/v3/audit/|changelog\.d/|openapi/bt-api\.v1\.json$|scripts/verify-S159\.sh$)' "$TMP/changed.txt" >"$TMP/fence.txt"
[ -s "$TMP/fence.txt" ] && bad 3 "the story changes files outside its scope: $(tr '\n' ' ' <"$TMP/fence.txt")"
grep -E '^(test/|scripts/)' "$TMP/changed.txt" | grep -vE '^scripts/verify-S159\.sh$' >"$TMP/test-dir.txt"
[ -s "$TMP/test-dir.txt" ] && bad 3 "the story changes files under scripts/ or test/: $(tr '\n' ' ' <"$TMP/test-dir.txt")"

report "verify-S159"
exit $?
