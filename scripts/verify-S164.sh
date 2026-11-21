#!/usr/bin/env bash
# Grader for backlog story S164 — stories in GitHub issues: every story, open and done, becomes an
# issue that holds its text, read through one module (scripts/backlog-vault/github.ts), recorded in
# the ledger at migration, edit and ship time (owner, 2026-11-20: "GitHub owns state (Recommended)",
# "Approve the rewording (Recommended)", "Accept the split (Recommended)").
# Contract: frame note 00, "Verify-script contract" (docs/v3/backlog/frame/).
# No network: the GitHub module's tests stub the gh runner, and the migration's proof is the
# committed migration fragments. No writes outside /tmp. Does its own checking (never `pnpm verify`);
# runs the story-scoped Vitest files once and reads each one's result.

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "AC 1: github.ts is the one GitHub module (REST through an injected gh runner, the listed calls, githubSource, the issues paging moved in); pnpm backlog:sync writes .backlog-cache/issues.json through a per-process temp file; .backlog-cache/ is git-ignored; github.test.ts covers every listed case and passes; no other vault file calls gh, fetch or api.github.com; nothing names graphql"
check 2 "AC 2: pnpm backlog:check holds with no cache and no gh/GH_TOKEN; it checks the text records (one item per ID, hashes, fields blocks, the chain with forks named, no notes once migrated); check-at-commit.test.ts and text-records.test.ts pass; LAWS.md L9's first clause is the approved wording, with the three owner answers quoted and the live parts named"
check 3 "AC 3: the readers (doc-index, assemble, claims, goal.sh, bugs, search) read the cache through github.ts or the text records, never the story/bug note folders (outside notesSource and the migration); the vault tests and worktree-for.test.ts pass; claims.test.ts covers claim B<N> from GitHub state; pnpm goal 163 prints S163's /goal line"
check 4 "AC 4: pnpm backlog:migrate exists; migrate.test.ts covers every listed case and passes; every story and bug note at the newest recorded migration base has a migration or create fragment, every open story's rewrite is recorded; no story or bug note, frame embed or Backlog.base remains"
check 5 "AC 5: audit.sh story writes an <ID>-snapshot fragment before the grader runs; checks.sh has story_snapshot and story_snapshot_status; --reverify records the snapshot's path and SHA-256; audit-reverify.test.ts and checks-own.test.ts cover them and pass"
check 6 "AC 6: audit.sh create, edit and apply exist (record first, no GitHub call when recording, apply idempotent through trusted Applied comments); audit-edit.test.ts covers every listed case and passes; CLAUDE.md's review-skip rule says 'a recorded edit answering a pull request's review'"
check 7 "AC 7: CLAUDE.md, frame 00, the skills and agents say items are issues read through backlog:sync/backlog:search, state changed by github.ts status|label|milestone, text through audit.sh create|edit and apply; no old note-path pointers remain; ARCHITECTURE.md lines differ only in link targets; LOOP.md changed only lines 12, 60, 66, 106, 163; CLAUDE.md + run-backlog SKILL grow by at most 300 words"
check 8 "AC 8: S164 changed nothing under .github/"
check 9 "AC 9: S164's Status is done: its snapshot fragment records done"
check 10 "S164 changed no file outside its fence (plus creating scripts/verify-S164.sh)"

# The commit S164's own changes start from: `git merge-base origin/stage HEAD` when this grader was written.
BASE=6f149855

TMP="$(mktemp -d /tmp/verify-S164.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

VAULT=scripts/backlog-vault
GH="$VAULT/github.ts"
FRAME="docs/v3/backlog/frame/00 Baseball Theater v3 — Checkable backlog.md"
AUDIT_DIR=docs/v3/audit

# The story-scoped test files, run once; each file's pass/fail read from the JSON report.
TESTS=(github.test.ts text-records.test.ts check-at-commit.test.ts migrate.test.ts audit-edit.test.ts audit-reverify.test.ts
  checks-own.test.ts vault.test.ts doc-index.test.ts source.test.ts bugs.test.ts claims.test.ts notes-dir.test.ts worktree-for.test.ts)
