## 2026-11-20 — backlog review (`amended`)

| | |
|---|---|
| Entry | backlog review pass |
| Captured (UTC) | `2026-11-21T02:15:00Z` |
| HEAD at review | `f706fcfd` (tree dirty) |
| Trigger | design intake: shell-scoreboard A7, A8, A9 and standings-search-settings A9 ratified 2026-11-19, landed 2026-11-20 |
| Stories `done` since last review | S107, S123, S129, S133 |
| In flight | none |
| Verdict | `amended` |

**Findings / amendments**

Design intake review, merged from two independent fresh-context reviewers (reports at HEAD ae7a2420, read-only; merged and applied by a third fresh-context agent). Scope: shell-scoreboard A7 (S107 -> S108), A8 (S123 -> S125, S138), A9 (S133 -> S134, S135); standings-search-settings A9 (S129 -> S130). All ratified 2026-11-19 (owner: "all 4 are ratified, changelog should be fixed in both places, and you should check against that rule."), landed as #125-#128.

A7 NOTE: scripts/review-debt.sh omitted A7. Its landing commit 8a80403f re-recorded an old backlog skip, which moved the debt base past A7's ratification. This review covers A7 in full (inventory, ownership, S108 re-scope).

Inputs (union of both reviewers): the four amendments in full; PNGs scoreboard-slot-winprob-{mobile,desktop,hidden-mobile}, scoreboard-slot-room-menu-mobile, scoreboard-mobile, scoreboard-calendar-{closed-mobile,offday-medium}, changelog-{mobile,desktop}, updated-pointer-{desktop,menu-open-mobile}, standings-regular-champion-mobile; Figma wqGKEFlvyxq0ObWZhRJdPF get_metadata/get_screenshot on 744:8529, 750:8571, 751:18166, 751:8750, 754:16964, 754:17060, 493:4757, 232:2389, 207:1983, 635:22633; notes S108 S125 S130 S131 S134 S135 S138 S150 S155 S158 and done S67 S107 S136 S139; ADR-002, 024, 025, 026; code at HEAD cited below; open issues #79 #80 #81 #84-#86 #103 #108 #109 #116 and bug note B81. Merger re-checked every disputed claim at HEAD (below).

INVENTORY SUMMARY
- A7: slot-win-probability (744:8529) State=Final|Live x Scores=Shown|Hidden; live = line so far + away/home chances (LAD 78% / SD 22%), final = whole line, names only, no %; hidden = names, "-" chances, "Hidden with scores"; line is the AWAY team's chance (A7.md:48), opposite of WinProbabilityCard (home rising); scheduled row: no slot box for Status/Win Probability, probables in the row body (A7.md:21, :51), space stays empty; Room Menu keeps Videos/Plays/Box without Recap (owner 2026-11-19). Data missing: no win probability on the schedule payload (ScheduleDayPayload["games"]); winProbabilitySeries needs plays+playMetrics (win-probability.ts:28). Undrawn: started game with no data.
- A8: date-selector, calendar-panel (Sheet|Dropdown x 9 states), date field, header, weekday row, calendar-day (State x Mark None|Red|Yellow x Size), footer, offday-tooltip, scrim. Words: Enter/blur-only strict parse (A8.md:92-95), "Not a date." / "No data before Apr 18, 1901.", dimmed 35% vs disabled 20% never stacking (:80), loading/failed/unknown months not dimmed (:56-58, :79), muted inert Today while the default day loads (:75), marks (:81), tooltip names in the fan's order (:136). Data missing: the list of favorites off a day and the red/yellow choice (S136 shipped only dayHasFavoriteTeam, used nowhere but its tests). Undrawn: the sheet's 200ms slide under reduced motion (Mantine theme in web/src/App.tsx has no respectReducedMotion).
- shell A9: /changelog page (releases/empty/loading/error x 3 pairings), changelog-link Plain|Current|Highlighted (651:13388), nav-rail Active=None (762:24824), update-notice Link=Yes|No, after-update-pointer Arrow x Link (651:13439), kind-label four kinds (763:16423). Words verified: "Changelog", "See the changelog", "Update complete", "You're on v3.2.0. What changed is in the changelog.", "Open the changelog", on /changelog "What changed is on this page." no link; goes after 10 s, on click, on drawer open; reduced motion = no fade/slide, no countdown line; never both with A6. Nothing missing in data beyond S131/S132.
- standings A9: heading, WS box, division table, row Clinched=No|Yes, clinch legend, spring-empty; switch = room-tabs instance (Mantine Tabs, global styles web/src/styles.css:95). Data missing: the clinch letter (parsed packages/mlb-api/src/parse.ts:1288, dropped at functions/src/mappers/standings.ts:49; StandingsTeamRecord has only clinched:boolean, packages/domain/src/types.ts:404). Fixtures checked by the merger with jq: letters appear only on clinched:true rows; standings-2026-final.json z x2 y x4 w x6; standings-2026-09-12.json x x2; 09-20-wildcard x x5 y x3.

