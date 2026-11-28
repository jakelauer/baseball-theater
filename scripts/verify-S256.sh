#!/usr/bin/env bash
# Grader for story S256 — how supporters fund BT (a tip jar with nothing unlocked, one membership or
# tiers) and which payment provider takes the money, each chosen by the owner from a written
# comparison: docs/v3/SUPPORT-MODEL.md, docs/v3/PAYMENTS-RESEARCH.md, FEATURES' rows in the owner's
# words, and a proposed (never accepted) amendment to ADR-019 in ARCHITECTURE.md.
# A commit-time proof of this story (S84). Contract: frame note 00, "Verify-script contract"
# (docs/v3/backlog/frame/).
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`). Reads the story's
# own text from its ship-time snapshot, or, before it ships, from its newest text record (both in
# the repository), never from GitHub.

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "AC 1: SUPPORT-MODEL.md opens with an inventory table naming every Entitlements flag (with the files that read it, the grep command and the commit it ran on), S215's override, S209, S190, S91, S92, S178-S182, the AI game companion row and push notifications, and the pnpm backlog:search used; S184 is not a row"
check 2 "AC 2: Model A: no perks, Model B: one membership and Model C: tiers each have their own ### section in which Perks, Legal exposure, Entitlement code, Gated stories and Former backers each carry non-empty text; the document states the note's points and says it is research, not legal advice"
check 3 "AC 3: a Candidate perks table (AI companion, next-pitch odds, push, supporter badge or credit, early access) gives for each: BT's own work in the note's sense, built from MLB's data (the agent's observation), running cost a month at a stated number of supporters (S176's \$100 cap, estimates marked), the owner's compute rule and FEATURES' 'power, not a paywall' principle; it says where the line falls and why the raw feed, MLB's clips and Savant's values are excluded"
check 4 "AC 4: SUPPORT-MODEL.md ends with a Recommendation and a Question for the owner (recommended choice first) before its last section; the story's **Owner answer (support model):** line quotes the owner, and the document, FEATURES' Free vs paid and Modern membership rows and its Tiers section carry that answer word for word"
check 5 "AC 5: SUPPORT-MODEL.md's last section, What follows, lists S91, S92, S178, S179, S180, S181, S182, S190 and S259 and how each changes, and lists S209's and S215's changes as new stories; S256 records no other item's text"
check 6 "AC 6: PAYMENTS-RESEARCH.md compares Patreon (the baseline), Stripe Billing with Stripe Tax, Paddle, Polar and Stripe Managed Payments, says what Link is and what became of Lemon Squeezy, and says it is research, not financial, tax or legal advice"
check 7 "AC 7: the fee table's first row is Patreon; every candidate has a US-card and an EU-card row with a one-off \$3/\$5/\$10, monthly \$3/\$5/\$10 and annual column, each row citing an https source and a YYYY-MM-DD read date; the story's **Owner answer (Patreon plan):** line quotes the owner and the table marks at most the one plan it names as BT's (or says BT's plan is unknown)"
check 8 "AC 8: a ## Tax section gives each candidate's seller of record, US sales tax, EU VAT and what BT does, names the One-Stop Shop and cites the European Commission's own page with a read date"
check 9 "AC 9: a ## Running it section gives each candidate's support types, refunds and disputes, payouts, customer portal, Workers fit, webhooks, event order (ADR-022), test mode and personal data (ADR-028), each non-empty"
check 10 "AC 10: a ## By support model section says which candidates fit Model A, B and C and quotes the owner's support-model answer"
check 11 "AC 11: PAYMENTS-RESEARCH.md ends with a Recommendation and a Question for the owner (recommended choice first); the story's **Owner answer (provider):** line quotes the owner, and the document and FEATURES' Payments / pledges row carry that answer word for word"
check 12 "AC 12: ARCHITECTURE.md has a dated proposed amendment to ADR-019 citing S256, naming ADR-004, the provider chosen, the merchant of record, entitlements and S259, quoting the provider answer, and not marked accepted"
check 13 "AC 13: S256's Status is done: its snapshot records done"
check 14 "S256 changed no file outside its fence (plus creating scripts/verify-S256.sh and its own records), and nothing under scripts/ or test/ but its grader"

# The commit S256's own changes start from: `git merge-base origin/stage HEAD` when this grader was written.
BASE=166f22789a2a821eec955c3980cbb7aa4b8dc29f

SM=docs/v3/SUPPORT-MODEL.md
PR=docs/v3/PAYMENTS-RESEARCH.md
FEATURES=docs/v3/FEATURES.md
ARCH=docs/v3/ARCHITECTURE.md
TYPES=packages/domain/src/types.ts

TMP="$(mktemp -d /tmp/verify-S256.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

# The story's text: its ship-time snapshot once audit.sh story has written one, else its newest text record.
{ story_snapshot S256 2>/dev/null || node scripts/backlog-vault/text-records.ts newest S256 2>/dev/null; } >"$TMP/story"

# answer_of <label> — the owner's quoted answer on the story's "**Owner answer (<label>):**" line: the
# last *"…"* on it (the question is quoted before it). Empty when there is no such line.
answer_of() {
	grep -m1 -F "**Owner answer ($1):**" "$TMP/story" | grep -oE '\*"[^"]+"\*' | tail -1 | sed -E 's/^\*"//; s/"\*$//'
}

# h2 <file> <title> — the lines of the "## <title>" section (to the next "## ").
h2() {
	awk -v h="## $2" '$0==h{f=1;next} /^## /{f=0} f' "$1"
}

# h2_titles <file> — every "## " heading's title, in order.
h2_titles() {
	grep -E '^## ' "$1" | sed -E 's/^## //'
}

# labels <file> <heading prefix> <label>… — prints "missing-heading" when no "### <prefix>…" heading
# exists, else one "empty <label>" line per label with no text in that section (from the heading to
# the next ## or ### heading), the text running from "**<label>:**" to the next listed label.
labels() {
	node -e '
		const [file, prefix, ...labels] = process.argv.slice(1);
		const lines = require("node:fs").readFileSync(file, "utf8").split("\n");
		const at = lines.findIndex((l) => l.startsWith("### " + prefix));
		if (at < 0) { console.log("missing-heading"); process.exit(0); }
		let end = lines.length;
		for (let i = at + 1; i < lines.length; i++) if (/^#{2,3} /.test(lines[i])) { end = i; break; }
		const text = lines.slice(at + 1, end).join("\n");
		const marks = labels.map((l) => ({ l, i: text.indexOf("**" + l + ":**") })).filter((m) => m.i >= 0).sort((a, b) => a.i - b.i);
		for (const l of labels)
		{
			const m = marks.find((x) => x.l === l);
			if (!m) { console.log("empty " + l); continue; }
			const next = marks.find((x) => x.i > m.i);
			const body = text.slice(m.i + l.length + 5, next ? next.i : text.length).trim();
			if (!body) console.log("empty " + l);
		}
	' "$@" 2>/dev/null
}

# table_rows <text on stdin> — the data rows of the first markdown table (header and rule left out).
table_rows() {
	awk '/^\|/{n++; if (n>2) print; next} n>0{exit}'
}

CANDIDATES=("Patreon" "Stripe Billing" "Paddle" "Polar" "Stripe Managed Payments")

# --- Check 1: AC 1: the inventory of what is gated ---
if [ ! -f "$SM" ]; then
	for i in 1 2 3 4 5; do bad "$i" "$SM missing"; done
else
	first="$(h2_titles "$SM" | head -1)"
	[ "$first" = "What is gated today" ] || bad 1 "$SM does not open with '## What is gated today' (first section: '$first')"
	inv="$(h2 "$SM" "What is gated today")"
	rows="$(table_rows <<<"$inv")"
	[ -n "$rows" ] || bad 1 "'## What is gated today' holds no table"
	flags="$(awk '/^export type Entitlements = \{/{f=1;next} f&&/^\};/{exit} f' "$TYPES" | grep -oE '^\s*[a-zA-Z]+:' | tr -d ' \t:' | grep -vx tier)"
	[ -n "$flags" ] || bad 1 "no flags found in $TYPES's Entitlements"
	for fl in $flags; do
		row="$(grep -F "\`$fl\`" <<<"$rows" | head -1)"
		if [ -z "$row" ]; then
			bad 1 "the inventory has no row for the flag $fl"
		else
			grep -qE '\.tsx?' <<<"$row" || bad 1 "the $fl row names no file that reads it"
		fi
	done
	grep -qE 'git grep' <<<"$inv" || bad 1 "the inventory does not record its grep command"
	grep -qE '\b[0-9a-f]{7,40}\b' <<<"$inv" || bad 1 "the inventory does not record the commit its grep ran on"
	grep -qF 'pnpm backlog:search' <<<"$inv" || bad 1 "the inventory does not record its pnpm backlog:search"
	for want in S215 S209 S190 S91 S92 S178 S179 S180 S181 S182 "AI game companion" "Push notifications"; do
		grep -qE "(^|[^0-9A-Za-z])$want([^0-9]|$)" <<<"$rows" || bad 1 "the inventory table does not name $want"
	done
	grep -qE '(^|[^0-9])S184([^0-9]|$)' <<<"$rows" && bad 1 "the inventory table lists S184 (closed with chat)"

	# --- Check 2: AC 2: three models on the same five points ---
	for m in "Model A: no perks" "Model B: one membership" "Model C: tiers"; do
		out="$(labels "$SM" "$m" "Perks" "Legal exposure" "Entitlement code" "Gated stories" "Former backers")"
		if [ "$out" = "missing-heading" ]; then
			bad 2 "no '### $m' section"
		elif [ -n "$out" ]; then
			while IFS= read -r l; do bad 2 "'### $m': $l"; done <<<"$out"
		fi
	done
	for p in "detached and disinterested generosity" "individual, non-commercial, non-bulk use" "customary price" "sales tax"; do
		grep -qiF "$p" "$SM" || bad 2 "$SM does not state the note's point '$p'"
	done
	grep -qiE 'research, not legal advice' "$SM" || bad 2 "$SM does not say it is research, not legal advice"

	# --- Check 3: AC 3: candidate perks ---
	cp="$(h2 "$SM" "Candidate perks")"
	head="$(grep -m1 -E '^\|' <<<"$cp")"
	for col in "Perk" "BT's own work" "MLB's data" "Cost a month" "Compute" "Power, not a paywall"; do
		grep -qiF "$col" <<<"$head" || bad 3 "the Candidate perks table has no '$col' column"
	done
	prow="$(table_rows <<<"$cp")"
	for want in "AI companion" "next-pitch" "push" "badge" "early access"; do
		grep -qiF "$want" <<<"$prow" || bad 3 "the Candidate perks table has no '$want' row"
	done
	ncol="$(awk -F'|' '{print NF}' <<<"$head")"
	while IFS= read -r r; do
		[ -z "$r" ] && continue
		[ "$(awk -F'|' '{print NF}' <<<"$r")" = "$ncol" ] || bad 3 "a perk row has the wrong number of cells: $(cut -c1-60 <<<"$r")"
		awk -F'|' '{for (i=2;i<NF;i++) if ($i ~ /^[[:space:]]*$/) exit 1}' <<<"$r" || bad 3 "a perk row has an empty cell: $(cut -c1-60 <<<"$r")"
	done <<<"$prow"
	grep -qF '$100' <<<"$cp" || bad 3 "the perks do not use S176's \$100 monthly AI cap"
	grep -qiE 'estimate' <<<"$cp" || bad 3 "no perk cost is marked as an estimate"
	grep -qiE '[0-9,]+ supporters' <<<"$cp" || bad 3 "the costs state no number of supporters"
	grep -qiE "agent's" <<<"$cp" || bad 3 "the MLB's-data marks are not marked as the agent's own observation"
	grep -qF "For the computation ones though, I want to focus on performance of the computation. I don't want to end up spending a ton on compute" "$SM" ||
		bad 3 "$SM does not quote the owner's compute rule"
	grep -qF "patronage should feel like power, not a paywall on the homepage" "$SM" || bad 3 "$SM does not quote FEATURES' principle"
	ex="$(h2 "$SM" "Excluded")"
	for w in "raw feed" "clips" "Savant"; do
		grep -qiF "$w" <<<"$ex" || bad 3 "'## Excluded' does not say why $w is excluded"
	done
	[ -n "$(h2 "$SM" "Where the line falls" | sed '/^[[:space:]]*$/d')" ] || bad 3 "no '## Where the line falls' section"

	# --- Check 4: AC 4: recommendation, question, answer ---
	titles="$(h2_titles "$SM")"
	n="$(wc -l <<<"$titles")"
	[ "$(sed -n "$((n - 2))p" <<<"$titles")" = "Recommendation" ] && [ "$(sed -n "$((n - 1))p" <<<"$titles")" = "Question for the owner" ] ||
		bad 4 "$SM's last sections are not Recommendation, then Question for the owner, then What follows"
	q="$(h2 "$SM" "Question for the owner")"
	grep -m1 -E '^[0-9]+\. |^- ' <<<"$q" | grep -qF '(Recommended)' || bad 4 "the question's first choice is not the recommended one"
	ans="$(answer_of "support model")"
	if [ -z "$ans" ]; then
		bad 4 "the story has no quoted **Owner answer (support model):** line (parked for the owner's answer)"
	else
		grep -qF "$ans" "$SM" || bad 4 "$SM does not quote the owner's support-model answer"
		grep -E '^\| \*\*Free vs paid\*\* \|' "$FEATURES" | grep -qF "$ans" || bad 4 "FEATURES' Free vs paid row does not carry the owner's answer"
		grep -E '^\| \*\*Modern membership\*\* \|' "$FEATURES" | grep -qF "$ans" || bad 4 "FEATURES' Modern membership row does not carry the owner's answer"
		awk '/^### Tiers/{f=1;next} /^##/{f=0} f' "$FEATURES" | grep -qF "$ans" || bad 4 "FEATURES' Tiers section does not carry the owner's answer"
	fi

	# --- Check 5: AC 5: what follows ---
	last="$(tail -1 <<<"$titles")"
	[ "$last" = "What follows" ] || bad 5 "$SM's last section is '$last', not 'What follows'"
	wf="$(h2 "$SM" "What follows")"
	for s in S91 S92 S178 S179 S180 S181 S182 S190 S259; do
		grep -qE "(^|[^0-9])$s([^0-9]|$)" <<<"$wf" || bad 5 "'## What follows' does not list $s"
	done
	for s in S209 S215; do
		grep -E "(^|[^0-9])$s([^0-9]|$)" <<<"$wf" | grep -qiF "new story" || bad 5 "'## What follows' does not list $s's change as a new story"
	done
fi

story_own_changed_files S256 "$BASE" . >"$TMP/changed" 2>/dev/null || true
others="$(grep -E '^docs/v3/audit/' "$TMP/changed" | grep -vE '/[^/]*-S256-[a-z]+\.md$')"
[ -z "$others" ] || bad 5 "S256 changed a record that is not its own: $(head -1 <<<"$others")"

# --- Check 6: AC 6: the candidates ---
if [ ! -f "$PR" ]; then
	for i in 6 7 8 9 10 11; do bad "$i" "$PR missing"; done
else
	for c in "Patreon" "Stripe Billing" "Stripe Tax" "Paddle" "Polar" "Stripe Managed Payments" "Link" "Lemon Squeezy"; do
		grep -qF "$c" "$PR" || bad 6 "$PR does not name $c"
	done
	[ -n "$(h2 "$PR" "Link and Lemon Squeezy" | sed '/^[[:space:]]*$/d')" ] || bad 6 "no '## Link and Lemon Squeezy' section saying what each is"
	grep -qiE 'research, not financial, tax or legal advice' "$PR" || bad 6 "$PR does not say it is research, not financial, tax or legal advice"

	# --- Check 7: AC 7: fees ---
	fees="$(h2 "$PR" "Fees")"
	fhead="$(grep -m1 -E '^\|' <<<"$fees")"
	for col in "Candidate" "Card" "One-off \$3" "One-off \$5" "One-off \$10" "Monthly \$3" "Monthly \$5" "Monthly \$10" "Annual \$36" "Annual \$60" "Annual \$120" "Source" "Read"; do
		grep -qF "| $col |" <<<"$fhead" || bad 7 "the fee table has no '$col' column"
	done
	frows="$(table_rows <<<"$fees")"
	[ -n "$frows" ] || bad 7 "'## Fees' holds no table"
	head -1 <<<"$frows" | grep -qE '^\| \*?\*?Patreon' || bad 7 "the fee table's first row is not Patreon"
	while IFS= read -r r; do
		[ -z "$r" ] && continue
		grep -qE 'https://' <<<"$r" || bad 7 "a fee row cites no https source: $(cut -c1-60 <<<"$r")"
		grep -qE '20[0-9]{2}-[0-9]{2}-[0-9]{2}' <<<"$r" || bad 7 "a fee row has no read date: $(cut -c1-60 <<<"$r")"
	done <<<"$frows"
	for c in "${CANDIDATES[@]}"; do
		for card in US EU; do
			grep -E "^\| \*?\*?$c" <<<"$frows" | grep -qE "\| $card( card)? \|" || bad 7 "the fee table has no $card-card row for $c"
		done
	done
	marked="$(grep -cF "BT's plan" <<<"$frows")"
	plan_ans="$(answer_of "Patreon plan")"
	if [ -z "$plan_ans" ]; then
		bad 7 "the story has no quoted **Owner answer (Patreon plan):** line (parked for the owner's answer)"
		[ "$marked" = 0 ] || bad 7 "the fee table marks a Patreon plan as BT's before the owner has said which"
	else
		grep -qF "$plan_ans" "$PR" || bad 7 "$PR does not quote the owner's Patreon-plan answer"
		if grep -qiF "BT's plan is unknown" "$PR"; then
			[ "$marked" = 0 ] || bad 7 "the table says BT's plan is unknown but marks a row as BT's"
		else
			[ "$(grep -F "BT's plan" <<<"$frows" | sed -E 's/^\| ([^|]*)\|.*/\1/' | sort -u | wc -l | tr -d ' ')" = 1 ] ||
				bad 7 "the fee table does not mark exactly one Patreon plan as BT's"
		fi
	fi

	# --- Check 8: AC 8: tax ---
	for c in "${CANDIDATES[@]}"; do
		out="$(awk '/^## Tax$/{f=1} f' "$PR" >"$TMP/tax"; labels "$TMP/tax" "$c" "Seller of record" "US sales tax" "EU VAT" "What BT does")"
		if [ "$out" = "missing-heading" ]; then
			bad 8 "'## Tax' has no '### $c' section"
		elif [ -n "$out" ]; then
			while IFS= read -r l; do bad 8 "Tax, '### $c': $l"; done <<<"$out"
		fi
	done
	tax="$(h2 "$PR" "Tax")"
	grep -qF "One-Stop Shop" <<<"$tax" || bad 8 "'## Tax' does not name the One-Stop Shop"
	grep -E 'https://[a-z.-]*ec\.europa\.eu' <<<"$tax" | grep -qE '20[0-9]{2}-[0-9]{2}-[0-9]{2}' ||
		bad 8 "'## Tax' does not cite the European Commission's own page with a read date"

	# --- Check 9: AC 9: running it ---
	awk '/^## Running it$/{f=1} f' "$PR" >"$TMP/run"
	for c in "${CANDIDATES[@]}"; do
		out="$(labels "$TMP/run" "$c" "Support types" "Refunds and disputes" "Payouts" "Customer portal" "Workers fit" "Webhooks" "Event order" "Test mode" "Personal data")"
		if [ "$out" = "missing-heading" ]; then
			bad 9 "'## Running it' has no '### $c' section"
		elif [ -n "$out" ]; then
			while IFS= read -r l; do bad 9 "Running it, '### $c': $l"; done <<<"$out"
		fi
	done
	grep -qF "ADR-022" "$TMP/run" || bad 9 "'## Running it' does not weigh event order against ADR-022"
	grep -qF "data-classification.ts" "$TMP/run" || bad 9 "'## Running it' does not name the classification manifest"

	# --- Check 10: AC 10: by support model ---
	bm="$(h2 "$PR" "By support model")"
	for m in "Model A" "Model B" "Model C"; do
		grep -qF "$m" <<<"$bm" || bad 10 "'## By support model' does not cover $m"
	done
	sm_ans="$(answer_of "support model")"
	if [ -z "$sm_ans" ]; then
		bad 10 "the owner has not chosen a support model yet (AC 4), so '## By support model' cannot say which was chosen"
	else
		grep -qF "$sm_ans" <<<"$bm" || bad 10 "'## By support model' does not quote the owner's support-model answer"
	fi

	# --- Check 11: AC 11: the provider question and answer ---
	pt="$(h2_titles "$PR")"
	pn="$(wc -l <<<"$pt")"
	[ "$(sed -n "$((pn - 1))p" <<<"$pt")" = "Recommendation" ] && [ "$(tail -1 <<<"$pt")" = "Question for the owner" ] ||
		bad 11 "$PR does not end with Recommendation, then Question for the owner"
	h2 "$PR" "Question for the owner" | grep -m1 -E '^[0-9]+\. |^- ' | grep -qF '(Recommended)' || bad 11 "the provider question's first choice is not the recommended one"
	pv_ans="$(answer_of "provider")"
	if [ -z "$pv_ans" ]; then
		bad 11 "the story has no quoted **Owner answer (provider):** line (parked for the owner's answer)"
	else
		grep -qF "$pv_ans" "$PR" || bad 11 "$PR does not quote the owner's provider answer"
		grep -E '^\| \*\*Payments / pledges\*\* \|' "$FEATURES" | grep -qF "$pv_ans" || bad 11 "FEATURES' Payments / pledges row does not carry the owner's provider answer"
	fi
fi

# --- Check 12: AC 12: a proposed amendment ---
amend_head="$(grep -m1 -nE '^#{3,4} .*Proposed amendment to ADR-019' "$ARCH")"
if [ -z "$amend_head" ]; then
	bad 12 "$ARCH has no 'Proposed amendment to ADR-019' heading"
else
	ln="${amend_head%%:*}"
	htxt="${amend_head#*:}"
	grep -qE '20[0-9]{2}-[0-9]{2}-[0-9]{2}' <<<"$htxt" || bad 12 "the amendment's heading is not dated"
	grep -qiE 'accepted' <<<"$htxt" && bad 12 "the amendment's heading marks it accepted"
	body="$(awk -v s="$ln" 'NR>s && /^#{1,4} /{exit} NR>s' "$ARCH")"
	for w in S256 ADR-004 "merchant of record" "entitlements" S259; do
		grep -qiF "$w" <<<"$body" || bad 12 "the amendment does not name $w"
	done
	grep -qiE '\*\*Status:\*\* *proposed' <<<"$body" || bad 12 "the amendment has no '**Status:** proposed' line"
	grep -qiE '\*\*Status:\*\* *accepted' <<<"$body" && bad 12 "the amendment is marked accepted"
	pv_ans="$(answer_of "provider")"
	[ -n "$pv_ans" ] && grep -qF "$pv_ans" <<<"$body" || bad 12 "the amendment does not quote the owner's provider answer"
fi

# --- Check 13: AC 13: Status done ---
[ "$(story_snapshot_status S256)" = "done" ] || bad 13 "S256's snapshot does not record Status done"

# --- Check 14: fence ---
fence='^(docs/v3/SUPPORT-MODEL\.md$|docs/v3/PAYMENTS-RESEARCH\.md$|docs/v3/ARCHITECTURE\.md$|docs/v3/FEATURES\.md$|docs/v3/backlog/|docs/v3/audit/|changelog\.d/S256\.md$|scripts/verify-S256\.sh$)'
while IFS= read -r f; do
	[ -z "$f" ] && continue
	grep -qE "$fence" <<<"$f" || bad 14 "outside the fence: $f"
done <"$TMP/changed"
own_added="$(story_own_diff S256 "$BASE" --name-status --diff-filter=A -- scripts/verify-S256.sh)"
[ -n "$own_added" ] || [ -n "$(git ls-files --others --exclude-standard -- scripts/verify-S256.sh)" ] || bad 14 "scripts/verify-S256.sh was not created by S256"
grep -E '^(scripts|test)/' "$TMP/changed" | grep -vxF 'scripts/verify-S256.sh' | grep -q . &&
	bad 14 "S256 changed a file under scripts/ or test/: $(grep -E '^(scripts|test)/' "$TMP/changed" | grep -vxF 'scripts/verify-S256.sh' | head -1)"

report "verify-S256"
exit $?
