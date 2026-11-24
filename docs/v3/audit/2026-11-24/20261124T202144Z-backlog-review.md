## 2026-11-24 — backlog review (`amended`)

| | |
|---|---|
| Entry | backlog review pass |
| Captured (UTC) | `2026-11-24T20:21:44Z` |
| HEAD at review | `da6ec3e0` (tree dirty) |
| Trigger | 9 of 6 stories done since last review (count); also covers owner-directed S212 on backlog/edge-cache-1124 (b25b720c) |
| Stories `done` since last review | S194, S170, S172, S72, S74, S192, S191, S138, S154 |
| In flight | none |
| Turn-cap hits read | none |
| Verdict | `amended` |

**Findings / amendments**

Fresh-context backlog review (subagent), run beside `/run-backlog` with nothing in flight. Due by count (9 of 6); covers the owner-directed S212 on unmerged branch `backlog/edge-cache-1124` (`b25b720c`, S212 create + ADR-021/ADR-002 amendment), whose findings go to the coordinator, not into S212's text.

query: seed backlog --since 46ce3c56 → S149, S178, S191, S194, S211, S193, S153, S150, S81, S148, S161, B431, S173, S176, S177, S179, S180, S181, S183, S159, S209, S210, S90, S186, S135, S134, B430, S5, S145, S172, #403, #408, #325, S196, S195, S174, S184, S108, S204, #516, B514, B508, B506, #505, #501, #500, #489, #488, #487, #486, B481, #478, #476, #474, #472, S208, #470, S207, #468, S206, #466, S205, #464, #462, S203, #460, S202, #458, S201, #456, S200, #454, S199, #452, S198, #450, S197, #448, #446, #439, #435, B434, B433, B432, B429, B428, B427, B426, B425, B424, B423, B422, B421, B420, B419, B418, B417, B416, B415, B414, B413, B412, B410, B408, #405, #404, B399, B394, #386, #385, S192, S190, S189, S188, S187, S185, S182, S175, B359, S171, S170, #347, #340, S169, S157, S154, S142, S138, S125, S102, S99, S92, S91, S74, S72
query: issues --since 2026-11-22T20:22:44.000Z → #516, #514, #508, #506, #505, #501, #500, #489, #488, #487, #486, #481, #478 … #204 (as of 2026-11-24T20:06:38.000Z; the seed's full list)
query: item S193 → S193
query: item S147, S148, S150, S81, S135, S134, S192, S172, S72, S5, S145 → all `done`

## Check 2 — ground truth, next 3 (S193 p82.6, S149 p84, S153 p91)

- **S193.** Depends on S135, S134, S81 and design S192: all `done`. At HEAD: `web/src/pwa/afterUpdate.tsx` (`checkAfterUpdate`:28, `startAfterUpdate`:58, `useAfterUpdate`:95, `AfterUpdatePointer`:142, `PointerBody`:195, `Countdown`:228), `web/src/layout/NoticeSlot.tsx`, `web/src/pages/ChangelogPage.tsx`, `web/src/components/ViewState.tsx`, `web/src/layout/variant.ts`, `web/src/layout/AppShellLayout.tsx`, `e2e/flows/` (date-bar, main, update specs) exist; `e2e/design/S193.spec.ts` and `docs/v3/design-checks/S193/` are what it creates. Ratified A17 read whole. Cap 8 holds.
- **S149.** Depends on S150, S81 (`done`); design S147 `done`; prefer-after S148 `done`; #73 CLOSED 2026-11-17. `wrangler.jsonc` migrations `v1`, `v2` (AC 1's `v3` free), three env blocks bind `GAME_HUB`. `storeSchedule` sites at HEAD: `ingest.ts:224`, `ingest.ts:410`, `schedule-month.ts:126`, `backfill.ts:263` (AC 2's four; S194's `schedule-refresh.ts` goes through `fillScheduleMonth`). `STREAMING_ROUTE_EXCEPTIONS` `api.ts:238`; `readScheduleDay` `game-state.ts:262`; `useScheduleDay`/`writeScheduleDay` `web/src/api/schedule.ts:34,40` (a push clears S74's stored-copy time); `web/src/layout/LiveMarker.tsx` exists, so ACs 7–8 apply; `fake-durable-storage.ts`, `hub-leases.ts`, `live-hub.ts`, `game-hub-object.ts`, `game-ingest-object.ts`, `e2e/design/S19.spec.ts`, `web/src/api/live-stream.ts` exist. Cap 20 unchanged. No amendment.
- **S153.** Depends on S5, S145, S81, S172 `done`; designs S144, S34, S56 `done`. `PlayInningPill` (`web/src/components/videos/PlayInningPill.tsx:19`), `playInningLink` (`playLink.ts:28`), `web/src/pages/SearchPage.tsx`, `functions/src/mappers/search.ts` exist; `packages/mlb-api/src/` has no search parser (AC 1 creates it). Fixtures: `search-walk-off.json` (30 Bottom), S72's `search--team-147--tag-home-run.json` (12 Top, 12 Bottom). `pnpm api:spec` unchanged as the command.

