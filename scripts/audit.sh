#!/usr/bin/env bash
# Write an entry to the verification ledger: one new file per entry, a ledger fragment,
# docs/v3/audit/<YYYY-MM-DD>/<stamp>-<ID>-<kind>.md (S156). docs/v3/AUDIT.md is frozen.
#
# Story entries record exactly what a story's grader checked and the commit the
# story shipped in. Review entries record every backlog review pass; parity
# entries record every doc parity review pass (backlog rule 19).
#
#   scripts/audit.sh story S13                    # completion: grader + pnpm verify
#   scripts/audit.sh story S13 --reverify         # later re-run of a shipped story
#   scripts/audit.sh story S11 --backfill --commit c375ad5 --no-verify
#   scripts/audit.sh story S79 --design-match -    # UI story: owner's verdict on stdin
#   scripts/audit.sh design S60 --design-match -   # a verdict on its own, no grader run
#   scripts/audit.sh review --trigger "3 done since last review" \
#                    --since "S23, S21, S13" --verdict amended --findings "..."
#   scripts/audit.sh review --verdict continue --trigger manual --findings - --in-flight S9,S12
#   scripts/audit.sh parity --trigger "S40 inserted" --verdict amended --findings -
#   scripts/audit.sh answers backlog --review 2026-10-09 --commit 6a46b62 --answers -
#   scripts/audit.sh skip backlog --commit 5470524 --answers -   # owner: no review needed
#   scripts/audit.sh create S170 --title "…" --body-file f --reason "…"   # a new story's text (S164)
#   scripts/audit.sh create B140 --issue 140 --body-file f          # an accepted bug's fields block
#   scripts/audit.sh edit S158 --body-file f --reason "…"           # a story's new text, chained
#   scripts/audit.sh edit S158 --adopt --reason "<owner's words>"   # S165: record the owner's GitHub edit, post its Applied comment
#   (create|edit … --review: a review's record; refused, exit 1, for an item claimed in .run/claims/)
#   scripts/audit.sh migration S12 --issue 40 --base <sha> --body-file f [--rewrite-file d]
#   scripts/audit.sh apply                                          # send merged records to GitHub
#
# Story text (S164): GitHub owns each item's state; the repository records only its text, one-way.
# create, edit and migration write a text record (scripts/backlog-vault/text-records.ts renders it)
# without touching GitHub; `apply`, run on an up-to-date stage once the records' ledger pull request
# merged, sends them (github.ts). `story` writes a snapshot (the newest text and `done`) before it
# runs the grader. No record path takes a status, label or milestone.
#
# An answers entry records the owner's answers to a review's questions and what
# was applied from them. Applying them is part of finishing that review, not new
# drift: the debt checks measure their drift events from the answers entry.
# A skip entry records the owner declining a review for a drift event (an
# owner-directed change, say): that event no longer makes the review due. Neither
# entry resets the count of stories done since the last review — only a review
# does (owner, 2026-11-03: "Skip notes should not reset the counter, they should
# just avoid incrementing it"), so a count already at the backstop stays due.
#
# Flags: --commit <sha> names the shipping commit; --no-verify skips the repo-wide
# pnpm verify for entries covered by another run; --findings - reads stdin, and for
# review/parity must hold the review's `query:` lines (pnpm backlog:search, S163);
# --in-flight <IDs> (review/parity; comma-separated, `S9,S12`) names the items being built
# while the review ran, whose notes it may not edit (S156 AC 13).
# --design-match <verdict|-> (rule 22, S81) pairs each capture in
# docs/v3/design-checks/<ID>/ with the ratified frame (or written amendment) under docs/v3/visual/ that governs it,
# recording both SHA-256s and the owner's verdict, quoted. A story whose note has a
# `design:` list cannot be recorded as completed without it (backlog rule 22).
# `design <ID>` records such a verdict on its own, without running the grader (S84).
# --reverify runs today's grader in a temporary worktree at the story's shipping commit
# (scripts/lib/reverify.sh): a grader proves its own story, not the repo at HEAD (S84).
#
# Why fragments (S156; owner, 2026-11-20: "The goal is to enable agents to work in tandem on
# backlog items in a way that they don't conflict"): appending to one file made every two
# branches' entries conflict. Each entry is now a new file, so entries from any number of
# branches merge in any order. The fragment holds exactly the Markdown the entry would have
# appended (from its `## <date> — …` heading down); scripts/backlog-vault/ledger.ts, the one
# parser, reads AUDIT.md and then the fragments in stamp order. The stamp in the name is the
# entry's `Captured (UTC)` time without separators, so names sort in stamp order.
#
# Unlike a grader this DOES write to the working tree — that is its whole job.
# It never fabricates results: every check line in a story entry comes from a
# real grader run captured here. A story is not done until its ledger fragment is
# committed alongside the code.
#
# Prints a commit-message summary block to stdout on completion.

set -uo pipefail
cd "$(dirname "$0")/.."

# Overridable for a separate backlog + ledger (docs/v3/VAULT-MIGRATION.md).
LEDGER="${BT_AUDIT_LEDGER:-docs/v3/AUDIT.md}"
# Where new entries go: beside the ledger, in the folder named for it in lower case
# (ledger.ts fragmentsDirFor and reverify.sh shipping_commit derive it the same way).
FRAGMENTS="$(dirname "$LEDGER")/$(basename "$LEDGER" .md | tr '[:upper:]' '[:lower:]')"
# Rule 22 inputs, overridable for tests (scripts/backlog-vault/audit-design-match.test.ts).
STORIES_DIR="${BT_AUDIT_STORIES:-docs/v3/backlog/stories}"
CHECKS_DIR="${BT_AUDIT_DESIGN_CHECKS:-docs/v3/design-checks}"
VISUAL_DIR="${BT_AUDIT_VISUAL:-docs/v3/visual}"
GRADERS_DIR="${BT_AUDIT_GRADERS:-scripts}"
TODAY="$(date +"%Y-%m-%d")"
HEAD_SHA="$(git rev-parse --short HEAD)"

