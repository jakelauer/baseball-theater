## 2026-11-22 — backlog review (`amended`)

| | |
|---|---|
| Entry | backlog review pass |
| Captured (UTC) | `2026-11-22T19:35:43Z` |
| HEAD at review | `2a1dc25a` (tree dirty) |
| Trigger | 6 stories done since last review |
| Stories `done` since last review | S145, S155, S169, S134, S130, S148 |
| In flight | S5, S127, S157, S162 |
| Turn-cap hits read | none |
| Verdict | `amended` |

**Findings / amendments**

query: seed backlog --since 52db0c3a → S155, S159, S169, S125, S138, S139, S160, S136, S167, S5, S157, S124, S81, S135, S130, S150, S153, S127, S142, S154, #340, S74, S149, #348, #347, #337, #335, #334, B327, #325, #324, #323, #315, S168, S162, S148, S145, S134, S132, B81, #80, #79
query: issues --since 2026-11-22T04:27:23.000Z → #348, #347, #340, #337, #335, #334, #331, #327, #325, #324, #323, #315, #308, #294, #291, #289, #287, #282, #280, #277, #266, #264, #262, #259, #257, #137, #81, #80, #79
query: item S159 → S159
(Texts read with `text-records.ts newest` for S159, S125, S138, S153, S5, S127, S157, S162, S135, S142, S154, S149, S74, S150, S168, S130, S155, S148, S134, S145, S169; enhancement issues #323–#325, #334, #335, #337, #340, #347, #348 read with `gh issue view`, as data. All nine were filed by the owner's account from this run's workers and reviewers.)

## Check 1: coverage
- **A10 (standings-search-settings, ratified 2026-11-22 on S127's open PR, read at `origin/story/S127`)** repeals the "Go to game: … →" link in every player and adds `More from game →` plus the inning pill to Search's player, the day digest's player and the stage player. No story builds those yet; the intake after S127 merges slices them (A10 itself names "S5 re-scoped, or a story sliced after it"). S5 ships with the old link (owner accepted at its design match). S153's note recorded this; its fence (`web/src/`) already holds `PlayerDialog`.
- **A16 (shell-scoreboard, on S162's PR):** no rule change beyond A7; the built scheduled row (`GameRowSlot.tsx` `Probables`, in the slot) must be compared with A16's frames (probables beside the names, slot space empty) at its intake.
- **A7 (game-shell, on S157's PR):** S170 (created on `story/S157`) builds it; at `origin/story/S157` A7.md still reads "Draft, not ratified" (finding for the overseer).
- **Enhancements:** #347 folded into S153 AC 1 (the parser S153 extends; fence already holds `packages/mlb-api/`). #340 is an ADR-025 duplicate (below): owner question. #334 (a one-line comment in `packages/ports/src/mlb.ts:51-52`), #335 and #348 (`functions/src/scripts/record-fixtures.ts`, a reviewer path), #337 (`tools/`, a barrier), #324, #325 (a one-off stored-row check, no code): left as enhancements, no open story's fence holds them without a drive-by. #323 and #315 closed (#315 by S169, done).
- **Bugs:** B81 and B327 closed `done`; no open bug in the seed.
- **Parity review queue** (`20261122T072534Z-parity-review.md`, "For the next backlog review": "A15 … S125's design match waits on its ratification"): not so. S125's note says AC 6 pairs A8's ratified frames and no AC waits on A15, and S159 AC 1/S125 AC 2 already give the All-Star day no mark. No amendment needed.
- **Last review's "For the next review":** the barrier rule landed (#333, `a5b4cd90`; `PACKAGE_OWN_CONFIG`, `scripts/backlog-vault/claims.ts:144`); the `releases/**` cache gap is fixed (`turbo.json:22`, `117e752f`); #315 closed by S169; `review-debt.sh --json` lists no turn-cap hits, so S130's cap of 16 held as far as the journal records; S159 not built yet.

## Check 2: ground truth (next 3: S159 p73, S125 p74, S138 p77)
- **S159:** `packages/domain/src/schedule-month.ts` at `2a1dc25a`: `dayHasFavoriteTeam` `:134` (no caller outside its file and tests), `dayRegularSeason` `:88`, `ScheduleDayCount.regularSeason` `:65`, `teamIds` `:56`; no `favoriteTeamsOff` yet (red-first). Depends on S136, S167: both `done`. Barrier: `claimBarrierFlags` over its fence flags nothing. Cap 6 still fits (one function, ~22 cases, one removal).
- **S125:** `web/src/components/scoreboard/DateControl.tsx`, `web/src/layout/variant.ts` (`useLayoutVariant` `:17`), `web/src/api/scoreboardDate.ts` (`useScoreboardDefaultDate` `:20`), `web/src/settings/store.ts` exist and are unchanged since `cf9a6805`; `fetchScheduleMonth` (`web/src/api/client.ts:77`) returns `regularSeason`; `useReducedMotion` in `LiveIndicator.tsx:16` (and now `LiveMarker.tsx:20`); `web/package.json` still `@mantine/core`/`hooks` `^7.17.1`, no `@mantine/dates`. Since `cf9a6805` `ScoreboardPage.tsx` changed only to `<SiteFooter live={false} />` (S148) and `routes.tsx` gained `/changelog` (S134), one `/games/:date` element still. Depends on S124, S136, S167, S81 `done`; S159 `todo` (next). Design S123 `done`. Not a barrier. Cap 16 unchanged.
- **S138:** `StandingsPage.tsx` (S130) takes `variant`, its heading is first in its `Stack`, drops `?view=` only by its own correction (`:118-130`; an address with no view is never rewritten), and has `asOf` = `isCalendarDate(date) && date !== mlbToday(…)` (`:138`). `useStandings` in `web/src/api/standings.ts`. `StandingsSnapshot.phase` still optional (`packages/domain/src/types.ts:471`). `docs/v3/design-checks/S130/` holds `standings-spring-*` and `standings-offseason-*` at all three pairings (AC 5). Depends on S130, S155 `done` (`d1571df3`, `cb0dc7fa`), S125 `todo`, S81 `done`; design S123, S129 `done`. Not a barrier. Cap 10 holds.

## Check 2b: adversarial (S159, S125, S138; plus S153, re-scoped here)
- **S138 AC 3, contradiction-with-own-claim class (LOOP §7 "exactly when / always" claim the AC's own cases break) and shared-predicate class:** AC 3 says the control and S130's "as of" line "always name the same day", but for `?date=1850-01-01` AC 3 has the control read today while S130's `asOf` (`isCalendarDate` only) heads the page "Standings as of January 1, 1850". **Amended:** both read one check of a real date from 1901-04-18 on (`BACKFILL_EARLIEST_DATE`, through S125's helper, ADR-025), with RTL for `1850-01-01`, `1901-04-17`, `1901-04-18`.
- **S138 AC 2** (history/URL class): `Today` → `/standings` with no `date`; the page never adds `?view=` to an address without one (`correct` needs `asked !== null`), so no replace entry interferes. Holds.
- **S159 AC 1** (boundary/null-input class: empty/`null`/missing `teamIds`, empty `monthDays`, duplicate favorites, ordering, regular-season flag, All-Star day): each case named; input types fit `ScheduleDayCount` at `:56`/`:65`. Holds. AC 2's grep scope (`packages/`, `web/src/`, `functions/src/`) covers the only callers. Holds.
- **S125 AC 2/3/8** (time-zone/clock class: `mlbToday` vs UTC at 2027-01-01T03:00Z; cached-data class: days stored before S167 answer `null`; request-storm class: no month request outside April 1901..`latestScheduleMonth`): unchanged code they read; holds. Barrier status (concurrency class): stale note **amended**.
- **S153** (fence/barrier class): `claimBarrierFlags` flags `functions/src/` (holds `functions/src/scripts/`, `is_reviewer_path` true for `scan-drift.ts` and `record-fixtures.ts`), so S153 runs alone as written; **amended** with a note to narrow it once S5's search files exist. #347's scan-drift entry stays out (reviewer path).
- Database checks: none of the four adds a table, column, index or query pattern.

## Check 3: order
- S159 → S125 → S138 is a strict dependency chain; nothing above blocks it. S150 (83) stays held as a barrier until nothing is in flight. S153 (91) waits on S5 (in flight). S142 (84) and S154 (85): S134 and S148 `done` made S142's "if S148 hasn't shipped" branches moot (`SiteFooter`/`LiveMarker` in `web/src/layout/`, `FooterMeta` deleted; three pages render `<SiteFooter live=…/>`), and S142 AC 1 already moves the footer into `AppShellLayout` with a `useState` setter. S149 (84) AC 7's grep for `LiveMarker` now finds it; the marker reaches the scoreboard through `SiteFooter`'s `live` prop (`ScoreboardPage.tsx:117`, with a comment naming S149). S135 (82) now has S134 `done`. No reorder needed.
- **Current baseline** (`frame/01`): rows name S130 (Standings), S148 (`SiteFooter`, `LiveMarker`), and each of S145, S155, S169, S134, S130, S148 carries its `**Baseline:**` line. No drift found.

## Duplication sweep (ADR-025)
- Code added since `52db0c3a` (`git diff 52db0c3a..HEAD --name-only -- functions/src web/src packages`). **Hit:** `isEmpty` in `functions/src/services/standings.ts:30-33` is `standingsHasNoTeams` (`packages/domain/src/standings-phase.ts:292-295`) line for line (#340). No open story's fence holds the standings service, so this is an owner question, not an amendment.
- `LiveMarker` vs `LiveIndicator`: different colour, words, speed and meaning, each comment says so; not a duplicate. Inning label: `PlayInningPill`/`playLink.ts` use the domain label; `PlaysPanel.tsx:211` builds a different heading (`Top 3rd · NYY`), pre-existing. No other hit (grep for `teams.length === 0`, `"Top `, `Bot `).

## Personal-data sweep (ADR-028)
- Next 3: S159 (pure function), S125 (reads the existing `favoriteTeamIds` setting; no browser key, table or log line), S138 (none). Done stories' added code: `git diff 52db0c3a..HEAD` grep for `console.`, `localStorage`, `sessionStorage`, `indexedDB`, `CREATE TABLE`, `logger.`: only two `console` lines in `functions/src/scripts/record-fixtures.ts` (file names and errors, no personal data). B327 removed the owner's approval words from the releases API. None found.

## Findings for in-flight items (to the overseer)
- **S5:** AC 8 still reads "Results show \"N results found\""; the owner changed it 2026-11-22: "Don’t show any number until we support paging". AC 9's "Go to game" link is repealed by A10, which S5 ships with as accepted; a note saying so keeps the grader and the intake aligned. #347 (search types into `packages/mlb-api`) is now S153's, so S5 needn't move them.
- **S157:** `docs/v3/visual/game-shell/amendments/A7.md` on `origin/story/S157` still says "**Draft, not ratified.**" and has no Ratification block or manifest; if the owner ratified it, the file needs that before it merges (else `review-debt.sh` skips it as a draft and no intake runs).
- **S127:** A10's opening names "S5 re-scoped, or a story sliced after it" for Search's player; S153 is the open story after S5 whose fence holds `PlayerDialog`.
- **S162:** none.
