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

# migrated_deletions <base> — one `D<TAB><id><TAB>` line per migrated ID, the story_changes lines the
# debt scripts drop (a note the migration deleted is not a removal). Built with printf, never with
# `sed 's/^/D\t/'`: BSD sed (macOS) reads that `\t` as a literal `t`, so nothing would match.
migrated_deletions() { migrated_ids "$1" | while IFS= read -r id; do printf 'D\t%s\t\n' "$id"; done; }

# record_body <path> — a text record's body at HEAD (between its markers).
record_body() { git show "HEAD:$1" 2>/dev/null | awk '/^<!-- bt-body:end -->$/ { on = 0 } on { print } /^<!-- bt-body:begin -->$/ { on = 1 }'; }

# record_fields <path> — the text of a record's `### Backlog fields` section (its last one), so a
# `priority:` line elsewhere in the body is never read as the story's priority.
record_fields() { record_body "$1" | awk '/^### Backlog fields$/ { buf = ""; on = 1; next } on { buf = buf $0 "\n" } END { printf "%s", buf }'; }

# cache_removed <base> — the stories closed not_planned since <base>'s commit time, one ID a line, from
# the issue cache (S164: GitHub owns state, so the `removed` drift event lives there, not in a record).
# With no cache github.ts says "no cache: removed events not counted" on stderr and prints nothing.
cache_removed() {
  [ -f scripts/backlog-vault/github.ts ] || return 0
  node scripts/backlog-vault/github.ts removed --since "$(git show -s --format=%cI "$1")" || true
}

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

# verify_changed <base> — prints each part of the gate (`pnpm verify`) that differs between <base> and HEAD, one
# path a line, and is true when any did: the `verify` or `verify:run` line of package.json (`verify` runs the gate
# through the one-at-a-time lock, scripts/with-verify-lock.sh, and `verify:run` was the gate itself before S168);
# since ADR-030, the entry point and its narrowing (scripts/verify.sh, scripts/verify-plan.ts) and the lock; and
# turbo.json when what it runs changes: its globalDependencies, the set of task keys or any task's dependsOn.
# A task's inputs never count, since ADR-030 rule 6 has stories add them as they find new reads.
verify_changed()
{
  local changed=0 path
  if [ "$(git show "$1:package.json" 2>/dev/null | grep -E '"verify(:run)?":')" != "$(git show HEAD:package.json | grep -E '"verify(:run)?":')" ]; then
    echo package.json
    changed=1
  fi
  while IFS= read -r path; do
    [ -n "$path" ] && echo "$path" && changed=1
  done < <(git diff --name-only "$1" HEAD -- scripts/verify.sh scripts/verify-plan.ts scripts/with-verify-lock.sh)
  if [ "$(turbo_gate_shape "$1")" != "$(turbo_gate_shape HEAD)" ]; then
    echo turbo.json
    changed=1
  fi
  [ "$changed" = 1 ]
}

# turbo_gate_shape <rev> — the parts of <rev>'s turbo.json that decide what the gate runs (its whole-line `//`
# comments stripped, as scripts/verify-plan.ts readTurbo does), as one JSON line; empty when it has none.
turbo_gate_shape()
{
  git show "$1:turbo.json" 2>/dev/null | node -e '
    let s = "";
    process.stdin.on("data", (d) => { s += d; }).on("end", () => {
      if (!s) return;
      const j = JSON.parse(s.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n"));
      const t = j.tasks ?? {};
      console.log(JSON.stringify([j.globalDependencies ?? [], Object.keys(t).sort().map((k) => [k, t[k].dependsOn ?? []])]));
    });'
}

# The rule files whose change forces a review inside a /run-backlog run, whatever the review tracker scored
# (owner, 2026-11-24, asked whether the tracker should have a hard ceiling for "any ADR or rule change, or ~10
# items since the last review": "Yes, with a ceiling (Recommended)"): CLAUDE.md, LOOP, the laws, the backlog
# rules (frame note 00), every skill and every agent definition. ARCHITECTURE.md (an ADR) and `pnpm verify`
# are the ceiling's other two parts (ceiling_changes); the item count is runs.ts REVIEW_CEILING_ITEMS.
CEILING_RULE_PATHS=(CLAUDE.md docs/v3/LOOP.md docs/v3/LAWS.md 'docs/v3/backlog/frame/00 *' .claude/skills .claude/agents)

# ceiling_changes <base> — one line per ceiling change since <base> (the commit that logged the review's newest
# entry): each rule file changed, ARCHITECTURE.md (an ADR accepted or changed) and `pnpm verify` itself. Both debt
# scripts pass each line to `runs.ts review-state --changed` inside a run.
ceiling_changes()
{
  git diff --name-only "$1" HEAD -- "${CEILING_RULE_PATHS[@]}" docs/v3/ARCHITECTURE.md
  verify_changed "$1" | sed 's/$/ (pnpm verify itself)/'
  return 0
}

# ceiling_changes_since_both <a> <b> — the ceiling changes since both commits (comm needs sorted input).
ceiling_changes_since_both()
{
  comm -12 <(ceiling_changes "$1" | sort -u) <(ceiling_changes "$2" | sort -u)
}

# in_run_state <backlog|parity> <ledger base> <main checkout> — inside an open /run-backlog run (the main checkout's
# .run/run.json exists), prints the review tracker's state for that review (runs.ts review-state) and returns 1
# when it is due, 0 when not; returns 3, printing nothing, outside a run; 2 when the journal can't be read.
# The ceiling's rule changes count from one baseline (run-backlog step 2): the `origin/stage` commit the review's
# newest `review-start` recorded (runs.ts review-base), or, before its first start in the run, its newest ledger
# entry (<ledger base>). A start base that HEAD doesn't contain (this checkout is behind it) means no change since
# the start. Once the review has logged its verdict after that start, only a change since both the start and that
# entry counts, so its own pull request's rule edits never force it again, while a rules pull request that merged
# between its start and its log still does. Reads the caller's $LEDGER.
in_run_state()
{
  local journal="$3/.run/run.json" changed=() line start="" logged=0 from
  [ -f "$journal" ] || return 3
  IFS=$'\t' read -r start logged < <(node scripts/backlog-vault/runs.ts review-base --review "$1" --journal "$journal" --audit "$LEDGER" || echo "ERR") || true
  [ "$start" = "ERR" ] && return 2
  from="$2"
  if [ -n "$start" ]; then
    from="$start"
  fi
  if [ -z "$start" ] || git merge-base --is-ancestor "$start" HEAD 2>/dev/null; then
    while IFS= read -r line; do
      [ -n "$line" ] && changed+=(--changed "$line")
    done < <(
      if [ -n "$start" ] && [ "$logged" = "1" ]; then
        ceiling_changes_since_both "$from" "$2"
      else
        ceiling_changes "$from"
      fi
    )
  fi
  node scripts/backlog-vault/runs.ts review-state --review "$1" --journal "$journal" ${changed[@]+"${changed[@]}"}
}
