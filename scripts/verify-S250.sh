#!/usr/bin/env bash
# Grader for story S250 — faster live refresh and Savant's play and pitch video links are free for
# every fan: one constant in packages/domain/src/entitlements.ts that entitlementsForTier and
# effectiveEntitlements both apply (so a stored `false` row can't take them away), nothing outside the
# entitlements code naming either flag, the spec's descriptions saying so, and true comments.
# A commit-time proof of this story (S84). Contract: frame note 00, "Verify-script contract"
# (docs/v3/backlog/frame/).
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`); runs only the
# story-scoped Vitest files named below (tests titled "S250 AC <n>", and the spec/codegen tests).

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "AC 1: entitlements.ts exports one named constant (FREE_FOR_EVERY_FAN) holding fasterLiveRefresh and savantLinks, commented with why (MLB's data or video, the owner's words; fasterLiveRefresh's naming S149 and ADR-020 and compatibility); entitlementsForTier reads it, both flags true for every PATRON_TIERS tier, cloudSyncedSettings and statsProviderChoice unchanged; a passing 'S250 AC 1' table test in entitlements.test.ts covers every tier"
check 2 "AC 2: effectiveEntitlements applies the same constant to the stored row, override allowed or not, so a stored false row is handed true; nothing migrated; its comment says the read wins over the stored row and why; passing 'S250 AC 2' tests in entitlements.test.ts and me.test.ts (GET /api/v1/me for an account stored false answers true); web/src/test/meApi.ts DEV_ACCOUNT sets both true"
check 3 "AC 3: no non-test .ts/.tsx under packages/, functions/src/ or web/src/ names fasterLiveRefresh or savantLinks except entitlements.ts, types.ts, the Postgres schema.ts and repos.ts, and web/src/api/generated/"
check 4 "AC 4: the spec's Entitlements.fasterLiveRefresh and .savantLinks descriptions say true for every fan since S250, kept for compatibility (ADR-015), fasterLiveRefresh's adding live games push every update to every fan (S149, ADR-020); pnpm api:breaking exits 0; the spec matches pnpm api:spec (openapi.test.ts) and web/src/api/generated/ is regenerated (codegen.test.ts)"
check 5 "AC 5: the comments on Entitlements (types.ts) and entitlementsForTier say which flags are free for every fan and why, citing S250; pnpm comments:stale against the story's base lists no symbol in a file S250 changed, except those COMMENTS_STILL_TRUE names"
check 6 "AC 6: S250's Status is done: its snapshot records done"
check 7 "S250 changed no file outside its fence (plus creating scripts/verify-S250.sh and its own records)"

# The commit S250's own changes start from: `git merge-base origin/stage HEAD` when this grader was written.
BASE=ebd1706dfb08b9454ee09d26feeccb7b7c833040

# Symbols comments:stale may flag in a file S250 changed, each "<file>:<symbol>" with why its comment still holds.
COMMENTS_STILL_TRUE=(
)

TMP="$(mktemp -d /tmp/verify-S250.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

ENT=packages/domain/src/entitlements.ts
TYPES=packages/domain/src/types.ts
SPEC=openapi/bt-api.v1.json
ME_API=web/src/test/meApi.ts

# run_vitest <check> <package dir> <file> <name pattern>: the file's tests matching the pattern pass, at least one, none failing.
run_vitest() {
	local id="$1" dir="$2" file="$3" pattern="$4"
	if [ ! -f "$dir/$file" ]; then
		bad "$id" "$dir/$file missing"
	elif ! (cd "$dir" && pnpm exec vitest run "$file" -t "$pattern" --reporter=json --outputFile="$TMP/r.json" >"$TMP/r.log" 2>&1); then
		bad "$id" "$dir/$file -t '$pattern' failed: $(grep -E 'FAIL|AssertionError|Error:' "$TMP/r.log" | head -5 | tr '\n' ' ')"
	elif ! node -e 'process.exit(require(process.argv[1]).numPassedTests > 0 ? 0 : 1)' "$TMP/r.json"; then
		bad "$id" "$dir/$file -t '$pattern' ran no passing test"
	fi
}

# doc_before <file> <regex> — the comment lines right above the first line matching <regex>.
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
			if (/^(\/\*\*|\*|\*\/|\/\/)/.test(t)) out.unshift(lines[i]);
			else break;
		}
		console.log(out.join("\n"));
	' "$1" "$2" 2>/dev/null
}

# const_block <file> <name> — the text of `export const <name> = { … };` (through its closing line).
const_block() {
	awk -v n="$2" '$0 ~ "^export const " n " = " {on=1} on {print} on && /^}/ {exit}' "$1"
}

story_own_changed_files S250 "$BASE" . >"$TMP/changed" 2>/dev/null || true

# --- Check 1: AC 1: one rule for what is free ---
block="$(const_block "$ENT" FREE_FOR_EVERY_FAN)"
if [ -z "$block" ]; then
	bad 1 "$ENT does not export const FREE_FOR_EVERY_FAN"
else
	grep -qE '^[[:space:]]*fasterLiveRefresh: true,' <<<"$block" || bad 1 "FREE_FOR_EVERY_FAN does not hold fasterLiveRefresh: true"
	grep -qE '^[[:space:]]*savantLinks: true,' <<<"$block" || bad 1 "FREE_FOR_EVERY_FAN does not hold savantLinks: true"
	header="$(doc_before "$ENT" '^export const FREE_FOR_EVERY_FAN = ')"
	all="$header"$'\n'"$block"
	grep -qF "MLB" <<<"$all" || bad 1 "FREE_FOR_EVERY_FAN's comments do not say the flags are built on MLB's data or video"
	grep -qF "I want to do all your suggestions except redrawing the fields" <<<"$all" || bad 1 "FREE_FOR_EVERY_FAN's comments do not quote the owner's words"
	flr="$(awk '/^[[:space:]]*\/\*\*/{buf=""} {buf=buf"\n"$0} /^[[:space:]]*fasterLiveRefresh: true,/{print buf; exit}' <<<"$block")"
	for w in S149 ADR-020 compatib "Retire it"; do
		grep -qF "$w" <<<"$flr" || bad 1 "fasterLiveRefresh's comment in FREE_FOR_EVERY_FAN does not name '$w'"
	done
	grep -qiE 'gates nothing|no gate|nothing gates' <<<"$flr" || bad 1 "fasterLiveRefresh's comment does not say it gates nothing"
	sav="$(awk '/^[[:space:]]*\/\*\*/{buf=""} {buf=buf"\n"$0} /^[[:space:]]*savantLinks: true,/{print buf; exit}' <<<"$block")"
	grep -qiE "savant|video" <<<"$sav" || bad 1 "savantLinks's comment in FREE_FOR_EVERY_FAN does not say what it is (Savant's video)"
fi
grep -qE 'S149' "$ENT" || bad 1 "$ENT does not name S149"
grep -qE 'ADR-020' "$ENT" || bad 1 "$ENT does not name ADR-020"
body="$(awk '/^export function entitlementsForTier\(/{on=1} on {print} on && /^}/ {exit}' "$ENT")"
grep -qF "FREE_FOR_EVERY_FAN" <<<"$body" || bad 1 "entitlementsForTier does not read FREE_FOR_EVERY_FAN"
cat >"$TMP/ent.mjs" <<'EOF'
const m = await import(process.argv[2]);
const errs = [];
const rank = { none: 0, Backer: 1, "Pro Backer": 2, "Star Backer": 3, "Premium Sponsor": 4 };
if (JSON.stringify(m.PATRON_TIERS) !== JSON.stringify(Object.keys(rank))) errs.push(`1|PATRON_TIERS is ${JSON.stringify(m.PATRON_TIERS)}`);
for (const tier of m.PATRON_TIERS ?? [])
{
	const e = m.entitlementsForTier(tier);
	const want = { tier, fasterLiveRefresh: true, cloudSyncedSettings: rank[tier] >= 1, savantLinks: true, statsProviderChoice: rank[tier] >= 1 };
	if (JSON.stringify(Object.entries(e).sort()) !== JSON.stringify(Object.entries(want).sort())) errs.push(`1|entitlementsForTier(${tier}) is ${JSON.stringify(e)}`);
}
const stored = { tier: "none", fasterLiveRefresh: false, cloudSyncedSettings: false, savantLinks: false, statsProviderChoice: false };
const storedPro = { ...stored, tier: "Pro Backer", cloudSyncedSettings: true, statsProviderChoice: true };
for (const [label, out] of [
	["no override, not allowed", m.effectiveEntitlements(stored, null, false)],
	["no override, allowed", m.effectiveEntitlements(stored, null, true)],
	["override Backer, not allowed", m.effectiveEntitlements(stored, "Backer", false)],
	["override none, allowed", m.effectiveEntitlements(storedPro, "none", true)],
])
{
	if (out.fasterLiveRefresh !== true || out.savantLinks !== true) errs.push(`2|effectiveEntitlements (${label}) hands out ${JSON.stringify(out)}`);
}
const kept = m.effectiveEntitlements(storedPro, null, false);
if (kept.tier !== "Pro Backer" || kept.cloudSyncedSettings !== true || kept.statsProviderChoice !== true) errs.push(`2|effectiveEntitlements changed the stored row's other flags: ${JSON.stringify(kept)}`);
const over = m.effectiveEntitlements(storedPro, "none", true);
if (over.tier !== "none" || over.cloudSyncedSettings !== false || over.statsProviderChoice !== false) errs.push(`2|an allowed override no longer gives the override's tier: ${JSON.stringify(over)}`);
if (stored.fasterLiveRefresh !== false || stored.savantLinks !== false) errs.push("2|effectiveEntitlements wrote to the stored row it was given");
console.log(errs.join("\n"));
process.exit(errs.length ? 1 : 0);
EOF
# Each line the script prints is "<check>|<reason>"; anything else (an import or a thrown error) fails both checks.
if ! node "$TMP/ent.mjs" "$PWD/$ENT" >"$TMP/ent.log" 2>&1; then
	while IFS= read -r line; do
		case "$line" in
			1\|* | 2\|*) bad "${line%%|*}" "${line#*|}" ;;
		esac
	done <"$TMP/ent.log"
	grep -qvE '^[12]\|' "$TMP/ent.log" && { bad 1 "importing $ENT failed: $(head -3 "$TMP/ent.log" | tr '\n' ' ')"; bad 2 "importing $ENT failed"; }
