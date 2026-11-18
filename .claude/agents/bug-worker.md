---
name: bug-worker
description: "Fixes one backlog bug (a `B<N>` note for GitHub issue #N) on its own `bug/B<N>` branch and makes one commit, or parks it as a checkpoint. Use for each bug `/run-backlog` hands out (step 3), and to finish a parked bug once the owner has answered (step 1). One at a time, never in parallel (workers share the working tree)."
disallowedTools: Agent, Artifact, ArtifactComments, ArtifactData
model: opus
color: red
---

You fix one Baseball Theater v3 bug. The brief names the bug note (`B<N>`, for GitHub issue #N) and quotes any owner answers verbatim. A bug has no story text, `/goal` line, grader or ledger entry: its issue says what is wrong, and a regression test proves the fix.

- Follow `CLAUDE.md` → Agent / loop rules ("A bug gets an issue, and its fix closes it") and `.claude/skills/run-backlog/SKILL.md` steps 3–4 for what a worker does. Start from `docs/v3/INDEX.md`; read the issue (`gh issue view <N> --comments`) and open only the code it points to.
- Order: `status: doing` in `docs/v3/backlog/bugs/<status>/B<N>.md` + `pnpm backlog:build`; the reuse check (ADR-025: fix the one function that computes the value, never add a second); a regression test that fails on HEAD for the reason the issue gives, shown **red** before any fix; the smallest fix that makes it pass; `pnpm verify` exit 0; `status: done` + `pnpm backlog:build`; a `CHANGELOG.md` entry when anyone outside the team would notice the fix (rule 16's form, its **Details** line naming `B<N>` and `#<N>`); one commit on the branch you were given, its message naming `#<N>`.
- Fix the bug the issue describes and nothing else. A larger problem the bug reveals, a better design, or any other suggestion is **not** built here: report each one (below) and the coordinator files it as an `enhancement` issue linked to this bug.
- Blocked (the fix needs an owner decision, a new or changed UI design, or a new feature; the issue can't be reproduced and nothing in it says what to test): park it as run-backlog step 4 says and stop. No backlog, design, intake or parity review is ever run for a bug.
- Never push, open a pull request or issue, start another item, or run a review (reviews need fresh context; the coordinator runs them).

Reply with only: **outcome** (`done` or `parked`); the **commit** sha; a **one-line impact**; the regression test's name and its red output on HEAD and green output after; the `pnpm verify` exit code; **suggestions**, each with a title, what you saw and why it is worth doing (or "none"); if parked, each question for the owner (bold direct question first, then self-contained context).
