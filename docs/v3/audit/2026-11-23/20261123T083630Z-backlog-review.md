## 2026-11-23 — backlog review (`amended`)

| | |
|---|---|
| Entry | backlog review pass |
| Captured (UTC) | `2026-11-23T08:36:30Z` |
| HEAD at review | `c751d6d9` (tree dirty) |
| Trigger | drift: PR #362 inserted S174-S193, re-scoped S90, re-prioritized S150/S183/S186-S190/S90-S92, edited ADR-007 |
| Stories `done` since last review | none |
| In flight | S125, S135, S142, S159, B359 |
| Turn-cap hits read | none |
| Verdict | `amended` |

**Findings / amendments**

query: seed backlog --since cd40682d → S150, S153, S170, S171, S172, S173, S174, S175, S176, S177, S178, S179, S180, S181, S182, S183, S184, S185, S186, S187, S188, S189, S190, S191, S192, S193, S90, S91, S92, S138, S149, S161, S154, S5, S145, S81, S72, S74, S67, S68, S108, S71, S151, S168, S142, B359, S64, S159, S135, S134, S63, S125, S130, S155, #347, #340, S169, S157
query: issues --since 2026-11-22T20:22:44.000Z → #382, #381, #380, #379, #378, #377, #376, #375, #374, #373, #372, #371, #370, #369, #368, #367, #366, #365, #364, #363, #359, #358, #357, #356, #353, #347, #340, #331, #291, #289, #285, #282, #281, #274, #270, #267, #257, #240, #224, #223, #222
query: item S107 → S107 (`done`); item S162 → S162 (`done`); item S175 → S175
query: cites Video play links → S95, S96, S97, S127, S144, S145, S153, S172, S173
query: cites Settings (favorites, hide scores, playback prefs) → S6, S34, S38, S56, S57, S59, S67, S68, S70, S75, S107, S108, S126, S161, S162, S171

Scope: the drift is PR #362 (S174–S193 inserted, S90 re-scoped, S150/S183/S186–S190/S90–S92 re-prioritized, ADR-007 edited). Its three pre-PR and change-review rounds checked S174–S193; this review focused on the next 3 eligible stories, the order around the insertions, and the sweeps. In flight (not edited): S125, S135, S142, S159, B359. Next 3 eligible: S175 (72.5), S150 (83, barrier), S171 (85.5); S138 (77, waits S125), S191 (77.5, waits S159) and S192 (82.5, waits S135) were read as the seed's next-3 todo picks.

## Check 2 — ground truth at c751d6d9

