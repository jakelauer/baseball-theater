#!/usr/bin/env bash
# `pnpm verify` (ADR-030 rule 7, S168): the one entry point and one exit code of the local check and
# CI. It runs the tasks the change reaches (scripts/verify-plan.ts: the merge base with `stage`,
# committed, uncommitted and untracked files alike, the units they lie in and their dependents, the
# root tasks), reading and writing the local Turborepo cache.
#   pnpm verify           what the change reaches
#   pnpm verify --all     every task, unchanged ones replayed from the cache: the finishing gate
#                         (`scripts/audit.sh story`; the owner, 2026-11-26: "Full suite, cached")
#   pnpm verify --full    every task, executed, no cache read (= BT_VERIFY_FULL=1): `audit.sh story
#                         --reverify`, pushes to stage or main, Deploy's verify job
#   BT_VERIFY_ONLY=<unit> runs only that unit's test (CI's functions shard jobs, BT_COVERAGE_SHARD)
#   BT_VERIFY_SUMMARIZE=1 writes Turborepo's run summary (.turbo/runs/), which audit.sh story records
# Turborepo runs at half the cores and each Vitest at half its workers (issue #643's load timeouts).
set -uo pipefail
cd "$(dirname "$0")/.."

ALL=""
for arg in "$@"; do
	case "$arg" in
		--full) BT_VERIFY_FULL=1 ;;
		--all) ALL="--all" ;;
		*) echo "usage: pnpm verify [--all | --full]" >&2; exit 2 ;;
	esac
done
export BT_VITEST_MAX_WORKERS="50%"
COMMON=(--concurrency=50% --output-logs=errors-only)
[ -n "${BT_VERIFY_SUMMARIZE:-}" ] && COMMON+=(--summarize)

if [ -n "${BT_VERIFY_ONLY:-}" ]; then
	exec pnpm exec turbo run test --filter="$BT_VERIFY_ONLY" --cache=local:w "${COMMON[@]}"
fi

if [ "${BT_VERIFY_FULL:-}" = 1 ]; then
	echo "pnpm verify: every task, executed fresh (BT_VERIFY_FULL=1, no cache read)"
	exec pnpm exec turbo run lint typecheck test build size backlog:check dup:check format:md --cache=local:w "${COMMON[@]}"
fi

PLAN="$(node scripts/verify-plan.ts $ALL)" || { echo "pnpm verify: could not work out the change (scripts/verify-plan.ts)" >&2; exit 2; }
MODE="$(sed -n 's/^mode //p' <<<"$PLAN")"
read -r -a FILTERS <<<"$(sed -n 's/^filters //p' <<<"$PLAN")"
ORPHAN="$(sed -n 's/^orphan //p' <<<"$PLAN")"
echo "pnpm verify: $(sed -n 's/^changed //p' <<<"$PLAN") changed file(s) against the merge base with stage; mode ${MODE}"

case "$MODE" in
	none)
		echo "pnpm verify: nothing changed, so nothing runs (pnpm verify --all runs every task)"
		exit 0
		;;
	all)
		pnpm exec turbo run lint typecheck test build size backlog:check dup:check format:md --cache=local:rw "${COMMON[@]}"
		exit $?
		;;
esac

pnpm exec turbo run lint typecheck test build size backlog:check dup:check format:md "${FILTERS[@]}" --cache=local:rw "${COMMON[@]}"
status=$?
if [ "$ORPHAN" = 1 ]; then
	# A file in no unit and no task's inputs changes no hash, so a plain run would replay a cached pass:
	# run the law-test unit's test and the root tasks write-only, so they execute and law (a) sees it.
	echo "pnpm verify: a changed file lies in no unit and no task's inputs; running the law tests and root tasks fresh"
	pnpm exec turbo run test backlog:check dup:check format:md --filter=@bt/scripts --filter=// --cache=local:w "${COMMON[@]}" || status=1
fi
exit "$status"
