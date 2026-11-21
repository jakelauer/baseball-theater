#!/usr/bin/env bash
# Grader for BACKLOG story S143 — staging signs in with a mock account (one fixed credential, one
# fixed test account, traded at POST /api/v1/sign-in for an ordinary BT session, wired only where
# BT_MOCK_SIGN_IN is "1" and no Logto tenant is named), and a site with no sign-in at all (previews)
# shows no "Sign in" button. A commit-time proof of this story (S84).
# Contract: docs/v3/BACKLOG.md#verify-script-contract
# No network. Never deploys. No writes outside /tmp. Does its own checking (story-scoped Vitest
# files only, found by the tag each AC's tests carry: "S143 AC <n>").

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "a mock IdentityProvider under functions/src/adapters/ signs in with one exported fixed credential (not dev:) as provider \"mock\", one fixed subject, a fixed email on stage.baseball.theater, emailVerified true and authTime from an injected clock; any other credential (another string, empty, dev:test-user) throws CredentialRefusedError (tests 'S143 AC 1')"
check 2 "one exported function in functions/src/worker-app.ts wires the mock only where BT_MOCK_SIGN_IN is \"1\" and neither LOGTO_ENDPOINT nor LOGTO_APP_ID is set; wrangler.jsonc sets BT_MOCK_SIGN_IN in env.staging's vars only, and env.staging names no LOGTO_* var; dev: sign-in still gated on BT_LOCAL (tests 'S143 AC 2')"
check 3 "GET /api/v1/sign-in answers mock true/false beside logto; POST with the mock credential answers 200 { token } through signIn where wired, 401 sign_in_refused where another provider is wired, 404 where none is (tests 'S143 AC 3'); the spec carries mock and is up to date (pnpm api:spec), pnpm api:breaking exits 0, and web/src/api/generated/ is rendered from it again"
check 4 "in workerd, with BT_MOCK_SIGN_IN=1 and no BT_LOCAL: the mock signs in, /me answers the test account, settings save and read back, a second sign-in finds the same uid and settings, deletion works with no Logto admin and the next sign-in makes a new account with house defaults; without the var the mock is refused; Bearer dev:test-user refused either way (workerd tests 'S143 AC 4')"
check 5 "web: where the Worker says mock: true, Sign in (and Settings' Sign in again) hands the mock credential to POST /api/v1/sign-in, keeps the token and shows the account with no navigation and no Logto SDK; sign-out returns to signed out with no Logto sign-out; the deployed loader with mock: true never imports AuthClient.ts (RTL tests 'S143 AC 5')"
check 6 "web: the header shows no Sign in where a production build's Worker answers logto: null and mock: false, shows it for Logto, the mock and a dev build, hides it while the answer loads, shows it when the request fails (a click asks again); one read of the answer per page load serves header and sign-in (RTL tests 'S143 AC 6')"
check 7 "none of wrangler.jsonc, README.md, worker-app.ts, accounts.ts, openapi.ts, api-routes.ts, openapi/bt-api.v1.json, web/src/api/generated/ says 'until its own', 'tenant of its own' or 'own tenant's once it exists'; wrangler.jsonc, WorkerEnv's comment and README say staging signs in with the mock test account and previews have none"
check 8 "backlog Status is done (story heading and Story status table)"
check 9 "the story changed nothing outside its fence (functions/src/, functions/vitest*.config.ts, openapi/, packages/domain/src/api-routes.ts, web/src/, web/vitest.config.ts, wrangler.jsonc, README.md, docs/v3/BACKLOG.md, docs/v3/backlog/, docs/v3/AUDIT.md, docs/v3/audit.jsonl, docs/v3/INDEX.md, CHANGELOG.md, scripts/verify-S143.sh)"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
BASE="dd930b5"  # HEAD when S143 started; the story's work comes after it

# run_tagged <check> <package dir> <vitest config args> <tag> — runs every test file under the package's
# src/ that names <tag>, filtered to the tests carrying it; fails when none exists or none passes.
run_tagged() {
  local id="$1" dir="$2" config="$3" tag="$4" files
  if [ -n "$config" ]; then
    files="$(cd "$dir" && grep -rlF --include='*.workerd.test.ts' -- "$tag" src 2>/dev/null)"
  else
    files="$(cd "$dir" && grep -rlF --include='*.test.ts' --include='*.test.tsx' -- "$tag" src 2>/dev/null | grep -v '\.workerd\.test\.ts$')"
  fi
  if [ -z "$files" ]; then
    bad "$id" "no test in $dir/src names '$tag'"
    return
  fi
  # shellcheck disable=SC2086
  if ! (cd "$dir" && pnpm exec vitest run $config $files -t "$tag" --reporter=json --outputFile="$TMP/r.json" >"$TMP/r.log" 2>&1); then
    bad "$id" "$dir '$tag' failed:"; tail -15 "$TMP/r.log" | sed 's/^/        /'
  elif ! node -e 'const r = require(process.argv[1]); process.exit(r.numPassedTests > 0 && r.numFailedTests === 0 ? 0 : 1)' "$TMP/r.json"; then
    bad "$id" "$dir '$tag' ran no passing test"
  fi
}

