#!/usr/bin/env bash
# Is a backlog review (or design intake review) due? (CLAUDE.md "Agent / loop rules";
# .claude/skills/backlog-review, .claude/skills/design-intake-review)
#
#   pnpm review:debt          # prints why or why not; exit 1 when due, 0 when not
#   pnpm review:debt --in-flight S160,S161   # the items in flight in a parallel run
#
# Always prints the `done` count since the last review and the in-flight count (S156): the items
# workers have claimed (`--in-flight`, else the run's .run/claims/<ID>.json files). A review that
# falls due starts beside them in its own subagent, never pausing them (owner, 2026-11-20: "Run
# them in parallel (Recommended)"), so the count says how many will land past it.
#
# The sibling of scripts/parity-debt.sh. Drift events are measured from the commit that
# logged the newest "backlog review" entry, the owner's answers to one, or the owner's
# skip of one, in docs/v3/AUDIT.md (a design intake logs as a backlog review, so it
# moves the same base). The stories-done count resets only on a review itself, never on
# answers or a skip (owner, 2026-11-03: "Skip notes should not reset the counter"), as
# the generated review-debt line in docs/v3/INDEX.md counts (scripts/backlog-vault/assemble.ts).
#
# Detects the drift events that leave a trace in committed history:
#   - a surface ratified or a ratified amendment landed     → design intake review
#     (an amendment still marked as a draft never counts; see is_draft below)
#     (nor does an amendment edit that only changes the URL on its Source: line; see source_only)
#   - ARCHITECTURE.md changed (an ADR accepted or changed)  → design intake if the diff
#     names a frontend ADR (003, 008, 014, 016, 020–026), else backlog review
#   - a new workspace package appeared
#   - a story note added or removed, or a story's priority changed (inserted or
#     re-prioritized outside a review)
#   - a story's acceptance criteria rewritten
#   - the `verify` script in package.json changed (the gate moved)
#   - 6 stories went `done` (doubled from 3 by the owner, 2026-10-21)
# Not detectable here, so still the agent's to notice: a scope fence widened or a
# turn cap hit mid-run (rule 10 stop-and-report).
#
# Reads committed history only (HEAD); uncommitted edits are not counted.

set -uo pipefail
cd "$(dirname "$0")/.."

in_flight_flag=()
while [ $# -gt 0 ]; do
  case "$1" in
    --in-flight)
      # A missing value is an error, not a loop: `shift 2` fails under `set -u` without `-e` and shifts nothing.
      [ $# -ge 2 ] || { echo "usage: $0 [--in-flight S1,S2]" >&2; exit 2; }
      in_flight_flag=(--in-flight "$2"); shift 2 ;;
    --in-flight=*) in_flight_flag=(--in-flight "${1#--in-flight=}"); shift ;;
    *) echo "usage: $0 [--in-flight S1,S2]" >&2; exit 2 ;;
  esac
done
# shellcheck source=lib/story-notes.sh
. scripts/lib/story-notes.sh

LEDGER="${BT_AUDIT_LEDGER:-docs/v3/AUDIT.md}"
STORIES="docs/v3/backlog/stories"
BACKSTOP=6

# The ledger is read through scripts/backlog-vault/ledger.ts, its one parser: the base is the newest
# commit that logged a backlog review, its answers or a skip of one.
LEDGER_CLI=(node scripts/backlog-vault/cli.ts --audit "$LEDGER")
base="$("${LEDGER_CLI[@]}" ledger-base backlog)" || { echo "review: could not read ${LEDGER}" >&2; exit 2; }
if [ -z "$base" ]; then
  echo "review: no backlog review logged in ${LEDGER} yet — one is due."
  exit 1
fi

reasons=()
intake=()

# A draft amendment never makes an intake due (owner, 2026-11-10: "So I would just avoid doing
# any design reviews on draft designs"): the work a draft implies changes when the design does.
# A draft is an amendment whose committed text still has a draft marker (`**Draft`, or "not
# ratified" / "not yet ratified", anywhere in the file, any case: the marker test the S123 and
# S129 graders use; S133's grader reads only the header and ## Ratification) and has no line
# starting "Ratified by:" with a name after it (every ratified amendment carries one, in its
# ## Ratification). A phrase like "as ratified by A6" in a sentence is not that line. Ratifying
# a draft rewrites the file, so it stops matching and the intake is due then. When the two marks
# disagree it counts as ratified, so a doubt runs the intake rather than skipping it.
# A deleted amendment is judged by its text at the base: deleting a draft makes nothing due,
# deleting a ratified amendment still counts.
is_draft()
{
  local text
  text="$(git show "HEAD:$1" 2>/dev/null || git show "$base:$1" 2>/dev/null)" || return 1
  grep -qiE '\*\*Draft|not (yet )?ratified' <<<"$text" && ! grep -qE '^Ratified by:[[:space:]]*[^[:space:]]' <<<"$text"
}

