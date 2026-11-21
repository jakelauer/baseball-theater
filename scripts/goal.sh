#!/usr/bin/env bash
# Print a story's full `/goal` command and copy it to the clipboard.
#
#   pnpm goal 37              # or S37 / s37
#
# The `/goal S<N> done` shorthand stores only "S<N> done" as the goal; pasting the
# full line makes the story's exact completion condition the goal itself.
# Since S164 a story's text is its GitHub issue: the line is read from the issue cache
# (`pnpm backlog:sync`) through scripts/backlog-vault/github.ts, the first `/goal` line inside a
# ```text block. With no cache it exits 2 and says to run `pnpm backlog:sync`.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"

arg="${1:-}"
id="${arg#[sS]}"
if [[ ! "$id" =~ ^[0-9]+$ ]]
then
	echo "usage: pnpm goal <N>   (e.g. pnpm goal 37)" >&2
	exit 2
fi

line="$(node "$root/scripts/backlog-vault/github.ts" item "S$id" goal)"

echo "$line"
if command -v pbcopy > /dev/null
then
	printf '%s' "$line" | pbcopy
	echo "(copied to clipboard)" >&2
fi
