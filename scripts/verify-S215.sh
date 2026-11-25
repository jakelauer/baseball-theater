#!/usr/bin/env bash
# Grader for backlog story S215 — on the staging site only, a signed-in tester chooses a backer tier
# to see BT as that patron would (owner, 2026-11-24: "Stage needs a special stage-only feature which
# allows the user to select their backer tier, for testing purposes. This functionality must not be
# available or visible in production."). A commit-time proof of this story (S84).
# Contract: frame note 00, "Verify-script contract" (docs/v3/backlog/frame/).
# No network. Never deploys. No writes outside /tmp. Does its own checking (story-scoped Vitest files
# only, found by the tag each AC's tests carry: "S215 AC <n>").

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "AC 1: packages/domain/src/entitlements.ts exports effectiveEntitlements(real, override, overrideAllowed); no file under functions/src/ or web/src/ calls entitlementsForTier except accounts.ts's new-account default, tests and *-contract.ts; signIn, GET /api/v1/me and the override route call effectiveEntitlements; unit tests (all five tiers, null, not allowed) and the production-config zero-getTierOverride test pass (tests 'S215 AC 1')"
check 2 "AC 2: functions/src/worker-app.ts exports tierOverrideAllowed(env: WorkerEnv): boolean gated on BT_TIER_OVERRIDE === \"1\" and mockSignInAllowed(env); wrangler.jsonc sets BT_TIER_OVERRIDE \"1\" in env.staging's vars only (not top level, env.production, env.preview); local-server.ts never sets it; tests pass (tests 'S215 AC 2')"
check 3 "AC 3: the user repository port declares getTierOverride/setTierOverride; a new migration adds a table (not an entitlements column) whose uid references users.uid; data-classification labels it personal, deletedBy USERS_STORE; the repository contract's override, export and deletion cases pass on memory and Postgres (tests 'S215 AC 3')"
check 4 "AC 4: GET and PUT /api/v1/me/tier-override are in the route table, the OpenAPI spec (up to date, pnpm api:breaking exits 0) and web/src/api/generated/; workerd tests under production's, staging's and preview's configs pass (404 off staging, 200/400 on it, no-store, session carries the chosen tier) (workerd tests 'S215 AC 4')"
check 5 "AC 5: the Settings page asks GET /api/v1/me/tier-override through one named hook under web/src/api/ and renders 'Testing only (staging): backer tier override' only on a 200; RTL tests pass (tests 'S215 AC 5')"
check 6 "AC 6: the story text carries the owner's design exemption quote, and the testing label is rendered (the AC 5 RTL test)"
check 7 "AC 7: effectiveEntitlements, tierOverrideAllowed, the port methods, the table, the route handler, the Settings control and wrangler.jsonc's BT_TIER_OVERRIDE line each say staging tests only, production refuses it on the server, and it never touches the real tier or Patreon"
check 8 "AC 8: S215 changed no file outside its fence (plus creating scripts/verify-S215.sh and its own records), and its snapshot records Status done"

# The commit S215's own changes start from: `git merge-base origin/stage HEAD` when this grader was written.
BASE=ea39e6ea

TMP="$(mktemp -d /tmp/verify-S215.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

ENT=packages/domain/src/entitlements.ts
WAPP=functions/src/worker-app.ts
PORT=packages/ports/src/auth.ts
CLASS=functions/src/services/data-classification.ts
SETTINGS=web/src/pages/SettingsPage.tsx
LABEL="Testing only (staging): backer tier override"

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

