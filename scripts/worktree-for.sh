#!/usr/bin/env bash
# scripts/worktree-for.sh [--no-install] <item> [<base>] — a checkout of its own for one backlog
# item (S156 AC 1; #110), so workers build items side by side without seeing each other's files,
# ports or databases (owner, 2026-11-20: "The goal is to enable agents to work in tandem on backlog
# items in a way that they don't conflict").
#
#   <item>   S<N> (branch story/S<N>), B<N> (branch bug/B<N>), or any other name (branch work/<item>)
#   <base>   what the new branch starts from: origin/stage (fetched first) unless the item has a true
#            dependency built in the same run, when it is that item's branch
#   --no-install   skip `pnpm install` (a grader's throwaway clone; `pnpm backlog:build` then runs
#                  only if the worktree already has node_modules)
#
# Makes .claude/worktrees/<item> (git-ignored, and ignored by ESLint) on the new branch, installs
# from the lockfile, runs `pnpm backlog:build` (INDEX.md is built, not committed), and writes the
# worktree's git-ignored `.env.worktree`: its own API, web, Postgres and workerd-test PGlite ports,
# its own Docker Compose project name, and the Hyperdrive override wrangler dev and `pnpm db:seed`
# read (functions/src/adapters/postgres/local.ts). Load it before `pnpm dev` or `pnpm verify`:
#   set -a; . ./.env.worktree; set +a
# Without it every file keeps today's ports (8787, 5173, 5432, 54329).
#
# Re-running for an item that already has a worktree changes nothing and keeps its .env.worktree, so
# the values are stable. A new item's ports come from a slot derived from its name; a slot another
# worktree's .env.worktree already holds is skipped, so live worktrees never share a port.
set -euo pipefail

install=1
if [ "${1:-}" = "--no-install" ]; then install=0; shift; fi
item="${1:-}"
base="${2:-origin/stage}"
if [ -z "$item" ] || [ $# -gt 2 ] || ! [[ "$item" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]]; then
	echo "usage: scripts/worktree-for.sh [--no-install] <item> [<base>]   (item: S<N>, B<N> or a plain name)" >&2
	exit 2
fi

# The main checkout, even when this runs inside another worktree (each worktree's top level differs;
# the common git directory is the main checkout's .git).
common="$(git rev-parse --path-format=absolute --git-common-dir)"
root="$(dirname "$common")"
dir="$root/.claude/worktrees/$item"

case "$item" in
	S[0-9]*) branch="story/$item" ;;
	B[0-9]*) branch="bug/$item" ;;
	*) branch="work/$item" ;;
esac

if [ -e "$dir/.git" ]; then
	echo "worktree-for: $dir already exists (branch $(git -C "$dir" symbolic-ref -q --short HEAD || echo detached)); keeping it"
else
	# A remote base is fetched first so the branch starts from what the remote has now; a failed
	# fetch (offline) falls back to the last fetched copy, said so.
	case "$base" in
		origin/*) git -C "$root" fetch -q origin "${base#origin/}" 2>/dev/null || echo "worktree-for: could not fetch $base; using the local copy" >&2 ;;
	esac
	mkdir -p "$root/.claude/worktrees"
	# Hooks are off for the checkout itself: the post-checkout hook runs `pnpm backlog:build`, which
	# needs the install below to have happened first; this script runs the build itself after it.
	if git -C "$root" show-ref -q --verify "refs/heads/$branch"; then
		git -C "$root" -c core.hooksPath=/dev/null worktree add -q "$dir" "$branch"
	else
		git -C "$root" -c core.hooksPath=/dev/null worktree add -q -b "$branch" "$dir" "$base"
	fi
	echo "worktree-for: made $dir on $branch from $base"
fi

# --- .env.worktree: written once, kept on every re-run --------------------------------------
env_file="$dir/.env.worktree"
if [ ! -f "$env_file" ]; then
	# Slots 1–999. Each port range sits clear of today's defaults and of the other ranges.
	taken=" "
	for other in "$root"/.claude/worktrees/*/.env.worktree; do
		[ -f "$other" ] || continue
		s=$(sed -nE 's/^export BT_WORKTREE_SLOT=([0-9]+)$/\1/p' "$other")
		[ -n "$s" ] && taken="$taken$s "
	done
	slot=$(($(printf '%s' "$item" | cksum | cut -d' ' -f1) % 999 + 1))
	tries=0
	while [[ "$taken" == *" $slot "* ]]; do
		slot=$((slot % 999 + 1))
		tries=$((tries + 1))
		[ "$tries" -lt 999 ] || { echo "worktree-for: no free port slot left" >&2; exit 1; }
	done
	pg_port=$((25000 + slot))
	# Compose project names are lowercase letters, digits, dashes and underscores.
	project="bt-$(printf '%s' "$item" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9_-' '-')"
	cat >"$env_file" <<EOF
# Written by scripts/worktree-for.sh for $item (S156): this checkout's own ports and Compose project.
# Load it before pnpm dev or pnpm verify: set -a; . ./.env.worktree; set +a
export BT_WORKTREE_SLOT=$slot
export BT_API_PORT=$((18000 + slot))
export BT_WEB_PORT=$((19000 + slot))
export BT_PG_PORT=$pg_port
export PGLITE_PORT=$((26000 + slot))
export COMPOSE_PROJECT_NAME=$project
export CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE=postgres://bt:bt@localhost:$pg_port/bt
EOF
	echo "worktree-for: wrote $env_file (slot $slot)"
fi

# --- Install and build the generated docs ----------------------------------------------------
cd "$dir"
if [ "$install" -eq 1 ]; then
	pnpm install --frozen-lockfile
fi
if [ -d node_modules ]; then
	pnpm backlog:build
else
	echo "worktree-for: no node_modules (--no-install); run pnpm install and pnpm backlog:build in $dir"
fi