- **S175:** `functions/src/services/standings.ts:30-33` `isEmpty`, call sites `:63`, `:67`, `:116`, `:165` exist as the Gap says; `standingsHasNoTeams(table: Pick<StandingsSnapshot,"divisions">)` at `packages/domain/src/standings-phase.ts:292`, exported through `packages/domain/src/index.ts:37`, so it accepts the service's `StandingsSnapshot`; its comment (`:285-290`) says the service keeps its own copy (AC 3's target). Grep: no other `isEmpty` / `teams.length === 0` under `functions/src/` outside tests. Callers of the exported functions: `functions/src/handlers/api.ts`, `functions/src/services/openapi.ts`, tests `standings.test.ts`, `cached-season-calendars.test.ts`. Depends on nothing. Cap 2 holds. **Finding:** issue #340 is already closed `completed` (2026-11-23T08:25:49Z, referenced by PR #362's commit `4d60f87d`), so the note "merging it closes enhancement #340" is false. Amended.
- **S150:** prerequisites #71 and #72 closed `completed`; named code exists: `live-fixture.ts` (`scheduleMomentsAt`:64, `LIVE_FIXTURE_TIMECODE`:25), `baseball-copy.ts` (`COPY_RULES`), `data-classification.ts`, `overlay-mlb.ts` (`storeOverlay`), `backfill.ts` (`isFinalSummary`:106, `isScheduleDaySettled` in domain), `ingest.ts` (`storeGame`:67 private, `storeSchedule`, `getOrRefreshSchedule`, `getOrRefreshGame`, `ingestScheduleDay`, `refreshTodaysWindow`, `tickIngest`), `mappers/schedule.ts` (`mapLinescore`, `mapScheduleLive`), `mappers/live.ts` (`mapLiveFeedSummary`), `window.ts` (`isGameInActiveWindow`, `scheduleWindowMode`), `fixtures/raw/schedule-2026-09-05.json`; `functions/src/services/game-state.ts` is absent (what it creates). `GameSnapshot.startTime?` exists (`types.ts:230`). Depends on nothing. No change.
- **S171:** design S107, S162 `done`; depends S67, S68, S81 `done`. A16's frames are only `scoreboard-scheduled-row-mobile/-desktop` (`docs/v3/visual/shell-scoreboard/amendments/`), matching AC 8. `schedule-fixture.test.ts:51` and `:101` are the two regeneration tests AC 2 names. No change.
- **S138:** depends S125 (`doing`), S130, S155, S81 `done`; design S123, S129 `done`. `StandingsPage.tsx:75` `day = date ?? mlbToday(...)`, `:138` `asOf` with `isCalendarDate`; `BACKFILL_EARLIEST_DATE` at `packages/domain/src/backfill.ts:12`; S130's captures exist at three pairings. **Findings:** AC 5 captured only mobile and desktop while A8's `scoreboard-calendar-closed/open-*` frames exist at mobile, medium and desktop (rule 22: every state and pairing drawn); its fence named frozen/built files (`docs/v3/AUDIT.md`, `audit.jsonl`, `INDEX.md`, `CHANGELOG.md`) and the Goal condition prose lacked the grader-creation exception the `/goal` line has; Work item 0 linked a dead `#verify-script-contract` anchor. Amended.
- **S191:** depends S159 (`doing`; `favoriteTeamsOff` not at HEAD, it comes with S159). `ScheduleDayTally`/`ScheduleDayCount`, `distinctTeamIds`, `dayRegularSeason`, `storedGameType`, `monthGameCounts`, `monthLastChangedAt` in `packages/domain/src/schedule-month.ts`; month service `functions/src/services/schedule-month.ts` (`getScheduleMonth` reads `listGameCounts(first,last)` for the month only, fills only the month's days, `lastChangedAt` from the month's stored days). Port `packages/ports/src/repositories.ts:17-23` documents the tally's fields.

## Check 2b — adversarial (LOOP.md §7 checklist)