## Check 2b — adversarial (review-class checklist, LOOP §7)

- **S193** (contract vs ratified design; a test that fails a correct build; missing states and transitions; back-stack semantics): AC 2 required `history.length` unchanged after open and close, but A17 "How it closes" makes Back close the modal and stay on the game page, normally built by pushing an entry on open. Breaking sequence: open (pushState, length n+1) → ✕ (history.back(), length stays n+1) → AC fails a correct build. Now tests Back and ✕ by effect. AC 1 lacked A17's "Moving between pages" hand-over and "the modal, once opened, stays open" when A6's box appears: added. AC 3's "unless the amendment keeps S135's rule" is settled by A17 ("recorded the same way (S135 AC 3)"); `checkAfterUpdate` records at load, so AC 3 tests one record per release. **Amended.**
- **S149** (every writer of shared state; version monotonicity; one window judgement; route table and spec; cleanup on unmount): AC 2's writer list against HEAD's four `storeSchedule` sites and `switchGameState`; AC 4's `applyIfNewer`; AC 5's `scheduleDayWindowMode` (`game-state.ts:256`); AC 6's polling stop against `game.ts`'s `streaming`. S212 hooks the same writers for purges, independently (S149 for in-window days, S212 for cached ones). No new break.
- **S153** (fence vs work items; closed-issue bookkeeping; fixture coverage): the Goal condition said no `scripts/` file may change while Work item 0 creates `scripts/verify-S153.sh` (input: the worker writes its grader → Goal condition broken); #347 closed `completed` 2026-11-22T21:05Z with no PR or comment while `functions/src/mappers/search.ts` still holds the types. **Amended** (Goal condition; notes).
- **S178, S211** (ACs rewritten since the last review, applying the owner's tier answers and Claude's review of PR #499): S211 AC 3 against `packages/domain/src/entitlements.ts` (`entitlementsForTier`:11, `hasMinimumTier`:36, `savantLinks` at Pro Backer:18); S178's /goal edit removes only the answered park. No break.
- **S212** (not on stage; findings for the coordinator, not edited). Items applied: every writer of the cached state; cache-key and purge coverage; outside-API limits; read-then-write staleness; predicate inputs; a test that fails a correct build; stale paths in the reuse check.
  - **F1 (AC 1, predicate input).** `isScheduleDaySettled(day, today, moved)` (`packages/domain/src/backfill.ts:82`) needs the joined day's `moved` (`readJoinedScheduleDay` returns it); AC 1 doesn't pass it. Input: a day whose suspended game resumed on a later day keeps its `Suspended` listing, so without `moved` it is never past and finished and keeps MLB-on-read forever. Fix: the day predicate takes `moved`; test that such a day is past.
  - **F2 (AC 2/4, late clips; owner question).** Highlights live in the game snapshot (`types.ts:250`); game ingest polls until `trailHours: 3` after the end (`window.ts:34`); S194's refresh reads schedules only. Sequence: final 22:30 ET, last poll ~01:30, MLB posts a clip at 09:00: at HEAD a later read past the ladder re-fetches and the clip appears; under S212 nothing re-fetches a past game, so it never reaches the Videos room or Best of. Asked in `.pending/needs-input.md`.
  - **F3 (AC 3, digest missing a game).** `getDayDigest` drops a game that fails to read (`digest.ts:18-19`), so a past day with one unreadable game gets the 30-day header without it; the game later stored by a game-route read (a read-path write AC 4 doesn't hook) purges nothing. Fix: the long header only when every listed game was read.
  - **F4 (AC 4, writers).** `?refresh=1` (`api.ts:269`, `:492`) stores a changed past day or game, but AC 4 hooks only the cron's writers, so `/api/v1/schedule?date=` (a different cache key) keeps the old copy 30 days. Fix: purge from one helper every store path calls.
  - **F5 (AC 4, "today's or a future day … its edge lifetime is already short").** False: a future day unchanged for 48 h carries `s-maxage` at the 48 h cap (`cache-control.ts:29-36`). Input: a game 10 days out is rescheduled; S194's refresh stores it; the edge serves the old day for up to 48 h. Fix: purge any changed `cache`-mode day or game.
  - **F6 (AC 4, per-request limit).** Cloudflare's purge-by-URL takes a bounded `files` list per request (30 on non-Enterprise plans). Input: a re-version of 20 past days (40 URLs) in one call is rejected and only logged. Fix: chunk to ≤30; test 31 URLs → 2 requests.
  - **F7 (AC 4 vs B408).** "Version changed" is decided from a read before the write (`ingest.ts:155`, `:182`); with Hyperdrive caching on (B408, unaccepted) it can be 60 s stale, so a purge can be skipped. Order B408 first (≈68.2).
  - **F8 (reuse check).** `mlbToday` is in `packages/domain/src/scoreboard-date.ts:56`, not `schedule-month.ts`.
  - **F9 (unproven reach).** AC 4 tests a fake `fetch` only; nothing shows the zone purge empties Workers Cache entries (`wrangler.jsonc:34-38`). Suggest a staging check (`cf-cache-status` MISS after a purge) once the secrets exist.

## Check 1 — coverage

- The 2026-11-24 parity review (`20261124T004216Z-parity-review.md`) queued "shell-scoreboard A15 has no owner", unanswered by the second review: owner question in `.pending/needs-input.md` (a small design story, or withdraw A15).
- The second review's "for the next review": S199/S200 name B421, B426–B428; S201/S202/S206/S207 name B433; B429, B430, B431, B434 touch the scoreboard and standings, which no pending design story redraws, so S199/S206/S201 are in step. B430's sort option has no drawn control: its fixer stops and asks (rule 18). Box order and S176/S209/S149 caps carried forward.
- Bugs without a fields block, for the coordinator to accept: **B408** (Hyperdrive query caching; ≈68.2, before S212), **B508** (S150 live-pair test timing out on CI, failing stage deploys; ≈61, after B514 p60), **B506** (`bt/no-browser-storage` misses bare `localStorage`/`caches`; ≈72.3). Accepted open bugs (B417, B418, B421, B423, B424, B426–B429, B432–B434 at 72.3; B430, B431 at 72.45): order unchanged.
- Issues: #403 is built by S194 (owner asked whether to close it); #347 closed early (S153's notes; coordinator may reopen); #516 is named by S212's notes; #404, #405, #385, #386, #439, #486–#489, #500, #501, #505 are enhancements that enter only as stories the owner asks for, none a latent bug under the next 3; duplicates #446–#478 closed.

## Check 3 — order

S212 (72.2) is the owner's; B408 should precede it (F7). S213 at 72.44 precedes B430 (72.45). S193 → S149 → S153 unchanged: none blocks another and all can start; nothing obsoleted by the 9 done. Current baseline (`frame/01`) names each of the 9; `pnpm backlog:check` passes; INDEX's As of is S138's.

## Duplication sweep (ADR-025)

`pnpm dup:check`: 0 clones over 285 files. Read the files added since `46ce3c56` (`functions/src/services/schedule-refresh.ts`, `packages/domain/src/schedule-refresh.ts`, `game-status-marker.ts`, `web/src/pwa/{offline,prefetch,sw}.ts`, `web/src/storage/workerCaches.ts`, `SearchFilterChips.tsx`, `LegalPage.tsx`); grep for Eastern-date math outside domain (comments and spec text only) and favorites tests on a game. **Hit:** `packages/domain/src/scoreboard-rows.ts:30` and `web/src/pwa/prefetch.ts:27` (S74) → **S213** inserted (p72.44, cap 3).

## Personal-data sweep (ADR-028)

S74's API cache (`web/src/pwa/options.ts` `RUNTIME_CACHED`) excludes `/api/v1/me` and below; the other GET routes carry no account data; the store is labelled through `web/src/storage/workerCaches.ts`. No new `console.*` in `functions/src`, `web/src`, `packages` since `46ce3c56`. S193, S149, S153, S212, S213 add no table, stored field, browser key or personal log line; S212's Cloudflare purge receives URLs only. None found.

## Verdict

`amended`: S193 and S153 edited; S213 inserted (a doc parity review is due for it); S212's findings F1–F9 to the coordinator; three non-blocking owner questions in `.pending/needs-input.md`.