# doc_before <file> <regex> — the comment lines (a JSDoc block or a run of // lines) right above the first
# line matching <regex>; empty when there is none.
doc_before() {
	node -e '
		const lines = require("node:fs").readFileSync(process.argv[1], "utf8").split("\n");
		const re = new RegExp(process.argv[2]);
		const at = lines.findIndex((l) => re.test(l));
		if (at < 0) process.exit(0);
		const out = [];
		for (let i = at - 1; i >= 0; i--)
		{
			const t = lines[i].trim();
			if (/^(\/\*\*|\*|\*\/|\/\/|\{\/\*)/.test(t)) out.unshift(lines[i]);
			else break;
		}
		console.log(out.join("\n"));
	' "$1" "$2" 2>/dev/null
}
# says_why <check> <what> <text> — the comment names staging, production's refusal and the real tier / Patreon.
says_why() {
	local id="$1" what="$2" text="$3"
	if [ -z "$text" ]; then bad "$id" "$what has no comment"; return; fi
	grep -qi 'staging' <<<"$text" || bad "$id" "$what's comment does not say the override is for staging tests only"
	grep -qi 'production' <<<"$text" || bad "$id" "$what's comment does not say production refuses it"
	grep -qi 'patreon' <<<"$text" || bad "$id" "$what's comment does not say it never touches the real tier or Patreon"
}

# --- Check 1: one rule for the effective tier ---
grep -qE '^export function effectiveEntitlements\(real: Entitlements, override: PatronTier \| null, overrideAllowed: boolean\): Entitlements' "$ENT" 2>/dev/null ||
	bad 1 "$ENT does not export effectiveEntitlements(real: Entitlements, override: PatronTier | null, overrideAllowed: boolean): Entitlements"
stray="$(grep -rnw 'entitlementsForTier' functions/src web/src 2>/dev/null | grep -vE '\.test\.tsx?:|-contract\.ts:|/generated/' | grep -v '^functions/src/services/accounts\.ts:')"
[ -z "$stray" ] || bad 1 "entitlementsForTier is called outside accounts.ts, tests and contracts: $(head -3 <<<"$stray" | tr '\n' ' ')"
acc_calls="$(grep -c 'entitlementsForTier(' functions/src/services/accounts.ts 2>/dev/null || true)"
[ "${acc_calls:-0}" -le 1 ] || bad 1 "accounts.ts calls entitlementsForTier $acc_calls times (only the new-account default may)"
grep -q 'effectiveEntitlements(' functions/src/services/accounts.ts 2>/dev/null || bad 1 "functions/src/services/accounts.ts (signIn) does not call effectiveEntitlements"
users="$(grep -rlw 'effectiveEntitlements' functions/src 2>/dev/null | grep -vE '\.test\.ts$')"
[ "$(wc -l <<<"$users" | tr -d ' ')" -ge 1 ] && [ -n "$users" ] || bad 1 "nothing under functions/src/ calls effectiveEntitlements"
run_tagged 1 packages/domain "" "S215 AC 1"
run_tagged 1 functions "" "S215 AC 1"

# --- Check 2: deploy-time config only ---
grep -qE '^export function tierOverrideAllowed\(env: WorkerEnv\): boolean' "$WAPP" ||
	bad 2 "$WAPP does not export tierOverrideAllowed(env: WorkerEnv): boolean"
body="$(awk '/^export function tierOverrideAllowed\(/,/^}/' "$WAPP")"
grep -qF 'BT_TIER_OVERRIDE === "1"' <<<"$body" || bad 2 "tierOverrideAllowed does not test BT_TIER_OVERRIDE === \"1\""
grep -qF 'mockSignInAllowed(env)' <<<"$body" || bad 2 "tierOverrideAllowed does not require mockSignInAllowed(env)"
grep -qE 'request|headers|cookie|searchParams' <<<"$body" && bad 2 "tierOverrideAllowed reads something from the request"
grep -q 'BT_TIER_OVERRIDE' functions/src/local-server.ts && bad 2 "functions/src/local-server.ts sets BT_TIER_OVERRIDE"
node -e '
	const { readFileSync } = require("node:fs");
	const w = JSON.parse(readFileSync("wrangler.jsonc", "utf8").replace(/^\s*\/\/.*$/gm, ""));
	const errs = [];
	const has = (o) => o && Object.prototype.hasOwnProperty.call(o, "BT_TIER_OVERRIDE");
	if (has(w.vars)) errs.push("top-level vars set BT_TIER_OVERRIDE");
	for (const [n, e] of Object.entries(w.env ?? {})) {
		if (n === "staging") continue;
		if (JSON.stringify(e).includes("BT_TIER_OVERRIDE")) errs.push("env." + n + " sets BT_TIER_OVERRIDE");
	}
	if ((w.env ?? {}).staging?.vars?.BT_TIER_OVERRIDE !== "1") errs.push("env.staging vars do not set BT_TIER_OVERRIDE to \"1\"");
	for (const n of ["production", "preview"]) if (!(w.env ?? {})[n]) errs.push("wrangler.jsonc has no env." + n);
	for (const e of errs) console.log(e);
' >"$TMP/wr.txt" 2>&1
[ -s "$TMP/wr.txt" ] && while IFS= read -r line; do bad 2 "$line"; done <"$TMP/wr.txt"
run_tagged 2 functions "" "S215 AC 2"

# --- Check 3: stored per user, apart from the real tier ---
grep -qE 'getTierOverride\(uid: string\): Promise<PatronTier \| null>' "$PORT" 2>/dev/null || bad 3 "$PORT does not declare getTierOverride(uid: string): Promise<PatronTier | null>"
grep -qE 'setTierOverride\(uid: string, tier: PatronTier \| null\): Promise<void>' "$PORT" 2>/dev/null || bad 3 "$PORT does not declare setTierOverride(uid: string, tier: PatronTier | null): Promise<void>"
newsql="$(story_own_diff S215 "$BASE" --name-only --diff-filter=A -- functions/src/adapters/postgres/migrations/ | grep -E '\.sql$')"
newsql="${newsql}$(git ls-files --others --exclude-standard -- functions/src/adapters/postgres/migrations/ | grep -E '\.sql$')"
if [ -z "$newsql" ]; then
	bad 3 "S215 added no migration under functions/src/adapters/postgres/migrations/"
else
	sql="$(cat $newsql)"
	grep -qiE 'CREATE TABLE' <<<"$sql" || bad 3 "the new migration creates no table"
	grep -qiE 'ALTER TABLE "entitlements"' <<<"$sql" && bad 3 "the new migration alters the entitlements table"
	grep -qiE 'REFERENCES "public"\."users"\("uid"\)' <<<"$sql" || bad 3 "the new table's uid does not reference users.uid"
	table="$(grep -oiE 'CREATE TABLE "[a-z_]+"' <<<"$sql" | head -1 | sed -E 's/.*"([a-z_]+)"/\1/')"
	if [ -n "$table" ]; then
		awk -v t="$table" '$0 ~ "^[[:space:]]*\"?" t "\"?: \\{" {f=1} f{print} f&&/\}/{exit}' "$CLASS" | grep -qF 'kind: "personal"' ||
			bad 3 "$CLASS does not label $table as personal"
		awk -v t="$table" '$0 ~ "^[[:space:]]*\"?" t "\"?: \\{" {f=1} f{print} f&&/\}/{exit}' "$CLASS" | grep -qF 'deletedBy: USERS_STORE' ||
			bad 3 "$CLASS does not label $table deletedBy USERS_STORE"
	fi
fi
# The contract's cases live in repository-contract.ts; the memory and Postgres contract test files run them.
if ! grep -qF "S215 AC 3" functions/src/adapters/repository-contract.ts; then
	bad 3 "functions/src/adapters/repository-contract.ts has no 'S215 AC 3' case"
elif ! (cd functions && pnpm exec vitest run src/adapters/memory/repos.contract.test.ts src/adapters/postgres/repos.contract.test.ts -t "S215 AC 3|\\(h\\)" --reporter=json --outputFile="$TMP/c.json" >"$TMP/c.log" 2>&1); then
	bad 3 "the repository contract's S215 cases failed:"; tail -15 "$TMP/c.log" | sed 's/^/        /'
elif ! node -e 'const r = require(process.argv[1]); const ok = r.testResults.every((f) => f.assertionResults.filter((a) => /S215 AC 3/.test(a.title)).some((a) => a.status === "passed")); process.exit(r.numPassedTests >= 4 && r.numFailedTests === 0 && ok ? 0 : 1)' "$TMP/c.json"; then
	bad 3 "the repository contract's S215 and (h) cases did not run and pass on both memory and Postgres"
fi

# --- Check 4: the route, 404 off staging ---
grep -rqF '/api/v1/me/tier-override' packages/domain/src/api-routes.ts || bad 4 "packages/domain/src/api-routes.ts's route table has no /api/v1/me/tier-override"
node -e '
	const spec = require("./openapi/bt-api.v1.json");
	const p = spec.paths?.["/api/v1/me/tier-override"];
	process.exit(p && p.get && p.put ? 0 : 1);
' || bad 4 "openapi/bt-api.v1.json has no GET and PUT /api/v1/me/tier-override"
grep -qF '"/api/v1/me/tier-override"' web/src/api/generated/bt-api.v1.ts || bad 4 "web/src/api/generated/bt-api.v1.ts has no /api/v1/me/tier-override"
if ! (cd functions && pnpm exec tsx src/scripts/generate-openapi.ts --check >"$TMP/spec.log" 2>&1); then
	bad 4 "openapi/bt-api.v1.json is stale (pnpm api:spec):"; tail -5 "$TMP/spec.log" | sed 's/^/        /'
fi
if ! pnpm -s api:breaking >"$TMP/brk.log" 2>&1; then
	bad 4 "pnpm api:breaking failed:"; tail -8 "$TMP/brk.log" | sed 's/^/        /'
fi
if ! (cd web && ../node_modules/.bin/vitest run src/api/codegen.test.ts >"$TMP/codegen.log" 2>&1); then
	bad 4 "web/src/api/generated/ is not rendered from the current spec:"; tail -8 "$TMP/codegen.log" | sed 's/^/        /'
fi
run_tagged 4 functions "--config vitest.workers.config.ts" "S215 AC 4"

# --- Check 5: the Settings control, staging only ---
hooks="$(grep -rlF '/api/v1/me/tier-override' web/src/api 2>/dev/null | grep -vE '\.test\.tsx?$|/generated/')"
[ -n "$hooks" ] || bad 5 "no file under web/src/api/ (outside generated/) asks /api/v1/me/tier-override"
grep -rqE 'export function use[A-Za-z]*TierOverride' web/src/api 2>/dev/null || bad 5 "web/src/api/ exports no named use…TierOverride hook"
grep -rqF "$LABEL" web/src --include='*.tsx' 2>/dev/null || bad 5 "no component under web/src/ renders '$LABEL'"
grep -qE 'TierOverride' "$SETTINGS" 2>/dev/null || bad 5 "$SETTINGS does not place the tier override control"
run_tagged 5 web "" "S215 AC 5"

# --- Check 6: no design match, by the owner's exemption ---
story="$(node scripts/backlog-vault/text-records.ts newest S215 2>/dev/null)"
grep -qF 'Skip the design (Recommended)' <<<"$story" && grep -qF 'S215 builds a plain, clearly labelled testing control with no design match, since fans never see it' <<<"$story" ||
	bad 6 "S215's story text does not carry the owner's design exemption quote"
grep -rlF "S215 AC 5" web/src 2>/dev/null | xargs grep -lF "$LABEL" >/dev/null 2>&1 || bad 6 "no S215 AC 5 RTL test looks for the testing label"

# --- Check 7: comments say why ---
says_why 7 "effectiveEntitlements" "$(doc_before "$ENT" '^export function effectiveEntitlements\(')"
says_why 7 "tierOverrideAllowed" "$(doc_before "$WAPP" '^export function tierOverrideAllowed\(')"
says_why 7 "getTierOverride" "$(doc_before "$PORT" 'getTierOverride\(')"
says_why 7 "setTierOverride" "$(doc_before "$PORT" 'setTierOverride\(')"
says_why 7 "the table" "$(doc_before functions/src/adapters/postgres/schema.ts 'pgTable\("[a-z_]*tier_override')"
handler="$(grep -rlE 'tier-override|TierOverride' functions/src/handlers 2>/dev/null | grep -v '\.test\.ts$' | head -1)"
if [ -z "$handler" ]; then bad 7 "no route handler under functions/src/handlers/ names the tier override"; else
	says_why 7 "the route handler" "$(doc_before "$handler" '^(export )?(async )?function [a-zA-Z]*[Tt]ierOverride')"
fi
control="$(grep -rlF "$LABEL" web/src --include='*.tsx' 2>/dev/null | grep -v '\.test\.tsx$' | head -1)"
if [ -z "$control" ]; then bad 7 "no Settings control renders the testing label"; else
	says_why 7 "the Settings control" "$(doc_before "$control" '^export function [A-Za-z]*TierOverride')"
fi
wr="$(grep -n 'BT_TIER_OVERRIDE' -B8 wrangler.jsonc 2>/dev/null)"
says_why 7 "wrangler.jsonc's BT_TIER_OVERRIDE line" "$(grep -E '//' <<<"$wr")"

# --- Check 8: fence and Status ---
fence='^(packages/domain/|packages/ports/src/|functions/src/|functions/vitest\.config\.ts$|functions/vitest\.workers\.config\.ts$|openapi/|web/src/|web/vitest\.config\.ts$|wrangler\.jsonc$|docs/v3/backlog/|docs/v3/audit/|changelog\.d/S215\.md$|scripts/verify-S215\.sh$)'
while IFS= read -r f; do
	[ -z "$f" ] && continue
	grep -qE "$fence" <<<"$f" || bad 8 "outside the fence: $f"
done < <(story_own_changed_files S215 "$BASE" .)
own_added="$(story_own_diff S215 "$BASE" --name-status --diff-filter=A -- scripts/verify-S215.sh)"
[ -n "$own_added" ] || [ -n "$(git ls-files --others --exclude-standard -- scripts/verify-S215.sh)" ] || bad 8 "scripts/verify-S215.sh was not created by S215"
status="$(story_snapshot_status S215)"
[ "$status" = "done" ] || bad 8 "S215's snapshot records Status '${status:-none}', not done"

report "verify-S215"
exit $?
