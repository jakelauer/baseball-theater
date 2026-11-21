#!/usr/bin/env bash
# Shared check bookkeeping for the `scripts/verify-<ID>.sh` graders.
#
# Graders used to print only failures, so a passing run left no record of what
# was actually checked. Each grader now declares its checks up front with
# `check <id> "<description>"`, calls `bad <id> "<reason>"` on failure, and ends
# with `report`, which prints one PASS/FAIL line per declared check. That output
# is what `scripts/audit.sh` captures into the story's ledger fragment,
# `docs/v3/audit/<date>/<stamp>-<ID>-<kind>.md`.
#
# Sourced, not executed. The grader owns `cd` and its own exit.

# Parallel arrays indexed by check id (bash 3.2 on macOS has no assoc arrays).
CHECK_DESC=()
CHECK_FAIL=()
CHECK_ORDER=()
fail=0

# check <id> <description> — declare a check so it is reported even when it passes.
check() {
  CHECK_DESC[$1]="$2"
  CHECK_FAIL[$1]=0
  CHECK_ORDER+=("$1")
}

# bad <id> <reason> — record a failure against a declared check.
bad() {
  CHECK_FAIL[$1]=1
  fail=1
  echo "FAIL check $1: $2"
}

# report <grader-id> — per-check results plus a machine-readable tally.
# Returns the grader's intended exit status.
report() {
  local grader="$1"
  local id status passed=0 failed=0

  echo
  echo "--- ${grader} check results ---"
  for id in "${CHECK_ORDER[@]}"; do
    if [ "${CHECK_FAIL[$id]:-0}" -eq 0 ]; then
      status="PASS"
      passed=$((passed + 1))
    else
      status="FAIL"
      failed=$((failed + 1))
    fi
    echo "check ${id} ${status}: ${CHECK_DESC[$id]}"
  done

  echo "--- ${grader}: ${passed}/$((passed + failed)) checks passed ---"
  if [ "$fail" -eq 0 ]; then
    echo "${grader}: all checks passed"
  fi
  return "$fail"
}

# --- A grader proves its own story (S84; owner, 2026-10-28) --------------------------
# A grader is a commit-time proof: its "this story didn't change X" checks look only at
# the story's own commits, so a later story that legitimately changes X can't turn it
# red. Before the story is committed that is <base> → the working tree; once shipped it
# is <base> → the story's shipping commit, wherever the grader runs. Checks that must
# hold forever are laws (docs/v3/LAWS.md), run by `pnpm verify`, not by graders.

# story_tip <ID> — the story's shipping commit, or nothing while it is unshipped. One
# lookup with `audit.sh --reverify` (S88; owner, 2026-10-29: "Yes"): shipping_commit
# reads the ledger, so how a commit is worded never moves it. Before the completion
# entry is committed it is empty, and the story_* helpers fall back to the working tree.
story_tip() {
  local ledger="docs/v3/AUDIT.md"
  case "$1" in V*) ledger="docs/v3/VAULT-MIGRATION-AUDIT.md" ;; esac
  [ -f "$ledger" ] || return 0
  # shellcheck source=reverify.sh
  (source "${BASH_SOURCE[0]%/*}/reverify.sh" && shipping_commit "$ledger" "$1")
}