if [ -n "$(git status --porcelain)" ]; then
  TREE="dirty"
else
  TREE="clean"
fi

usage() {
  sed -n '2,43p' "$0" | sed 's/^# \{0,1\}//' >&2
  exit 2
}

if [ ! -f "$LEDGER" ]; then
  echo "audit: $LEDGER missing — the frozen ledger its fragments continue" >&2
  exit 2
fi

# Everything below the marker is entries, newest last; a ledger without it isn't one audit.sh wrote.
MARKER="<!-- entries below; newest last; appended by scripts/audit.sh -->"
grep -qF "$MARKER" "$LEDGER" || {
  echo "audit: $LEDGER has no entries marker" >&2
  exit 2
}

# new_fragment <ID> <kind> — set FRAG to the path of a new ledger fragment for an entry
# captured now, STAMP to its capture time (the entry's `Captured (UTC)` row, so the name and the
# row agree), and FRAG_TMP to the file the entry is written to first: `.<name>.<pid>.tmp` beside
# it, a dot name ledger.ts never reads. finish_fragment then links it into place, so an
# interrupted run never leaves a half-written or empty fragment (ledger.ts would refuse it and
# every reader of the ledger would fail), only a dot file. If the name is taken (two entries for
# one ID and kind within one second) it waits for the next second rather than overwrite one.
FRAG_TMP=""
trap 'rm -f "${FRAG_TMP:-}" "${FRAG_TMP:+${FRAG_TMP%.tmp}.new.tmp}" "${ADOPT_TMP:-}"' EXIT
new_fragment() {
  FRAG_ID="$1"
  FRAG_KIND="$2"
  while :; do
    STAMP="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
    FRAG="${FRAGMENTS}/${STAMP%%T*}/${STAMP//[-:]/}-${FRAG_ID}-${FRAG_KIND}.md"
    [ -e "$FRAG" ] || break
    sleep 1
  done
  mkdir -p "$(dirname "$FRAG")" || return 1
  FRAG_TMP="$(dirname "$FRAG")/.$(basename "$FRAG").$$.tmp"
  : >"$FRAG_TMP" || return 1
}

# finish_fragment — put the written entry in place: a hard link to FRAG, which fails rather than
# overwrite when another run took that name since new_fragment, then the temp file goes. On a
# taken name it moves to the next second's stamp, rewriting the entry's `Captured (UTC)` row to
# match, and tries again.
finish_fragment() {
  local old
  until ln "$FRAG_TMP" "$FRAG" 2>/dev/null; do
    if [ ! -e "$FRAG" ]; then
      echo "audit: could not write ${FRAG}" >&2
      return 1
    fi
    old="$STAMP"
    sleep 1
    STAMP="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
    FRAG="${FRAGMENTS}/${STAMP%%T*}/${STAMP//[-:]/}-${FRAG_ID}-${FRAG_KIND}.md"
    mkdir -p "$(dirname "$FRAG")" || return 1
    sed "s/| Captured (UTC) | \`${old}\` |/| Captured (UTC) | \`${STAMP}\` |/" "$FRAG_TMP" >"${FRAG_TMP%.tmp}.new.tmp" &&
      mv "${FRAG_TMP%.tmp}.new.tmp" "$FRAG_TMP" || return 1
  done
  rm -f "$FRAG_TMP"
  FRAG_TMP=""
}

# review_exists <heading regex> — whether any ledger entry (AUDIT.md or a fragment) has that heading.
review_exists() {
  grep -qE "$1" "$LEDGER" && return 0
  [ -d "$FRAGMENTS" ] && grep -rqE --exclude='.*' "$1" "$FRAGMENTS"
}

read_arg() { # read_arg <value> — "-" means stdin
  if [ "$1" = "-" ]; then cat; else printf '%s' "$1"; fi
}

# shellcheck source=lib/reverify.sh
source "$(dirname "$0")/lib/reverify.sh"

# design_match_rows <ID> — one table row per capture in CHECKS_DIR/<ID>/, paired with the
# ratified reference that governs its name under VISUAL_DIR; exits 2 if any pairing fails. The
# reference comes from scripts/backlog-vault/design-reference.ts, the same code `pnpm design:review`
# (e2e/design-review.ts) uses, so the pair is the one the owner judged: an amendment frame wins
# over the original, and a written amendment that overrides the frame wins over both, in which
# case the row names the amendment file and its hash, never the frame it supersedes.
design_match_rows() {
  local id="$1" captures cap name refs count fsum csum
  captures="$(ls "${CHECKS_DIR}/${id}"/*.png 2>/dev/null || true)"
  if [ -z "$captures" ]; then
    echo "audit: no captures in ${CHECKS_DIR}/${id}/ (run pnpm design:capture ${id})" >&2
    exit 2
  fi
  for cap in $captures; do
    name="$(basename "$cap")"
    refs="$(node scripts/backlog-vault/design-reference.ts "$VISUAL_DIR" "$name")" || exit 2
    count="$(printf '%s' "$refs" | grep -c . || true)"
    if [ "$count" != "1" ]; then
      echo "audit: capture ${name} matches ${count} ratified frames under ${VISUAL_DIR}; need exactly one" >&2
      exit 2
    fi
    fsum="$(shasum -a 256 "$refs" | cut -d' ' -f1)"
    csum="$(shasum -a 256 "$cap" | cut -d' ' -f1)"
    printf '| `%s` | `%s` | `%s` | `%s` |\n' "$refs" "$fsum" "$cap" "$csum"
  done
}

