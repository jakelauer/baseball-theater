# Changelog fragments

One file per finished backlog item, `changelog.d/<ID>.md` (S156; backlog rule 16). Nothing per story edits `CHANGELOG.md`: `pnpm changelog:build` assembles it from these files once per release (`.claude/skills/release/SKILL.md`, the release rule's step 4), newest first and grouped by effort, above the history it keeps whole. The format and the assembler are `scripts/backlog-vault/changelog.ts`.

```markdown
---
effort: <the bold effort header it nests under, or none>
title: <optional: the header of a standalone (effort: none) entry>
---

- **Before, …. Now, ….** … Details: **S<N>** — ….
```

A story with nothing a reader outside the team would call an outcome records its skip here instead: `skip: <why>` in the frontmatter and no body.