# story_diff <ID> <base> [git diff options…] [-- <paths>…] — `git diff` over the story's own changes.
# Paths print as themselves (core.quotepath=false): git's default quotes and escapes any name
# with a non-ASCII character ("…\342\200\224…" for an em dash), which no fence pattern like
# `^docs/v3/backlog/` can match (#87).
story_diff() {
  local id="$1" base="$2" tip opts=() paths=()
  shift 2
  while [ $# -gt 0 ] && [ "$1" != "--" ]; do opts+=("$1"); shift; done
  [ "${1:-}" = "--" ] && { shift; paths=("$@"); }
  tip="$(story_tip "$id")"
  if [ -n "$tip" ]; then
    git -c core.quotepath=false diff ${opts[@]+"${opts[@]}"} "$base" "$tip" -- ${paths[@]+"${paths[@]}"}
  else
    git -c core.quotepath=false diff ${opts[@]+"${opts[@]}"} "$base" -- ${paths[@]+"${paths[@]}"}
  fi
}

# story_changed_files <ID> <base> <paths>… — files the story added or edited under <paths>
# (its own diff, plus untracked files while it is unshipped), each named as itself even when it
# has a non-ASCII character (#87; see story_diff).
story_changed_files() {
  local id="$1" base="$2"
  shift 2
  {
    story_diff "$id" "$base" --name-only -- "$@"
    [ -z "$(story_tip "$id")" ] && git -c core.quotepath=false ls-files --others --exclude-standard -- "$@"
  } | sort -u
}

# story_own_diff <ID> <base> [git diff options…] [-- <paths>…] — the diffs of the story's own
# commits only (S156 AC 11): each first-parent, non-merge commit between <base> and the tip
# (`git log --first-parent --no-merges`), oldest first, plus the working tree against HEAD while the
# story is unshipped. A merge from `stage` is a merge commit, so the files it brings in are never the
# story's; the merge carries only its conflict resolutions, which this leaves out too. Graders written
# after S156 use it (and story_own_changed_files) instead of story_diff, whose two-tree diff counts
# a merged-in story's files as this one's; story_diff stays as it was, since frozen graders' --reverify
# sources today's checks.sh. Options go to `git log`, so a file two commits touch is listed once per
# commit (`--numstat` gives a line each); assumes the branch's own commits are on its first-parent
# line, so a worker's branch is folded in by fast-forward or cherry-pick, never by a merge commit.
story_own_diff() {
  local id="$1" base="$2" tip opts=() paths=()
  shift 2
  while [ $# -gt 0 ] && [ "$1" != "--" ]; do opts+=("$1"); shift; done
  [ "${1:-}" = "--" ] && { shift; paths=("$@"); }
  tip="$(story_tip "$id")"
  # `git log` prints no patch unless asked, while `git diff` (story_diff) does: with no output-format option,
  # ask for the patch, so a caller grepping the story's own diff sees its lines as it would story_diff's. Any
  # option that chooses the output (a stat, names, raw, no patch, a patch with its context) counts as one.
  local logopts=("${opts[@]+"${opts[@]}"}") o fmt=""
  for o in ${opts[@]+"${opts[@]}"}; do
    case "$o" in
      --numstat | --name-only | --name-status | --stat | --stat=* | --shortstat | --dirstat | --dirstat=* | \
        --summary | --compact-summary | --raw | -s | --no-patch | -p | -u | --patch | --patch-with-stat | \
        --patch-with-raw | -U* | --unified | --unified=*) fmt=1 ;;
    esac
  done
  [ -z "$fmt" ] && logopts+=(-p)
  git -c core.quotepath=false log --first-parent --no-merges --reverse --format= ${logopts[@]+"${logopts[@]}"} "$base..${tip:-HEAD}" -- ${paths[@]+"${paths[@]}"}
  [ -z "$tip" ] && git -c core.quotepath=false diff ${opts[@]+"${opts[@]}"} HEAD -- ${paths[@]+"${paths[@]}"}
  return 0
}

# story_own_changed_files <ID> <base> <paths>… — files the story's own commits added or edited
# under <paths> (story_own_diff), plus untracked files while it is unshipped, each named as itself.
story_own_changed_files() {
  local id="$1" base="$2"
  shift 2
  {
    story_own_diff "$id" "$base" --name-only -- "$@"
    [ -z "$(story_tip "$id")" ] && git -c core.quotepath=false ls-files --others --exclude-standard -- "$@"
  } | grep -v '^$' | sort -u
}

# story_snapshot_file <ID> — the story's newest ship-time snapshot fragment (S164), or nothing.
# `audit.sh story` writes it before it runs the grader, so the grader always finds its own.
story_snapshot_file() {
  find docs/v3/audit -type f -name "*-$1-snapshot.md" 2>/dev/null | awk -F/ '{ print $NF "\t" $0 }' | LC_ALL=C sort | tail -1 | cut -f2
}

# story_snapshot <ID> — the story's text as it shipped: its newest snapshot's body, byte-exact
# (S164 AC 5). Fails (exit 1, nothing printed) when there is no snapshot or its body doesn't hash to
# the SHA-256 the snapshot states. Graders written after S164 read a story's text here, never from
# the network or the issue cache, so they prove the same thing wherever and whenever they run.
story_snapshot() {
  local f
  f="$(story_snapshot_file "$1")"
  [ -n "$f" ] || return 1
  node "${BASH_SOURCE[0]%/*}/../backlog-vault/text-records.ts" body "$f" 2>/dev/null
}

# story_snapshot_status <ID> — the status the story ships with, from its newest snapshot (`done`,
# written by `audit.sh story`), or nothing when it has none. Its passing grader and pnpm verify are
# what make the story done; GitHub's label follows after the merge.
story_snapshot_status() {
  local f
  f="$(story_snapshot_file "$1")"
  [ -n "$f" ] || return 0
  grep -m1 '^| Status | `' "$f" | sed -E 's/^\| Status \| `([^`]*)`.*$/\1/'
}