# design_match_section <rows> <verdict> — the ledger section both modes write.
design_match_section() {
  echo
  echo "**Design match (rule 22)** — the owner compared each capture with the ratified frame or written amendment that governs it"
  echo
  echo "| Ratified frame or amendment | SHA-256 | Capture | SHA-256 |"
  echo "|---|---|---|---|"
  printf '%s' "$1"
  echo
  echo "Owner: \"$(printf '%s' "$2" | tr '\n' ' ' | sed 's/[[:space:]]*$//')\""
}

MODE="${1:-}"
shift || usage

case "$MODE" in
  story) ;;
  design) ;;
  review) ;;
  parity) ;;
  answers) ;;
  skip) ;;
  create) ;;
  edit) ;;
  migration) ;;
  apply) ;;
  *) usage ;;
esac

RECORDS=scripts/backlog-vault/text-records.ts

# write_record <kind> <ID> <render flags…> — one text record, rendered by text-records.ts from the
# flags (its body from --body-file), written through new_fragment/finish_fragment like every entry.
write_record() {
  local kind="$1" id="$2"
  shift 2
  new_fragment "$id" "$kind" || return 1
  node "$RECORDS" render "$kind" "$id" --stamp "$STAMP" --date "$TODAY" --head "${HEAD_SHA} (tree ${TREE})" "$@" >"$FRAG_TMP" || return 1
  finish_fragment || return 1
}