OWNERSHIP MAP: 5 build stories in scope (S108, S125, S130, S134, S135); owned and complete as written 0; re-scoped 5; unowned items found 3 (favorites-off function, clinch letter on the API, the win-probability line on the schedule), now owned by new stories S159, S160, S161; unowned after amendment 0, with two owner questions holding S108 and S125. No recurring component built twice: the win-probability line is extracted from WinProbabilityCard by S108 (one line, card keeps home-rising); S138 reuses S125's control. View arithmetic moved to domain: slotWinProbability (away line, labels summing to 100), favoriteTeamsOff, clinchLegend.

NEW STORIES
- S159 (73, todo) favoriteTeamsOff in packages/domain/src/schedule-month.ts; removes the unused dayHasFavoriteTeam (ADR-025). Evidence: schedule-month.ts:89, grep shows dayHasFavoriteTeam only in its own tests; S125 fence has no packages/domain; S125's 2026-11-10 review note: "the intake after ratification splits the story rather than raising the cap again".
- S160 (76, todo, prefer after S155: same mapper) StandingsTeamRecord.clinchIndicator?: z|y|w|x|null, only on clinched rows, unknown -> null; additive spec and client; every phase table. Evidence above. Priority 76 (integer rule) keeps S130 (77) next and ahead of spring training 2027-02-19.
- S161 (103, todo, after S150; prefer after S149) scoreboardWinProbability over winProbabilitySeries; stored on the game's game_states row at ingest; served on the schedule payload and readScheduleDay; existing games filled by the migration; a schedule-source write never clears it. Database checklist: one nullable JSON column, <1 KB per game, no index, no new query (the day read already joins the row); no personal data.

RE-SCOPED STORIES
- S108: depends on S161; AC 1 label "Win Probability" third (standings-search-settings DESIGN.md:23); AC 2 slotOccupant returns null for pregame status/winProbability, probables occupant removed, probables drawn in the row body for every setting (removing the box alone deletes them: GameRowSlot.tsx:59,:128 draw them only inside the slot; ScoreboardModule.tsx draws none), space stays empty; AC 3 slotWinProbability (away line; labels = round(home), 100 - it), one shared line component, live labels, final no %, hidden form, no-data case = owner answer. Cap 14 kept, assumption rewritten. Notes: design-match chrome (A7.md:15), A8/A9 frames' stale pre-game bar, B81/S157 statuses follow gamePhase.
- S125: depends on S159; AC 1 Enter/blur only, strict parser, both messages, keeps typed text; AC 2 dimmed vs disabled, loading/failed/unknown months unmarked and undimmed, the mark through favoriteTeamsOff only in a loaded month, tooltip names in the fan's order; AC 7 muted inert Today. Cap 16 kept (the split is S159). Notes: marks stay on short cells (agent's reading; no Size=Short+mark variant in 751:8750); destination props for S138; reduced-motion question; A8 frames' stale pre-game bar.
- S130: depends on S160; AC 2 letter from S160, legend meanings via clinchLegend in packages/domain, null/absent letter = bold no prefix, loading and error without switch and box (standings A9.md:127-129); AC 4 box's date line through AC 3's formatter. Cap 16 kept.
- S134: AC 1 title, dates (dateless release), Major Feature header per headline addition, four kind labels, three-release RTL; AC 3 "Changelog" link above the version line, Current on /changelog with no active nav item, not in nav list, version line not a link; AC 5 frame list and chrome caveat (A9.md:25-29). Corrected the stale changelist-* note.
- S135: AC 2 "See the changelog", no link on /changelog; AC 3 ratified words, /changelog form (no link, rail link current), drawer-open dismissal with the drawer link highlighted, reduced motion (no fade/slide/countdown, 10 s still runs), never returns after A6 even after Snooze, pointer floats over a marker; AC 6 frame list; retired-build note accepted (owner A9 Q14: "I don't think this matters. Shouldn't be a way to update to a retired version."). Cap 12 -> 13.
- Frames: 00 (scheduling notes), 01 (calendar, WP and standings baseline rows name S159, S161, S160), 02 (embeds), 04 (WP row), 05 (calendar and standings gap-map rows).

