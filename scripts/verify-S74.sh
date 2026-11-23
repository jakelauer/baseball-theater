#!/usr/bin/env bash
# Grader for story S74 — offline reading (ADR-023): a network-first runtime cache of the last
# `/api/v1/*` GET answers (never `/api/v1/me` or below, ADR-028), S55's offline marker in the
# notice slot naming the copy's time and age from `fetchedAgo`, Hide Scores on offline copies,
# today's schedule and favorites' games prefetched on open, Periodic Background Sync where the
# browser offers it, and the design match against the ratified offline frames (rule 22).
# A commit-time proof of this story (S84).
# Contract: frame note 00, "Verify-script contract" (docs/v3/backlog/frame/).
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`); runs only the
# story-scoped Vitest files named below, and reads each test's result by name.

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "AC 1: a NetworkFirst runtime cache of /api/v1/* GETs whose match excludes /api/v1/me and below (RTL/config 'S74 AC 1' tests), its cache name declared and labeled in web/src/storage/ (test), no lifetime constant (maxAgeSeconds, ExpirationPlugin, expiration, networkTimeoutSeconds) in web/src/pwa/ or web/public/"
check 2 "AC 2: offline, the scoreboard (mobile, medium, desktop) and a viewed game (and a live one whose polls fail) show the NoticeBanner in the NoticeSlot with no action, naming the copy's time and age from fetchedAgo, no offline footer line, no Live strip; a never-viewed room shows only 'You're offline.' over empty content; offline and update show together (tests 'S74 AC 2 …')"
check 3 "AC 3: offline copies render the Hide Scores masks when useScoresHidden says so, on the scoreboard and in a room (tests 'S74 AC 3 …')"
check 4 "AC 4: on open, signed in prefetches today's schedule and the favorites' games; signed out today's schedule only (tests 'S74 AC 4 …' assert the requests)"
check 5 "AC 5: Periodic Background Sync registers only where supported (tests 'S74 AC 5 supported' / 'unsupported')"
check 6 "AC 6: files this story adds or edits have no team-logo <img> or /logos/ reference and call no useMediaQuery, hiddenFrom or visibleFrom outside web/src/layout/"
check 7 "AC 7: the six offline captures from e2e/design/S74.spec.ts under docs/v3/design-checks/S74/ at their pairing widths (390/768/1200)"
check 8 "AC 8: S74's Status is done: its snapshot fragment records done"
check 9 "S74 changed no file outside its fence (plus creating scripts/verify-S74.sh and its own records)"

# The commit S74's own changes start from: `git merge-base origin/stage HEAD` when this grader was written.
BASE=28d432a534a732e00baa219c517b3a142b5f22cb

TMP="$(mktemp -d /tmp/verify-S74.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

WEB_TESTS=(src/pwa/pwa.test.ts src/storage/storage.test.ts src/pwa/offline.test.tsx src/pwa/prefetch.test.tsx)
present=()
for t in "${WEB_TESTS[@]}"; do [ -f "web/$t" ] && present+=("$t"); done
if [ "${#present[@]}" -gt 0 ]; then
	(cd web && pnpm exec vitest run "${present[@]}" --reporter=json --outputFile="$TMP/web.json" >"$TMP/web.log" 2>&1)
fi

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

# Each state the ACs name has its own passing test, so one passing test can't stand for all of them.
for name in "S74 AC 1 runtime cache" "S74 AC 1 never /api/v1/me" "S74 AC 1 cache name"; do
	passed "$TMP/web.json" "$name\\b" || bad 1 "no passing web test named '$name'"
done
for name in "S74 AC 2 scoreboard mobile" "S74 AC 2 scoreboard medium" "S74 AC 2 scoreboard desktop" "S74 AC 2 game" \
	"S74 AC 2 live game" "S74 AC 2 never-viewed room" "S74 AC 2 with update"; do
	passed "$TMP/web.json" "$name\\b" || bad 2 "no passing web test named '$name'"
done
for name in "S74 AC 3 scoreboard" "S74 AC 3 room"; do
	passed "$TMP/web.json" "$name\\b" || bad 3 "no passing web test named '$name'"
done
for name in "S74 AC 4 signed in" "S74 AC 4 signed out"; do
	passed "$TMP/web.json" "$name\\b" || bad 4 "no passing web test named '$name'"
done
for name in "S74 AC 5 supported" "S74 AC 5 unsupported"; do
	passed "$TMP/web.json" "$name\\b" || bad 5 "no passing web test named '$name'"
done

# --- Check 1: the runtime cache ---
O=web/src/pwa/options.ts
grep -qF 'runtimeCaching' "$O" || bad 1 "$O declares no runtimeCaching"
grep -qF '"NetworkFirst"' "$O" || bad 1 "$O's runtime cache is not NetworkFirst"
grep -qE 'API_CACHE' web/src/storage/storage.ts || bad 1 "web/src/storage/storage.ts declares no API_CACHE entry"
grep -qE 'API_CACHE' "$O" || bad 1 "$O does not take its cache name from web/src/storage/"
# Tests are left out: pwa.test.ts names these words to assert they are absent (pre-ship update, rule 7).
lifetimes="$(grep -rlE --exclude='*.test.*' 'maxAgeSeconds|ExpirationPlugin|expiration[:"]|networkTimeoutSeconds' web/src/pwa web/public 2>/dev/null)"
[ -z "$lifetimes" ] || bad 1 "a client-side lifetime decides freshness in: $(tr '\n' ' ' <<<"$lifetimes")"

# --- Check 2: the marker ---
off=web/src/pwa/offline.ts
if [ ! -f "$off" ]; then
	bad 2 "$off missing"
else
	grep -qF 'fetchedAgo(' "$off" || bad 2 "$off does not call fetchedAgo( for the copy's age"
	grep -qF "You're offline." "$off" || bad 2 "$off has no \"You're offline.\" copy"
fi
grep -rqE 'Offline ·|saved \$\{' web/src --include='*.tsx' --exclude='*.test.*' && bad 2 "a footer line naming the offline state or its age is built under web/src"
grep -qF 'baseball.theater' web/src/layout/SiteFooter.tsx && bad 2 "the footer names baseball.theater"

# --- Check 6: no logos, no viewport queries outside web/src/layout/ ---
story_own_changed_files S74 "$BASE" web/src | while read -r f; do
	[ -f "$f" ] || continue
	grep -nE '<img[^>]*logo|/logos/' "$f" >/dev/null && echo "logo: $f"
	case "$f" in web/src/layout/*) ;; *) grep -lE 'useMediaQuery|hiddenFrom|visibleFrom' "$f" >/dev/null && echo "viewport: $f" ;; esac
done >"$TMP/six.txt"
[ -s "$TMP/six.txt" ] && bad 6 "$(tr '\n' ' ' <"$TMP/six.txt")"

# --- Check 7: the captures at their pairing widths ---
[ -f e2e/design/S74.spec.ts ] || bad 7 "e2e/design/S74.spec.ts missing"
for frame in scoreboard-offline-mobile scoreboard-offline-medium scoreboard-offline-desktop room-offline-mobile \
	room-offline-unviewed-mobile site-footer-offline-mobile; do
	case "$frame" in *-mobile) want=390 ;; *-medium) want=768 ;; *-desktop) want=1200 ;; esac
	f="docs/v3/design-checks/S74/$frame.png"
	if [ ! -f "$f" ]; then
		bad 7 "$f missing"
	else
		w=$(node -e 'const b=require("fs").readFileSync(process.argv[1]);process.stdout.write(String(b.readUInt32BE(16)))' "$f")
		[ "$w" = "$want" ] || bad 7 "$f is ${w}px wide, not $want"
	fi
done

# --- Check 8: Status done ---
[ "$(story_snapshot_status S74)" = "done" ] || bad 8 "S74's snapshot does not record Status done"

# --- Check 9: fence ---
fence='^(web/|docs/v3/backlog/|docs/v3/AUDIT\.md$|CHANGELOG\.md$|e2e/design/|docs/v3/design-checks/|docs/v3/audit/[^/]+/[^/]*-S74-[^/]*\.md$|changelog\.d/S74\.md$|scripts/verify-S74\.sh$)'
while IFS= read -r f; do
	[ -z "$f" ] && continue
	grep -qE "$fence" <<<"$f" || bad 9 "outside the fence: $f"
done < <(story_own_changed_files S74 "$BASE" .)
own_added="$(story_own_diff S74 "$BASE" --name-status --diff-filter=A -- scripts/verify-S74.sh)"
[ -n "$own_added" ] || [ -n "$(git ls-files --others --exclude-standard -- scripts/verify-S74.sh)" ] || bad 9 "scripts/verify-S74.sh was not created by S74"

report "verify-S74"
exit $?
