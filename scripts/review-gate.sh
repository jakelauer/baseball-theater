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
# added `docs/v3/audit/<date>/<stamp>-<kind>-review.md` (or `-skip.md` / `-answers.md`) on a pull
# request from this repository (never a fork's), and it covers only what was due at its branch's
# base: an event since that base (`<debt script> --json --since <merge-base>`), or 6 more stories
# done since it, is due again, so an old parked review's pull request never silences a new one.
# A skip or answers entry never clears a due-by-count or turn-cap review (a skip never resets
# the count). Read through `gh` (REST), at most once a minute (cached under the git dir); when
# `gh` or a debt script's `--json` can't answer, the gate behaves as before and asks.

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

# The review entries open same-repository pull requests add, one `<kind>-<entry> <head sha> <number>`
# a line (`backlog-review 1a2b… 17`, `parity-skip …`), read only when a review is due; empty when
# `gh` can't answer. Cached for 60 seconds (`find -mmin`, which BSD and GNU find both read the same
# way), so a prompt and the Stop that ends its turn make one set of calls; an answer with any failed
# `files` call is used but never cached.
pending=""
pending_read=""
pending_entries() {
  [ -n "$pending_read" ] && return 0
  pending_read=1
  local cache prs n sha files failed=""
  cache="$(git rev-parse --git-dir)/bt-review-gate-prs"
  if [ -n "$(find "$cache" -mmin -1 2>/dev/null)" ]; then
    pending="$(cat "$cache")"
    return 0
  fi
  prs="$(gh api --paginate 'repos/{owner}/{repo}/pulls?state=open&per_page=100' --jq '.[]' 2>/dev/null |
    node -e 'for (const l of require("fs").readFileSync(0, "utf8").split("\n").filter(Boolean)) { const p = JSON.parse(l); if (p.head?.repo?.full_name && p.head.repo.full_name === p.base?.repo?.full_name) console.log(p.number, p.head.sha); }' 2>/dev/null)" || return 0
  while read -r n sha; do
    [ -n "$n" ] || continue
    if ! files="$(gh api --paginate "repos/{owner}/{repo}/pulls/${n}/files?per_page=100" --jq '.[]' 2>/dev/null |
      node -e 'for (const l of require("fs").readFileSync(0, "utf8").split("\n").filter(Boolean)) { const f = JSON.parse(l); if (f.status === "added") console.log(f.filename); }' 2>/dev/null)"; then
      failed=1
      continue
    fi
    pending+="$(sed -nE "s#^docs/v3/audit/[^/]+/[^/]+-((backlog|parity)-(review|skip|answers))\\.md\$#\\1 ${sha} ${n}#p" <<<"$files")"$'\n'
  done <<<"$prs"
  pending="$(sort -u <<<"$pending" | sed '/^$/d')"
  [ -z "$failed" ] && printf '%s' "$pending" >"$cache"
  return 0
}

# have_commit <sha> <pull request number>: the pull request's head is in this repository, fetched
# from origin's `pull/<n>/head` when it isn't (the main checkout often hasn't fetched a review's
# branch), within 15 seconds (perl's alarm, on macOS and Linux alike).
have_commit() {
  git cat-file -e "$1^{commit}" 2>/dev/null && return 0
  perl -e 'alarm shift; exec @ARGV' 15 git fetch -q origin "pull/$2/head" >/dev/null 2>&1
  git cat-file -e "$1^{commit}" 2>/dev/null
}

# json_field <expr>: evaluates a JS expression over the JSON on stdin as `j`, printing its lines.
json_field() {
  node -e 'const j = JSON.parse(require("fs").readFileSync(0, "utf8")); const v = eval(process.argv[1]); for (const x of [].concat(v)) console.log(x);' "$1"
}

# covers <debt script> <head sha> <number>: the pending entry's branch base saw everything due now: no
# event other than the story count or a turn-cap hit since it, and fewer than 6 of the stories
# done since the last review shipped (their snapshot fragment added) after it.
covers() {
  local mb since id after=0
  have_commit "$2" "$3" || return 1
  mb="$(git merge-base HEAD "$2" 2>/dev/null)" || return 1
  since="$("$1" --json --since "$mb" 2>/dev/null)" || return 1
  [ -z "$(json_field 'j.events.map((e) => e.kind).filter((k) => k !== "count" && k !== "turn-cap")' <<<"$since" 2>/dev/null || echo bad)" ] || return 1
  for id in $(json_field 'j.done' <<<"$since" 2>/dev/null); do
    git diff --name-only --diff-filter=A "$mb" HEAD -- docs/v3/audit | grep -qE -- "-${id}-snapshot\.md$" && after=$((after + 1))
  done
  [ "$after" -lt 6 ]
}

# handled <backlog|parity> <its debt script>: the due review is already recorded on an open pull
# request whose base covers it. A pending review is; a pending skip or answers entry only when
# nothing due now is a story count or a turn-cap hit, which only a review clears. Any `--json`
# that fails or doesn't parse counts as not handled, so the gate asks.
handled() {
  local kind sha n now kinds
  pending_entries
  while read -r kind sha n; do
    [ "$kind" = "$1-review" ] && covers "$2" "$sha" "$n" && return 0
  done <<<"$pending"
  while read -r kind sha n; do
    case "$kind" in "$1-skip" | "$1-answers") ;; *) continue ;; esac
    now="$("$2" --json 2>/dev/null)" || return 1
    kinds="$(json_field 'j.events.map((e) => e.kind)' <<<"$now" 2>/dev/null)" || return 1
    grep -qxE 'count|turn-cap' <<<"$kinds" && return 1
    covers "$2" "$sha" "$n" && return 0
  done <<<"$pending"
  return 1
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