DISAGREEMENTS AND RESOLUTION
1. Favorites off a day. R1: a full UI story (mark, tooltip, hold) split out of S125 after it, S125 drawing no mark. R2: a domain-only story before S125, the mark staying in S125. Resolved R2: the mark's UI, its owner quotes and its RTL were already in S125's ACs and cap assumption; the only thing S125 could not build was the function outside its fence. S125's added states (two messages, failed/unknown months, muted Today) are states of components it already builds, so the split is the domain function, not the mark.
2. Clinch letter. Both: a new story. Differences: priority (76.5 vs 76; stories need integer priorities, so 76, beside S155 with prefer_after S155 for the shared mapper), cap (6 vs 5; 6), "only when clinched" (R2; kept: fixtures carry letters only on clinched rows, so a stray letter on an unclinched row maps to null).
3. Win-probability line. R1: in S108 (AC 2 carries the series, cap 14 -> 16). R2: new S161 at ingest, after S150. Resolved R2: S108 also waits on an owner answer and its design; the data is backend work S108's UI shouldn't carry. R2 flagged ingest-time computation as possibly ADR-level. Merger's judgment: not ADR-level, so no owner question. ADR-002 already makes ingest+storage mandatory for core reads to avoid per-read fan-out, and CLAUDE.md's Live UX rule says to project upstream into durable store shapes; computing per read would load every game's full snapshot on each schedule read and hub push. Where it is stored follows S150's one-row-per-game table, which the day read already joins.
4. Probables. Both found removing the slot box deletes them; both put it in S108. R2 also removes the probables occupant and keeps the space empty (A7.md:51); merged both.
5. No-data slot (Q1). R1 recommends falling back to Status; R2 recommends no box. Put to the owner with both, recommending no box (consistent with the Live card and the scheduled row).
6. S135 cap: R1 keeps 12, R2 13. Resolved 13: four ratified behaviours each need fake-timer RTL cases.
7. S108 fence: R2 drops functions/src, openapi, fixtures. functions/src and openapi kept: AC 1 changes the GameRowSlot enum in openapi/bt-api.v1.json:384, which the generator in functions/src regenerates. fixtures/ dropped (no AC writes it once S161 owns the schedule field; its 2026-11-03 note marked superseded).
8. Frame captures: both give drawer-changelog-link-* and rail-version-release-desktop to S134; agreed.
9. Reduced-motion sheet (R2 only) and the Figma component chore (R1 only): unioned as owner questions.

CHECK 2 (ground truth, next 3 after amendment: S158 71, S131 72, S159 73)
- S158: scripts/backlog-vault/{claims.ts,in-flight.ts,ledger.ts,merge-safety.test.ts} exist; runs.ts absent (it creates it); depends on nothing. Nothing here changes it.
- S131: releases/ absent and no release:check in package.json, as its ACs create; depends_on []; AC 1 already carries performance. Unchanged.
- S159: packages/domain/src/schedule-month.ts exists with dayHasFavoriteTeam at :89 and its tests at schedule-month.test.ts:57-89; depends on S136 (done). Cap 4 fits one function and one removal.
- S125 (74, next after S159): DateControl.tsx, web/src/layout/variant.ts, web/src/api/scoreboardDate.ts, routes.tsx unchanged; deps S124, S136 done, S159 todo, S81 done.

CHECK 2B (review-class checklist) on every inserted or re-scoped story
- S108: rounding (home 49.5 -> 50/51 = 101; fixed by 100 - rounded home, test named); box removal deleting the probables (fixed, RTL in all three settings); scheduled game with stray metrics (pregame null, S161 AC 2); no-data game (owner question, story can't start); render-count baseline holds (ScoreboardPage.test.tsx has it).
- S125: "navigates once valid" lets 9/2 navigate mid-typing (fixed: Enter/blur, one navigation asserted); "no games (or unknown) dimmed" contradicts A8's unknown/failed months (fixed); marks drawn from a stale cache in a loading month (fixed: only loaded months); null/[]/undefined teamIds (S159 null).
- S159: favorites [147,121] with teamIds [121] -> yellow, off [147]; duplicate favorite named once; undefined (cached before S136) -> null.
- S160: MLB sends "e" or "Z" -> null; clinched with no letter -> bold no prefix; unclinched row with x -> null; cached answer without the field parses (optional).
- S161: schedule read loading N snapshots (forbidden, tested with a failing double); a schedule-source write wiping the stored line after a final (fixed: never clears, tested); games stored before S161 blank on the scoreboard (fixed: migration fill, tested on PGlite).
- S130: same letter in two divisions -> one legend line (dedupe test); answer cached before S160 -> bold no prefix.
- S134: /changelog?x=1 must still be current (RTL named); version line not a link.
- S135: A6 arrives, Snooze, then time passes -> pointer must not return (RTL named); reduced motion keeps the 10 s.

CHECK 3 (order): S158 71, S131 72, S159 73, S125 74 (waits on "Sheet motion"), S145 75, S155 76, S160 76 (prefer after S155), S130 77 (before 2027-02-19), S138 77, S132 79, S134 81, S135 82 ... S150 83, S149 84, S161 103, S108 104. Each new story sits one slot ahead of its consumer at small cost (caps 4, 6, 10). S108 stays late: nothing breaks today, and it waits on an owner answer. Bugs/issues: B81 (93) touches S108 only through gamePhase (noted); #79/#80 roll into B81; #84-#86, #103, #108, #109 are enhancements outside these surfaces; #116 (reopened today, migrate.test.ts port flake) can hit any story's pnpm verify when two run on one machine and doesn't change this intake.

Duplication sweep: no done stories since the last review added code (S107, S123, S129, S133 are design stories). The intake prevents three duplicates: the win-probability line (one component), the off-day logic (dayHasFavoriteTeam removed in favor of favoriteTeamsOff), the box's date formatter (AC 3's one function).
Personal-data sweep: S159, S160, S161 store or serve no personal data; S161's column holds public game numbers; none found.

