## 2026-11-23 — backlog review (`amended`)

| | |
|---|---|
| Entry | backlog review pass |
| Captured (UTC) | `2026-11-24T04:05:41Z` |
| HEAD at review | `3eb722b7` (tree dirty) |
| Trigger | drift: S150's acceptance criteria rewritten (2 of 6 done since) |
| Stories `done` since last review | S175, S150 |
| In flight | B412, B413, B414, S72, S74, S138, S154, S170, S172, S191, S192, S194 |
| Turn-cap hits read | none |
| Verdict | `amended` |

**Findings / amendments**

**Queries**

query: seed backlog --since a9ba1995 → S150, S193, S149, S153, S161, S135, S134, S81, B430, B431, S148, S173, S5, S145, S172, S90, S108, S194, #439, S176, S177, S178, B481, S195–S211 (and their closed duplicates #446–#478), #435, B412–B434, B410, B408, #405, #404, #403, B399, B394, #386, #385, S192, S191, S190–S179, S175, S174, B359, S171, S170, #347, #340, S169, S159, S157, S154, S142, S138, S125, S102, S99, S92, S91, S74, S72
query: issues --since 2026-11-22T20:22:44.000Z → #481 … #204 (as of 2026-11-24T03:55:06.000Z); created since the last review (00:34Z): #481 only
query: item S193, S149, S153, S150, S161, S108, S90, S194, S191 (text-records.ts newest)
query: item S147, S148, S150, S135, S134, S81, S192, S5, S145, S172, S205, S206, S207 (dependency statuses)

**Scope.** The previous review (`a9ba1995`, 2026-11-24 00:34Z) read the next 3 stories and every story S194–S211 in full. What changed since: S150 shipped (its ACs rewritten to answer its change reviews, `20261123T233139Z-S150-edit.md`, skipped at `c744d38e` but still drift since the base `b83bc4e2`), S175 shipped, ADR-007 gained the owner's AI answers (skipped at `5639869a`), and B481 was filed and fixed. This review re-checks the next 3 against S150's code at HEAD `3eb722b7` and every item that builds on S150.