present=()
for t in "${TESTS[@]}"; do [ -f "$VAULT/$t" ] && present+=("$t"); done
if [ "${#present[@]}" -gt 0 ]; then
  (cd "$VAULT" && ../../node_modules/.bin/vitest run --config vitest.config.ts --reporter=json --outputFile="$TMP/report.json" "${present[@]}" >"$TMP/vitest.log" 2>&1)
fi
# test_passed <file> — the file ran, and every test in it passed.
test_passed() {
  [ -f "$TMP/report.json" ] || return 1
  node -e '
    const r = require(process.argv[1]);
    const f = r.testResults.find((t) => t.name.endsWith("/" + process.argv[2]));
    process.exit(f && f.status === "passed" && f.assertionResults.length > 0 ? 0 : 1);
  ' "$TMP/report.json" "$1"
}
# has_test <file> <pattern> — a test title in <file> matches <pattern> (extended regex, any case).
has_test() { [ -f "$VAULT/$1" ] && grep -qiE "it(\.each\(.*\))?\(\"[^\"]*($2)" "$VAULT/$1"; }
# need_tests <check> <file> <pattern>… — the file passes and has a test title for each pattern.
need_tests() {
  local n="$1" f="$2"
  shift 2
  test_passed "$f" || bad "$n" "$f is missing or failing"
  local p
  for p in "$@"; do has_test "$f" "$p" || bad "$n" "$f has no test matching /$p/"; done
}

# Text-record fragments (migration, create, edit, snapshot), as paths.
records() { find "$AUDIT_DIR" -type f \( -name "*-$1-migration.md" -o -name "*-$1-create.md" \) 2>/dev/null; }

# --- Check 1: one GitHub module, read-only sync ---
if [ ! -f "$GH" ]; then
  bad 1 "$GH is missing"
else
  grep -qE '^export (function|const) githubSource' "$GH" || bad 1 "github.ts does not export githubSource"
  grep -qE '^export function listIssues\(' "$GH" || bad 1 "the issues paging (listIssues) did not move into github.ts"
  grep -qE '^export function listIssues\(' "$VAULT/search.ts" && bad 1 "search.ts still defines listIssues"
  for call in 'issues\?state=all' 'issues/\$\{' 'comments' 'milestones\?state=all' '"POST"' '"PATCH"'; do
    grep -qE "$call" "$GH" || bad 1 "github.ts makes no call matching /$call/"
  done
  grep -qE 'issues\.json\.\$\{(process\.)?pid\}\.tmp|\.\$\{(process\.)?pid\}\.tmp' "$GH" || bad 1 "github.ts writes no per-process temp file (issues.json.<pid>.tmp)"
  grep -qE 'renameSync' "$GH" || bad 1 "github.ts does not rename the temp file into place"
fi
grep -qE '"backlog:sync":\s*"node scripts/backlog-vault/github\.ts sync' package.json || bad 1 "package.json has no backlog:sync running github.ts sync"
grep -qxE '/?\.backlog-cache/?' .gitignore || bad 1 ".gitignore does not ignore .backlog-cache/"
need_tests 1 github.test.ts "pagination" "pull request" "outsider" "labels it .?bug" "S1 and S10" "label and state" \
  "fields block (missing|unparseable)" "unaccepted bug" "fractional priority" "deleted" "transferred" "two syncs" "failed write" "worktree"
