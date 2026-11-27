#!/usr/bin/env bash
# Grader for backlog story S151 — Download any video, streamed to disk through the service worker: a same-site route
# the worker answers by passing MLB's MP4 through as an attachment, only for MLB's clip hosts, and the player's
# Download button back, shown only while the controlling worker answers for that route.
# A commit-time proof of this story (S84). Contract: docs/v3/backlog/frame/00 (Verify-script contract).
# No network. Never deploys. No writes outside /tmp. Does its own checking (story-scoped Vitest files only, found by
# the tag each AC's tests carry: "S151 AC <n>").

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "the worker's download route streams MLB's MP4 through unread as an attachment (Content-Length passed on, filename and filename* built from the title, always .mp4); a non-2xx upstream or a rejected fetch answers 502 with no Content-Disposition; tests 'S151 AC 1'"
check 2 "one exported function in packages/domain/src/video-quality.ts decides 'an MLB clip MP4' on the parsed URL (https, no port, no credentials, one of MLB's clip hosts, .mp4 path), the route and the palette both call it, anything else answers 400 with no fetch, and the fetch uses redirect: \"error\"; tests 'S151 AC 2'"
check 3 "the worker keeps what generateSW gave: injectManifest's globPatterns as before (pwa.test.ts asserts injectManifest, not workbox), navigations answered with the page except /api/ and the download route, SKIP_WAITING answered; tests 'S151 AC 3'; e2e/flows/update.spec.ts not among the story's changed files"
check 4 "the palette shows Download, a link to the route for the clip's MP4, only while the controlling worker answers the ping (checked again on controllerchange); none with no controller, an older worker, no MP4 or a non-MLB MP4, and Copy link, Direct link and Share unchanged; tests 'S151 AC 4'"
check 5 "S151's story text (its newest text record) carries an **Owner browser check:** line quoting the owner on a long clip saving whole in Safari, Chrome and Firefox"
check 6 "S151's snapshot records Status done (story_snapshot_status), and the story stays inside its scope files (plus its own records and scripts/verify-S151.sh), touching nothing under scripts/ or test/ but its grader"

# The commit S151's own changes start from (origin/stage when the story started, 2026-11-27). The fence (checks 3
# and 6) reads only S151's own commits from here through story_own_changed_files (scripts/lib/checks.sh).
BASE=75ec0a3a
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
DOMAIN=packages/domain/src/video-quality.ts

# run_tagged <check> <package dir> <tag> — runs every test file under the package's src/ that names <tag>,
# filtered to the tests carrying it; fails when none exists or none passes.
tagged_files() {
  (cd "$1" && grep -rlF --include="*.test.ts" --include="*.test.tsx" -- "$2" src 2>/dev/null)
}
run_tagged() {
  local id="$1" dir="$2" tag="$3" files
  files="$(tagged_files "$dir" "$tag")"
  if [ -z "$files" ]; then
    bad "$id" "no test in $dir/src names '$tag'"
    return
  fi
  # shellcheck disable=SC2086
  if ! (cd "$dir" && pnpm exec vitest run $files -t "$tag" --reporter=json --outputFile="$TMP/r.json" >"$TMP/r.log" 2>&1); then
    bad "$id" "$dir '$tag' failed:"; tail -15 "$TMP/r.log" | sed 's/^/        /'
  elif ! node -e 'const r = require(process.argv[1]); process.exit(r.numPassedTests > 0 && r.numFailedTests === 0 ? 0 : 1)' "$TMP/r.json"; then
    bad "$id" "$dir '$tag' ran no passing test"
  fi
}

# The web module that holds the worker's download route: the one non-test file under web/src/pwa naming
# Content-Disposition.
grep -rlF --include='*.ts' 'Content-Disposition' web/src/pwa 2>/dev/null | grep -v '\.test\.ts$' >"$TMP/route.txt"

# --- Check 1: the download route streams an attachment --------------------------------------------------------
if [ "$(wc -l <"$TMP/route.txt")" -ne 1 ]; then
  bad 1 "expected one module under web/src/pwa building Content-Disposition (the download route), found: $(tr '\n' ' ' <"$TMP/route.txt")"
fi
run_tagged 1 web "S151 AC 1"

# --- Check 2: one domain function decides an MLB clip MP4 -------------------------------------------------------
grep -oE '^export function [A-Za-z0-9]+\(url: string\): boolean' "$DOMAIN" 2>/dev/null | sed -E 's/^export function ([A-Za-z0-9]+).*/\1/' >"$TMP/fn.txt"
fn=""
for f in $(cat "$TMP/fn.txt"); do
  case "$f" in *[Cc]lip*) fn="$f" ;; esac