FOR THE PARITY REVIEW (due: S159, S160, S161 inserted)
- FEATURES' Settings row: a scheduled row shows no slot box for Status or Win Probability, while Room Menu keeps its links without Recap (A7; owner 2026-11-19 "Keep the links, but continue to hide recap").
- FEATURES' Standings row: the clinch marks (owner 2026-11-16).
- FEATURES' Update / change log UX row: the page starts at v4.0.0 (owner 2026-11-19), superseding A9's "starts at v3.1.0".
- FEATURES' Calendar date picker row: the off-day ✕ (red/yellow, "Off day:") as A8 Decisions Q6 has it.
- The new stories' Source lines (S159 Calendar date picker, S160 Standings, S161 Settings).
- Outside parity scope, for the owner's design spec: VISUAL-DESIGN §5 Scoreboard still says every full game row has a modular block, which A7 contradicts for scheduled rows.

OWNER QUESTIONS (written to .pending/needs-input.md)
1. No WP data (Blocks: S108): "On the scoreboard with Win Probability chosen, what should a live or finished game with no win-probability data show in its slot?" Options: no box (recommended), Status instead, empty box.
2. Sheet motion (Blocks: S125): "When a phone asks for reduced motion, should the calendar's bottom sheet appear without its slide?" Options: appear in place (recommended), keep the slide.
3. Clinch letter (Blocks: none): "If MLB ever sends a clinch letter other than z, y, w or x, should Standings show the team bold with no letter, or print the letter anyway?" Recommended: bold, no letter.
4. WP Figma (Blocks: none): "Should a design chore update Figma's shared Rich Scoreboard Module so scheduled rows stop drawing the pre-game win probability bar A7 removed?" (163:1612, 71:17). Recommended: yes, a draft until ratified.
Not asked: ingest-time line computation (judged not ADR-level; reasoning in disagreement 3).

PRE-PR REVIEW OF THIS INTAKE (fresh context), applied before commit:
- R1 S161 AC 3: the line is feed-only data, exempt from S150's source switch; any feed write may set it, a schedule write never clears it; named as the second exception to S150's single-writer grep; test for a game first ingested after its window (/games/2026-09-05 opened 2026-11-20, 823823 gets its line).
- R2 S161 AC 3: a change to the line alone stamps a new row version and lastChangedAt; test that an unchanged state plus a new metric raises the day's served version.
- R3 S161 AC 4: the migration only adds the column; the fill is a separate idempotent, batched, resumable TypeScript step (migrateDatabaseAt after migrating, or a deploy script); PGlite tests kept and extended (second run writes nothing; stopped run resumes).
- R4 S161: packages/ports/ added to its fence (frontmatter, Scope files, Goal condition, /goal line).
- R5 S161 AC 3: missing full stop fixed.
- R6 S135: the (a)-(e) gaps returned under their 2026-11-20 bullet; the Retired-build bullet follows it.
- R7 S125 AC 1: Enter or blur navigates only when the parsed date differs from the day shown; RTL: focus, close by an outside tap, no navigation and no history entry.
- N1 S108 AC 2 wording (status unchanged on live and final); N2 S108 fixtures note superseded, fixtures/ out of its fence; N3 S134 AC 3: current wins over highlighted on /changelog, drawer too; N4 S160 Gap: wildcard fixture x x5, y x3; N5 S160 AC 3: blank rows carry null, parse test in functions/src; N6 S125 note citations (loading :53-55, failed :56-58, unknown :79); N7 S159 note: update ScheduleDayCount's teamIds comment at schedule-month.ts:42.