# --- create / edit / migration (S164) ---------------------------------------------
if [ "$MODE" = "create" ] || [ "$MODE" = "edit" ] || [ "$MODE" = "migration" ]; then
  ID="${1:-}"
  [[ "$ID" =~ ^[SB][1-9][0-9]*$ ]] || { echo "audit: ${MODE} needs a story or bug ID (S170, B140; no leading zero)" >&2; exit 2; }
  shift
  BODY_FILE="" REASON="" TITLE_ARG="" ISSUE="" BASE_ARG="" REWRITE="" STAGE="" ADOPT="" BY_REVIEW=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --body-file) BODY_FILE="${2:-}"; shift 2 || usage ;;
      --adopt) ADOPT=1; shift ;;
      --review) BY_REVIEW=1; shift ;;
      --reason) REASON="$(read_arg "${2:-}")"; shift 2 || usage ;;
      --title) TITLE_ARG="${2:-}"; shift 2 || usage ;;
      --issue) ISSUE="${2:-}"; shift 2 || usage ;;
      --base) BASE_ARG="${2:-}"; shift 2 || usage ;;
      --stage) STAGE="${2:-}"; shift 2 || usage ;;
      --rewrite-file) REWRITE="${2:-}"; shift 2 || usage ;;
      --status | --label | --milestone) echo "audit: GitHub owns state; change it with github.ts status|label|milestone, never a record (S164)" >&2; exit 2 ;;
      *) echo "audit: unknown option $1" >&2; usage ;;
    esac
  done
  # S165: a review running beside in-flight items never records text for one of them; its finding goes
  # to the overseer instead. The claims live in the main checkout's .run/claims/ (claims.ts).
  if [ -n "$BY_REVIEW" ]; then
    main_checkout="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
    if [ -f "${main_checkout}/.run/claims/${ID}.json" ]; then
      echo "audit: ${ID} is in flight (claimed in ${main_checkout}/.run/claims/): a review never records its text; pass the finding to the overseer" >&2
      exit 1
    fi
  fi
  # S165: --adopt records the live body (a bug's live fields block) GitHub holds now, an edit the owner
  # made there, as an edit chained from the newest record; its Applied comment is posted after. That
  # comment is the one GitHub write recording ever makes, so run an adopt on its own branch and open its
  # record as a docs-only pull request at once: other pull requests' live checks clear once it merges.
  if [ -n "$ADOPT" ]; then
    [ "$MODE" = "edit" ] || { echo "audit: --adopt is an edit's (audit.sh edit <ID> --adopt --reason <the owner's words>)" >&2; exit 2; }
    [ -z "$BODY_FILE" ] || { echo "audit: --adopt takes the body from GitHub, not --body-file" >&2; exit 2; }
    [ -n "$REASON" ] || { echo "audit: edit --adopt needs --reason quoting the owner" >&2; exit 2; }
    BODY_FILE="$(mktemp "${TMPDIR:-/tmp}/audit-${ID}-adopt.XXXXXX")"
    ADOPT_TMP="$BODY_FILE" # removed by the EXIT trap
    ISSUE="$(node scripts/backlog-vault/github.ts adopt-body "$ID" --out "$BODY_FILE")" || exit 2
  fi
  [ -f "$BODY_FILE" ] || { echo "audit: ${MODE} needs --body-file <file> holding the text" >&2; exit 2; }
  [ -z "$ISSUE" ] || [[ "$ISSUE" =~ ^[0-9]+$ ]] || { echo "audit: --issue takes an issue number" >&2; exit 2; }
  flags=(--body-file "$BODY_FILE")
  [ -n "$ISSUE" ] && flags+=(--issue "$ISSUE")
  [ -n "$REASON" ] && flags+=(--reason "$REASON")
  [ -n "$TITLE_ARG" ] && flags+=(--title "$TITLE_ARG")
  [ -n "$BASE_ARG" ] && flags+=(--base "$(git rev-parse --short "$BASE_ARG")")
  [ -n "$STAGE" ] && flags+=(--base "$(git rev-parse --short "$STAGE")" --base-label stage)
  [ -n "$REWRITE" ] && flags+=(--rewrite-file "$REWRITE")
  existing="$(node "$RECORDS" newest "$ID" --field file 2>/dev/null || true)"
  # A bug's record holds its fields block alone (create and edit alike): the symptoms are its issue's,
  # written by whoever filed it, and never recorded.
  if [[ "$ID" == B* ]] && [ "$MODE" != "migration" ]; then
    fields_only="$(mktemp "${TMPDIR:-/tmp}/audit-${ID}-fields.XXXXXX")"
    node "$RECORDS" fields "$BODY_FILE" "$ID" >"$fields_only" || exit 2
    [ -s "$fields_only" ] || { echo "audit: ${BODY_FILE} holds no ### Backlog fields section" >&2; exit 2; }
    flags[1]="$fields_only"
  fi
  case "$MODE" in
    create)
      [ -z "$existing" ] || { echo "audit: ${ID} is already recorded (${existing}); change its text with audit.sh edit" >&2; exit 2; }
      if [[ "$ID" == B* ]]; then
        [ -n "$ISSUE" ] || { echo "audit: create ${ID} records an accepted bug's fields block: --issue <n> is required" >&2; exit 2; }
      else
        [ -n "$TITLE_ARG" ] || { echo "audit: create ${ID} needs --title (its issue is titled '${ID}: <title>')" >&2; exit 2; }
        [ -n "$REASON" ] || { echo "audit: create needs --reason" >&2; exit 2; }
        # A new story's ID must be free: no trusted issue (the cache), no record here, no fragment on stage.
        # (A copy of audit.sh without github.ts beside it, as L13's merge-safety test makes, checks the records alone.)
        if [ -f scripts/backlog-vault/github.ts ]; then
          node scripts/backlog-vault/github.ts taken "$ID" ${ISSUE:+--issue "$ISSUE"} >/dev/null || exit 2
        fi
      fi
      ;;
    edit)
      [ -n "$existing" ] || { echo "audit: ${ID} has no text record to edit (audit.sh create, or pnpm backlog:migrate)" >&2; exit 2; }
      [ -n "$REASON" ] || { echo "audit: edit needs --reason" >&2; exit 2; }
      problems="$(node "$RECORDS" newest "$ID" --field problems)"
      [ -z "$problems" ] || { echo "audit: ${ID}'s records are inconsistent; fix them first:" >&2; echo "$problems" >&2; exit 2; }
      from="$(node "$RECORDS" newest "$ID" --field hash)"
      [ "$(shasum -a 256 <"${flags[1]}" | cut -d' ' -f1)" != "$from" ] || { echo "audit: ${BODY_FILE} is ${ID}'s text already; nothing to record" >&2; exit 2; }
      flags+=(--from "$from")
      [ -n "$ISSUE" ] || { ISSUE="$(node "$RECORDS" newest "$ID" --field issue)"; [ -n "$ISSUE" ] && flags+=(--issue "$ISSUE"); }
      ;;
    migration)
      [ -n "$ISSUE" ] || { echo "audit: migration needs --issue <n>" >&2; exit 2; }
      [ -n "$BASE_ARG" ] || [ -n "$STAGE" ] || { echo "audit: migration needs --base <the commit the notes were read from>" >&2; exit 2; }
      ;;
  esac
  # A story's text must carry a fields block that parses (an accepted bug's is the block itself).
  node "$RECORDS" fields "${flags[1]}" "$ID" >/dev/null || { echo "audit: ${ID}'s text has no parsable ### Backlog fields block" >&2; exit 2; }
  write_record "$MODE" "$ID" "${flags[@]}" || exit 2
  echo "audit ${ID}: recorded its ${MODE} in ${FRAG}"
  if [ -n "$ADOPT" ]; then
    node scripts/backlog-vault/github.ts applied "$ID" "$FRAG" || {
      echo "audit: ${FRAG} is recorded, but its Applied comment wasn't posted: node scripts/backlog-vault/github.ts applied ${ID} ${FRAG}" >&2
      exit 2
    }
  fi
  exit 0
fi

# --- apply (S164) ------------------------------------------------------------------
# Sends each recorded create and edit GitHub doesn't have yet (github.ts apply), on an up-to-date
# stage: the records are applied only once their ledger pull request merged.
if [ "$MODE" = "apply" ]; then
  # The records sent are the ones in this tree, so they must be exactly what merged: no changed or
  # untracked fragment under docs/v3/audit (a change elsewhere sends nothing, so it doesn't block).
  if [ -n "$(git status --porcelain -- docs/v3/audit)" ]; then
    echo "audit: apply needs a clean tree under docs/v3/audit (commit or discard the record changes first)" >&2
    exit 2
  fi
  if [ -z "${BT_APPLY_ANY_HEAD:-}" ]; then
    git fetch -q origin || { echo "audit: apply could not fetch origin, so it can't tell whether stage is up to date" >&2; exit 2; }
    if [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/stage 2>/dev/null)" ]; then
      echo "audit: apply runs on an up-to-date stage (git switch stage && git merge --ff-only origin/stage)" >&2
      exit 2
    fi
  fi
  node scripts/backlog-vault/github.ts apply
  exit $?
