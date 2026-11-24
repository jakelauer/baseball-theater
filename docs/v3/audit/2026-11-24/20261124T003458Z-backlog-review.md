## 2026-11-23 — backlog review (`amended`)

| | |
|---|---|
| Entry | backlog review pass |
| Captured (UTC) | `2026-11-24T00:34:58Z` |
| HEAD at review | `709864e1` (tree dirty) |
| Trigger | 6 stories done since last review; drift: S194–S211 inserted, S174/S176/S178/S197/S198/S201/S202/S204/S205/S209/S211 ACs rewritten |
| Stories `done` since last review | S135, S159, S142, S125, S171, S102 |
| In flight | B412, B414, S72, S74, S138, S150, S154, S170, S172, S175, S191, S192, S194 |
| Turn-cap hits read | none |
| Verdict | `amended` |

**Findings / amendments**

**Seed and queries**

query: seed backlog --since dd481ab2 → S150, S174, S176, S178, S184, S192, S194, S195, S196, S197, S198, S199, S200, S201, S202, S203, S204, S205, S206, S207, S208, S209, S210, S211, S193, S149, S153, S161, S175, S191, B415, B416, S154, S185, S151, S168, S177, S181, S182, S179, S180, S183, S72, S74, S135, B410, S138, S170, B412, B413, S172, S81, S173, B426, B428, B433, S90, S186, S134, B434, S148, S5, S145, S125, S108, #478, #476, #474, #472, #470, #468, #466, #464, #462, #460, #458, #456, #454, #452, #450, #448, #446, #439, #435, B432, B431, B430, B429, B427, B425, B424, B423, B422, B421, B420, B419, B418, B417, B414, B408, #405, #404, #403, B399, B394, #386, #385, S190, S189, S188, S187, B359, S171, #347, #340, S169, S159, S157, S142, S102, S99, S92, S91
query: issues --since 2026-11-22T20:22:44.000Z → #478 … #204 (115 issues, as of 2026-11-24T00:21:58.000Z; listed in the seed output)
query: item S193 → S193
query: item S149 → S149
query: item S153 → S153
query: item S194 → S194
query: next 90 → S194 … S184 (the open order, read for check 3)
query: item S173 → S173; item S161 → S161; item S108 → S108; item S99 → S99; item S100 → S100 (dependencies, for "first free to start")
query: item S135, S134, S81, S192, S150, S147, S148, S5, S145, S172, S144, S34, S56 (dependency statuses of the next 3)
query: item B408, B419, B422, B430, B431, B426 (triage reads)

