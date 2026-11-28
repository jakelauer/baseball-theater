#!/usr/bin/env bash
# Grader for backlog story S104 — a written catalogue of the player data Baseball Savant publishes
# (docs/v3/SAVANT-CATALOGUE.md), ending with the owner's question of which sets to ingest. A research story:
# no ingest code. A commit-time proof of this story (S84). Contract: docs/v3/backlog/frame/00 (Verify-script contract).
# No network (the catalogue's links are checked for their form only; the agent opened each by hand). Never deploys.
# No writes outside /tmp.

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "docs/v3/SAVANT-CATALOGUE.md holds a table with the columns Data set, URL pattern, Format, Fields, Update cadence, Grain, Reachability, BT already has, What BT could show, Source, Read (in that order); a row for batters and one for pitchers; no row covers pitchers alone (its Grain names batters, hitters, runners, fielders or catchers beside them)"
check 2 "every row's Source cell links https://baseballsavant.mlb.com/…, and its Read cell is an ISO date from 2026-11-27 to today"
check 3 "every row's BT already has cell names what BT already gets (a field or feed, or 'nothing') and its Reachability cell says how it is fetched (plain URL, CSV, JSON, login, key or blocked; \"no login or key\" alone names no method)"
check 4 "the catalogue opens with S103's Terms of Use finding (linked from docs/v3/SAVANT-DATA.md) and says this story fetched nothing by code; each of SAVANT-DATA's seven player-season ideas is a row; SAVANT-DATA.md links the catalogue"
check 5 "S104's own changes touch only docs/v3/SAVANT-CATALOGUE.md, docs/v3/SAVANT-DATA.md, docs/v3/backlog/, docs/v3/audit/, changelog.d/ (and create scripts/verify-S104.sh)"
check 6 "the catalogue ends with an Owner question section: 1 to 3 numbered options, the first marked (Recommended), each naming catalogue rows by Data set name and what BT could show"
check 7 "changelog.d/S104.md exists, S104's snapshot records Status done (only after the owner answers the Owner question), and the Owner question section holds a '### The owner's answer' heading quoting the owner's words"

