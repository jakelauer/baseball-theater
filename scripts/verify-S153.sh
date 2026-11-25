#!/usr/bin/env bash
# Grader for backlog story S153 — Search's result rows get the inning pill (game-shell A6's
# `search-playmeta-*`): the search route returns each result's `playId`, `halfInning` and `inning`,
# parsed by MLB's search parser in `packages/mlb-api` (enhancement #347, folded in), and a row with a
# play reads its date, muted, then S145's `PlayInningPill`; a row with no play keeps `Highlight · <date>`.
# Contract: frame note 00, "Verify-script contract" (docs/v3/backlog/frame/).
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`); runs only the
# story-scoped Vitest files named below, once each, and reads each test's result by name.

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "AC 1: the search route returns playId, halfInning and inning per result from the recorded fixtures (functions test named 'S153 AC 1'); MLB's search types and zod parser live in packages/mlb-api (no zod and no MLB search interfaces under functions/src/mappers/search.ts); fixtures/search-*.json not edited; openapi and the generated types carry halfInning"
check 2 "AC 2: a row with a play renders its date in --bt-muted then PlayInningPill (Top 6 →, named 'Top 6: open play, top of 6th inning', to /game/:pk/plays?play=<playId>), no kind word (RTL named 'S153 AC 2')"
check 3 "AC 3: the pill navigates without opening the player, the title opens the player, the pill is in no <button> (RTL named 'S153 AC 3')"
check 4 "AC 4: a result with no play (any field null, or gamePk -1) keeps 'Highlight · <date>' in --bt-light with no pill (RTL named 'S153 AC 4')"
check 5 "AC 5: SearchResultRow imports PlayInningPill, videoMeta and playInningLink from ../videos/; no Search file builds 'Top '/'Bot ', 'open play, ' or '/plays?play=' or renders its own pill; outside tests under web/src those strings are only in playLink.ts"
check 6 "AC 6: Hide Scores leaves every result's meta line unchanged (RTL named 'S153 AC 6')"
check 7 "AC 7: the 3 design captures from e2e/design/S153.spec.ts under docs/v3/design-checks/S153/ at their pairing widths (390, 768, 1200)"
check 8 "AC 8: S153's Status is done: its snapshot fragment records done"
check 9 "S153 changed no file outside its fence (plus creating scripts/verify-S153.sh and its own records)"

# The commit S153's own changes start from: `git merge-base origin/stage HEAD` when this grader was written.
BASE=f152a44de94144661095f21230e5fda41e4c132c

TMP="$(mktemp -d /tmp/verify-S153.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

# run_vitest <dir> <report> <test files…> — runs the files that exist, once, writing a JSON report.
run_vitest() {
	local dir="$1" out="$2"
	shift 2
	local present=()
	for t in "$@"; do [ -f "$dir/$t" ] && present+=("$t"); done
	[ "${#present[@]}" -gt 0 ] && (cd "$dir" && pnpm exec vitest run "${present[@]}" --reporter=json --outputFile="$out" >"$out.log" 2>&1)
}
run_vitest functions "$TMP/fn.json" src/mappers/search.test.ts src/handlers/search.test.ts
run_vitest packages/mlb-api "$TMP/mlb.json" src/search.test.ts src/parse.test.ts
run_vitest web "$TMP/web.json" src/components/search/SearchResultRow.test.tsx src/pages/SearchPage.test.tsx

# passed <report> <regex> — at least one test whose full name matches ran, and every one that matches passed.
passed() {
	[ -f "$1" ] || return 1
	node -e '
		const r = require(process.argv[1]);
		const re = new RegExp(process.argv[2]);
		const all = r.testResults.flatMap((f) => f.assertionResults);
		const hit = all.filter((t) => re.test(t.fullName));
		process.exit(hit.length > 0 && hit.every((t) => t.status === "passed") ? 0 : 1);
	' "$1" "$2"
}

# --- Check 1: the route's fields, the parser's home, the spec ---
passed "$TMP/fn.json" "S153 AC 1\\b" || bad 1 "no passing functions test named 'S153 AC 1' (or one failed)"
M=functions/src/mappers/search.ts
grep -qE 'from "zod"|\bz\.object\(' "$M" && bad 1 "$M holds a zod schema"
grep -qE '^export (interface|type) Search(Response|Play|MediaPlayback|PlayInfo|Feed|Playback|TeamInfo)\b' "$M" && bad 1 "$M still declares MLB's search types"
zs="$(grep -rlE --exclude='*.test.*' 'z\.object\(' functions/src 2>/dev/null | xargs grep -lE 'mediaPlayback' 2>/dev/null)"
[ -z "$zs" ] || bad 1 "a zod schema of MLB's search answer under functions/src: $zs"
grep -rqE --exclude='*.test.*' 'export function parseSearchResponse\(' packages/mlb-api/src || bad 1 "packages/mlb-api exports no parseSearchResponse"
grep -rqE --exclude='*.test.*' 'mediaPlayback: z\.' packages/mlb-api/src || bad 1 "packages/mlb-api has no zod schema of the search answer's mediaPlayback"
grep -rqE --exclude='*.test.*' 'inningHalf' packages/mlb-api/src || bad 1 "packages/mlb-api's search parser does not read inningHalf"
grep -rqE '"(Top|Bottom)"' functions/src/mappers/search.ts packages/mlb-api/src/search.ts 2>/dev/null || bad 1 "no mapping of MLB's inningHalf to top / bottom"
grep -qF 'parseSearchResponse' functions/src/adapters/http/mlb.ts || bad 1 "functions/src/adapters/http/mlb.ts doesn't call parseSearchResponse"
story_own_changed_files S153 "$BASE" . | grep -qE '^fixtures/search-' && bad 1 "S153 edited a recorded fixtures/search-*.json"
node -e '
	const s = require("./openapi/bt-api.v1.json");
	const txt = JSON.stringify(s);
	process.exit(/"halfInning"/.test(txt) && /"inning"/.test(txt) ? 0 : 1);
' 2>/dev/null || bad 1 "openapi/bt-api.v1.json has no halfInning / inning"
grep -qF 'halfInning' web/src/api/generated/bt-api.v1.ts || bad 1 "web/src/api/generated/bt-api.v1.ts has no halfInning"
grep -qF '"GET /api/v1/search/highlights"' web/src/api/generated.types.test.ts || bad 1 "S29's fidelity entry for the search route is missing"

# --- Checks 2, 3, 4, 6: the rows ---
for n in 2 3 4 6; do passed "$TMP/web.json" "S153 AC $n\\b" || bad "$n" "no passing RTL test named 'S153 AC $n' (or one failed)"; done

# --- Check 5: one pill, one label, one link ---
ROW=web/src/components/search/SearchResultRow.tsx
grep -qE '^import \{[^}]*\bPlayInningPill\b[^}]*\} from "\.\./videos/PlayInningPill\.js";' "$ROW" || bad 5 "$ROW does not import PlayInningPill from ../videos/"
grep -qE '^import \{[^}]*\bvideoMeta\b[^}]*\} from "\.\./videos/videoMeta\.js";' "$ROW" || bad 5 "$ROW does not import videoMeta from ../videos/"
grep -qE '^import \{[^}]*\bplayInningLink\b[^}]*\} from "\.\./videos/playLink\.js";' "$ROW" || bad 5 "$ROW does not import playInningLink from ../videos/"
grep -qE '<PlayInningPill\b' "$ROW" || bad 5 "$ROW renders no PlayInningPill"
SEARCH_FILES=()
while IFS= read -r f; do SEARCH_FILES+=("$f"); done < <(
	{ ls web/src/components/search/* web/src/pages/SearchPage.tsx web/src/api/search.ts packages/domain/src/search.ts packages/mlb-api/src/search.ts functions/src/mappers/search.ts 2>/dev/null; } | grep -v '\.test\.'
)
for f in "${SEARCH_FILES[@]}"; do
	grep -qE '(Top|Bot) \$\{|"(Top|Bot) "|open play, |/plays\?play=' "$f" && bad 5 "$f builds an inning label, a spoken name or a play address"
	grep -qF 'bt-play-pill' "$f" && bad 5 "$f draws its own pill"
done
src_files() { grep -rlF --exclude='*.test.*' --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=coverage -- "$1" web/src packages 2>/dev/null; }
[ "$(src_files 'open play, ')" = "web/src/components/videos/playLink.ts" ] || bad 5 "'open play, ' is in: $(src_files 'open play, ' | tr '\n' ' ')"
[ "$(src_files '/plays?play=')" = "web/src/components/videos/playLink.ts" ] || bad 5 "'/plays?play=' is in: $(src_files '/plays?play=' | tr '\n' ' ')"

# --- Check 7: the 3 captures at their pairing widths ---
[ -f e2e/design/S153.spec.ts ] || bad 7 "e2e/design/S153.spec.ts missing"
for frame in search-playmeta-mobile search-playmeta-medium search-playmeta-desktop; do
	case "$frame" in *-mobile) want=390 ;; *-medium) want=768 ;; *-desktop) want=1200 ;; esac
	f="docs/v3/design-checks/S153/$frame.png"
	if [ ! -f "$f" ]; then
		bad 7 "$f missing"
	else
		w=$(node -e 'const b=require("fs").readFileSync(process.argv[1]);process.stdout.write(String(b.readUInt32BE(16)))' "$f")
		[ "$w" = "$want" ] || bad 7 "$f is ${w}px wide, not $want"
	fi
done

# --- Check 8: Status done ---
[ "$(story_snapshot_status S153)" = "done" ] || bad 8 "S153's snapshot does not record Status done"

# --- Check 9: fence ---
fence='^(fixtures/|packages/domain/|packages/mlb-api/|functions/src/|openapi/|web/src/|web/vitest\.config\.ts$|e2e/design/|docs/v3/design-checks/|docs/v3/backlog/|docs/v3/AUDIT\.md$|docs/v3/audit\.jsonl$|docs/v3/INDEX\.md$|CHANGELOG\.md$|docs/v3/audit/[^/]+/[^/]*-S153-[^/]*\.md$|changelog\.d/S153\.md$|scripts/verify-S153\.sh$)'
while IFS= read -r f; do
	[ -z "$f" ] && continue
	grep -qE "$fence" <<<"$f" || bad 9 "outside the fence: $f"
done < <(story_own_changed_files S153 "$BASE" .)
own_added="$(story_own_diff S153 "$BASE" --name-status --diff-filter=A -- scripts/verify-S153.sh)"
[ -n "$own_added" ] || [ -n "$(git ls-files --others --exclude-standard -- scripts/verify-S153.sh)" ] || bad 9 "scripts/verify-S153.sh was not created by S153"

report "verify-S153"
exit $?