talkers="$(grep -rnE "(execFile|spawn|execFileSync|spawnSync)\(\s*['\"]gh['\"]|fetch\(|api\.github\.com" "$VAULT" --include='*.ts' |
  grep -vE "^$VAULT/github(\.test)?\.ts:" || true)"
[ -z "$talkers" ] || bad 1 "another vault file talks to GitHub: $(head -3 <<<"$talkers" | tr '\n' ' ')"
runner_users="$(grep -rlnE 'run\("gh"' "$VAULT" --include='*.ts' | grep -vE "^$VAULT/github(\.test)?\.ts$" || true)"
[ -z "$runner_users" ] || bad 1 "the gh runner is called outside github.ts: $runner_users"
[ -z "$(grep -rli graphql "$VAULT" || true)" ] || bad 1 "a vault file names graphql: $(grep -rli graphql "$VAULT" | tr '\n' ' ')"

# --- Check 2: backlog:check at every commit, with no GitHub ---
mkdir -p "$TMP/bin"
printf '#!/bin/sh\ntouch "%s/gh-called"\nexit 1\n' "$TMP" >"$TMP/bin/gh"
chmod +x "$TMP/bin/gh"
(BT_BACKLOG_CACHE="$TMP/no-cache" node "$VAULT/cli.ts" check >"$TMP/check1.log" 2>&1) || bad 2 "pnpm backlog:check fails with the cache directory missing: $(tail -2 "$TMP/check1.log" | tr '\n' ' ')"
(unset GH_TOKEN GITHUB_TOKEN; PATH="$TMP/bin:$PATH" BT_BACKLOG_CACHE="$TMP/no-cache" node "$VAULT/cli.ts" check >"$TMP/check2.log" 2>&1) ||
  bad 2 "pnpm backlog:check fails with gh off PATH and GH_TOKEN unset: $(tail -2 "$TMP/check2.log" | tr '\n' ' ')"
[ -e "$TMP/gh-called" ] && bad 2 "pnpm backlog:check called gh"
[ -e "$TMP/no-cache" ] && bad 2 "pnpm backlog:check created the cache directory"
for f in cli.ts vault.ts parse.ts source.ts records.ts text-records.ts; do
  [ -f "$VAULT/$f" ] && grep -qE 'from "\./github\.ts"' "$VAULT/$f" && bad 2 "$f (the commit-reproducible check) imports github.ts"
done
[ -f "$VAULT/text-records.ts" ] || bad 2 "$VAULT/text-records.ts (the text record chain) is missing"
need_tests 2 text-records.test.ts "one (recorded )?item per ID|duplicate" "hash" "fields block" "fork" "gap" "no (story or bug )?notes? (once|after)"
need_tests 2 check-at-commit.test.ts "older commit"
l9="$(grep -E '^\| L9 ' docs/v3/LAWS.md || true)"
grep -qiF "the backlog issues are consistent (one issue per ID, status label agreeing with state, fields block parsing, no unlogged edit to an accepted story)" <<<"$l9" ||
  bad 2 "LAWS.md L9 does not carry the approved first clause"
grep -qiF "a UI story waits for its ratified design" <<<"$l9" || bad 2 "LAWS.md L9 lost its design clause"
grep -qiF "every story says what it is for" <<<"$l9" || bad 2 "LAWS.md L9 lost its Source clause"
for q in "Approve the rewording (Recommended)" "Accept the split (Recommended)" "GitHub owns state (Recommended)"; do
  grep -qF "$q" <<<"$l9" || bad 2 "LAWS.md L9 does not quote \"$q\""
done
grep -qF -- "--live" <<<"$l9" || bad 2 "LAWS.md L9 does not name S165's pnpm backlog:check --live for the live parts"

# --- Check 3: every reader swapped ---
readers=("$VAULT/doc-index.ts" "$VAULT/assemble.ts" "$VAULT/claims.ts" scripts/goal.sh "$VAULT/bugs.ts" "$VAULT/search.ts")
for r in "${readers[@]}"; do
  [ -f "$r" ] || { bad 3 "$r is missing"; continue; }
  hits="$(grep -n 'backlog/stories\|backlog/bugs' "$r" | grep -viE 'notesSource|migrat' || true)"
  [ -z "$hits" ] || bad 3 "$r still reads the note folders: $(head -2 <<<"$hits" | tr '\n' ' ')"
done
grep -qE 'from "\./github\.ts"' "$VAULT/claims.ts" || bad 3 "claims.ts does not read GitHub state through github.ts"
grep -qE 'from "\./github\.ts"' "$VAULT/search.ts" || bad 3 "search.ts's default source is not github.ts's"
grep -qE 'github\.ts' scripts/goal.sh || bad 3 "scripts/goal.sh does not read the cache through github.ts"
for t in vault.test.ts doc-index.test.ts source.test.ts bugs.test.ts notes-dir.test.ts worktree-for.test.ts; do
  test_passed "$t" || bad 3 "$t is missing or failing"
done
need_tests 3 claims.test.ts "claim B[0-9N<]"
need_tests 3 worktree-for.test.ts "no cache"
s163_line="$(for f in $(records S163); do awk '/^```text$/ { f = 1; next } f && /^```/ { f = 0 } f && /^\/goal S163 / { print; exit }' "$f"; done | head -1)"
if [ -z "$s163_line" ]; then
  bad 3 "no recorded body for S163 holds its /goal line"
else
  # A cache holding S163's recorded body, as pnpm backlog:sync would write it.
  mkdir -p "$TMP/cache"
  node -e '
    const fs = require("fs");
    const line = process.argv[1];
    fs.writeFileSync(process.argv[2] + "/issues.json", JSON.stringify({ syncedAt: new Date().toISOString(), repo: "o/r", trusted: ["o"], issues: [
      { number: 999, title: "S163: search-driven reviews", state: "closed", state_reason: "completed", labels: [{ name: "story" }, { name: "status:done" }],
        user: { login: "o" }, body: "**`/goal` command**\n\n```text\n" + line + "\n```\n\n### Backlog fields\n\n```yaml\npriority: 68\n```\n" } ] }));
  ' "$s163_line" "$TMP/cache"
  got="$(BT_BACKLOG_CACHE="$TMP/cache" scripts/goal.sh 163 2>/dev/null | head -1)"
  [ "$got" = "$s163_line" ] || bad 3 "pnpm goal 163 printed '${got:0:80}', not S163's /goal line"
fi

# --- Check 4: the migration ---
grep -qE '"backlog:migrate":\s*"node scripts/backlog-vault/migrate\.ts' package.json || bad 4 "package.json has no backlog:migrate running migrate.ts"
need_tests 4 migrate.test.ts "fresh run" "stopped after 50" "between create and close" "rate.limit" "Shipped.*with(out)? (a )?pull request|without a pull request" \
  "superseded" "rewrite" "bug" "reconcile after" "second .?--reconcile"
mig_base="$(find "$AUDIT_DIR" -type f \( -name '*-migration.md' -o -name '*-create.md' \) -exec grep -hoE '^\| (Base|Read from stage) \| `[0-9a-f]{7,40}`' {} + 2>/dev/null |
  grep -oE '[0-9a-f]{7,40}' | while read -r s; do git log -1 --format="%ct %H" "$s" 2>/dev/null; done | sort -n | tail -1 | cut -d' ' -f2)"
