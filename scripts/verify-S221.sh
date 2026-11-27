#!/usr/bin/env bash
# Grader for story S221 — a /run-backlog run prints a progress bar of how much of its plan is finished:
# one computation (runs.ts runProgress) read from the run journal, a `plan` run event naming the planned
# items, a `runs.ts progress` command printing the bar as plain text, and run-backlog's SKILL.md saying
# when the coordinator prints it. A commit-time proof of this story (S84). Contract: frame note 00,
# "Verify-script contract" (docs/v3/backlog/frame/).
# No network. No writes outside /tmp (its journal lives in a temp root). Does its own checking (never
# `pnpm verify`); runs only the story-scoped Vitest files named below (tests titled "S221 AC <n>").

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "AC 1: runs.ts exports runProgress(journal); claims.ts RUN_KINDS has a run-level 'plan' event (run event plan --items <ID>,…, each ID checked by ITEM_ID); state from each item's newest RUN_ITEM_KINDS event only, except a park, which holds until resume, item-start, merged or held; unit tests 'S221 AC 1' cover an empty run, part-way, a park then resume, a parked item staying parked through later events, a held item reaching 100%, a turn-capped item, a merged unplanned ID, an item added mid-run, a merged then review-score and claim, and a finished run"
check 2 "AC 2: runs.ts progress --journal <path> prints a marker line, a 20-cell █/░ bar with finished / total and the percentage, done / in flight / parked / set aside lines only when they have items, a next line, and a closing rule line, with no ANSI codes; a test 'S221 AC 2' pins the exact output"
check 3 "AC 3: run-backlog's SKILL.md tells the coordinator to print runs.ts progress in a fenced code block when an item merges or parks, when the plan grows, and at the start of step 6's summary, and to log plan events when it adds items"
check 4 "AC 4: runProgress's and the progress command's comments say what counts as planned and finished, and why"
check 5 "AC 5: S221's Status is done: its snapshot fragment records done"
check 6 "S221 changed no file outside its fence (plus creating scripts/verify-S221.sh and its own records)"

# The commit S221's own changes start from: `git merge-base origin/stage HEAD` when this grader was written.
BASE=984e9f0c4acb3ddf2db7b9b9544abd7daafe214b

TMP="$(mktemp -d /tmp/verify-S221.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

VAULT=scripts/backlog-vault
RUNS=$VAULT/runs.ts
CLAIMS=$VAULT/claims.ts
SKILL=.claude/skills/run-backlog/SKILL.md

TESTS=(runs.test.ts claims.test.ts)
(cd "$VAULT" && ../../node_modules/.bin/vitest run --config vitest.config.ts --reporter=json --outputFile="$TMP/report.json" "${TESTS[@]}" >"$TMP/vitest.log" 2>&1)
# has_test <file> <pattern> — a test in <file> whose title (or full name) matches <pattern> (extended
# regex, any case) ran and passed: a skipped or todo test, or a title only in the source, never counts.
has_test() {
	[ -f "$TMP/report.json" ] || return 1
	node -e '
		const r = require(process.argv[1]);
		const f = r.testResults.find((t) => t.name.endsWith("/" + process.argv[2]));
		const re = new RegExp(process.argv[3], "i");
		process.exit(f && f.assertionResults.some((a) => a.status === "passed" && (re.test(a.title) || re.test(a.fullName))) ? 0 : 1);
	' "$TMP/report.json" "$1" "$2"
}
# failed_tests — the names of any failing test in the two files (the run must be clean, not just tagged ones).
failed_tests() {
	[ -f "$TMP/report.json" ] || { echo "vitest wrote no report: $(tail -5 "$TMP/vitest.log" | tr '\n' ' ')"; return; }
	node -e '
		const r = require(process.argv[1]);
		for (const f of r.testResults) for (const a of f.assertionResults) if (a.status === "failed") console.log(a.fullName);
	' "$TMP/report.json"
}

# doc_before <file> <regex> — the comment lines right above the first line matching <regex>.
doc_before() {
	node -e '
		const lines = require("node:fs").readFileSync(process.argv[1], "utf8").split("\n");
		const re = new RegExp(process.argv[2]);
		const at = lines.findIndex((l) => re.test(l));
		if (at < 0) process.exit(0);
		const out = [];
		for (let i = at - 1; i >= 0; i--)
		{
			const t = lines[i].trim();
			if (/^(\/\*\*|\*|\*\/|\/\/)/.test(t)) out.unshift(lines[i]);
			else break;
		}
		console.log(out.join("\n"));
	' "$1" "$2" 2>/dev/null
}

fails="$(failed_tests)"
[ -z "$fails" ] || { bad 1 "failing tests in runs.test.ts / claims.test.ts: $(tr '\n' ';' <<<"$fails")"; }

