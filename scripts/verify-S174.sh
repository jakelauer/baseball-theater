#!/usr/bin/env bash
# Grader for backlog story S174 — BT counts, anonymously, which videos fans start and finish: one domain rule for a
# finished view, a clip_engagement table of daily counts per clip behind ClipEngagementRepository, POST
# /api/v1/clips/:mediaId/views, the Videos room's player sending start/complete, and an export for S185's training.
# A commit-time proof of this story (S84). Contract: docs/v3/backlog/frame/00 (Verify-script contract).
# No network. Never deploys. No writes outside /tmp. Does its own checking (story-scoped Vitest files only, found by
# the tag each AC's tests carry: "S174 AC <n>").

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "the story's **Owner answer:** line records the owner's answer with a quotation, and the Privacy policy page's source under web/src/ says BT counts, anonymously, how often each video is started and finished"
check 2 "packages/domain exports ClipViewEvent (\"start\" | \"complete\"), CLIP_COMPLETE_SHARE = 0.9 and clipCompleted(positionSeconds, durationSeconds); table tests 'S174 AC 2' (0, NaN, Infinity, unknown never complete; 90% complete; 89.9% not)"
check 3 "packages/ports has ClipEngagementRepository (record, countsFor, exportRange); one migration makes clip_engagement; the Postgres adapter increments with INSERT … ON CONFLICT … DO UPDATE SET count = count + 1; one contract test runs memory and Postgres (PGlite), concurrent records end at 2, UTC view days; tests 'S174 AC 3'"
check 4 "POST /api/v1/clips/:mediaId/views is in ApiRoutes, dispatched, in the spec with a 204, in the generated client; spec fresh, pnpm api:breaking 0, generated client rendered; tests 'S174 AC 4' (204 counts one; 400 bad event/body/shownPosition; 404 unknown clip; no cookie or session read)"
check 5 "nothing about the viewer: a schema test lists clip_engagement's columns (no user, session, IP, device, user agent or time finer than a day); the classification manifest labels the repository none with its why; tests 'S174 AC 5' and the manifest's law L3 test pass"
check 6 "one sender in web/src/api/ uses navigator.sendBeacon and falls back to fetch with keepalive; the Videos room's player sends start once and complete once per opening; other players send nothing; tests 'S174 AC 6'"
check 7 "root package.json has clips:engagement-export running a script under functions/src/scripts/; tests 'S174 AC 7' (JSON lines for an inclusive range, an empty range writes an empty file and exits 0)"
check 8 "S174's snapshot records Status done (story_snapshot_status), and the story stays inside its scope files (plus its own records and scripts/verify-S174.sh), touching nothing under scripts/ or test/ but its grader"

# The commit S174's own changes start from (origin/stage when the story started, 2026-11-27). The fence (check 8)
# reads only S174's own commits from here through story_own_changed_files (scripts/lib/checks.sh).
BASE=75ec0a3a
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
ROUTE="POST /api/v1/clips/:mediaId/views"
SPEC_PATH="/api/v1/clips/{mediaId}/views"