- **S175** — classes: comment truth (AC 3), one-implementation (ADR-025), caller reach (AC 2), stale reference (issue state). Break: #340 already closed → "merging closes #340" never happens. Fixed.
- **S191** — classes: fence vs. touched files, cache/freshness (ADR-021), missing-data edge, request budget, contract tests. Breaks: (1) the tally must carry per-day regular-season teams (its `teamIds` and `gameTypes` aren't paired per game), so the port's `listGameCounts` comment (lists the tally's fields) becomes untrue, outside the fence → rule 10 stop; fence gains `packages/ports/src/repositories.ts` (comment only). (2) A fresh database where only the shown month is stored: "null when the year's stored days can't tell" doesn't say whether mid-season days resolve or whether the service fetches other months, so an implementer could fetch the year from MLB (breaking S124's one-request budget) or null every day (feature never fires); AC 2 now states the rule (in season iff an R game on or before and on or after d; out iff one side fully stored and typed with none; else null), forbids MLB requests outside the month, and adds the unstored-neighbours test. (3) A cached month answer whose `inSeasonTeamIds` reads another month's days keeps `lastChangedAt` from its own month only, so a make-up game added in October never refreshes September's cached answer; AC 2 now makes `lastChangedAt` cover the year's days read, with a test. Cap 8 → 9. DB checks (db-reviewer list): no table or index added; one range read over a year of `schedule_days` per month request (≤366 rows, same query pattern as today's `listGameCounts`), no N+1.
- **S138** — classes: rule 22 pairings, fence vs. records, stale anchors. Break: A8 medium frames drawn and not captured. Fixed. AC 3's `?date=1850-01-01` case and the `Today` two-press case re-read against `StandingsPage.tsx` at HEAD: still hold.
- **S150** — classes: one writer (AC 4 grep), versioning (ADR-022), cache (`windowMode` at read time), migration + manifest + copy rule; DB checks: one row per `game_pk`, version/feed-time conditional write, a suspended game's two days share one row. Not re-scoped since the last review (re-prioritized only); held.
- **S171** — classes: fixture regeneration (never by hand), additive spec, render-count baseline, one label function. Held.
- **S192** (inserted) — Note said FEATURES "gains the owner's answer in this change set", but FEATURES' Update / change log UX row already quotes "Open the changelog in a modal on click" (PR #362). Fixed. Its question 1 goes to the owner now so the story needn't park.
- **S184** (inserted) — personal-data sweep: see below. Fixed by adding question 3.
- **S174–S183, S185–S193:** checked by PR #362's three rounds; spot-checked S174 (AC 5: no viewer column, manifest `none`, law P5) and S184 (AC 6) for ADR-028 only.

## Check 1 — coverage

- Parity review 2026-11-22 "For the next backlog review": (1) `cites "Video play links"` lists S172 and S173 and `cites "Settings (…)"` lists S171 (queries above): confirmed; (2) WCAG 2.5.3 answer: already applied, S173 AC 2 names `More from game: <gameLabel>`.
- Issues: #340 closed early (above; coordinator asked to reopen). #347 closed `completed` 2026-11-22 (S153's note already says #347's move touches the barrier; no change). B359 in flight at p85: priority fits (data fix beside S154/S171). No triage issues in the window.
- ADR-007 / ADR-012 edits: carried by S176/S177 (seed cites); no orphan work found.

## Check 3 — order

- S175 at 72.5 ahead of S159/S125: right — two turns, independent, unblocks nothing but clears ADR-025 debt.
- S191 (77.5) after S138 (77): both wait on in-flight items; independent of each other; order fine.
- S192/S193 (82.5/82.6) before S150 (83): S192 parks for the owner's question 1 unless answered now; asking now (below) keeps it from parking. S150's 24-turn barrier stays first among eligible code.
- S90 held at 9999 with S186–S190 at 10000–10004, S92 10005, S91 10006: dependency chain in order (S91 depends S190, S92 depends S190). S183 (130.5) before S185 (131, depends S174, S183): fine.

## Duplication sweep (ADR-025)

No story `done` since the last review. Code changed since f6b78591: `.github/workflows/deploy.yml`, `scripts/ci-changes.sh`, `scripts/backlog-vault/ci-law.test.ts`, `CLAUDE.md` (docs-only pushes never deploy): Deploy calls `scripts/ci-changes.sh push` for both its own-change and last-passing comparisons, no second copy of the docs/code rule. The one known duplicate in scope, `isEmpty` vs `standingsHasNoTeams`, is S175. None other found.

## Personal-data sweep (ADR-028)

Next 3 (S175, S150, S171) and S138, S191: no table/field/service/browser key/log line holding personal data (S150's `game_states` is baseball data, labelled in the manifest by AC 3; S171's throwing hand is schedule data). No product code added since the last review. **Miss:** S184 AC 6 builds a store of fans' chat questions and answers tied to the account and sends each question to the AI provider, and ADR-028's inventory (ARCHITECTURE.md, ADR-028 table) has no row for either; per the sweep that is an owner amendment, not a row an agent adds. S184 (p130, far from start) gains Waiting question 3 and AC 1 requires its answer before `doing`; not `blocked` for the backlog as a whole.

## In-flight findings for the overseer

- **S142 AC 1** says the open drawer holds "no link to `/changelog`", but the drawer has its own ratified Changelog link (S134 / shell-scoreboard A9 `drawer-changelog-link-*`). S142's test checks the intent (the footer isn't in the drawer); the AC text should say "no site footer (its Changelog link included) in the drawer", not "no link to /changelog". Not edited (in flight).
- S154 (p85) depends on S142; S138 depends on S125: noted, no change.

## Coordinator (state, not text)

- Reopen issue #340 so S175's pull request closes it (`Closes #340`), or leave it and S175 says `Refs #340`.
