#!/usr/bin/env bash
# Grader for BACKLOG story S132 — The releases API: every approved release's notes in one request.
# `GET /api/v1/releases` answers `current` (S131's currentRelease over the approved notes) and
# `releases` (every approved notes file in the build, newest first; drafts never), from a bundle
# `pnpm release:bundle` writes from releases/*.json with S131's parser, so nothing reads the file
# system at request time and the Worker serves it; a stale bundle fails a drift test. The answer is
# cacheable for at most 5 minutes in all, has no `after` query, is in the OpenAPI spec (additive)
# with one typed web client function, and CLAUDE.md's release rule names the bundle command.
# A commit-time proof of this story (S84).
# Contract: frame note 00, "Verify-script contract" (docs/v3/backlog/frame/).
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`).

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "GET /api/v1/releases is in api-routes.ts and answers current (currentRelease) and releases (every approved notes file, newest first, never a draft), tested with a draft newer than the newest approved and with none approved (current null, releases [])"
check 2 "the route takes no after query: the spec's GET /api/v1/releases has no parameter named after (jq) and client.ts's releases call sends no after query key"
check 3 "pnpm release:bundle bundles releases/*.json, parsed once with parseReleaseNotes, into functions/src/generated/release-notes.json; the service reads no file system; a workerd request returns the bundle; a drift test fails a stale bundle; the command refuses an unparsable file and one whose version doesn't match its name (tests)"
check 4 "the answer's Cache-Control is cacheable for at most 300s in all (max-age/s-maxage plus stale-while-revalidate), header test"
check 5 "the route is in openapi/bt-api.v1.json (pnpm api:spec up to date), pnpm api:breaking exits 0, and web/src/api/client.ts has one function for it typed from the generated spec"
check 6 "CLAUDE.md's release rule names pnpm release:bundle as part of landing a release's notes"
check 7 "S132's snapshot records Status done (story_snapshot_status), and the story stays inside its scope files (plus its own records and scripts/verify-S132.sh)"

# HEAD when S132 started (origin/stage after S167 merged, #319). The fence (check 7) reads only S132's own
# commits from here, through story_own_changed_files (scripts/lib/checks.sh).
BASE=9cc721bc15a321c86b1ef56e7dbb683229d445ae
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
ROUTES="packages/domain/src/api-routes.ts"
NOTES="packages/domain/src/release-notes.ts"
SERVICE="functions/src/services/releases.ts"
BUNDLE="functions/src/generated/release-notes.json"
BUNDLER="functions/src/scripts/release-bundle.ts"
CLIENT="web/src/api/client.ts"
SPEC="openapi/bt-api.v1.json"

# Runs one test file once, as JSON, so each AC can then require its own tagged tests.
run_json() {
  local dir="$1" file="$2" out="$3"
  shift 3
  [ -f "$dir/$file" ] &&(cd "$dir" && pnpm exec vitest run "$@" --reporter=json --outputFile="$out" >"$out.log" 2>&1)
  [ -f "$out" ] || echo '{"testResults":[]}' >"$out"
}
# An AC needs at least one passing test whose full name carries its tag, and every such test passes.
tagged() {
  local id="$1" json="$2" tag="$3" where="$4"
  node -e '
    const r = require(process.argv[1]);
    const tag = process.argv[2];
    const hits = r.testResults.flatMap((f) => f.assertionResults).filter((t) => t.fullName.includes(tag));
    process.exit(hits.length > 0 && hits.every((t) => t.status === "passed") ? 0 : 1);
  ' "$json" "$tag" || bad "$id" "no passing test in $where named \"$tag\""
}

DOMAIN_JSON="$TMP/domain.json"
run_json packages/domain src/release-notes.test.ts "$DOMAIN_JSON" src/release-notes.test.ts
SERVICE_JSON="$TMP/service.json"
run_json functions src/services/releases.test.ts "$SERVICE_JSON" src/services/releases.test.ts
BUNDLE_JSON="$TMP/bundle.json"
run_json functions src/scripts/release-bundle.test.ts "$BUNDLE_JSON" src/scripts/release-bundle.test.ts
WORKER_JSON="$TMP/worker.json"
run_json functions src/worker.workerd.test.ts "$WORKER_JSON" --config vitest.workers.config.ts src/worker.workerd.test.ts -t "S132"

# --- Check 1: the route, current and releases ------------------------------------------------------------------
grep -qE '^\s*"GET /api/v1/releases": "ReleasesResponse",$' "$ROUTES" || bad 1 "$ROUTES has no \"GET /api/v1/releases\": \"ReleasesResponse\" route"
awk '/^export interface ReleasesResponse/,/^}/' "$ROUTES" >"$TMP/response.txt"
grep -qE '^\s*current: ReleaseNotes \| null;' "$TMP/response.txt" || bad 1 "ReleasesResponse has no current: ReleaseNotes | null"
grep -qE '^\s*releases: ReleaseNotes\[\];' "$TMP/response.txt" || bad 1 "ReleasesResponse has no releases: ReleaseNotes[]"
grep -qE '^export function approvedReleasesNewestFirst\(' "$NOTES" || bad 1 "$NOTES has no approvedReleasesNewestFirst, the one ordering of approved notes"
grep -qF 'currentRelease(' "$SERVICE" 2>/dev/null || bad 1 "$SERVICE does not answer current with S131's currentRelease"
grep -qF 'approvedReleasesNewestFirst(' "$SERVICE" 2>/dev/null || bad 1 "$SERVICE does not list releases with approvedReleasesNewestFirst"
tagged 1 "$DOMAIN_JSON" "S132 AC 1" "packages/domain/src/release-notes.test.ts"
tagged 1 "$SERVICE_JSON" "S132 AC 1 draft newer" "functions/src/services/releases.test.ts"
tagged 1 "$SERVICE_JSON" "S132 AC 1 none approved" "functions/src/services/releases.test.ts"

# --- Check 2: no after query -------------------------------------------------------------------------------------
if [ ! -f "$SPEC" ] || ! jq -e '.paths["/api/v1/releases"].get' "$SPEC" >/dev/null 2>&1; then
  bad 2 "$SPEC has no GET /api/v1/releases to read"
elif jq -e '[.paths["/api/v1/releases"].get.parameters[]? | select(.name == "after")] | length > 0' "$SPEC" >/dev/null; then
  bad 2 "$SPEC's GET /api/v1/releases has a parameter named after"
fi
awk '/^export async function fetchReleases\(/,/^}/' "$CLIENT" >"$TMP/client-fn.txt"
if [ ! -s "$TMP/client-fn.txt" ]; then
  bad 2 "$CLIENT has no fetchReleases to read"
elif grep -qE '\bafter\b' "$TMP/client-fn.txt"; then
  bad 2 "$CLIENT's fetchReleases sends an after query key"
fi

# --- Check 3: one bundle command, no file system at request time, drift, refusals ---------------------------------
node -e 'process.exit(require(process.argv[1]).scripts?.["release:bundle"]?.includes("release-bundle-cli.ts") ? 0 : 1)' "$PWD/package.json" ||
  bad 3 "package.json has no release:bundle script running release-bundle-cli.ts"
[ -f "$BUNDLE" ] || bad 3 "$BUNDLE (the committed bundle) is missing"
grep -qF 'parseReleaseNotes(' "$BUNDLER" 2>/dev/null || bad 3 "$BUNDLER does not parse with S131's parseReleaseNotes"
grep -qF 'RELEASES_DIR' "$BUNDLER" 2>/dev/null || bad 3 "$BUNDLER does not read S131's RELEASES_DIR"
grep -qF 'generated/release-notes.json' "$SERVICE" 2>/dev/null || bad 3 "$SERVICE does not import the bundle"
grep -qE 'node:fs|readFile|readdir' "$SERVICE" 2>/dev/null && bad 3 "$SERVICE reads the file system"
tagged 3 "$BUNDLE_JSON" "S132 AC 3 drift" "functions/src/scripts/release-bundle.test.ts"
tagged 3 "$BUNDLE_JSON" "S132 AC 3 unparsable" "functions/src/scripts/release-bundle.test.ts"
tagged 3 "$BUNDLE_JSON" "S132 AC 3 version mismatch" "functions/src/scripts/release-bundle.test.ts"
tagged 3 "$BUNDLE_JSON" "S132 AC 3 approved" "functions/src/scripts/release-bundle.test.ts"
tagged 3 "$WORKER_JSON" "S132 AC 3 worker" "functions/src/worker.workerd.test.ts"

# --- Check 4: at most 5 minutes in all ----------------------------------------------------------------------------
tagged 4 "$SERVICE_JSON" "S132 AC 4" "functions/src/services/releases.test.ts"

# --- Check 5: spec, breaking diff, typed client -------------------------------------------------------------------
jq -e '.paths["/api/v1/releases"].get.responses["200"].content["application/json"].schema["$ref"] == "#/components/schemas/ReleasesResponse"' "$SPEC" >/dev/null 2>&1 ||
  bad 5 "$SPEC's GET /api/v1/releases does not answer ReleasesResponse"
if ! (cd functions && pnpm exec tsx src/scripts/generate-openapi.ts --check >"$TMP/spec.log" 2>&1); then
  bad 5 "$SPEC is stale (pnpm api:spec):"; tail -5 "$TMP/spec.log" | sed 's/^/        /'
fi
pnpm -s api:breaking >"$TMP/breaking.log" 2>&1 || { bad 5 "pnpm api:breaking fails:"; tail -10 "$TMP/breaking.log" | sed 's/^/        /'; }
grep -qF '"/api/v1/releases": {' web/src/api/generated/bt-api.v1.ts || bad 5 "web/src/api/generated/bt-api.v1.ts has no /api/v1/releases"
[ "$(grep -c 'api.GET("/api/v1/releases"' "$CLIENT")" = "1" ] || bad 5 "$CLIENT does not call api.GET(\"/api/v1/releases\") exactly once"
grep -qF 'api.GET("/api/v1/releases"' "$TMP/client-fn.txt" || bad 5 "$CLIENT's fetchReleases does not call the typed api.GET(\"/api/v1/releases\")"
CODEGEN_JSON="$TMP/codegen.json"
run_json web src/api/codegen.test.ts "$CODEGEN_JSON" src/api/codegen.test.ts
node -e 'const r = require(process.argv[1]); process.exit(r.numPassedTests > 0 && r.numFailedTests === 0 ? 0 : 1)' "$CODEGEN_JSON" ||
  bad 5 "web/src/api/codegen.test.ts (generated client drift) fails"

# --- Check 6: the release rule names the bundle command -----------------------------------------------------------
grep -E '^- \*\*The coordinator manages releases' CLAUDE.md | grep -qF 'pnpm release:bundle' ||
  bad 6 "CLAUDE.md's release rule does not name pnpm release:bundle"

# --- Check 7: Status done, inside the fence -----------------------------------------------------------------------
[ "$(story_snapshot_status S132)" = "done" ] || bad 7 "S132's snapshot does not record Status done"
story_own_changed_files S132 "$BASE" . >"$TMP/changed.txt"
grep -vE '^(functions/src/|functions/vitest\.config\.ts$|package\.json$|packages/domain/|openapi/|web/src/api/|CLAUDE\.md$|docs/v3/backlog/|docs/v3/AUDIT\.md$|docs/v3/audit\.jsonl$|docs/v3/INDEX\.md$|CHANGELOG\.md$|scripts/verify-S132\.sh$|docs/v3/audit/[^/]+/[^/]*-S132-[^/]*\.md$|changelog\.d/S132\.md$)' "$TMP/changed.txt" >"$TMP/fence.txt"
[ -s "$TMP/fence.txt" ] && bad 7 "the story changes files outside its scope: $(tr '\n' ' ' <"$TMP/fence.txt")"
grep -E '^(test/|scripts/)' "$TMP/changed.txt" | grep -vE '^scripts/verify-S132\.sh$' >"$TMP/test-dir.txt"
[ -s "$TMP/test-dir.txt" ] && bad 7 "the story changes files under scripts/ or test/: $(tr '\n' ' ' <"$TMP/test-dir.txt")"

report "verify-S132"
exit $?