if [ -z "$mig_base" ]; then
  bad 4 "no committed migration fragment names the base commit it read the notes from"
else
  while IFS= read -r note; do
    [ -z "$note" ] && continue
    id="$(basename "$note" .md)"
    [ -n "$(records "$id")" ] || bad 4 "$note at $mig_base has no migration or create fragment"
    case "$note" in
      docs/v3/backlog/stories/todo/* | docs/v3/backlog/stories/doing/* | docs/v3/backlog/stories/blocked/*)
        # shellcheck disable=SC2046
        grep -lq '^| Rewrite |' $(records "$id") 2>/dev/null || grep -qE '^```diff' $(records "$id") 2>/dev/null ||
          bad 4 "open story $id has no recorded rewrite diff" ;;
    esac
  done < <(git ls-tree -r --name-only "$mig_base" -- docs/v3/backlog/stories docs/v3/backlog/bugs | grep -E '/[SB][0-9]+\.md$')
fi
left="$(git ls-files -- docs/v3/backlog/stories docs/v3/backlog/bugs | grep -E '\.md$' || true)"
[ -z "$left" ] || bad 4 "story or bug notes remain: $(head -3 <<<"$left" | tr '\n' ' ')"
grep -rlF '![[S' docs/v3/backlog/frame/ >/dev/null 2>&1 && bad 4 "a frame note still embeds a story (![[S…]])"
[ -e docs/v3/backlog/Backlog.base ] && bad 4 "docs/v3/backlog/Backlog.base remains"

# --- Check 5: a snapshot at ship time ---
if grep -qE 'snapshot' scripts/audit.sh; then
  snap_line="$(grep -nE 'new_fragment "\$ID" snapshot' scripts/audit.sh | head -1 | cut -d: -f1)"
  grader_line="$(grep -nE '^\s*"\$GRADER" >"\$grader_log"' scripts/audit.sh | head -1 | cut -d: -f1)"
  { [ -n "$snap_line" ] && [ -n "$grader_line" ] && [ "$snap_line" -lt "$grader_line" ]; } || bad 5 "audit.sh story does not write the snapshot fragment before it runs the grader"
else
  bad 5 "audit.sh writes no snapshot fragment"
fi
grep -qE '^story_snapshot\(\)' scripts/lib/checks.sh || bad 5 "checks.sh has no story_snapshot"
grep -qE '^story_snapshot_status\(\)' scripts/lib/checks.sh || bad 5 "checks.sh has no story_snapshot_status"
grep -qiE 'Snapshot.*SHA-256|snapshot_sha|snapshot.*shasum' scripts/audit.sh || bad 5 "--reverify records no snapshot SHA-256"
need_tests 5 audit-reverify.test.ts "snapshot" "before S164"
need_tests 5 checks-own.test.ts "story_snapshot\b" "story_snapshot_status" "hash"

# --- Check 6: text recorded first, applied after merge ---
for m in create edit apply migration; do
  grep -qE "^\s*$m\)" scripts/audit.sh || bad 6 "audit.sh has no $m mode"
done
need_tests 6 audit-edit.test.ts "create and an edit" "create B" "only what isn.t live" "lost .?POST" "crash after (a )?.?PATCH" "outsider" "mismatch" \
  "second .?apply" "fork"
grep -qF "a recorded edit answering a pull request's review" CLAUDE.md || bad 6 "CLAUDE.md's review-skip rule does not say \"a recorded edit answering a pull request's review\""

# --- Check 7: the process docs and pointers ---
for p in 'pnpm backlog:sync' 'pnpm backlog:search' 'github.ts status|label|milestone' 'audit.sh create|edit' 'audit.sh apply'; do
  grep -qF "$p" CLAUDE.md || bad 7 "CLAUDE.md does not name '$p'"
  grep -qF "$p" "$FRAME" || bad 7 "frame 00 does not name '$p'"
done
for f in .claude/skills/run-backlog/SKILL.md .claude/skills/pending/SKILL.md .claude/skills/backlog-review/SKILL.md \
  .claude/skills/doc-parity-review/SKILL.md .claude/skills/design-intake-review/SKILL.md \
  .claude/agents/story-worker.md .claude/agents/bug-worker.md .claude/agents/backlog-reviewer.md; do
  [ -f "$f" ] || { bad 7 "$f is missing"; continue; }
  grep -qE 'backlog:sync|backlog:search|github\.ts' "$f" || bad 7 "$f does not say items are read through backlog:sync/backlog:search"
done
old="$(grep -rn 'stories/<status>/S<N>.md\|bugs/<status>/B<\|backlog/stories/\(done\|todo\|blocked\)/' CLAUDE.md AGENTS.md .cursor/rules/ .claude/ docs/v3/ARCHITECTURE.md docs/v3/LOOP.md "$FRAME" 2>/dev/null || true)"
[ -z "$old" ] || bad 7 "old note-path pointers remain: $(head -3 <<<"$old" | cut -c1-120 | tr '\n' ' ')"
# ARCHITECTURE.md: each changed line differs from its base only in a link target.
arch="$(git -c core.quotepath=false diff -U0 "$BASE" -- docs/v3/ARCHITECTURE.md | grep -E '^[-+][^-+]' || true)"
if [ -n "$arch" ]; then
  strip() { sed -E 's/\]\([^)]*\)/]()/g'; }
  [ "$(grep '^-' <<<"$arch" | cut -c2- | strip)" = "$(grep '^+' <<<"$arch" | cut -c2- | strip)" ] ||
    bad 7 "an ARCHITECTURE.md line changed beyond its link target"
fi
grep -q 'docs/v3/ARCHITECTURE.md' <(story_own_changed_files S164 "$BASE" docs/v3/ARCHITECTURE.md) || bad 7 "ARCHITECTURE.md's note links (:897, :903, :1048) were not repointed"
# LOOP.md: lines 12, 60, 66, 106 and 163 changed, each replaced one for one, and no other line.
loop_hunks="$(git diff -U0 "$BASE" -- docs/v3/LOOP.md | grep -E '^@@' | sed -E 's/^@@ -([0-9]+)(,([0-9]+))? \+[0-9]+(,([0-9]+))? @@.*/\1 \3 \5/')"
changed=""
while read -r start oldn newn; do
  [ -z "$start" ] && continue
  oldn="${oldn:-1}"; newn="${newn:-1}"
  [ "$oldn" = "$newn" ] || bad 7 "LOOP.md hunk at line $start is not a one-for-one replacement"
  for ((k = 0; k < oldn; k++)); do changed="$changed $((start + k))"; done
