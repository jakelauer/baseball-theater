#!/usr/bin/env bash
# Runs a command while holding the one verify lock every worktree of this repository shares, so only one
# full `pnpm verify` of this repository runs at a time and the others queue for it (owner, 2026-11-23, asked
# "Only one full verify at a time: workers queue for it instead of all running at once … needs a small
# lock (a tooling change)": "yeah, one at a time lock"). Three or four parallel `/run-backlog` workers'
# gates at once drove an 18-core Mac's load to 45–80 and timed tests out, forcing reruns.
#
#   scripts/with-verify-lock.sh pnpm verify:run   # what `pnpm verify` runs (root package.json)
#
# The lock is a directory, `<git common dir>/bt-verify.lock`, so every worktree sees the same one; it
# holds `pid` (this wrapper's pid) and `worktree` (the holder's checkout, named to whoever waits). macOS
# has no flock(1), so it is taken with mkdir, which is atomic. A waiter polls every BT_VERIFY_LOCK_POLL
# seconds (default 2), prints one line naming the holder's worktree, and takes the lock over when the
# holder is gone (a crashed or SIGKILLed run that never released it): its pid is dead, or now belongs to
# some other process (the lock survives a reboot, and pids wrap), which `holder_alive` tells apart by
# its command line. A takeover renames the lock aside (atomic: one waiter wins) and checks it took the
# stale holder's lock, putting back one a new holder took meanwhile. The lock only spreads load; it
# guards no data, so a race it still misses only lets two runs overlap, as they all did before.
#
# Released on any exit (success, failure, Ctrl-C), and the command's exit code is this script's, so
# `scripts/audit.sh story` still records the gate's real result. Skipped, running the command directly:
#   - under GitHub Actions (GITHUB_ACTIONS set): each job has its own checkout, so CI is unchanged;
#   - with BT_VERIFY_LOCK=0, the escape hatch;
#   - when this process already holds it (BT_VERIFY_LOCK_HELD, exported to the command), so a nested
#     call can't wait on itself;
#   - outside a git checkout, where there is no shared common dir.
set -u

if [ "$#" -eq 0 ]; then
	echo "usage: scripts/with-verify-lock.sh <command> [args…]" >&2
	exit 2
fi

if [ -n "${GITHUB_ACTIONS:-}" ] || [ "${BT_VERIFY_LOCK:-1}" = "0" ] || [ -n "${BT_VERIFY_LOCK_HELD:-}" ]; then
	exec "$@"
fi

common=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || exec "$@"
worktree=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
LOCK="$common/bt-verify.lock"
POLL="${BT_VERIFY_LOCK_POLL:-2}"

# Whether pid $1 is still another run of this wrapper: not this one (a stale lock can carry a reused pid
# that is now ours), alive, and its command line names this script.
holder_alive()
{
	[ "$1" != "$$" ] && kill -0 "$1" 2>/dev/null && ps -p "$1" -o command= 2>/dev/null | grep -q "with-verify-lock.sh"
}

# Removes the lock only while it is still ours, so a run whose lock was (wrongly) taken over never
# deletes its successor's.
release()
{
	if [ "$(cat "$LOCK/pid" 2>/dev/null)" = "$$" ]; then
		rm -rf "$LOCK"
	fi
}

announced=""
empty_polls=0
waited=0
start=$SECONDS
until mkdir "$LOCK" 2>/dev/null; do
	holder=$(cat "$LOCK/pid" 2>/dev/null || true)
	if [ -z "$holder" ]; then
		# Between a holder's mkdir and its pid write; a pid file still missing after five polls means
		# that holder died in between, so the lock is stale.
		empty_polls=$((empty_polls + 1))
		if [ "$empty_polls" -lt 5 ]; then
			sleep "$POLL"
			continue
		fi
	fi
	empty_polls=0
	if [ -z "$holder" ] || ! holder_alive "$holder"; then
		echo "verify lock: holder pid ${holder:-?} is gone; taking the lock over" >&2
		stale="$LOCK.stale.$$"
		if mv "$LOCK" "$stale" 2>/dev/null; then
			# A holder that took the lock between the read above and the rename is put back, not deleted.
			if [ "$(cat "$stale/pid" 2>/dev/null || true)" != "$holder" ] && [ ! -e "$LOCK" ]; then
				mv "$stale" "$LOCK" 2>/dev/null
			fi
			rm -rf "$stale"
		fi
		continue
	fi
	if [ "$holder" != "$announced" ]; then
		echo "verify lock: waiting for the pnpm verify in $(cat "$LOCK/worktree" 2>/dev/null || echo "an unknown worktree") (pid $holder)…" >&2
		announced=$holder
	fi
	waited=1
	sleep "$POLL"
done

trap release EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
echo "$$" >"$LOCK/pid"
echo "$worktree" >"$LOCK/worktree"
if [ "$waited" -eq 1 ]; then
	echo "verify lock: acquired after $((SECONDS - start)) s" >&2
fi

export BT_VERIFY_LOCK_HELD=$$
"$@"
status=$?
exit "$status"
