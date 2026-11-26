#!/usr/bin/env bash
# Grader for backlog story S146 — staging and previews deploy only when the build's inputs changed:
# a deploy records every file its build read (Vite's module graph, the Worker bundle's esbuild
# metafile, the deploy scripts' bundler graph and a short named list) with its git blob hash and the
# release label, and the next deploy skips install, build, migrations and deploy when
# `build-inputs.ts check` says `unchanged` against that record. Production always deploys.
# Contract: frame note 00, "Verify-script contract" (docs/v3/backlog/frame/).
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`); runs only the
# story-scoped Vitest files named below, once, and reads each test's result by name.

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "AC 1: pnpm build:inputs record (functions/src/deploy/build-inputs.ts) records Vite's module graph (a plugin in web/vite.config.ts), the Worker's wrangler --metafile, the deploy scripts' bundler graph, the named list and BT_RELEASE; unit tests named 'S146 AC 1' pass for each case the AC lists"
check 2 "AC 2: node functions/src/deploy/build-inputs.ts check runs with only node: imports, fails on a missing record, and unit tests named 'S146 AC 2' pass for unchanged, no record, unparseable, changed hash, deleted file, other version, an added import and plain node"
check 3 "AC 3: deploy.yml's staging and preview jobs fetch their last record before installing and skip on unchanged, store a record only after the deploy, preview-teardown deletes it, a workflow_dispatch force input deploys staging, production always deploys; tests named 'S146 AC 3' in deploy-workflow.test.ts pin it"
check 4 "AC 4: build:inputs named in deploy.yml's staging and preview jobs and header line, README's Staging bullet, wrangler.jsonc's staging comment, LOOP.md's two merge-deploys sentences (old parenthesis gone) and the release skill's prepare step (1) up to '(2) smoke-test'"
check 5 "AC 5: S146's Status is done: its snapshot fragment records done"
check 6 "S146 changed no file outside its fence (plus creating scripts/verify-S146.sh and its own records)"

# The commit S146's own changes start from: origin/stage when this grader was written.
BASE=e02c21d58261eadeac46c877e10a1435c4a0e6d8

TMP="$(mktemp -d /tmp/verify-S146.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

TOOL=functions/src/deploy/build-inputs.ts
TESTS=functions/src/deploy/build-inputs.test.ts
WF=.github/workflows/deploy.yml

if [ -f "$TESTS" ]; then
	(cd functions && pnpm exec vitest run src/deploy/build-inputs.test.ts src/deploy/deploy-workflow.test.ts \
		--reporter=json --outputFile="$TMP/fn.json" >"$TMP/fn.log" 2>&1)
fi

# passed_in <file-suffix> <regex> — at least one test in a file ending <file-suffix> whose full name matches ran, and all such passed.
passed_in() {
	[ -f "$TMP/fn.json" ] || return 1
	node -e '
		const r = require(process.argv[1]);
		const re = new RegExp(process.argv[3]);
		const hit = r.testResults.filter((f) => f.name.endsWith(process.argv[2])).flatMap((f) => f.assertionResults).filter((t) => re.test(t.fullName));
		process.exit(hit.length > 0 && hit.every((t) => t.status === "passed") ? 0 : 1);
	' "$TMP/fn.json" "$1" "$2"
}

# job_text <name> — one job of deploy.yml, from its `    <name>:` line to the next job's.
job_text() {
	awk -v name="$1" '
		$0 == "    " name ":" { on = 1; print; next }
		on && /^    [a-z][a-z0-9_-]*:$/ { exit }
		on { print }
	' "$WF"
}

# --- Check 1: recording the inputs ---
[ -f "$TOOL" ] || bad 1 "$TOOL is missing"
grep -qE '"build:inputs": *"node functions/src/deploy/build-inputs\.ts"' package.json || bad 1 "package.json has no build:inputs script running node $TOOL"
grep -qE 'getModuleIds|moduleIds' web/vite.config.ts || bad 1 "web/vite.config.ts has no plugin reading Vite's module graph"
grep -qF -- '--metafile' "$WF" || bad 1 "$WF never asks wrangler for --metafile"
grep -qE 'build-inputs\.ts record|build:inputs record' "$WF" || bad 1 "$WF never records the build's inputs"
for t in \
	"S146 AC 1: records a file the build imports" \
	"S146 AC 1: leaves out a Markdown file and a test file" \
	"S146 AC 1: records a web/public file, a migration, web/index.html and a file a config imports" \
	"S146 AC 1: leaves out node_modules paths and virtual modules without failing" \
	"S146 AC 1: records a file only deploy-bootstrap.ts imports" \
	"S146 AC 1: check fails given a different BT_RELEASE"; do
	passed_in build-inputs.test.ts "$t" || bad 1 "no passing test named '$t'"
done

# --- Check 2: checking the inputs ---
if [ -f "$TOOL" ]; then
	other="$(grep -E '^\s*(import|export) .* from ' "$TOOL" | grep -vE "from \"node:[a-z/_]+\"" || true)"
	[ -z "$other" ] || bad 2 "$TOOL imports something besides node: modules: $other"
	grep -qE 'import\(' "$TOOL" && grep -E 'import\(' "$TOOL" | grep -qvE 'import\("node:|createRequire' && bad 2 "$TOOL dynamically imports a non-node: module at the top level"
	if out="$(cd "$TMP" && node "$OLDPWD/$TOOL" check "$TMP/missing.json" 2>&1)"; then
		bad 2 "check on a missing record exited 0: $out"
	fi
fi
for t in \
	"S146 AC 2: check prints unchanged" \
	"S146 AC 2: fails with no record" \
	"S146 AC 2: fails on a record it can't parse" \
	"S146 AC 2: fails when a listed file's hash changed" \
	"S146 AC 2: fails when a listed file was deleted" \
	"S146 AC 2: fails on a record made by a different version" \
	"S146 AC 2: adding an import to a recorded file fails check" \
	"S146 AC 2: runs with plain node"; do
	passed_in build-inputs.test.ts "$t" || bad 2 "no passing test named '$t'"
done

# --- Check 3: deploying from it ---
for t in "S146 AC 3: staging" "S146 AC 3: preview " "S146 AC 3: preview-teardown" "S146 AC 3: force" "S146 AC 3: production"; do
	passed_in deploy-workflow.test.ts "$t" || bad 3 "no passing test named '$t…' in deploy-workflow.test.ts"
done
grep -qE '^    workflow_dispatch:' "$WF" || bad 3 "$WF has no workflow_dispatch trigger"
job_text staging >"$TMP/staging"
job_text preview >"$TMP/preview"
job_text preview-teardown >"$TMP/teardown"
job_text production >"$TMP/production"
grep -qF 'actions: read' "$TMP/staging" || bad 3 "the staging job lacks actions: read"
grep -qF 'actions: read' "$TMP/preview" || bad 3 "the preview job lacks actions: read"
grep -qF 'actions: write' "$TMP/teardown" || bad 3 "preview-teardown lacks actions: write"
grep -qF 'upload-artifact' "$TMP/staging" || bad 3 "the staging job stores no record"
grep -qF 'upload-artifact' "$TMP/preview" || bad 3 "the preview job stores no record"
grep -qE 'build-inputs|build:inputs' "$TMP/production" && bad 3 "the production job reads the input check (it must always deploy)"

# --- Check 4: documented ---
grep -qF 'build:inputs' "$TMP/staging" || bad 4 "deploy.yml's staging job never names build:inputs"
grep -qF 'build:inputs' "$TMP/preview" || bad 4 "deploy.yml's preview job never names build:inputs"
sed -n '1,/^on:/p' "$WF" | grep -A3 'Every push to stage' | grep -qF 'build:inputs' || bad 4 "deploy.yml's header line about staging doesn't name build:inputs"
grep -E '^- \*\*Staging\.\*\*' README.md | grep -qF 'build:inputs' || bad 4 "README's Staging bullet doesn't name build:inputs"
grep -A3 'Every push to stage' wrangler.jsonc | grep -qF 'build:inputs' || bad 4 "wrangler.jsonc's staging comment doesn't name build:inputs"
grep -qF '(unless it changes only docs, which deploys nothing)' docs/v3/LOOP.md && bad 4 "docs/v3/LOOP.md still has the old 'unless it changes only docs' parenthesis"
n="$(grep -cE 'deploys `stage\.baseball\.theater`.*build:inputs' docs/v3/LOOP.md)"
[ "$n" -ge 2 ] || bad 4 "docs/v3/LOOP.md names build:inputs in $n of its two merge-deploys sentences"
step1="$(node -e '
	const t = require("fs").readFileSync(".claude/skills/release/SKILL.md", "utf8");
	const a = t.indexOf("**Prepare**");
	const b = t.indexOf("(2) smoke-test", a);
	process.stdout.write(a < 0 || b < 0 ? "" : t.slice(a, b));
')"
[ -n "$step1" ] || bad 4 "no prepare step (1) found in .claude/skills/release/SKILL.md (from **Prepare** to '(2) smoke-test')"
grep -qF 'build:inputs' <<<"$step1" || bad 4 "the release skill's prepare step (1) never names build:inputs"

# --- Check 5: Status done ---
[ "$(story_snapshot_status S146)" = "done" ] || bad 5 "S146's snapshot does not record Status done"

# --- Check 6: fence ---
fence='^(functions/src/deploy/|functions/package\.json$|package\.json$|web/vite\.config\.ts$|\.github/workflows/deploy\.yml$|README\.md$|wrangler\.jsonc$|\.claude/skills/release/SKILL\.md$|docs/v3/LOOP\.md$|docs/v3/backlog/|docs/v3/AUDIT\.md$|docs/v3/audit\.jsonl$|docs/v3/INDEX\.md$|CHANGELOG\.md$|docs/v3/audit/|changelog\.d/S146\.md$|scripts/verify-S146\.sh$)'
while IFS= read -r f; do
	[ -z "$f" ] && continue
	grep -qE "$fence" <<<"$f" || bad 6 "outside the fence: $f"
done < <(story_own_changed_files S146 "$BASE" .)
own_added="$(story_own_diff S146 "$BASE" --name-status --diff-filter=A -- scripts/verify-S146.sh)"
[ -n "$own_added" ] || [ -n "$(git ls-files --others --exclude-standard -- scripts/verify-S146.sh)" ] || bad 6 "scripts/verify-S146.sh was not created by S146"

report "verify-S146"
exit $?