done <<<"$loop_hunks"
[ "$(tr ' ' '\n' <<<"$changed" | grep -v '^$' | sort -n | tr '\n' ' ')" = "12 60 66 106 163 " ] ||
  bad 7 "LOOP.md changed lines${changed:- none}, not exactly 12 60 66 106 163"
words_base="$(git show "$BASE:CLAUDE.md" "$BASE:.claude/skills/run-backlog/SKILL.md" 2>/dev/null | wc -w | tr -d ' ')"
words_now="$(cat CLAUDE.md .claude/skills/run-backlog/SKILL.md | wc -w | tr -d ' ')"
[ "$words_now" -le $((words_base + 300)) ] || bad 7 "CLAUDE.md + run-backlog SKILL grew from $words_base to $words_now words (limit +300)"

# --- Check 8: no workflow changes ---
wf="$(story_own_changed_files S164 "$BASE" .github/)"
[ -z "$wf" ] || bad 8 "S164 changed workflow files: $(tr '\n' ' ' <<<"$wf")"

# --- Check 9: Status done, from S164's own snapshot ---
snap="$(find "$AUDIT_DIR" -type f -name '*-S164-snapshot.md' 2>/dev/null | awk -F/ '{ print $NF "\t" $0 }' | LC_ALL=C sort | tail -1 | cut -f2)"
if [ -z "$snap" ]; then
  bad 9 "S164 has no snapshot fragment"
