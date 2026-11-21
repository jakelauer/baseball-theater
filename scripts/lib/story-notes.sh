#!/usr/bin/env bash
# Story notes compared by ID between two commits, for scripts/review-debt.sh and scripts/parity-debt.sh.
#
# A note lives at docs/v3/backlog/stories/<status>/S<N>.md and moves folders whenever its status
# changes (owner, 2026-11-17: "I would like the backlog folder organization to put stories into
# folders by state if possible (and if obsidian won't break). the flat list is getting huge."),
# so a path-based `git diff` would see every status flip as one story removed and another added.
# Matching by file name (the story ID) instead makes a move an edit, and also reads a base commit
# from before the status folders, when every note sat flat in stories/.
#
# Sourced, not executed. The caller owns `cd` (repo root) and its exit.

# story_changes <base> <head> <stories dir>
# One tab-separated line per story whose note differs, sorted by ID:
#   A <id> <head path>               added since base
#   D <id> <base path>               removed since base
#   M <id> <base path> <head path>   in both, with different content (moved, edited, or both)
# A note that only moved with identical content is still an M; the callers compare what they care
# about (priority, acceptance criteria, Source line), so a move alone raises nothing.
story_changes()
{
  local base="$1" head="$2" dir="$3"
  {
    git ls-tree -r "$base" -- "$dir" | sed 's/^/B /'
    git ls-tree -r "$head" -- "$dir" | sed 's/^/H /'
  } | awk '
    {
      # "<B|H> <mode> blob <sha>\t<path>"
      split($0, halves, "\t"); path = halves[2]
      n = split(path, parts, "/"); file = parts[n]
      if (file !~ /^S[0-9]+\.md$/) next
      id = substr(file, 1, length(file) - 3)
      if ($1 == "B") { bpath[id] = path; bblob[id] = $4 } else { hpath[id] = path; hblob[id] = $4 }
    }
    END {
      for (id in bpath)
      {
        if (!(id in hpath)) print "D\t" id "\t" bpath[id]
        else if (bblob[id] != hblob[id] || bpath[id] != hpath[id]) print "M\t" id "\t" bpath[id] "\t" hpath[id]
      }
      for (id in hpath) if (!(id in bpath)) print "A\t" id "\t" hpath[id]
    }' | sort -t $'\t' -k2,2
}

# record_changes <base> — the story text records (S164: a story's text is its GitHub issue, and the
# repository keeps its text as ledger fragments, scripts/backlog-vault/text-records.ts) added since
# <base>, one tab-separated line each, sorted by ID (text-records.ts `changes`):
#   A <id> <path>                   a story created (an `inserted` event)
#   R <id> <before path> <path>     a story's text edited: compare the two bodies (read at HEAD)
#   X <id> <path>                   a migration that rewrote the story's text (an `ac-rewritten` event)
# A migration fragment is never an insertion, so the migrated IDs don't flood a review.
record_changes()
{
  local added
  added="$(git diff --name-only --diff-filter=A "$1" HEAD -- docs/v3/audit |
    grep -E -- '-S[0-9]+-(create|edit|migration)\.md$' || true)"
  [ -z "$added" ] && return 0
  # shellcheck disable=SC2086
  node scripts/backlog-vault/text-records.ts changes $added | sort -t $'\t' -k2,2
}

# migrated_ids <base> — the IDs whose migration fragment was added since <base>: their notes' deletion
# (S164 retired the notes) is the migration, not a removal.
migrated_ids()
{
  git diff --name-only --diff-filter=A "$1" HEAD -- docs/v3/audit |
    sed -nE 's#.*-([SB][0-9]+)-migration\.md$#\1#p'
}

# record_body <path> — a text record's body at HEAD (between its markers).
record_body() { git show "HEAD:$1" 2>/dev/null | awk '/^<!-- bt-body:end -->$/ { on = 0 } on { print } /^<!-- bt-body:begin -->$/ { on = 1 }'; }

# The debt scripts' `--json` report (S163): `pnpm backlog:search seed` reads it to start a review
# from what changed. Values here are story IDs, repo paths, shas and ADR numbers, so escaping
# backslashes and double quotes is enough.
json_string() { local v="${1//\\/\\\\}"; printf '"%s"' "${v//\"/\\\"}"; }

# json_list "<a, b>" or "<a,b>" — a JSON array of strings from a comma-separated list (empty → []).
json_list() {
  local out="" item
  local IFS=,
  for item in $1; do
    item="${item# }"
    [ -n "$item" ] && out="${out:+$out,}$(json_string "$item")"
  done
  printf '[%s]' "$out"
}

# event_json <kind> [<key> <value>]… — one event object. `adrs` and `done` values are comma-separated lists.
event_json() {
  local out
  out="{\"kind\":$(json_string "$1")"
  shift
  while [ $# -ge 2 ]; do
    case "$1" in
      adrs | done) out="${out},\"$1\":$(json_list "$2")" ;;
      *) out="${out},\"$1\":$(json_string "$2")" ;;
    esac
    shift 2
  done
  printf '%s}' "$out"
}

# json_report <due true|false> <base> <done IDs, comma-separated> <in-flight IDs> — prints the report;
# the events are the caller's `events` array of event_json objects.
json_report() {
  local joined=""
  [ "${#events[@]}" -gt 0 ] && joined="$(IFS=,; printf '%s' "${events[*]}")"
  printf '{"due":%s,"base":%s,"done":%s,"inFlight":%s,"events":[%s]}\n' \
    "$1" "$(json_string "$2")" "$(json_list "$3")" "$(json_list "$4")" "$joined"
}