# --- Check 1: the mock IdentityProvider ---------------------------------------------------------------
MOCKS="$(grep -rlE 'implements IdentityProvider' functions/src/adapters 2>/dev/null | xargs grep -lF '"mock"' 2>/dev/null)"
if [ -z "$MOCKS" ]; then
  bad 1 "no IdentityProvider under functions/src/adapters/ names its provider \"mock\""
else
  # The credential is one constant, MOCK_SIGN_IN_CREDENTIAL: defined in @bt/domain (the web app sends it
  # too) and exported from the provider's file, or defined there.
  grep -qE '^export (const MOCK_SIGN_IN_CREDENTIAL = "|\{ MOCK_SIGN_IN_CREDENTIAL \})' $MOCKS ||
    bad 1 "the mock provider's file does not export MOCK_SIGN_IN_CREDENTIAL"
  cred="$(grep -hoE '^export const MOCK_SIGN_IN_CREDENTIAL = "[^"]*"' $MOCKS packages/domain/src/api-routes.ts | head -1)"
  [ -n "$cred" ] || bad 1 "MOCK_SIGN_IN_CREDENTIAL is defined neither in the provider's file nor in packages/domain/src/api-routes.ts"
  case "$cred" in *'"dev:'*) bad 1 "the mock credential is a dev: token" ;; esac
  grep -qF '@stage.baseball.theater' $MOCKS || bad 1 "the mock account's email is not on stage.baseball.theater"
  grep -qF 'CredentialRefusedError' $MOCKS || bad 1 "the mock provider does not refuse with CredentialRefusedError"
fi
run_tagged 1 functions "" "S143 AC 1"

# --- Check 2: where the mock is wired -----------------------------------------------------------------
grep -qE '^export function [A-Za-z]+\(env: WorkerEnv\): boolean' functions/src/worker-app.ts &&
  grep -qE 'BT_MOCK_SIGN_IN === "1"' functions/src/worker-app.ts ||
  bad 2 "functions/src/worker-app.ts has no exported function gating the mock on BT_MOCK_SIGN_IN === \"1\""
grep -qE 'BT_LOCAL === "1"' functions/src/worker-app.ts || bad 2 "the dev provider is no longer gated on BT_LOCAL"
node -e '
  const { readFileSync } = require("node:fs");
  const w = JSON.parse(readFileSync("wrangler.jsonc", "utf8").replace(/^\s*\/\/.*$/gm, ""));
  const errs = [];
  const has = (o) => o && Object.prototype.hasOwnProperty.call(o, "BT_MOCK_SIGN_IN");
  if (has(w.vars)) errs.push("top-level vars set BT_MOCK_SIGN_IN");
  for (const [n, e] of Object.entries(w.env ?? {})) {
    if (n === "staging") continue;
    if (JSON.stringify(e).includes("BT_MOCK_SIGN_IN")) errs.push("env." + n + " sets BT_MOCK_SIGN_IN");
  }
  const s = (w.env ?? {}).staging?.vars ?? {};
  if (s.BT_MOCK_SIGN_IN !== "1") errs.push("env.staging vars do not set BT_MOCK_SIGN_IN to \"1\"");
  for (const k of Object.keys(s)) if (/^LOGTO_/.test(k)) errs.push("env.staging names " + k);
  for (const e of errs) console.log(e);
' >"$TMP/wr.txt" 2>&1
[ -s "$TMP/wr.txt" ] && while IFS= read -r line; do bad 2 "$line"; done <"$TMP/wr.txt"
run_tagged 2 functions "" "S143 AC 2"

# --- Check 3: the sign-in route, the spec and the generated types ----------------------------------------
run_tagged 3 functions "" "S143 AC 3"
node -e '
  const spec = require("./openapi/bt-api.v1.json");
  const s = spec.components?.schemas?.SignInConfigResponse;
  const ok = s && s.properties && s.properties.mock && s.properties.mock.type === "boolean" && (s.required ?? []).includes("mock") && s.properties.logto;
  process.exit(ok ? 0 : 1);
' || bad 3 "openapi/bt-api.v1.json's SignInConfigResponse has no required boolean mock beside logto"
if ! (cd functions && pnpm exec tsx src/scripts/generate-openapi.ts --check >"$TMP/spec.log" 2>&1); then
  bad 3 "openapi/bt-api.v1.json is stale (pnpm api:spec):"; tail -5 "$TMP/spec.log" | sed 's/^/        /'
