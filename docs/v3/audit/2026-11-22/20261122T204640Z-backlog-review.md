## 2026-11-22 — backlog review (`amended`)

| | |
|---|---|
| Entry | backlog review pass |
| Captured (UTC) | `2026-11-22T20:46:40Z` |
| HEAD at review | `84d47315` (tree dirty) |
| Trigger | design intake: game-shell A7, shell-scoreboard A16, standings-search-settings A10; also the backlog review due by story count |
| Stories `done` since last review | S127, S162, S5, S157 |
| In flight | none |
| Turn-cap hits read | none |
| Verdict | `amended` |

**Findings / amendments**

Design intake review (game-shell A7, shell-scoreboard A16, standings-search-settings A10), also the backlog review due by story count. Two independent fresh-context reviewers (A and B, read-only, at `0452c6a0`), merged and applied by a design-intake-merger. PR #352's branch (`origin/backlog/review-2026-11-22b`, not yet on stage) was merged in first (fast-forward to `84d47315`), so S153's edit chains on #352's `20261122T200235Z-S153-edit.md`. Stories done since the last review, counted against #352's review: S127, S162, S5, S157 (the saved debt report, taken before #352's review was on this branch, lists ten).

Queries (the issues line with the earliest `as of` among the seeds, reviewer A's; reviewer B's seed printed none):
query: issues --since 2026-11-22T04:27:23.000Z → #353, #348, #347, #340, #337, #335, #334, #331, #327, #325, #324, #323, #315, #308, #294, #291, #289, #287, #282, #280, #277, #266, #264, #262, #259, #257, #137, #81, #80, #79 (as of 2026-11-22T20:22:44.000Z)
query: seed intake --since 52db0c3a → events A7, A16, A10 amendments; ac-rewritten S155 ×2, S159, S5; inserted S169, S170; count S145 S155 S169 S127 S162 S134 S130 S5 S148 S157 (reviewers A and B)
query: item S170 → S170 (reviewers A and B)
query: item S5 → S5 (reviewer A)
query: seed intake --since 622d2c36 → S2, S3, S5, S10, S19, S40, S41, S59, S60, S64, S66, S68, S69, S70, S71, S73, S74, S75, S83, S97, S106, S142, S145, S153, S154, S157, S170, S6, S20, S28, S39, S61, S67, S79, S108, S111, S125, S134, S135, S138, S148, S149, S4, S72, S127, S130, S159, S155, S81, S150, S24, S25, S136, S167, S124, #348, #347, #340, #337, #335, #334, S169, B327, #325, #324, #323, #315, S168, S162, S132, B81, #80, #79, A7.md, A16.md, A10.md (merger, after #352's review moved the base; same three design events, same issues)

## Inventory (merged)
- game-shell A7: `game-status-marker` set (773:20382), 4 states x 2 places; top bar mobile/desktop (medium = desktop, A7:29) for live, delayed, suspended, delayed start; scoreboard rows mobile/desktop. Phone: three non-live markers on their own line (56 -> 80px). Data present (`status.codedGameState`, `detailedState`, linescore, venue). Not drawn: the collapsed bar (question 3).
- shell-scoreboard A16: scheduled row (163:1612, slot 71:94 hidden), probables beside teams with throwing hand (`J. Steele (L)`), empty space kept, Room Menu box kept (438:3315). Missing data: `ProbablePitcher` has no hand (`packages/domain/src/types.ts:296`); MLB's raw schedule carries `pitchHand.code` (`fixtures/raw/schedule-2026-09-05.json`, checked); `mapProbable` drops it (`functions/src/mappers/schedule.ts:118`).
- standings-search-settings A10: 17 frames: Search floating player 7 (pills m/md/d, noplay m/md/d, nogame m), digest player 6 (pills m/md/d, noplay m/md/d), stage 4 (pill m/md, noplay m/md). The game pill is a `play-inning-pill` instance (724:10189). Data: Search's play fields come from S153 AC 1; the digest has no half-inning (`DigestItem`, `digest.ts:22-29`) but `DigestGame` holds plays; the stage has `game.plays`.

