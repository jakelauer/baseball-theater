#!/usr/bin/env bash
# Is a doc parity review due? (backlog rule 19, "Doc parity reviews", in frame note 00)
#
#   pnpm parity:debt          # prints why or why not; exit 1 when due, 0 when not
#   pnpm parity:debt --in-flight S160,S161   # the items in flight in a parallel run
#   scripts/parity-debt.sh --json   # one JSON object: { due, base, done, inFlight, events } (S163),
#                                   # as scripts/review-debt.sh --json; seeds `pnpm backlog:search seed parity`
#   scripts/parity-debt.sh --json --since <sha>   # the same, with the events and `due` measured from <sha>
#                                   # (the seed passes `cli.ts review-base parity`, past later skips/answers)
#
# Always prints the `done` count and the in-flight count, as scripts/review-debt.sh does (S156).
#
# Measured from the commit that logged the newest "doc parity review" entry, the
# owner's answers to one, or the owner's skip of one, in docs/v3/AUDIT.md. A parity
# review commits its edits together with that entry, and applying the owner's answers
# (scripts/audit.sh answers parity) or declining a review (scripts/audit.sh skip parity)
# is logged the same way, so none counts as debt. The stories-done count resets only on
# a review itself, never on answers or a skip (owner, 2026-11-03: "Skip notes should
# not reset the counter").
# Due when, since then: a product doc changed, a story was created (a `create` text record) or
# closed not_planned (removed, from the issue cache when there is one), a
# story's **Source:** line changed, a pillar-cited story's purpose changed (its Gap,
# Impact or acceptance criteria — the owner's approval may no longer cover it), or 6
# stories went `done` (doubled from 3 by the owner, 2026-10-21). Other story-text edits
# don't count: a feature citation is checked against FEATURES, not the story text, and a
# pillar story's scope list, goal-line paths, work items or notes don't change what it is
# for (owner, 2026-10-23: narrowed after scope-list edits alone kept making it due).
#
# Reads committed history (HEAD; uncommitted edits are not counted) and, for the `removed` event,
# the issue cache when there is one (scripts/lib/story-notes.sh cache_removed).

set -uo pipefail
cd "$(dirname "$0")/.."

in_flight_flag=()
json=""
since=""
while [ $# -gt 0 ]; do
  case "$1" in
    --in-flight)
      # A missing value is an error, not a loop: `shift 2` fails under `set -u` without `-e` and shifts nothing.
      [ $# -ge 2 ] || { echo "usage: $0 [--in-flight S1,S2]" >&2; exit 2; }
      in_flight_flag=(--in-flight "$2"); shift 2 ;;
    --in-flight=*) in_flight_flag=(--in-flight "${1#--in-flight=}"); shift ;;
    --json) json=1; shift ;;
    --since)
      # A value, not the next flag: `--since --json` is a usage error, never a base named "--json".
      { [ $# -ge 2 ] && [ "${2#--}" = "$2" ] && [ -n "$2" ]; } || { echo "usage: $0 [--in-flight S1,S2] [--json [--since <sha>]]" >&2; exit 2; }
      since="$2"; shift 2 ;;
    *) echo "usage: $0 [--in-flight S1,S2] [--json [--since <sha>]]" >&2; exit 2 ;;
  esac
done
# --since only re-bases the JSON report (a review's seed); the text and exit codes keep the ledger's base.
[ -n "$since" ] && [ -z "$json" ] && { echo "usage: $0 [--in-flight S1,S2] [--json [--since <sha>]] — --since needs --json" >&2; exit 2; }
# shellcheck source=lib/story-notes.sh
. scripts/lib/story-notes.sh

# --json: each event the text below reports, as a JSON object (json_event), and the report (json_report).
events=()
# shellcheck disable=SC2329
json_event() { events+=("$(event_json "$@")"); }

LEDGER="${BT_AUDIT_LEDGER:-docs/v3/AUDIT.md}"
STORIES="docs/v3/backlog/stories"
DOCS=(docs/v3/INTENT.md docs/v3/ORIGIN.md docs/v3/FEATURES.md docs/v3/VISUAL-DESIGN.md docs/v3/ARCHITECTURE.md)
BACKSTOP=6

# The ledger is read through scripts/backlog-vault/ledger.ts, its one parser: the base is the newest
# commit that logged a doc parity review, its answers or a skip of one.
LEDGER_CLI=(node scripts/backlog-vault/cli.ts --audit "$LEDGER")
base="$("${LEDGER_CLI[@]}" ledger-base parity)" || { echo "parity: could not read ${LEDGER}" >&2; exit 2; }
# `--json --since <sha>`: measure from that commit instead (S163: the seed passes the newest review itself,
# `cli.ts review-base`, so a change a skip or answers entry passed over is still reported).
if [ -n "$since" ]; then
  base="$(git rev-parse --short "${since}^{commit}" 2>/dev/null)" || { echo "parity: --since ${since} is not a commit" >&2; exit 2; }
fi
if [ -z "$base" ]; then
  [ -n "$json" ] && { json_report true "" "" ""; exit 0; }
  echo "parity: no doc parity review logged in ${LEDGER} yet — one is due."
  exit 1
fi

reasons=()

while IFS= read -r doc; do
  [ -n "$doc" ] && reasons+=("${doc} changed") && json_event doc-changed path "$doc"
done < <(git diff --name-only "$base" HEAD -- "${DOCS[@]}")

# Notes are matched by story ID, not path (scripts/lib/story-notes.sh): a note moving to its new
# status folder is neither an addition nor a removal, and an edit made with a move still counts.
# A note's body is everything after its frontmatter; status/priority flips live in the frontmatter.
body() { git show "$1:$2" 2>/dev/null | awk 'n >= 2 { print } /^---$/ { n++ }'; }
# What a story is for: its **Gap:** and **Impact:** paragraphs and its **Acceptance criteria** list.
purpose() {
  awk '/^\*\*(Gap|Impact):\*\*/ { print; next }
    /^\*\*Acceptance criteria\*\*/ { on = 1; next } on && /^\*\*/ { on = 0 } on && NF { print }'
}
while IFS=$'\t' read -r change id before_path after_path; do
  [ -z "$id" ] && continue
  case "$change" in
    A) reasons+=("${id} added"); json_event inserted id "$id"; continue ;;
    D) reasons+=("${id} removed"); json_event removed id "$id"; continue ;;
  esac
  before="$(body "$base" "$before_path")"
  after="$(body HEAD "$after_path")"
  if [ "$(grep '^\*\*Source:\*\*' <<<"$before")" != "$(grep '^\*\*Source:\*\*' <<<"$after")" ]; then
    reasons+=("${id}'s **Source:** changed")
    json_event source-changed id "$id"
  fi
  if grep -q '^\*\*Source:\*\* Pillar:' <<<"$before$after" &&
    [ "$(purpose <<<"$before")" != "$(purpose <<<"$after")" ]; then
    reasons+=("${id}'s Gap, Impact or acceptance criteria changed, and it cites a pillar")
    json_event purpose-changed id "$id"
  fi
