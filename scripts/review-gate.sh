#!/usr/bin/env bash
# Run due reviews on their own (owner, 2026-10-22: "all the different types of reviews
# automatically run whenever they are required and not blocked"). Registered as a
# Claude Code hook in .claude/settings.json (Cursor runs it too); also runnable by hand.
#
#   scripts/review-gate.sh prompt   # UserPromptSubmit: tell the agent, before it acts, what is due
#   scripts/review-gate.sh stop     # Stop: keep the agent going until every due review has run
#
# Due-ness comes from scripts/review-debt.sh (backlog review / design intake) and
# scripts/parity-debt.sh (doc parity), which read committed history only.
# A review whose newest ledger entry is `blocked` with no answers entry after it waits
# for the owner: the gate reports it and never runs it on its own.
# Stays quiet while the working tree is dirty: a story or review is mid-flight, and a
# review must not land in the same commit as other work. In a parallel /run-backlog the main
# checkout stays clean while items build in their own worktrees, so the gate fires then too: its
# instructions say to start the review beside the in-flight items, never to pause them (S156;
# .claude/skills/run-backlog/SKILL.md step 2).
# Loop guard: Stop blocks once per HEAD + due set, whether or not the turn was forced, so a
# turn that ends without committing a review neither spins nor gets the same message again at
# every later turn's end (owner, 2026-11-24: "Do all 6 token savers"). Cursor runs this same
# hook but marks a forced turn with `loop_count` above 0 instead of Claude Code's
# `stop_hook_active: true`, and sets no loop limit on Claude Code hooks (B481), so the guard keys
# on the state file alone, never on either flag.
# A due review already recorded on an open pull request counts as handled (same owner words):
# the review ran and its entry waits to merge, so asking again only re-runs it. Its entry is an
# added `docs/v3/audit/<date>/<stamp>-<kind>-review.md` (or `-skip.md` / `-answers.md`, which
# clear a drift event but never a due-by-count or turn-cap backlog review, nor a due-by-count
# parity review: a skip never resets the count). Read through `gh` (REST); when it can't answer
# (offline, signed out), the gate behaves as before and asks for the review.

set -uo pipefail
mode="${1:-stop}"
[ -t 0 ] || cat >/dev/null # the hook payload; the guard needs none of it
cd "$(dirname "$0")/.." || exit 0

LEDGER="docs/v3/AUDIT.md"

# Blocked if the newest review or answers entry of the kind is a blocked review (ledger.ts
# reviewBlocked, the ledger's one parser). A ledger that can't be read counts as blocked, so
# the gate waits for a person rather than running reviews on a broken ledger.
blocked() {
  [ "$(node scripts/backlog-vault/cli.ts --audit "$LEDGER" review-blocked "$1" 2>/dev/null)" != "clear" ]
}

[ -n "$(git status --porcelain 2>/dev/null)" ] && exit 0

# The review entries open pull requests add, one `<kind>-<entry>` a line (`backlog-review`,
# `parity-skip`, …), read once and only when a review is due; empty when `gh` can't answer.
pending=""
pending_read=""
pending_entries() {
  [ -n "$pending_read" ] && return 0
  pending_read=1
  local prs n
  prs="$(gh api 'repos/{owner}/{repo}/pulls?state=open&per_page=100' --jq '.[].number' 2>/dev/null)" || return 0
  pending="$(for n in $prs; do
    gh api "repos/{owner}/{repo}/pulls/${n}/files?per_page=100" --jq '.[] | select(.status == "added") | .filename' 2>/dev/null
  done | sed -nE 's#^docs/v3/audit/[^/]+/[^/]+-((backlog|parity)-(review|skip|answers))\.md$#\1#p' | sort -u)"
}

# handled <backlog|parity> <its debt script>: the due review is already recorded on an open pull
# request. A pending review always is; a pending skip or answers entry only when nothing due is
# a story count or a turn-cap hit, which only a review clears.
handled() {
  pending_entries
  grep -qx "$1-review" <<<"$pending" && return 0
  grep -qxE "$1-(skip|answers)" <<<"$pending" || return 1
  ! "$2" --json 2>/dev/null | grep -qE '"kind":"(count|turn-cap)"'
}

todo=()
waiting=()
if blocked backlog; then
  waiting+=("backlog review")
elif ! out="$(scripts/review-debt.sh 2>&1)" && ! handled backlog scripts/review-debt.sh; then
  if grep -q "design intake" <<<"$out"; then
    todo+=("DESIGN INTAKE REVIEW: two independent design-intake-reviewer Agent subagents (each loads .claude/skills/design-intake-review/SKILL.md), which report without editing; then one design-intake-merger subagent, given both reports, merges and applies them and logs with scripts/audit.sh review. Don't read the skill into this context yourself."$'\n'"$out")
  else
    todo+=("BACKLOG REVIEW: one fresh-context backlog-reviewer Agent subagent (it loads .claude/skills/backlog-review/SKILL.md), given this output, runs it, logs with scripts/audit.sh review and commits. Don't read the skill into this context yourself."$'\n'"$out")
  fi
fi
if blocked parity; then
  waiting+=("doc parity review")
elif ! out="$(scripts/parity-debt.sh 2>&1)" && ! handled parity scripts/parity-debt.sh; then
  todo+=("DOC PARITY REVIEW: one fresh-context doc-parity-reviewer Agent subagent (it loads .claude/skills/doc-parity-review/SKILL.md), given this output, runs it, logs with scripts/audit.sh parity and commits. Don't read the skill into this context yourself."$'\n'"$out")
fi

wait_note=""
if [ "${#waiting[@]}" -gt 0 ]; then
  wait_note="Blocked, waiting for the owner's answers (do not run it, and do not start a story; in a parallel run the in-flight items still finish): $(IFS=,; echo "${waiting[*]}"). Ask the owner the open questions in its newest review entry: a fragment under docs/v3/audit/ (docs/v3/audit.jsonl indexes them; scripts/backlog-vault/ledger.ts reads them)."
fi

if [ "${#todo[@]}" -eq 0 ]; then
  [ -n "$wait_note" ] && [ "$mode" = "prompt" ] && echo "$wait_note"
  exit 0
fi

body="$(printf '%s\n\n' "${todo[@]}")"
instructions="Review debt is due. Run these reviews now, in this order (CLAUDE.md Agent / loop rules). In a parallel /run-backlog (in-flight items claimed in .run/claims/), each starts at once in its own worktree beside the in-flight items and never pauses them: it edits no in-flight item's note, logs its entry with --in-flight <IDs>, and no new story starts until it is logged (bugs may). Otherwise run it before starting the next story:

${body}
Each review commits its edits together with its ledger entry, one commit per review. Run the backlog or design intake review before the doc parity review, and re-run scripts/review-debt.sh and scripts/parity-debt.sh after each commit, since one review can make the other due. If a verdict is \`blocked\`, stop and ask the owner its questions. Each review's commit opens as its own pull request into stage.${wait_note:+

$wait_note}"

if [ "$mode" = "prompt" ]; then
  echo "$instructions"
  exit 0
fi

stamp="$(git rev-parse HEAD) $(printf '%s' "$body" | shasum | cut -c1-12)"
state="$(git rev-parse --git-dir)/bt-review-gate"
[ "$(cat "$state" 2>/dev/null)" = "$stamp" ] && exit 0
echo "$stamp" >"$state"
node -e 'process.stdout.write(JSON.stringify({ decision: "block", reason: process.argv[1] }))' "$instructions"
