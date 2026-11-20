---
name: pending
description: Ask the owner every open question in .pending/needs-input.md with the interactive question tool, letting them skip any, then remove the answered ones and act on each answer. Use when the owner types /pending or asks what is waiting for them.
---

# Pending questions

The owner's idea (2026-11-19): "Could we make something I can run at any time, like /pending or something else similarly named, which will ask me the questions you have with your interactive Q&A thing? I'd need to be able to skip questions."

The questions live in one git-ignored file, `.pending/needs-input.md` (owner, same day: "not a file per question, one file total"). Its header gives the section format. **Whenever you ask the owner anything, add a section there in that format at the same time**, and remove it once it is answered, whether through `/pending` or in chat.

## 1. Read the file

Read `.pending/needs-input.md`. If it is missing or has no `##` sections, say "Nothing is waiting for you." and stop.

## 2. Ask

Each `##` section becomes one question for `AskUserQuestion`:

- `header`: the text before the first `:` in the heading (≤ 12 characters)
- `question`: the rest of the heading, plus the one most useful line of context if the heading alone can't be answered (the dialog may be all the owner sees), then each of the section's `Links:` on its own line as a bare full URL (owner, 2026-11-19, asked whether questions could link to what they reference: "yes"). The dialog renders plain text, so no markdown link syntax: the terminal makes bare URLs clickable
- `options`: the section's `Options:` bullets, label before ` — `, description after, then a last option **`Skip for now`** ("Leave this question open; /pending asks it again next time"). At most 4 options in all, so a section has at most 3 of its own; the tool adds "Other" for a free-text answer
- `multiSelect`: false

Ask up to 4 questions per call, in file order, and keep calling until every section has been asked.

## 3. Record

- **Skip for now** (or no answer): leave the section as it is.
- **Any other answer**: the owner's words are the chosen label plus any notes, or their Other text. Quote them verbatim wherever the rules ask for the owner's words (ledger `--answers -`, a RATIFIED file, a story note), written as `chose "<label>"` for an option. Then delete the section from the file.

An option that ratifies (e.g. "Ratify") is an explicit go-ahead for that surface only; never infer ratification from any other answer.

## 4. Act

Do what each answered section's `On answer:` line says, following `CLAUDE.md` as usual (stories through a fresh `story-worker`, reviews through their fresh-context subagents, owner-directed backlog changes ask whether they need a review: add that question to the file rather than asking separately). Ask before any push.

## 5. Report

List what was answered (with the answer), what was skipped, and what you started. New questions raised along the way go into the file, not only into chat.