fi

# --- design --------------------------------------------------------------------
# A design-match verdict on its own (S84): no grader run, and not a completion — the
# heading "— <ID> design match" is not one the debt counters read as "completed".
if [ "$MODE" = "design" ]; then
  ID="${1:-}"
  [ -n "$ID" ] || usage
  shift
  DESIGN_MATCH=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --design-match) DESIGN_MATCH="$(read_arg "${2:-}")"; shift 2 || usage ;;
      *) echo "audit: unknown option $1" >&2; usage ;;
    esac
  done
  [ -n "$DESIGN_MATCH" ] || { echo "audit: design needs --design-match <verdict|->" >&2; exit 2; }
  rows="$(design_match_rows "$ID")" || exit 2
  new_fragment "$ID" design || exit 2
  {
    echo "## ${TODAY} — ${ID} design match"
    echo
    echo "| | |"
    echo "|---|---|"
    echo "| Entry | design match only — no grader run; not a completion |"
    echo "| Captured (UTC) | \`${STAMP}\` |"
    echo "| HEAD at capture | \`${HEAD_SHA}\` (tree ${TREE}) |"
    design_match_section "$rows" "$DESIGN_MATCH"
  } >"$FRAG_TMP"
  finish_fragment || exit 2
  echo "audit ${ID}: design match written to ${FRAG}"
  exit 0
fi