fi
run_vitest 1 packages/domain src/entitlements.test.ts "S250 AC 1"

# --- Check 2: AC 2: a stored row can't take them away ---
eff="$(awk '/^export function effectiveEntitlements\(/{on=1} on {print} on && /^}/ {exit}' "$ENT")"
grep -qF "FREE_FOR_EVERY_FAN" <<<"$eff" || bad 2 "effectiveEntitlements does not apply FREE_FOR_EVERY_FAN"
c="$(doc_before "$ENT" '^export function effectiveEntitlements\(')"
grep -qiE 'stored' <<<"$c" && grep -qiE 'wins|over the stored|overrid|whatever the stored' <<<"$c" || bad 2 "effectiveEntitlements's comment does not say the read wins over the stored row"
grep -qF "S250" <<<"$c" || bad 2 "effectiveEntitlements's comment does not cite S250"
grep -qiE 'because|so |since|why' <<<"$c" || bad 2 "effectiveEntitlements's comment does not say why"
run_vitest 2 packages/domain src/entitlements.test.ts "S250 AC 2"
run_vitest 2 functions src/handlers/me.test.ts "S250 AC 2"
dev="$(awk '/^export const DEV_ACCOUNT = /{on=1} on {print} on && /^};/ {exit}' "$ME_API")"
grep -qE '^[[:space:]]*fasterLiveRefresh: true,' <<<"$dev" || bad 2 "$ME_API's DEV_ACCOUNT does not set fasterLiveRefresh: true"
grep -qE '^[[:space:]]*savantLinks: true,' <<<"$dev" || bad 2 "$ME_API's DEV_ACCOUNT does not set savantLinks: true"
grep -E '(^|/)migrations?/' "$TMP/changed" | grep -q . && bad 2 "S250 adds or changes a migration: $(grep -E '(^|/)migrations?/' "$TMP/changed" | head -1)"

