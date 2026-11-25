## 2026-11-25 — backlog review (`amended`)

| | |
|---|---|
| Entry | backlog review pass |
| Captured (UTC) | `2026-11-25T15:39:12Z` |
| HEAD at review | `50c3c1f2` (tree dirty) |
| Trigger | run R20261125T104453Z hard ceiling: S220 changed ADR-020 in docs/v3/ARCHITECTURE.md; 6 stories done since last review |
| Stories `done` since last review | S173, S217, S218, S219, S99, S220 |
| In flight | S108, S146, S168, B577, B583 |
| Turn-cap hits read | none |
| Verdict | `amended` |

**Findings / amendments**

Focused review inside run R20261125T104453Z (`.claude/skills/run-backlog/SKILL.md` step 2): the brief's focus (the ceiling: ADR-020 note by S220, 6 done) plus the next items, not a full sweep. Fresh-context subagent.

query: seed backlog --since bd079aaf → S100, S101, S196, S200, S172, B579, S198, S173, #570, #561, #572, #619, #538, S181, B618, B616, B614, B613, #609, S220, S219, S218, S217, B588, B584, B578, B577, S168, S146, S108, S99
query: issues --since 2026-11-25T12:01:55.000Z → #619, #618, #616, #614, #613, #609, #598, #597, #596, #595, #588, #584, #578, #577, #447, #358, #308, #278, #240, #231 (as of 2026-11-25T15:28:59.000Z)
query: item S100 → S100
query: item S101 → S101
query: item S207 → S207
query: item S209 → S209
query: item B586 → B586
query: item B433 → B433

## Check 1 — coverage
- ADR-020's 2026-11-25 note (S220): every cron job logs one `db-round-trips` line through its own `inDatabaseScope` label (`functions/src/worker.ts:69-82`, `ScopeLabel` at `functions/src/adapters/postgres/connect.ts:62`). The only next story adding a cron job is S209 (resolve and seeding step): amended to run in its own cron scope. S181 (cites ADR-020) reads the feed over HTTP and is untouched by the note (S181.md lines 21, 28).
- S99's pattern (ask off `fetchGame`, keep across writes): `withAskedPlayerOfTheGame` at `ingest.ts:703,954,1239`, `game-recheck.ts:57`, `game-ingest.ts:105`, `backfill.ts:196`; `keepPlayerOfTheGame` at `ingest.ts:368,1071`. S100/S101 owned no keep step: amended.
- #619 (enhancement, data): games stored final before S99, or picked after BT's last read, never get a pick; `keepPlayerOfTheGame` already prevents the "loses the one it had" case the issue also names. Owner question. #609 (enhancement, data): game top bar missing during the lazy chunk; entry bundle near its 200 KB budget. Owner question.
- Unaccepted bugs (coordinator to accept): B616 (comment `packages/ports/src/edge-cache.ts` OwedEdgePurge.url, about 103.95), B613 (`e2e/design/S20.spec.ts` waits for a second schedule answer S149's socket never sends), B614 (`e2e/design/S170.spec.ts` long-reason checks) both about 108.5. Neither blocks S196/S198/S200/S207/S209 (no design match).
- Parity review 2026-11-25 (`20261125T080616Z-parity-review.md`) queue: both items answered by the previous backlog review (`20261125T121635Z-backlog-review.md:26`); no newer parity review.

## Check 2 — ground truth
- S100/S101: scope paths exist (`functions/src/adapters/http/mlb.ts`, `functions/src/mappers/`, `packages/mlb-api/src/live.ts`, `functions/src/adapters/fixtures/bundled.ts`); `PLAY_METRICS_LIMIT_MS` exported from `mlb.ts` (imported by `services/player-of-the-game.ts`); `fixtures/raw/rulesettings-823823.json` and `uniforms-823823.json` absent (created by AC 1). Depends on: none. Turn cap 12 assumed one port method and mapper; S99's ask/keep wiring touches 6 ask sites and 2 keep sites: raised to 14.
- S196: `PlayerDialog.tsx:80-100` is `fullScreen` with overlay opacity 1 (what AC 1 changes); `VideoPlayer.tsx:266,275` has `controls`, `playsInline` (B579 done); DISCLAIMER once at `VideoPlayer.tsx:20`; hosts `PlayerHost.tsx`, `DayDigest.tsx`, `SearchPage.tsx` import `LazyPlayerDialog`. Depends S172 done, B579 done; prefer S173 done.
- S200: depends none; prefer B428, B426, B588 (B588 done per seed). `groupHighlights` in `packages/domain/src/highlights.ts`; `VideoLayoutToggle.tsx`, `VideoGrid.tsx`, `VideoCard.tsx` exist.
- S198: depends S196 (todo, above it). `web/src/layout/NoticeSlot.tsx`, `routes.tsx` named in reuse check.
- S207: B586 done, B433 done. AC 1's Javier Assad line checked in `fixtures/raw/live-823823.json`: 4.2 IP, 3 H, 3 R, 3 ER, 5 BB, 3 K, 0 HR, season ERA 3.58. Info groups: away BATTING/BASERUNNING/FIELDING, home BATTING/FIELDING (AC 2's "home has no BASERUNNING" holds). `GameBoxscore` (`types.ts:113`) carries batting only, so AC 1's mapBoxscore extension is needed.
- S209: AC 3's jsonb paths checked against the stored shape: `GameSnapshot.plays: AtBat[]` with `matchup.batter.id`/`matchup.pitcher.id` (`packages/domain/src/plays.ts:98-101`), `boxscore.teams.{away,home}.batting[].id` (`BoxscoreBatter.id`); `games_official_date` index exists (`schema.ts:116`). "pitching where S205 stored it" was stale: amended to S207.

