## 2026-11-21 — backlog review answers (2026-11-21)

| | |
|---|---|
| Entry | owner's answers to the 2026-11-21 backlog review — part of finishing that review, not new drift |
| Captured (UTC) | `2026-11-21T18:24:32Z` |
| HEAD at capture | `4f6afdee` (tree clean) |
| Applied in | `4f6afdee` — Backlog: owner answers to review 2026-11-21 |

**Answers and what was applied**

Owner's answers (2026-11-21, through /pending) to the four questions of the 2026-11-21 backlog review. The review's ledger fragment is docs/v3/audit/2026-11-21/20261121T160237Z-backlog-review.md.

1. "Off days" — "When a favorite team has no games at all in the month the calendar shows, should its days still be marked as off days?": chose "Only teams with games that month (Recommended)" ("a favorite that plays no game in the shown month is left out of the mark and the tooltip, so a team that didn't exist yet, or is out of the postseason, never marks a day."). Applied: S159 AC 1, favoriteTeamsOff(teamIds, favoriteTeamIds, monthDays) counts only the favorites with a game in the shown month, with unit cases for Rays + Yankees in a pre-1998 month (no Rays mark; Yankees marks as normal), a Yankees-only fan in an October after elimination (no marks), and a July the Yankees play (a normal off day and the All-Star Game's day still marked red; a no-game break day stays null under the existing [] rule); S159's parked note removed, so the coordinator returns it to status:todo. S125 AC 2 passes the shown month's days, with an RTL case. S159's cap (4) unchanged; no grader exists yet.
2. "Visual doc" — "Should VISUAL-DESIGN §5 be updated to say a game that hasn't started has no slot box for Status or Win Probability, as the ratified A7 says?": chose "Yes, match A7 (Recommended)" ("the agent edits those lines to say what A7 and your 2026-11-19 Room Menu answer say, quoting you, and drops "Game status" from the occupant list, since status sits at the top left of every row."). Applied: VISUAL-DESIGN §5's right-hand slot paragraph (occupants: Status as pitchers of record / the count, room menu, win probability on live or final rows; a new paragraph quoting A7 and the owner's 2026-11-16 "Remove the box entirely." and 2026-11-19 "Keep the links, but continue to hide recap"), §7's slot row and §9's Game-row slot row. No ratified file touched.
3. "Vault fixes" — "Should I write one small process story to fix two problems in the backlog scripts (#299 and the issue sync's extra reads)?": chose "Yes, one story (Recommended)" ("the scripts share one "am I being run directly" check that compares real paths, and the sync stops reading each open issue one at a time; priority after S158."). Applied: S166 created (todo, priority 71.5, prefer after S158, cap 17, Source: Feature: Backlog in GitHub issues, closes #299 with its pull request).
4. "Turn caps" — "Should S158's run journal also record when a story hits its turn cap, so the review-due check can see it?": chose "Yes, add it to S158 (Recommended)" ("the journal gets a turn-cap event, and the review-due check reads it, so a turn cap hit makes a review due without anyone noticing it by hand; S158's scope grows by scripts/review-debt.sh."). Applied: S158 AC 1 gains the turn-cap kind; new AC 7 (summarizeRun lists hits, the run entry carries them, scripts/review-debt.sh reports each as a drift event from run entries and the live .run/run.json, with tests); status AC renumbered 8; scripts/review-debt.sh added to the fence, goal condition, /goal line and scope_files; turn cap 30 -> 32, its sentence now stating four review fix rounds of about 3 turns each.

Frame 00 marks the questions answered. Nothing beyond the answers was changed, except S166's insertion, which the answer directs (the next parity review checks its Source line).