done
if [ -z "$fn" ]; then
  bad 2 "$DOMAIN exports no function <name containing Clip>(url: string): boolean"
else
  grep -qF 'new URL(' "$DOMAIN" || bad 2 "$DOMAIN never parses the URL (new URL)"
  grep -qF 'MP4_SHAPE' <(awk "/^export function $fn\\(/{f=1} f{print} f&&/^}/{exit}" "$DOMAIN") && bad 2 "$fn uses MP4_SHAPE"
  for host in mlb-cuts-diamond.mlb.com bdata-producedclips.mlb.com darkroom-clips.mlb.com; do
    grep -qF "\"$host\"" "$DOMAIN" || bad 2 "$DOMAIN does not name $host"
  done
  if [ -s "$TMP/route.txt" ]; then
    route="$(head -1 "$TMP/route.txt")"
    grep -qw "$fn" "$route" || bad 2 "the download route ($route) never calls $fn"
    grep -qF 'redirect: "error"' "$route" || bad 2 "the download route ($route) does not fetch with redirect: \"error\""
  fi
  grep -qw "$fn" web/src/components/videos/PlayerActions.tsx || bad 2 "the palette (PlayerActions.tsx) never calls $fn"
fi
run_tagged 2 packages/domain "S151 AC 2"
run_tagged 2 web "S151 AC 2"

# --- Check 3: the worker keeps what generateSW gave ------------------------------------------------------------
grep -qF 'globPatterns: ["**/*.{js,css,html,svg,png,webmanifest}"]' web/src/pwa/options.ts || bad 3 "options.ts's injectManifest.globPatterns changed"
grep -qF 'strategies: "injectManifest"' web/src/pwa/options.ts || bad 3 "options.ts does not build the worker with injectManifest"
grep -qF 'PWA_OPTIONS.injectManifest' web/src/pwa/pwa.test.ts || bad 3 "pwa.test.ts does not assert the injectManifest options"
run_tagged 3 web "S151 AC 3"
story_own_changed_files S151 "$BASE" . >"$TMP/changed.txt"
grep -qxF 'e2e/flows/update.spec.ts' "$TMP/changed.txt" && bad 3 "e2e/flows/update.spec.ts is among the story's changed files"

# --- Check 4: Download in the palette, behind the worker's answer ----------------------------------------------
grep -qF 'controllerchange' web/src/components/videos/PlayerActions.tsx || bad 4 "the palette (PlayerActions.tsx) never asks again on controllerchange"
run_tagged 4 web "S151 AC 4"

# --- Check 5: the owner's browser check, quoted -----------------------------------------------------------------
node scripts/backlog-vault/text-records.ts newest S151 >"$TMP/story.md" 2>/dev/null || bad 5 "no text record for S151"
# The line must quote the owner: an opening quote mark (straight or curly), then a letter, then a closing one,
# so a bare pending or a paraphrase with no quote doesn't pass. Plain `.*` between them, so any locale reads it.
grep -qE '^\*\*Owner browser check:\*\* .*("|“).*[A-Za-z].*("|”)' "$TMP/story.md" || bad 5 "S151's story text has no **Owner browser check:** line quoting the owner (the story parks until the owner answers)"

# --- Check 6: Status done, inside the fence ---------------------------------------------------------------------
[ "$(story_snapshot_status S151)" = "done" ] || bad 6 "S151's snapshot does not record Status done"
grep -vE '^(web/src/|web/vite\.config\.ts$|web/vitest\.config\.ts$|web/tsconfig[^/]*\.json$|web/package\.json$|web/public/|pnpm-lock\.yaml$|packages/domain/|e2e/flows/|docs/v3/backlog/|docs/v3/AUDIT\.md$|docs/v3/audit\.jsonl$|docs/v3/INDEX\.md$|docs/v3/FEATURES\.md$|CHANGELOG\.md$|docs/v3/audit/[^/]+/[^/]+-S151-[a-z-]+\.md$|changelog\.d/S151\.md$|scripts/verify-S151\.sh$)' "$TMP/changed.txt" >"$TMP/fence.txt"
[ -s "$TMP/fence.txt" ] && bad 6 "the story changes files outside its scope: $(tr '\n' ' ' <"$TMP/fence.txt")"
grep -E '^(scripts/|test/)' "$TMP/changed.txt" | grep -vE '^scripts/verify-S151\.sh$' >"$TMP/scripts.txt"
[ -s "$TMP/scripts.txt" ] && bad 6 "the story changes files under scripts/ or test/: $(tr '\n' ' ' <"$TMP/scripts.txt")"

report "verify-S151"
exit $?