## Check 2b — adversarial (review-class checklist, `docs/v3/LOOP.md` §7)
- S100, S101 — items 2, 3, 4, 6 (ADR-025), 7, 11, 33. Break (items 2/3): the extra is asked once off the fetch path; the next live poll's `fetchGame` answers without it; `storeGames` writes the fetched game whole (`ingest.ts:368` keeps only the pick), so the stored field disappears and each non-asking poll stamps a new version for its absence. Amended AC 5 (keep test through `storeGames`; one shared helper generalized from S99's, ADR-025) and a note. Item 11: S100's keep requirement is exempt when the settings ride the live feed request (no contradiction with the reuse note). Item 33: AC 4's values name AC 1's recording. Item 7: bounded by `PLAY_METRICS_LIMIT_MS`, already in AC 5.
- S196 — items 11, 18, 22, 23. Break (item 11): `VideoPlayer` renders the title (`VideoPlayer.tsx`, title `Text` after the clip and tool row); moving it above the clip for the dialog moves it on `PlayerStage` too, and AC 4's only RTL (pill row above `<video>`) still passes. Amended AC 4: stage title follows the `<video>`, tested. Items 22/23: no src or play-intent change in this story.
- S200 — items 1 n/a, 3 (empty group left out; neither-team clips in `Other`), 11 (AC 1's grep scopes two folders and lists HEAD's other `teamIds` users), 14 (grep for `.teamIds` limited to two folders): no break found.
- S198 — items 15, 22, 23, 11: AC 3 forbids the portal remount and requires one `<VideoPlayer` site; AC 1 identity check. No break found beyond what the ACs already guard.
- S207 — items 3 (game stored without pitchers/info: AC 2's RTL), 4 (stored feed vs `GameBoxscore`), 6 (ADR-025: one projection), 9 (fixtures inside fence), 33 (Assad line names `live-823823.json`, checked): no break.
- S209 — items 1, 2 (single-row seeding cursor moved in the same transaction), 3, 6 (ADR-028: tables labelled `none`; settings field already personal), 7 (⌈cap/batch⌉ calls), 12 (interval ≥ a week), 18 (S205 superseded but still named: amended). DB checks (`.claude/agents/db-reviewer.md` list applied): resolve query uses the `(checked_at NULLS FIRST)` index with an OR filter; rows resolved with ids are skipped by filter, bounded by every player since 1901 (tens of thousands), acceptable; seeding keyset on `games_official_date` reads no `document` into the Worker; one migration for the ids table, one for `stats_provider` default 'mlb' (no rewrite on PG 11+). No further break.

## Check 3 — order
- S100 (106), S101 (107) before S196 (107.6), S200 (107.8), S198 (108), S207 (108.03), S209 (108.2): kept. The first of S100/S101 generalizes S99's helper, the second reuses it; both cheap after S99. S198 depends on S196 above it. S209 prefers S207 above it. No item became obsolete; nothing arrived since the last review that needs a place except the three unaccepted bugs (coordinator).
- Underestimation class: S99 needed four review rounds for "keep the stored value" (commits a0ff5acf, 2b896604, 182931df, e57faadb): the same class S100/S101 inherit, hence their raised caps.
- Current baseline (frame 01): S173, S218, S219, S99, S220 rows present; S217 (a removed flag) has its `**Baseline:**` line and no stale `watchFirst` row (grep empty); every done story since S156 here has its Baseline line.

## Duplication sweep (ADR-025)
Read the code the done stories added: `functions/src/services/player-of-the-game.ts`, `packages/domain/src/player-of-the-game.ts`, `functions/src/mappers/player-of-the-game.ts` (one each), `web/src/components/search/resultPlayLink.ts` (reuses `playInningLink`), `data-game-pk` (`ScoreboardModule.tsx:186`, `CollapsedBar.tsx:52`, specs pick by attribute), S220's `countRoundTrips` (one wrapper). None found. Latent: S100/S101 would copy S99's keep/ask: amended to share it.

## Personal-data sweep (ADR-028)
Done stories: S99 (public picks), S219 (migration 0007 owed purge paths; `data-classification.ts` updated), S220 log lines carry kind/job/counts/ms only (no personal fields), S217/S218/S173 none. Next stories: S100/S101 public game data; S196/S198/S200 no store (stated in notes); S209 tables labelled `none`, `statsProvider` inside account settings already personal and deleted with the account. None found.

## Parked items (findings to the overseer, text not edited)
- S146: fence must name `.claude/skills/release/SKILL.md` (prepare step (1) moved there; its line 27 still says CLAUDE.md's release rule) — awaiting the owner. S220 changed `wrangler.jsonc` (placement hint, `BT_INGEST_LOCATION_HINT`); S146's inputs already count `wrangler.jsonc`, so no new gap.
- S168: ADR-030 proposed on `story/S168`; its acceptance is a drift event (new ADR) for the next review; nothing in the next items depends on it.
- S108, B577, B583: no new finding.

## Verdict: amended
S100, S101, S196, S209 text records; frame 00 scheduling notes.
