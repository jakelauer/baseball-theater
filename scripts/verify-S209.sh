#!/usr/bin/env bash
# Grader for story S209 — a player's name opens their stats page: outside ids from the Chadwick register,
# MLB's cross-references filling its gaps, each behind a port, preseeded into one table and kept in step
# by a daily per-file ETag sync, served by one batched route (re-scoped 2026-11-27); one URL function
# and one link component; a stats-site setting that patrons (Backer and up) may change. A commit-time
# proof of this story (S84). Contract: frame note 00, "Verify-script contract" (docs/v3/backlog/frame/).
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`); runs only the
# story-scoped Vitest tests named below (tagged "S209 AC <n>").

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "AC 1: MLB's xrefId hydrate recorded for 823823's players (fixtures/raw/people-xref-823823.json: FanGraphs and Lahman ids, no Baseball-Reference ids) and a Chadwick register sample in fixtures/; the register (licence: Open Data Commons Attribution License 1.0, named in its adapter) behind PlayerRegister, read with a conditional request (If-None-Match) as a stream, its measured cost in its comment; MLB's cross-references behind PlayerXrefSource, implemented by HttpMlbStatsClient with the batched hydrate=xrefId call, PLAYER_XREF_BATCH ids a call; tests 'S209 AC 1' pass"
check 2 "AC 2: packages/domain exports StatsProvider and playerProfileUrl (MLBAM for MLB.com and Savant, the provider's own id for FanGraphs and Baseball-Reference, null when unknown, no name slugs); table test 'S209 AC 2' passes"
check 3 "AC 3: PlayerIdRepository (packages/ports) with a Postgres adapter, one migration (player_ids: person_id key, fangraphs_id, bbref_id, register_file, no checked_at; player_register_files with etag; no seed cursor) and an in-memory double; the cron's player-id sync in its own cron scope (job player-ids) with named constants (REGISTER_SYNC_INTERVAL_MS at least a day, REGISTER_RETRY_MS), updating only changed rows (IS DISTINCT FROM); ingest adds no players; GET /api/v1/players/profiles (PLAYER_PROFILES_MAX_IDS) in ApiRoutes, the spec and web/src/api/generated/, the per-person route gone (api:breaking exits 0); the classification manifest labels both classes and both tables; tests 'S209 AC 3' pass"
check 4 "AC 4: a player's name on the matchup cards and in the box score's batting and pitching tables is a new-tab link (target=_blank rel=noopener noreferrer) to playerProfileUrl, MLB.com with no setting; no profile URL is built under web/src/ outside playerProfileUrl; RTL 'S209 AC 4' passes"
check 5 "AC 5: one name-link component under web/src/components/ (PlayerLink), used by MatchupCards and BoxRoom"
check 6 "AC 6: Hide Scores changes nothing about the links (RTL 'S209 AC 6')"
check 7 "AC 7: the story records the owner's tier answer on its **Owner answer (tier):** line, quoting it"
check 8 "AC 8: AccountSettings.statsProvider (default \"mlb\", a document without it parses as \"mlb\"); one migration adds stats_provider text NOT NULL DEFAULT 'mlb'; the repository reads and writes it; the Settings page offers the four sites, MLB.com only without the entitlement (others disabled, marked patron); tests 'S209 AC 8' pass"
check 9 "AC 9: Entitlements.statsProviderChoice from entitlementsForTier (Backer and up), derived from the stored tier in getByUid with no column; the settings route refuses only a change away from \"mlb\" without it, deciding by entitlementsForTier; effectiveStatsProvider answers \"mlb\" without it; tests 'S209 AC 9' pass"
check 10 "AC 10: the link follows effectiveStatsProvider and the profiles route, names shown together sharing one request (PlayerLink's roster, passed by MatchupCards and BoxRoom), falling back to MLB.com for an unknown id, a player with no row, loading and failure; RTL 'S209 AC 10' passes"
check 11 "AC 11: no design match (no e2e/design/S209.spec.ts, no docs/v3/design-checks/S209/)"
check 12 "AC 12: S209's Status is done: its snapshot records done"
check 13 "S209 changed no file outside its fence (plus creating scripts/verify-S209.sh and its own records)"

# The commit S209's own changes start from: `git merge-base origin/stage HEAD` when this grader was written.
BASE=188452e55efa42db6e8448e4bb9029c62438b2b7

TMP="$(mktemp -d /tmp/verify-S209.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT
MIG=functions/src/adapters/postgres/migrations
DOMAIN=packages/domain/src
PORTS=packages/ports/src

# Each unit's S209 tests run once (every test file under <unit>/src naming "S209 AC", no workerd files, filtered
# to the tests carrying it), so the grader stays under a minute; run_tagged then reads that run's results.
run_unit() {
	local dir="$1" files out
	out="$TMP/$(tr '/' '_' <<<"$dir")"
	files="$(cd "$dir" && grep -rlF --include='*.test.ts' --include='*.test.tsx' -- "S209 AC" src 2>/dev/null | grep -v '\.workerd\.test\.ts$')"
	[ -z "$files" ] && return
	# shellcheck disable=SC2086
	(cd "$dir" && pnpm exec vitest run $files -t "S209 AC" --coverage.enabled=false --reporter=json --outputFile="$out.json" >"$out.log" 2>&1) || true
}

# run_tagged <check> <unit dir> <tag> — fails unless that unit's run holds a test named <tag> and every such test passed.
run_tagged() {
	local id="$1" dir="$2" tag="$3" out
	out="$TMP/$(tr '/' '_' <<<"$dir")"
	if [ ! -f "$out.json" ]; then
		bad "$id" "$dir ran no S209 test:"; tail -10 "$out.log" 2>/dev/null | sed 's/^/        /'
		return
	fi
	node -e '
		const r = require(process.argv[1]);
		const tag = process.argv[2];
		const tests = r.testResults.flatMap((f) => f.assertionResults).filter((t) => (t.ancestorTitles.join(" ") + " " + t.title).includes(tag));
		const failed = tests.filter((t) => t.status !== "passed");
		if (tests.length === 0) { console.log("no test names \"" + tag + "\""); process.exit(1); }
		if (failed.length) { console.log(failed.map((t) => t.title + ": " + t.status).join("; ")); process.exit(1); }
	' "$out.json" "$tag" >"$TMP/tag.log" 2>&1 || bad "$id" "$dir '$tag': $(cat "$TMP/tag.log")"
}

run_unit packages/domain &
run_unit functions &
run_unit web &
wait

# --- Check 1: AC 1: the source found, recorded and behind one port ---
XREF=fixtures/raw/people-xref-823823.json
if [ ! -f "$XREF" ]; then
	bad 1 "$XREF is not recorded"
else
	node -e '
		const p = require(require("node:path").resolve(process.argv[1])).people ?? [];
		const types = new Set(p.flatMap((x) => (x.xrefIds ?? []).map((r) => r.xrefType)));
		if (p.length < 20) { console.log("only " + p.length + " people recorded"); process.exit(1); }
		if (!types.has("fangraphs")) { console.log("no fangraphs cross-reference"); process.exit(1); }
		if (!types.has("lahman")) { console.log("no lahman cross-reference"); process.exit(1); }
		if (types.has("bbref") || types.has("baseball-reference")) { console.log("MLB carries Baseball-Reference ids of its own: the reading AC 1 records no longer holds"); process.exit(1); }
	' "$XREF" >"$TMP/x.log" 2>&1 || bad 1 "$XREF: $(cat "$TMP/x.log")"
fi
SAMPLE="$(ls fixtures/chadwick-register-*.csv 2>/dev/null | head -1)"
if [ -z "$SAMPLE" ]; then
	bad 1 "no Chadwick register sample under fixtures/"
else
	head -1 "$SAMPLE" | grep -q 'key_mlbam' && head -1 "$SAMPLE" | grep -q 'key_bbref' && head -1 "$SAMPLE" | grep -q 'key_fangraphs' || bad 1 "$SAMPLE's header lacks key_mlbam, key_bbref or key_fangraphs"
fi
grep -qE 'export interface PlayerRegister\b' "$PORTS"/*.ts 2>/dev/null || bad 1 "packages/ports has no PlayerRegister port"
grep -qE 'export interface PlayerXrefSource\b' "$PORTS"/*.ts 2>/dev/null || bad 1 "packages/ports has no PlayerXrefSource port"
REG="$(grep -rlE 'chadwickbureau/register' functions/src/adapters 2>/dev/null | grep -v '\.test\.ts$' | head -1)"
if [ -z "$REG" ]; then
	bad 1 "no adapter under functions/src/adapters fetches the Chadwick register"
else
	grep -qE 'implements PlayerRegister' "$REG" || bad 1 "$REG does not implement PlayerRegister"
	grep -qiE 'Open Data Commons Attribution' "$REG" || bad 1 "$REG does not name the register's licence"
	grep -qiE 'memory' "$REG" && grep -qiE 'CPU|time' "$REG" || bad 1 "$REG's comment does not record the measured memory and time of one run"
	grep -qiE 'If-None-Match' "$REG" || bad 1 "$REG sends no conditional request (If-None-Match)"
	grep -qE 'getReader\(|pipeThrough\(' "$REG" || bad 1 "$REG does not read a file as a stream"
fi
MLBHTTP=functions/src/adapters/http/mlb.ts
grep -qE 'class HttpMlbStatsClient implements[^{]*\bPlayerXrefSource\b' "$MLBHTTP" || bad 1 "HttpMlbStatsClient does not implement PlayerXrefSource"
grep -qE 'hydrate=xrefId' "$MLBHTTP" || bad 1 "$MLBHTTP does not ask MLB's batched people call with hydrate=xrefId"
grep -rqE 'export const PLAYER_XREF_BATCH\b' functions/src --include='*.ts' || bad 1 "no named constant PLAYER_XREF_BATCH"
grep -rqE 'xrefId' functions/src/services/recorder.ts || bad 1 "the recorder does not record the xrefId hydrate"
run_tagged 1 functions "S209 AC 1"

# --- Check 2: AC 2: one function per link ---
grep -rqE 'export type StatsProvider\b' "$DOMAIN" || bad 2 "packages/domain exports no StatsProvider"
grep -rqE 'export function playerProfileUrl\(' "$DOMAIN" || bad 2 "packages/domain exports no playerProfileUrl"
grep -qE 'playerProfileUrl|StatsProvider|player-links' "$DOMAIN/index.ts" || bad 2 "packages/domain's index does not export the link module"
run_tagged 2 packages/domain "S209 AC 2"

# --- Check 3: ids preseeded, synced by ETag, served ---
grep -qE 'export interface PlayerIdRepository\b' "$PORTS"/*.ts 2>/dev/null || bad 3 "packages/ports has no PlayerIdRepository"
grep -rqE 'class PostgresPlayerIdRepository' functions/src/adapters/postgres/ || bad 3 "no PostgresPlayerIdRepository"
grep -rqE 'class InMemoryPlayerIdRepository' functions/src/adapters/memory/ || bad 3 "no InMemoryPlayerIdRepository"
new_migs="$(story_own_diff S209 "$BASE" --name-only --diff-filter=A -- "$MIG"/*.sql; git ls-files --others --exclude-standard -- "$MIG"/*.sql)"
new_migs="$(sort -u <<<"$new_migs" | grep -v '^$')"
[ "$(grep -c . <<<"$new_migs")" = "1" ] || bad 3 "S209 adds $(grep -c . <<<"$new_migs") migrations (want one): $(tr '\n' ' ' <<<"$new_migs")"
m="$(cat $new_migs 2>/dev/null)"
grep -qE 'CREATE TABLE "player_ids"' <<<"$m" || bad 3 "the migration does not create player_ids"
pids="$(awk '/CREATE TABLE "player_ids"/,/\);/' <<<"$m")"
for col in '"person_id" integer PRIMARY KEY' '"fangraphs_id" text' '"bbref_id" text' '"register_file" text'; do
	grep -qF "$col" <<<"$pids" || bad 3 "player_ids lacks $col"
done
grep -qF '"checked_at"' <<<"$pids" && bad 3 "player_ids still has checked_at (no per-player check after the re-scope)"
grep -qE 'CREATE TABLE "player_register_files"' <<<"$m" || bad 3 "the migration does not create player_register_files"
grep -qF '"etag" text' <<<"$(awk '/CREATE TABLE "player_register_files"/,/\);/' <<<"$m")" || bad 3 "player_register_files has no etag"
grep -qE 'player_id_seed_cursor' <<<"$m" && bad 3 "the migration still creates the seeding cursor"
SVC=functions/src/services/player-ids.ts
if [ ! -f "$SVC" ]; then
	bad 3 "no $SVC (the register sync)"
else
	for c in REGISTER_SYNC_INTERVAL_MS REGISTER_RETRY_MS; do grep -qE "export const $c\b" "$SVC" || bad 3 "$SVC has no named constant $c"; done
	node -e '
		const s = require("node:fs").readFileSync(process.argv[1], "utf8");
		const m = s.match(/export const REGISTER_SYNC_INTERVAL_MS\s*=\s*([^;]+);/);
		if (!m) process.exit(1);
		const v = Function("return (" + m[1] + ")")();
		process.exit(v >= 24 * 3600 * 1000 ? 0 : 1);
	' "$SVC" || bad 3 "REGISTER_SYNC_INTERVAL_MS is under a day"
fi
grep -qE 'job: "player-ids"' functions/src/worker.ts || bad 3 "worker.ts runs no cron scope with job \"player-ids\""
grep -qE 'IS DISTINCT FROM' <<<"$(awk '/class PostgresPlayerIdRepository/,/^}/' functions/src/adapters/postgres/repos.ts)" || bad 3 "PostgresPlayerIdRepository does not update only changed rows (IS DISTINCT FROM)"
grep -qE 'addRosterPlayers|playerIds\??\.add' functions/src/services/ingest.ts && bad 3 "ingest still adds a game's players"
grep -rqE 'export const PLAYER_PROFILES_MAX_IDS\b' "$DOMAIN" functions/src --include='*.ts' || bad 3 "no named constant PLAYER_PROFILES_MAX_IDS"
grep -qF '"GET /api/v1/players/profiles"' "$DOMAIN/api-routes.ts" || bad 3 "ApiRoutes lacks GET /api/v1/players/profiles"
grep -qF '"/api/v1/players/profiles"' openapi/bt-api.v1.json || bad 3 "the OpenAPI spec lacks the profiles path"
grep -rqF '/api/v1/players/profiles' web/src/api/generated/ || bad 3 "web/src/api/generated/ lacks the profiles path"
grep -rqF 'players/{personId}/profiles' openapi/bt-api.v1.json "$DOMAIN/api-routes.ts" && bad 3 "the per-person profiles route is still served"
(cd functions && pnpm exec tsx src/scripts/generate-openapi.ts --out "$TMP/spec.json" >/dev/null 2>&1) && cmp -s "$TMP/spec.json" openapi/bt-api.v1.json || bad 3 "the committed spec is stale against the route table"
(pnpm -s api:breaking >"$TMP/b.log" 2>&1) || { bad 3 "pnpm api:breaking failed:"; tail -5 "$TMP/b.log" | sed 's/^/        /'; }
CLS=functions/src/services/data-classification.ts
for k in InMemoryPlayerIdRepository PostgresPlayerIdRepository player_ids player_register_files; do
	grep -qE "^\s*$k: \{" "$CLS" || bad 3 "$CLS does not label $k"
done
run_tagged 3 functions "S209 AC 3"

# --- Check 4: names link to their stats page ---
built="$(grep -rnE 'mlb\.com/player|baseballsavant|fangraphs\.com|baseball-reference\.com' web/src --include='*.ts' --include='*.tsx' 2>/dev/null | grep -vE '\.test\.tsx?:|/generated/')"
[ -z "$built" ] || bad 4 "a profile URL is built under web/src/ outside playerProfileUrl: $(head -3 <<<"$built" | tr '\n' ' ')"
run_tagged 4 web "S209 AC 4"

# --- Check 5: one link component ---
LINK="$(grep -rlE 'export function PlayerLink\(' web/src/components 2>/dev/null | head -1)"
if [ -z "$LINK" ]; then
	bad 5 "no PlayerLink component under web/src/components/"
else
	grep -qE 'target="_blank"' "$LINK" && grep -qE 'rel="noopener noreferrer"' "$LINK" || bad 5 "$LINK does not open in a new tab with rel=\"noopener noreferrer\""
	grep -qE 'playerProfileUrl' "$LINK" || bad 5 "$LINK does not build its href with playerProfileUrl"
	grep -qE '<PlayerLink\b' web/src/components/pitch/MatchupCards.tsx || bad 5 "MatchupCards does not use PlayerLink"
	[ "$(grep -cE '<PlayerLink\b' web/src/components/game/BoxRoom.tsx)" -ge 2 ] || bad 5 "BoxRoom does not use PlayerLink in both tables"
fi

# --- Check 6: Hide Scores leaves the links alone ---
run_tagged 6 web "S209 AC 6"

# --- Check 7: the owner's tier answer ---
text="$(node scripts/backlog-vault/text-records.ts newest S209 2>/dev/null)"
grep -qE '^- \*\*Owner answer \(tier\):\*\* .*Every patron, Backer and up' <<<"$text" || bad 7 "S209's text has no **Owner answer (tier):** line quoting the owner"

# --- Check 8: the setting ---
grep -qE 'statsProvider: StatsProvider' "$DOMAIN/settings.ts" || bad 8 "AccountSettings has no statsProvider: StatsProvider"
grep -qE 'statsProvider: "mlb"' "$DOMAIN/settings.ts" || bad 8 "DEFAULT_SETTINGS.statsProvider is not \"mlb\""
grep -qE "ADD COLUMN \"stats_provider\" text DEFAULT 'mlb' NOT NULL" <<<"$m" || bad 8 "the migration does not add stats_provider text NOT NULL DEFAULT 'mlb'"
grep -qE 'statsProvider' functions/src/adapters/postgres/schema.ts || bad 8 "account_settings' schema has no statsProvider"
run_tagged 8 packages/domain "S209 AC 8"
run_tagged 8 functions "S209 AC 8"
run_tagged 8 web "S209 AC 8"

# --- Check 9: patrons only beyond MLB.com ---
grep -qE 'statsProviderChoice: boolean' "$DOMAIN/types.ts" || bad 9 "Entitlements has no statsProviderChoice"
grep -qE 'statsProviderChoice: rank >= TIER_RANK\.Backer' "$DOMAIN/entitlements.ts" || bad 9 "entitlementsForTier does not grant statsProviderChoice from Backer"
grep -rqE 'export function effectiveStatsProvider\(' "$DOMAIN" || bad 9 "packages/domain has no effectiveStatsProvider"
grep -qiE 'stats_provider_choice' <<<"$m" && bad 9 "the migration adds a stats_provider_choice column (it must be derived)"
grep -qiE 'statsProviderChoice' functions/src/adapters/postgres/schema.ts && bad 9 "the schema stores statsProviderChoice (it must be derived)"
grep -qE 'entitlementsForTier\(' functions/src/adapters/postgres/repos.ts || bad 9 "getByUid does not derive entitlements through entitlementsForTier"
route="$(awk '/route: "PUT \/api\/v1\/me\/settings"/,/^\t\},/' functions/src/handlers/api.ts)"
grep -qE 'entitlementsForTier\(' <<<"$route" && grep -qE 'statsProviderChoice' <<<"$route" || bad 9 "the settings route does not decide by entitlementsForTier(tier).statsProviderChoice"
run_tagged 9 packages/domain "S209 AC 9"
run_tagged 9 functions "S209 AC 9"

# --- Check 10: names follow the setting ---
grep -qE 'effectiveStatsProvider' "${LINK:-/dev/null}" || bad 10 "PlayerLink does not pick its provider with effectiveStatsProvider"
grep -qE '\broster\b' "${LINK:-/dev/null}" || bad 10 "PlayerLink takes no roster to share one request among names shown together"
grep -qE '<PlayerLink\b[^>]*\broster=' web/src/components/game/BoxRoom.tsx || bad 10 "BoxRoom's names pass no roster"
grep -qE '<PlayerLink\b[^>]*\broster=' web/src/components/pitch/MatchupCards.tsx || bad 10 "MatchupCards' names pass no roster"
run_tagged 10 web "S209 AC 10"

# --- Check 11: no design match ---
[ ! -e e2e/design/S209.spec.ts ] || bad 11 "e2e/design/S209.spec.ts exists (the design was waived)"
[ ! -e docs/v3/design-checks/S209 ] || bad 11 "docs/v3/design-checks/S209 exists (the design was waived)"

# --- Check 12: Status done ---
[ "$(story_snapshot_status S209)" = "done" ] || bad 12 "S209's snapshot does not record Status done"

# --- Check 13: fence ---
fence='^(fixtures/|packages/mlb-api/src/|packages/domain/|packages/ports/|functions/src/|functions/vitest\.config\.ts$|openapi/|web/src/|web/vitest\.config\.ts$|docs/v3/backlog/|docs/v3/audit/|changelog\.d/S209\.md$|scripts/verify-S209\.sh$)'
while IFS= read -r f; do
	[ -z "$f" ] && continue
	grep -qE "$fence" <<<"$f" || bad 13 "outside the fence: $f"
done < <(story_own_changed_files S209 "$BASE" .)
own_added="$(story_own_diff S209 "$BASE" --name-status --diff-filter=A -- scripts/verify-S209.sh)"
[ -n "$own_added" ] || [ -n "$(git ls-files --others --exclude-standard -- scripts/verify-S209.sh)" ] || bad 13 "scripts/verify-S209.sh was not created by S209"

report "verify-S209"
exit $?