# --- Check 1: AC 1: one computation, from the journal ---
grep -qE '^export function runProgress\(' "$RUNS" || bad 1 "$RUNS does not export function runProgress"
grep -qE '^export const RUN_KINDS = \[[^]]*"plan"' "$CLAIMS" || bad 1 "$CLAIMS's RUN_KINDS has no \"plan\""
for t in "empty run" "part-way" "park.*resume" "stays parked" "held.*100" "turn-cap" "unplanned" "added mid-run" "review-score" "finished run"; do
	has_test runs.test.ts "S221 AC 1.*$t" || bad 1 "no passing runs.test.ts test titled 'S221 AC 1 … $t'"
done
has_test runs.test.ts "S221 AC 1.*claim" || bad 1 "no passing runs.test.ts test titled 'S221 AC 1 … claim' (a claim after merged)"
has_test claims.test.ts "S221 AC 1.*plan" || bad 1 "no passing claims.test.ts test titled 'S221 AC 1 … plan' (the plan event)"

# The journal, built through the real CLI in a temp root: S1 merged (then a review-score and a claim naming it),
# S2 in flight, S3 parked, B9 held, S4 not started; S5 added by a second plan event and started.
ROOT="$TMP/root"
mkdir -p "$ROOT"
cl() { node "$CLAIMS" --root "$ROOT" "$@" >>"$TMP/cli.log" 2>&1; }
if cl run start --n 5 --c 2 \
	&& cl run event plan --items S1,S2,S3,S4,B9 \
	&& cl run event item-start S1 && cl run event pr-open S1 --pr 11 && cl run event merged S1 \
	&& cl run event review-score S1 --review backlog --score 2 --threshold 7 --reason "x" \
	&& cl run event item-start S2 && cl run event item-start S3 && cl run event park S3 \
	&& cl run event item-start B9 && cl run event held B9 \
	&& cl run event plan --items S5 && cl run event item-start S5; then
	J="$ROOT/.run/run.json"
	node -e '
		const j = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
		const plans = j.events.filter((e) => e.kind === "plan");
		process.exit(plans.length === 2 && plans[0].items.join(",") === "S1,S2,S3,S4,B9" && !plans[0].id ? 0 : 1);
	' "$J" || bad 1 "run event plan --items did not log a run-level plan event with its items"
	cl run event plan --items S1,notanid && bad 1 "run event plan accepted an ID that fails ITEM_ID"
	cl run event plan && bad 1 "run event plan accepted no --items"
	cl run event gate-open --items S1 && bad 1 "a run event other than plan accepted --items"

	# --- Check 2: AC 2: the bar ---
	if node "$RUNS" progress --journal "$J" >"$TMP/bar.txt" 2>"$TMP/bar.err"; then
		node -e '
			const out = require("node:fs").readFileSync(process.argv[1], "utf8");
			const lines = out.replace(/\n$/, "").split("\n");
			const errs = [];
			if (out.includes("\x1b")) errs.push("it prints ANSI escape codes");
			if (!/▶/.test(lines[0] ?? "")) errs.push("its first line is not a ▶ marker line");
			const bar = lines.find((l) => /[█░]/.test(l)) ?? "";
			const cells = [...bar].filter((c) => c === "█" || c === "░");
			if (cells.length !== 20) errs.push(`its bar has ${cells.length} cells, not 20`);
			// S1–S4 and B9 planned, then S5 = 6, less held B9 = 5 in the total; S1 finished: 1 / 5, 20%, 4 full cells.
			if (cells.filter((c) => c === "█").length !== 4) errs.push("its bar does not fill 4 of 20 cells for 20%");
			if (!/\b1 ?\/ ?5\b/.test(bar)) errs.push("its bar line does not say 1 / 5");
			if (!/\b20%/.test(bar)) errs.push("its bar line does not say 20%");
			const line = (re) => lines.find((l) => re.test(l)) ?? "";
			if (!/S1/.test(line(/done/i))) errs.push("no done line naming S1");
			if (!/S2/.test(line(/now|in flight/i)) || !/S5/.test(line(/now|in flight/i))) errs.push("no in-flight line naming S2 and S5");
			if (!/S3/.test(line(/parked/i))) errs.push("no parked line naming S3");
			if (!/B9/.test(line(/set aside/i))) errs.push("no set-aside line naming B9");
			if (!/S4/.test(line(/next/i)) || /S[1235]\b/.test(line(/next/i))) errs.push("the next line does not name S4 alone");
			const last = lines[lines.length - 1] ?? "";
			if (!/^[─━=\-]{10,}$/.test(last)) errs.push("its last line is not a rule line");
			if (errs.length) { console.log(errs.join("; ")); process.exit(1); }
		' "$TMP/bar.txt" >"$TMP/bar.log" 2>&1 || bad 2 "runs.ts progress: $(cat "$TMP/bar.log")"
	else
		bad 2 "runs.ts progress --journal exited nonzero: $(head -3 "$TMP/bar.err" | tr '\n' ' ')"
	fi
	# A run with no merged items but a held one only: lines for empty states are left out.
	ROOT2="$TMP/root2"; mkdir -p "$ROOT2"
	if node "$CLAIMS" --root "$ROOT2" run start --n 2 --c 2 >/dev/null 2>&1 && node "$CLAIMS" --root "$ROOT2" run event plan --items S7,S8 >/dev/null 2>&1 \
		&& node "$RUNS" progress --journal "$ROOT2/.run/run.json" >"$TMP/bar2.txt" 2>/dev/null; then
		grep -qiE 'done|parked|set aside|now' "$TMP/bar2.txt" && bad 2 "a run with nothing started still prints done, in-flight, parked or set-aside lines: $(tr '\n' '|' <"$TMP/bar2.txt")"
		grep -qE '0 ?/ ?2' "$TMP/bar2.txt" && grep -qE '\b0%' "$TMP/bar2.txt" || bad 2 "a run with nothing finished does not say 0 / 2 and 0%"
	else
		bad 2 "runs.ts progress failed on a plan-only journal"
	fi