else
  grep -qE '^\| Status \| `done` \|' "$snap" || bad 9 "$snap does not record Status done"
fi

# --- Check 10: fence ---
fence='^(scripts/backlog-vault/|scripts/audit\.sh$|scripts/goal\.sh$|scripts/review-debt\.sh$|scripts/parity-debt\.sh$|scripts/lib/checks\.sh$|scripts/lib/reverify\.sh$|scripts/lib/story-notes\.sh$|scripts/worktree-for\.sh$|package\.json$|\.gitignore$|\.prettierignore$|\.husky/|\.claude/skills/|\.claude/agents/|CLAUDE\.md$|AGENTS\.md$|\.cursor/rules/|docs/v3/ARCHITECTURE\.md$|docs/v3/LOOP\.md$|docs/v3/LAWS\.md$|docs/v3/backlog/|docs/v3/audit/|changelog\.d/|scripts/verify-S164\.sh$)'
while IFS= read -r f; do
  [ -z "$f" ] && continue
  grep -qE "$fence" <<<"$f" || bad 10 "outside the fence: $f"
done < <(story_own_changed_files S164 "$BASE" .)
own_added="$(story_own_diff S164 "$BASE" --name-status --diff-filter=A -- scripts/verify-S164.sh)"
[ -n "$own_added" ] || [ -n "$(git ls-files --others --exclude-standard -- scripts/verify-S164.sh)" ] || bad 10 "scripts/verify-S164.sh was not created by S164"

report "verify-S164"
exit $?
