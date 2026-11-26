---
name: verify
description: Prove the Baseball Theater v3 working tree is healthy with a single exit code. Use after any code change, before declaring a story done, and when a loop/goal asks whether the app works.
---

# Verify

## Single gate (required)

```bash
pnpm verify
```

This is the truth signal. Exit code **0** means:

1. ESLint passes for the whole repo (`pnpm build` runs `pnpm lint` first, so it runs once)
2. Typecheck + package builds succeed (each package's `build` runs `tsc --noEmit`)
3. Vitest passes in all packages **with coverage thresholds**

Exit code **non-zero** means the change is not done. Do not claim success.

**One at a time.** `pnpm verify` runs `scripts/with-verify-lock.sh pnpm verify:run`: the gate itself is `verify:run`, and the wrapper holds one lock shared by every worktree of the repository (`<git common dir>/bt-verify.lock`), so parallel workers queue for the gate instead of running three or four at once, which timed tests out (owner, 2026-11-23: "yeah, one at a time lock"). A waiting run prints `verify lock: waiting for the pnpm verify in <worktree> (pid <n>)…`, then `verify lock: acquired after <n> s`; a lock whose holder's pid is gone is taken over. The exit code is the gate's. CI (`GITHUB_ACTIONS`) skips the lock, and `BT_VERIFY_LOCK=0` skips it locally. Inside `scripts/audit.sh story` those lines land in the verify log, so a run that seems slow to start may be waiting its turn. Because the wait counts toward its time, run `pnpm verify` and `scripts/audit.sh story` in the background (`run_in_background: true`) rather than under the Bash tool's 10-minute limit.

The output is kept short to save context (owner, 2026-11-04): tests print a dot each, logs only from failing tests, and coverage as totals per package; a failure still prints in full, and a missed floor names the metric. For the per-file coverage table, run `pnpm --filter <package> exec vitest run --coverage`.

**What `pnpm verify` runs** (ADR-030, S168): the tasks a change reaches, each unit's `lint`, `typecheck`, `test` (with its coverage floors), `build` and `size`, and the root `backlog:check`, `dup:check` and `format:md` tasks, for the files that differ from the merge base with `stage` (committed, uncommitted and untracked alike), their units' dependents and the tasks that name them as inputs, replaying unchanged tasks from the local Turborepo cache, at half the cores. `pnpm verify --full` (or `BT_VERIFY_FULL=1`) executes every task again, reading no cache: `scripts/audit.sh story --reverify` and Deploy's `verify` job use it.
**The finishing gate** (`scripts/audit.sh story`) runs the full graph with the local cache, replaying unchanged tasks (`pnpm verify --all`; owner, 2026-11-26: "Full suite, cached"), and its ledger entry lists the tasks that ran, were replayed and were not affected. Every push to `stage` or `main` runs everything: CI sets `BT_VERIFY_FULL=1` there, so a wrong narrowing or an undeclared input shows on `stage` before it ships.

### What this covers

| Check                    | How                                                                     |
| ------------------------ | ----------------------------------------------------------------------- |
| Lint                     | `pnpm lint` (first step of `pnpm build`)                                |
| Unit / integration tests | each unit's `test` task (coverage and its floors), in Turborepo's graph |
| Coverage floors          | Per-package Vitest thresholds                                           |
| Types + production build | `pnpm build`                                                            |
| HTTP schedule/game smoke | Covered by `functions/src/handlers/api.test.ts` (fixture API)           |

### What this does **not** cover yet

- Visual pitch-animation correctness (manual / future Playwright)
- Cloudflare Workers runtime, Postgres, and Logto adapters (not wired yet; ADR-017–019)
- Live MLB network calls (fixtures only by default)
- Deployed Hosting/Functions health

When a story needs a check beyond `pnpm verify`, add a **named test or script** and put that command in the story’s acceptance criteria. Do not rely on “looks right.”

## Faster local loops (optional)

While iterating inside one package:

```bash
pnpm --filter @bt/domain test
pnpm --filter @bt/functions test
pnpm --filter @bt/web test
pnpm lint
```

Still run **`pnpm verify`** before marking a goal/story complete.

When finishing a backlog story, also add its one-paragraph `**Baseline:**` line with `scripts/audit.sh edit <ID>` (rule 17), write its changelog fragment `changelog.d/<ID>.md` (rule 16), and run `scripts/audit.sh story <ID>`, which records the ship-time snapshot (`done`) before it runs the grader and `pnpm verify` (rule 5; GitHub's `status:done` follows after the merge), then commit the records and the fragment with the code. Verify alone is not enough if the text records are inconsistent — `pnpm verify` itself runs `pnpm backlog:check`, which checks them.

## Capture the run (required to call a story done)

`pnpm verify` prints and forgets. Before committing a finished story, capture the story's grader run and the verify run into the ledger:

```bash
scripts/audit.sh story S14
```

This runs `scripts/verify-S14.sh` and `pnpm verify` for real, writes a new ledger fragment, `docs/v3/audit/<YYYY-MM-DD>/<stamp>-<ID>-completed.md` (never appending to the frozen `docs/v3/AUDIT.md`), listing every check the grader performed with its PASS/FAIL, and prints a summary block for the commit body. Commit the ledger entry **with** the story's code — the entry says the story shipped in "the commit that adds this entry" (`shipping_commit` finds it by the commit that added the fragment), which is only true if they land together.

Never hand-write a ledger entry. A hand-written entry is indistinguishable from a fabricated one, which is the whole thing the file exists to rule out.

**A grader is a commit-time proof of its own story** (S84): it is expected to pass against the code as of its story's commit, not forever. To re-check a shipped story, `scripts/audit.sh story <ID> --reverify` runs today's grader in a worktree at the story's shipping commit. What must hold on every commit is a law in `docs/v3/LAWS.md`, and `pnpm verify` — this skill's gate — is what enforces it.

Do **not** start another backlog story or `/goal` while the finished story’s changes are still uncommitted — commit first.

## Recipe maintenance

If you discover a new way a change can be “green” on verify but wrong in the product, add:

1. An automated test that fails for that case, **or**
2. A script invoked from `pnpm verify` / story AC

Then update this file with the new step.
