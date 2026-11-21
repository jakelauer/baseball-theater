# Agent instructions

Primary conventions live in [CLAUDE.md](./CLAUDE.md).

- Verify: `pnpm verify` (see `.claude/skills/verify/SKILL.md`)
- Stories: one note each, `docs/v3/backlog/stories/<status>/S<N>.md`, found through `docs/v3/INDEX.md` (`pnpm backlog:build` writes it) — flip `status` to `doing` / `done` with the implementation; commit before starting the next story
- Backlog review: due every **6** `done` stories or on any drift event — see `.claude/skills/backlog-review/SKILL.md` and the **Backlog reviews** section of frame note 00 in `docs/v3/backlog/frame/`. Fresh context required; `blocked` means stop and ask
- Loop process: `docs/v3/LOOP.md`
- Boundaries: `.cursor/rules/agent-boundaries.mdc` and `.claude/settings.json`
