## 2026-11-20 — backlog review (`amended`)

| | |
|---|---|
| Entry | backlog review pass |
| Captured (UTC) | `2026-11-20T20:06:35Z` |
| HEAD at review | `3622e447` (tree dirty) |
| Trigger | design intake: ADR-014/016 link repoint (S156); shell-scoreboard A12 (no prior intake); S156 inserted outside a review; story ACs repointed off BACKLOG.md (mechanical) |
| Stories `done` since last review | S152, S156 |
| In flight | none |
| Verdict | `amended` |

**Findings / amendments**

Design intake and backlog review, merged from two independent fresh-context reviewers (read-only, at `ba4191f4`; the merge applied at `3622e447`, which adds only the 2026-11-20 doc parity review, PR #119, verdict continue). Bugs and open GitHub issues are in scope (owner, 2026-11-20: "backlog reviews need to include bugs/issues, not just stories"). Nothing in flight (`.run/claims/` empty; `claims.ts review-edits` exit 0).

## What triggered it, checked
- `pnpm review:debt`: a frontend ADR changed in ARCHITECTURE.md, S156 inserted outside a review, and ~147 notes' "acceptance criteria rewritten". Both reviewers checked these independently: the ADR change is three link targets (ARCHITECTURE.md ~897, ~903, ~1048: ADR-014's response aliases and ADR-016's sequencing, `./BACKLOG.md#s26/#s29/#s25` -> `./backlog/stories/done/S26.md`, `S29.md`, `S25.md`), no decision changed; every todo/blocked note diffed 0b88ca1d..HEAD and normalised for S156's mechanical repoint (`docs/v3/BACKLOG.md` out of fences, `/goal docs/v3/BACKLOG.md S<N>.` -> `/goal S<N> (docs/v3/backlog/stories/<status>/S<N>.md).`, the status AC reworded to the note's frontmatter, `order:` shifts) leaves no residue (reviewer 2 also compared all 456 Scope/Goal/goal lines pairwise: 0 differ; the merger's own filtered `git diff -U0` leaves only S152's move to done). No Gap, Impact, Depends, Design or Source line changed. S156's insertion had a logged skip (`8051c3b4`) before its note's later edits.
- Done since the last review: S152, S156 (2 of 6).

## Design intake
- Surfaces: ratified game-rooms A1-A7, game-shell A1-A6, shell-scoreboard A1-A6 and A10-A14, standings-search-settings A1-A9. Drafts (not decisions): shell-scoreboard A7, A8, A9, whose design stories S107, S123, S133 are blocked. `git diff --stat 0b88ca1d HEAD -- docs/v3/visual docs/v3/VISUAL-DESIGN.md` is empty; no `web/src` change since.
- **A12 (the account menu) never had an intake** (found by reviewer 2 only; verified by the merger). Ratified in `240568ef` (owner: "Ratify"); `git merge-base --is-ancestor 240568ef` is false for c7731fc, 351d191 and ebbb4f6 (the 2026-11-19 review commits) and true for `0b88ca1d`, a merge ("Merge stage into story/S141") that review-debt.sh takes as the last review point, so the script never flagged it; no ledger entry reviews A12 (AUDIT.md's A12 hits are S144 grader lines and a note that A12 was ratified on `stage`). Taken in here:
  - Inventory: frames `account-menu-mobile.png`, `account-menu-desktop.png` (medium = the mobile header at medium width, per A12); Figma component `account-menu` 658:21746 with `menu-item-Settings` 658:21747 and `menu-item-Sign out` 658:21752, section 658:19927. States: signed in with the menu open; signed out "Sign in" and "Signing in..." (A2, #58); session loading, no control. Interactions: opens on press; closes on pick, Escape or outside press; Settings -> `/settings`; Sign out signs out in place. Data: the session only, no new domain value or route.
  - Ownership: owned by shipped code, needs no story: PR #58 built it (v3.2.1), and A12 says it "draws what was built". `web/src/layout/AppHeader.tsx:85-103` (`Menu position="bottom-end" width={180}`, Settings -> `/settings`, Sign out -> `session.signOut`); tests `AppHeader.test.tsx:238-258` (menu, Sign out), `:115-226` (Signing in...). Counts: 1 component, 4 states, 0 unowned, 0 re-scoped. One component in Figma and in code (inside AppHeader), so ADR-025 holds.
  - Caution recorded in frame 00: A12's frames copy A2's and A11's, so they also show inherited state (a pre-game win-probability bar that S107 AC 1 repeals, A14's footer, A13's "Live Data - Active" strip). A12 adds only the menu; S107, S108, S142, S148, S154 never read A12's PNGs as ratifying anything else.
- Figma (reviewer 1, `get_metadata` on the Components page 635:22633): every shared component a ratified amendment draws has one building story, none duplicated: `site-footer` 705:23532 -> S142; `play-inning-pill` 724:10189 and `video-meta` 724:10197 -> S145 (S153 reuses them, S145 AC 5); `changelog-link`, `after-update-pointer` and the Change log page belong to the A9 draft (S133, blocked).
- Frontend ADRs 003/008/014/016/023-026: no substantive change, so no new shared-layer or derivation work. Ownership map: unchanged from the A14/A6 intakes plus A12 (owned by shipped code). New design-driven stories: none.

## Next 3 (check 2) and the adversarial pass (check 2b)
Next by priority at HEAD: S131 (72), S125 (74, waits on blocked S123, not startable), S145 (75), S155 (76).
- **S131** (no dependencies). Checklist items applied: contradiction with a shipped rule; stale source after a retirement; grader reading a removed file; fence vs records written at finish; sequencing with reviewer paths. Breaks found:
  - AC 5 drafted "from the milestone's merged pull requests' `CHANGELOG.md` entries"; since S156 a story never edits CHANGELOG.md (frame 00 rule 16), and CLAUDE.md's release step (4) now runs `pnpm changelog:build` on the release commit's tree and drafts "from the `changelog.d/` fragments of the milestone's pull requests". Breaking input: an implementer rewriting step (4) to AC 5's old text drafts from a CHANGELOG.md that doesn't hold the milestone's entries, or deletes S156's `changelog:build` sentence; S156's grader is frozen and no law catches it. S156's own note (S156.md:142) asks this review to fix it. Amended: AC 5 now drafts from the `changelog.d/` fragments and says the rule keeps step (4)'s `pnpm changelog:build` run. Not loosened: every clause AC 5 required stays, and the grader's check 5 keeps `CHANGELOG.md` and adds `changelog.d/` and `pnpm changelog:build` (note).
  - Grader `scripts/verify-S131.sh` check 7 (`:249-251`) reads the retired `docs/v3/BACKLOG.md`, so it fails even when done; its fence regex (`:253`) rejects the story's own `docs/v3/audit/<date>/...-S131-...md` and `changelog.d/S131.md` (rule 13, Verify-script contract allow them). Recorded in the note as rule-7 updates, shown red first, beside the existing check 6 update.
  - Scheduling: fence reaches `.github/workflows/deploy.yml`, `CLAUDE.md`, `package.json`, so it is a barrier item (S156 AC 12); S132 depends on S131 (`depends_on: [[S131]]`) and S131 changes `CLAUDE.md`, a reviewer path, so S132 opens only after S131 merges. Recorded in the note.
  - Holds: deploy.yml's production job still has Install (:484) before "Build the web app" (:506), so AC 4 is satisfiable.
- **S145** (S97, S81, S144 done). Items applied: stale line citations; caller search; test that a change must keep. AC 4 cited `e2e/design/S97.spec.ts:63,71,88`; the `play-link`/`player-play-link` waits are at `:64,72,89` (the spec gained one line in S156's e2e edit). Found by reviewer 2 only; verified (`grep -n "play-link" e2e/design/S97.spec.ts`). Corrected, reference only. Every other citation holds: `inning.ts:17,44`, `playLink.ts:22` (the only non-test caller of `atBatInningLabel`), `PlaysPanel.tsx:51-54`, `VideosRoom.test.tsx:79`, `VideoPlayLinks.test.tsx:45,93,127`.
- **S155** (S139 done). Items applied: stale citations; null/no-calendar branch. AC 3 cited `season-calendar.ts:27`; the `springStartDate` null return is at `:65`. Both reviewers found it; corrected, reference only. Other citations hold (`recorder.ts:229-233`, `fixture-client.ts` fetchStandings, `standings.ts:56-66`, `DivisionTable.tsx:30`, `StandingsPage.tsx:45`, `bundled.ts`).
- **S156** (inserted since the last review; shipped, grader frozen). AC 9 exempts every `scripts/verify-*.sh` from the BACKLOG.md grep, but five unshipped checkpoint graders still read it: S107 (`:161-165`), S123 (`:273-277`), S129 (`:364-377`), S131, S133 (`:523-536`); S129's and S133's fences also reject the story's own records. Rule 13 says so generally; each note now says it concretely. AC 7: the generated As of line reads "**S156** landed: **S156** landed: ..." because `doc-index.ts:278` writes `landed: ${text}` and S156's `**Baseline:**` line itself starts "**S156** landed:"; rule 17 now says the line starts with what changed. No break found for ACs 2, 5, 6, 8, 10-15 (ledger fragments exist under `docs/v3/audit/2026-11-20/`; `maxWorkers` capped at 4 in `web/vitest.config.ts:17` and `functions/vitest.config.ts:23`).

## Order (check 3)
The order stands. S131 heads S131 -> S132 -> S134 -> S135, which S142 and S154 also wait on, and the owner asked for it "asap". S125, S130, S138 wait on blocked S123/S129; seven todo stories wait behind S123, S129, S133, whose redraws sit on local-only branches: the highest-leverage step is the owner ratifying those, not a reorder. S131 runs alone (barrier), then S145 and S155 together.

## Baseline (rule 17)
`frame/01 Current baseline.md` "Representative local dev" row gains S156's per-worktree ports (`scripts/worktree-for.sh`, `.env.worktree`: BT_API_PORT, BT_WEB_PORT, BT_PG_PORT, PGLITE_PORT, COMPOSE_PROJECT_NAME; defaults :8787/:5173/:5432 from `functions/package.json`, `compose.yaml:16`, `e2e/playwright.config.ts:17`). S152's row exists.

## Duplication sweep (ADR-025)
Code S152 and S156 added is tooling (scripts/, CI, vitest and vite configs, e2e one-liners); `git diff 0b88ca1d HEAD -- packages functions/src web/src` adds no derived BT value. One repeat: the worker cap `Math.min(4, Math.max(availableParallelism() - 1, 1))` is written in both `web/vitest.config.ts:17` and `functions/vitest.config.ts:23` (pinned by `scripts/backlog-vault/test-load.test.ts`); tooling config, not BT data, so no amendment; and the root `vitest.config.ts` has none (S156.md:145), proposed as an enhancement below.

## Personal-data sweep (ADR-028)
S152 and S156 add no table, stored field, outside service, browser key or personal log line (`.env.worktree` holds ports and a Compose project name; the diff adds no `console.*` in functions/src, web/src or packages). The next 3: S131 adds `releases/*.json` with the owner's approval quote (no user data); S145 and S155 add none.

## Bugs and open issues
No open bug notes (B40, B48, B74, B87 done); `gh issue list --label bug --state open` is empty; 11 open issues, all `enhancement`. Proposals (this review changes no issue):
- #80 (forfeit Q/R not final, `packages/domain/src/window.ts:56`, Q/R -> `U` at :72-79): both reviewers judge it a latent user-visible bug. Bug note only if the owner agrees; priority below.
- #79 (suspended T/U -> `U`): the look is a product choice; the owner question already filed covers it.
- #81: a guard test, pairs with #80; enters only as a story if the owner asks.
- #116: fixed on stage by S156 (`92c82ba1`, `44fc8187`, "record two concurrent pnpm verify runs passing (#116 fixed)"); open only because #117 said "Fixes #110". Propose close.
- #83: partly addressed by `92c82ba1` (`settings.test.ts` listens on 127.0.0.1, workers capped, hookTimeout 20 s); its comment's LiveRoom render-count flake is unexplained. Owner question.
- #85: staging half resolved (Deploy for ba4191f4 ran "Migrate the staging database: success" after B48); production half open until v3.3.0's deploy. Propose milestone v3.3.0, scoped to production.
- #84: point 1 (AUDIT.md re-parse) superseded by S156's fragment-first `ledgerBase` (`ledger.ts:445-457`); points 2-3 still apply (the `merge` helper's bare `catch` at `ledger.test.ts:340` swallows every error). Propose keep, narrowed to points 2-3.
- #103: latent first-sign-in race (`repos.ts:292-296`, no FK in `schema.ts:76-85`); owner question.
- #109: answered by the Verify-script contract line this review adds; propose close.
- #86, #108: keep.
- New enhancement proposals: strip a leading "**S<N>** landed:" in `scripts/backlog-vault/doc-index.ts:278`; S156.md:145's leftovers (root `vitest.config.ts` `maxWorkers`, `DEFAULT_APP_ORIGIN` fixed at :5173, empty `BT_API_PORT` -> port 0 in `local-server.ts:24`); the dead `(#verify-script-contract)` anchor in every story note (36 open, 117 done).

## Disagreements and resolution
1. **A12 intake** (reviewer 2 only): verified; taken in, owned by shipped code, no story, no owner question needed (A12's own text says it draws what #58 built and the owner ratified it so).
2. **S145's S97.spec.ts lines** (reviewer 2 only): verified; corrected.
3. **#80 priority** (72.5 vs 93): no bug note is written here (the owner hasn't agreed to treat it as a bug). Recommendation to the owner: 93, before S74. Never observed, MLB forfeits are vanishingly rare, and it's the off-season, so placing it before S125/S145/S155 buys nothing; it still lands well before the season.
4. **S131 AC 5 wording**: reviewer 1 kept `CHANGELOG.md` as the source with fragments as an alternative; reviewer 2 named the fragments. Taken: the fragments as the source (CLAUDE.md step (4)'s wording), plus reviewer 1's "keeping step (4)'s `pnpm changelog:build`" clause; grader check 5 keeps `CHANGELOG.md` and adds both new phrases, so nothing is loosened.
5. **#79**: reviewer 1 would label it a bug, blocked on the look; reviewer 2 keeps it an enhancement until the owner decides. Left to the owner question already filed.
6. **#83**: reviewer 1 close; reviewer 2 close or B83 at 72.5. Owner question (recommend close, reopen on recurrence: a flake gives no red-first test).
7. **#84**: reviewer 1 close as superseded; reviewer 2 keep. Verified point 2 still holds: keep, narrowed.
8. **#109 contract line** (reviewer 1 firm, reviewer 2 optional): added.
9. **Dead `#verify-script-contract` links** (reviewer 2, optional): not applied. No note links a frame note today, 117 done notes carry the same link, and workers find the contract through INDEX; proposed as a build-tool enhancement instead.
10. **Rule 17 and baseline row** (reviewer 1 only): applied.

## For the parity review
Nothing new: no story inserted or removed and no Source line changed. FEATURES' Update / change log UX row does not name CHANGELOG.md as the draft source (checked), so S131 AC 5's rewording leaves it accurate.

## Owner questions
1. Folded into the filed #79/#80/#81 question: whether #80 is tracked as a bug (B80 at priority 93, before S74) rather than a story; whether a suspended game gets its own look (a design story first) or reads as live/delayed with no new design; and whether ingest keeps polling a suspended game until it resumes.
2. May #116 and #83 be closed, citing S156's `92c82ba1`/`44fc8187`, to reopen if a flake recurs?
3. Should #103 (two tabs signing in at once can leave an empty, unreachable account) be a bug fixed before launch, or stay a low-priority enhancement?