## Ownership: 6 owned, 3 re-scoped (S170, S108, S153), 4 unowned -> 3 new stories (S171, S172, S173), 1 not drawn (collapsed bar -> question)

## New stories
- S171 (p85.5) "A game that hasn't started shows its probable pitchers beside the teams, with no box". Source: Feature: Daily scoreboard by date; Settings (favorites, hide scores, playback prefs). Design S107, S162. Depends S67, S68, S81. Cap 9. Evidence: A16 frames vs `GameRowSlot.tsx:59-75`, `:128`, `slot-occupant.ts:14-18`; split from S108 AC 2 (both reviewers); throwing hand (reviewer A).
- S172 (p86.5) "The stage player shows the clip's inning pill above the video". Source: Feature: Video play links. Design S127, S144. Depends S145, S81. Cap 5. Evidence: `PlayerStage.tsx` draws no link; `PlayerHost.tsx:33`; `VideosRoom.tsx:219` builds the link from `playing` only. Frames: the 4 stage frames.
- S173 (p91.5) "Search's and the day digest's players link to the game's videos and to the play, as pills". Source: Feature: Video play links. Design S127, S144, S34. Depends S153, S145, S5, S71, S81. Cap 10. Evidence: `PlayerDialog.tsx:77-81` shows the link or the pill, never both; A10 repeals "Go to game"; the digest lacks play fields. Frames: the 13 Search and digest frames.

## Re-scopes
- S170: depends_on S81 + S171; prefer_after S148 dropped (done); AC 1 adds `IZ`, `PO`, `P`, `TU`, `T9`, `IH`, `MA`, `NA` and "a live marker never carries a reason" (checked against `fixtures/raw/gamestatus.json`); AC 2: no text-transform (`LiveIndicator.tsx:30` `tt="uppercase"` passes jsdom text checks while the screen reads upper case), computed style asserted, `LiveMarker` excepted from the grep by name, the row's inning to A7's frames ("Bot 7"; "Mid 3", "End 9") from one domain function beside `inningLabel`, with a note that question 2 may change it, rows with no reason ("Suspended", "Delayed start · {venue}", "Delayed" with no inning); AC 3 adds medium and recorded statuses; AC 4: the delayed-start row is S171's scheduled row, recorded statuses, a no-inning delayed row; AC 6 recorded statuses; AC 8 "anything outside the top bar and the scoreboard rows is not judged"; notes: A7 errata (A7:26, :41 "win probability" contradicts the frames and 163:1612; A7:3 names S157 as the build story, it is S170), #325, collapsed bar. Cap stays 12.
- S108: AC 2 keeps only the Win Probability occupant's phases (`null` on pregame); the scheduled row, probables in the body and Room Menu's pre-game links moved to S171; depends_on + S171; Impact's probables clause removed; cap 14 -> 12.
- S153: "Not Search's player" note names S173; #352's "the intake decides" bullet answered; AC 1 maps MLB's `inning: 0` to `null` (6 such clips in `fixtures/search-walk-off.json`, all `inningHalf: null`); barrier: not narrowed, since #347's move changes `functions/src/adapters/http/mlb.ts:43` and `functions/src/adapters/fixtures/fixture-client.ts:27`, and `claimBarrierFlags` flags `functions/src/adapters/`.
- S5 (done): not edited. A10 repeals its AC 9 link; S173 replaces it and updates its tests; its grader is frozen.