# --- Check 3: AC 3: nothing gates on them ---
while IFS= read -r f; do
	[ -z "$f" ] && continue
	case "$f" in
		packages/domain/src/entitlements.ts | packages/domain/src/types.ts | functions/src/adapters/postgres/schema.ts | functions/src/adapters/postgres/repos.ts | web/src/api/generated/*) ;;
		*.test.* | web/src/test/*) ;;
		*) bad 3 "a non-test file names fasterLiveRefresh or savantLinks: $f" ;;
	esac
done < <(git grep -lE '\b(fasterLiveRefresh|savantLinks)\b' -- 'packages/*.ts' 'packages/*.tsx' 'functions/src/*.ts' 'functions/src/*.tsx' 'web/src/*.ts' 'web/src/*.tsx'; git ls-files --others --exclude-standard -- packages functions/src web/src | grep -E '\.tsx?$' | while IFS= read -r u; do grep -lE '\b(fasterLiveRefresh|savantLinks)\b' "$u"; done)

# --- Check 4: AC 4: the spec says so ---
node -e '
	const spec = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
	const p = spec.components?.schemas?.Entitlements?.properties ?? {};
	const errs = [];
	for (const flag of ["fasterLiveRefresh", "savantLinks"])
	{
		const d = p[flag]?.description ?? "";
		if (!d) { errs.push(`${flag} has no description`); continue; }
		if (!/S250/.test(d)) errs.push(`${flag} does not cite S250`);
		if (!/every fan/i.test(d)) errs.push(`${flag} does not say true for every fan`);
		if (!/\btrue\b/.test(d)) errs.push(`${flag} does not say it is true`);
		if (!/compatib/i.test(d) || !/ADR-015/.test(d)) errs.push(`${flag} does not say it is kept for compatibility (ADR-015)`);
		if (p[flag].type !== "boolean") errs.push(`${flag} is no longer a boolean`);
	}
	const f = p.fasterLiveRefresh?.description ?? "";
	if (!/S149/.test(f) || !/ADR-020/.test(f) || !/push/i.test(f)) errs.push("fasterLiveRefresh does not say live games push every update to every fan (S149, ADR-020)");
	const req = spec.components?.schemas?.Entitlements?.required ?? [];
	for (const flag of ["fasterLiveRefresh", "savantLinks"]) if (!req.includes(flag)) errs.push(`${flag} is no longer required`);
	console.log(errs.join("; "));
	process.exit(errs.length ? 1 : 0);
' "$SPEC" >"$TMP/spec.log" 2>&1 || bad 4 "$SPEC Entitlements: $(cat "$TMP/spec.log")"
grep -qxF 'openapi/bt-api.v1.baseline.json' "$TMP/changed" && bad 4 "the frozen baseline openapi/bt-api.v1.baseline.json was changed"
pnpm -s api:breaking >"$TMP/b.log" 2>&1 || bad 4 "pnpm api:breaking fails: $(tail -5 "$TMP/b.log" | tr '\n' ' ')"
run_vitest 4 functions src/services/openapi.test.ts ""
run_vitest 4 web src/api/codegen.test.ts ""
grep -A3 -E '^[[:space:]]*/\*\* @description .*S250' web/src/api/generated/bt-api.v1.ts | grep -qE 'fasterLiveRefresh|savantLinks' || bad 4 "web/src/api/generated/bt-api.v1.ts does not carry the S250 descriptions"

