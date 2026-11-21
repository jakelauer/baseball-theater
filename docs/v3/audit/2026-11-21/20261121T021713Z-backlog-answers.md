## 2026-11-20 — backlog review answers (2026-11-20)

| | |
|---|---|
| Entry | owner's answers to the 2026-11-20 backlog review — part of finishing that review, not new drift |
| Captured (UTC) | `2026-11-21T02:17:13Z` |
| HEAD at capture | `9d1a9046` (tree clean) |
| Applied in | `9d1a9046` — backlog: apply the owner's answers to the 2026-11-20 design intake |

**Answers and what was applied**

Owner's answers (2026-11-20, through /pending) to the four questions of the 2026-11-20 design intake review (shell-scoreboard A7, A8, A9; standings-search-settings A9). The review's ledger fragment is docs/v3/audit/2026-11-21/20261121T021500Z-backlog-review.md (UTC date).

1. "No WP data" — "On the scoreboard with Win Probability chosen, what should a live or finished game with no win-probability data show in its slot?": chose "Status instead". Applied: S108 AC 3, a live or final game whose winProbability is null falls back to the Status occupant (pitchers of record on a final game, the count on a live one), with RTL cases for both; AC 2's slotOccupant returns that occupant; the note's "Left open" line settled.
2. "Sheet motion" — "When a phone asks for reduced motion, should the calendar's bottom sheet appear without its slide?": chose "Appear in place (Recommended)". Applied: S125 AC 7, under reduced motion the sheet shows at once with no slide (useReducedMotion), other devices keep the 200ms slide, with an RTL case; the note's "shouldn't start until answered" line replaced by the answer.
3. "Clinch letter" — "If MLB ever sends a clinch letter other than z, y, w or x, should Standings show the team bold with no letter, or print the letter anyway?": chose "Print it anyway". Applied: S160 AC 1 serves whatever letter MLB sends on a clinched row (clinchIndicator?: string | null; null when not clinched or none sent), tests on e and an empty string; S130 AC 2 shows an unknown letter as its prefix (e-NYY) with no legend line, clinchLegend leaves it out, with RTL and unit cases.
4. "WP Figma" — "Should a design chore update Figma's shared scoreboard module so scheduled rows stop drawing the pre-game win-probability bar that A7 removed?": chose "Yes, a design chore (Recommended)". Applied: S162 inserted (todo, priority 88, cap 6), "Design: the shared scoreboard row draws A7's scheduled row": edits Rich Scoreboard Module State=Scheduled (163:1612) and Modular Block Pre-Game/Win Probability (71:17) as a draft amendment for the owner to ratify; Source: Daily scoreboard by date; Settings; notes the captures it affects (S108, S125, S135). Embedded in frame 02; frame 00's question bullet marked answered.

Nothing beyond the answers was changed, except S162's insertion, which the answer directs (the next parity review checks its Source line).