# --- story ---------------------------------------------------------------------
if [ "$MODE" = "story" ]; then
  ID="${1:-}"
  [ -n "$ID" ] || usage
  shift

  LABEL="completion"
  COMMIT=""
  RUN_VERIFY=1
  DESIGN_MATCH=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --design-match) DESIGN_MATCH="$(read_arg "${2:-}")"; shift 2 || usage ;;
      --reverify) LABEL="reverify"; shift ;;
      --backfill) LABEL="backfill"; shift ;;
      --no-verify) RUN_VERIFY=0; shift ;;
      --commit) COMMIT="${2:-}"; shift 2 || usage ;;
      *) echo "audit: unknown option $1" >&2; usage ;;
    esac
  done

  if [ "$LABEL" = "reverify" ] && [ -n "$DESIGN_MATCH" ]; then
    echo "audit: record a design verdict with 'audit.sh design ${ID} --design-match', not with --reverify (S84)" >&2
    exit 2
  fi

  GRADER="${GRADERS_DIR}/verify-${ID}.sh"
  if [ ! -x "$GRADER" ]; then
    echo "audit: $GRADER missing or not executable" >&2
    exit 2
  fi

  # Rule 22: a UI story (a `design:` list in its note) is done only on the owner's
  # verdict on its captures. A story whose match AC says "none" is exempt.
  # The note sits in its status folder (`stories/<status>/S<N>.md`, scripts/backlog-vault/vault.ts
  # storyNotePath), which moves as the story is finished, so it is found by name; a flat
  # `stories/S<N>.md` (the layout before 2026-11-17, and the tests' BT_AUDIT_STORIES) is found too.
  NOTE="$(find "$STORIES_DIR" -maxdepth 2 -type f -name "${ID}.md" 2>/dev/null | sort | head -n 1)"
  needs_match=0
  # Since S164 the story's text is its newest text record: a `design` list in its fields block.
  if [ ! -f "$NOTE" ] && [ -n "$(node "$RECORDS" newest "$ID" --field design 2>/dev/null)" ] &&
    ! node "$RECORDS" newest "$ID" 2>/dev/null | grep -qF 'Design match (rule 22): none'; then
    needs_match=1
  fi
  if [ -f "$NOTE" ] && awk '/^---$/{n++;next} n==1' "$NOTE" | grep -qE '^design:$' &&
    ! grep -qF 'Design match (rule 22): none' "$NOTE"; then
    needs_match=1
  fi
  if [ "$LABEL" = "completion" ] && [ "$needs_match" -eq 1 ] && [ -z "$DESIGN_MATCH" ]; then
    echo "audit: ${ID} builds a ratified design; record the owner's verdict with --design-match (backlog rule 22)" >&2
    exit 2
  fi

  # Pair each capture with the one ratified frame of the same name.
  match_rows=""
  if [ -n "$DESIGN_MATCH" ]; then
    match_rows="$(design_match_rows "$ID")" || exit 2
  fi

  # The story's title: its note's frontmatter `title` (the notes are the backlog since S156
  # retired the generated backlog view).
  TITLE=""
  if [ -f "$NOTE" ]; then
    TITLE="$(awk '/^---$/{n++;next} n==1 && /^title: /{sub(/^title: /,""); print; exit}' "$NOTE" |
      sed -E 's/^"(.*)"$/\1/; s/^'"'"'(.*)'"'"'$/\1/; s/[[:space:]]*$//')"
  fi
  [ -n "$TITLE" ] || TITLE="$(node "$RECORDS" newest "$ID" --field title 2>/dev/null || true)"
  [ -n "$TITLE" ] || TITLE="(title not found in ${ID}'s note or text records)"

  grader_log="$(mktemp "${TMPDIR:-/tmp}/audit-${ID}-grader.XXXXXX")"
  verify_log="$(mktemp "${TMPDIR:-/tmp}/audit-${ID}-verify.XXXXXX")"

  if [ "$LABEL" = "reverify" ]; then
    SHIP="$(shipping_commit "$LEDGER" "$ID")"
    if [ -z "$SHIP" ]; then
      echo "audit: ${ID} has no completion entry in ${LEDGER}, so no shipping commit to re-verify at" >&2
      exit 2
    fi
    echo "audit ${ID}: running ${GRADER} at its shipping commit ${SHIP}…"
    reverify_at "$SHIP" "$GRADER" "$grader_log"
    grader_exit=$?
  else
    if [ "$LABEL" = "completion" ]; then
      # S164 AC 5: the ship-time snapshot, written before the grader runs, so the grader reads the
      # story's text and status from it (checks.sh story_snapshot / story_snapshot_status).
      # A story with no text record yet (its note is still its text, before the migration) has no
      # snapshot; once migrated, every story has one, and new graders require it (story_snapshot_status).
      # A chain with a fork or gap has no one text to ship: fix the records first (audit.sh edit refuses it too).
      problems="$(node "$RECORDS" newest "$ID" --field problems 2>/dev/null || true)"
      if [ -n "$problems" ]; then
        echo "audit: ${ID}'s text records are inconsistent; fix them first:" >&2
        echo "$problems" >&2
        exit 2
      fi
      snap_body="$(mktemp "${TMPDIR:-/tmp}/audit-${ID}-snapshot.XXXXXX")"
      if node "$RECORDS" newest "$ID" >"$snap_body" 2>/dev/null; then
        snap_flags=(--body-file "$snap_body" --status done --record "$(node "$RECORDS" newest "$ID" --field file)")
        ISSUE="$(node "$RECORDS" newest "$ID" --field issue)"
        [ -n "$ISSUE" ] && snap_flags+=(--issue "$ISSUE")
        new_fragment "$ID" snapshot || exit 2
        node "$RECORDS" render snapshot "$ID" --stamp "$STAMP" --date "$TODAY" --head "${HEAD_SHA} (tree ${TREE})" "${snap_flags[@]}" >"$FRAG_TMP" || exit 2
        finish_fragment || exit 2
        SNAPSHOT="$FRAG"
      else
        echo "audit ${ID}: no text record, so no snapshot (its grader reads its note)"
      fi
      rm -f "$snap_body"
    fi
    echo "audit ${ID}: running ${GRADER}…"
    "$GRADER" >"$grader_log" 2>&1
    grader_exit=$?
  fi

  if [ "$RUN_VERIFY" -eq 1 ]; then
    echo "audit ${ID}: running pnpm verify…"
    pnpm verify >"$verify_log" 2>&1
    verify_exit=$?
  else
    verify_exit="skipped"
  fi

  # A failed run ships nothing, so the snapshot this run wrote goes (only this run's: never under
  # --reverify or --backfill, which write none), before the completion fragment, which then has no row for it.
  if [ -n "${SNAPSHOT:-}" ] && { [ "$grader_exit" -ne 0 ] || { [ "$verify_exit" != "skipped" ] && [ "$verify_exit" -ne 0 ]; }; }; then
    rm -f "$SNAPSHOT"
    echo "audit ${ID}: the run failed, so its snapshot ${SNAPSHOT} was removed"
    SNAPSHOT=""
  fi

  check_lines="$(grep -E '^check [0-9]+ (PASS|FAIL):' "$grader_log" || true)"
  # checks.sh labels the tally with the grader's own id ("verify-S11"), not "S11".
  tally="$(grep -E "^--- (verify-)?${ID}: [0-9]+/[0-9]+ checks passed ---$" "$grader_log" |
    sed -E 's/^--- [^:]+: (.*) ---$/\1/' || true)"

  if [ -n "$COMMIT" ]; then
    SHIPPED="\`$(git rev-parse --short "$COMMIT")\` — $(git log -1 --format=%s "$COMMIT")"
  elif [ "$LABEL" = "reverify" ]; then
    SHIPPED="(see this story's completion entry)"
  else
    SHIPPED="the commit that adds this entry"
  fi

  case "$LABEL" in
    reverify) new_fragment "$ID" reverified || exit 2 ;;
    backfill) new_fragment "$ID" backfill || exit 2 ;;
    *)        new_fragment "$ID" completed || exit 2 ;;
  esac
  {
    case "$LABEL" in
      reverify) echo "## ${TODAY} — ${ID} re-verified at \`${SHIP}\`" ;;
      backfill) echo "## ${TODAY} — ${ID} verified (backfill)" ;;
      *)        echo "## ${TODAY} — ${ID} completed" ;;
    esac
    echo
    echo "**${TITLE}**"
    echo
    echo "| | |"
    echo "|---|---|"
    case "$LABEL" in
      reverify) echo "| Entry | story re-verification — today's grader run in a worktree at the shipping commit \`${SHIP}\` (S84); **not** a capture of the original completion run |" ;;
      backfill) echo "| Entry | **backfill** — this story shipped before the ledger existed. The grader run below is real and happened today, at the HEAD below, not at the shipping commit |" ;;
      *)        echo "| Entry | story completion |" ;;
    esac
    echo "| Captured (UTC) | \`${STAMP}\` |"
    echo "| Shipped in | ${SHIPPED} |"
    echo "| HEAD at capture | \`${HEAD_SHA}\` (tree ${TREE}) |"
    echo "| Grader | \`${GRADER}\` — exit \`${grader_exit}\` |"
    if [ -n "${SNAPSHOT:-}" ]; then
      echo "| Snapshot | \`${SNAPSHOT}\` — SHA-256 \`$(shasum -a 256 "$SNAPSHOT" | cut -d' ' -f1)\` |"
    elif [ "$LABEL" = "reverify" ]; then
      snap="$(find "$FRAGMENTS" -type f -name "*-${ID}-snapshot.md" 2>/dev/null | awk -F/ '{ print $NF "\t" $0 }' | LC_ALL=C sort | tail -1 | cut -f2)"
      if [ -n "$snap" ]; then
        echo "| Snapshot | \`${snap}\` — SHA-256 \`$(shasum -a 256 "$snap" | cut -d' ' -f1)\` (the text and status its grader read) |"
      else
        echo "| Snapshot | none — shipped before S164, so its grader read its note at the shipping commit |"
      fi
    fi
    if [ "$RUN_VERIFY" -eq 1 ]; then
      echo "| \`pnpm verify\` | exit \`${verify_exit}\` |"
    else
      echo "| \`pnpm verify\` | not re-run for this entry — one repo-wide run covers the tree, recorded in the newest completion entry |"
    fi
    echo
    echo "**What was tested and verified**"
    echo
    [ -n "${ISSUE:-}" ] && { echo; echo "Issue: #${ISSUE}"; echo; }
    if [ -n "$check_lines" ]; then
      echo '```'
      echo "$check_lines"
      echo '```'
      [ -n "$tally" ] && { echo; echo "**${tally}**"; }
    else
      echo "_This grader predates the per-check reporting contract"
      echo "(\`scripts/lib/checks.sh\`) and emitted no per-check lines. Only its"
      echo "exit code is recorded above._"
    fi
    if [ -n "$DESIGN_MATCH" ]; then
      design_match_section "$match_rows" "$DESIGN_MATCH"
    fi
    echo
    echo "<details><summary>Grader output</summary>"
    echo
    echo '```'
    cat "$grader_log"
    echo '```'
    echo
    echo "</details>"
    echo
    if [ "$RUN_VERIFY" -eq 1 ]; then
      echo "<details><summary><code>pnpm verify</code> (tail)</summary>"
      echo
      echo '```'
      tail -30 "$verify_log"
      echo '```'
      echo
      echo "</details>"
    fi
  } >"$FRAG_TMP"
  finish_fragment || exit 2

  rm -f "$grader_log" "$verify_log"

  echo
  echo "audit ${ID}: wrote ${FRAG}"
  echo
  echo "--- commit message summary (paste into the commit body) ---"
  echo "Verification (${GRADER}, exit ${grader_exit}; pnpm verify, ${verify_exit}):"
  if [ -n "$check_lines" ]; then
    echo "$check_lines" | sed 's/^/  /'
  fi
  echo "Ledger: ${FRAG}"
  echo "---"

  if [ "$grader_exit" -ne 0 ]; then exit 1; fi
  if [ "$RUN_VERIFY" -eq 1 ] && [ "$verify_exit" -ne 0 ]; then exit 1; fi
  exit 0