Every seeded story's full text was read through `pnpm backlog:search item <ID> --json` (the body): the next 3 (S193, S149, S153), every inserted story (S195–S211), the rewritten S174, S176, S178, S184, and S194's ACs 1–4 (in flight, for S149's writer question). Issue text was read as data only.

**Check 1 — coverage**

- The 17 stories inserted 2026-11-23 (S195–S211) and S194 had no Gap map row: added rows for the walkthrough's reworks (S195–S204), the box score (S205–S207) and player stats links (S208–S211), and S194 on the calendar row; the AI row no longer calls multi-source wholly a later theme.
- Newest parity review's "For the next backlog review" (2026-11-23 08:48Z): (1) S192's question was asked and answered (S193's note quotes S192's owner answer "Yes, that reading"); S192 now waits on ratification, in `.pending/` ("S192 ratify"). (2) S184's ADR-028 rows were answered "Yes, add both rows (Recommended)" and are in ARCHITECTURE.md lines 1376–1377. Nothing more to do.
- Bugs and issues since the window: B408 (Hyperdrive query caching on for staging and production; version-guarded writes can read rows up to 60 s stale) has no fields block — **for the coordinator to accept at about p68.2**, ahead of everything not in flight, since S150 (in flight) adds more read-then-write paths through it. Enhancements: #403 is built by S194 (in flight; its text names #403 but has no `Closes #403`: overseer finding); #340 is closed by S175 (`Closes #340` in its text, in flight); #435 is named in S194; #439, #405, #404, #386, #385 stay enhancements (owner asks for stories); #347 is folded into S153 (closed). B413 is `doing` with no claim in `.run/claims/` — coordinator to check.
- No ADR change since the window touches the next 3 beyond what they already cite (ADR-021 and ADR-028 events: S149 and S153 cite neither change; S153's personal-data note says no new store).

**Check 2 — ground truth of the next 3**

- **S193** (p82.6). Paths at HEAD: `web/src/pwa/` (with `afterUpdate.tsx`), `web/src/layout/NoticeSlot.tsx`, `web/src/pages/ChangelogPage.tsx` (+ test), `e2e/flows/`, `e2e/design/` exist. Depends: S135 done, S134 done, S81 done; Design S192 `blocked` (in flight, awaiting ratification, in `.pending/`). Cap 8 holds (the modal reuses ChangelogPage). Fence holds every path its ACs name. Sound as written.
- **S149** (p84). Paths at HEAD: `functions/src/game-ingest-object.ts`, `game-hub-object.ts`, `services/live-hub.ts`, `services/hub-leases.ts`, `services/fake-durable-storage.ts`, `handlers/live.ts`, `web/src/api/live-stream.ts`, `schedule.ts`, `game.ts`, `packages/domain/src/window.ts` (`scheduleWindowMode` line 200, `isGameInActiveWindow` 151), `versioning.ts` (`applyIfNewer` 21), `e2e/design/S19.spec.ts`, `web/src/layout/LiveMarker.tsx` (S148 done, so AC 7/8 take the "exists" branch). `STREAMING_ROUTE_EXCEPTIONS` and `API_ROUTER` in `functions/src/handlers/api.ts` (235, 253). `wrangler.jsonc` migrations hold tags v1, v2, so AC 1's v3 is next. `readScheduleDay` doesn't exist yet: S150's (in flight, a dependency). Depends: S150 `doing`, S81 done, issue #73 closed (completed); Design S147 done; prefer S148 done. **Amended** (2b, below).
- **S153** (p91). Paths at HEAD: `functions/src/mappers/search.ts`, `fixtures/search-walk-off.json`, `web/src/components/videos/PlayInningPill.tsx`, `playLink.ts` (`playInningLink`), `web/src/api/generated.types.test.ts`, `packages/domain/src/types.ts`. Depends: S5 done, S145 done, S81 done, S172 `blocked` (in flight, design match); Designs S144, S34, S56 done. The recording carries every field AC 1 needs: every result a `guid`; 30 `inningHalf: "Bottom"` with innings 9–13; 6 `inning: 0` with `inningHalf: null`; no top half. S5's mapper has no zod schema (no zod import in `search.ts`), so AC 1's move writes the parser: **amended** with a note; cap 11 holds.

**Check 2b — adversarial pass** (LOOP.md §7 checklist: every named path and symbol exists or is created; an AC's input that breaks it; writers and readers of shared state; caching and versioning; personal data; one implementation per calculation; fences hold the ACs' paths)

- **S149 AC 2 (writers of shared state): broken.** It named only "the cron's refresh" as a writer of stored days, but `storeSchedule` has four call sites at `709864e1` (`ingest.ts:200`, `ingest.ts:352`, `schedule-month.ts:136`, `backfill.ts:247`), and S194 (in flight) adds a six-hourly month refresh through the month fill. Breaking sequence: a fan has today's scoreboard open; the six-hourly refresh (or another fan's calendar read) fills the month and stores today's day with a game now postponed; nothing calls the day hub, so the open scoreboard shows the game as scheduled until a game publish happens, which a postponed game never sends. Amended: every `storeSchedule` write that changes a day calls its hub, only for a day with a game in its live window before or after the write (so backfill's thousands of past days make no Durable Object call), with a month-fill test and a backfill no-call test.
- **S153:** checked AC 1's three cases against the recording (above), AC 3's "no link inside a button", AC 5's grep scope; one clarification (zod), no break.
- **S193:** checked AC 2's "one component reused" against `ChangelogPage.tsx`, AC 3's seen rule against S135's store (`bt.lastRelease`, labelled `none` in `web/src/storage/storage.ts`); no break; the amendment of S192 settles the rest.
- **S195–S198** (player modal, mini-player): amendment numbers (game-shell's next free is A8; standings-search-settings at A10); `LazyPlayerDialog` opened by `PlayerHost`, `SearchPage`, `DayDigest` (grep, matches the Gap); S198 AC 3's single-container portal move against lazy hosts (it already forbids moving into a suspended host); S196 AC 3's iOS fullscreen path; no break.
- **S199/S200:** `classifyHighlight`, `filterHighlights`, `groupHighlights` exist (`highlights.ts` 20, 39, 144); `web/src/layout/variant.ts` exists. S200 AC 1's parenthetical list of files naming `teamIds` missed `web/src/test/calendar.tsx`: **amended** (the grep's two folders are unaffected).
- **S201–S204:** `scoringPlays`, `inningHalves`, `scoreAfterLabel` (`plays-room.ts` 20–41), `linescoreCells`, `shortPlayerName` (`format.ts:13`), `drawFlights` with alpha 0.55 (`StrikeZoneChart.tsx:121,135`), `maw={420}` (`AtBatViewer.tsx:57`), `PitchTrajectoryView` takes one `pitch`; `AtBat` has `about.atBatIndex` and `result.awayScore/homeScore` nullable (`plays.ts:80–96`), so S203's `runsOnPlay` rule is computable; no break.
- **S205** (database / versioning): `mapBoxscore` (`mappers/live.ts:204`), `LiveBoxscore` holds `pitchers`, `info`, `note`, `pitchingNotes` (`mlb-api/src/live.ts:416–450`); fixtures `live-823823.json`, `live-209865.json`, `live-823823-base.json`, `diffpatch-823823.json`, `game-823823(-live).json` and their tests exist. AC 3 keeps `lastChangedAt` for a shape-only change so ADR-021's ladder doesn't restart; checked against an upstream change (still resets). No break.
- **S206–S208, S210:** design and UI over the above; `MatchupCards.tsx`, `BoxRoom.tsx` exist. No break.
- **S209** (database checks of db-reviewer.md): the seeding query's paths match the stored shape (`games.document` JSONB, `official_date` indexed `games_official_date`, `BoxscoreBatter.id`, `plays[*].matchup.batter.id`); keyset paging and in-SQL extraction keep documents out of the Worker; the resolve step's `ORDER BY checked_at NULLS FIRST LIMIT` has its index; `fetchPlayers` and its callers exist. No break; cap 10 to be watched.
- **S211:** `account_settings` is column-by-column (`schema.ts:88–97`, `video_player` the precedent for the parse default), `Entitlements` carries `tier` (`types.ts:371`), `entitlementsForTier`/`hasMinimumTier` exist. No break.
- **S174, S176, S178, S184** (rewritten up to five times): checked S174 AC 1 against `.pending/` (the "S174 privacy" question is really queued, so the story's wait is consistent), S176 AC 5/6's month and day boundaries, S178 AC 6's `private, no-store` for a gated answer, S184's early-investigation park. No break.

**Check 3 — order and triage**

- Triage of the 2026-11-23 walkthrough bugs (all arrived at the provisional 72.3): **B419** → 72.05 (every scoreboard visit; same class as B410/S194 the owner already put first); **B422** → 72.1 (a play's clip can't be played at all); **B430**, **B431** → 72.45 (new behavior, not repairs); the rest stay 72.3 (polish and repairs in one walkthrough; equal priority, bugs ahead of stories).
- **S205, S206, S207** moved from 136–137 to 111.5–111.7: FEATURES lists Box score as Carry and the owner said *"we're missing the entire pitching part of the box score"*; S205 needs no design; the AI stories it now precedes are new features. Arguable, so asked in `.pending/` ("Box order", Blocks: none).
- Everything else around the seeded items stands: the design stories (S195, S197, S199, S201, S208) sit right before what they gate; S196 after S172 and S173; S202→S203→S204 share `PlaysPanel.tsx` and run in that order.
- Next 3 eligible: S193 (waits on S192), S149 (on S150), S153 (on S172), all in flight; S173 waits on S153/S172, S161 on S150, S108 on S161; the first free `todo` story is S99 (p105).
- Current baseline (rule 17): S135, S159, S142, S125, S171, S102 each have a `**Baseline:**` line and appear in frame note 01; the **As of** line is S102's. (Cosmetic: it reads "**S102** landed: **S102** landed:", from S102's own line and the builder both saying it; a done story's frozen text, left alone.)

**Duplication sweep (ADR-025)**

`git diff dd481ab2..HEAD` over `web/src`, `packages/*/src`, `functions/src` (non-test): the calendar's `dateParser.ts` imports `isCalendarDate` and `BACKFILL_EARLIEST_DATE` from `@bt/domain`; `DateControl.tsx` uses the domain's `addDays`; `scheduleMonthAnswerable` (`web/src/api/scheduleMonth.ts`) composes `isCalendarMonth`, `latestScheduleMonth`, `mlbToday`; `format.ts`'s new `probableLabel`/`probableSpoken` format names only; `copyrightYear` lives in the domain. `pnpm dup:check` (jscpd): 273 files, 0 clones. None found.

**Personal-data sweep (ADR-028)**

Done stories' code: one new browser key, `bt.lastRelease` (S135), labelled `personal: false` in `web/src/storage/storage.ts`; no new `console.*` lines in non-test code since `dd481ab2`. Next 3: S193 reuses S135's key; S149's day hub holds anonymous sockets and leases only; S153 states no new store. New stories: S174 (`clip_engagement`, `none`, no viewer columns), S209 (player ids, `none`), S211 (a settings field in an already-personal store), S176/S184 (chat's personal store and ADR-028 rows, approved), S198 (memory only), S200 (stops if the grouping becomes a setting). None found missing.

**In flight, for the overseer** (no text edited)

- S194: its pull request should carry `Closes #403` (it builds #403's six-hourly refresh and long-lived month answers), or `Part of #403` if it doesn't cover all of it.
- S150: B408 (Hyperdrive query caching on staging and production) can feed stale reads into S150's version-guarded `game_states` writes; its PGlite tests can't see it. The worker should know, and the coordinator should accept B408 ahead of S150's deploy.
