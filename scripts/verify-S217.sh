#!/usr/bin/env bash
# Grader for story S217 — the day digest's clips stop carrying `watchFirst`, a flag the web stopped reading when
# B426 put Best of on the highlight grid with no "Watch first" label.
# A commit-time proof of this story (S84).
# Contract: frame note 00, "Verify-script contract" (docs/v3/backlog/frame/).
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`); runs only the story-scoped Vitest
# files named below, once, and reads each test's result by name.

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "AC 1: DigestClip (domain DigestItem) has no watchFirst; nothing under packages/domain/src/ or functions/src/ outside tests names it; tests named 'S217 AC 1' in packages/domain/src/digest.test.ts and functions/src/handlers/api.test.ts pass and assert a clip has no watchFirst key"
check 2 "AC 2: openapi/bt-api.v1.json has no watchFirst and is current (pnpm api:spec --check); web/src/api/generated/ has no watchFirst; nothing under web/src/ reads it; pnpm api:breaking exits 0 when oasdiff is on PATH"
check 3 "AC 3: S217 changed no file outside its fence (plus creating scripts/verify-S217.sh and its own records); its snapshot records Status done"

# The commit S217's own changes start from: `git merge-base origin/stage HEAD` when this grader was written.
BASE=9c99f6ad48c6a964cf5999693628d91386b66e81

TMP="$(mktemp -d /tmp/verify-S217.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

(cd packages/domain && pnpm exec vitest run src/digest.test.ts --reporter=json --outputFile="$TMP/domain.json" >"$TMP/domain.log" 2>&1)
(cd functions && pnpm exec vitest run src/handlers/api.test.ts -t "S217" --reporter=json --outputFile="$TMP/functions.json" >"$TMP/functions.log" 2>&1)

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

# --- Check 1: domain and server ---
D=packages/domain/src/digest.ts
grep -qF 'watchFirst' "$D" && bad 1 "$D still declares or computes watchFirst"
hits="$(grep -rlF 'watchFirst' packages/domain/src functions/src 2>/dev/null | grep -vE '\.test\.tsx?$')"
[ -n "$hits" ] && bad 1 "watchFirst is still named outside tests: $(tr '\n' ' ' <<<"$hits")"
for f in packages/domain/src/digest.test.ts functions/src/handlers/api.test.ts; do
	grep -qE 'not\.toHaveProperty\("watchFirst"\)' "$f" || bad 1 "$f does not assert a clip has no watchFirst key"
done
in_file "$TMP/domain.json" src/digest.test.ts "S217 AC 1" || bad 1 "digest.test.ts: tests named 'S217 AC 1' did not pass"
in_file "$TMP/functions.json" src/handlers/api.test.ts "S217 AC 1" || bad 1 "api.test.ts: tests named 'S217 AC 1' did not pass"

# --- Check 2: the contract ---
grep -qF 'watchFirst' openapi/bt-api.v1.json && bad 2 "openapi/bt-api.v1.json still has watchFirst"
pnpm --silent api:spec --check >"$TMP/spec.log" 2>&1 || bad 2 "openapi/bt-api.v1.json is stale (pnpm api:spec --check)"
grep -rqF 'watchFirst' web/src/api/generated && bad 2 "web/src/api/generated/ still has watchFirst (pnpm api:types)"
web_hits="$(grep -rlF 'watchFirst' web/src 2>/dev/null | grep -v '^web/src/api/generated/')"
[ -n "$web_hits" ] && bad 2 "web/src reads watchFirst: $(tr '\n' ' ' <<<"$web_hits")"
if command -v oasdiff >/dev/null 2>&1; then
	pnpm --silent api:breaking >"$TMP/breaking.log" 2>&1 || bad 2 "pnpm api:breaking failed: $(tail -5 "$TMP/breaking.log")"
else
	echo "verify-S217: oasdiff is not on PATH here; CI's 'No breaking API changes (oasdiff)' step checks pnpm api:breaking"
fi

# --- Check 3: fence and status ---
fence='^(packages/domain/|functions/src/|functions/vitest\.config\.ts$|openapi/|web/src/api/generated/|docs/v3/backlog/|docs/v3/audit/|changelog\.d/S217\.md$|scripts/verify-S217\.sh$)'
while IFS= read -r f; do
	[ -z "$f" ] && continue
	grep -qE "$fence" <<<"$f" || bad 3 "outside the fence: $f"
done < <(story_own_changed_files S217 "$BASE" .)
own_added="$(story_own_diff S217 "$BASE" --name-status --diff-filter=A -- scripts/verify-S217.sh)"
[ -n "$own_added" ] || [ -n "$(git ls-files --others --exclude-standard -- scripts/verify-S217.sh)" ] || bad 3 "scripts/verify-S217.sh was not created by S217"
[ "$(story_snapshot_status S217)" = "done" ] || bad 3 "S217's snapshot does not record Status done"

report "verify-S217"
exit $?
