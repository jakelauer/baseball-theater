---
name: pending
description: Ask the owner every open question in .pending/needs-input.md with the interactive question tool, letting them skip any, then remove the answered ones and act on each answer. Use when the owner types /pending or asks what is waiting for them.
---

# Pending questions

The owner's idea (2026-11-19): "Could we make something I can run at any time, like /pending or something else similarly named, which will ask me the questions you have with your interactive Q&A thing? I'd need to be able to skip questions."

The questions live in one git-ignored file, `.pending/needs-input.md` (owner, same day: "not a file per question, one file total"). **Whenever you ask the owner anything, add a section there at the same time**, and remove it once it is answered, whether through `/pending` or in chat. If the file (or `.pending/`) doesn't exist, create it with a `# Needs your input` heading, then add the section.

## Section format

One `##` section per question:

```markdown
## <header>: <question>

Asked: <date> · Affects: <story / PR / branch>
Blocks: <ID>, <ID>

Links:

- <full URL: a Figma node, a GitHub pull request or issue, or a file:///absolute/path> (optional note)

Options:

- <label> (Recommended) — <what happens>
- <label> — <what happens>

On answer: <what the agent does next>

<context: self-contained, so the owner needs nothing else to answer>
```

- `<header>` is at most 12 characters, with no `:` in it (it is the dialog's chip).
- `Options:` holds 1 to 3 options, the recommended one first. A question with no natural options (free text) gets one option such as `Answer in Other — type your answer`; a question with more than 3 is split into several sections.
- `Links:` (owner, 2026-11-19, asked whether questions could link to what they reference: "yes") lists every design, document, pull request or issue the question refers to, as full URLs: the dialog shows plain text, and the terminal makes bare URLs clickable.
- `Blocks:` names every backlog item (`S<N>`, `B<N>`, a shared fix `F<n>`) the question holds, IDs separated by commas and nothing else, or `none` (S156: a parallel `/run-backlog` asks the questions that hold the most items first).
- A ratification question names the surface or amendment it ratifies in its question text, so the go-ahead it gets can only mean that one.

**Every blocked item has a question** (owner, 2026-11-20: "I want to stop finding out things are blocked by chance. Pending should never show as empty as long as something is blocked. I can always skip stuff in pending if I don't want to deal with it yet."). Whenever an item parks or its issue is labelled `status:blocked`, its question goes into the file at the same time, with a `Blocks:` line naming it; step 1 backfills any that are missing.

## 1. Read the file, and cover every blocked item

Run `node scripts/backlog-vault/claims.ts questions` (from the main checkout). After the questions it prints `no question: <ID> is blocked` for every story or bug whose issue is labelled `status:blocked` (from the cache `pnpm backlog:sync` writes; read one with `pnpm backlog:search item <ID>`) that no section's `Blocks:` line names, with any local branch whose name holds the ID. For each such line, before asking anything, find out why the item is stuck: its newest checkpoint or its issue's `Notes:` bullet, the local branches the line names (`git log origin/stage..<branch>`: work that was never pushed, such as an owner answer or ratification already committed), and any open pull request. Then write its section, `Blocks:` naming it, asking for what would unblock it. If nothing the owner can answer holds it (the work is done but stranded, or it waits on another item), the section says so and offers the action (land it, or leave it parked) as the options. Commit nothing for this; the file is git-ignored.

Then read `.pending/needs-input.md`. Say "Nothing is waiting for you." and stop only when it has no `##` sections and the command printed no `no question:` line.

## 2. Ask

Each `##` section becomes one question for `AskUserQuestion`:

- `header`: the heading's text before its first `:`, cut to 12 characters if longer (or the first 12 characters of the heading if it has no `:`)
- `question`: the rest of the heading, plus the one most useful line of context if the heading alone can't be answered (the dialog may be all the owner sees), then each of the section's `Links:` on its own line as a bare full URL, with no markdown link syntax
- `options`: the section's `Options:` bullets (label before `—`, description after), then a last option **`Skip for now`** ("Leave this question open; /pending asks it again next time"), so 2 to 4 options in all; the tool adds "Other" for a free-text answer. Never mark an option that ratifies as recommended
- `multiSelect`: false

Ask up to 4 questions per call, most-blocking first (the order of the `N blocked (…)` lines `node scripts/backlog-vault/claims.ts questions` prints: by how many items each section's `Blocks:` line names, then file order), and keep calling until every section has been asked.

## 3. Record

- **Skip for now** (or no answer): leave the section as it is.
- **Any other answer**: the owner's words are the chosen label plus any notes, or their Other text. Quote them verbatim wherever the rules ask for the owner's words (ledger `--answers -`, a RATIFIED file, a story note), written as `chose "<label>"` for an option. Keep its `On answer:` line for step 4, then delete the section from the file. A free-text placeholder option (`Answer in Other`) picked with no Other text counts as no answer.

An option that ratifies (e.g. "Ratify") is an explicit go-ahead for the surface its question names, and only that one; never infer ratification from any other answer.

## 4. Act

Do what each answered section's `On answer:` line says, following `CLAUDE.md` as usual: stories through a fresh `story-worker`, reviews through their fresh-context subagents, and an owner-directed backlog change asks whether it needs a review (add that question to the file rather than asking separately) unless `CLAUDE.md` says otherwise: no question when a review is already due by story count, or when the change answers a pull request's review (always skipped), or when it applies the owner's answers to a review's own questions (logged with `scripts/audit.sh answers`). Push the commits the answers produced, and open any pull request they need, without asking (`CLAUDE.md`, "Push your own work without asking"); ask before a CI/deploy workflow change.

## 5. Report

List what was answered (with the answer), what was skipped, and what you started. New questions raised along the way go into the file, not only into chat.