# --- Check 5: AC 5: comments are true ---
t="$(doc_before "$TYPES" '^export type Entitlements = ')"
[ -n "$t" ] || bad 5 "Entitlements in $TYPES has no comment"
for w in S250 fasterLiveRefresh savantLinks MLB; do grep -qF "$w" <<<"$t" || bad 5 "Entitlements's comment in $TYPES does not name '$w'"; done
e="$(doc_before "$ENT" '^export function entitlementsForTier\(')"
[ -n "$e" ] || bad 5 "entitlementsForTier has no comment"
for w in S250 MLB FREE_FOR_EVERY_FAN; do grep -qF "$w" <<<"$e" || bad 5 "entitlementsForTier's comment does not name '$w'"; done
node tools/comments-stale/comments-stale.js --base "$BASE" >"$TMP/stale.log" 2>&1 || bad 5 "pnpm comments:stale exited nonzero: $(tail -3 "$TMP/stale.log" | tr '\n' ' ')"
while IFS= read -r line; do
	f="${line%%: *}"
	rest="${line#*: }"
	sym="${rest%% —*}"
	grep -qxF "$f" "$TMP/changed" || continue
	ok=""
	for k in ${COMMENTS_STILL_TRUE[@]+"${COMMENTS_STILL_TRUE[@]}"}; do [ "${k%% *}" = "$f:$sym" ] && ok=1; done
	[ -n "$ok" ] || bad 5 "comments:stale flags $f: $sym (code changed, comment did not) and COMMENTS_STILL_TRUE does not name it"
done < <(grep -E ' — code changed, comment did not' "$TMP/stale.log")

# --- Check 6: AC 6: Status done ---
[ "$(story_snapshot_status S250)" = "done" ] || bad 6 "S250's snapshot does not record Status done"

# --- Check 7: fence ---
fence='^(packages/domain/|functions/src/|functions/vitest\.config\.ts$|openapi/|web/src/api/|web/src/test/|docs/v3/backlog/|docs/v3/audit/|changelog\.d/S250\.md$|scripts/verify-S250\.sh$)'
while IFS= read -r f; do
	[ -z "$f" ] && continue
	grep -qE "$fence" <<<"$f" || bad 7 "outside the fence: $f"
done <"$TMP/changed"
own_added="$(story_own_diff S250 "$BASE" --name-status --diff-filter=A -- scripts/verify-S250.sh)"
[ -n "$own_added" ] || [ -n "$(git ls-files --others --exclude-standard -- scripts/verify-S250.sh)" ] || bad 7 "scripts/verify-S250.sh was not created by S250"
grep -E '^(scripts|test)/' "$TMP/changed" | grep -vxF 'scripts/verify-S250.sh' | grep -q . && bad 7 "S250 changed a file under scripts/ or test/: $(grep -E '^(scripts|test)/' "$TMP/changed" | grep -vxF 'scripts/verify-S250.sh' | head -1)"

report "verify-S250"
exit $?
