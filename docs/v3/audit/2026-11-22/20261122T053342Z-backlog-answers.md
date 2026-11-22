## 2026-11-21 — backlog review answers (2026-11-21)

| | |
|---|---|
| Entry | owner's answers to the 2026-11-21 backlog review — part of finishing that review, not new drift |
| Captured (UTC) | `2026-11-22T05:33:42Z` |
| HEAD at capture | `fbdf3985` (tree dirty) |
| Applied in | the commit that adds this entry |

**Answers and what was applied**

Two of the review's questions, asked through /pending on 2026-11-22.

1. "Should #315 (two scripts that silently do nothing when run through a symlinked path) become a story?" The owner chose *"Yes, a small story (Recommended)"*; the option read: *"fix e2e/select-specs.ts:192 and web/src/api/codegen.ts:51 with `import.meta.main`, one line each, with a test"*. Applied: **S169** created ("Two scripts run the same when started through a linked folder"), priority 76.5 (ahead of S130 at 77), **Source:** Feature: Fast PR checks (the selector is that feature's browser-spec picker, S152), fence the two files, their tests and its own records; not a barrier (`is_reviewer_path` lists none of its fence entries). Its pull request also closes #315.
2. The barrier rule. The owner chose *"Don't count them (Recommended)"*: a package's own coverage-floor config, `package.json` and `tsconfig.json` stop making a story a barrier. The rule change itself (`.claude/` and `scripts/`) is left to its own rules pull request. Applied here: the barrier notes the review added to **S159**, **S125** and **S130** now say barrier status follows the run-backlog rule (`.claude/skills/run-backlog/SKILL.md`, step 3.1), quote the answer, and say each is no longer a barrier once that rule lands (until then `claims.ts claim` still flags them). S125 counts as not a barrier because `web/package.json`, which AC 4 edits, is the web package's own `package.json`, read literally from the answer.