# The commit S104's own changes start from (origin/stage when the story started, 2026-11-27). The fence
# (check 5) reads only S104's own commits from here through story_own_changed_files (scripts/lib/checks.sh).
BASE=72e31aaf
CAT=docs/v3/SAVANT-CATALOGUE.md
DATA=docs/v3/SAVANT-DATA.md
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Checks 1–4, 6 and 7's owner's-answer clause read the catalogue through one parser: the first Markdown table after the opening, its cells
# split on unescaped pipes (a cell writes a literal pipe as \| or %7C). It prints "FAIL <check> <reason>" lines.
# "Pitcher-only by construction" (AC 1, the owner's "shouldn't be specific to pitchers") is read from each row's
# Grain cell, which names who the row covers: a row naming pitchers and no other kind of player (batters, hitters,
# runners, fielders, catchers) fails. "League", "all players" or "every player" names no kind of player, so it
# cannot rescue a pitcher-only row. Check 3 drops "no login or key" (and its variants) from a Reachability cell
# before looking for a fetch method, so a cell saying only that, with no method, fails.
cat >"$TMP/parse.mjs" <<'EOF'
import { readFileSync } from "node:fs";
const [cat, data, today] = process.argv.slice(2);
const text = readFileSync(cat, "utf8");
const lines = text.split("\n");
const out = [];
const bad = (id, why) => out.push(`FAIL ${id} ${why}`);
const cells = (line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map((c) => c.trim());
const want = ["Data set", "URL pattern", "Format", "Fields", "Update cadence", "Grain", "Reachability", "BT already has", "What BT could show", "Source", "Read"];
const strip = (c) => c.replace(/\*\*/g, "").replace(/`/g, "").trim();
const head = lines.findIndex((l) => l.trim().startsWith("|") && strip(cells(l)[0] ?? "") === "Data set");
const rows = [];
if (head < 0) bad(1, "no table whose first column is Data set");
else
{
	const got = cells(lines[head]).map(strip);
	if (JSON.stringify(got) !== JSON.stringify(want)) bad(1, `header is [${got.join(", ")}], want [${want.join(", ")}]`);
	for (let i = head + 2; i < lines.length && lines[i].trim().startsWith("|"); i++)
	{
		const c = cells(lines[i]);
		if (c.length !== want.length) bad(1, `row ${i + 1} has ${c.length} cells, want ${want.length}`);
		rows.push({ line: i + 1, c: Object.fromEntries(want.map((k, j) => [k, c[j] ?? ""])) });
	}
}
if (head >= 0 && rows.length === 0) bad(1, "the table has no rows");
const who = (g) => ({
	pitchers: /\bpitchers?\b/i.test(g),
	others: /\b(batters?|hitters?|runners?|fielders?|catchers?)\b/i.test(g),
});
let batters = false, pitchers = false;
for (const { line, c } of rows)
{
	const w = who(c.Grain);
	if (/\b(batters?|hitters?)\b/i.test(c.Grain)) batters = true;
	if (w.pitchers) pitchers = true;
	if (!w.pitchers && !w.others) bad(1, `row ${line} (${strip(c["Data set"])}): its Grain names no players it covers`);
	if (w.pitchers && !w.others) bad(1, `row ${line} (${strip(c["Data set"])}) covers pitchers alone`);
	if (!/\]\(https:\/\/baseballsavant\.mlb\.com\/[^)\s]*\)|<https:\/\/baseballsavant\.mlb\.com\/[^>\s]*>|^https:\/\/baseballsavant\.mlb\.com\/\S*$/.test(c.Source)) bad(2, `row ${line}: Source is not an https://baseballsavant.mlb.com/ link: ${c.Source}`);
	const d = c.Read.match(/^(\d{4}-\d{2}-\d{2})$/);
	if (!d) bad(2, `row ${line}: Read is not a YYYY-MM-DD date: ${c.Read}`);
	else if (d[1] < "2026-11-27" || d[1] > today || Number.isNaN(Date.parse(d[1]))) bad(2, `row ${line}: Read ${d[1]} is before 2026-11-27, after ${today} or not a date`);
	const has = strip(c["BT already has"]);
	if (has === "" || /^(-|—|tbd|\?|n\/a)$/i.test(has)) bad(3, `row ${line}: BT already has is blank`);
	const reach = c.Reachability.replace(/\b(no|not|without)\s+(an?\s+)?(login|key)(\s*(,|or|and|nor)\s+(an?\s+)?(login|key))*\b/gi, "");
	if (!/\b(plain URL|CSV|JSON|login|key|blocked)\b/i.test(reach)) bad(3, `row ${line}: Reachability says no fetch method: ${c.Reachability}`);
	for (const k of ["Data set", "URL pattern", "Format", "Fields", "Update cadence", "What BT could show"]) if (strip(c[k]) === "") bad(1, `row ${line}: ${k} is blank`);
}
if (rows.length && !batters) bad(1, "no row's Grain covers batters");
if (rows.length && !pitchers) bad(1, "no row's Grain covers pitchers");
// AC 4: the opening (before the table) carries the Terms finding and the no-fetch statement.
const open = lines.slice(0, head < 0 ? lines.length : head).join("\n");
if (!/Terms of Use/.test(open)) bad(4, "the opening does not give the Terms of Use finding");
if (!/\]\(\.\/SAVANT-DATA\.md(#terms-of-use)?\)/.test(open)) bad(4, "the opening does not link ./SAVANT-DATA.md (its Terms of use)");
if (!/automated/i.test(open) || !/written permission/i.test(open)) bad(4, "the opening does not say the Terms forbid automated collection and redistribution without MLB's written permission");
if (!/fetched nothing by code/i.test(open)) bad(4, "the opening does not state that this story fetched nothing by code");
const names = rows.map((r) => strip(r.c["Data set"]));
for (const idea of ["Leverage and drama index", "Comparison tool", "Histogram", "Rolling average", "Hot and cold zones", "Running splits", "Statcast search"])
	if (!rows.some((r) => r.c["Data set"].toLowerCase().includes(idea.toLowerCase()))) bad(4, `SAVANT-DATA's idea '${idea}' is not a row's Data set`);
if (!/\]\(\.\/SAVANT-CATALOGUE\.md[^)]*\)/.test(readFileSync(data, "utf8"))) bad(4, "docs/v3/SAVANT-DATA.md does not link ./SAVANT-CATALOGUE.md");
// AC 6: the last ## section is the Owner question.
const h2 = lines.map((l, i) => [l, i]).filter(([l]) => /^## /.test(l));
const last = h2.at(-1);
if (!last || !/^## Owner question\s*$/.test(last[0]))
{
	bad(6, "the catalogue's last ## section is not '## Owner question'");
	bad(7, "no '### The owner's answer' heading under '## Owner question' (no such last section)");
}
else
{
	const body = lines.slice(last[1] + 1);
	const opts = body.filter((l) => /^\d+\. /.test(l));
	if (opts.length < 1 || opts.length > 3) bad(6, `the Owner question offers ${opts.length} options, want 1 to 3`);
	opts.forEach((o, i) =>
	{
		if (!o.startsWith(`${i + 1}. `)) bad(6, `option ${i + 1} is numbered out of order`);
		if (i === 0 && !/\(Recommended\)/.test(o)) bad(6, "the first option is not marked (Recommended)");
		if (i > 0 && /\(Recommended\)/.test(o)) bad(6, `option ${i + 1} is marked (Recommended); only the first may be`);
		const m = o.match(/Rows:\s*(.+?)\.\s*BT could show:/);
		if (!m) bad(6, `option ${i + 1} has no 'Rows: … . BT could show: …'`);
		else for (const n of m[1].split(/;\s*/).map((s) => strip(s)).filter(Boolean))
			if (!names.includes(n)) bad(6, `option ${i + 1} names '${n}', which is no row's Data set`);
		if (!/BT could show:\s*\S/.test(o)) bad(6, `option ${i + 1} does not say what BT could show`);
	});
	// AC 7: done only after the owner answers, so the answer is recorded under the question, in the owner's words:
	// a "### The owner's answer" heading whose text (up to the next heading) quotes the owner, as _"…"_ or *"…"*
	// or a > blockquote.
	const ans = body.findIndex((l) => /^### The owner's answer\b/.test(l));
	if (ans < 0) bad(7, "no '### The owner's answer' heading under '## Owner question'");
	else
	{
		const next = body.findIndex((l, i) => i > ans && /^#{1,6} /.test(l));
		const said = body.slice(ans + 1, next < 0 ? body.length : next).join("\n");
		if (!/[_*]"[^"]*\w[^"]*"[_*]|^> *\S/m.test(said)) bad(7, "the owner's answer quotes no words of the owner's");
	}
}
console.log(out.join("\n"));
EOF

if [ ! -f "$CAT" ]; then
  for id in 1 2 3 4 6 7; do bad "$id" "$CAT does not exist"; done
else
  node "$TMP/parse.mjs" "$CAT" "$DATA" "$(date -u +%F)" >"$TMP/parse.txt" 2>&1 || echo "FAIL 1 the catalogue parser crashed: $(tail -3 "$TMP/parse.txt")" >>"$TMP/parse.txt"
  while read -r tag id why; do
    [ "$tag" = FAIL ] && bad "$id" "$why"
  done <"$TMP/parse.txt"
fi

# --- Check 5: inside the fence --------------------------------------------------------------------------------
story_own_changed_files S104 "$BASE" . >"$TMP/changed.txt"
grep -vE '^(docs/v3/SAVANT-CATALOGUE\.md$|docs/v3/SAVANT-DATA\.md$|docs/v3/backlog/|docs/v3/audit/|changelog\.d/|scripts/verify-S104\.sh$)' "$TMP/changed.txt" >"$TMP/fence.txt"
[ -s "$TMP/fence.txt" ] && bad 5 "the story changes files outside its scope: $(tr '\n' ' ' <"$TMP/fence.txt")"
if git cat-file -e "$BASE:scripts/verify-S104.sh" 2>/dev/null; then bad 5 "scripts/verify-S104.sh existed at the base, so the story did not create it"; fi

# --- Check 7: the changelog fragment, and done only after the owner's answer ----------------------------------
[ -f changelog.d/S104.md ] || bad 7 "changelog.d/S104.md does not exist"
[ "$(story_snapshot_status S104)" = "done" ] || bad 7 "S104's snapshot does not record Status done (it waits for the owner's answer to the Owner question)"

report "verify-S104"
exit $?