done < <(story_changes "$base" HEAD "$STORIES" | grep -vFf <(migrated_deletions "$base") )

# Since S164 a story's text changes through its text records (scripts/lib/story-notes.sh record_changes).
while IFS=$'\t' read -r change id before_path after_path; do
  [ -z "$id" ] && continue
  case "$change" in
    A) reasons+=("${id} added"); json_event inserted id "$id"; continue ;;
    R) ;;
    *) continue ;;
  esac
  before="$(record_body "$before_path")"
  after="$(record_body "$after_path")"
  if [ "$(grep '^\*\*Source:\*\*' <<<"$before")" != "$(grep '^\*\*Source:\*\*' <<<"$after")" ]; then
    reasons+=("${id}'s **Source:** changed")
    json_event source-changed id "$id"
  fi
  if grep -q '^\*\*Source:\*\* Pillar:' <<<"$before$after" &&
    [ "$(purpose <<<"$before")" != "$(purpose <<<"$after")" ]; then
    reasons+=("${id}'s Gap, Impact or acceptance criteria changed, and it cites a pillar")
    json_event purpose-changed id "$id"
  fi
done < <(record_changes "$base")

# A story closed not_planned since the base: GitHub owns state, so this comes from the issue cache.
while IFS= read -r id; do
  [ -n "$id" ] && reasons+=("${id} removed (closed not_planned)") && json_event removed id "$id"
done < <(cache_removed "$base")

# Stories completed since the newest parity entry, by ledger order (re-verifications don't count).
done_since="$("${LEDGER_CLI[@]}" done-since parity)" || { echo "could not read ${LEDGER}" >&2; exit 2; }
done_count=0
[ -n "$done_since" ] && done_count="$(tr ',' '\n' <<<"$done_since" | wc -l | tr -d ' ')"
if [ "$done_count" -ge "$BACKSTOP" ]; then
  reasons+=("${done_count} stories done since (${done_since})")
  json_event count done "$done_since"
fi

# The counts line, printed whether or not a review is due: stories done since the last review and
# the items in flight (read through cli.ts in-flight, scripts/backlog-vault/in-flight.ts).
in_flight="$(node scripts/backlog-vault/cli.ts in-flight ${in_flight_flag[@]+"${in_flight_flag[@]}"})" || in_flight=""
flight_count=0
[ -n "$in_flight" ] && flight_count="$(tr ',' '\n' <<<"$in_flight" | wc -l | tr -d ' ')"
counts="%s: ${done_count} of ${BACKSTOP} stories done since the last %s; ${flight_count} in flight${in_flight:+ (${in_flight})}."
if [ "$done_count" -eq "$((BACKSTOP - 1))" ]; then
  counts="${counts} A review is due at the next \`done\`; it starts beside the in-flight items, never pausing them."
fi
print_counts() { printf "${counts}\n" "parity" "doc parity review"; }

if [ -n "$json" ]; then
  due=false
  [ "${#reasons[@]}" -gt 0 ] && due=true
  json_report "$due" "$base" "$done_since" "$in_flight"
  exit 0
fi

if [ "${#reasons[@]}" -eq 0 ]; then
  echo "parity: not due — nothing changed since the last doc parity review or its answers (logged in ${base}); ${done_count} of ${BACKSTOP} stories done since."
  print_counts
  exit 0
fi
echo "parity: a doc parity review is due (since ${base}, which logged the last review or its answers):"
printf '  - %s\n' "${reasons[@]}"
print_counts
exit 1
