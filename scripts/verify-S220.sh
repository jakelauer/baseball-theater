#!/usr/bin/env bash
# Grader for story S220 — database round trips measured where they happen (one counting wrapper
# in inDatabaseScope, logging one structured line per ingest object, hub, day hub and cron-job
# scope, none per request), and the ingest Durable Objects got through one function that passes a
# locationHint from BT_INGEST_LOCATION_HINT, set for staging only. A commit-time proof of this
# story (S84). Contract: frame note 00, "Verify-script contract" (docs/v3/backlog/frame/).
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`); runs only the
# story-scoped Vitest tests named below (tagged "S220 AC <n>").

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "AC 1: inDatabaseScope (functions/src/adapters/postgres/connect.ts) counts each scope's database round trips through one wrapper around the connection and logs one structured line (kind, roundTrips, totalMs, maxMs) for a scope given a kind: the ingest object (ingest), each cron job in scheduled() (cron, job named), the game hub (hub), the day hub (day-hub); a request's scope passes none and logs nothing; Node tests and workerd tests 'S220 AC 1' pass"
check 2 "AC 2: the ingest objects are got through one function (GAME_INGEST's idFromName called once outside tests) that passes { locationHint } from BT_INGEST_LOCATION_HINT only when set, from ensureGameIngest and ingestLease; wrangler.jsonc sets BT_INGEST_LOCATION_HINT \"enam\" in env.staging's vars only and placement.hint (us-east-2) for staging only; tests 'S220 AC 2' pass"
check 3 "AC 3: docs/v3/ARCHITECTURE.md has a dated S220 note under ADR-020: what is measured, read by kind through wrangler tail or Workers Logs, staging carries the hint and production not, production only by a later change the owner approves"
check 4 "AC 4: the wrapper's, the ingest object's and the cron's comments say what they log and why"
check 5 "AC 5: S220's Status is done: its snapshot fragment records done"
check 6 "S220 changed no file outside its fence (plus creating scripts/verify-S220.sh and its own records)"

# The commit S220's own changes start from: `git merge-base origin/stage HEAD` when this grader was written.
BASE=18cb8abbdbedfc410ced0497f7649504ea298dc3

TMP="$(mktemp -d /tmp/verify-S220.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT
CONNECT=functions/src/adapters/postgres/connect.ts
INGEST=functions/src/game-ingest-object.ts
HUB=functions/src/game-hub-object.ts
DAYHUB=functions/src/day-hub-object.ts
WORKER=functions/src/worker.ts
WAPP=functions/src/worker-app.ts
ARCH=docs/v3/ARCHITECTURE.md

# run_tagged <check> <vitest config args> <tag> — runs every functions/src test file naming <tag>
# (workerd files when a config is given, Node files otherwise), filtered to the tests carrying it.
run_tagged() {
	local id="$1" config="$2" tag="$3" files
	if [ -n "$config" ]; then
		files="$(cd functions && grep -rlF --include='*.workerd.test.ts' -- "$tag" src 2>/dev/null)"
	else
		files="$(cd functions && grep -rlF --include='*.test.ts' -- "$tag" src 2>/dev/null | grep -v '\.workerd\.test\.ts$')"
	fi
	if [ -z "$files" ]; then
		bad "$id" "no ${config:+workerd }test in functions/src names '$tag'"
		return
	fi
	# shellcheck disable=SC2086
	if ! (cd functions && pnpm exec vitest run $config $files -t "$tag" --reporter=json --outputFile="$TMP/r.json" >"$TMP/r.log" 2>&1); then
		bad "$id" "functions '$tag' ${config:+(workerd) }failed:"; tail -15 "$TMP/r.log" | sed 's/^/        /'
	elif ! node -e 'const r = require(process.argv[1]); process.exit(r.numPassedTests > 0 && r.numFailedTests === 0 ? 0 : 1)' "$TMP/r.json"; then
		bad "$id" "functions '$tag' ${config:+(workerd) }ran no passing test"
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

# --- Check 1: AC 1: round trips measured where they happen ---
grep -qE 'roundTrips' "$CONNECT" || bad 1 "$CONNECT does not count roundTrips"
grep -qE 'totalMs' "$CONNECT" && grep -qE 'maxMs' "$CONNECT" || bad 1 "$CONNECT does not log totalMs and maxMs"
stray="$(grep -rlE 'roundTrips' functions/src 2>/dev/null | grep -vE '\.test\.ts$' | grep -vxF "$CONNECT")"
[ -z "$stray" ] || bad 1 "round trips are counted outside the one wrapper: $(tr '\n' ' ' <<<"$stray")"
crons="$(grep -cE 'kind: "cron"' "$WORKER" 2>/dev/null || true)"
[ "${crons:-0}" -ge 4 ] || bad 1 "$WORKER gives kind \"cron\" to $crons scopes (want one per job, 4)"
jobs="$(grep -oE 'job: "[a-z-]+"' "$WORKER" 2>/dev/null | sort -u | wc -l | tr -d ' ')"
[ "${jobs:-0}" -ge 4 ] || bad 1 "$WORKER names $jobs distinct cron jobs (want 4)"
fetch_body="$(awk '/async fetch\(request: Request/,/^\t\},/' "$WORKER")"
grep -qE 'kind:' <<<"$fetch_body" && bad 1 "the Worker's fetch scope passes a kind (a request must log nothing)"
grep -qE 'kind: "ingest"' "$INGEST" || bad 1 "$INGEST does not scope with kind \"ingest\""
grep -qE 'kind: "hub"' "$HUB" || bad 1 "$HUB does not scope with kind \"hub\""
grep -qE 'kind: "day-hub"' "$DAYHUB" || bad 1 "$DAYHUB does not scope with kind \"day-hub\""
run_tagged 1 "" "S220 AC 1"
run_tagged 1 "--config vitest.workers.config.ts" "S220 AC 1"

# --- Check 2: AC 2: one getter, the hint, staging only ---
n="$(grep -rnE 'idFromName\(gameIngestName' functions/src 2>/dev/null | grep -vE '\.test\.ts:' | wc -l | tr -d ' ')"
[ "$n" = "1" ] || bad 2 "GAME_INGEST's idFromName(gameIngestName(...)) is called in $n places outside tests (want 1)"
grep -qE 'locationHint' "$INGEST" || bad 2 "$INGEST passes no locationHint"
grep -qE 'BT_INGEST_LOCATION_HINT\?: string' "$WAPP" || bad 2 "WorkerEnv has no BT_INGEST_LOCATION_HINT?: string"
grep -qE 'BT_INGEST_LOCATION_HINT' "$HUB" || bad 2 "$HUB's lease does not pass BT_INGEST_LOCATION_HINT"
grep -qE 'BT_INGEST_LOCATION_HINT' "$DAYHUB" || bad 2 "$DAYHUB's lease does not pass BT_INGEST_LOCATION_HINT"
grep -qE 'BT_INGEST_LOCATION_HINT' "$WORKER" || bad 2 "$WORKER's cron does not pass BT_INGEST_LOCATION_HINT"
node -e '
	const { readFileSync } = require("node:fs");
	const w = JSON.parse(readFileSync("wrangler.jsonc", "utf8").replace(/^\s*\/\/.*$/gm, ""));
	const env = w.env ?? {};
	const errs = [];
	if ((env.staging?.vars ?? {}).BT_INGEST_LOCATION_HINT !== "enam") errs.push("env.staging.vars.BT_INGEST_LOCATION_HINT is not \"enam\"");
	if ("BT_INGEST_LOCATION_HINT" in (w.vars ?? {})) errs.push("the top-level vars set BT_INGEST_LOCATION_HINT");
	for (const n of ["production", "preview"])
	{
		if (!env[n]) errs.push("wrangler.jsonc has no env." + n);
		else if ("BT_INGEST_LOCATION_HINT" in (env[n].vars ?? {})) errs.push("env." + n + " sets BT_INGEST_LOCATION_HINT");
		else if (env[n].placement?.hint !== undefined) errs.push("env." + n + " sets placement.hint");
	}
	if (!/us-east-2/.test(env.staging?.placement?.hint ?? "")) errs.push("env.staging.placement.hint is not a us-east-2 value");
	if (w.placement?.hint !== undefined) errs.push("the top level sets placement.hint");
	if (errs.length) { console.log(errs.join("; ")); process.exit(1); }
' >"$TMP/w.log" 2>&1 || bad 2 "wrangler.jsonc: $(cat "$TMP/w.log")"
run_tagged 2 "" "S220 AC 2"

# --- Check 3: AC 3: the comparison recorded under ADR-020 ---
adr="$(awk '/^### ADR-020 /{on=1; next} on && /^### ADR-/{exit} on' "$ARCH" 2>/dev/null)"
note="$(grep -E 'S220' <<<"$adr")"
if [ -z "$note" ]; then
	bad 3 "$ARCH has no S220 note under ADR-020"
else
	grep -qE '20[0-9]{2}-[0-9]{2}-[0-9]{2}' <<<"$note" || bad 3 "the S220 note is not dated"
	grep -qi 'round trip' <<<"$note" || bad 3 "the S220 note does not say round trips are measured"
	grep -qE 'wrangler tail|Workers Logs' <<<"$note" || bad 3 "the S220 note does not say where the lines are read (wrangler tail or Workers Logs)"
	grep -qE '`?kind`?' <<<"$note" || bad 3 "the S220 note does not say the lines are read by kind"
	grep -qE 'BT_INGEST_LOCATION_HINT|locationHint' <<<"$note" || bad 3 "the S220 note does not name the hint"
	grep -qi 'staging' <<<"$note" && grep -qi 'production' <<<"$note" || bad 3 "the S220 note does not say staging carries the hint and production not"
	grep -qi 'owner' <<<"$note" || bad 3 "the S220 note does not say production takes the hint only by a change the owner approves"
fi

# --- Check 4: AC 4: comments say what is logged and why ---
c="$(doc_before "$CONNECT" '^export async function inDatabaseScope')"
grep -qi 'round trip' <<<"$c" && grep -qiE 'log' <<<"$c" && grep -qiE 'neon|distance|far|near' <<<"$c" || bad 4 "inDatabaseScope's comment does not say what it logs (round trips) and why (the distance to the database)"
grep -qiE 'round trip' <<<"$(sed -n '1,20p' "$INGEST")" || bad 4 "$INGEST's header comment does not say its scopes log their round trips"
s="$(doc_before "$WORKER" 'async scheduled\(')"
grep -qi 'round trip' <<<"$s" && grep -qE 'cron' <<<"$s" || bad 4 "scheduled()'s comment does not say each job logs its round trips (kind cron)"
grep -qiE 'location ?hint|BT_INGEST_LOCATION_HINT' "$INGEST" || bad 4 "$INGEST does not explain the location hint"

# --- Check 5: AC 5: Status done ---
[ "$(story_snapshot_status S220)" = "done" ] || bad 5 "S220's snapshot does not record Status done"

# --- Check 6: fence ---
fence='^(functions/src/|functions/vitest\.config\.ts$|functions/vitest\.workers\.config\.ts$|wrangler\.jsonc$|docs/v3/ARCHITECTURE\.md$|docs/v3/backlog/|docs/v3/audit/|changelog\.d/S220\.md$|scripts/verify-S220\.sh$)'
while IFS= read -r f; do
	[ -z "$f" ] && continue
	grep -qE "$fence" <<<"$f" || bad 6 "outside the fence: $f"
done < <(story_own_changed_files S220 "$BASE" .)
own_added="$(story_own_diff S220 "$BASE" --name-status --diff-filter=A -- scripts/verify-S220.sh)"
[ -n "$own_added" ] || [ -n "$(git ls-files --others --exclude-standard -- scripts/verify-S220.sh)" ] || bad 6 "scripts/verify-S220.sh was not created by S220"

report "verify-S220"
exit $?