fi

# --- answers -------------------------------------------------------------------
if [ "$MODE" = "answers" ]; then
  case "${1:-}" in
    backlog) KIND="backlog review"; RID=backlog ;;
    parity) KIND="doc parity review"; RID=parity ;;
    *) echo "audit: answers needs 'backlog' or 'parity' (which review was answered)" >&2; exit 2 ;;
  esac
  shift
  REVIEW_DATE=""
  ANSWERS=""
  APPLIED_IN="the commit that adds this entry"
  while [ $# -gt 0 ]; do
    case "$1" in
      --review) REVIEW_DATE="${2:-}"; shift 2 || usage ;;
      --answers) ANSWERS="$(read_arg "${2:-}")"; shift 2 || usage ;;
      --commit) APPLIED_IN="\`$(git rev-parse --short "${2:-}")\` — $(git log -1 --format=%s "${2:-}")"; shift 2 || usage ;;
      *) echo "audit: unknown option $1" >&2; usage ;;
    esac
  done
  [ -n "$REVIEW_DATE" ] || { echo "audit: --review <date of the review answered> is required" >&2; exit 2; }
  review_exists "^## ${REVIEW_DATE} — ${KIND} \(" || {
    echo "audit: no ${KIND} entry dated ${REVIEW_DATE} in ${LEDGER} or ${FRAGMENTS}/" >&2
    exit 2
  }
  [ -n "$ANSWERS" ] || { echo "audit: --answers is required (quote the owner, then what was applied)" >&2; exit 2; }
  new_fragment "$RID" answers || exit 2
  {
    echo "## ${TODAY} — ${KIND} answers (${REVIEW_DATE})"
    echo
    echo "| | |"
    echo "|---|---|"
    echo "| Entry | owner's answers to the ${REVIEW_DATE} ${KIND} — part of finishing that review, not new drift |"
    echo "| Captured (UTC) | \`${STAMP}\` |"
    echo "| HEAD at capture | \`${HEAD_SHA}\` (tree ${TREE}) |"
    echo "| Applied in | ${APPLIED_IN} |"
    echo
    echo "**Answers and what was applied**"
    echo
    echo "$ANSWERS"
  } >"$FRAG_TMP"
  finish_fragment || exit 2
  echo "audit answers: wrote the owner's answers to the ${REVIEW_DATE} ${KIND} to ${FRAG}"
  exit 0
fi