## Disagreements and resolutions
1. Slicing of A10's pills. A: S172 the stage only; S173 Search, digest and the shared dialog row. B: S172 the dialog's game pill and the stage; one S153 AC for Search's inning pill; S173 the digest. Resolved: A's. The dialog's pill row is one change to `PlayerDialog`, built and design-matched once (ADR-025); S153 keeps cap 11 and its ACs (under open PR #352, a barrier that runs alone); the stage needs nothing new and ships early. Trade-off: the repealed "Go to game" link stays until S173 (p91.5). Frames: S172 4 + S173 13 = 17, each once.
2. Source of the scheduled-row story. A: "Feature: Scoreboard" (no such FEATURES row). B: "Daily scoreboard by date; Settings (favorites, hide scores, playback prefs)", as S162 cites. Resolved: B's, the exact FEATURES row names (FEATURES.md:54, :63).
3. Throwing hand. A: missing, add `pitchHand`. B: data present. Checked: the raw schedule has it; the domain type and mapper don't. Resolved: A's (S171 AC 2).
4. Row inning while question 2 is open. A: keep "Bot 7th" until answered. B: A7's frames, "Bot 7". Resolved: B's (ACs follow the ratified frames, coordinator's direction), with a note in S170.
5. A's Q4 (build the scheduled row now as its own story). Resolved without asking: an ordering change both reviews support (S171 at 85.5), since A16 and A7 both draw the row and the default scoreboard ships the repealed box today.

## Check 2 (next 3: S159 p73, S125 p74, S138 p77)
PR #352 checked them at `2a1dc25a`; `2a1dc25a..0452c6a0` on `web/src`, `packages`, `functions/src` changes only S5's search files, `DayDigest.tsx`, `gameLabel.ts`, `SearchResultRow.tsx`, none of their inputs (both reviewers). `favoriteTeamsOff` still absent (S159 starts red); `BACKFILL_EARLIEST_DATE` exists for S138 AC 3. Dependencies S136, S167, S124, S81, S130, S155 done.

## Check 2b (inserted or re-scoped)
- S170: items 10 (Depends line has no `;`), 11 (the delayed-start row's body is S171's, AC 4 says so), 12 (no inning, no reason), 18 (prefer_after, cap note), 26 (`LiveMarker` named), 33 (statuses from `gamestatus.json`).
- S171: 4 (fixture regenerated through the recorder `schedule-fixture.test.ts` checks), 6 (one label function, no store), 9 (openapi/, web/src/api/generated/, fidelity test in the fence), 11 (S108 no longer removes `probables`), 33 (all 15 fixture games are final; the AC sets the recorded `P` status in the test's input).
- S172: 6 (one pill), 12 (waiting first clip vs chosen), 22 (a new row doesn't reload the video).
- S173: 9 (spec regenerated in the fence; the generated "Go to game" comment comes from `digest.ts:13`, so the grep covers `packages/domain/src/`), 11 (earlier tests updated, frozen graders untouched), 33 (Search over `fixtures/search-walk-off.json`, digest over 823823).
- S108: 11 (AC 2 no longer claims the scheduled row), 18 (Impact and cap updated).
- S153: 18 (#352's open bullets answered), 33 (inning 0 from the recording).
Barrier flags (`claimBarrierFlags`): none of S171's, S172's or S173's fence paths is a barrier.

## Check 3 (order)
S171 (85.5) before S170 (86); S172 (86.5) independent; S153 (91) then S173 (91.5); S72 (91) shares `SearchPage.tsx` with S153 and S173, so sequential; S108 (104) keeps its S150 -> S161 chain.

## Duplication and personal-data sweeps
Code added since the last review is S5's search route and page (S127, S157, S162 are designs). Duplication: "Go to game" is built once (`PlayerDialog.tsx:78-80`), `gameLabel` its one label; S173 adds one `gameVideosLink`. Personal data: S171, S172, S173 add no store, per-user field, outside service, browser key or log line.

## For the parity review
FEATURES' Video play links row (FEATURES.md:98) still says S127's designs are a draft and no story builds them; A10 is ratified and S153, S172, S173 build it; it lacks the owner's 2026-11-22 answers (no play -> game pill alone; spoken name "More videos from <game>"; stage pill row). Game status marker row names "a build story S157 adds": it is S170, after S171. New Source lines: S171, S172, S173.

## Owner questions
1. Should the two player pills' spoken names start with the words on screen (WCAG 2.5.3)?
2. On a scoreboard row, should the inning read "Bot 7" as every ratified frame draws it, or "Bot 7th" as built today?
3. Should a suspended, delayed or delayed-start game folded into the collapsed scoreboard bar say so?