fi
if ! pnpm -s api:breaking >"$TMP/brk.log" 2>&1; then
  bad 3 "pnpm api:breaking failed:"; tail -8 "$TMP/brk.log" | sed 's/^/        /'
fi
awk '/^        SignInConfigResponse: \{/{f=1} f{print} f&&/^        \};/{exit}' web/src/api/generated/bt-api.v1.ts | grep -qE '^ +mock: boolean;' ||
  bad 3 "web/src/api/generated/bt-api.v1.ts's SignInConfigResponse has no mock: boolean"
if ! (cd web && pnpm exec vitest run src/api/codegen.test.ts >"$TMP/codegen.log" 2>&1); then
  bad 3 "web/src/api/generated/ is not rendered from the current spec (web/src/api/codegen.test.ts):"; tail -8 "$TMP/codegen.log" | sed 's/^/        /'
fi

# --- Check 4: the whole account behind the mock, in workerd ------------------------------------------------
run_tagged 4 functions "--config vitest.workers.config.ts" "S143 AC 4"

# --- Check 5: the web app signs in with the mock ------------------------------------------------------------
run_tagged 5 web "" "S143 AC 5"

# --- Check 6: no Sign in where there is no sign-in -------------------------------------------------------------
run_tagged 6 web "" "S143 AC 6"

# --- Check 7: the docs say what staging and previews do -------------------------------------------------------
for f in wrangler.jsonc README.md functions/src/worker-app.ts functions/src/services/accounts.ts functions/src/services/openapi.ts \
  packages/domain/src/api-routes.ts openapi/bt-api.v1.json web/src/api/generated; do
  for phrase in "until its own" "tenant of its own" "own tenant's once it exists"; do
    grep -rqF -- "$phrase" "$f" && bad 7 "$f still says '$phrase'"
  done
done
grep -qF 'BT_MOCK_SIGN_IN' README.md || bad 7 "README.md does not name BT_MOCK_SIGN_IN"
grep -iqE 'staging[^.]*mock|mock[^.]*staging' README.md || bad 7 "README.md does not say staging signs in with the mock"
grep -iqE 'previews?[^.]*no sign-in|no sign-in[^.]*previews?' README.md || bad 7 "README.md does not say previews offer no sign-in"
grep -E '^\s*//' wrangler.jsonc | grep -iqE 'staging[^.]*mock|mock[^.]*staging' || bad 7 "wrangler.jsonc's comments do not say staging signs in with the mock"
awk '/^export type WorkerEnv = \{/{f=1} f{print} f&&/^\};/{exit}' functions/src/worker-app.ts >"$TMP/env.txt"
grep -qF 'BT_MOCK_SIGN_IN' "$TMP/env.txt" && grep -iqE 'staging' "$TMP/env.txt" && grep -iqE 'preview' "$TMP/env.txt" ||
  bad 7 "WorkerEnv's doc comments do not name BT_MOCK_SIGN_IN, staging and previews"

# --- Check 8: backlog Status is done ------------------------------------------------------------------------
grep -qE '^\| [0-9]+ \| \[S143\].*\| `done` \|' docs/v3/BACKLOG.md ||
  bad 8 "S143 row in the Story status table is not \`done\`"
awk '/^### S143 —/{f=1;next} /^### S[0-9]/{f=0} f' docs/v3/BACKLOG.md >"$TMP/s143.md"
grep -qE '^\*\*Status:\*\* `done`$' "$TMP/s143.md" || bad 8 "S143 story heading Status is not \`done\`"

# --- Check 9: the fence -------------------------------------------------------------------------------------
# core.quotepath=false: git otherwise prints a name with a non-ASCII character (the frame note
# "00 Baseball Theater v3 — Checkable backlog.md") quoted and escaped, which no pattern below matches.
GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.quotepath GIT_CONFIG_VALUE_0=false story_changed_files S143 "$BASE" . |
  grep -vE '^(functions/src/|functions/vitest\.config\.ts$|functions/vitest\.workers\.config\.ts$|openapi/|packages/domain/src/api-routes\.ts$|web/src/|web/vitest\.config\.ts$|wrangler\.jsonc$|README\.md$|docs/v3/BACKLOG\.md$|docs/v3/backlog/|docs/v3/AUDIT\.md$|docs/v3/audit\.jsonl$|docs/v3/INDEX\.md$|CHANGELOG\.md$|scripts/verify-S143\.sh$|docs/v3/\.obsidian/)' >"$TMP/out.txt"
[ -s "$TMP/out.txt" ] && { bad 9 "files changed outside the fence:"; sed 's/^/        /' "$TMP/out.txt"; }

report "verify-S143"
exit $?
