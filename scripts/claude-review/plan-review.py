#!/usr/bin/env python3
"""Path classes the review and run machinery share: `is_reviewer_path` and `is_sensitive`.

This file once planned Claude's pull request review (.github/workflows/claude-review.yml: its mode, model
and turns). The owner retired that review on 2026-11-26 (asked whether a pull request review is worth
running when the pre-PR review already runs: "I'm thinking we should ditch the PR review because it's
just wasting tokens at this point. And we should make the adjustments to the pre-PR review that you're
talking about."), so the workflow and everything that served it alone are gone. Two path classes stay,
since other code and rules still use them; the file keeps its name because they import it by path:

- `is_reviewer_path`: CI and deploy machinery: workflows, scripts/, functions/src/scripts/, the deploy
  code, tools/, every package.json, tsconfig and `*.config.*` file at any depth, and the root
  duplication, size and Lighthouse configs. A change there alters what builds, tests, deploys or runs
  the backlog for every other item, so `/run-backlog` makes an item that reaches one a barrier
  (`scripts/backlog-vault/claims.ts` `isBarrierPath` calls this function; its SKILL, step 3.1), and a
  branch stacked on one waits for it to merge (docs/v3/LOOP.md §9). A story or bug grader
  (`scripts/verify-S<N>.sh`, `-B<N>`, `-V<N>`; `GRADER_RE`) is not on it (S156 AC 2): no workflow runs
  one (law L12, `scripts/backlog-vault/grader-ci-law.test.ts`), so it changes nothing another item runs.
- `is_sensitive`: auth, sessions, migrations, deploys: docs/v3/LOOP.md §7 step 2 picks Opus for the
  local pre-PR reviewers of a diff that touches one, and Sonnet otherwise.

Tested by test_plan_review.py (run by scripts/backlog-vault/plan-review.test.ts in `pnpm verify`).
"""

import re

SENSITIVE_PREFIXES = (".github/", ".claude/settings.json", ".cursor/", "scripts/claude-review/", "functions/src/deploy/", "wrangler.jsonc", "web/src/session/")
SENSITIVE_WORDS = re.compile(r"(^|[/_.-])(auth|oauth|session|sessions|logto|migrations|secret|secrets|account|accounts)([/_.-]|$)", re.I)
# CI and deploy machinery (see the docstring): a barrier for /run-backlog.
REVIEWER_PATHS = (".github/", ".claude/settings.json", ".cursor/", ".husky/", "scripts/", "functions/src/scripts/", "functions/src/deploy/",
                  "tools/", "wrangler.jsonc", "pnpm-workspace.yaml", "eslint.config.js", "tsconfig.base.json", ".jscpd.json", ".size-limit.json",
                  "lighthouserc.json", ".nvmrc")
# At any depth: `pnpm` runs each package.json's scripts, and every `*.config.*` (vitest, Playwright, Vite,
# PostCSS, ESLint, Drizzle) and tsconfig is loaded or run by a build, a test run or a deploy.
REVIEWER_NAMES = re.compile(r"(^|/)(package\.json|tsconfig[a-z.]*\.json|[a-z.-]+\.config\.[a-z]+)$")
# A story's, bug's or vault migration's grader: only `scripts/audit.sh` runs one, locally (law L12).
GRADER_RE = re.compile(r"^scripts/verify-[SBV][0-9]+\.sh$")


def is_sensitive(path: str) -> bool:
    """Auth, sessions, migrations, deploys: LOOP.md §7 gives the local pre-PR reviewers Opus for these."""
    return path.startswith(SENSITIVE_PREFIXES) or bool(SENSITIVE_WORDS.search(path))


def is_reviewer_path(path: str) -> bool:
    """CI and deploy machinery (the docstring's list): REVIEWER_PATHS, or REVIEWER_NAMES at any depth,
    except a grader (GRADER_RE), which no workflow runs (law L12)."""
    if GRADER_RE.fullmatch(path):
        return False
    return path.startswith(REVIEWER_PATHS) or bool(REVIEWER_NAMES.search(path))