else
	bad 1 "claims.ts run start / run event plan … failed: $(tail -3 "$TMP/cli.log" | tr '\n' ' ')"
	bad 2 "no journal to print (claims.ts run event plan failed)"
fi
has_test runs.test.ts "S221 AC 2.*exact" || bad 2 "no passing runs.test.ts test titled 'S221 AC 2 … exact' pinning the output"

# --- Check 3: AC 3: the run prints it ---
if [ -f "$SKILL" ]; then
	grep -qE 'runs\.ts progress' "$SKILL" || bad 3 "$SKILL never names runs.ts progress"
	para="$(grep -E 'runs\.ts progress' "$SKILL")"
	grep -qiE 'code block' <<<"$para" || bad 3 "$SKILL does not say to print the bar in a fenced code block"
	grep -qiE 'merg' <<<"$para" || bad 3 "$SKILL does not say to print the bar when an item merges"
	grep -qiE 'park' <<<"$para" || bad 3 "$SKILL does not say to print the bar when an item parks"
	grep -qiE 'plan grows|plan event|adds? items' <<<"$para" || bad 3 "$SKILL does not say to print the bar when the plan grows"
	step6="$(awk '/^## 6\./{on=1} on' "$SKILL")"
	grep -qiE 'runs\.ts progress|progress bar' <<<"$step6" || bad 3 "$SKILL's step 6 does not start its summary with the progress bar"
	grep -qE 'run event plan --items' "$SKILL" || bad 3 "$SKILL does not tell the coordinator to log run event plan --items"
else
	bad 3 "$SKILL is missing"
fi

# --- Check 4: AC 4: comments are true ---
c="$(doc_before "$RUNS" '^export function runProgress\(')"
grep -qi 'planned' <<<"$c" && grep -qi 'finished' <<<"$c" || bad 4 "runProgress's comment does not say what counts as planned and finished"
grep -qiE 'review-score|so that|so a|since|because' <<<"$c" || bad 4 "runProgress's comment does not say why"
header="$(awk '/^import /{exit} {print}' "$RUNS")"
cmd="$(awk '/runs\.ts progress/{on=1; print; next} on && /node scripts\/backlog-vault\/runs\.ts /{exit} on && /^ \*\/$/{exit} on' <<<"$header")"
[ -n "$cmd" ] || bad 4 "$RUNS's header does not document runs.ts progress"
grep -qi 'planned' <<<"$cmd" && grep -qi 'finished' <<<"$cmd" || bad 4 "the progress command's comment does not say what counts as planned and finished"

# --- Check 5: AC 5: Status done ---
[ "$(story_snapshot_status S221)" = "done" ] || bad 5 "S221's snapshot does not record Status done"

# --- Check 6: fence ---
fence='^(scripts/backlog-vault/|\.claude/skills/run-backlog/SKILL\.md$|docs/v3/backlog/|docs/v3/audit/|changelog\.d/|scripts/verify-S221\.sh$)'
while IFS= read -r f; do
	[ -z "$f" ] && continue
	grep -qE "$fence" <<<"$f" || bad 6 "outside the fence: $f"
done < <(story_own_changed_files S221 "$BASE" .)
own_added="$(story_own_diff S221 "$BASE" --name-status --diff-filter=A -- scripts/verify-S221.sh)"
[ -n "$own_added" ] || [ -n "$(git ls-files --others --exclude-standard -- scripts/verify-S221.sh)" ] || bad 6 "scripts/verify-S221.sh was not created by S221"

report "verify-S221"
exit $?