# --- skip ----------------------------------------------------------------------
# The owner declined a review for a drift event. The heading "— <kind> skipped" moves
# the debt scripts' drift base (it starts "— <kind>") but is not a review heading
# ("— <kind> (`verdict`)"), so the stories-done count runs on through it.
if [ "$MODE" = "skip" ]; then
  case "${1:-}" in
    backlog) KIND="backlog review"; RID=backlog ;;
    parity) KIND="doc parity review"; RID=parity ;;
    *) echo "audit: skip needs 'backlog' or 'parity' (which review was declined)" >&2; exit 2 ;;
  esac
  shift
  ANSWERS=""
  APPLIED_IN="the commit that adds this entry"
  while [ $# -gt 0 ]; do
    case "$1" in
      --answers) ANSWERS="$(read_arg "${2:-}")"; shift 2 || usage ;;
      --commit) APPLIED_IN="\`$(git rev-parse --short "${2:-}")\` — $(git log -1 --format=%s "${2:-}")"; shift 2 || usage ;;
      *) echo "audit: unknown option $1" >&2; usage ;;
    esac
  done
  [ -n "$ANSWERS" ] || { echo "audit: --answers is required (what changed, then the owner's \"no\", quoted)" >&2; exit 2; }
  new_fragment "$RID" skip || exit 2
  {
    echo "## ${TODAY} — ${KIND} skipped"
    echo
    echo "| | |"
    echo "|---|---|"
    echo "| Entry | the owner declined a ${KIND} for this change — its drift no longer makes one due; the stories-done count is unchanged |"
    echo "| Captured (UTC) | \`${STAMP}\` |"
    echo "| HEAD at capture | \`${HEAD_SHA}\` (tree ${TREE}) |"
    echo "| Change | ${APPLIED_IN} |"
    echo
    echo "**What changed, and the owner's answer**"
    echo
    echo "$ANSWERS"
  } >"$FRAG_TMP"
  finish_fragment || exit 2
  echo "audit skip: wrote the owner's skip of a ${KIND} to ${FRAG}"
  exit 0
fi

# --- review / parity -----------------------------------------------------------
if [ "$MODE" = "parity" ]; then
  KIND="doc parity review"
  RID=parity
else
  KIND="backlog review"
  RID=backlog
fi

TRIGGER=""
SINCE=""
VERDICT=""
FINDINGS=""
IN_FLIGHT=""
DATE="$TODAY"
while [ $# -gt 0 ]; do
  case "$1" in
    --trigger) TRIGGER="$(read_arg "${2:-}")"; shift 2 || usage ;;
    --since) SINCE="$(read_arg "${2:-}")"; shift 2 || usage ;;
    --verdict) VERDICT="${2:-}"; shift 2 || usage ;;
    --findings) FINDINGS="$(read_arg "${2:-}")"; shift 2 || usage ;;
    --in-flight) IN_FLIGHT="${2:-}"; shift 2 || usage ;;
    --date) DATE="${2:-}"; shift 2 || usage ;;
    --commit) HEAD_SHA="$(git rev-parse --short "${2:-}")"; shift 2 || usage ;;
    *) echo "audit: unknown option $1" >&2; usage ;;
  esac
done

case "$VERDICT" in
  continue|amended|blocked) ;;
  *) echo "audit: --verdict must be continue, amended or blocked" >&2; exit 2 ;;
esac
[ -n "$TRIGGER" ] || { echo "audit: --trigger is required" >&2; exit 2; }
[ -n "$FINDINGS" ] || { echo "audit: --findings is required (a verdict with no cited evidence does not count as a review)" >&2; exit 2; }
# A review starts from a seed and searches what changed (S163; `pnpm backlog:search`), so its findings carry
# the `query:` lines it ran: the record of what it read. Answers and skip entries don't search, so don't need one.
grep -q '^query:' <<<"$FINDINGS" ||
  { echo "audit: the findings name no query: line — a ${KIND} records the pnpm backlog:search queries it ran (S163 AC 8: a review reads what its seed and searches reach, and says so)" >&2; exit 1; }
# The in-flight items (S156 AC 13): comma-separated IDs, recorded as "S9, S12" ("none" when none).
if [ -n "$IN_FLIGHT" ]; then
  # in-flight.ts holds the one item-ID pattern (S, B, F or V and digits); comma-separated, no spaces.
  node scripts/backlog-vault/in-flight.ts check "$IN_FLIGHT" ||
    { echo "audit: --in-flight takes comma-separated item IDs (S9,S12,B87,F1), not '${IN_FLIGHT}'" >&2; exit 2; }
  IN_FLIGHT_ROW="${IN_FLIGHT//,/, }"
else
  IN_FLIGHT_ROW="none"
fi

new_fragment "$RID" review || exit 2
{
  echo "## ${DATE} — ${KIND} (\`${VERDICT}\`)"
  echo
  echo "| | |"
  echo "|---|---|"
  echo "| Entry | ${KIND} pass |"
  echo "| Captured (UTC) | \`${STAMP}\` |"
  echo "| HEAD at review | \`${HEAD_SHA}\` (tree ${TREE}) |"
  echo "| Trigger | ${TRIGGER} |"
  echo "| Stories \`done\` since last review | ${SINCE:-—} |"
  echo "| In flight | ${IN_FLIGHT_ROW} |"
  echo "| Verdict | \`${VERDICT}\` |"
  echo
  echo "**Findings / amendments**"
  echo
  echo "$FINDINGS"
} >"$FRAG_TMP"
finish_fragment || exit 2

echo "audit ${MODE}: wrote a \`${VERDICT}\` ${KIND} entry to ${FRAG}"
if [ "$VERDICT" = "blocked" ]; then
  echo "audit ${MODE}: verdict is 'blocked' — stop and ask the user. Do not start a story." >&2
  exit 1
fi
