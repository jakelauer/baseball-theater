## 2026-11-21 — backlog review (`amended`)

| | |
|---|---|
| Entry | backlog review pass |
| Captured (UTC) | `2026-11-21T16:02:37Z` |
| HEAD at review | `8f0d253f` (tree dirty) |
| Trigger | turn caps hit (S164, S165); 3 stories done since the last review |
| Stories `done` since last review | S163, S164, S165 |
| In flight | none |
| Verdict | `amended` |

**Findings / amendments**

**Queries**

query: seed backlog --since e7afab69 → S100, S101, S102, S103, S104, S105, S108, S125, S127, S130, S131, S132, S134, S135, S138, S142, S145, S146, S148, S149, S150, S151, S153, S154, S155, S157, S158, S159, S160, S161, S162, S164, S165, S5, S72, S74, S90, S91, S92, S99, (done neighbors and dependencies), #299, B81, S163 and every closed issue (the migration touched all of them)
query: issues --since 2026-11-20T18:15:26-08:00 → every story and bug issue (#133–#299, #87, #81, #74, #73, #72, #71, #48, #40), the migration having updated each (as of 2026-11-21T15:49:29Z)
query: next 3 → S158, S131, S159
query: path scripts/backlog-vault/claims.ts → S156, S158
query: path .claude/skills/run-backlog/SKILL.md → S156, S158, S164, S165
query: neighbors S158 --window 2 → S131, S159
query: dependents S131 → S132, S135
query: deps S159 → S136
query: dependents S159 → S125
query: cites Parallel backlog work → S156, S158
query: path scripts/review-gate.sh → S156, S163
query: path README.md → S9 … S146, S150, S156 (24 items; none todo owns README's backlog paragraph)
query: path docs/v3/VISUAL-DESIGN.md → S2 … S157 (21 items; none todo edits §5)
query: text scheduled row → S107, S108, S125, S135, S162

**Trigger and seed.** Turn caps hit by S164 (cap 44) and S165 (cap 28), each through 4–5 review rounds; 3 stories done since the last review (S163, S164, S165). `scripts/review-debt.sh:44-45` says a turn cap is not detectable there, which is why it printed "not due". 0 items in flight (`claims.ts list` empty). The seed's `adr-changed ADR-014 ADR-016` is S164's link-target edit only (`git diff e7afab69 HEAD -- docs/v3/ARCHITECTURE.md`: three story links made issue URLs, no decision text), already logged as a confident parity skip (`0d9be157`). The 38 `ac-rewritten` events on todo stories (review-debt.sh:205, "rewritten by the migration") were checked AC by AC: each story's AC list at `e7afab69` (its note) against `text-records.ts newest` (awk over the **Acceptance criteria** list). Every difference is the mechanical status AC ("its snapshot records `done` … `story_snapshot_status`"), S5 AC 6's VISUAL-DESIGN link made absolute, or the owner's 2026-11-20 intake answers already logged (`9d1a9046`/`ac785d59`: S108 ACs 2–3 "Status instead", S125 AC 7 reduced motion, S160 AC 1 any letter, S162 inserted). No AC lost or loosened.

**Check 1 — coverage.**
- S163/S164/S165 changed what later stories rely on: (a) a story's status is GitHub's, and every todo story's status AC reads the ship-time snapshot (`scripts/lib/checks.sh:173` `story_snapshot_status`); (b) text changes only through `audit.sh edit|create`, applied after merge; (c) CI's docs and verify jobs now run `pnpm backlog:check --live`, so any open pull request fails on an unlogged issue edit or a label/state mismatch anywhere in the backlog; (d) `claims.ts claim` refuses triage issues and enforces the design gate. Checkpoint graders already on disk for todo stories: only `scripts/verify-S131.sh`, which still reads `docs/v3/BACKLOG.md` (`:249-251`) → amended S131's note (b).
- Doc parity review 2026-11-20 (`20261121T021858Z-parity-review.md:39-42`) queued three items: (1)–(2) VISUAL-DESIGN §5 (`:299`, `:301`, `:561`, `:630`) still says every full row has a slot block and lists "Game status" as an occupant, against A7 and shell-scoreboard `DESIGN.md:40` → neither review may edit VISUAL-DESIGN, so owner question "Visual doc" (blocks nothing). (3) Confirmed: `text scheduled row` reaches S107, S108, S125, S135, S162; only S108 AC 2 (probables in the row body, Room Menu's pre-game links) builds FEATURES' Settings-row scheduled-row sentence, with S161 the data and S162 the Figma component; S125/S135 mention it only for captures.
- Issues: #299 (enhancement, filed from S164's fix worker): the CLI guard `resolve(process.argv[1]) === fileURLToPath(import.meta.url)` is copied in 8 files (claims.ts:935, github.ts:1516, search.ts:945, text-records.ts:717, in-flight.ts:62, areas.ts:262, triage.ts:86, migrate.ts:787). Latent risk: under a symlinked path `claims.ts claim` and `review-edits` exit 0 having done nothing. Not reachable from today's invocations (relative paths from the checkout; worktrees under the repo). With the sync cost (`github.ts:522-525` re-reads each open backlog issue on every incremental sync, ~45 requests, while a full re-list is ~2 pages), owner question "Vault fixes". B81 (p93) unchanged, still fits between S153 and S157. No other open bug.
- Follow-ups with no story or question needed (docs/comments; listed in frame 00 for the next wave-boundary rules pull request): `README.md:526`, `:659` (notes paths); `scripts/review-gate.sh:10` ("committed history only"; review-debt.sh:47-48 also reads the issue cache); `scripts/backlog-vault/doc-index.ts:306` doubling "**S<N>** landed:" (INDEX As of line for S165, history lines for S129, S156); `docs/v3/LOOP.md:17`, `:41` (S158's own follow-up).
- Gap no story owns: a turn cap hit is invisible to `review-debt.sh` (this review's own trigger) → owner question "Turn caps" (fold into S158 if answered before it starts).

**Check 2 — ground truth (next 3).**
- **S158** (p71, depends on nothing): `scripts/backlog-vault/claims.ts` exists, lock `.run/claims.lock` (`claims.ts:665-668`, `withLock`); `in-flight.ts:24` `ITEM_ID = /^[SBFV][0-9]+$/`; `ledger.ts:48-58` `LedgerKind` (completed … snapshot, no `run`), `FRAGMENT_KINDS` `:239`, `FRAGMENT_NAME` `:236` `([A-Za-z0-9]+)` (a run ID with no `-` fits); `merge-safety.test.ts`, `ledger.test.ts`, `claims.test.ts` exist; `runs.ts` absent (the story creates it); `audit.sh` kinds at `:212-221` have no `run`; `story_snapshot_status` at `checks.sh:173`. Drifted references: SKILL.md `:56` → `:54`, `:130` → `:128`, `:17` → `:18`; `S156.md:136-137` retired by S164 (S156's text, #288, notes "Phase 4 is out of scope" / "What no grader can prove") → amended. Fence: all named paths exist; CLAUDE.md 8767 and SKILL.md 5276 words at HEAD for AC 6's +400 guard. Turn cap 22 assumed two review rounds; S163–S165, the same class, needed 4–5 → raised to 30.
- **S131** (p72, depends on nothing): `releases/` absent (created); `isCalendarDate` exists (`packages/domain/src/calendar-date.ts:26`); `parseReleaseVersion`/`currentRelease`/`release:check` absent (created); `deploy.yml` production job `:411`, Release order `:449`, Install `:484`, Build `:506` (AC 4's order is reachable); CLAUDE.md still has "until S131 rewrites this rule (S131 AC 5)". Checkpoint grader reads retired `BACKLOG.md` for check 7 → note (b) amended to the snapshot. A barrier (CLAUDE.md, deploy.yml); S132 opens after it merges (unchanged).
- **S159** (p73, depends on S136 `done`): `dayHasFavoriteTeam` at `schedule-month.ts:89`, used only in `schedule-month.test.ts`; `distinctTeamIds :57`, `monthGameCounts :67`, `ScheduleDayCount.teamIds` comment `:42` (the AC's comment update target) all exist; exported via `index.ts:33`. Cap 4 holds for the code as written.

**Check 2b — adversarial (review-class checklist, LOOP.md §7).**
- **S158** — edge inputs/sequences, ordering and concurrency, stale references, cross-session state: AC 6's "step 0 first merges any open run pull request": a session started minutes after the last run's step 6 opened its run pull request can't merge it (Claude's review and `ci-passed` pending); reading `runs.ts concurrency` on `stage` without it, an unclean run at 3 is missed and two older clean entries at 2 print `3` → amended: start at `C` = 2 while a run pull request is open and unmerged, and say so in the summary. AC 1 concurrent appends under the existing lock: covered by its own test. AC 3/5 table (uncounted between clean runs, unclean at 3 then two clean at 2): consistent. AC 4 REST reads only `pr-open` pull requests; no personal data. AC 7 matches the snapshot helper.
- **S131** — stale references, grader-at-shipping-commit: check 7 against the retired file (above). AC 3's pre-launch exemption and AC 4's job-block grep hold at HEAD. No DB change.
- **S159** — edge inputs against the ratified design: favorites Rays (139) + Yankees (147) in any month before 1998 → every Yankees game day yellow "Off day: Rays" and every other day red; a Yankees-only fan in October after elimination → every postseason day red. A8 (`A8.md:43`) draws only a month where both favorites play → owner question "Off days" (blocks S159, and S125, which depends on it); S159 note added; the coordinator labels S159 `status:blocked`.
- **S164, S165** (rewritten before shipping, both `done`): read against HEAD for what later work leans on; S165 AC 1's CI live check and AC 3's triage are the inputs S158's journal and the review rely on; nothing in them contradicts S158/S131/S159. No further amendment (shipped; their graders are frozen).

**Check 3 — order.** S158 (71) before S131 (72): both barriers, so either order serialises; S158 first stands, since every run before it leaves no record toward `C` = 3. S159 (73) parks on "Off days"; S125 (74) waits on it; next eligible after S131 is S145 (75, S144 done). No story made obsolete by S163–S165; S146 (p118) still the deploy-skip idea and not affected. Underestimation class: S156, S163, S164, S165 (process stories in `scripts/backlog-vault/`) all ran long through review rounds → S158 cap raised and the next review checks whether 30 held.

**Current baseline (rule 17).** S163/S164/S165 rows exist and name things at HEAD (`search.ts`, `live-check.ts`, `triage.ts`, `areas.ts`; `backlog:sync|search|triage|areas` in package.json); each of S163/S164/S165 has its `**Baseline:**` line. S163's row said "Stories still live in the notes until S164" → corrected.

**Duplication sweep (ADR-025).** Code added by S163–S165 (`scripts/backlog-vault/search.ts`, `github.ts`, `live-check.ts`, `triage.ts`, `areas.ts`, `text-records.ts`): duplicated exported function names across them: `main` only (per-file CLIs). Status-label reads: `github.ts:607 statusOf` reads the first; `live-check.ts:110-117` lists all to fail on two (validation, not a second answer). The CLI guard copied in 8 files is the one real duplicate; its fix is #299's, in the "Vault fixes" question. No BT-data value computed outside `packages/domain` (none of these stories touch BT data).

**Personal-data sweep (ADR-028).** S163–S165 add no table, stored-record field, browser key or BT log line; the git-ignored `.backlog-cache/issues.json` holds GitHub issue authors' public logins (developer tooling, not data BT keeps about its users). Next 3: S158 (`.run/run.json`, run fragments: pull request numbers and counts), S131 (`releases/*.json`: the owner's quoted approval), S159 (pure function, favorites passed in, nothing stored). None found.

**Amendments.** S158, S131, S159 text records (`docs/v3/audit/2026-11-21/20261121T160054Z-S158-edit.md`, `…160054Z-S131-edit.md`, `…160055Z-S159-edit.md`), frame 01 (S163 row), frame 00 (Backlog reviews: this review, chores, questions; "notes" → "text" in the beside-the-work paragraph). Proposed to the coordinator: `github.ts status S159 blocked`; `scripts/audit.sh apply` after this pull request merges.
