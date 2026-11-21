#!/usr/bin/env bash
# Print a story's full `/goal` command and copy it to the clipboard.
#
#   pnpm goal 37              # or S37 / s37
#
# The `/goal S<N> done` shorthand stores only "S<N> done" as the goal; pasting the
# full line makes the story's exact completion condition the goal itself.
# Reads the story's note, docs/v3/backlog/stories/<status>/S<N>.md, directly: the first `/goal`
# line inside its ```text block under **`/goal` command** (S156 retired the generated BACKLOG.md).
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"

arg="${1:-}"
id="${arg#[sS]}"
if [[ ! "$id" =~ ^[0-9]+$ ]]
then
	echo "usage: pnpm goal <N>   (e.g. pnpm goal 37)" >&2
	exit 2
fi

# One note per ID (pnpm backlog:check refuses two), in the folder its status names.
note="$(ls "$root"/docs/v3/backlog/stories/*/"S$id.md" 2>/dev/null | head -1 || true)"
if [[ -z "$note" ]]
then
	echo "no note for S$id under docs/v3/backlog/stories/" >&2
	exit 1
fi

line="$(awk '/^```text$/ { f = 1; next } f && /^```/ { f = 0 } f && /^\/goal / { print; exit }' "$note")"
if [[ -z "$line" ]]
then
	echo "no /goal command in ${note#"$root"/}" >&2
	exit 1
fi

echo "$line"
if command -v pbcopy > /dev/null
then
	printf '%s' "$line" | pbcopy
	echo "(copied to clipboard)" >&2
fi