# run_tagged <check> <package dir> <tag> — runs every test file under the package's src/ that names <tag>,
# filtered to the tests carrying it; fails when none exists or none passes.
tagged_files() {
  (cd "$1" && grep -rlF --include="*.test.ts" --include="*.test.tsx" -- "$2" src 2>/dev/null | grep -v '\.workerd\.test\.ts$')
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

# --- Check 1: the owner's answer, and the Privacy policy first ---------------------------------------------------
node scripts/backlog-vault/text-records.ts newest S174 >"$TMP/story.md" 2>/dev/null
grep -qE '^\*\*Owner answer:\*\*.*\*"[^"]+"\*' "$TMP/story.md" ||
  bad 1 "S174's text has no **Owner answer:** line quoting the owner"
# The Privacy policy's source: the page S154 routes /privacy to (web/src/pages/legal/privacy.md today), or any
# web/src file a later change moves it to. The sentence must name, on one line, that the counts are anonymous and
# that both starts and finishes of videos (clips) are counted.
grep -rlE --include='*.md' --include='*.ts' --include='*.tsx' -i 'privacy policy' web/src 2>/dev/null | grep -vE '\.test\.tsx?$' >"$TMP/privacy-files.txt"
[ -f web/src/pages/legal/privacy.md ] && echo web/src/pages/legal/privacy.md >>"$TMP/privacy-files.txt"
found=""
while read -r f; do
  [ -f "$f" ] || continue
  if grep -iE 'anonym' "$f" | grep -iE 'video|clip' | grep -iE 'start' | grep -qiE 'finish|to the end'; then
    found="$f"
    break
  fi
done < <(sort -u "$TMP/privacy-files.txt")
[ -n "$found" ] || bad 1 "the Privacy policy's source under web/src/ (web/src/pages/legal/privacy.md) has no sentence saying BT counts, anonymously, how often each video is started and finished (AC 1: the story stops and reports, rule 10)"

# --- Check 2: one rule for a finished view ---------------------------------------------------------------------
grep -rqE --include='*.ts' '^export type ClipViewEvent = "start" \| "complete"' packages/domain/src 2>/dev/null ||
  bad 2 "packages/domain exports no ClipViewEvent = \"start\" | \"complete\""
grep -rqE --include='*.ts' '^export const CLIP_COMPLETE_SHARE = 0\.9;' packages/domain/src 2>/dev/null ||
  bad 2 "packages/domain exports no CLIP_COMPLETE_SHARE = 0.9"
grep -rlE --include='*.ts' '^export function clipCompleted\(' packages/domain/src 2>/dev/null | grep -v '\.test\.ts$' >"$TMP/rule.txt"
[ "$(wc -l <"$TMP/rule.txt")" -eq 1 ] || bad 2 "expected exactly one exported clipCompleted in packages/domain, found: $(tr '\n' ' ' <"$TMP/rule.txt")"
# The package's entry re-exports the rule's module, so views and the API import it from @bt/domain.
if [ -s "$TMP/rule.txt" ]; then
  mod="$(basename "$(head -1 "$TMP/rule.txt")" .ts)"
  grep -qF "./$mod.js" packages/domain/src/index.ts || bad 2 "packages/domain/src/index.ts does not re-export ./$mod.js"
fi
run_tagged 2 packages/domain "S174 AC 2"

# --- Check 3: counts, stored -----------------------------------------------------------------------------------
awk '/^export interface ClipEngagementRepository/{f=1} f{print} f&&/^}/{exit}' packages/ports/src/*.ts >"$TMP/port.txt" 2>/dev/null
if [ ! -s "$TMP/port.txt" ]; then
  bad 3 "packages/ports has no ClipEngagementRepository"
else
  for m in 'record\(' 'countsFor\(' 'exportRange\('; do
    grep -qE "$m" "$TMP/port.txt" || bad 3 "ClipEngagementRepository has no ${m%\\(}"
  done
fi
grep -rlF 'clip_engagement' functions/src/adapters/postgres/migrations 2>/dev/null >"$TMP/mig.txt"
[ "$(wc -l <"$TMP/mig.txt")" -eq 1 ] || bad 3 "expected exactly one migration under functions/src/adapters/postgres/migrations naming clip_engagement, found: $(tr '\n' ' ' <"$TMP/mig.txt")"
grep -rlE --include='*.ts' 'ON CONFLICT|onConflictDoUpdate' functions/src/adapters/postgres 2>/dev/null | xargs -r grep -lF 'clip_engagement' 2>/dev/null >"$TMP/pg.txt"
grep -rlE --include='*.ts' 'count \+ 1|count\} \+ 1' functions/src/adapters/postgres 2>/dev/null | grep -v '\.test\.ts$' >"$TMP/inc.txt"
{ [ -s "$TMP/pg.txt" ] && [ -s "$TMP/inc.txt" ]; } || bad 3 "the Postgres adapter does not increment clip_engagement with INSERT … ON CONFLICT … DO UPDATE SET count = count + 1"
run_tagged 3 functions "S174 AC 3"

# --- Check 4: the route, the spec, the generated client --------------------------------------------------------
grep -qF "\"$ROUTE\"" packages/domain/src/api-routes.ts || bad 4 "ApiRoutes (packages/domain/src/api-routes.ts) has no \"$ROUTE\""
grep -qF "route: \"$ROUTE\"" functions/src/handlers/api.ts || bad 4 "API_ROUTER (functions/src/handlers/api.ts) dispatches no \"$ROUTE\""
node -e '
  const spec = require("./openapi/bt-api.v1.json");
  const op = spec.paths?.[process.argv[1]]?.post;
  if (!op) { console.log("has no POST " + process.argv[1]); process.exit(1); }
  for (const s of ["204", "400", "404"]) if (!op.responses?.[s]) { console.log("it lists no " + s); process.exit(1); }
' "$SPEC_PATH" >"$TMP/spec-shape.txt" 2>&1 || bad 4 "openapi/bt-api.v1.json: $(cat "$TMP/spec-shape.txt")"
if ! (cd functions && pnpm exec tsx src/scripts/generate-openapi.ts --check >"$TMP/spec.log" 2>&1); then
  bad 4 "openapi/bt-api.v1.json is stale (pnpm api:spec):"; tail -5 "$TMP/spec.log" | sed 's/^/        /'
fi
pnpm -s api:breaking >"$TMP/brk.log" 2>&1 || { bad 4 "pnpm api:breaking failed:"; tail -8 "$TMP/brk.log" | sed 's/^/        /'; }
grep -qF "\"$SPEC_PATH\"" web/src/api/generated/bt-api.v1.ts 2>/dev/null || bad 4 "the generated client (web/src/api/generated/bt-api.v1.ts) has no \"$SPEC_PATH\""
if ! (cd web && pnpm exec vitest run src/api/codegen.test.ts >"$TMP/codegen.log" 2>&1); then
  bad 4 "web/src/api/generated/ is not rendered from the current spec (web/src/api/codegen.test.ts):"; tail -8 "$TMP/codegen.log" | sed 's/^/        /'
fi
run_tagged 4 functions "S174 AC 4"

# --- Check 5: nothing about the viewer -------------------------------------------------------------------------
grep -qE 'ClipEngagement|clipEngagement' functions/src/services/data-classification.ts ||
  bad 5 "the classification manifest (functions/src/services/data-classification.ts) does not name the clip engagement repository"
grep -qiF 'nothing about who watched' functions/src/services/data-classification.ts ||
  bad 5 "the classification manifest gives no why (\"nothing about who watched\") for the clip engagement repository"
run_tagged 5 functions "S174 AC 5"
if ! (cd functions && pnpm exec vitest run src/services/data-classification.test.ts >"$TMP/l3.log" 2>&1); then
  bad 5 "law L3's manifest test (functions/src/services/data-classification.test.ts) fails:"; tail -8 "$TMP/l3.log" | sed 's/^/        /'
fi

# --- Check 6: the Videos room's player sends it ------------------------------------------------------------------
grep -rlF --include='*.ts' 'sendBeacon' web/src/api 2>/dev/null | grep -v '\.test\.ts$' >"$TMP/sender.txt"
[ "$(wc -l <"$TMP/sender.txt")" -eq 1 ] || bad 6 "expected exactly one module in web/src/api using navigator.sendBeacon, found: $(tr '\n' ' ' <"$TMP/sender.txt")"
[ -s "$TMP/sender.txt" ] && { grep -qF 'keepalive' "$(head -1 "$TMP/sender.txt")" || bad 6 "the sender ($(head -1 "$TMP/sender.txt")) has no fetch fallback with keepalive"; }
grep -rlF 'sendBeacon' web/src --include='*.ts' --include='*.tsx' 2>/dev/null | grep -vE '^web/src/api/|\.test\.tsx?$' >"$TMP/beacon-elsewhere.txt"
[ -s "$TMP/beacon-elsewhere.txt" ] && bad 6 "navigator.sendBeacon is used outside web/src/api: $(tr '\n' ' ' <"$TMP/beacon-elsewhere.txt")"
grep -qw 'clipCompleted' web/src/components/videos/*.tsx 2>/dev/null || bad 6 "no player under web/src/components/videos calls clipCompleted"
run_tagged 6 web "S174 AC 6"

# --- Check 7: export for training --------------------------------------------------------------------------------
node -e '
  const s = require("./package.json").scripts?.["clips:engagement-export"];
  if (!s) { console.log("has no clips:engagement-export script"); process.exit(1); }
  if (!/src\/scripts\/[A-Za-z0-9-]+\.ts/.test(s)) { console.log("clips:engagement-export does not run a functions/src/scripts/ module: " + s); process.exit(1); }
' >"$TMP/pkg.txt" 2>&1 || bad 7 "package.json: $(cat "$TMP/pkg.txt")"
run_tagged 7 functions "S174 AC 7"

# --- Check 8: Status done, inside the fence ---------------------------------------------------------------------
[ "$(story_snapshot_status S174)" = "done" ] || bad 8 "S174's snapshot does not record Status done"
story_own_changed_files S174 "$BASE" . >"$TMP/changed.txt"
# docs/v3/audit/ is in S174's Scope files as a whole, so its own ledger fragments and text records need no extra rule.
grep -vE '^(packages/domain/|packages/ports/|functions/src/|functions/vitest\.config\.ts$|openapi/|web/src/api/|web/src/components/videos/|web/vitest\.config\.ts$|package\.json$|docs/v3/backlog/|docs/v3/audit/|changelog\.d/S174\.md$|scripts/verify-S174\.sh$)' "$TMP/changed.txt" >"$TMP/fence.txt"
[ -s "$TMP/fence.txt" ] && bad 8 "the story changes files outside its scope: $(tr '\n' ' ' <"$TMP/fence.txt")"
grep -E '^(scripts/|test/)' "$TMP/changed.txt" | grep -vE '^scripts/verify-S174\.sh$' >"$TMP/scripts.txt"
[ -s "$TMP/scripts.txt" ] && bad 8 "the story changes files under scripts/ or test/: $(tr '\n' ' ' <"$TMP/scripts.txt")"

report "verify-S174"
exit $?