# An edit to a ratified amendment that changes only the URL on its `Source:` line changes no
# frame, decision or requirement, so it never makes an intake due (owner, 2026-11-16, asked
# whether review-debt.sh should ignore edits that only change an amendment's Source: link: "Yes").
# The whole file is compared at the base and at HEAD with each `Source:` line's URLs masked, so
# other text on that line (some name their frames there) and every other line still count, as
# does a file added or deleted since the base. Only amendments: a re-sealed DESIGN.md, REVISIONS.md
# or RATIFIED.md still makes an intake due.
mask_source_links() { sed -E '/^Source:/s#https?://[^[:space:])]+#<link>#g' <<<"$1"; }
source_only()
{
  local before after
  before="$(git show "$base:$1" 2>/dev/null)" && after="$(git show "HEAD:$1" 2>/dev/null)" || return 1
  [ "$before" != "$after" ] && [ "$(mask_source_links "$before")" = "$(mask_source_links "$after")" ]
}

while IFS= read -r path; do
  [ -z "$path" ] && continue
  case "$path" in
    */amendments/*) is_draft "$path" && continue; source_only "$path" && continue ;;
  esac
  intake+=("${path} added or changed")
done < <(git diff --name-only "$base" HEAD -- 'docs/v3/visual/*/RATIFIED.md' 'docs/v3/visual/*/amendments/*.md')

if ! git diff --quiet "$base" HEAD -- docs/v3/ARCHITECTURE.md; then
  if git diff "$base" HEAD -- docs/v3/ARCHITECTURE.md | grep -E '^[+-]' | grep -qE 'ADR-0(03|08|14|16|2[0-6])\b'; then
    intake+=("ARCHITECTURE.md changed a frontend ADR")
  else
    reasons+=("ARCHITECTURE.md changed (ADR accepted or changed)")
  fi
fi

while IFS= read -r path; do
  [ -n "$path" ] && reasons+=("new workspace package: $(dirname "$path")")
done < <(git diff --name-only --diff-filter=A "$base" HEAD -- 'packages/*/package.json')

if [ "$(git show "$base:package.json" 2>/dev/null | grep '"verify":')" != "$(git show HEAD:package.json | grep '"verify":')" ]; then
  reasons+=("pnpm verify itself changed")
fi

# Notes are matched by story ID, not path (scripts/lib/story-notes.sh): a note moving to its new
# status folder is neither an insertion nor a removal, and an edit made with a move still counts.
# The numbered list (and its nested bullets) under **Acceptance criteria**.
acs() { git show "$1:$2" 2>/dev/null | awk '/^\*\*Acceptance criteria\*\*/ { on = 1; next } on && /^\*\*/ { on = 0 } on && NF { print }'; }
prio() { git show "$1:$2" 2>/dev/null | grep -m1 '^priority:'; }
while IFS=$'\t' read -r change id before after; do
  [ -z "$id" ] && continue
  case "$change" in
    A) reasons+=("${id} inserted outside a review") ;;
    D) reasons+=("${id} removed outside a review") ;;
    M)
      [ "$(prio "$base" "$before")" != "$(prio HEAD "$after")" ] && reasons+=("${id} re-prioritized outside a review")
      [ "$(acs "$base" "$before")" != "$(acs HEAD "$after")" ] && reasons+=("${id}'s acceptance criteria rewritten")
      ;;
  esac
done < <(story_changes "$base" HEAD "$STORIES")

# Stories completed since the newest backlog review (`## … — backlog review (\`verdict\`)`; answers
# and skip entries don't reset it), by ledger order (re-verifications don't count).
done_since="$("${LEDGER_CLI[@]}" done-since backlog)" || { echo "could not read ${LEDGER}" >&2; exit 2; }
done_count=0
[ -n "$done_since" ] && done_count="$(tr ',' '\n' <<<"$done_since" | wc -l | tr -d ' ')"
if [ "$done_count" -ge "$BACKSTOP" ]; then
  reasons+=("${done_count} stories done since (${done_since})")
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
print_counts() { printf "${counts}\n" "review" "backlog review"; }

if [ "${#reasons[@]}" -eq 0 ] && [ "${#intake[@]}" -eq 0 ]; then
  echo "review: not due — nothing changed since the last backlog review or its answers (logged in ${base}); ${done_count} of ${BACKSTOP} stories done since."
  print_counts
  exit 0
fi
if [ "${#intake[@]}" -gt 0 ]; then
  echo "review: a design intake review is due (since ${base}, which logged the last backlog review or its answers):"
  printf '  - %s\n' "${intake[@]}"
  [ "${#reasons[@]}" -gt 0 ] && printf '  - %s\n' "${reasons[@]}"
else
  echo "review: a backlog review is due (since ${base}, which logged the last backlog review or its answers):"
  printf '  - %s\n' "${reasons[@]}"
fi
print_counts
exit 1