**Check 1 — coverage**
- S150's dependents: S149 (below), S161 (stores the win-probability line on the `game_states` row, `schema.ts:40–47`, and names the line as the second exception to S150's single-writer grep; consistent with `switchGameState` at `game-state.ts:130`), S108 (waits behind S150 and S161), S90 (only quotes the owner's answer naming S150), S194 (in flight; calls `storeSchedule` without changing it). No gap.
- ADR-007's change: the skip entry `20261124T010721Z` copies answers S176 and S178 already carry; S176–S178 cite ADR-007 and sit at p122–124. No new work.
- Bugs and issues: one arrived since the last review, B481 (#481, accepted at 67.9, closed `done`); nothing to place. **B408** (Hyperdrive query caching on for `bt-staging` and `bt-production`, `functions/src/deploy/bootstrap.ts:241-247`) is still open with no fields block; S150 has now merged, so staging's version-guarded `game_states` writes read through the 60 s cache: for the coordinator to accept at about p68.2. The closed duplicate issues #446–#478 still carry `story` and `status:todo` labels (for the coordinator). #439 (a resumed suspended game on its original day) stays an enhancement; S150 AC 4 names it as the one unsettled case.
- The last parity review (`20261124T004216Z`) queued nothing new for this review beyond what the first 2026-11-24 review answered.

**Check 2 — ground truth (next 3 by priority)**
- **S193** (p82.6): unchanged since the last review. Depends S135 done, S134 done, S81 done; Design S192 `blocked` (in flight, `.pending/` "S192 ratify"). Cannot start until S192 is done. Paths (`web/src/pwa/`, `web/src/layout/NoticeSlot.tsx`, `e2e/flows/`, `e2e/design/`) exist (last review, unchanged since: no `web/src` change in `a9ba1995..HEAD`). Cap 8 holds.
- **S149** (p84): now the first startable story. Depends S150 done, S81 done; Design S147 done; prefer S148 done; issue #73 closed 2026-11-17. At HEAD: `readScheduleDay` (`functions/src/services/game-state.ts:262`, read-only, no MLB port in its deps), `scheduleDayWindowMode` (`:251`), `switchGameState` (`:130`, returns `Map<number, SwitchOutcome>`), `served_base` (`schema.ts:31`), the four `storeSchedule` call sites (`ingest.ts:221`, `ingest.ts:391`, `schedule-month.ts:137`, `backfill.ts:263`), `scheduleWindowMode` (`window.ts:212`), `isGameInActiveWindow` (`:161`), `DEFAULT_CADENCE` (`:32`), `STREAMING_ROUTE_EXCEPTIONS`/`API_ROUTER` (`api.ts:235`, `:253`), `writeScheduleDay` (`web/src/api/schedule.ts:38`), `LiveMarker.tsx` (exists, so AC 7/8 take the "exists" branch; `ScoreboardPage.test.tsx:403` holds S148's no-`useLiveDay` case), `e2e/design/S19.spec.ts`, `wrangler.jsonc` migrations v1, v2 (so v3 is next). **Amended** (2b).
- **S153** (p91): unchanged since the last review; depends S5, S145, S81 done, S172 `blocked` (in flight, design match). No code it touches changed since (`a9ba1995..HEAD` touches no `functions/src/mappers/search.ts`, `web/src/components/videos/`, `fixtures/search-*`). Cap 11 holds.

**Check 2b — adversarial pass**
- **S149** (next 3; its dependency S150 rewritten). Items applied: 4 (real source of truth), 5 (unsettled states), 7/db-reviewer (query pattern and index), 11 (contradictions), 18, 19 (splices), 30 (removing a thing).
  - **AC 2, db-reviewer / item 4: broken.** It required the writer to call "every date whose stored day lists the game (a suspended game's two days)" on a game's state change. `schedule_days` is keyed by `date` alone with its games inside a JSONB document and no index into it (`schema.ts:28–32`; only `games` has a GIN), so the only way to find those days is reading every stored day (thousands after backfill), on every state change of a live game, every poll. Breaking sequence: a game is live, its ingest polls every few seconds, each changed state runs a full scan of `schedule_days`. Amended: the ingest object publishes a mend (row changed, snapshot unchanged) to its registered hubs as it publishes a changed game, so every day hub watching the game, a suspended game's original day included (registered when its viewer connected, since the joined day shows the game live), gets it through its lease; a schedule write calls only the date it writes and the game's `game_states` official date before and after; nothing queries `schedule_days` by gamePk. Two unit tests added.
  - **AC 2 and AC 5, item 5 and ADR-025: broken.** They judged "the day has a game in its window" with `scheduleWindowMode` on the day's games, but since S150 every stored and served day's `windowMode` comes from `scheduleDayWindowMode` (`game-state.ts:251`), which adds a suspended game's `suspendedAt` (#323, `withSuspendedAt`). Breaking sequence: first pitch 19:05, suspended at 23:50 (BT saw it); `isGameInActiveWindow` keeps it in window to 05:50 with `suspendedAt` but only to 01:05 (first pitch + `suspendedHours`) without; from 01:05 to 05:50 the served day says `active` while the route refuses the upgrade and the writer skips the hub call. Amended: both use `scheduleDayWindowMode`; a note records that the client (AC 6), which has no `suspendedAt` on the wire, keeps `scheduleWindowMode` and polls with no marker in that rare gap.
  - **Goal condition vs `/goal` line, item 11:** the Goal condition forbade every change under `scripts/` while the `/goal` line allows creating `scripts/verify-S149.sh`; now they match.
  - AC 3 (`readScheduleDay` reads only), AC 4 (served version only rises: `ingest.ts:143`, `served_base`), AC 6, AC 7 (`LiveMarker` exists): checked, no break. Item 30: the removed "every date whose stored day lists the game" clause is required by no other AC or note.
- **S153, S193**: re-checked only against what changed since the last review's 2b pass (nothing they touch); no break.
- **S150** (rewritten, now `done`): its grader is frozen; its rewritten AC 4 (another day's listing) and AC 6 were read for what they promise dependents: S149 AC 4's "served version only rises" and S161's row both hold at HEAD.

**Check 3 — order**
- S149 is now the first `todo` story free to start (S193 waits on S192's ratification, S153 on S172), ahead of S99 (105), which the last review named. No reason to reorder: S149 (p84) sits after the in-flight work and the walkthrough bugs (B415–B434 at 72.05–72.45), and its cost didn't grow (cap stays 20).
- Triage: B481 is the only item that arrived since the last review; it is `done`. The "Box order" question (S205–S207) is still open in `.pending/`; no new question.
- Current baseline: S150's and S175's rows and `**Baseline:**` lines are in (`01 Current baseline.md`, the **As of** line names S150 at `3eb722b7`).

**Duplication sweep (ADR-025)** over S150's and S175's code (`a9ba1995..HEAD`, 75 files): `rg` for batter/pitcher name derivation (`nameIn` in `packages/domain/src/game-state.ts:114` is the only lookup over mapped plays; `mappers/live.ts:336` and `mappers/schedule.ts:168` map raw MLB fields), window judgement (`scheduleDayWindowMode` wraps the domain's `scheduleWindowMode`, one implementation), and S175's empty-standings check (`standingsHasNoTeams`, the domain's). None found; the one divergence risk (S149 calling the unwrapped function) is amended above.

**Personal-data sweep (ADR-028)**: `game_states` is in the classification manifest as `none` (`data-classification.ts:131`); no `console.*`/logger line and no browser key added in `a9ba1995..HEAD`; no `web/src` change. S149's day hub stores no viewer data beyond the hibernated socket (as the game hub), S193 reuses S135's `bt.lastRelease`, S153 adds game data only. None found.

**In flight, for the overseer:** none of this review's findings touch an in-flight item's ACs. S191 stays parked on its owner question ("S191 year fill"); this review didn't reach its ACs.
